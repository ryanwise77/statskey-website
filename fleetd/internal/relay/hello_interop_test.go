package relay

import (
	"testing"
	"time"
)

// The desktop's remote-session-runtime.cjs signs hellos with the Fleet
// canonical-JSON + Ed25519 scheme; the relay decodes and verifies them in
// Go. This fixture pins a real JS-produced hello so the two implementations
// cannot drift (canonical encoding, RFC3339-ms-UTC timestamps, base64url
// SPKI/signature, session key hash).
//
// Regenerate with:
//
//	node -e '/* see REMOTE_SESSION.md fixture recipe */' in desktop/
//
// The private keys are throwaway and never stored.
const jsHelloFixture = `{"deviceId":"dev_c76fb9a1b5614339075f40df6d61b42e","domain":"statskey.fleet.remote-hello.v1","ephemeralPublicKey":"MCowBQYDK2VwAyEASg3uHB55SBnswoZVzcg4430hjTa2o7dg2qpm4yYwmtU","expiresAt":"2026-08-19T05:05:00.000Z","issuedAt":"2026-08-19T05:00:00.000Z","publicKeySpki":"MCowBQYDK2VwAyEAMgh1mqouHdDDEkrkYE-UEQcXaKjzeMm2uNtzuyI7Uq0","role":"host","sessionId":"rs_0123456789abcdef0123456789abcdef","sessionKeyHash":"sha256:S7Bvjk46dxXSAdVz0KpCN2LlXavWGiwCJ4-lbMbSlOA","signature":"lJsKMCvk-SW7WNF4wkbfoHDOc4qmHGvQYn5XUonAonSISVLsUdpbRBILeIhQpyo1PpqgwuRVthSroqg79pEIBg"}`

func TestJSHelloInterop(t *testing.T) {
	h, err := DecodeHello([]byte(jsHelloFixture))
	if err != nil {
		t.Fatalf("decode JS hello: %v", err)
	}
	if h.SessionID != "rs_0123456789abcdef0123456789abcdef" ||
		h.Role != RoleHost ||
		h.DeviceID != "dev_c76fb9a1b5614339075f40df6d61b42e" {
		t.Fatalf("decoded fields mismatch: %+v", h)
	}
	// The session key was 32 bytes of 0x07 in the JS generator.
	hash, err := SessionKeyHashText(make([]byte, 32))
	if err == nil && hash == h.SessionKeyHash {
		t.Fatalf("zero key must not match the fixture hash")
	}
	sevens := make([]byte, 32)
	for i := range sevens {
		sevens[i] = 7
	}
	hash, err = SessionKeyHashText(sevens)
	if err != nil {
		t.Fatalf("key hash: %v", err)
	}
	if hash != h.SessionKeyHash {
		t.Fatalf("session key hash mismatch: %s != %s", hash, h.SessionKeyHash)
	}
	// Verify inside the fixture's validity window.
	at, err := ParseFixtureTime("2026-08-19T05:02:00.000Z")
	if err != nil {
		t.Fatalf("fixture time: %v", err)
	}
	if err := h.Verify(at); err != nil {
		t.Fatalf("verify JS hello: %v", err)
	}
	// And fail closed after expiry.
	expired, _ := ParseFixtureTime("2026-08-19T05:06:00.000Z")
	if err := h.Verify(expired); err == nil {
		t.Fatalf("expired JS hello must not verify")
	}
}

// ParseFixtureTime parses an RFC3339-ms-UTC fixture timestamp.
func ParseFixtureTime(s string) (time.Time, error) {
	return time.Parse("2006-01-02T15:04:05.000Z", s)
}
