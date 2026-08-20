package daemon

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/leaseclock"
	"statskey/fleetd/internal/sysd"
	"statskey/fleetd/internal/wire"
)

const (
	testTicketID  = "ticket_0123456789abcdef0123456789abcdef"
	testJobID     = "job_0123456789abcdef0123456789abcdef"
	testLeaseID   = "lease_0123456789abcdef0123456789abcdef"
	testDeviceID  = "dev_0123456789abcdef0123456789abcdef"
	testDeviceID2 = "dev_fedcba9876543210fedcba9876543210"
	testServiceID = "svc_0123456789abcdef0123456789abcdef"
	testHelperID  = "hi_0123456789abcdef0123456789abcdef"
	testDigestHex = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	testDigestB64 = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	testCommit    = "0123456789abcdef0123456789abcdef01234567"
)

var testStart = time.Date(2026, 8, 19, 20, 0, 0, 0, time.UTC)

type harness struct {
	d          *Daemon
	fake       *sysd.Fake
	clock      *leaseclock.FakeClock
	coordPriv  ed25519.PrivateKey
	helperPriv ed25519.PrivateKey
	dir        string
	cancel     context.CancelFunc
	ln         net.Listener
	client     *Client
	peerUID    atomic.Uint32 // mutable; the fake peer-cred seam reads it
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	// macOS limits unix socket paths to 104 bytes; keep the socket in a
	// short /tmp path rather than the (long) test temp dir.
	sockDir, err := os.MkdirTemp("/tmp", "skfd-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(sockDir) })
	helperPriv, err := keys.Generate()
	if err != nil {
		t.Fatal(err)
	}
	coordPriv, err := keys.Generate()
	if err != nil {
		t.Fatal(err)
	}
	ring, err := wire.NewKeyRing(map[string]ed25519.PublicKey{"coord-1": keys.Public(coordPriv)})
	if err != nil {
		t.Fatal(err)
	}
	fake := sysd.NewFake()
	fake.CgroupRoot = filepath.Join(dir, "cgroup")
	clock := leaseclock.NewFakeClock(testStart)
	h := &harness{fake: fake, clock: clock, coordPriv: coordPriv, helperPriv: helperPriv, dir: dir}
	h.peerUID.Store(501)
	cfg := Config{
		SocketPath:    filepath.Join(sockDir, "c.sock"),
		AgentUID:      501,
		StateDir:      filepath.Join(dir, "state"),
		JobsDir:       filepath.Join(dir, "jobs"),
		RunnerPath:    "/usr/libexec/statskey-fleet-runner",
		HelperKey:     helperPriv,
		InstanceID:    testHelperID,
		KeyRing:       ring,
		Sysd:          fake,
		Clock:         clock,
		BootIDDigest:  testDigestB64,
		HelperBuildID: testDigestHex,
		RunnerBuildID: testDigestHex,
		Platform: wire.PlatformInfo{
			ID: "ubuntu", VersionID: "26.04", Arch: "x86_64",
			KernelRelease: "6.8.0-31-generic", CgroupVersion: 2, SystemdVersion: "257",
		},
		Security: wire.SecurityInfo{
			CgroupKill: true, Delegated: false, AppArmorEnforcing: true,
			AppArmorProfileDigest: testDigestHex,
		},
		Policy: Policy{
			PolicyEpoch:        3,
			ExecutionServiceID: testServiceID,
			Ceilings: wire.ResourceLimits{
				CPUMilli: 4000, MemoryBytes: 8589934592, Pids: 256,
				DiskBytes: 21474836480, WallTimeMs: 3600000,
			},
			ExecutorProfileIDs: []string{"command-v1"},
			SandboxProfileIDs:  []string{"ubuntu-build-v1"},
			NetworkProfileIDs:  []string{"none"},
			AppArmorProfile:    "statskey-fleet-job",
		},
		SettleTimeout:     300 * time.Millisecond,
		SettleKillTimeout: 200 * time.Millisecond,
		CgroupRoot:        fake.CgroupRoot,
	}
	d, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	h.d = d
	d.SetPeerUIDFunc(func(net.Conn) (uint32, error) { return h.peerUID.Load(), nil })
	ln, err := ListenControl(cfg.SocketPath, 0)
	if err != nil {
		t.Fatal(err)
	}
	h.ln = ln
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go d.Serve(ctx, ln)
	h.client = &Client{SocketPath: cfg.SocketPath, Timeout: 10 * time.Second}
	t.Cleanup(func() {
		cancel()
		ln.Close()
	})
	return h
}

// makeTicket builds, signs, and marshals a valid ticket.
func (h *harness) makeTicket(ticketID string, seq int64) map[string]any {
	ticket := &wire.ExecutionTicket{
		TicketID:           ticketID,
		JobRequestDigest:   testDigestHex,
		JobID:              testJobID,
		Attempt:            1,
		LeaseID:            testLeaseID,
		LeaseSequence:      seq,
		GrantReceiptDigest: testDigestHex,
		OwnerUID:           "user_abc",
		WorkerDeviceID:     testDeviceID,
		ControllerDeviceID: testDeviceID2,
		ExecutionServiceID: testServiceID,
		HelperInstanceID:   testHelperID,
		RepositoryIdentity: "github.com/statskey/ci-tests",
		Commit:             testCommit,
		ExecutorProfileID:  "command-v1",
		SandboxProfileID:   "ubuntu-build-v1",
		NetworkProfileID:   "none",
		Command:            wire.CommandSpec{Executable: "node", Arguments: []string{"--version"}, WorkingDirectory: "."},
		Resources: wire.ResourceLimits{
			CPUMilli: 2000, MemoryBytes: 1073741824, Pids: 128,
			DiskBytes: 1073741824, WallTimeMs: 600000,
		},
		ServerIssuedAt:        testStart,
		LeaseExpiresAt:        testStart.Add(5 * time.Minute),
		JobDeadlineAt:         testStart.Add(time.Hour),
		MinimumHelperProtocol: 1,
		MinimumPolicyEpoch:    2,
	}
	if err := ticket.Sign(h.coordPriv); err != nil {
		panic(err)
	}
	return ticket.Map()
}

func (h *harness) makeLeaseUpdate(ticketID string, seq int64, cancelled bool, expires time.Time) map[string]any {
	u := &wire.LeaseUpdate{
		TicketID:         ticketID,
		JobID:            testJobID,
		Attempt:          1,
		LeaseID:          testLeaseID,
		HelperInstanceID: testHelperID,
		LeaseSequence:    seq,
		Cancelled:        cancelled,
		ServerIssuedAt:   h.clock.WallNow(),
		LeaseExpiresAt:   expires,
	}
	if err := u.Sign(h.coordPriv); err != nil {
		panic(err)
	}
	return u.Map()
}

// startJob starts a ticket through the socket and returns the receipt map.
func (h *harness) startJob(t *testing.T, ticketID string) map[string]any {
	t.Helper()
	res, err := h.client.Call("start", map[string]any{"ticket": h.makeTicket(ticketID, 0)})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	rec, ok := res["receipt"].(map[string]any)
	if !ok {
		t.Fatalf("no receipt in %v", res)
	}
	return rec
}

func TestPeerCredAcceptance(t *testing.T) {
	h := newHarness(t)
	// Right UID works.
	res, err := h.client.Call("publicKey", nil)
	if err != nil {
		t.Fatalf("publicKey: %v", err)
	}
	if res["helperInstanceId"] != testHelperID {
		t.Fatalf("bad instance id: %v", res)
	}
	if !strings.HasPrefix(res["keyId"].(string), "sha256:") {
		t.Fatalf("bad key id: %v", res["keyId"])
	}
	// Wrong UID is rejected before any method runs.
	h.peerUID.Store(502)
	if _, err := h.client.Call("publicKey", nil); err == nil {
		t.Fatal("wrong UID accepted")
	} else {
		var ce *CallError
		if errors.As(err, &ce) && ce.Code != "unauthorized" {
			t.Fatalf("wrong error code: %v", ce)
		}
	}
	// Root (uid 0) is not the agent either.
	h.peerUID.Store(0)
	if _, err := h.client.Call("publicKey", nil); err == nil {
		t.Fatal("uid 0 accepted")
	}
}

func TestFrameBounds(t *testing.T) {
	h := newHarness(t)
	conn, err := net.Dial("unix", h.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	// Declared length above 64 KiB must be rejected.
	if _, err := conn.Write([]byte{0, 1, 0, 1}); err != nil {
		t.Fatal(err)
	}
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("expected error response frame, got %v", err)
	}
	resp, err := wire.DecodeResponse(buf[4:n])
	if err != nil {
		t.Fatal(err)
	}
	if resp.OK || resp.ErrCode != "invalid_frame" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestPublicKeyMatchesHelperKey(t *testing.T) {
	h := newHarness(t)
	res, err := h.client.Call("publicKey", nil)
	if err != nil {
		t.Fatal(err)
	}
	want, err := keys.SPKIBase64url(keys.Public(h.helperPriv))
	if err != nil {
		t.Fatal(err)
	}
	if res["publicKeySpki"] != want {
		t.Fatal("public key mismatch")
	}
}

func TestAttest(t *testing.T) {
	h := newHarness(t)
	res, err := h.client.Call("attest", map[string]any{
		"challengeId":        "chal_0123456789abcdef0123456789abcdef",
		"challengeNonce":     strings.Repeat("A", 43),
		"deviceId":           testDeviceID,
		"executionServiceId": testServiceID,
	})
	if err != nil {
		t.Fatalf("attest: %v", err)
	}
	attMap, ok := res["attestation"].(map[string]any)
	if !ok {
		t.Fatalf("no attestation: %v", res)
	}
	raw, err := canon.Encode(attMap)
	if err != nil {
		t.Fatal(err)
	}
	att, err := wire.DecodeHelperAttestation(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if err := att.Verify(keys.Public(h.helperPriv)); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if att.PolicyEpoch != 3 || att.HelperProtocol != 1 || att.HelperInstanceID != testHelperID {
		t.Fatalf("bad attestation: %+v", att)
	}
	// Wrong service ID rejected.
	if _, err := h.client.Call("attest", map[string]any{
		"challengeId":        "chal_0123456789abcdef0123456789abcdef",
		"challengeNonce":     strings.Repeat("A", 43),
		"deviceId":           testDeviceID,
		"executionServiceId": "svc_ffffffffffffffffffffffffffffffff",
	}); err == nil {
		t.Fatal("accepted wrong service id")
	}
}

func TestStartAndDuplicate(t *testing.T) {
	h := newHarness(t)
	rec1 := h.startJob(t, testTicketID)
	if rec1["unitName"] != sysd.UnitName(testTicketID) {
		t.Fatalf("unit name: %v", rec1["unitName"])
	}
	if rec1["signature"] == nil || rec1["signature"] == "" {
		t.Fatal("receipt unsigned")
	}
	// Verify the receipt signature against the helper key.
	raw, err := canon.Encode(rec1)
	if err != nil {
		t.Fatal(err)
	}
	sr, err := wire.DecodeExecutionStartedReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := sr.Verify(keys.Public(h.helperPriv)); err != nil {
		t.Fatalf("receipt verify: %v", err)
	}
	// Effective limits are the ticket's (below ceilings).
	if sr.EffectiveLimits.CPUMilli != 2000 {
		t.Fatalf("effective cpu = %d", sr.EffectiveLimits.CPUMilli)
	}
	// The prep unit (fetch phase) and the job unit both exist in systemd.
	if h.fake.UnitCount() != 2 {
		t.Fatalf("units: %d", h.fake.UnitCount())
	}

	// Exact duplicate returns the same receipt.
	res, err := h.client.Call("start", map[string]any{"ticket": h.makeTicket(testTicketID, 0)})
	if err != nil {
		t.Fatalf("duplicate start: %v", err)
	}
	if res["duplicate"] != true {
		t.Fatalf("duplicate flag: %v", res)
	}
	rec2 := res["receipt"].(map[string]any)
	if rec2["signature"] != rec1["signature"] {
		t.Fatal("duplicate returned a different receipt")
	}
	// Still exactly the prep + job units from the first start.
	if h.fake.UnitCount() != 2 {
		t.Fatal("duplicate start created additional units")
	}
}

func TestStartRejectsBadTickets(t *testing.T) {
	h := newHarness(t)
	// Unsigned/garbage ticket.
	if _, err := h.client.Call("start", map[string]any{"ticket": map[string]any{"domain": "x"}}); err == nil {
		t.Fatal("accepted garbage ticket")
	}
	// Ticket signed by an unknown coordinator.
	evil, _ := keys.Generate()
	ticket := h.makeTicket("ticket_11111111111111111111111111111111", 0)
	ticket["helperInstanceId"] = testHelperID
	// Re-sign with the evil key.
	tk, _ := wire.DecodeExecutionTicket(mustEncode(t, ticket))
	if err := tk.Sign(evil); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("start", map[string]any{"ticket": tk.Map()}); err == nil {
		t.Fatal("accepted ticket signed by unknown key")
	}
	// Ticket bound to a different helper instance.
	tk2, _ := wire.DecodeExecutionTicket(mustEncode(t, h.makeTicket("ticket_22222222222222222222222222222222", 0)))
	tk2.HelperInstanceID = "hi_ffffffffffffffffffffffffffffffff"
	if err := tk2.Sign(h.coordPriv); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("start", map[string]any{"ticket": tk2.Map()}); err == nil {
		t.Fatal("accepted ticket for another helper")
	}
	// Expired lease.
	tk3, _ := wire.DecodeExecutionTicket(mustEncode(t, h.makeTicket("ticket_33333333333333333333333333333333", 0)))
	tk3.ServerIssuedAt = testStart.Add(-time.Hour)
	tk3.LeaseExpiresAt = testStart.Add(-30 * time.Minute)
	if err := tk3.Sign(h.coordPriv); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("start", map[string]any{"ticket": tk3.Map()}); err == nil {
		t.Fatal("accepted expired ticket")
	}
	// Profile not in registry.
	tk4, _ := wire.DecodeExecutionTicket(mustEncode(t, h.makeTicket("ticket_44444444444444444444444444444444", 0)))
	tk4.ExecutorProfileID = "shell-v9"
	if err := tk4.Sign(h.coordPriv); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("start", map[string]any{"ticket": tk4.Map()}); err == nil {
		t.Fatal("accepted unknown executor profile")
	}
	// Policy epoch too new.
	tk5, _ := wire.DecodeExecutionTicket(mustEncode(t, h.makeTicket("ticket_55555555555555555555555555555555", 0)))
	tk5.MinimumPolicyEpoch = 99
	if err := tk5.Sign(h.coordPriv); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("start", map[string]any{"ticket": tk5.Map()}); err == nil {
		t.Fatal("accepted future policy epoch")
	}
	// Nothing was started.
	if h.fake.UnitCount() != 0 {
		t.Fatalf("bad tickets started units: %d", h.fake.UnitCount())
	}
}

func mustEncode(t *testing.T, v any) []byte {
	t.Helper()
	b, err := canon.Encode(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRenewSequenceEnforcement(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)

	// seq 1 accepted.
	res, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 1, false, testStart.Add(10*time.Minute)),
	})
	if err != nil {
		t.Fatalf("renew seq1: %v", err)
	}
	if res["accepted"] != true || res["duplicate"] != false {
		t.Fatalf("renew result: %v", res)
	}
	// Byte-identical seq 1 duplicate accepted.
	res, err = h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 1, false, testStart.Add(10*time.Minute)),
	})
	if err != nil {
		t.Fatalf("dup renew: %v", err)
	}
	if res["duplicate"] != true {
		t.Fatalf("expected duplicate: %v", res)
	}
	// Different bytes at seq 1 rejected.
	if _, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 1, false, testStart.Add(11*time.Minute)),
	}); err == nil {
		t.Fatal("accepted conflicting equal-sequence renewal")
	}
	// Stale seq 0 rejected.
	if _, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 0, false, testStart.Add(12*time.Minute)),
	}); err == nil {
		t.Fatal("accepted stale renewal")
	}
	// seq 2 beyond job deadline rejected.
	if _, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 2, false, testStart.Add(2*time.Hour)),
	}); err == nil {
		t.Fatal("accepted renewal beyond job deadline")
	}
	// Renewal for unknown ticket rejected.
	if _, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate("ticket_99999999999999999999999999999999", 1, false, testStart.Add(10*time.Minute)),
	}); err == nil {
		t.Fatal("accepted renewal for unknown ticket")
	}
	// Forged renewal (wrong key) rejected.
	u := &wire.LeaseUpdate{
		TicketID: testTicketID, JobID: testJobID, Attempt: 1, LeaseID: testLeaseID,
		HelperInstanceID: testHelperID, LeaseSequence: 5,
		ServerIssuedAt: h.clock.WallNow(), LeaseExpiresAt: testStart.Add(10 * time.Minute),
	}
	evil, _ := keys.Generate()
	if err := u.Sign(evil); err != nil {
		t.Fatal(err)
	}
	if _, err := h.client.Call("renew", map[string]any{"leaseUpdate": u.Map()}); err == nil {
		t.Fatal("accepted forged renewal")
	}
}

