package wire

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
)

const (
	testTicketID  = "ticket_0123456789abcdef0123456789abcdef"
	testJobID     = "job_0123456789abcdef0123456789abcdef"
	testLeaseID   = "lease_0123456789abcdef0123456789abcdef"
	testDeviceID  = "dev_0123456789abcdef0123456789abcdef"
	testDeviceID2 = "dev_fedcba9876543210fedcba9876543210"
	testServiceID = "svc_0123456789abcdef0123456789abcdef"
	testHelperID  = "hi_0123456789abcdef0123456789abcdef"
	testChalID    = "chal_0123456789abcdef0123456789abcdef"
	testDigestHex = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	testDigestB64 = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	testCommit    = "0123456789abcdef0123456789abcdef01234567"
	testUnitName  = "statskey-fleet-job-ticket_0123456789abcdef0123456789abcdef.service"
	testCgroup    = "/sys/fs/cgroup/system.slice/statskey-fleet-job-ticket_0123456789abcdef0123456789abcdef.service"
)

func testTime(s string) time.Time {
	t, err := ParseTimestamp(s)
	if err != nil {
		panic(err)
	}
	return t
}

func validTicket() *ExecutionTicket {
	return &ExecutionTicket{
		TicketID:           testTicketID,
		JobRequestDigest:   testDigestHex,
		JobID:              testJobID,
		Attempt:            1,
		LeaseID:            testLeaseID,
		LeaseSequence:      0,
		GrantReceiptDigest: testDigestHex,
		OwnerUID:           "user_abc123",
		WorkerDeviceID:     testDeviceID,
		ControllerDeviceID: testDeviceID2,
		ExecutionServiceID: testServiceID,
		HelperInstanceID:   testHelperID,
		RepositoryIdentity: "github.com/statskey/ci-tests",
		Commit:             testCommit,
		ExecutorProfileID:  "command-v1",
		SandboxProfileID:   "ubuntu-build-v1",
		NetworkProfileID:   "none",
		Command: CommandSpec{
			Executable:       "node",
			Arguments:        []string{"--version"},
			WorkingDirectory: ".",
		},
		Resources: ResourceLimits{
			CPUMilli:    4000,
			MemoryBytes: 8589934592,
			Pids:        256,
			DiskBytes:   21474836480,
			WallTimeMs:  3600000,
		},
		ServerIssuedAt:        testTime("2026-08-19T20:00:00.000Z"),
		LeaseExpiresAt:        testTime("2026-08-19T20:05:00.000Z"),
		JobDeadlineAt:         testTime("2026-08-19T21:00:00.000Z"),
		MinimumHelperProtocol: 1,
		MinimumPolicyEpoch:    1,
	}
}

func validAttestation() *HelperAttestation {
	return &HelperAttestation{
		ChallengeID:        testChalID,
		ChallengeNonce:     strings.Repeat("A", 43),
		DeviceID:           testDeviceID,
		ExecutionServiceID: testServiceID,
		HelperInstanceID:   testHelperID,
		BootIDDigest:       testDigestB64,
		HelperProtocol:     1,
		HelperBuildID:      testDigestHex,
		RunnerBuildID:      testDigestHex,
		PolicyEpoch:        1,
		Platform: PlatformInfo{
			ID:             "ubuntu",
			VersionID:      "26.04",
			Arch:           "x86_64",
			KernelRelease:  "6.8.0-31-generic",
			CgroupVersion:  2,
			SystemdVersion: "257",
		},
		Security: SecurityInfo{
			CgroupKill:            true,
			Delegated:             false,
			AppArmorEnforcing:     true,
			AppArmorProfileDigest: testDigestHex,
		},
		IssuedAt:  testTime("2026-08-19T20:00:00.000Z"),
		ExpiresAt: testTime("2026-08-19T20:05:00.000Z"),
	}
}

