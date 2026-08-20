//go:build linux

package sysd

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	systemddbus "github.com/coreos/go-systemd/v22/dbus"
)

// DBusManager is the real systemd D-Bus Manager.
type DBusManager struct {
	conn *systemddbus.Conn
}

// NewSystemManager connects to the system bus and subscribes to job signals
// (required for job-completion notification channels to fire).
func NewSystemManager(ctx context.Context) (*DBusManager, error) {
	conn, err := systemddbus.NewSystemConnectionContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("sysd: connect system bus: %w", err)
	}
	if err := conn.Subscribe(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("sysd: subscribe: %w", err)
	}
	return &DBusManager{conn: conn}, nil
}

// waitJob waits for a queued job's completion signal, mapping systemd job
// results to errors.
func waitJob(ctx context.Context, ch <-chan string, op, name string) error {
	select {
	case result := <-ch:
		switch result {
		case "done":
			return nil
		case "canceled":
			// A stop job for an already-gone unit is fine.
			return nil
		default:
			return fmt.Errorf("sysd: %s %s: job result %q", op, name, result)
		}
	case <-ctx.Done():
		return fmt.Errorf("sysd: %s %s: %w", op, name, ctx.Err())
	}
}

func (m *DBusManager) StartTransientUnit(ctx context.Context, name string, props []Property) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	ch := make(chan string, 1)
	if _, err := m.conn.StartTransientUnitContext(ctx, name, "fail", props, ch); err != nil {
		return fmt.Errorf("sysd: start %s: %w", name, err)
	}
	return waitJob(ctx, ch, "start", name)
}

func (m *DBusManager) StopUnit(ctx context.Context, name string) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	ch := make(chan string, 1)
	_, err := m.conn.StopUnitContext(ctx, name, "replace", ch)
	if err != nil {
		// Stopping a unit that does not exist is success (idempotent stop).
		if strings.Contains(err.Error(), "not loaded") || strings.Contains(err.Error(), "NoSuchUnit") {
			return nil
		}
		return fmt.Errorf("sysd: stop %s: %w", name, err)
	}
	if err := waitJob(ctx, ch, "stop", name); err != nil {
		if strings.Contains(err.Error(), "not loaded") {
			return nil
		}
		return err
	}
	return nil
}

func (m *DBusManager) GetUnitState(ctx context.Context, name string) (UnitState, error) {
	st := UnitState{Name: name, LoadState: "not-found", ActiveState: "inactive"}
	load, err := m.conn.GetUnitPropertyContext(ctx, name, "LoadState")
	if err != nil {
		// Unknown unit: systemd answers with an error; treat as gone.
		return st, nil
	}
	if s, ok := load.Value.Value().(string); ok {
		st.LoadState = s
	}
	if st.LoadState == "not-found" {
		return st, nil
	}
	if p, err := m.conn.GetUnitPropertyContext(ctx, name, "ActiveState"); err == nil {
		if s, ok := p.Value.Value().(string); ok {
			st.ActiveState = s
		}
	}
	if p, err := m.conn.GetUnitPropertyContext(ctx, name, "SubState"); err == nil {
		if s, ok := p.Value.Value().(string); ok {
			st.SubState = s
		}
	}
	if p, err := m.conn.GetUnitTypePropertyContext(ctx, name, "Service", "Result"); err == nil {
		if s, ok := p.Value.Value().(string); ok {
			st.Result = s
		}
	}
	if p, err := m.conn.GetUnitTypePropertyContext(ctx, name, "Service", "ExecMainStatus"); err == nil {
		switch v := p.Value.Value().(type) {
		case int32:
			st.ExecMainStatus = int(v)
		case uint32:
			st.ExecMainStatus = int(v)
		}
	}
	return st, nil
}

func (m *DBusManager) ListJobUnits(ctx context.Context) ([]string, error) {
	units, err := m.conn.ListUnitsByPatternsContext(ctx, nil, []string{JobUnitPrefix + "*.service"})
	if err != nil {
		return nil, fmt.Errorf("sysd: list job units: %w", err)
	}
	out := make([]string, 0, len(units))
	for _, u := range units {
		out = append(out, u.Name)
	}
	return out, nil
}

func (m *DBusManager) CgroupPath(ctx context.Context, name string) (string, error) {
	p, err := m.conn.GetUnitPropertyContext(ctx, name, "ControlGroup")
	if err != nil {
		return "", fmt.Errorf("sysd: cgroup path for %s: %w", name, err)
	}
	s, _ := p.Value.Value().(string)
	if s == "" {
		return "", errors.New("sysd: unit has no cgroup")
	}
	return s, nil
}

// Version returns the systemd manager version string.
func (m *DBusManager) Version(ctx context.Context) (string, error) {
	v, err := m.conn.GetManagerProperty("Version")
	if err != nil {
		return "", fmt.Errorf("sysd: manager version: %w", err)
	}
	// GetManagerProperty returns the raw variant rendering (quoted).
	return strings.Trim(v, `"`), nil
}

func (m *DBusManager) Close() { m.conn.Close() }
