// Package daemon is the root statskey-fleetd service: a Unix-socket server
// with SO_PEERCRED peer authentication, bounded canonical-JSON frames, and
// the attest/start/renew/stop/status/settle/publicKey methods of
// FLEETD_DESIGN.md.
//
// Mandatory invariants enforced here:
//   - tickets verify against the pinned coordinator key ring, this helper
//     instance, expiry, profile registry, and policy epoch before journaling
//   - the ticket journal is committed (fsync) before any systemd start
//   - one start per ticket; exact duplicates return the original receipt;
//     an interrupted start attempt makes the ticket unstartable (fail closed)
//   - renewals require strictly increasing sequences; equal sequences only
//     when byte-identical
//   - stop is always accepted (it only reduces authority)
//   - settle signs a termination receipt only after the job cgroup is proven
//     empty; failure to settle quarantines the daemon (no new work)
//   - on startup, every orphaned job unit is stopped before work is accepted
package daemon

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"statskey/fleetd/internal/journal"
	"statskey/fleetd/internal/leaseclock"
	"statskey/fleetd/internal/sysd"
	"statskey/fleetd/internal/wire"
)

// maxClockSkew bounds how far a ticket's serverIssuedAt may be in the future.
const maxClockSkew = 30 * time.Second

// settleTimeout bounds the wait for a job cgroup to empty.
const settleTimeout = 30 * time.Second

// reaperInterval is how often the daemon checks lease deadlines and unit
// states. Sub-second so resume-from-suspend is noticed promptly.
const reaperInterval = 250 * time.Millisecond

// Config carries everything the daemon needs. Paths and identity are
// established by cmd/statskey-fleetd; tests override them freely.
type Config struct {
	SocketPath    string
	AgentUID      uint32 // peer UID required on the control socket
	AgentGID      uint32 // socket group ownership when we create the socket
	StateDir      string // /var/lib/statskey-fleetd
	JobsDir       string // /var/lib/statskey-fleet-jobs
	RunnerPath    string // /usr/libexec/statskey-fleet-runner
	HelperKey     ed25519.PrivateKey
	InstanceID    string // hi_<32 hex>
	KeyRing       *wire.KeyRing
	Policy        Policy
	Sysd          sysd.Manager
	Clock         leaseclock.Clock
	Platform      wire.PlatformInfo
	Security      wire.SecurityInfo
	BootIDDigest  string // sha256:<base64url> of the kernel boot ID
	HelperBuildID string
	RunnerBuildID string
	// Logger may be nil (log.Default is used).
	Logger *log.Logger
	// SettleTimeout bounds the wait for a job cgroup to empty (default 30s).
	SettleTimeout time.Duration
	// SettleKillTimeout bounds the wait after a cgroup.kill fallback
	// (default 10s).
	SettleKillTimeout time.Duration
	// CgroupRoot, when set, remaps systemd-reported cgroup paths
	// (/sys/fs/cgroup/...) beneath this root. Production leaves it empty;
	// tests point it at a temp cgroupfs-shaped tree.
	CgroupRoot string
}

// jobState is the daemon's runtime record for one ticket.
type jobState struct {
	ticket     *wire.ExecutionTicket
	unitName   string
	cgroupPath string
	effective  wire.ResourceLimits
	started    bool
	settled    bool
	stopReason string // set when the daemon initiates the stop
	exitStatus int64
	exitKnown  bool

	// settleMu serializes settle calls for this ticket.
	settleMu sync.Mutex
}

// Daemon is the root service.
type Daemon struct {
	cfg    Config
	jr     *journal.Journal
	keeper *leaseclock.Keeper
	logf   *log.Logger

	mu          sync.Mutex
	jobs        map[string]*jobState
	quarantined bool // settlement failed; no new work (acceptance gate)
	stopping    bool // daemon shutting down

	// peerUID resolves a connection's peer UID; Linux uses SO_PEERCRED.
	peerUID func(conn net.Conn) (uint32, error)
}

