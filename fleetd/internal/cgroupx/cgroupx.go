// Package cgroupx implements cgroup v2 settlement for job units: reading
// cgroup.events "populated", waiting until a cgroup is empty, and writing
// cgroup.kill. It operates on plain paths so tests exercise the real code
// against temporary directories; only the daemon anchors paths to the real
// cgroupfs (resolved via systemd unit identity, never caller input).
//
// A cgroup directory that no longer exists is empty: the kernel removes a
// cgroup only when it has no processes, and job processes cannot migrate
// (ProtectControlGroups, no delegation).
package cgroupx

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"statskey/fleetd/internal/wire"
)

var (
	ErrNotEmpty    = errors.New("cgroupx: cgroup still populated")
	ErrBadEvents   = errors.New("cgroupx: unparsable cgroup.events")
	ErrInvalidPath = errors.New("cgroupx: invalid cgroup path")
)

// validatePath enforces an anchored absolute path with no dot segments. The
// daemon only ever passes systemd-resolved unit cgroup paths.
func validatePath(p string) error {
	if p == "" || p[0] != '/' {
		return ErrInvalidPath
	}
	for _, seg := range strings.Split(p[1:], "/") {
		if seg == "" || seg == "." || seg == ".." {
			return ErrInvalidPath
		}
	}
	return nil
}

// Populated reads <path>/cgroup.events and reports the "populated" value.
// A missing cgroup directory is empty (see package doc).
func Populated(cgroupPath string) (bool, error) {
	if err := validatePath(cgroupPath); err != nil {
		return false, err
	}
	b, err := os.ReadFile(filepath.Join(cgroupPath, "cgroup.events"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("cgroupx: read cgroup.events: %w", err)
	}
	return parsePopulated(b)
}

func parsePopulated(b []byte) (bool, error) {
	for line := range strings.Lines(string(b)) {
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		if key == "populated" {
			switch strings.TrimSpace(value) {
			case "0":
				return false, nil
			case "1":
				return true, nil
			default:
				return false, ErrBadEvents
			}
		}
	}
	return false, ErrBadEvents
}

// WaitEmpty polls until the cgroup is empty or ctx/timeout expires. It
// returns ErrNotEmpty on timeout (fail closed: no settlement while any
// process remains).
func WaitEmpty(ctx context.Context, cgroupPath string, timeout, pollInterval time.Duration) error {
	if pollInterval <= 0 {
		pollInterval = 50 * time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	for {
		pop, err := Populated(cgroupPath)
		if err != nil {
			return err
		}
		if !pop {
			return nil
		}
		if time.Now().After(deadline) {
			return ErrNotEmpty
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}

// Kill writes "1" to <path>/cgroup.kill, SIGKILLing every process in the
// cgroup and its descendants (kernel >= 5.14).
func Kill(cgroupPath string) error {
	if err := validatePath(cgroupPath); err != nil {
		return err
	}
	killFile := filepath.Join(cgroupPath, "cgroup.kill")
	f, err := os.OpenFile(killFile, os.O_WRONLY, 0)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil // cgroup already gone
		}
		return fmt.Errorf("cgroupx: open cgroup.kill: %w", err)
	}
	defer f.Close()
	if _, err := f.WriteString("1"); err != nil {
		return fmt.Errorf("cgroupx: write cgroup.kill: %w", err)
	}
	return nil
}

// ReadAccounting collects best-effort resource accounting from the cgroup:
// cpu.stat usage_usec, memory.peak (fallback memory.current), pids.peak
// (fallback pids.current), and summed io.stat rbytes/wbytes. Missing files
// yield zero values; the receipt records what the kernel gave us.
func ReadAccounting(cgroupPath string) (wire.ResourceAccounting, error) {
	if err := validatePath(cgroupPath); err != nil {
		return wire.ResourceAccounting{}, err
	}
	var a wire.ResourceAccounting
	if v, err := readStatValue(cgroupPath, "cpu.stat", "usage_usec"); err == nil {
		a.CPUUsageNs = v * 1000
	}
	if v, err := readIntFile(cgroupPath, "memory.peak"); err == nil {
		a.MemoryPeakBytes = v
	} else if v, err := readIntFile(cgroupPath, "memory.current"); err == nil {
		a.MemoryPeakBytes = v
	}
	if v, err := readIntFile(cgroupPath, "pids.peak"); err == nil {
		a.PidsPeak = v
	} else if v, err := readIntFile(cgroupPath, "pids.current"); err == nil {
		a.PidsPeak = v
	}
	if b, err := os.ReadFile(filepath.Join(cgroupPath, "io.stat")); err == nil {
		a.IOReadBytes, a.IOWriteBytes = parseIOStat(b)
	}
	return a, nil
}

func readStatValue(dir, file, key string) (int64, error) {
	b, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		return 0, err
	}
	for line := range strings.Lines(string(b)) {
		k, v, ok := strings.Cut(strings.TrimSpace(line), " ")
		if ok && k == key {
			return strconv.ParseInt(v, 10, 64)
		}
	}
	return 0, fmt.Errorf("cgroupx: %s missing key %s", file, key)
}

func readIntFile(dir, file string) (int64, error) {
	b, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
}

// parseIOStat sums rbytes/wbytes across devices. Lines look like:
// "8:0 rbytes=123 wbytes=456 rios=1 wios=2 dbytes=0 dios=0".
func parseIOStat(b []byte) (read, written int64) {
	for line := range strings.Lines(string(b)) {
		for field := range strings.FieldsSeq(line) {
			k, v, ok := strings.Cut(field, "=")
			if !ok {
				continue
			}
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				continue
			}
			switch k {
			case "rbytes":
				read += n
			case "wbytes":
				written += n
			}
		}
	}
	return read, written
}
