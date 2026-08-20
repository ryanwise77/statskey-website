// statskey-relayd is the Fleet remote-session relay daemon. It terminates
// outbound TCP connections from session hosts and viewers and forwards
// opaque AES-256-GCM frames between them (internal/relay). It is stateless:
// no filesystem writes, no shell-outs, no subprocesses.
//
// The relay never sees plaintext session content and cannot mint or expand a
// session: endpoints authenticate with device-key-signed hellos, present only
// the SHA-256 of their session key, and encrypt every payload frame
// end-to-end under that key.
//
// Deployment (DigitalOcean relay droplet): run as an unprivileged
// DynamicUser with a hardened unit, for example
// /etc/systemd/system/statskey-relayd.service:
//
//	[Unit]
//	Description=StatsKey Fleet remote-session relay
//	After=network-online.target
//	Wants=network-online.target
//
//	[Service]
//	Type=notify                      # add -sdnotify once packaged with libsystemd; otherwise simple
//	DynamicUser=yes
//	ExecStart=/usr/libexec/statskey-relayd -listen :7447
//	Restart=on-failure
//	RestartSec=2
//	WatchdogSec=30                   # only with sd_notify watchdog support
//	NoNewPrivileges=yes
//	CapabilityBoundingSet=
//	AmbientCapabilities=
//	PrivateTmp=yes
//	PrivateDevices=yes
//	ProtectSystem=strict
//	ProtectHome=yes
//	ProtectKernelTunables=yes
//	ProtectKernelModules=yes
//	ProtectKernelLogs=yes
//	ProtectControlGroups=yes
//	ProtectClock=yes
//	ProtectHostname=yes
//	LockPersonality=yes
//	MemoryDenyWriteExecute=yes
//	RestrictNamespaces=yes
//	RestrictRealtime=yes
//	RestrictSUIDSGID=yes
//	RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
//	SystemCallFilter=@system-service
//	SystemCallErrorNumber=EPERM
//	DevicePolicy=closed
//	LimitNOFILE=65536
//	TasksMax=4096
//
//	[Install]
//	WantedBy=multi-user.target
//
// The daemon needs no read-write paths; do not grant any. Terminate TLS at a
// separate proxy only if the proxy is itself trusted not to log frame bytes —
// the end-to-end session key makes TLS optional for confidentiality of
// payloads, but TLS also hides handshake metadata (session IDs, device IDs)
// from passive observers, so fronting with a TLS terminator is recommended
// for production. Packaging (DEB, unit installation, firewall) is owned by
// fleetd/packaging in a separate track; see fleetd/REMOTE_SESSION.md.
package main

import (
	"context"
	"flag"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"statskey/fleetd/internal/relay"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	var (
		listen        = flag.String("listen", envOr("STATSKEY_RELAYD_LISTEN", ":7447"), "TCP listen address")
		idleTimeout   = flag.Duration("idle-timeout", relay.DefaultIdleTimeout, "close paired sessions idle this long")
		maxSessionAge = flag.Duration("max-session-age", relay.DefaultMaxSessionAge, "close paired sessions older than this")
		maxSessions   = flag.Int("max-sessions", relay.DefaultMaxSessions, "maximum concurrent sessions")
	)
	flag.Parse()
	log.SetPrefix("statskey-relayd: ")
	log.SetFlags(0)

	if err := run(*listen, *idleTimeout, *maxSessionAge, *maxSessions); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run(listen string, idleTimeout, maxSessionAge time.Duration, maxSessions int) error {
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	srv := relay.New(relay.Config{
		IdleTimeout:   idleTimeout,
		MaxSessionAge: maxSessionAge,
		MaxSessions:   maxSessions,
	})
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	log.Printf("listening on %s", ln.Addr())
	return srv.Serve(ctx, ln)
}