// New builds a Daemon from cfg, opening the journal.
func New(cfg Config) (*Daemon, error) {
	if cfg.HelperKey == nil {
		return nil, errors.New("daemon: helper key required")
	}
	if !wire.HelperInstanceIDPattern.MatchString(cfg.InstanceID) {
		return nil, errors.New("daemon: invalid instance ID")
	}
	if cfg.KeyRing == nil || cfg.KeyRing.Len() == 0 {
		return nil, errors.New("daemon: coordinator key ring required")
	}
	if cfg.Sysd == nil {
		return nil, errors.New("daemon: systemd manager required")
	}
	if cfg.Clock == nil {
		return nil, errors.New("daemon: clock required")
	}
	if cfg.RunnerPath == "" || cfg.StateDir == "" || cfg.JobsDir == "" {
		return nil, errors.New("daemon: runner/state/jobs paths required")
	}
	if cfg.Policy.AttestationTTLMs <= 0 {
		cfg.Policy.AttestationTTLMs = 5 * 60 * 1000
	}
	if cfg.SettleTimeout <= 0 {
		cfg.SettleTimeout = settleTimeout
	}
	if cfg.SettleKillTimeout <= 0 {
		cfg.SettleKillTimeout = 10 * time.Second
	}
	jr, err := journal.Open(cfg.StateDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.JobsDir, 0o751); err != nil {
		return nil, fmt.Errorf("daemon: create jobs dir: %w", err)
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.Default()
	}
	d := &Daemon{
		cfg:     cfg,
		jr:      jr,
		keeper:  leaseclock.NewKeeper(cfg.Clock),
		logf:    logger,
		jobs:    map[string]*jobState{},
		peerUID: PeerUID,
	}
	return d, nil
}

// SetPeerUIDFunc overrides the peer-credential seam (tests).
func (d *Daemon) SetPeerUIDFunc(f func(net.Conn) (uint32, error)) { d.peerUID = f }

// Keeper exposes the lease keeper (tests).
func (d *Daemon) Keeper() *leaseclock.Keeper { return d.keeper }

// Recover stops orphaned job units and rebuilds state from the journal. It
// must complete before the socket accepts work (invariant 6).
func (d *Daemon) Recover(ctx context.Context) error {
	// 1. Stop every known job unit, including leftovers from a crash.
	units, err := d.cfg.Sysd.ListJobUnits(ctx)
	if err != nil {
		return fmt.Errorf("daemon: orphan enumeration: %w", err)
	}
	for _, name := range units {
		d.logf.Printf("recovery: stopping orphaned unit %s", name)
		if err := d.cfg.Sysd.StopUnit(ctx, name); err != nil {
			d.logf.Printf("recovery: stop %s failed: %v (continuing)", name, err)
		}
	}
	// 2. Rebuild job state from the journal.
	recs, err := d.jr.Scan()
	if err != nil {
		return fmt.Errorf("daemon: journal scan: %w", err)
	}
	for _, rec := range recs {
		if rec.Terminated {
			continue // fully settled; nothing to track
		}
		if len(rec.Request) == 0 {
			continue // interrupted commit; no ticket to track
		}
		ticket, err := wire.DecodeExecutionTicket(rec.Request)
		if err != nil {
			d.logf.Printf("recovery: journal ticket %s undecodable: %v", rec.TicketID, err)
			continue
		}
		js := &jobState{
			ticket:     ticket,
			unitName:   sysd.UnitName(ticket.TicketID),
			started:    rec.Started,
			settled:    rec.Terminated,
			exitStatus: -1,
		}
		if !rec.Terminated {
			js.stopReason = "daemon-restart"
		}
		d.jobs[ticket.TicketID] = js
	}
	return nil
}

// Serve runs the accept loop and the lease reaper until ctx is cancelled.
func (d *Daemon) Serve(ctx context.Context, ln net.Listener) error {
	go d.reaper(ctx)
	go watchdogLoop(ctx, d.logf)
	var wg sync.WaitGroup
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return fmt.Errorf("daemon: accept: %w", err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.handleConn(ctx, conn)
		}()
	}
	wg.Wait()
	return nil
}

// reaper enforces lease deadlines and records unit exits.
func (d *Daemon) reaper(ctx context.Context) {
	tick := time.NewTicker(reaperInterval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		expired, err := d.keeper.Expired()
		if err != nil {
			d.logf.Printf("reaper: clock error: %v", err)
			continue
		}
		for _, ticketID := range expired {
			d.mu.Lock()
			js, ok := d.jobs[ticketID]
			d.mu.Unlock()
			if !ok || js.settled {
				d.keeper.Remove(ticketID)
				continue
			}
			reason := "lease-expired"
			if l, ok := d.keeper.Get(ticketID); ok && l.Cancelled {
				reason = "cancelled"
			}
			d.logf.Printf("reaper: lease %s for %s; stopping unit", reason, ticketID)
			d.keeper.Remove(ticketID)
			d.stopJob(ctx, js, reason)
		}
		d.pollUnitStates(ctx)
	}
}

