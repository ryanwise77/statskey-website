package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

func testKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	priv, err := keys.Generate()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return priv
}

func testSessionKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return key
}

type helloOption func(*Hello)

func withLifetime(lifetime time.Duration) helloOption {
	return func(h *Hello) { h.ExpiresAt = h.IssuedAt.Add(lifetime) }
}

func withExpiry(past time.Duration) helloOption {
	return func(h *Hello) {
		h.IssuedAt = time.Now().Add(-past - time.Minute)
		h.ExpiresAt = time.Now().Add(-past)
	}
}

func withSessionKey(key []byte) helloOption {
	return func(h *Hello) {
		hash, err := SessionKeyHashText(key)
		if err != nil {
			panic(err)
		}
		h.SessionKeyHash = hash
	}
}

func signedHello(t *testing.T, priv ed25519.PrivateKey, sessionID, role string, sessionKey []byte, opts ...helloOption) *Hello {
	t.Helper()
	pub, err := keys.SPKIBase64url(keys.Public(priv))
	if err != nil {
		t.Fatalf("spki: %v", err)
	}
	deviceID, err := keys.DeviceID(keys.Public(priv))
	if err != nil {
		t.Fatalf("device id: %v", err)
	}
	hash, err := SessionKeyHashText(sessionKey)
	if err != nil {
		t.Fatalf("key hash: %v", err)
	}
	ephPub, err := keys.SPKIBase64url(keys.Public(testKey(t)))
	if err != nil {
		t.Fatalf("ephemeral spki: %v", err)
	}
	h := &Hello{
		SessionID:          sessionID,
		Role:               role,
		DeviceID:           deviceID,
		PublicKeySPKI:      pub,
		EphemeralPublicKey: ephPub,
		SessionKeyHash:     hash,
		IssuedAt:           time.Now().Add(-time.Second),
		ExpiresAt:          time.Now().Add(5 * time.Minute),
	}
	for _, opt := range opts {
		opt(h)
	}
	if err := h.Sign(priv); err != nil {
		t.Fatalf("sign hello: %v", err)
	}
	return h
}

func startRelay(t *testing.T, cfg Config) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = srv.Serve(ctx, ln) }()
	t.Cleanup(func() {
		cancel()
		ln.Close()
	})
	return ln.Addr().String()
}

// connect performs the hello handshake and returns the connection plus the
// relay's first control response.
func connect(t *testing.T, addr string, h *Hello) (net.Conn, map[string]any) {
	t.Helper()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("deadline: %v", err)
	}
	body, err := h.Marshal()
	if err != nil {
		t.Fatalf("marshal hello: %v", err)
	}
	if err := WriteFrame(conn, FrameControl, body); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	typ, payload, err := ReadFrame(conn, MaxControlBytes+1)
	if err != nil {
		_ = conn.Close()
		return conn, nil
	}
	if typ != FrameControl {
		t.Fatalf("first response type = %d, want control", typ)
	}
	v, err := canon.Parse(payload)
	if err != nil {
		t.Fatalf("parse control: %v", err)
	}
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("control response is not an object")
	}
	return conn, m
}

func readControl(t *testing.T, conn net.Conn) map[string]any {
	t.Helper()
	typ, payload, err := ReadFrame(conn, MaxControlBytes+1)
	if err != nil {
		t.Fatalf("read control: %v", err)
	}
	if typ != FrameControl {
		t.Fatalf("frame type = %d, want control", typ)
	}
	v, err := canon.Parse(payload)
	if err != nil {
		t.Fatalf("parse control: %v", err)
	}
	return v.(map[string]any)
}

func expectClosed(t *testing.T, conn net.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := ReadFrame(conn, MaxFrameBytes)
	if err == nil {
		t.Fatalf("expected connection to close")
	}
}