func validLeaseUpdate() *LeaseUpdate {
	return &LeaseUpdate{
		TicketID:         testTicketID,
		JobID:            testJobID,
		Attempt:          1,
		LeaseID:          testLeaseID,
		HelperInstanceID: testHelperID,
		LeaseSequence:    1,
		Cancelled:        false,
		ServerIssuedAt:   testTime("2026-08-19T20:01:00.000Z"),
		LeaseExpiresAt:   testTime("2026-08-19T20:10:00.000Z"),
	}
}

func validStartedReceipt() *ExecutionStartedReceipt {
	return &ExecutionStartedReceipt{
		TicketID:         testTicketID,
		JobID:            testJobID,
		Attempt:          1,
		LeaseID:          testLeaseID,
		HelperInstanceID: testHelperID,
		UnitName:         testUnitName,
		CgroupPath:       testCgroup,
		EffectiveLimits: ResourceLimits{
			CPUMilli:    4000,
			MemoryBytes: 8589934592,
			Pids:        256,
			DiskBytes:   21474836480,
			WallTimeMs:  3600000,
		},
		RunnerBuildID:        testDigestHex,
		StartedAt:            testTime("2026-08-19T20:00:01.000Z"),
		StartedAtMonotonicMs: 123456789,
	}
}

func validTerminationReceipt() *TerminationReceipt {
	return &TerminationReceipt{
		TicketID:             testTicketID,
		JobID:                testJobID,
		Attempt:              1,
		LeaseID:              testLeaseID,
		HelperInstanceID:     testHelperID,
		HighestLeaseSequence: 3,
		ExitStatus:           0,
		TerminationReason:    "exited",
		UnitName:             testUnitName,
		CgroupPath:           testCgroup,
		Populated:            false,
		Accounting: ResourceAccounting{
			CPUUsageNs:      123456789,
			MemoryPeakBytes: 1073741824,
			PidsPeak:        12,
			IOReadBytes:     4096,
			IOWriteBytes:    8192,
		},
		FinishedAt:            testTime("2026-08-19T20:02:00.000Z"),
		FinishedAtMonotonicMs: 123556789,
	}
}

func TestTicketSignVerifyRoundTrip(t *testing.T) {
	priv, err := keys.Generate()
	if err != nil {
		t.Fatal(err)
	}
	ticket := validTicket()
	if err := ticket.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := ticket.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	// Canonical form must be strict-parseable.
	if err := canon.Validate(raw); err != nil {
		t.Fatalf("signed ticket is not canonical: %v", err)
	}
	decoded, err := DecodeExecutionTicket(raw)
	if err != nil {
		t.Fatalf("DecodeExecutionTicket: %v", err)
	}
	if err := decoded.Verify(keys.Public(priv)); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	// Wrong key must fail.
	other, _ := keys.Generate()
	if err := decoded.Verify(keys.Public(other)); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("wrong key: %v", err)
	}
	// Tampered field must fail verification.
	decoded.Attempt = 2
	if err := decoded.Verify(keys.Public(priv)); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("tampered attempt: %v", err)
	}
}

func TestAllTypesRoundTrip(t *testing.T) {
	priv, _ := keys.Generate()
	pub := keys.Public(priv)

	att := validAttestation()
	if err := att.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := att.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	da, err := DecodeHelperAttestation(raw)
	if err != nil {
		t.Fatalf("attestation decode: %v", err)
	}
	if err := da.Verify(pub); err != nil {
		t.Fatalf("attestation verify: %v", err)
	}

	lu := validLeaseUpdate()
	if err := lu.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err = lu.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	dl, err := DecodeLeaseUpdate(raw)
	if err != nil {
		t.Fatalf("lease decode: %v", err)
	}
	if err := dl.Verify(pub); err != nil {
		t.Fatalf("lease verify: %v", err)
	}

	sr := validStartedReceipt()
	if err := sr.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err = sr.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	ds, err := DecodeExecutionStartedReceipt(raw)
	if err != nil {
		t.Fatalf("started receipt decode: %v", err)
	}
	if err := ds.Verify(pub); err != nil {
		t.Fatalf("started receipt verify: %v", err)
	}

	tr := validTerminationReceipt()
	if err := tr.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err = tr.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	dt, err := DecodeTerminationReceipt(raw)
	if err != nil {
		t.Fatalf("termination receipt decode: %v", err)
	}
	if err := dt.Verify(pub); err != nil {
		t.Fatalf("termination receipt verify: %v", err)
	}
}

