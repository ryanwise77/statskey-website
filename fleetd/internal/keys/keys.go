// Package keys implements the Ed25519 key handling of the Fleet wire
// protocol, byte-compatible with fleetAuth.js:
//
//   - public keys are SPKI DER, base64url (unpadded) encoded
//   - key IDs are "sha256:<base64url>" of the SHA-256 over the canonical
//     SPKI bytes
//   - device IDs are "dev_<first 16 bytes of the same digest, hex>"
//
// Signatures are Ed25519 over canonical JSON bytes.
package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
)

var (
	ErrInvalidPublicKey  = errors.New("keys: invalid Ed25519 SPKI public key")
	ErrNonCanonicalSPKI  = errors.New("keys: SPKI encoding is not canonical")
	ErrInvalidSignature  = errors.New("keys: invalid Ed25519 signature encoding")
	ErrInvalidPrivateKey = errors.New("keys: invalid Ed25519 private key")
)

var base64urlPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Generate creates a new Ed25519 keypair.
func Generate() (ed25519.PrivateKey, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("keys: generate: %w", err)
	}
	return priv, nil
}

// PrivateFromSeed derives the Ed25519 private key for a 32-byte seed.
func PrivateFromSeed(seed []byte) (ed25519.PrivateKey, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("%w: seed must be 32 bytes", ErrInvalidPrivateKey)
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// ParsePrivateKey validates a raw 64-byte Ed25519 private key (the on-disk
// format for helper.key and device.key) and checks its public half matches
// the derived key, catching corruption.
func ParsePrivateKey(raw []byte) (ed25519.PrivateKey, error) {
	if len(raw) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("%w: must be %d bytes", ErrInvalidPrivateKey, ed25519.PrivateKeySize)
	}
	priv := ed25519.PrivateKey(append([]byte(nil), raw...))
	derived := ed25519.NewKeyFromSeed(priv.Seed())
	if !derived.Public().(ed25519.PublicKey).Equal(priv.Public()) {
		return nil, fmt.Errorf("%w: public half does not match seed", ErrInvalidPrivateKey)
	}
	return priv, nil
}

// Public returns the public half of priv.
func Public(priv ed25519.PrivateKey) ed25519.PublicKey {
	return priv.Public().(ed25519.PublicKey)
}

// Sign signs msg with priv.
func Sign(priv ed25519.PrivateKey, msg []byte) []byte {
	return ed25519.Sign(priv, msg)
}

// Verify reports whether sig is a valid Ed25519 signature of msg under pub.
func Verify(pub ed25519.PublicKey, msg, sig []byte) bool {
	return ed25519.Verify(pub, msg, sig)
}

// SPKIDER returns the canonical SPKI DER encoding of pub (44 bytes for
// Ed25519), identical to node's export({format:"der",type:"spki"}).
func SPKIDER(pub ed25519.PublicKey) ([]byte, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPublicKey, err)
	}
	return der, nil
}

// SPKIBase64url returns the canonical base64url SPKI string.
func SPKIBase64url(pub ed25519.PublicKey) (string, error) {
	der, err := SPKIDER(pub)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(der), nil
}

// ParsePublicKeySPKI decodes and validates a base64url SPKI public key with
// the same checks as normalizePublicKeySpki in fleetAuth.js: bounded length,
// base64url alphabet, canonical (unpadded, round-trip stable) encoding,
// Ed25519 algorithm, and canonical DER (re-marshal must equal input).
func ParsePublicKeySPKI(s string) (ed25519.PublicKey, []byte, error) {
	if len(s) < 40 || len(s) > 256 || !base64urlPattern.MatchString(s) {
		return nil, nil, fmt.Errorf("%w: bad shape", ErrInvalidPublicKey)
	}
	der, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: bad base64url", ErrInvalidPublicKey)
	}
	if base64.RawURLEncoding.EncodeToString(der) != s {
		return nil, nil, fmt.Errorf("%w: %v", ErrNonCanonicalSPKI, "base64url not round-trip stable")
	}
	key, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: unparseable DER", ErrInvalidPublicKey)
	}
	pub, ok := key.(ed25519.PublicKey)
	if !ok {
		return nil, nil, fmt.Errorf("%w: not Ed25519", ErrInvalidPublicKey)
	}
	canonical, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil || subtle.ConstantTimeCompare(canonical, der) != 1 {
		return nil, nil, fmt.Errorf("%w: DER re-encode differs", ErrNonCanonicalSPKI)
	}
	return pub, der, nil
}

// KeyID returns "sha256:<base64url>" of SHA-256 over the canonical SPKI
// bytes (publicKeyFingerprint in fleetAuth.js).
func KeyID(pub ed25519.PublicKey) (string, error) {
	der, err := SPKIDER(pub)
	if err != nil {
		return "", err
	}
	return KeyIDFromDER(der), nil
}

// KeyIDFromDER derives the key ID from already-validated SPKI DER bytes.
func KeyIDFromDER(der []byte) string {
	sum := sha256.Sum256(der)
	return "sha256:" + base64.RawURLEncoding.EncodeToString(sum[:])
}

// DeviceID returns "dev_<32 lowercase hex>" from the first 16 bytes of the
// SPKI SHA-256 digest (deviceIdentityForPublicKey in fleetAuth.js).
func DeviceID(pub ed25519.PublicKey) (string, error) {
	der, err := SPKIDER(pub)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(der)
	return "dev_" + hex.EncodeToString(sum[:16]), nil
}

// ParseSignature decodes a base64url Ed25519 signature with the fleetAuth.js
// shape checks (80..100 base64url chars, canonical encoding, 64 raw bytes).
func ParseSignature(s string) ([]byte, error) {
	if len(s) < 80 || len(s) > 100 || !base64urlPattern.MatchString(s) {
		return nil, fmt.Errorf("%w: bad shape", ErrInvalidSignature)
	}
	sig, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("%w: bad base64url", ErrInvalidSignature)
	}
	if base64.RawURLEncoding.EncodeToString(sig) != s {
		return nil, fmt.Errorf("%w: not canonical base64url", ErrInvalidSignature)
	}
	if len(sig) != ed25519.SignatureSize {
		return nil, fmt.Errorf("%w: must decode to 64 bytes", ErrInvalidSignature)
	}
	return sig, nil
}

// EncodeSignature returns the canonical base64url form of a raw signature.
func EncodeSignature(sig []byte) (string, error) {
	if len(sig) != ed25519.SignatureSize {
		return "", fmt.Errorf("%w: must be 64 bytes", ErrInvalidSignature)
	}
	return base64.RawURLEncoding.EncodeToString(sig), nil
}