func TestHelloRoundTrip(t *testing.T) {
	priv := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_"+("a1b2c3d4"[0:8])+""+("e5f60718293a4b5c6d7e8f90a1b2c3d4"[0:24]), RoleHost, key)
	body, err := h.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	decoded, err := DecodeHello(body)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.SessionID != h.SessionID || decoded.Role != h.Role ||
		decoded.DeviceID != h.DeviceID || decoded.SessionKeyHash != h.SessionKeyHash {
		t.Fatalf("round trip mismatch: %+v", decoded)
	}
	if err := decoded.Verify(time.Now()); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestHelloRejectsBadSignature(t *testing.T) {
	priv := testKey(t)
	other := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_0123456789abcdef0123456789abcdef", RoleHost, key)
	// Re-sign with the wrong key: the embedded public key no longer matches.
	if err := h.Sign(other); err != nil {
		t.Fatalf("resign: %v", err)
	}
	if err := h.Verify(time.Now()); !errors.Is(err, wire.ErrSignatureInvalid) {
		t.Fatalf("verify with wrong key: %v", err)
	}
}

func TestHelloRejectsExpired(t *testing.T) {
	priv := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_0123456789abcdef0123456789abcdef", RoleViewer, key, withExpiry(time.Minute))
	if err := h.Verify(time.Now()); !errors.Is(err, ErrHelloExpired) {
		t.Fatalf("expired verify: %v", err)
	}
}

func TestHelloRejectsLongLifetime(t *testing.T) {
	priv := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_0123456789abcdef0123456789abcdef", RoleHost, key, withLifetime(11*time.Minute))
	if err := h.Verify(time.Now()); !errors.Is(err, ErrHelloLifetime) {
		t.Fatalf("long lifetime verify: %v", err)
	}
}

func TestHelloRejectsDeviceMismatch(t *testing.T) {
	priv := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_0123456789abcdef0123456789abcdef", RoleHost, key)
	h.DeviceID = "dev_00000000000000000000000000000000"
	if err := h.Sign(priv); err != nil {
		t.Fatalf("resign: %v", err)
	}
	if err := h.Verify(time.Now()); !errors.Is(err, ErrDeviceMismatch) {
		t.Fatalf("device mismatch verify: %v", err)
	}
}

func TestEndToEndForwarding(t *testing.T) {
	addr := startRelay(t, Config{})
	sessionID := "rs_11111111111111111111111111111111"
	key := testSessionKey(t)

	hostConn, hostResp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer hostConn.Close()
	if hostResp["type"] != "waiting" {
		t.Fatalf("host response = %v, want waiting", hostResp)
	}
	viewerConn, viewerResp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewerConn.Close()
	if viewerResp["type"] != "paired" {
		t.Fatalf("viewer response = %v, want paired", viewerResp)
	}
	hostPaired := readControl(t, hostConn)
	if hostPaired["type"] != "paired" {
		t.Fatalf("host paired notice = %v", hostPaired)
	}

	// Host → viewer: opaque video payload is forwarded byte-identically.
	video := []byte{0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03}
	if err := WriteFrame(hostConn, FrameVideo, video); err != nil {
		t.Fatalf("write video: %v", err)
	}
	typ, payload, err := ReadFrame(viewerConn, MaxFrameBytes)
	if err != nil {
		t.Fatalf("viewer read: %v", err)
	}
	if typ != FrameVideo || string(payload) != string(video) {
		t.Fatalf("viewer got type=%d payload=%x", typ, payload)
	}

	// Viewer → host: input payload.
	input := []byte(`{"type":"mousemove","x":10,"y":20}`)
	if err := WriteFrame(viewerConn, FrameInput, input); err != nil {
		t.Fatalf("write input: %v", err)
	}
	typ, payload, err = ReadFrame(hostConn, MaxFrameBytes)
	if err != nil {
		t.Fatalf("host read: %v", err)
	}
	if typ != FrameInput || string(payload) != string(input) {
		t.Fatalf("host got type=%d payload=%q", typ, payload)
	}
}

func TestRelayRejectsBadSignatureOverTCP(t *testing.T) {
	addr := startRelay(t, Config{})
	priv := testKey(t)
	key := testSessionKey(t)
	h := signedHello(t, priv, "rs_22222222222222222222222222222222", RoleHost, key)
	if err := h.Sign(testKey(t)); err != nil {
		t.Fatalf("resign: %v", err)
	}
	conn, resp := connect(t, addr, h)
	defer conn.Close()
	if resp == nil || resp["type"] != "error" || resp["code"] != CodeBadSignature {
		t.Fatalf("response = %v, want bad_signature error", resp)
	}
	expectClosed(t, conn)
}

func TestRelayRejectsExpiredHelloOverTCP(t *testing.T) {
	addr := startRelay(t, Config{})
	key := testSessionKey(t)
	h := signedHello(t, testKey(t), "rs_33333333333333333333333333333333", RoleHost, key, withExpiry(time.Minute))
	conn, resp := connect(t, addr, h)
	defer conn.Close()
	if resp == nil || resp["code"] != CodeHelloExpired {
		t.Fatalf("response = %v, want hello_expired", resp)
	}
	expectClosed(t, conn)
}

func TestRelayRejectsSessionKeyMismatch(t *testing.T) {
	addr := startRelay(t, Config{})
	sessionID := "rs_44444444444444444444444444444444"
	hostKey := testSessionKey(t)
	viewerKey := testSessionKey(t)

	hostConn, hostResp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, hostKey))
	defer hostConn.Close()
	if hostResp["type"] != "waiting" {
		t.Fatalf("host response = %v", hostResp)
	}
	viewerConn, viewerResp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, viewerKey))
	defer viewerConn.Close()
	if viewerResp == nil || viewerResp["code"] != CodeKeyMismatch {
		t.Fatalf("viewer response = %v, want session_key_mismatch", viewerResp)
	}
	expectClosed(t, viewerConn)

	// The host is untouched: a viewer with the right key still pairs.
	goodViewer, goodResp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, hostKey))
	defer goodViewer.Close()
	if goodResp["type"] != "paired" {
		t.Fatalf("good viewer response = %v, want paired", goodResp)
	}
}

