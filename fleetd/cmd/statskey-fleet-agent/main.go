// statskey-fleet-agent is the unprivileged Fleet worker agent. It loads the
// device keypair and enrollment from /var/lib/statskey-fleet, runs the
// signed device-request protocol against the coordinator, and drives the
// local daemon socket through the attest → poll → claim → start → renew →
// event → settle → report loop.
package main

import (
	"bytes"
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"statskey/fleetd/internal/agent"
	"statskey/fleetd/internal/daemon"
	"statskey/fleetd/internal/enroll"
	"statskey/fleetd/internal/fleetclient"
	"statskey/fleetd/internal/keys"
)

// buildVersion is stamped at build time (-X main.buildVersion=...).
var buildVersion = "dev"

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	var (
		stateDir = flag.String("state-dir", envOr("STATSKEY_FLEET_AGENT_STATE_DIR", "/var/lib/statskey-fleet"), "agent state directory (device key + enrollment)")
		socket   = flag.String("socket", envOr("STATSKEY_FLEETD_SOCKET", "/run/statskey-fleetd/control.sock"), "daemon control socket")
	)
	flag.Parse()
	log.SetPrefix("statskey-fleet-agent: ")
	log.SetFlags(0)

	if err := run(*stateDir, *socket); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run(stateDir, socketPath string) error {
	store := &enroll.Store{Dir: stateDir}
	deviceKey, _, err := store.LoadOrCreateDeviceKey()
	if err != nil {
		return err
	}
	enrollment, err := store.LoadEnrollment()
	if err != nil {
		return err
	}
	deviceID, err := keys.DeviceID(keys.Public(deviceKey))
	if err != nil {
		return err
	}
	if deviceID != enrollment.DeviceID {
		log.Fatalf("device key does not match enrolled device id %s", enrollment.DeviceID)
	}
	coordPub, _, err := keys.ParsePublicKeySPKI(enrollment.CoordinatorPublicKeySpki)
	if err != nil {
		return err
	}
	transport, err := fleetclient.NewClient(fleetclient.Client{
		Endpoint:          enrollment.Endpoint,
		DeviceID:          enrollment.DeviceID,
		PrivateKey:        deviceKey,
		CoordinatorKeyID:  enrollment.CoordinatorKeyID,
		CoordinatorPubKey: coordPub,
	})
	if err != nil {
		return err
	}
	daemonClient := daemon.NewClient(socketPath)
	// Settle waits for cgroup settlement; give it room over the default.
	daemonClient.Timeout = 5 * time.Minute

	// Learn the execution service ID from the daemon's policy (the daemon
	// enforces it; this just saves a failed attestation round-trip).
	pk, err := daemonClient.Call("publicKey", nil)
	if err != nil {
		return err
	}
	serviceID, _ := pk["executionServiceId"].(string)
	if serviceID == "" {
		log.Fatalf("daemon did not report an executionServiceId")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	a, err := agent.New(agent.Config{
		DeviceID:           enrollment.DeviceID,
		ExecutionServiceID: serviceID,
		Coordinator:        transport,
		Daemon:             daemonClient,
		HeartbeatPayload:   heartbeatPayload,
	})
	if err != nil {
		return err
	}
	log.Printf("agent starting (device %s)", enrollment.DeviceID)
	return a.Run(ctx)
}

// heartbeatPayload reports the attested v1 capability set and live host
// resources. The coordinator strips self-reported capabilities/executables
// on Linux and derives them from attestation; these are for forward
// compatibility and operator visibility.
func heartbeatPayload(activeJobs int64) map[string]any {
	return map[string]any{
		"capabilities": []any{
			"workspace.read", "workspace.snapshot", "workspace.write", "terminal.run",
		},
		"executables":     []any{},
		"resources":       probeResources(),
		"activeJobs":      activeJobs,
		"connection":      "direct",
		"protocolMinimum": int64(1),
		"protocolMaximum": int64(1),
		"softwareVersion": buildVersion,
	}
}

// probeResources reads live host capacity from /proc and statfs. Best-effort:
// zero values on probe failure (the coordinator treats them as
// under-provisioned, which fails closed).
func probeResources() map[string]any {
	res := map[string]any{
		"cpuLogical":           int64(0),
		"cpuAvailable":         int64(0),
		"memoryBytes":          int64(0),
		"memoryAvailableBytes": int64(0),
		"diskAvailableBytes":   int64(0),
		"gpuCount":             int64(0),
	}
	if b, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		n := bytes.Count(b, []byte("processor\t:"))
		if n > 0 {
			res["cpuLogical"] = int64(n)
			res["cpuAvailable"] = int64(n)
		}
	}
	if b, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			kb, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				continue
			}
			switch strings.TrimSuffix(fields[0], ":") {
			case "MemTotal":
				res["memoryBytes"] = kb * 1024
			case "MemAvailable":
				res["memoryAvailableBytes"] = kb * 1024
			}
		}
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs("/var/lib/statskey-fleet-jobs", &st); err == nil {
		res["diskAvailableBytes"] = int64(st.Bavail) * int64(st.Bsize)
	}
	if entries, err := os.ReadDir("/dev/dri"); err == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "renderD") {
				res["gpuCount"] = res["gpuCount"].(int64) + 1
			}
		}
	}
	return res
}
