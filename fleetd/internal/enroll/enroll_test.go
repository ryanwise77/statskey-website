package enroll

import (
	"os"
	"path/filepath"
	"testing"

	"statskey/fleetd/internal/keys"
)

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := &Store{Dir: filepath.Join(dir, "agent")}

	priv, created, err := store.LoadOrCreateDeviceKey()
	if err != nil || !created {
		t.Fatalf("create: created=%v err=%v", created, err)
	}
	// Key file permissions.
	st, err := os.Stat(store.keyPath())
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("key mode = %o", st.Mode().Perm())
	}
	st, err = os.Stat(store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode = %o", st.Mode().Perm())
	}
	// Reload: same key, not created.
	priv2, created2, err := store.LoadOrCreateDeviceKey()
	if err != nil || created2 {
		t.Fatalf("reload: created=%v err=%v", created2, err)
	}
	if !priv.Equal(priv2) {
		t.Fatal("key changed across reload")
	}

	devID, err := keys.DeviceID(keys.Public(priv))
	if err != nil {
		t.Fatal(err)
	}
	coordPriv, _ := keys.Generate()
	spki, _ := keys.SPKIBase64url(keys.Public(coordPriv))

	e := &Enrollment{
		Version:                  1,
		Endpoint:                 "https://fleet.example.com/device",
		CoordinatorKeyID:         "coord-1",
		CoordinatorPublicKeySpki: spki,
		DeviceID:                 devID,
	}
	if err := store.SaveEnrollment(e); err != nil {
		t.Fatal(err)
	}
	st, err = os.Stat(store.enrollmentPath())
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("enrollment mode = %o", st.Mode().Perm())
	}
	loaded, err := store.LoadEnrollment()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Endpoint != e.Endpoint || loaded.DeviceID != devID || loaded.CoordinatorKeyID != "coord-1" {
		t.Fatalf("loaded: %+v", loaded)
	}
}

func TestEnrollmentValidation(t *testing.T) {
	coordPriv, _ := keys.Generate()
	spki, _ := keys.SPKIBase64url(keys.Public(coordPriv))
	base := Enrollment{
		Version: 1, Endpoint: "https://fleet.example.com",
		CoordinatorKeyID: "coord-1", CoordinatorPublicKeySpki: spki,
		DeviceID: "dev_0123456789abcdef0123456789abcdef",
	}
	if err := base.Validate(); err != nil {
		t.Fatalf("valid enrollment rejected: %v", err)
	}
	badCases := []func(e *Enrollment){
		func(e *Enrollment) { e.Version = 2 },
		func(e *Enrollment) { e.Endpoint = "http://fleet.example.com" },
		func(e *Enrollment) { e.Endpoint = "https://user:pw@fleet.example.com" },
		func(e *Enrollment) { e.CoordinatorKeyID = "X" },
		func(e *Enrollment) { e.CoordinatorPublicKeySpki = "!!!" },
		func(e *Enrollment) { e.DeviceID = "dev_short" },
	}
	for i, mutate := range badCases {
		e := base
		mutate(&e)
		if err := e.Validate(); err == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
}

func TestCandidatePayload(t *testing.T) {
	priv, _ := keys.Generate()
	c, err := CandidatePayload("build-box-1", keys.Public(priv), 1)
	if err != nil {
		t.Fatal(err)
	}
	if c.Role != "worker" || c.WorkerMode != "dedicated" || c.Platform != "linux" {
		t.Fatalf("candidate: %+v", c)
	}
	if c.PublicKeySpki == "" || c.Label != "build-box-1" || c.MaxConcurrentJobs != 1 {
		t.Fatalf("candidate: %+v", c)
	}
	if _, err := CandidatePayload("", keys.Public(priv), 1); err == nil {
		t.Fatal("accepted empty label")
	}
	if _, err := CandidatePayload("x", keys.Public(priv), 0); err == nil {
		t.Fatal("accepted zero max jobs")
	}
}
