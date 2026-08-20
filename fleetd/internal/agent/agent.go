// Package agent implements the unprivileged statskey-fleet-agent loop:
// attest → poll → claim → start → renew → event → settle → report, matching
// the desktop supervisor's protocol shapes and FLEETD_DESIGN.md's Linux
// execution flow. The agent holds the device key and talks to the
// coordinator; all privileged execution goes through the local daemon
// socket.
package agent

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"
)

// Coordinator is the signed device-request transport (fleetclient.Client).
type Coordinator interface {
	Do(ctx context.Context, action string, payload any) (any, error)
}

// DaemonClient is the local daemon IPC client (daemon.Client).
type DaemonClient interface {
	Call(method string, params map[string]any) (map[string]any, error)
}

// Config parameterizes the agent loop.
type Config struct {
	DeviceID           string
	ExecutionServiceID string
	Coordinator        Coordinator
	Daemon             DaemonClient
	// PollIntervalMs is the idle poll cadence (default 5s).
	PollIntervalMs int64
	// LeaseTTLMs is the requested lease TTL (default 60s).
	LeaseTTLMs int64
	// MaxBackoffMs bounds error backoff (default 60s).
	MaxBackoffMs int64
	// StatusPollMs is how often the agent checks job state while running
	// (default 2s).
	StatusPollMs int64
	// HeartbeatIntervalMs is the coordinator heartbeat cadence (default 15s).
	// The coordinator treats a device as offline without fresh heartbeats, so
	// polling alone can never make a worker eligible.
	HeartbeatIntervalMs int64
	// HeartbeatPayload builds the heartbeat body given the active-job count.
	// Nil sends a minimal offline-capable heartbeat (connection + protocol
	// range only).
	HeartbeatPayload func(activeJobs int64) map[string]any
	Logger           *log.Logger
	// randomHex/randomToken are test seams; nil → crypto random.
	randomHex   func(n int) string
	randomToken func(n int) string
}

// Agent runs the worker loop. One job at a time (dedicated worker mode).
type Agent struct {
	cfg Config
	log *log.Logger

	mu              sync.Mutex
	active          string // active ticket ID, if any
	attestedUntilMs int64  // coordinator-attested expiry; refresh before it
	bound           bool   // helper.bind succeeded this run
	stopped         bool
}

// New validates the config.
func New(cfg Config) (*Agent, error) {
	if cfg.Coordinator == nil || cfg.Daemon == nil {
		return nil, errors.New("agent: coordinator and daemon clients required")
	}
	if cfg.DeviceID == "" || cfg.ExecutionServiceID == "" {
		return nil, errors.New("agent: device id and execution service id required")
	}
	a := &Agent{cfg: cfg, log: cfg.Logger}
	if a.log == nil {
		a.log = log.Default()
	}
	if a.cfg.PollIntervalMs <= 0 {
		a.cfg.PollIntervalMs = 5000
	}
	if a.cfg.LeaseTTLMs <= 0 {
		a.cfg.LeaseTTLMs = 60_000
	}
	if a.cfg.MaxBackoffMs <= 0 {
		a.cfg.MaxBackoffMs = 60_000
	}
	if a.cfg.StatusPollMs <= 0 {
		a.cfg.StatusPollMs = 2000
	}
	if a.cfg.HeartbeatIntervalMs <= 0 {
		a.cfg.HeartbeatIntervalMs = 15_000
	}
	if a.cfg.randomHex == nil {
		a.cfg.randomHex = randomHex
	}
	if a.cfg.randomToken == nil {
		a.cfg.randomToken = randomToken
	}
	return a, nil
}

// Run executes the loop until ctx is cancelled. On cancellation it stops
// renewing and settles any active job before returning (graceful shutdown).
func (a *Agent) Run(ctx context.Context) error {
	var backoffMs int64 = 1000
	var lastHeartbeatMs int64
	for ctx.Err() == nil {
		if err := a.ensureAttestation(ctx); err != nil {
			a.log.Printf("attestation: %v", err)
			a.sleep(ctx, time.Duration(backoffMs)*time.Millisecond)
			backoffMs = nextBackoff(backoffMs, a.cfg.MaxBackoffMs)
			continue
		}
		if time.Now().UnixMilli()-lastHeartbeatMs >= a.cfg.HeartbeatIntervalMs {
			if err := a.heartbeatOnce(ctx); err != nil {
				a.log.Printf("heartbeat: %v", err)
				a.sleep(ctx, time.Duration(backoffMs)*time.Millisecond)
				backoffMs = nextBackoff(backoffMs, a.cfg.MaxBackoffMs)
				continue
			}
			lastHeartbeatMs = time.Now().UnixMilli()
		}
		idle, err := a.pollOnce(ctx)
		if err != nil {
			a.log.Printf("poll: %v", err)
			a.sleep(ctx, time.Duration(backoffMs)*time.Millisecond)
			backoffMs = nextBackoff(backoffMs, a.cfg.MaxBackoffMs)
			continue
		}
		backoffMs = 1000
		if idle > 0 {
			a.sleep(ctx, time.Duration(idle)*time.Millisecond)
		}
	}
	// Graceful shutdown: settle any active job so the coordinator gets a
	// termination receipt.
	a.shutdownActive()
	return ctx.Err()
}

func nextBackoff(cur, max int64) int64 {
	next := cur * 2
	if next > max {
		next = max
	}
	return next
}

func (a *Agent) sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// attestRefreshSkewMs re-attests this long before the coordinator-side
// attestation expires. Attestations are short-lived (<= 10 minutes); a
// process that attested once and never refreshed would silently lose all
// execution capability for the rest of its lifetime.
const attestRefreshSkewMs = 90_000

