package agent

import (
	"context"
	"errors"
	"io"
	"log"
	"sync"
	"testing"
	"time"
)

// fakeCoordinator scripts coordinator responses.
type fakeCoordinator struct {
	mu     sync.Mutex
	calls  []string
	doFunc func(action string, payload any) (any, error)
}

func (f *fakeCoordinator) Do(_ context.Context, action string, payload any) (any, error) {
	f.mu.Lock()
	f.calls = append(f.calls, action)
	f.mu.Unlock()
	return f.doFunc(action, payload)
}

func (f *fakeCoordinator) callLog() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.calls...)
}

// fakeDaemon scripts the local daemon.
type fakeDaemon struct {
	mu     sync.Mutex
	calls  []string
	states map[string]map[string]any
}

func (f *fakeDaemon) Call(method string, params map[string]any) (map[string]any, error) {
	f.mu.Lock()
	f.calls = append(f.calls, method)
	f.mu.Unlock()
	switch method {
	case "publicKey":
		return map[string]any{
			"publicKeySpki":      "MCowBQYDK2VwAyEAA6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg",
			"keyId":              "sha256:oFCDfYUHBYLM9zlLCYiEfMMSy4glm4lImfbyOc8XkaU",
			"helperInstanceId":   "hi_0123456789abcdef0123456789abcdef",
			"executionServiceId": testServiceID,
			"policyEpoch":        int64(1),
			"helperBuildId":      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			"runnerBuildId":      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		}, nil
	case "attest":
		return map[string]any{"attestation": map[string]any{"domain": "statskey.fleet.helper-attestation.v1"}}, nil
	case "start":
		return map[string]any{"receipt": map[string]any{"domain": "statskey.fleet.execution-started-receipt.v1"}, "duplicate": false}, nil
	case "renew":
		return map[string]any{"accepted": true, "duplicate": false}, nil
	case "stop":
		return map[string]any{"stopping": true}, nil
	case "settle":
		return map[string]any{"receipt": map[string]any{
			"terminationReason": "exited",
			"exitStatus":        int64(0),
			"populated":         false,
		}}, nil
	case "status":
		ticketID, _ := params["ticketId"].(string)
		f.mu.Lock()
		st := f.states[ticketID]
		f.mu.Unlock()
		if st == nil {
			st = map[string]any{"state": "started", "exitKnown": false}
		}
		return map[string]any{"ticket": st}, nil
	}
	return nil, errors.New("unknown method")
}

func testLogger() *log.Logger { return log.New(io.Discard, "", 0) }

const (
	testDeviceID  = "dev_0123456789abcdef0123456789abcdef"
	testServiceID = "svc_0123456789abcdef0123456789abcdef"
	testTicketID  = "ticket_0123456789abcdef0123456789abcdef"
	testJobID     = "job_0123456789abcdef0123456789abcdef"
)

