package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// executeAssignment runs one claimed job to settlement and reports the
// terminal state with the termination receipt.
func (a *Agent) executeAssignment(ctx context.Context, assignment map[string]any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	jobID, _ := assignment["jobId"].(string)
	grantID, _ := assignment["grantId"].(string)
	if jobID == "" || grantID == "" {
		return errors.New("agent: assignment invalid")
	}
	leaseID := "lease_" + a.cfg.randomHex(16)
	leaseNonce := a.cfg.randomToken(32)
	claim, err := a.cfg.Coordinator.Do(ctx, "job.claim", map[string]any{
		"jobId":      jobID,
		"grantId":    grantID,
		"leaseId":    leaseID,
		"leaseNonce": leaseNonce,
		"ttlMs":      a.cfg.LeaseTTLMs,
	})
	if err != nil {
		return fmt.Errorf("agent: claim: %w", err)
	}
	claimMap, ok := claim.(map[string]any)
	if !ok {
		return errors.New("agent: claim response invalid")
	}
	job, _ := claimMap["job"].(map[string]any)
	lease, _ := claimMap["lease"].(map[string]any)
	ticket, _ := claimMap["executionTicket"].(map[string]any)
	if job == nil || lease == nil || ticket == nil {
		return errors.New("agent: claim response missing job, lease, or execution ticket")
	}
	// Binding checks (as in the desktop supervisor): the claim must answer
	// this exact request.
	if job["id"] != jobID || lease["id"] != leaseID || lease["nonce"] != leaseNonce ||
		lease["jobId"] != jobID || lease["deviceId"] != a.cfg.DeviceID {
		return errors.New("agent: claim response did not match the signed request")
	}
	ticketID, _ := ticket["ticketId"].(string)
	if ticketID == "" {
		return errors.New("agent: execution ticket missing ticketId")
	}

	a.mu.Lock()
	a.active = ticketID
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.active = ""
		a.mu.Unlock()
	}()

	// The coordinator's state machine only allows leased → preparing →
	// running → terminal. Move to preparing before touching the daemon.
	if _, err := a.transition(ctx, jobID, leaseID, leaseNonce, "preparing", nil); err != nil {
		return fmt.Errorf("agent: transition to preparing: %w", err)
	}

	// Start through the daemon (verifies, journals, starts the unit). The
	// fetch phase inside start can outlive the initial lease TTL, so the
	// coordinator lease is renewed concurrently while start is in flight;
	// daemon-side renewal forwards once the daemon has established the ticket
	// (at the top of start, before the fetch).
	startRes, startErr := a.startWithRenewal(ctx, ticket, ticketID, leaseID, leaseNonce)
	if startErr != nil {
		err := startErr
		a.log.Printf("daemon start refused for %s: %v; settling", ticketID, err)
		settleRes, serr := a.cfg.Daemon.Call("settle", map[string]any{"ticketId": ticketID})
		if serr != nil {
			return fmt.Errorf("agent: daemon start: %v; settle: %w", err, serr)
		}
		termReceipt, _ := settleRes["receipt"].(map[string]any)
		if _, terr := a.cfg.Coordinator.Do(ctx, "job.transition", map[string]any{
			"jobId":              jobID,
			"leaseId":            leaseID,
			"nonce":              leaseNonce,
			"state":              "failed",
			"transitionId":       "op_" + a.cfg.randomHex(16),
			"terminationReceipt": termReceipt,
		}); terr != nil {
			a.log.Printf("job.transition after start refusal: %v", terr)
		}
		return fmt.Errorf("agent: daemon start: %w", err)
	}
	startReceipt, _ := startRes["receipt"].(map[string]any)

	// The job is running: publish the start event (coordinator event types
	// are allowlisted) and move leased → preparing → running.
	if _, err := a.cfg.Coordinator.Do(ctx, "job.event", map[string]any{
		"jobId":   jobID,
		"leaseId": leaseID,
		"nonce":   leaseNonce,
		"event": map[string]any{
			"sequence": int64(1),
			"type":     "process-start",
			"payload":  map[string]any{"receipt": startReceipt},
		},
	}); err != nil {
		a.log.Printf("job.event process-start: %v", err)
	}
	if _, err := a.transition(ctx, jobID, leaseID, leaseNonce, "running", nil); err != nil {
		return fmt.Errorf("agent: transition to running: %w", err)
	}

	// Renew until the job ends or authority is lost.
	cancelled, runErr := a.renewLoop(ctx, ticketID, leaseID, leaseNonce, jobID)

	// Settle: prove the cgroup empty and get the termination receipt.
	settleRes, err := a.cfg.Daemon.Call("settle", map[string]any{"ticketId": ticketID})
	if err != nil {
		return fmt.Errorf("agent: daemon settle: %w", err)
	}
	termReceipt, _ := settleRes["receipt"].(map[string]any)

	// Report the terminal state with the termination receipt.
	state := terminalState(termReceipt, cancelled, runErr)
	_, err = a.cfg.Coordinator.Do(ctx, "job.transition", map[string]any{
		"jobId":              jobID,
		"leaseId":            leaseID,
		"nonce":              leaseNonce,
		"state":              state,
		"transitionId":       "op_" + a.cfg.randomHex(16),
		"terminationReceipt": termReceipt,
	})
	if err != nil {
		return fmt.Errorf("agent: job.transition: %w", err)
	}
	return runErr
}