// mutateCanonical re-encodes m canonically after applying fn.
func mutateCanonical(t *testing.T, m map[string]any, fn func(map[string]any)) []byte {
	t.Helper()
	fn(m)
	raw, err := canon.Encode(m)
	if err != nil {
		t.Fatalf("mutate encode: %v", err)
	}
	return raw
}

func ticketMap(t *testing.T) map[string]any {
	t.Helper()
	ticket := validTicket()
	priv, _ := keys.Generate()
	if err := ticket.Sign(priv); err != nil {
		t.Fatal(err)
	}
	return ticket.Map()
}

func TestTicketStrictDecode(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"unknown-field", func(m map[string]any) { m["surprise"] = 1 }},
		{"unknown-nested", func(m map[string]any) {
			m["command"].(map[string]any)["shell"] = true
		}},
		{"bad-ticketId", func(m map[string]any) { m["ticketId"] = "ticket_UPPER" }},
		{"bad-commit-short", func(m map[string]any) { m["commit"] = "abc123" }},
		{"bad-commit-uppercase", func(m map[string]any) {
			m["commit"] = strings.ToUpper(testCommit)
		}},
		{"executable-with-slash", func(m map[string]any) {
			m["command"].(map[string]any)["executable"] = "/bin/sh"
		}},
		{"executable-dotdot", func(m map[string]any) {
			m["command"].(map[string]any)["executable"] = ".."
		}},
		{"workdir-absolute", func(m map[string]any) {
			m["command"].(map[string]any)["workingDirectory"] = "/etc"
		}},
		{"workdir-escape", func(m map[string]any) {
			m["command"].(map[string]any)["workingDirectory"] = "a/../../etc"
		}},
		{"attempt-zero", func(m map[string]any) { m["attempt"] = 0 }},
		{"repo-not-github", func(m map[string]any) {
			m["repositoryIdentity"] = "evil.com/x/y"
		}},
		{"repo-with-scheme", func(m map[string]any) {
			m["repositoryIdentity"] = "https://github.com/x/y"
		}},
		{"lease-beyond-deadline", func(m map[string]any) {
			m["leaseExpiresAt"] = "2026-08-19T22:00:00.000Z"
		}},
		{"lease-before-issued", func(m map[string]any) {
			m["leaseExpiresAt"] = "2026-08-19T19:00:00.000Z"
		}},
		{"bad-timestamp", func(m map[string]any) {
			m["serverIssuedAt"] = "2026-08-19 20:00:00"
		}},
		{"timestamp-non-utc", func(m map[string]any) {
			m["serverIssuedAt"] = "2026-08-19T20:00:00.000+02:00"
		}},
		{"timestamp-no-ms", func(m map[string]any) {
			m["serverIssuedAt"] = "2026-08-19T20:00:00Z"
		}},
		{"bad-signature-shape", func(m map[string]any) { m["signature"] = "!!!" }},
		{"zero-cpu", func(m map[string]any) {
			m["resources"].(map[string]any)["cpuMilli"] = 0
		}},
		{"zero-pids", func(m map[string]any) {
			m["resources"].(map[string]any)["pids"] = 0
		}},
		{"missing-domain", func(m map[string]any) { delete(m, "domain") }},
		{"wrong-domain", func(m map[string]any) { m["domain"] = "statskey.fleet.lease-update.v1" }},
		{"argument-nul", func(m map[string]any) {
			m["command"].(map[string]any)["arguments"] = []any{"a\x00b"}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := mutateCanonical(t, ticketMap(t), tc.mutate)
			if _, err := DecodeExecutionTicket(raw); err == nil {
				t.Fatalf("accepted mutated ticket %s", tc.name)
			}
		})
	}
}