func TestRelayRejectsSecondHost(t *testing.T) {
	addr := startRelay(t, Config{})
	sessionID := "rs_55555555555555555555555555555555"
	key := testSessionKey(t)

	host1, resp1 := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host1.Close()
	if resp1["type"] != "waiting" {
		t.Fatalf("host1 response = %v", resp1)
	}
	host2, resp2 := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host2.Close()
	if resp2 == nil || resp2["code"] != CodeDuplicateRole {
		t.Fatalf("host2 response = %v, want duplicate_role", resp2)
	}
	expectClosed(t, host2)

	// Host1 remains registered: a viewer can still pair.
	viewer, resp3 := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewer.Close()
	if resp3["type"] != "paired" {
		t.Fatalf("viewer response = %v, want paired", resp3)
	}
}

func TestRelayEnforcesFrameBound(t *testing.T) {
	addr := startRelay(t, Config{})
	sessionID := "rs_66666666666666666666666666666666"
	key := testSessionKey(t)
	host, _ := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host.Close()
	viewer, resp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewer.Close()
	if resp["type"] != "paired" {
		t.Fatalf("viewer response = %v", resp)
	}
	readControl(t, host) // paired notice

	// Declare a frame larger than 2 MiB; the relay must close the session
	// without reading the payload.
	var hdr [5]byte
	binary.BigEndian.PutUint32(hdr[:4], MaxFrameBytes+1)
	hdr[4] = FrameVideo
	if _, err := host.Write(hdr[:]); err != nil {
		t.Fatalf("write oversize header: %v", err)
	}
	expectClosed(t, viewer)
}

func TestRelayRejectsUnknownFrameType(t *testing.T) {
	addr := startRelay(t, Config{})
	sessionID := "rs_77777777777777777777777777777777"
	key := testSessionKey(t)
	host, _ := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host.Close()
	viewer, resp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewer.Close()
	if resp["type"] != "paired" {
		t.Fatalf("viewer response = %v", resp)
	}
	readControl(t, host) // paired notice

	if err := WriteFrame(host, 0x7f, []byte("nope")); err != nil {
		t.Fatalf("write bad type: %v", err)
	}
	// The offending endpoint is told why; the session is closed for both.
	errFrame := readControl(t, host)
	if errFrame["code"] != CodeBadFrameType {
		t.Fatalf("host error = %v, want bad_frame_type", errFrame)
	}
	expectClosed(t, viewer)
}