// transition posts a job.transition with an idempotent operation ID. The
// receipt, when present, is the helper-signed termination proof.
func (a *Agent) transition(ctx context.Context, jobID, leaseID, leaseNonce, state string, termReceipt map[string]any) (any, error) {
	payload := map[string]any{
		"jobId":        jobID,
		"leaseId":      leaseID,
		"nonce":        leaseNonce,
		"state":        state,
		"transitionId": "op_" + a.cfg.randomHex(16),
	}
	if termReceipt != nil {
		payload["terminationReceipt"] = termReceipt
	}
	return a.cfg.Coordinator.Do(ctx, "job.transition", payload)
}

// startWithRenewal calls the daemon's blocking start (fetch + launch) while
// renewing the coordinator lease concurrently, so a long fetch cannot expire
// the lease out from under the job.
func (a *Agent) startWithRenewal(ctx context.Context, ticket map[string]any, ticketID, leaseID, leaseNonce string) (map[string]any, error) {
	type outcome struct {
		res map[string]any
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := a.cfg.Daemon.Call("start", map[string]any{"ticket": ticket})
		done <- outcome{res, err}
	}()
	renewEvery := time.Duration(a.cfg.LeaseTTLMs/3) * time.Millisecond
	if renewEvery < time.Second {
		renewEvery = time.Second
	}
	tick := time.NewTicker(renewEvery)
	defer tick.Stop()
	for {
		select {
		case out := <-done:
			return out.res, out.err
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-tick.C:
			// Renewal failures during the start window are tolerated (the
			// coordinator lease has its own TTL grace); daemon-side
			// forwarding works once start has established the ticket.
			if _, err := a.renewOnce(ctx, ticketID, leaseID, leaseNonce); err != nil {
				a.log.Printf("lease.renew during start: %v", err)
			}
		}
	}
}

