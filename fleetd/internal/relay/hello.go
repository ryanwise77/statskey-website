package relay

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

// RemoteHelloV1 is the first frame every endpoint sends after connecting.
// It is a canonical-JSON object signed by the endpoint's device key and binds
// the session ID, the endpoint role, and a short expiry. The relay verifies
// the signature against the public key carried in the hello itself; the
// control plane is responsible for delivering matching session key material
// to both sides, and the relay only ever compares the SHA-256 hash each side
// presents.
//
//	{
//	  "domain": "statskey.fleet.remote-hello.v1",
//	  "sessionId": "rs_<32 lowercase hex>",
//	  "role": "host" | "viewer",
//	  "deviceId": "dev_<32 lowercase hex>",
//	  "publicKeySpki": "<base64url SPKI DER>",
//	  "ephemeralPublicKey": "<base64url SPKI DER>",
//	  "sessionKeyHash": "sha256:<base64url>",
//	  "issuedAt": "<RFC3339 ms UTC>",
//	  "expiresAt": "<RFC3339 ms UTC>",
//	  "signature": "<base64url Ed25519 over canonical bytes without signature>"
//	}
//
// publicKeySpki is the endpoint's enrolled device key and signs the hello.
// ephemeralPublicKey is the per-session key the control plane recorded for
// this side in the session document; the relay shape-checks it so the
// handshake is bound to the control-plane session record, and a future
// protocol version can pin it.
const DomainRemoteHelloV1 = "statskey.fleet.remote-hello.v1"

const (
	RoleHost   = "host"
	RoleViewer = "viewer"
)

const (
	// MaxHelloLifetime bounds issuedAt→expiresAt; a hello is a handshake
	// credential, not session authority, so it lives at most 10 minutes.
	MaxHelloLifetime = 10 * time.Minute
	// ClockSkew matches the Fleet device API tolerance.
	ClockSkew = 30 * time.Second
)

var (
	// SessionIDPattern matches rs_<32 lowercase hex>.
	SessionIDPattern = regexp.MustCompile(`^rs_[a-f0-9]{32}$`)

	ErrHelloExpired   = errors.New("relay: hello is expired or not yet valid")
	ErrHelloLifetime  = errors.New("relay: hello lifetime exceeds 10 minutes")
	ErrDeviceMismatch = errors.New("relay: device id does not match the hello public key")
	ErrBadKeyHash     = errors.New("relay: session key hash is invalid")
)

// Hello is a decoded RemoteHelloV1.
type Hello struct {
	SessionID          string
	Role               string
	DeviceID           string
	PublicKeySPKI      string
	EphemeralPublicKey string
	SessionKeyHash     string
	IssuedAt           time.Time
	ExpiresAt          time.Time
	Signature          string
}

func (h *Hello) unsignedMap() map[string]any {
	return map[string]any{
		"domain":             DomainRemoteHelloV1,
		"sessionId":          h.SessionID,
		"role":               h.Role,
		"deviceId":           h.DeviceID,
		"publicKeySpki":      h.PublicKeySPKI,
		"ephemeralPublicKey": h.EphemeralPublicKey,
		"sessionKeyHash":     h.SessionKeyHash,
		"issuedAt":           wire.FormatTimestamp(h.IssuedAt),
		"expiresAt":          wire.FormatTimestamp(h.ExpiresAt),
	}
}

// Map returns the full canonical form including the signature.
func (h *Hello) Map() map[string]any {
	m := h.unsignedMap()
	m["signature"] = h.Signature
	return m
}

// Marshal returns the canonical encoding of the signed hello.
func (h *Hello) Marshal() ([]byte, error) { return canon.Encode(h.Map()) }

// Sign sets h.Signature over the canonical unsigned bytes.
func (h *Hello) Sign(priv ed25519.PrivateKey) error {
	b, err := canon.Encode(h.unsignedMap())
	if err != nil {
		return err
	}
	s, err := keys.EncodeSignature(keys.Sign(priv, b))
	if err != nil {
		return err
	}
	h.Signature = s
	return nil
}

// SessionKeyHashText returns the canonical "sha256:<base64url>" form of the
// SHA-256 over a 256-bit session key. Both endpoints present this value; the
// relay stores and compares hashes only.
func SessionKeyHashText(sessionKey []byte) (string, error) {
	if len(sessionKey) != 32 {
		return "", ErrBadKeyHash
	}
	sum := sha256.Sum256(sessionKey)
	return "sha256:" + base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// DecodeHello strictly parses canonical hello bytes.
func DecodeHello(b []byte) (*Hello, error) {
	o, err := wire.ParseObj(b)
	if err != nil {
		return nil, err
	}
	h := &Hello{}
	domain, err := o.Str("domain", nil)
	if err != nil {
		return nil, err
	}
	if domain != DomainRemoteHelloV1 {
		return nil, wire.ErrDomain
	}
	if h.SessionID, err = o.Str("sessionId", SessionIDPattern); err != nil {
		return nil, err
	}
	if h.Role, err = o.StrEnum("role", RoleHost, RoleViewer); err != nil {
		return nil, err
	}
	if h.DeviceID, err = o.Str("deviceId", wire.DeviceIDPattern); err != nil {
		return nil, err
	}
	if h.PublicKeySPKI, err = o.Str("publicKeySpki", nil); err != nil {
		return nil, err
	}
	if h.EphemeralPublicKey, err = o.Str("ephemeralPublicKey", nil); err != nil {
		return nil, err
	}
	if _, _, err := keys.ParsePublicKeySPKI(h.EphemeralPublicKey); err != nil {
		return nil, err
	}
	if h.SessionKeyHash, err = o.Str("sessionKeyHash", wire.DigestB64Pattern); err != nil {
		return nil, err
	}
	if h.IssuedAt, err = o.Time("issuedAt"); err != nil {
		return nil, err
	}
	if h.ExpiresAt, err = o.Time("expiresAt"); err != nil {
		return nil, err
	}
	if !h.ExpiresAt.After(h.IssuedAt) {
		return nil, ErrHelloLifetime
	}
	if h.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(h.Signature); err != nil {
		return nil, err
	}
	return h, o.Done()
}

// Verify checks the hello signature against the embedded public key, binds
// the device ID to that key, and enforces the expiry window. now may be nil,
// in which case time.Now is used.
func (h *Hello) Verify(now time.Time) error {
	pub, _, err := keys.ParsePublicKeySPKI(h.PublicKeySPKI)
	if err != nil {
		return err
	}
	deviceID, err := keys.DeviceID(pub)
	if err != nil {
		return err
	}
	if deviceID != h.DeviceID {
		return ErrDeviceMismatch
	}
	if h.ExpiresAt.Sub(h.IssuedAt) > MaxHelloLifetime {
		return ErrHelloLifetime
	}
	if now.IsZero() {
		now = time.Now()
	}
	if h.IssuedAt.After(now.Add(ClockSkew)) || !h.ExpiresAt.After(now) {
		return ErrHelloExpired
	}
	sig, err := keys.ParseSignature(h.Signature)
	if err != nil {
		return err
	}
	b, err := canon.Encode(h.unsignedMap())
	if err != nil {
		return err
	}
	if !keys.Verify(pub, b, sig) {
		return wire.ErrSignatureInvalid
	}
	return nil
}