// pollUnitStates records terminal states of running jobs (best-effort exit
// status capture for termination receipts).
func (d *Daemon) pollUnitStates(ctx context.Context) {
	d.mu.Lock()
	var active []*jobState
	for _, js := range d.jobs {
		if js.started && !js.settled && !js.exitKnown {
			active = append(active, js)
		}
	}
	d.mu.Unlock()
	for _, js := range active {
		st, err := d.cfg.Sysd.GetUnitState(ctx, js.unitName)
		if err != nil {
			continue
		}
		if st.Gone() {
			d.mu.Lock()
			js.exitKnown = true
			js.exitStatus = -1
			d.mu.Unlock()
			continue
		}
		if !st.Active() {
			d.mu.Lock()
			js.exitKnown = true
			js.exitStatus = int64(st.ExecMainStatus)
			if js.stopReason == "" {
				js.stopReason = reasonFromUnitResult(st.Result)
			}
			d.mu.Unlock()
		}
	}
}

// reasonFromUnitResult maps systemd service results to termination reasons.
func reasonFromUnitResult(result string) string {
	switch result {
	case "success":
		return "exited"
	case "exit-code":
		return "failed"
	case "signal":
		return "signal"
	case "timeout":
		return "runtime-exceeded"
	case "oom-kill":
		return "oom"
	case "watchdog":
		return "watchdog"
	default:
		return "exited"
	}
}

// stopJob stops the unit and records the daemon-initiated reason.
func (d *Daemon) stopJob(ctx context.Context, js *jobState, reason string) {
	d.mu.Lock()
	if js.stopReason == "" {
		js.stopReason = reason
	}
	d.mu.Unlock()
	if err := d.cfg.Sysd.StopUnit(ctx, js.unitName); err != nil {
		d.logf.Printf("stop %s: %v", js.unitName, err)
	}
}

// handleConn serves one request on a connection (one request per connection).
func (d *Daemon) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	// Settle can wait for cgroup settlement (30s + 10s kill fallback), so
	// the connection deadline must exceed the worst-case method duration.
	conn.SetDeadline(time.Now().Add(5 * time.Minute))
	uid, err := d.peerUID(conn)
	if err != nil {
		d.logf.Printf("peer credentials: %v", err)
		d.writeError(conn, "unauthorized", "peer credentials unavailable")
		return
	}
	if uid != d.cfg.AgentUID {
		d.writeError(conn, "unauthorized", "peer is not the fleet agent")
		return
	}
	body, err := wire.ReadFrame(conn)
	if err != nil {
		d.writeError(conn, "invalid_frame", err.Error())
		return
	}
	req, err := wire.DecodeRequest(body)
	if err != nil {
		d.writeError(conn, "invalid_frame", err.Error())
		return
	}
	// The request is fully parsed before any side effect (invariant 11).
	resp := d.dispatch(ctx, req)
	out, err := wire.EncodeResponse(resp)
	if err != nil {
		out, _ = wire.EncodeResponse(wire.IPCResponse{OK: false, ErrCode: "internal", ErrMsg: "response encoding failed"})
	}
	wire.WriteFrame(conn, out)
}

func (d *Daemon) writeError(conn net.Conn, code, msg string) {
	out, err := wire.EncodeResponse(wire.IPCResponse{OK: false, ErrCode: code, ErrMsg: msg})
	if err != nil {
		return
	}
	wire.WriteFrame(conn, out)
}

// dispatch routes a decoded request to a method handler.
func (d *Daemon) dispatch(ctx context.Context, req *wire.IPCRequest) wire.IPCResponse {
	d.mu.Lock()
	quarantined := d.quarantined
	d.mu.Unlock()

	switch req.Method {
	case wire.MethodPublicKey:
		return d.methodPublicKey(req)
	case wire.MethodAttest:
		return d.methodAttest(req)
	case wire.MethodStart:
		if quarantined {
			return errResp("quarantined", "daemon is quarantined: a job cgroup could not be proven empty")
		}
		return d.methodStart(ctx, req)
	case wire.MethodRenew:
		return d.methodRenew(ctx, req)
	case wire.MethodStop:
		return d.methodStop(ctx, req)
	case wire.MethodStatus:
		return d.methodStatus(req)
	case wire.MethodSettle:
		return d.methodSettle(ctx, req)
	}
	return errResp("invalid_frame", "unknown method")
}

func okResp(result map[string]any) wire.IPCResponse {
	return wire.IPCResponse{OK: true, Result: result}
}

func errResp(code, msg string) wire.IPCResponse {
	if len(msg) > 280 {
		msg = msg[:280]
	}
	return wire.IPCResponse{OK: false, ErrCode: code, ErrMsg: msg}
}
