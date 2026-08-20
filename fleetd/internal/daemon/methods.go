package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/cgroupx"
	"statskey/fleetd/internal/journal"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/leaseclock"
	"statskey/fleetd/internal/runner"
	"statskey/fleetd/internal/sysd"
	"statskey/fleetd/internal/wire"
)

// methodPublicKey returns the helper public key, key ID, and instance ID.
func (d *Daemon) methodPublicKey(req *wire.IPCRequest) wire.IPCResponse {
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	pub := keys.Public(d.cfg.HelperKey)
	spki, err := keys.SPKIBase64url(pub)
	if err != nil {
		return errResp("internal", err.Error())
	}
	keyID, err := keys.KeyID(pub)
	if err != nil {
		return errResp("internal", err.Error())
	}
	return okResp(map[string]any{
		"publicKeySpki":      spki,
		"keyId":              keyID,
		"helperInstanceId":   d.cfg.InstanceID,
		"executionServiceId": d.cfg.Policy.ExecutionServiceID,
		"policyEpoch":        d.cfg.Policy.PolicyEpoch,
		"helperBuildId":      d.cfg.HelperBuildID,
		"runnerBuildId":      d.cfg.RunnerBuildID,
	})
}

// methodAttest signs a coordinator challenge into a HelperAttestationV1.
// The daemon fills every host fact itself; the agent supplies only the
// challenge binding and the device/service identities it is proving for.
func (d *Daemon) methodAttest(req *wire.IPCRequest) wire.IPCResponse {
	challengeID, err := req.Params.Str("challengeId", wire.ChallengeIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	nonce, err := req.Params.Str("challengeNonce", wire.ChallengeNoncePattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	deviceID, err := req.Params.Str("deviceId", wire.DeviceIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	serviceID, err := req.Params.Str("executionServiceId", wire.ServiceIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	if serviceID != d.cfg.Policy.ExecutionServiceID {
		return errResp("policy_violation", "executionServiceId does not match local policy")
	}
	now := d.cfg.Clock.WallNow()
	att := &wire.HelperAttestation{
		ChallengeID:        challengeID,
		ChallengeNonce:     nonce,
		DeviceID:           deviceID,
		ExecutionServiceID: serviceID,
		HelperInstanceID:   d.cfg.InstanceID,
		BootIDDigest:       d.cfg.BootIDDigest,
		HelperProtocol:     wire.HelperProtocol,
		HelperBuildID:      d.cfg.HelperBuildID,
		RunnerBuildID:      d.cfg.RunnerBuildID,
		PolicyEpoch:        d.cfg.Policy.PolicyEpoch,
		Platform:           d.cfg.Platform,
		Security:           d.cfg.Security,
		IssuedAt:           now,
		ExpiresAt:          now.Add(time.Duration(d.cfg.Policy.AttestationTTLMs) * time.Millisecond),
	}
	if err := att.Sign(d.cfg.HelperKey); err != nil {
		return errResp("internal", err.Error())
	}
	return okResp(map[string]any{"attestation": att.Map()})
}

// methodStart verifies, journals, and starts a ticket. Exact duplicates
// return the original start receipt.
func (d *Daemon) methodStart(ctx context.Context, req *wire.IPCRequest) wire.IPCResponse {
	ticketVal, err := req.Params.Raw("ticket")
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	// Re-encode the ticket object to canonical bytes (the params came through
	// the strict canonical parser, so this is exact).
	ticketBytes, err := encodeMember(ticketVal)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	ticket, err := wire.DecodeExecutionTicket(ticketBytes)
	if err != nil {
		return errResp("invalid_ticket", err.Error())
	}
	if resp := d.verifyTicket(ticket); resp != nil {
		return *resp
	}

	// Per-ticket serialization.
	js := d.jobFor(ticket, true)
	js.settleMu.Lock()
	defer js.settleMu.Unlock()

	// Journal before start (invariant: journal-before-start).
	existed, err := d.jr.CommitTicket(ticket.TicketID, ticketBytes)
	if err != nil {
		if errors.Is(err, journal.ErrTicketConflict) {
			return errResp("conflict", "ticket ID committed with different content")
		}
		return errResp("internal", err.Error())
	}
	// Bind daemon state to the journaled bytes (the first-committed ticket),
	// never to a caller-supplied object.
	if journaled, err := d.jr.LoadTicket(ticket.TicketID); err == nil {
		if jt, err := wire.DecodeExecutionTicket(journaled); err == nil {
			d.mu.Lock()
			js.ticket = jt
			d.mu.Unlock()
			ticket = jt
		}
	}
	if existed {
		// Exact duplicate: return the original start receipt when present.
		if b, err := d.jr.ReadReceipt(ticket.TicketID, journal.ReceiptStarted); err == nil {
			rec, err := wire.DecodeExecutionStartedReceipt(b)
			if err != nil {
				return errResp("internal", "stored start receipt undecodable")
			}
			return okResp(map[string]any{"receipt": rec.Map(), "duplicate": true})
		}
		if js.settled {
			return errResp("conflict", "ticket already settled")
		}
	}

	// One start per ticket: a prior attempt that did not produce a receipt
	// is ambiguous and must never be retried (invariants 3 and 15).
	if err := d.jr.MarkStarting(ticket.TicketID); err != nil {
		if errors.Is(err, journal.ErrStartAmbiguous) {
			return errResp("conflict", "start already attempted for this ticket; settle it")
		}
		return errResp("internal", err.Error())
	}
	if err := d.keeper.Establish(ticket.TicketID, ticket.LeaseSequence, ticket.LeaseExpiresAt, ticketBytes); err != nil {
		return errResp("internal", err.Error())
	}

	effective := clampLimits(ticket.Resources, d.cfg.Policy.Ceilings)
	// The workspace is created by systemd's StateDirectory at unit start,
	// owned by the job's dynamic user. The daemon must NOT pre-create it:
	// a pre-existing root-owned directory triggers systemd's public→private
	// migration and the runner cannot write there.
	workspace := filepath.Join(d.cfg.JobsDir, ticket.TicketID)
	reqPath, err := d.jr.RequestPath(ticket.TicketID)
	if err != nil {
		return errResp("internal", err.Error())
	}
	spec := sysd.JobUnitSpec{
		TicketID:         ticket.TicketID,
		RunnerPath:       d.cfg.RunnerPath,
		RequestPath:      reqPath,
		WorkspacePath:    workspace,
		StateDirectory:   "statskey-fleet-jobs/" + ticket.TicketID,
		LogPath:          filepath.Join(d.jr.Root(), ticket.TicketID, "job.log"),
		Limits:           effective,
		NetworkProfileID: ticket.NetworkProfileID,
		AppArmorProfile:  d.cfg.Policy.AppArmorProfile,
	}

	// Phase 1 (fetch): the prep unit runs the runner's --prepare mode with
	// network access and the prep AppArmor profile. Only git executes there
	// (hooks/filters/credential helpers disabled); no repository-controlled
	// code runs until the job unit. The lease timer already bounds both
	// phases.
	prepName := sysd.PrepUnitName(ticket.TicketID)
	prepProps, err := sysd.BuildPrepUnitProperties(spec)
	if err != nil {
		return errResp("internal", err.Error())
	}
	if err := d.cfg.Sysd.StartTransientUnit(ctx, prepName, prepProps); err != nil {
		return errResp("unavailable", "systemd prep start failed: "+err.Error())
	}
	if err := d.waitPrep(ctx, prepName, workspace, ticket); err != nil {
		_ = d.cfg.Sysd.StopUnit(context.Background(), prepName)
		return errResp("unavailable", "prep failed: "+err.Error())
	}

	// Phase 2 (run): the job unit verifies the checkout and execs the
	// command with no network.
	unitName := sysd.UnitName(ticket.TicketID)
	props, err := sysd.BuildJobUnitProperties(spec)
	if err != nil {
		return errResp("internal", err.Error())
	}
	if err := d.cfg.Sysd.StartTransientUnit(ctx, unitName, props); err != nil {
		// The start marker stays: this ticket can never be started again.
		return errResp("unavailable", "systemd start failed: "+err.Error())
	}

	cgroupPath, err := d.cfg.Sysd.CgroupPath(ctx, unitName)
	if err != nil || cgroupPath == "" {
		// Fall back to the conventional path for transient units in the
		// system slice.
		cgroupPath = "/sys/fs/cgroup/system.slice/" + unitName
	}
	bootNow, _ := d.cfg.Clock.BoottimeNow()
	receipt := &wire.ExecutionStartedReceipt{
		TicketID:             ticket.TicketID,
		JobID:                ticket.JobID,
		Attempt:              ticket.Attempt,
		LeaseID:              ticket.LeaseID,
		HelperInstanceID:     d.cfg.InstanceID,
		UnitName:             unitName,
		CgroupPath:           cgroupPath,
		EffectiveLimits:      effective,
		RunnerBuildID:        d.cfg.RunnerBuildID,
		StartedAt:            d.cfg.Clock.WallNow(),
		StartedAtMonotonicMs: bootNow.Milliseconds(),
	}
	if err := receipt.Sign(d.cfg.HelperKey); err != nil {
		return errResp("internal", err.Error())
	}
	raw, err := receipt.Marshal()
	if err != nil {
		return errResp("internal", err.Error())
	}
	if err := d.jr.WriteReceipt(ticket.TicketID, journal.ReceiptStarted, raw); err != nil {
		return errResp("internal", err.Error())
	}
	d.mu.Lock()
	js.unitName = unitName
	js.cgroupPath = cgroupPath
	js.effective = effective
	js.started = true
	d.mu.Unlock()
	return okResp(map[string]any{"receipt": receipt.Map(), "duplicate": false})
}

// waitPrep waits for the fetch-phase unit's cgroup to empty (every process
// done) and then reads the runner's result marker from the workspace. The
// marker write happens-before process exit, so an empty cgroup guarantees it
// is visible. This is race-free where unit-state polling is not (systemd
// garbage-collects successful transient units immediately).
func (d *Daemon) waitPrep(ctx context.Context, prepName, workspace string, ticket *wire.ExecutionTicket) error {
	reported := "/sys/fs/cgroup/system.slice/" + prepName
	if p, err := d.cfg.Sysd.CgroupPath(ctx, prepName); err == nil && p != "" {
		reported = p
	}
	cgroupPath := d.cgroupReadPath(reported)
	timeout := time.Duration(ticket.Resources.WallTimeMs) * time.Millisecond
	if err := cgroupx.WaitEmpty(ctx, cgroupPath, timeout, 250*time.Millisecond); err != nil {
		return fmt.Errorf("prep did not settle: %w", err)
	}
	raw, err := os.ReadFile(filepath.Join(workspace, runner.PrepResultFile))
	if err != nil {
		return fmt.Errorf("prep result missing after settlement: %w", err)
	}
	result := strings.TrimSpace(string(raw))
	if result != "ok" {
		return errors.New("prep " + strings.TrimPrefix(result, "failed: "))
	}
	return nil
}

// verifyTicket runs every pre-journal check on a decoded ticket. It returns
// a ready-to-send error response, or nil when the ticket is acceptable.
func (d *Daemon) verifyTicket(ticket *wire.ExecutionTicket) *wire.IPCResponse {
	if err := ticket.Verify(d.cfg.KeyRing.PublicKeys()...); err != nil {
		r := errResp("verification_failed", "coordinator signature invalid")
		return &r
	}
	if ticket.HelperInstanceID != d.cfg.InstanceID {
		r := errResp("verification_failed", "ticket is bound to a different helper instance")
		return &r
	}
	if ticket.ExecutionServiceID != d.cfg.Policy.ExecutionServiceID {
		r := errResp("policy_violation", "executionServiceId mismatch")
		return &r
	}
	now := d.cfg.Clock.WallNow()
	if ticket.ServerIssuedAt.After(now.Add(maxClockSkew)) {
		r := errResp("verification_failed", "ticket issued in the future")
		return &r
	}
	if !now.Before(ticket.LeaseExpiresAt) {
		r := errResp("verification_failed", "ticket lease already expired")
		return &r
	}
	if !now.Before(ticket.JobDeadlineAt) {
		r := errResp("verification_failed", "ticket job deadline passed")
		return &r
	}
	if ticket.MinimumHelperProtocol > wire.HelperProtocol {
		r := errResp("policy_violation", "helper protocol too old")
		return &r
	}
	if ticket.MinimumPolicyEpoch > d.cfg.Policy.PolicyEpoch {
		r := errResp("policy_violation", "policy epoch too old")
		return &r
	}
	if !contains(d.cfg.Policy.ExecutorProfileIDs, ticket.ExecutorProfileID) {
		r := errResp("policy_violation", "executor profile not in registry")
		return &r
	}
	if !contains(d.cfg.Policy.SandboxProfileIDs, ticket.SandboxProfileID) {
		r := errResp("policy_violation", "sandbox profile not in registry")
		return &r
	}
	if !contains(d.cfg.Policy.NetworkProfileIDs, ticket.NetworkProfileID) {
		r := errResp("policy_violation", "network profile not in registry")
		return &r
	}
	return nil
}

// methodRenew applies a coordinator-signed LeaseUpdateV1.
func (d *Daemon) methodRenew(ctx context.Context, req *wire.IPCRequest) wire.IPCResponse {
	updateVal, err := req.Params.Raw("leaseUpdate")
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	updateBytes, err := encodeMember(updateVal)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	update, err := wire.DecodeLeaseUpdate(updateBytes)
	if err != nil {
		return errResp("invalid_update", err.Error())
	}
	if err := update.Verify(d.cfg.KeyRing.PublicKeys()...); err != nil {
		return errResp("verification_failed", "coordinator signature invalid")
	}
	if update.HelperInstanceID != d.cfg.InstanceID {
		return errResp("verification_failed", "lease update bound to a different helper instance")
	}
	d.mu.Lock()
	js, ok := d.jobs[update.TicketID]
	d.mu.Unlock()
	if !ok {
		return errResp("not_found", "unknown ticket")
	}
	// Binding checks against the journaled ticket.
	t := js.ticket
	if update.JobID != t.JobID || update.Attempt != t.Attempt || update.LeaseID != t.LeaseID {
		return errResp("verification_failed", "lease update binding mismatch")
	}
	if update.LeaseExpiresAt.After(t.JobDeadlineAt) {
		return errResp("verification_failed", "lease extension beyond job deadline")
	}
	now := d.cfg.Clock.WallNow()
	if update.ServerIssuedAt.After(now.Add(maxClockSkew)) {
		return errResp("verification_failed", "lease update issued in the future")
	}
	dup, err := d.keeper.Accept(update.TicketID, update.LeaseSequence, update.LeaseExpiresAt, update.Cancelled, updateBytes)
	if err != nil {
		switch {
		case errors.Is(err, leaseclock.ErrStaleSequence):
			return errResp("lease_stale", "lease sequence must strictly increase")
		case errors.Is(err, leaseclock.ErrSequenceConflict):
			return errResp("conflict", "equal sequence with different content")
		case errors.Is(err, leaseclock.ErrUnknownLease):
			return errResp("not_found", "no active lease for ticket")
		}
		return errResp("internal", err.Error())
	}
	if update.Cancelled && !dup {
		d.keeper.Remove(update.TicketID)
		d.stopJob(ctx, js, "cancelled")
	}
	return okResp(map[string]any{
		"accepted":       true,
		"duplicate":      dup,
		"leaseSequence":  update.LeaseSequence,
		"leaseExpiresAt": wire.FormatTimestamp(update.LeaseExpiresAt),
		"cancelled":      update.Cancelled,
	})
}

// methodStop is always accepted: it only reduces authority.
func (d *Daemon) methodStop(ctx context.Context, req *wire.IPCRequest) wire.IPCResponse {
	ticketID, err := req.Params.Str("ticketId", wire.TicketIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	d.keeper.Remove(ticketID)
	d.mu.Lock()
	js, ok := d.jobs[ticketID]
	d.mu.Unlock()
	if ok && !js.settled {
		d.stopJob(ctx, js, "stop-requested")
	}
	return okResp(map[string]any{"stopping": true, "known": ok})
}

// methodStatus reports daemon and per-ticket state.
func (d *Daemon) methodStatus(req *wire.IPCRequest) wire.IPCResponse {
	ticketID, err := req.Params.OptionalStr("ticketId", wire.TicketIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if ticketID != "" {
		js, ok := d.jobs[ticketID]
		if !ok {
			return errResp("not_found", "unknown ticket")
		}
		return okResp(map[string]any{"ticket": statusOf(js)})
	}
	tickets := map[string]any{}
	for id, js := range d.jobs {
		tickets[id] = statusOf(js)
	}
	return okResp(map[string]any{
		"helperInstanceId": d.cfg.InstanceID,
		"quarantined":      d.quarantined,
		"tickets":          tickets,
	})
}

func statusOf(js *jobState) map[string]any {
	state := "committed"
	if js.started {
		state = "started"
	}
	if js.settled {
		state = "settled"
	}
	return map[string]any{
		"ticketId":  js.ticket.TicketID,
		"jobId":     js.ticket.JobID,
		"attempt":   js.ticket.Attempt,
		"state":     state,
		"unitName":  js.unitName,
		"exitKnown": js.exitKnown,
	}
}

// methodSettle stops the unit if needed, proves the cgroup empty, and signs
// a termination receipt. It never signs while the cgroup is populated.
func (d *Daemon) methodSettle(ctx context.Context, req *wire.IPCRequest) wire.IPCResponse {
	ticketID, err := req.Params.Str("ticketId", wire.TicketIDPattern)
	if err != nil {
		return errResp("invalid_params", err.Error())
	}
	if err := req.Params.Done(); err != nil {
		return errResp("invalid_params", err.Error())
	}
	d.mu.Lock()
	js, ok := d.jobs[ticketID]
	d.mu.Unlock()
	if !ok {
		return errResp("not_found", "unknown ticket")
	}
	js.settleMu.Lock()
	defer js.settleMu.Unlock()

	// Idempotent: return the existing termination receipt.
	if b, err := d.jr.ReadReceipt(ticketID, journal.ReceiptTermination); err == nil {
		rec, err := wire.DecodeTerminationReceipt(b)
		if err != nil {
			return errResp("internal", "stored termination receipt undecodable")
		}
		return okResp(map[string]any{"receipt": rec.Map(), "duplicate": true})
	}

	// Observe the unit before acting: if it already exited on its own,
	// record its result instead of imposing our own reason.
	d.observeUnit(ctx, js)
	// Stop the unit if it may still be running.
	if js.started && !js.exitKnown {
		d.stopJob(ctx, js, firstNonEmpty(js.stopReason, "stop-requested"))
	}

	// Resolve the cgroup path (the systemd-reported identity recorded in the
	// receipt) and its local read path.
	cgpath := js.cgroupPath
	if cgpath == "" && js.unitName != "" {
		if p, err := d.cfg.Sysd.CgroupPath(ctx, js.unitName); err == nil {
			cgpath = p
		}
	}
	if cgpath == "" {
		cgpath = "/sys/fs/cgroup/system.slice/" + js.unitName
	}
	readPath := d.cgroupReadPath(cgpath)

	// Prove the cgroup empty. If it stays populated, kill it once and wait
	// again; a cgroup that still will not empty quarantines the daemon.
	settleErr := d.waitEmpty(ctx, readPath, d.cfg.SettleTimeout)
	if errors.Is(settleErr, cgroupx.ErrNotEmpty) {
		d.logf.Printf("settle %s: cgroup still populated; issuing cgroup.kill", ticketID)
		if err := cgroupx.Kill(readPath); err != nil {
			d.logf.Printf("settle %s: cgroup.kill: %v", ticketID, err)
		}
		settleErr = d.waitEmpty(ctx, readPath, d.cfg.SettleKillTimeout)
	}
	if settleErr != nil {
		if errors.Is(settleErr, cgroupx.ErrNotEmpty) {
			d.mu.Lock()
			d.quarantined = true
			d.mu.Unlock()
			return errResp("busy", "job cgroup not empty; daemon quarantined")
		}
		return errResp("internal", settleErr.Error())
	}

	acct, err := cgroupx.ReadAccounting(readPath)
	if err != nil {
		acct = wire.ResourceAccounting{}
	}
	d.mu.Lock()
	reason := js.stopReason
	if reason == "" {
		if js.started {
			reason = "exited"
		} else {
			// Never launched (e.g. start failed after journaling): no
			// process ever ran, so there is no exit status to report.
			reason = "failed"
		}
	}
	exitStatus := js.exitStatus
	if !js.started {
		exitStatus = -1
	}
	d.mu.Unlock()
	// The runner records the command's exit code in the workspace before
	// exiting; that marker (read after the cgroup is empty) is authoritative
	// because systemd garbage-collects successful units before we can read
	// their ExecMainStatus.
	if js.started {
		if raw, err := os.ReadFile(filepath.Join(d.cfg.JobsDir, ticketID, runner.JobResultFile)); err == nil {
			if code, perr := strconv.Atoi(strings.TrimSpace(string(raw))); perr == nil && code >= -1 && code <= 255 {
				exitStatus = int64(code)
			}
		}
	}
	var highestSeq int64
	if l, ok := d.keeper.Get(ticketID); ok {
		highestSeq = l.HighestSequence
	} else {
		highestSeq = js.ticket.LeaseSequence
	}
	bootNow, _ := d.cfg.Clock.BoottimeNow()
	receipt := &wire.TerminationReceipt{
		TicketID:              js.ticket.TicketID,
		JobID:                 js.ticket.JobID,
		Attempt:               js.ticket.Attempt,
		LeaseID:               js.ticket.LeaseID,
		HelperInstanceID:      d.cfg.InstanceID,
		HighestLeaseSequence:  highestSeq,
		ExitStatus:            exitStatus,
		TerminationReason:     reason,
		UnitName:              js.unitName,
		CgroupPath:            cgpath,
		Populated:             false,
		Accounting:            acct,
		FinishedAt:            d.cfg.Clock.WallNow(),
		FinishedAtMonotonicMs: bootNow.Milliseconds(),
	}
	if err := receipt.Sign(d.cfg.HelperKey); err != nil {
		return errResp("internal", err.Error())
	}
	raw, err := receipt.Marshal()
	if err != nil {
		return errResp("internal", err.Error())
	}
	if err := d.jr.WriteReceipt(ticketID, journal.ReceiptTermination, raw); err != nil {
		return errResp("internal", err.Error())
	}
	d.keeper.Remove(ticketID)
	d.mu.Lock()
	js.settled = true
	d.mu.Unlock()
	return okResp(map[string]any{"receipt": receipt.Map(), "duplicate": false})
}

// waitEmpty waits for cgroup settlement, treating a vanished cgroup as empty.
func (d *Daemon) waitEmpty(ctx context.Context, cgpath string, timeout time.Duration) error {
	return cgroupx.WaitEmpty(ctx, cgpath, timeout, 50*time.Millisecond)
}

// cgroupReadPath maps a systemd-reported cgroup path to the local filesystem
// path. Production is the identity mapping; CgroupRoot remaps under a test
// tree.
func (d *Daemon) cgroupReadPath(reported string) string {
	if d.cfg.CgroupRoot == "" {
		return reported
	}
	rest := strings.TrimPrefix(reported, "/sys/fs/cgroup/")
	if rest == reported {
		return reported // not a cgroupfs path; use as-is
	}
	return filepath.Join(d.cfg.CgroupRoot, rest)
}

// observeUnit refreshes exit state from systemd for a started job.
func (d *Daemon) observeUnit(ctx context.Context, js *jobState) {
	if !js.started || js.exitKnown || js.unitName == "" {
		return
	}
	st, err := d.cfg.Sysd.GetUnitState(ctx, js.unitName)
	if err != nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	switch {
	case st.Gone():
		js.exitKnown = true
	case !st.Active():
		js.exitKnown = true
		js.exitStatus = int64(st.ExecMainStatus)
		if js.stopReason == "" {
			js.stopReason = reasonFromUnitResult(st.Result)
		}
	}
}

// jobFor returns (creating if needed) the job state for a ticket.
func (d *Daemon) jobFor(ticket *wire.ExecutionTicket, create bool) *jobState {
	d.mu.Lock()
	defer d.mu.Unlock()
	js, ok := d.jobs[ticket.TicketID]
	if !ok && create {
		js = &jobState{
			ticket:     ticket,
			unitName:   sysd.UnitName(ticket.TicketID),
			exitStatus: -1,
		}
		d.jobs[ticket.TicketID] = js
	}
	return js
}

func firstNonEmpty(s, fallback string) string {
	if s != "" {
		return s
	}
	return fallback
}

// encodeMember re-canonicalizes a decoded value. Because the value came
// through the strict canonical parser, re-encoding reproduces the exact
// signed bytes.
func encodeMember(v any) ([]byte, error) {
	return canon.Encode(v)
}
