// Package enroll implements the statskey-fleet-enroll enrollment helper:
// device keypair generation, candidate payload rendering for owner approval,
// and storage of the approved enrollment (endpoint, coordinator key pin,
// device ID) with strict permissions.
package enroll

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"statskey/fleetd/internal/fleetclient"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

// Enrollment is the approved device enrollment stored at
// /var/lib/statskey-fleet/enrollment.json (0600).
type Enrollment struct {
	Version                  int    `json:"version"`
	Endpoint                 string `json:"endpoint"`
	CoordinatorKeyID         string `json:"coordinatorKeyId"`
	CoordinatorPublicKeySpki string `json:"coordinatorPublicKeySpki"`
	DeviceID                 string `json:"deviceId"`
}

// Validate enforces every field's shape (fail closed).
func (e *Enrollment) Validate() error {
	if e.Version != 1 {
		return errors.New("enroll: unsupported enrollment version")
	}
	if _, err := fleetclient.NormalizeEndpoint(e.Endpoint, false); err != nil {
		return fmt.Errorf("enroll: endpoint: %w", err)
	}
	if !wire.ResponseKeyIDPattern.MatchString(e.CoordinatorKeyID) {
		return errors.New("enroll: coordinator key id invalid")
	}
	pub, _, err := keys.ParsePublicKeySPKI(e.CoordinatorPublicKeySpki)
	if err != nil {
		return fmt.Errorf("enroll: coordinator public key: %w", err)
	}
	_ = pub
	if !wire.DeviceIDPattern.MatchString(e.DeviceID) {
		return errors.New("enroll: device id invalid")
	}
	return nil
}

// Candidate is the payload printed for owner approval.
type Candidate struct {
	Label             string `json:"label"`
	Role              string `json:"role"`
	WorkerMode        string `json:"workerMode"`
	Platform          string `json:"platform"`
	PublicKeySpki     string `json:"publicKeySpki"`
	MaxConcurrentJobs int64  `json:"maxConcurrentJobs"`
}

// Store manages the device state directory (0700) with the device key
// (0600) and the enrollment file (0600).
type Store struct {
	Dir string
}

func (s *Store) keyPath() string        { return filepath.Join(s.Dir, "device.key") }
func (s *Store) enrollmentPath() string { return filepath.Join(s.Dir, "enrollment.json") }

// EnsureDir creates the state directory with 0700.
func (s *Store) EnsureDir() error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	return os.Chmod(s.Dir, 0o700)
}

// LoadOrCreateDeviceKey loads the device keypair, generating and storing a
// new one (0600) when absent.
func (s *Store) LoadOrCreateDeviceKey() (ed25519.PrivateKey, bool, error) {
	raw, err := os.ReadFile(s.keyPath())
	if err == nil {
		priv, err := keys.ParsePrivateKey(raw)
		return priv, false, err
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, false, err
	}
	priv, err := keys.Generate()
	if err != nil {
		return nil, false, err
	}
	if err := s.EnsureDir(); err != nil {
		return nil, false, err
	}
	if err := writeFilePrivate(s.keyPath(), []byte(priv), 0o600); err != nil {
		return nil, false, err
	}
	return priv, true, nil
}

// CandidatePayload builds the owner-approval payload for a device key.
func CandidatePayload(label string, pub ed25519.PublicKey, maxConcurrentJobs int64) (Candidate, error) {
	if label == "" || len(label) > 128 {
		return Candidate{}, errors.New("enroll: label required (max 128 chars)")
	}
	if maxConcurrentJobs < 1 || maxConcurrentJobs > 64 {
		return Candidate{}, errors.New("enroll: maxConcurrentJobs out of range")
	}
	spki, err := keys.SPKIBase64url(pub)
	if err != nil {
		return Candidate{}, err
	}
	return Candidate{
		Label:             label,
		Role:              "worker",
		WorkerMode:        "dedicated",
		Platform:          "linux",
		PublicKeySpki:     spki,
		MaxConcurrentJobs: maxConcurrentJobs,
	}, nil
}

// SaveEnrollment validates and stores the approved enrollment (0600).
func (s *Store) SaveEnrollment(e *Enrollment) error {
	if err := e.Validate(); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	if err := s.EnsureDir(); err != nil {
		return err
	}
	return writeFilePrivate(s.enrollmentPath(), append(raw, '\n'), 0o600)
}

// LoadEnrollment reads and validates the stored enrollment.
func (s *Store) LoadEnrollment() (*Enrollment, error) {
	raw, err := os.ReadFile(s.enrollmentPath())
	if err != nil {
		return nil, err
	}
	if len(raw) > 16*1024 {
		return nil, errors.New("enroll: enrollment file too large")
	}
	var e Enrollment
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, fmt.Errorf("enroll: parse enrollment: %w", err)
	}
	if err := e.Validate(); err != nil {
		return nil, err
	}
	return &e, nil
}

// writeFilePrivate writes a file atomically with the given mode.
func writeFilePrivate(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
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