// ensureAttestation performs helper.bind (once per process) and
// helper.challenge → daemon attest → helper.attest whenever the current
// attestation is missing or approaching expiry.
func (a *Agent) ensureAttestation(ctx context.Context) error {
	a.mu.Lock()
	attestedUntilMs := a.attestedUntilMs
	bound := a.bound
	a.mu.Unlock()
	if time.Now().UnixMilli() < attestedUntilMs-attestRefreshSkewMs {
		return nil
	}
	if !bound {
		// helper.bind: bind this helper's key, builds, and policy epoch to
		// the enrolled device (replay-fenced server-side).
		pk, err := a.cfg.Daemon.Call("publicKey", nil)
		if err != nil {
			return err
		}
		// The coordinator owns the exact field contract (unknown fields are
		// rejected): it derives the helper key ID itself and takes the
		// instance ID from the attestation, not the binding.
		if _, err := a.cfg.Coordinator.Do(ctx, "helper.bind", map[string]any{
			"helperPublicKey":    pk["publicKeySpki"],
			"executionServiceId": a.cfg.ExecutionServiceID,
			"helperBuildId":      pk["helperBuildId"],
			"runnerBuildId":      pk["runnerBuildId"],
			"policyEpoch":        pk["policyEpoch"],
		}); err != nil {
			return err
		}
		a.mu.Lock()
		a.bound = true
		a.mu.Unlock()
	}
	res, err := a.cfg.Coordinator.Do(ctx, "helper.challenge", map[string]any{})
	if err != nil {
		return err
	}
	m, ok := res.(map[string]any)
	if !ok {
		return errors.New("agent: challenge response invalid")
	}
	challengeID, _ := m["challengeId"].(string)
	// The coordinator's challenge response field is `nonce`; the signed
	// attestation carries it as `challengeNonce`.
	nonce, _ := m["nonce"].(string)
	if challengeID == "" || nonce == "" {
		return errors.New("agent: challenge response missing fields")
	}
	attRes, err := a.cfg.Daemon.Call("attest", map[string]any{
		"challengeId":        challengeID,
		"challengeNonce":     nonce,
		"deviceId":           a.cfg.DeviceID,
		"executionServiceId": a.cfg.ExecutionServiceID,
	})
	if err != nil {
		return err
	}
	att, ok := attRes["attestation"].(map[string]any)
	if !ok {
		return errors.New("agent: daemon returned no attestation")
	}
	res2, err := a.cfg.Coordinator.Do(ctx, "helper.attest", map[string]any{"attestation": att})
	if err != nil {
		// A binding mismatch (e.g. after a daemon restart rotated the helper
		// key) can only be repaired by re-binding.
		a.mu.Lock()
		a.bound = false
		a.mu.Unlock()
		return err
	}
	// A 200 with accepted:false is still a rejection.
	if m, ok := res2.(map[string]any); ok {
		if accepted, present := m["accepted"].(bool); present && !accepted {
			a.mu.Lock()
			a.bound = false
			a.mu.Unlock()
			return errors.New("agent: coordinator rejected the attestation")
		}
	}
	// Track the coordinator-issued expiry and refresh before it. Missing or
	// unparsable expiry falls back to a short validity so we re-attest soon
	// rather than ever assuming permanent authority.
	untilMs := time.Now().UnixMilli() + 2*60_000
	if m, ok := res2.(map[string]any); ok {
		if exp, present := m["expiresAt"].(string); present {
			if parsed, perr := time.Parse(time.RFC3339, exp); perr == nil {
				untilMs = parsed.UnixMilli()
			}
		}
	}
	a.mu.Lock()
	a.attestedUntilMs = untilMs
	a.mu.Unlock()
	a.log.Printf("attestation accepted until %s", time.UnixMilli(untilMs).UTC().Format(time.RFC3339))
	return nil
}

// pollOnce polls for work and executes one assignment. Returns the idle
// delay in ms when there is no work.
// heartbeatOnce publishes presence, protocol range, and resources. On Linux
// the coordinator strips self-reported capabilities/executables and derives
// them from the fresh attestation instead (design invariant 13).
func (a *Agent) heartbeatOnce(ctx context.Context) error {
	a.mu.Lock()
	active := a.active != ""
	a.mu.Unlock()
	activeJobs := int64(0)
	if active {
		activeJobs = 1
	}
	payload := map[string]any{
		"capabilities":    []any{},
		"executables":     []any{},
		"activeJobs":      activeJobs,
		"connection":      "direct",
		"protocolMinimum": int64(1),
		"protocolMaximum": int64(1),
	}
	if a.cfg.HeartbeatPayload != nil {
		payload = a.cfg.HeartbeatPayload(activeJobs)
	}
	payload["activeJobs"] = activeJobs
	_, err := a.cfg.Coordinator.Do(ctx, "heartbeat", payload)
	return err
}

func (a *Agent) pollOnce(ctx context.Context) (int64, error) {
	res, err := a.cfg.Coordinator.Do(ctx, "job.poll", map[string]any{"limit": int64(1)})
	if err != nil {
		return 0, err
	}
	m, ok := res.(map[string]any)
	if !ok {
		return 0, errors.New("agent: poll response invalid")
	}
	assignment, _ := m["assignment"].(map[string]any)
	if assignment == nil {
		retry := a.cfg.PollIntervalMs
		if v, ok := m["retryAfterMs"].(int64); ok && v > 0 && v <= 300_000 {
			retry = v
		}
		return retry, nil
	}
	return 0, a.executeAssignment(ctx, assignment)
}