// renewOnce performs one coordinator lease renewal and forwards a signed
// LeaseUpdateV1 to the daemon when present. It returns cancelled=true when
// the coordinator reports cancellation.
func (a *Agent) renewOnce(ctx context.Context, ticketID, leaseID, leaseNonce string) (bool, error) {
	res, err := a.cfg.Coordinator.Do(ctx, "lease.renew", map[string]any{
		"leaseId": leaseID,
		"nonce":   leaseNonce,
		"ttlMs":   a.cfg.LeaseTTLMs,
	})
	if err != nil {
		return false, err
	}
	m, ok := res.(map[string]any)
	if !ok || m["leaseId"] != leaseID {
		return false, errors.New("agent: lease renewal acknowledgement invalid")
	}
	if update, ok := m["leaseUpdate"].(map[string]any); ok {
		if _, err := a.cfg.Daemon.Call("renew", map[string]any{"leaseUpdate": update}); err != nil {
			return false, fmt.Errorf("agent: daemon renew: %w", err)
		}
		if c, _ := update["cancelled"].(bool); c {
			return true, nil
		}
	} else if c, _ := m["cancellationRequested"].(bool); c {
		if _, err := a.cfg.Daemon.Call("stop", map[string]any{"ticketId": ticketID}); err != nil {
			a.log.Printf("daemon stop after cancellation: %v", err)
		}
		return true, nil
	}
	return false, nil
}

// renewLoop renews the lease (forwarding signed LeaseUpdateV1s to the
// daemon) and watches the job state. It returns when the job exits, the
// lease is cancelled, or renewal fails.
func (a *Agent) renewLoop(ctx context.Context, ticketID, leaseID, leaseNonce, jobID string) (cancelled bool, err error) {
	renewEvery := time.Duration(a.cfg.LeaseTTLMs/3) * time.Millisecond
	if renewEvery < time.Second {
		renewEvery = time.Second
	}
	renewTick := time.NewTicker(renewEvery)
	defer renewTick.Stop()
	statusTick := time.NewTicker(time.Duration(a.cfg.StatusPollMs) * time.Millisecond)
	defer statusTick.Stop()

	// Tolerate transient renewal failures; the daemon's boottime lease timer
	// is the hard backstop. Three consecutive failures (or any daemon-side
	// rejection, which is never transient) end the job.
	var consecutiveRenewFailures int
	const maxRenewFailures = 3

	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-renewTick.C:
			cancelledNow, err := a.renewOnce(ctx, ticketID, leaseID, leaseNonce)
			if err != nil {
				consecutiveRenewFailures++
				a.log.Printf("lease.renew failed (%d/%d): %v", consecutiveRenewFailures, maxRenewFailures, err)
				if consecutiveRenewFailures >= maxRenewFailures {
					return false, fmt.Errorf("agent: lease.renew: %w", err)
				}
				continue
			}
			consecutiveRenewFailures = 0
			if cancelledNow {
				return true, nil
			}
		case <-statusTick.C:
			res, err := a.cfg.Daemon.Call("status", map[string]any{"ticketId": ticketID})
			if err != nil {
				continue // transient; the daemon owns the lease timer
			}
			tk, _ := res["ticket"].(map[string]any)
			if tk == nil {
				return false, errors.New("agent: daemon lost the ticket")
			}
			if exited, _ := tk["exitKnown"].(bool); exited {
				return false, nil
			}
			if state, _ := tk["state"].(string); state == "settled" {
				return false, nil
			}
		}
	}
}

// terminalState maps the termination receipt to a coordinator state. A
// mid-job authority/renewal error is a failure even when the receipt's
// process exit was clean — the job did not run to sanctioned completion.
func terminalState(receipt map[string]any, cancelled bool, runErr error) string {
	if cancelled {
		return "cancelled"
	}
	if runErr != nil && !errors.Is(runErr, context.Canceled) {
		return "failed"
	}
	reason, _ := receipt["terminationReason"].(string)
	switch reason {
	case "exited":
		if es, _ := receipt["exitStatus"].(int64); es == 0 {
			return "succeeded"
		}
		return "failed"
	default:
		return "failed"
	}
}

// shutdownActive settles any active job during graceful shutdown.
func (a *Agent) shutdownActive() {
	a.mu.Lock()
	ticketID := a.active
	a.mu.Unlock()
	if ticketID == "" {
		return
	}
	if _, err := a.cfg.Daemon.Call("settle", map[string]any{"ticketId": ticketID}); err != nil {
		a.log.Printf("shutdown settle %s: %v", ticketID, err)
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
