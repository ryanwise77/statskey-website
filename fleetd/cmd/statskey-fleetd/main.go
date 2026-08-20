// statskey-fleetd is the privileged Fleet execution daemon. It loads or
// creates the helper key and instance ID, loads the coordinator key ring and
// policy, probes host facts for attestation, recovers orphaned job units,
// and serves the control socket.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"

	sddaemon "github.com/coreos/go-systemd/v22/daemon"

	"statskey/fleetd/internal/daemon"
	"statskey/fleetd/internal/hostinfo"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/leaseclock"
	"statskey/fleetd/internal/sysd"
	"statskey/fleetd/internal/wire"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	var (
		configDir = flag.String("config-dir", envOr("STATSKEY_FLEETD_CONFIG_DIR", "/etc/statskey/fleetd"), "directory containing coordinator-keys.json and policy.json")
		stateDir  = flag.String("state-dir", envOr("STATSKEY_FLEETD_STATE_DIR", "/var/lib/statskey-fleetd"), "daemon state directory")
		jobsDir   = flag.String("jobs-dir", envOr("STATSKEY_FLEETD_JOBS_DIR", "/var/lib/statskey-fleet-jobs"), "job workspace parent directory")
		socket    = flag.String("socket", envOr("STATSKEY_FLEETD_SOCKET", "/run/statskey-fleetd/control.sock"), "control socket path")
		runner    = flag.String("runner", envOr("STATSKEY_FLEETD_RUNNER", "/usr/libexec/statskey-fleet-runner"), "runner binary path")
		agentUser = flag.String("agent-user", envOr("STATSKEY_FLEETD_AGENT_USER", "statskey-fleet"), "agent service user")
		agentUID  = flag.Int("agent-uid", -1, "agent UID override (skips user lookup; tests)")
		agentGID  = flag.Int("agent-gid", -1, "agent GID override (tests)")
		aaProfile = flag.String("apparmor-profile-path", envOr("STATSKEY_FLEETD_APPARMOR_PROFILE", "/etc/apparmor.d/statskey-fleet-job"), "AppArmor profile file to digest")
	)
	flag.Parse()
	log.SetPrefix("statskey-fleetd: ")
	log.SetFlags(0)

	if err := run(*configDir, *stateDir, *jobsDir, *socket, *runner, *agentUser, *agentUID, *agentGID, *aaProfile); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run(configDir, stateDir, jobsDir, socketPath, runnerPath, agentUser string, agentUIDOverride, agentGIDOverride int, aaProfilePath string) error {
	// Helper key (0600) and public key (0644).
	helperKey, created, err := keys.LoadOrCreatePrivateKeyFile(filepath.Join(stateDir, "helper.key"))
	if err != nil {
		return err
	}
	if created {
		if err := keys.SavePublicKeyFile(filepath.Join(stateDir, "helper.pub"), keys.Public(helperKey)); err != nil {
			return err
		}
		log.Printf("generated new helper key")
	}
	// Instance ID (0644), generated once.
	instanceID, err := loadOrCreateInstanceID(filepath.Join(stateDir, "instance-id"))
	if err != nil {
		return err
	}

	// Coordinator key ring and policy.
	ring, err := wire.LoadKeyRing(filepath.Join(configDir, "coordinator-keys.json"))
	if err != nil {
		return err
	}
	policy, err := daemon.LoadPolicy(filepath.Join(configDir, "policy.json"))
	if err != nil {
		return err
	}

	// Agent identity for peer-UID checks.
	agentUID, agentGID, err := resolveAgent(agentUser, agentUIDOverride, agentGIDOverride)
	if err != nil {
		return err
	}

	// systemd connection and host facts.
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	mgr, err := sysd.NewSystemManager(ctx)
	if err != nil {
		return err
	}
	defer mgr.Close()
	systemdVersion := "0"
	if v, err := mgr.Version(ctx); err == nil {
		systemdVersion = v
	}
	facts, err := hostinfo.Probe(systemdVersion, valueIfFile(aaProfilePath))
	if err != nil {
		return err
	}

	// Build IDs: SHA-256 of the running daemon and runner binaries.
	selfExe, err := os.Executable()
	if err != nil {
		return err
	}
	helperBuildID, err := hostinfo.DigestFileHex(selfExe)
	if err != nil {
		return fmt.Errorf("helper build id: %w", err)
	}
	runnerBuildID, err := hostinfo.DigestFileHex(runnerPath)
	if err != nil {
		return fmt.Errorf("runner build id: %w", err)
	}

	d, err := daemon.New(daemon.Config{
		SocketPath:    socketPath,
		AgentUID:      agentUID,
		AgentGID:      agentGID,
		StateDir:      stateDir,
		JobsDir:       jobsDir,
		RunnerPath:    runnerPath,
		HelperKey:     helperKey,
		InstanceID:    instanceID,
		KeyRing:       ring,
		Policy:        policy,
		Sysd:          mgr,
		Clock:         leaseclock.NewSystemClock(),
		Platform:      facts.Platform,
		Security:      facts.Security,
		BootIDDigest:  facts.BootIDDigest,
		HelperBuildID: helperBuildID,
		RunnerBuildID: runnerBuildID,
	})
	if err != nil {
		return err
	}

	// Stop every orphaned job unit before accepting work (invariant 6).
	if err := d.Recover(ctx); err != nil {
		return err
	}

	ln, err := daemon.ListenControl(socketPath, agentGID)
	if err != nil {
		return err
	}
	defer ln.Close()
	log.Printf("listening on %s (instance %s)", socketPath, instanceID)
	// Type=notify: readiness means recovery finished and the socket is live.
	// Without this systemd kills the daemon at the start timeout.
	if _, err := sddaemon.SdNotify(false, sddaemon.SdNotifyReady); err != nil {
		log.Printf("sd_notify READY: %v", err)
	}
	return d.Serve(ctx, ln)
}

// loadOrCreateInstanceID reads or generates the hi_<32 hex> instance ID.
func loadOrCreateInstanceID(path string) (string, error) {
	if b, err := os.ReadFile(path); err == nil {
		s := string(b)
		if wire.HelperInstanceIDPattern.MatchString(s) {
			return s, nil
		}
		return "", fmt.Errorf("instance-id file has invalid content")
	} else if !os.IsNotExist(err) {
		return "", err
	}
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	id := "hi_" + hex.EncodeToString(buf[:])
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(id), 0o644); err != nil {
		return "", err
	}
	return id, nil
}

// resolveAgent resolves the agent service user to a UID/GID.
func resolveAgent(name string, uidOverride, gidOverride int) (uint32, uint32, error) {
	if uidOverride >= 0 && gidOverride >= 0 {
		return uint32(uidOverride), uint32(gidOverride), nil
	}
	u, err := user.Lookup(name)
	if err != nil {
		return 0, 0, fmt.Errorf("agent user %q: %w", name, err)
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return 0, 0, err
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return 0, 0, err
	}
	return uint32(uid), uint32(gid), nil
}

// valueIfFile returns path when it exists, else "" (the probe then records
// AppArmor as not enforcing, failing closed).
func valueIfFile(path string) string {
	if path == "" {
		return ""
	}
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return path
}