func TestRenewCancelStopsUnit(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)
	if _, err := h.client.Call("renew", map[string]any{
		"leaseUpdate": h.makeLeaseUpdate(testTicketID, 1, true, testStart.Add(10*time.Minute)),
	}); err != nil {
		t.Fatal(err)
	}
	name := sysd.UnitName(testTicketID)
	st, err := h.fake.GetUnitState(context.Background(), name)
	if err != nil {
		t.Fatal(err)
	}
	if st.Active() {
		t.Fatal("unit still active after cancellation")
	}
}

func TestLeaseExpiryReaper(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)
	// Advance past the lease; the reaper must stop the unit.
	h.clock.Advance(6 * time.Minute)
	deadline := time.Now().Add(3 * time.Second)
	for {
		st, _ := h.fake.GetUnitState(context.Background(), sysd.UnitName(testTicketID))
		if !st.Active() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("reaper did not stop expired lease")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestStopAlwaysAccepted(t *testing.T) {
	h := newHarness(t)
	// Unknown ticket: still accepted.
	res, err := h.client.Call("stop", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatalf("stop unknown: %v", err)
	}
	if res["stopping"] != true {
		t.Fatalf("stop: %v", res)
	}
	// Known running ticket.
	h.startJob(t, testTicketID)
	if _, err := h.client.Call("stop", map[string]any{"ticketId": testTicketID}); err != nil {
		t.Fatal(err)
	}
	st, _ := h.fake.GetUnitState(context.Background(), sysd.UnitName(testTicketID))
	if st.Active() {
		t.Fatal("unit active after stop")
	}
	// Repeated stop still accepted.
	if _, err := h.client.Call("stop", map[string]any{"ticketId": testTicketID}); err != nil {
		t.Fatal("repeated stop rejected")
	}
}

// setPopulated flips the fake unit's cgroup.events populated flag.
func (h *harness) setPopulated(t *testing.T, ticketID string, populated bool) {
	t.Helper()
	name := sysd.UnitName(ticketID)
	cgDir := h.fake.UnitCgroupDir(name)
	if cgDir == "" {
		t.Fatalf("no cgroup for %s", name)
	}
	pop := "0"
	if populated {
		pop = "1"
	}
	if err := os.WriteFile(filepath.Join(cgDir, "cgroup.events"), []byte("populated "+pop+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSettleSignsOnlyWhenEmpty(t *testing.T) {
	h := newHarness(t)
	// Simulate an uninterruptible remnant: the cgroup stays populated even
	// after stop and cgroup.kill.
	h.fake.KeepPopulatedOnStop = true
	h.startJob(t, testTicketID)
	// Settle must refuse to sign, and after the cgroup.kill fallback still
	// fails the daemon quarantines.
	if _, err := h.client.Call("settle", map[string]any{"ticketId": testTicketID}); err == nil {
		t.Fatal("settle signed while populated")
	}
	// No termination receipt was written.
	if _, err := os.Stat(filepath.Join(h.dir, "state", "jobs", testTicketID, "receipts", "termination.json")); !os.IsNotExist(err) {
		t.Fatal("termination receipt exists despite populated cgroup")
	}
	// Daemon is quarantined: new work refused.
	if _, err := h.client.Call("start", map[string]any{"ticket": h.makeTicket("ticket_88888888888888888888888888888888", 0)}); err == nil {
		t.Fatal("quarantined daemon accepted start")
	}
	// Flip to empty; settle now succeeds even while quarantined (settling
	// existing work must always be possible).
	h.setPopulated(t, testTicketID, false)
	res, err := h.client.Call("settle", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatalf("settle after empty: %v", err)
	}
	rec := res["receipt"].(map[string]any)
	if rec["populated"] != false {
		t.Fatalf("receipt populated: %v", rec["populated"])
	}
	raw, err := canon.Encode(rec)
	if err != nil {
		t.Fatal(err)
	}
	tr, err := wire.DecodeTerminationReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := tr.Verify(keys.Public(h.helperPriv)); err != nil {
		t.Fatalf("termination receipt verify: %v", err)
	}
	// Duplicate settle returns the same receipt.
	res2, err := h.client.Call("settle", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatal(err)
	}
	if res2["duplicate"] != true || res2["receipt"].(map[string]any)["signature"] != rec["signature"] {
		t.Fatal("duplicate settle mismatch")
	}
}

func TestSettleCapturesExitStatus(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)
	// Unit exits on its own with status 3; its cgroup empties.
	h.fake.CompleteUnit(sysd.UnitName(testTicketID), 3, "exit-code")
	h.setPopulated(t, testTicketID, false)
	res, err := h.client.Call("settle", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatal(err)
	}
	rec := res["receipt"].(map[string]any)
	raw, _ := canon.Encode(rec)
	tr, err := wire.DecodeTerminationReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if tr.ExitStatus != 3 || tr.TerminationReason != "failed" {
		t.Fatalf("exit = %d reason = %s", tr.ExitStatus, tr.TerminationReason)
	}
}

func TestRecoverStopsOrphans(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)
	h.cancel()
	h.ln.Close()

	// Simulate a daemon restart against the same state dir: the old unit is
	// still "running" in systemd.
	d2, err := New(Config{
		SocketPath:    filepath.Join(h.dir, "control2.sock"),
		AgentUID:      501,
		StateDir:      filepath.Join(h.dir, "state"),
		JobsDir:       filepath.Join(h.dir, "jobs"),
		RunnerPath:    "/usr/libexec/statskey-fleet-runner",
		HelperKey:     h.helperPriv,
		InstanceID:    testHelperID,
		KeyRing:       mustRing(t, h.coordPriv),
		Sysd:          h.fake,
		Clock:         h.clock,
		BootIDDigest:  testDigestB64,
		HelperBuildID: testDigestHex,
		RunnerBuildID: testDigestHex,
		Policy: Policy{
			PolicyEpoch: 3, ExecutionServiceID: testServiceID,
			Ceilings:           wire.ResourceLimits{CPUMilli: 4000, MemoryBytes: 8589934592, Pids: 256, DiskBytes: 21474836480, WallTimeMs: 3600000},
			ExecutorProfileIDs: []string{"command-v1"},
			SandboxProfileIDs:  []string{"ubuntu-build-v1"},
			NetworkProfileIDs:  []string{"none"},
		},
		SettleTimeout:     300 * time.Millisecond,
		SettleKillTimeout: 200 * time.Millisecond,
		CgroupRoot:        h.fake.CgroupRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := d2.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	st, _ := h.fake.GetUnitState(context.Background(), sysd.UnitName(testTicketID))
	if st.Active() {
		t.Fatal("orphan unit still active after recovery")
	}
	// The recovered ticket is tracked and settle-able with daemon-restart.
	ln, err := ListenControl(d2.cfg.SocketPath, 0)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	d2.SetPeerUIDFunc(func(net.Conn) (uint32, error) { return 501, nil })
	go d2.Serve(ctx, ln)
	client := &Client{SocketPath: d2.cfg.SocketPath, Timeout: 10 * time.Second}
	res, err := client.Call("settle", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatalf("settle after restart: %v", err)
	}
	rec := res["receipt"].(map[string]any)
	raw, _ := canon.Encode(rec)
	tr, err := wire.DecodeTerminationReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if tr.TerminationReason != "daemon-restart" {
		t.Fatalf("reason = %s", tr.TerminationReason)
	}
}

func mustRing(t *testing.T, coordPriv ed25519.PrivateKey) *wire.KeyRing {
	t.Helper()
	r, err := wire.NewKeyRing(map[string]ed25519.PublicKey{"coord-1": keys.Public(coordPriv)})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestStartAfterFailedStartIsRefused(t *testing.T) {
	h := newHarness(t)
	// Make the first systemd start fail.
	h.fake.StartErr = errors.New("dbus boom")
	if _, err := h.client.Call("start", map[string]any{"ticket": h.makeTicket(testTicketID, 0)}); err == nil {
		t.Fatal("start should have failed")
	}
	// Retry with the same ticket: the start marker makes it ambiguous and it
	// must be refused (one-start-per-ticket, fail closed).
	if _, err := h.client.Call("start", map[string]any{"ticket": h.makeTicket(testTicketID, 0)}); err == nil {
		t.Fatal("retry after failed start was accepted")
	} else {
		var ce *CallError
		if errors.As(err, &ce) && ce.Code != "conflict" {
			t.Fatalf("expected conflict, got %v", ce)
		}
	}
	// No unit exists.
	if h.fake.UnitCount() != 0 {
		t.Fatal("unit exists after failed start")
	}
	// Settling the never-launched ticket yields a termination receipt with
	// no exit status and reason "failed" (no process ever ran).
	res, err := h.client.Call("settle", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatalf("settle never-started: %v", err)
	}
	rec := res["receipt"].(map[string]any)
	raw, _ := canon.Encode(rec)
	tr, err := wire.DecodeTerminationReceipt(raw)
	if err != nil {
		t.Fatal(err)
	}
	if tr.ExitStatus != -1 || tr.TerminationReason != "failed" {
		t.Fatalf("exit = %d reason = %s", tr.ExitStatus, tr.TerminationReason)
	}
	if err := tr.Verify(keys.Public(h.helperPriv)); err != nil {
		t.Fatal(err)
	}
}

func TestStatus(t *testing.T) {
	h := newHarness(t)
	h.startJob(t, testTicketID)
	res, err := h.client.Call("status", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if res["helperInstanceId"] != testHelperID || res["quarantined"] != false {
		t.Fatalf("status: %v", res)
	}
	tickets := res["tickets"].(map[string]any)
	if _, ok := tickets[testTicketID]; !ok {
		t.Fatalf("ticket missing from status: %v", tickets)
	}
	// Single-ticket status.
	res, err = h.client.Call("status", map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatal(err)
	}
	tk := res["ticket"].(map[string]any)
	if tk["state"] != "started" {
		t.Fatalf("state: %v", tk)
	}
	// Unknown ticket.
	if _, err := h.client.Call("status", map[string]any{"ticketId": "ticket_99999999999999999999999999999999"}); err == nil {
		t.Fatal("status for unknown ticket accepted")
	}
}