func TestTicketRejectsNonCanonical(t *testing.T) {
	ticket := validTicket()
	priv, _ := keys.Generate()
	if err := ticket.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := ticket.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	// Pretty-printed (whitespace) form must be rejected even though it is
	// valid JSON.
	pretty := strings.ReplaceAll(string(raw), `,"`, ",\n  \"")
	if _, err := DecodeExecutionTicket([]byte(pretty)); err == nil {
		t.Fatal("accepted non-canonical whitespace")
	}
}

func TestLeaseUpdateStrict(t *testing.T) {
	priv, _ := keys.Generate()
	lu := validLeaseUpdate()
	if err := lu.Sign(priv); err != nil {
		t.Fatal(err)
	}
	m := lu.Map()
	m["leaseSequence"] = -1
	raw, err := canon.Encode(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeLeaseUpdate(raw); err == nil {
		t.Fatal("accepted negative leaseSequence")
	}
	m2 := lu.Map()
	m2["cancelled"] = "yes"
	raw2, err := canon.Encode(m2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeLeaseUpdate(raw2); err == nil {
		t.Fatal("accepted non-bool cancelled")
	}
}

func TestTerminationReceiptPopulatedRejected(t *testing.T) {
	priv, _ := keys.Generate()
	tr := validTerminationReceipt()
	tr.Populated = true
	if err := tr.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := tr.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeTerminationReceipt(raw); err == nil {
		t.Fatal("accepted populated=true termination receipt")
	}
}

func TestTerminationReceiptReasonEnum(t *testing.T) {
	tr := validTerminationReceipt()
	tr.TerminationReason = "whatever"
	priv, _ := keys.Generate()
	if err := tr.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := tr.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeTerminationReceipt(raw); err == nil {
		t.Fatal("accepted unknown termination reason")
	}
}

func TestCgroupPathValidation(t *testing.T) {
	sr := validStartedReceipt()
	priv, _ := keys.Generate()
	for _, bad := range []string{
		"/sys/fs/cgroup/../etc",
		"/sys/fs/cgroup//double",
		"/sys/fs/cgroup/system.slice/../../x",
		"/etc/passwd",
		"/sys/fs/cgroup/",
	} {
		sr2 := *sr
		sr2.CgroupPath = bad
		if err := sr2.Sign(priv); err != nil {
			t.Fatal(err)
		}
		raw, err := sr2.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := DecodeExecutionStartedReceipt(raw); err == nil {
			t.Fatalf("accepted cgroup path %q", bad)
		}
	}
}

func TestTimestampCanonicality(t *testing.T) {
	if _, err := ParseTimestamp("2026-08-19T20:00:00.000Z"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		"2026-08-19T20:00:00Z",
		"2026-08-19T20:00:00.0000Z",
		"2026-08-19T20:00:00.000+00:00",
		"2026-13-19T20:00:00.000Z",
		"2026-08-19T25:00:00.000Z",
		"2026-08-19t20:00:00.000z",
	} {
		if _, err := ParseTimestamp(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestIPCFraming(t *testing.T) {
	body, err := EncodeRequest(MethodStart, map[string]any{"ticketId": testTicketID})
	if err != nil {
		t.Fatal(err)
	}
	var buf strings.Builder
	// strings.Builder implements io.Writer.
	if err := WriteFrame(&buf, body); err != nil {
		t.Fatal(err)
	}
	frame := buf.String()
	if len(frame) != len(body)+4 {
		t.Fatalf("frame length = %d, want %d", len(frame), len(body)+4)
	}
	back, err := ReadFrame(strings.NewReader(frame))
	if err != nil {
		t.Fatal(err)
	}
	if string(back) != string(body) {
		t.Fatal("frame round-trip mismatch")
	}
	req, err := DecodeRequest(back)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != MethodStart {
		t.Fatalf("method = %q", req.Method)
	}
	tid, err := req.Params.Str("ticketId", TicketIDPattern)
	if err != nil {
		t.Fatal(err)
	}
	if tid != testTicketID {
		t.Fatal("param mismatch")
	}
	if err := req.Params.Done(); err != nil {
		t.Fatal(err)
	}

	// Oversized frame must be rejected by the reader.
	if _, err := ReadFrame(strings.NewReader(string([]byte{0, 1, 0, 1}))); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("oversize frame: %v", err)
	}
	// Tiny frame rejected.
	if _, err := ReadFrame(strings.NewReader(string([]byte{0, 0, 0, 1, 'x'}))); !errors.Is(err, ErrFrameShort) {
		t.Fatalf("tiny frame: %v", err)
	}
	// Unknown method rejected.
	bad, err := EncodeRequestRaw("exec", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRequest(bad); err == nil {
		t.Fatal("accepted unknown method")
	}
	// Unknown request field rejected.
	bad2, err := canon.Encode(map[string]any{"method": "start", "params": map[string]any{}, "extra": 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRequest(bad2); !errors.Is(err, ErrUnknownField) {
		t.Fatalf("extra request field: %v", err)
	}
}

// EncodeRequestRaw encodes a request without method allow-listing (test
// helper for negative cases).
func EncodeRequestRaw(method string, params map[string]any) ([]byte, error) {
	return canon.Encode(map[string]any{"method": method, "params": params})
}

func TestIPCResponseRoundTrip(t *testing.T) {
	ok, err := EncodeResponse(IPCResponse{OK: true, Result: map[string]any{"keyId": "sha256:abc"}})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := DecodeResponse(ok)
	if err != nil {
		t.Fatal(err)
	}
	if !resp.OK || resp.Result["keyId"] != "sha256:abc" {
		t.Fatalf("bad ok response: %+v", resp)
	}

	fail, err := EncodeResponse(IPCResponse{OK: false, ErrCode: "not_found", ErrMsg: "no such ticket"})
	if err != nil {
		t.Fatal(err)
	}
	resp2, err := DecodeResponse(fail)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.OK || resp2.ErrCode != "not_found" {
		t.Fatalf("bad error response: %+v", resp2)
	}
}

func TestKeyRing(t *testing.T) {
	priv, _ := keys.Generate()
	pub := keys.Public(priv)
	spki, err := keys.SPKIBase64url(pub)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path := dir + "/coordinator-keys.json"
	content := `{"version":1,"keys":[{"keyId":"coord-1","publicKeySpki":"` + spki + `"}]}`
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
	kr, err := LoadKeyRing(path)
	if err != nil {
		t.Fatal(err)
	}
	if kr.Len() != 1 {
		t.Fatal("wrong ring size")
	}
	if _, ok := kr.ByID("coord-1"); !ok {
		t.Fatal("missing coord-1")
	}
	if _, ok := kr.ByID("nope"); ok {
		t.Fatal("unexpected key")
	}

	// Duplicate IDs rejected.
	if err := writeFile(path, `{"version":1,"keys":[{"keyId":"coord-1","publicKeySpki":"`+spki+`"},{"keyId":"coord-1","publicKeySpki":"`+spki+`"}]}`); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyRing(path); err == nil {
		t.Fatal("accepted duplicate key ids")
	}
	// Bad SPKI rejected.
	if err := writeFile(path, `{"version":1,"keys":[{"keyId":"coord-1","publicKeySpki":"!!!"}]}`); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyRing(path); err == nil {
		t.Fatal("accepted bad spki")
	}
	// Empty ring rejected.
	if err := writeFile(path, `{"version":1,"keys":[]}`); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyRing(path); err == nil {
		t.Fatal("accepted empty ring")
	}
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}
