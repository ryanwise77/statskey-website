package keys

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// LoadPrivateKeyFile reads a raw 64-byte Ed25519 private key file.
func LoadPrivateKeyFile(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParsePrivateKey(raw)
}

// SavePrivateKeyFile atomically writes a private key file with mode 0600.
func SavePrivateKeyFile(path string, priv ed25519.PrivateKey) error {
	if len(priv) != ed25519.PrivateKeySize {
		return ErrInvalidPrivateKey
	}
	return writeFileAtomicMode(path, []byte(priv), 0o600)
}

// LoadOrCreatePrivateKeyFile loads the key at path, generating and storing a
// new one when absent. created reports whether a new key was generated.
func LoadOrCreatePrivateKeyFile(path string) (priv ed25519.PrivateKey, created bool, err error) {
	priv, err = LoadPrivateKeyFile(path)
	if err == nil {
		return priv, false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, false, fmt.Errorf("keys: load %s: %w", path, err)
	}
	priv, err = Generate()
	if err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, false, err
	}
	if err := SavePrivateKeyFile(path, priv); err != nil {
		return nil, false, err
	}
	return priv, true, nil
}

// SavePublicKeyFile writes the base64url SPKI public key (0644).
func SavePublicKeyFile(path string, pub ed25519.PublicKey) error {
	spki, err := SPKIBase64url(pub)
	if err != nil {
		return err
	}
	return writeFileAtomicMode(path, []byte(spki+"\n"), 0o644)
}

// writeFileAtomicMode writes data atomically (write-fsync-rename) with mode.
func writeFileAtomicMode(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".keytmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
