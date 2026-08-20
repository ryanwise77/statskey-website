package cgroupx

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func makeCgroup(t *testing.T, populated string) string {
	t.Helper()
	dir := t.TempDir()
	cg := filepath.Join(dir, "sys", "fs", "cgroup", "system.slice", "job.service")
	if err := os.MkdirAll(cg, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cg, "cgroup.events"), []byte("populated "+populated+"\nfrozen 0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return cg
}

func TestPopulated(t *testing.T) {
	pop, err := Populated(makeCgroup(t, "1"))
	if err != nil || !pop {
		t.Fatalf("populated=1: pop=%v err=%v", pop, err)
	}
	pop, err = Populated(makeCgroup(t, "0"))
	if err != nil || pop {
		t.Fatalf("populated=0: pop=%v err=%v", pop, err)
	}
	// Missing cgroup directory is empty.
	pop, err = Populated(filepath.Join(t.TempDir(), "gone"))
	if err != nil || pop {
		t.Fatalf("missing cgroup: pop=%v err=%v", pop, err)
	}
	// Malformed events file fails closed.
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "cgroup.events"), []byte("garbage\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Populated(dir); !errors.Is(err, ErrBadEvents) {
		t.Fatalf("malformed: %v", err)
	}
	// Path escapes rejected.
	for _, bad := range []string{"", "relative", "/sys/fs/cgroup/../x", "/sys//fs"} {
		if _, err := Populated(bad); !errors.Is(err, ErrInvalidPath) {
			t.Fatalf("path %q: %v", bad, err)
		}
	}
}

func TestWaitEmpty(t *testing.T) {
	cg := makeCgroup(t, "1")
	// Flip to empty after 100ms.
	go func() {
		time.Sleep(100 * time.Millisecond)
		os.WriteFile(filepath.Join(cg, "cgroup.events"), []byte("populated 0\n"), 0o644)
	}()
	ctx := context.Background()
	if err := WaitEmpty(ctx, cg, 5*time.Second, 10*time.Millisecond); err != nil {
		t.Fatalf("WaitEmpty: %v", err)
	}
	// Timeout while still populated fails closed.
	cg2 := makeCgroup(t, "1")
	if err := WaitEmpty(ctx, cg2, 120*time.Millisecond, 20*time.Millisecond); !errors.Is(err, ErrNotEmpty) {
		t.Fatalf("timeout: %v", err)
	}
	// Context cancellation.
	ctx2, cancel := context.WithCancel(ctx)
	cancel()
	if err := WaitEmpty(ctx2, cg2, 5*time.Second, 10*time.Millisecond); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestKill(t *testing.T) {
	cg := makeCgroup(t, "1")
	if err := os.WriteFile(filepath.Join(cg, "cgroup.kill"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Kill(cg); err != nil {
		t.Fatalf("Kill: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(cg, "cgroup.kill"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "1" {
		t.Fatalf("cgroup.kill = %q", b)
	}
	// Killing a gone cgroup is a no-op.
	if err := Kill(filepath.Join(t.TempDir(), "gone")); err != nil {
		t.Fatalf("Kill gone: %v", err)
	}
}

func TestReadAccounting(t *testing.T) {
	cg := makeCgroup(t, "0")
	files := map[string]string{
		"cpu.stat":        "usage_usec 123456\nuser_usec 100000\nsystem_usec 23456\n",
		"memory.peak":     "1073741824\n",
		"pids.current":    "7\n",
		"io.stat":         "8:0 rbytes=1000 wbytes=2000 rios=1 wios=2\n8:16 rbytes=500 wbytes=250\n",
		"cgroup.pressure": "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(cg, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a, err := ReadAccounting(cg)
	if err != nil {
		t.Fatal(err)
	}
	if a.CPUUsageNs != 123456*1000 {
		t.Fatalf("cpu ns = %d", a.CPUUsageNs)
	}
	if a.MemoryPeakBytes != 1073741824 {
		t.Fatalf("mem peak = %d", a.MemoryPeakBytes)
	}
	if a.PidsPeak != 7 {
		t.Fatalf("pids = %d", a.PidsPeak)
	}
	if a.IOReadBytes != 1500 || a.IOWriteBytes != 2250 {
		t.Fatalf("io = %d/%d", a.IOReadBytes, a.IOWriteBytes)
	}
	// Empty cgroup dir: all zeros, no error.
	a2, err := ReadAccounting(filepath.Join(t.TempDir(), "empty"))
	if err != nil {
		t.Fatal(err)
	}
	if a2.CPUUsageNs != 0 || a2.MemoryPeakBytes != 0 {
		t.Fatalf("expected zeros, got %+v", a2)
	}
}