func TestRelayIdleTimeout(t *testing.T) {
	addr := startRelay(t, Config{
		IdleTimeout:  150 * time.Millisecond,
		ReapInterval: 25 * time.Millisecond,
	})
	sessionID := "rs_88888888888888888888888888888888"
	key := testSessionKey(t)
	host, _ := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host.Close()
	viewer, resp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewer.Close()
	if resp["type"] != "paired" {
		t.Fatalf("viewer response = %v", resp)
	}
	readControl(t, host) // paired notice

	// No traffic: both endpoints are closed with an idle-timeout notice.
	_ = viewer.SetReadDeadline(time.Now().Add(3 * time.Second))
	closed := readControl(t, viewer)
	if closed["code"] != CodeIdleTimeout {
		t.Fatalf("viewer close code = %v, want idle_timeout", closed)
	}
	_ = host.SetReadDeadline(time.Now().Add(3 * time.Second))
	hostClosed := readControl(t, host)
	if hostClosed["code"] != CodeIdleTimeout {
		t.Fatalf("host close code = %v, want idle_timeout", hostClosed)
	}
	expectClosed(t, host)
}

func TestRelaySessionMaxAge(t *testing.T) {
	addr := startRelay(t, Config{
		IdleTimeout:   10 * time.Second,
		MaxSessionAge: 150 * time.Millisecond,
		ReapInterval:  25 * time.Millisecond,
	})
	sessionID := "rs_99999999999999999999999999999999"
	key := testSessionKey(t)
	host, _ := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleHost, key))
	defer host.Close()
	viewer, resp := connect(t, addr, signedHello(t, testKey(t), sessionID, RoleViewer, key))
	defer viewer.Close()
	if resp["type"] != "paired" {
		t.Fatalf("viewer response = %v", resp)
	}
	readControl(t, host)

	// Traffic keeps the session "active", but max age still wins.
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if err := WriteFrame(host, FrameVideo, []byte{0x01}); err != nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = viewer.SetReadDeadline(time.Now().Add(3 * time.Second))
	var codes []any
	for {
		typ, payload, err := ReadFrame(viewer, MaxFrameBytes)
		if err != nil {
			break
		}
		if typ == FrameControl {
			v, _ := canon.Parse(payload)
			codes = append(codes, v.(map[string]any)["code"])
		}
	}
	if len(codes) == 0 || codes[len(codes)-1] != CodeSessionMaxAge {
		t.Fatalf("viewer close codes = %v, want last session_max_age", codes)
	}
}

func TestRelayHandshakeTimeout(t *testing.T) {
	addr := startRelay(t, Config{HandshakeTimeout: 100 * time.Millisecond})
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := ReadFrame(conn, MaxFrameBytes); err == nil {
		t.Fatalf("expected handshake timeout to close the connection")
	}
}

func TestFrameCodecRoundTrip(t *testing.T) {
	var buf []byte
	w := &sliceWriter{&buf}
	if err := WriteFrame(w, FrameVideo, []byte("jpeg-bytes")); err != nil {
		t.Fatalf("write: %v", err)
	}
	typ, payload, err := ReadFrame(bytesReader(buf), MaxFrameBytes)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if typ != FrameVideo || string(payload) != "jpeg-bytes" {
		t.Fatalf("round trip = type %d payload %q", typ, payload)
	}
}

func TestFrameCodecRejectsOversizeWrite(t *testing.T) {
	var buf []byte
	w := &sliceWriter{&buf}
	if err := WriteFrame(w, FrameVideo, make([]byte, MaxFrameBytes)); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("oversize write: %v", err)
	}
}

func TestFrameCodecRejectsOversizeRead(t *testing.T) {
	var hdr [5]byte
	binary.BigEndian.PutUint32(hdr[:4], MaxFrameBytes+1)
	hdr[4] = FrameVideo
	if _, _, err := ReadFrame(bytesReader(hdr[:]), MaxFrameBytes); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("oversize read: %v", err)
	}
}

func TestFrameCodecRejectsEmptyFrame(t *testing.T) {
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], 0)
	if _, _, err := ReadFrame(bytesReader(hdr[:]), MaxFrameBytes); !errors.Is(err, ErrFrameShort) {
		t.Fatalf("empty frame: %v", err)
	}
}

type sliceWriter struct{ buf *[]byte }

func (w *sliceWriter) Write(p []byte) (int, error) {
	*w.buf = append(*w.buf, p...)
	return len(p), nil
}

type bytesReaderT struct {
	buf []byte
	pos int
}

func bytesReader(b []byte) io.Reader { return &bytesReaderT{buf: b} }

func (r *bytesReaderT) Read(p []byte) (int, error) {
	if r.pos >= len(r.buf) {
		return 0, io.EOF
	}
	n := copy(p, r.buf[r.pos:])
	r.pos += n
	return n, nil
}