func newTestAgent(t *testing.T, coord *fakeCoordinator, dm *fakeDaemon) *Agent {
	t.Helper()
	a, err := New(Config{
		DeviceID:           testDeviceID,
		ExecutionServiceID: testServiceID,
		Coordinator:        coord,
		Daemon:             dm,
		PollIntervalMs:     10,
		LeaseTTLMs:         3000,
		StatusPollMs:       20,
		Logger:             testLogger(),
		randomHex:          func(n int) string { return "0123456789abcdef0123456789abcdef"[:n*2] },
		randomToken:        func(n int) string { return "dG9rZW4" },
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func claimResult() map[string]any {
	return map[string]any{
		"job": map[string]any{"id": testJobID, "deadlineAt": "2026-08-19T21:00:00.000Z"},
		"lease": map[string]any{
			"id":        "lease_0123456789abcdef0123456789abcdef",
			"nonce":     "dG9rZW4",
			"jobId":     testJobID,
			"deviceId":  testDeviceID,
			"attempt":   int64(1),
			"expiresAt": "2026-08-19T20:05:00.000Z",
		},
		"executionTicket": map[string]any{"ticketId": testTicketID},
	}
}

func TestHappyPath(t *testing.T) {
	coord := &fakeCoordinator{}
	dm := &fakeDaemon{states: map[string]map[string]any{}}
	polls := 0
	coord.doFunc = func(action string, payload any) (any, error) {
		switch action {
		case "helper.bind":
			return map[string]any{"ok": true}, nil
		case "heartbeat":
			return map[string]any{"ok": true}, nil
		case "helper.challenge":
			return map[string]any{"challengeId": "chal_0123456789abcdef0123456789abcdef", "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, nil
		case "helper.attest":
			return map[string]any{"accepted": true}, nil
		case "job.poll":
			polls++
			if polls == 1 {
				return map[string]any{"assignment": map[string]any{"jobId": testJobID, "grantId": "grant_1"}}, nil
			}
			return map[string]any{}, nil
		case "job.claim":
			return claimResult(), nil
		case "job.event":
			return map[string]any{"sequence": int64(1)}, nil
		case "lease.renew":
			// After the first renewal, the job exits.
			dm.mu.Lock()
			dm.states[testTicketID] = map[string]any{"state": "started", "exitKnown": true}
			dm.mu.Unlock()
			return map[string]any{"leaseId": "lease_0123456789abcdef0123456789abcdef", "expiresAt": "2026-08-19T20:10:00.000Z"}, nil
		case "job.transition":
			return map[string]any{"ok": true}, nil
		}
		return nil, errors.New("unexpected action " + action)
	}

	a := newTestAgent(t, coord, dm)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Run one assignment in the background; cancel after transition.
	go func() {
		for {
			time.Sleep(50 * time.Millisecond)
			for _, c := range coord.callLog() {
				if c == "job.transition" {
					cancel()
				}
			}
		}
	}()
	a.Run(ctx)

	calls := coord.callLog()
	wantOrder := []string{"helper.bind", "helper.challenge", "helper.attest", "heartbeat", "job.poll", "job.claim", "job.event", "job.transition"}
	pos := 0
	for _, c := range calls {
		if pos < len(wantOrder) && c == wantOrder[pos] {
			pos++
		}
	}
	if pos != len(wantOrder) {
		t.Fatalf("call order missing steps (%d/%d): %v", pos, len(wantOrder), calls)
	}
	// Daemon saw attest, start, settle.
	dm.mu.Lock()
	defer dm.mu.Unlock()
	seen := map[string]bool{}
	for _, c := range dm.calls {
		seen[c] = true
	}
	for _, m := range []string{"attest", "start", "settle"} {
		if !seen[m] {
			t.Fatalf("daemon method %s never called: %v", m, dm.calls)
		}
	}
}

func TestAttestationRefreshesBeforeExpiry(t *testing.T) {
	coord := &fakeCoordinator{}
	dm := &fakeDaemon{states: map[string]map[string]any{}}
	attestCalls := 0
	coord.doFunc = func(action string, payload any) (any, error) {
		switch action {
		case "helper.bind":
			return map[string]any{"ok": true}, nil
		case "heartbeat":
			return map[string]any{"ok": true}, nil
		case "helper.challenge":
			return map[string]any{"challengeId": "chal_0123456789abcdef0123456789abcdef", "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, nil
		case "helper.attest":
			attestCalls++
			// A 3-second attestation forces a refresh almost immediately.
			return map[string]any{"accepted": true, "expiresAt": time.Now().Add(3 * time.Second).UTC().Format(time.RFC3339)}, nil
		case "job.poll":
			return map[string]any{}, nil
		}
		return nil, errors.New("unexpected action " + action)
	}

	a := newTestAgent(t, coord, dm)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	a.Run(ctx)

	if attestCalls < 2 {
		t.Fatalf("attestation never refreshed: %d call(s)", attestCalls)
	}
}

func TestClaimBindingRejected(t *testing.T) {
	coord := &fakeCoordinator{}
	dm := &fakeDaemon{states: map[string]map[string]any{}}
	coord.doFunc = func(action string, payload any) (any, error) {
		switch action {
		case "helper.bind":
			return map[string]any{"ok": true}, nil
		case "heartbeat":
			return map[string]any{"ok": true}, nil
		case "helper.challenge":
			return map[string]any{"challengeId": "chal_0123456789abcdef0123456789abcdef", "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, nil
		case "helper.attest":
			return map[string]any{"accepted": true}, nil
		case "job.poll":
			return map[string]any{"assignment": map[string]any{"jobId": testJobID, "grantId": "grant_1"}}, nil
		case "job.claim":
			bad := claimResult()
			bad["lease"].(map[string]any)["nonce"] = "tampered"
			return bad, nil
		}
		return nil, errors.New("unexpected " + action)
	}
	a := newTestAgent(t, coord, dm)
	idle, err := a.pollOnce(context.Background())
	if err == nil {
		t.Fatal("accepted tampered claim")
	}
	if idle != 0 {
		t.Fatalf("idle = %d", idle)
	}
	// The daemon must never see a start for a mismatched claim.
	dm.mu.Lock()
	defer dm.mu.Unlock()
	for _, c := range dm.calls {
		if c == "start" {
			t.Fatal("daemon start called for tampered claim")
		}
	}
}

func TestPollBackoffAndRecovery(t *testing.T) {
	coord := &fakeCoordinator{}
	dm := &fakeDaemon{states: map[string]map[string]any{}}
	attempts := 0
	coord.doFunc = func(action string, payload any) (any, error) {
		switch action {
		case "helper.bind":
			return map[string]any{"ok": true}, nil
		case "heartbeat":
			return map[string]any{"ok": true}, nil
		case "helper.challenge":
			return map[string]any{"challengeId": "chal_0123456789abcdef0123456789abcdef", "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, nil
		case "helper.attest":
			return map[string]any{"accepted": true}, nil
		case "job.poll":
			attempts++
			if attempts < 3 {
				return nil, &netError{msg: "offline"}
			}
			return map[string]any{}, nil // idle
		}
		return nil, errors.New("unexpected " + action)
	}
	a := newTestAgent(t, coord, dm)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	a.Run(ctx)
	if attempts < 3 {
		t.Fatalf("expected retries, got %d attempts", attempts)
	}
}

type netError struct{ msg string }

func (e *netError) Error() string { return e.msg }

func TestCancellationForwarding(t *testing.T) {
	coord := &fakeCoordinator{}
	dm := &fakeDaemon{states: map[string]map[string]any{}}
	transitioned := false
	coord.doFunc = func(action string, payload any) (any, error) {
		switch action {
		case "helper.bind":
			return map[string]any{"ok": true}, nil
		case "heartbeat":
			return map[string]any{"ok": true}, nil
		case "helper.challenge":
			return map[string]any{"challengeId": "chal_0123456789abcdef0123456789abcdef", "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, nil
		case "helper.attest":
			return map[string]any{"accepted": true}, nil
		case "job.poll":
			if transitioned {
				return map[string]any{}, nil
			}
			return map[string]any{"assignment": map[string]any{"jobId": testJobID, "grantId": "grant_1"}}, nil
		case "job.claim":
			return claimResult(), nil
		case "job.event":
			return map[string]any{"sequence": int64(1)}, nil
		case "lease.renew":
			// Signed LeaseUpdateV1 with cancelled=true.
			return map[string]any{
				"leaseId": "lease_0123456789abcdef0123456789abcdef",
				"leaseUpdate": map[string]any{
					"cancelled":     true,
					"leaseSequence": int64(1),
				},
			}, nil
		case "job.transition":
			state := payload.(map[string]any)["state"]
			// Intermediate states (preparing/running) precede the terminal
			// one; only the terminal transition must be "cancelled".
			if state == "cancelled" || state == "failed" || state == "succeeded" || state == "timed_out" {
				if state != "cancelled" {
					t.Errorf("terminal state = %v, want cancelled", state)
				}
				transitioned = true
			}
			return map[string]any{"ok": true}, nil
		}
		return nil, errors.New("unexpected " + action)
	}
	a := newTestAgent(t, coord, dm)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() {
		for {
			time.Sleep(50 * time.Millisecond)
			if transitioned {
				cancel()
				return
			}
		}
	}()
	a.Run(ctx)
	// The daemon must have received the signed renewal.
	dm.mu.Lock()
	defer dm.mu.Unlock()
	seenRenew := false
	for _, c := range dm.calls {
		if c == "renew" {
			seenRenew = true
		}
	}
	if !seenRenew {
		t.Fatalf("daemon renew not called: %v", dm.calls)
	}
}
