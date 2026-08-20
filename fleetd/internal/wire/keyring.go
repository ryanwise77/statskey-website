package wire

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"statskey/fleetd/internal/keys"
)

// KeyRing is the pinned set of coordinator public keys
// (/etc/statskey/fleetd/coordinator-keys.json). A signature verifies when any
// pinned key verifies; key IDs let the daemon and agent pin a specific
// signing key where the protocol carries one.
type KeyRing struct {
	byID map[string]ed25519.PublicKey
}

type keyRingFile struct {
	Version int `json:"version"`
	Keys    []struct {
		KeyID         string `json:"keyId"`
		PublicKeySpki string `json:"publicKeySpki"`
	} `json:"keys"`
}

// LoadKeyRing reads and validates a coordinator key ring file.
func LoadKeyRing(path string) (*KeyRing, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("wire: read key ring: %w", err)
	}
	if len(raw) > 64*1024 {
		return nil, errors.New("wire: key ring file too large")
	}
	var f keyRingFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("wire: parse key ring: %w", err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("wire: unsupported key ring version %d", f.Version)
	}
	if len(f.Keys) == 0 || len(f.Keys) > 16 {
		return nil, errors.New("wire: key ring must contain 1..16 keys")
	}
	kr := &KeyRing{byID: make(map[string]ed25519.PublicKey, len(f.Keys))}
	for _, k := range f.Keys {
		if !ResponseKeyIDPattern.MatchString(k.KeyID) {
			return nil, fmt.Errorf("wire: bad coordinator key id %q", k.KeyID)
		}
		pub, _, err := keys.ParsePublicKeySPKI(k.PublicKeySpki)
		if err != nil {
			return nil, fmt.Errorf("wire: key ring entry %q: %w", k.KeyID, err)
		}
		if _, dup := kr.byID[k.KeyID]; dup {
			return nil, fmt.Errorf("wire: duplicate key id %q", k.KeyID)
		}
		kr.byID[k.KeyID] = pub
	}
	return kr, nil
}

// NewKeyRing builds a ring from already-parsed keys.
func NewKeyRing(entries map[string]ed25519.PublicKey) (*KeyRing, error) {
	if len(entries) == 0 || len(entries) > 16 {
		return nil, errors.New("wire: key ring must contain 1..16 keys")
	}
	kr := &KeyRing{byID: make(map[string]ed25519.PublicKey, len(entries))}
	for id, pub := range entries {
		if !ResponseKeyIDPattern.MatchString(id) {
			return nil, fmt.Errorf("wire: bad coordinator key id %q", id)
		}
		kr.byID[id] = pub
	}
	return kr, nil
}

// PublicKeys returns all pinned keys (for try-any verification).
func (kr *KeyRing) PublicKeys() []ed25519.PublicKey {
	out := make([]ed25519.PublicKey, 0, len(kr.byID))
	for _, pub := range kr.byID {
		out = append(out, pub)
	}
	return out
}

// ByID returns the pinned key for a key ID.
func (kr *KeyRing) ByID(id string) (ed25519.PublicKey, bool) {
	pub, ok := kr.byID[id]
	return pub, ok
}

// Len reports the number of pinned keys.
func (kr *KeyRing) Len() int { return len(kr.byID) }
