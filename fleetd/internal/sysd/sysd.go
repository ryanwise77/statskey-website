// Package sysd manages systemd transient units for job execution. The D-Bus
// transport is Linux-only (sysd_linux.go); unit property construction is
// pure and fully testable, and the Manager interface has an in-memory fake
// for tests.
//
// Property names and value shapes follow the systemd D-Bus API (verified
// against systemd v257 sources): timeouts/quotas are microseconds ("t"),
// SystemCallFilter/RestrictAddressFamilies are (bas) allow-list structs,
// AppArmorProfile is (bs) with ignore=false (fail closed when the profile
// cannot be applied).
package sysd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	systemddbus "github.com/coreos/go-systemd/v22/dbus"
	godbus "github.com/godbus/dbus/v5"

	"statskey/fleetd/internal/wire"
)

// JobUnitPrefix namespaces every job unit the daemon creates.
const JobUnitPrefix = "statskey-fleet-job-"

// UnitName derives the systemd unit name for a ticket. The ticket ID is
// already a validated opaque token, so the name contains no caller data.
func UnitName(ticketID string) string {
	return JobUnitPrefix + ticketID + ".service"
}

// UnitState is the daemon's view of a job unit.
type UnitState struct {
	Name           string
	LoadState      string // "loaded", "not-found", ...
	ActiveState    string // "active", "inactive", "failed", ...
	SubState       string // "running", "exited", ...
	Result         string // service result: "success", "exit-code", "signal", "timeout", ...
	ExecMainStatus int    // main process exit status (0 when unknown)
}

// Gone reports whether the unit no longer exists.
func (s UnitState) Gone() bool { return s.LoadState == "not-found" }

// Active reports whether the unit is (still) running.
func (s UnitState) Active() bool {
	return s.ActiveState == "active" || s.ActiveState == "activating"
}

// Manager is the daemon's systemd control surface.
type Manager interface {
	// StartTransientUnit starts a fully specified transient unit. It must
	// fail if a unit with the same name already exists (mode "fail").
	StartTransientUnit(ctx context.Context, name string, props []Property) error
	// StopUnit stops a unit; stopping a missing unit is success.
	StopUnit(ctx context.Context, name string) error
	// GetUnitState reports the unit's current state.
	GetUnitState(ctx context.Context, name string) (UnitState, error)
	// ListJobUnits returns the names of all known units with the job prefix,
	// including inactive ones (for orphan cleanup at startup).
	ListJobUnits(ctx context.Context) ([]string, error)
	// CgroupPath resolves the unit's anchored cgroup directory.
	CgroupPath(ctx context.Context, name string) (string, error)
	// Version returns the systemd version string (attestation).
	Version(ctx context.Context) (string, error)
	// Close releases the connection.
	Close()
}

// Property is a systemd D-Bus unit property.
type Property = systemddbus.Property

// JobUnitSpec parameterizes a job unit. Every field is daemon-derived from
// validated ticket data; nothing caller-controlled reaches a property value
// unchecked.
type JobUnitSpec struct {
	TicketID         string
	Description      string
	RunnerPath       string // /usr/libexec/statskey-fleet-runner
	RequestPath      string // root-owned request file, delivered via LoadCredential
	WorkspacePath    string // absolute /var/lib/statskey-fleet-jobs/<ticketID>
	StateDirectory   string // relative to /var/lib: statskey-fleet-jobs/<ticketID>
	LogPath          string // root-owned append log
	Limits           wire.ResourceLimits
	NetworkProfileID string // "none" → PrivateNetwork
	AppArmorProfile  string // e.g. "statskey-fleet-job"; empty → omit
	DaemonUnit       string // BindsTo target, e.g. statskey-fleetd.service
}

// allowListFilter encodes a (bas) D-Bus struct: allow-list flag + values.
type allowListFilter struct {
	AllowList bool
	Values    []string
}

// appArmorSetting encodes the (bs) AppArmorProfile struct. Ignore=false
// makes profile application mandatory (fail closed).
type appArmorSetting struct {
	Ignore  bool
	Profile string
}

// restrictNamespacesAll is CLONE_NEWNS|NEWTIME|NEWUTS|NEWIPC|NEWPID|NEWNET|
// NEWCGROUP|NEWUSER — the unit-file "RestrictNamespaces=yes" mask.
const restrictNamespacesAll = 0x00020000 | 0x00000080 | 0x04000000 |
	0x08000000 | 0x20000000 | 0x40000000 | 0x02000000 | 0x10000000

func prop(name string, value any) Property {
	return systemddbus.Property{Name: name, Value: godbus.MakeVariant(value)}
}

// Credential is a systemd LoadCredential entry. On D-Bus, LoadCredential is
// a(ss): (name, source path) pairs — confirmed against systemd 259 by bus
// monitor capture of systemd-run. systemd reads the root-owned source file
// and delivers it through the unit's read-only credentials tmpfs.
type Credential struct {
	Name   string
	Source string
}

// Prop builds one D-Bus property (exported for probes and tests).
func Prop(name string, value any) Property { return prop(name, value) }

// TestProp is Prop; the probe binary uses it to bisect property acceptance.
func TestProp(name string, value any) Property { return prop(name, value) }

// PrepUnitName derives the fetch-phase unit name for a ticket.
func PrepUnitName(ticketID string) string {
	return "statskey-fleet-prep-" + ticketID + ".service"
}

// PrepAppArmorProfile is the network-enabled companion profile for prep
// units. It ships in the same package as the job profile.
const PrepAppArmorProfile = "statskey-fleet-prep"

// unitMode selects the execution phase a property set is built for.
type unitMode int

const (
	modeJob  unitMode = iota // no network; verify checkout, then exec
	modePrep                 // network enabled; fetch + checkout only
)

// BuildJobUnitProperties renders the full hardening property set of
// FLEETD_DESIGN.md "Job unit properties (minimum)". Resource values are the
// effective (already clamped to host ceilings) limits.
func BuildJobUnitProperties(spec JobUnitSpec) ([]Property, error) {
	return buildUnitProperties(spec, modeJob)
}

// BuildPrepUnitProperties renders the fetch-phase unit: identical hardening
// except network is enabled (git fetch needs it) and the runner stops after
// materializing the pinned checkout. No repository-controlled code executes
// in this unit — git runs with hooks, filters, and credential helpers off.
func BuildPrepUnitProperties(spec JobUnitSpec) ([]Property, error) {
	return buildUnitProperties(spec, modePrep)
}

func buildUnitProperties(spec JobUnitSpec, mode unitMode) ([]Property, error) {
	if !wire.TicketIDPattern.MatchString(spec.TicketID) {
		return nil, errors.New("sysd: invalid ticket ID")
	}
	if spec.RunnerPath == "" || spec.RequestPath == "" || spec.WorkspacePath == "" {
		return nil, errors.New("sysd: runner, request, and workspace paths are required")
	}
	if spec.Limits.CPUMilli < 1 || spec.Limits.MemoryBytes < 1 || spec.Limits.Pids < 1 || spec.Limits.WallTimeMs < 1 {
		return nil, errors.New("sysd: limits must be positive")
	}
	desc := spec.Description
	if desc == "" {
		desc = "StatsKey Fleet job " + spec.TicketID
		if mode == modePrep {
			desc = "StatsKey Fleet fetch " + spec.TicketID
		}
	}
	daemonUnit := spec.DaemonUnit
	if daemonUnit == "" {
		daemonUnit = "statskey-fleetd.service"
	}
	execArgv := []string{spec.RunnerPath, "@fleet-request", spec.WorkspacePath}
	if mode == modePrep {
		execArgv = []string{spec.RunnerPath, "--prepare", "@fleet-request", spec.WorkspacePath}
	}
	// CPUQuota: cpuMilli/1000 cores → per-second CPU time in usec.
	cpuQuotaUSec := uint64(spec.Limits.CPUMilli) * 1000
	props := []Property{
		prop("Description", desc),
		prop("Type", "exec"),
		// The request file lives in the daemon's 0700 root-only state dir, so
		// the job user cannot read it directly. systemd reads it as root at
		// unit start and delivers it through the read-only credentials tmpfs;
		// the runner resolves the "@" sentinel via $CREDENTIALS_DIRECTORY.
		prop("LoadCredential", []Credential{{Name: "fleet-request", Source: spec.RequestPath}}),
		systemddbus.PropExecStart(execArgv, false),
		prop("DynamicUser", true),
		prop("Delegate", false),
		prop("KillMode", "control-group"),
		prop("SendSIGKILL", true),
		prop("TimeoutStopUSec", uint64(30_000_000)), // 30s
		prop("NoNewPrivileges", true),
		prop("CapabilityBoundingSet", uint64(0)),
		prop("AmbientCapabilities", uint64(0)),
		prop("PrivateTmp", true),
		prop("PrivateDevices", true),
		prop("ProtectSystem", "strict"),
		prop("ProtectHome", "yes"),
		prop("ProtectKernelTunables", true),
		prop("ProtectKernelModules", true),
		prop("ProtectKernelLogs", true),
		prop("ProtectControlGroups", true),
		prop("ProtectClock", true),
		prop("ProtectHostname", true),
		prop("LockPersonality", true),
		prop("MemoryDenyWriteExecute", true),
		prop("RestrictNamespaces", uint64(restrictNamespacesAll)),
		prop("RestrictAddressFamilies", allowListFilter{
			AllowList: true,
			Values:    []string{"AF_UNIX", "AF_INET", "AF_INET6", "AF_NETLINK"},
		}),
		prop("SystemCallFilter", allowListFilter{
			AllowList: true,
			Values:    []string{"@system-service"},
		}),
		prop("SystemCallErrorNumber", int32(1)), // EPERM
		prop("DevicePolicy", "closed"),
		prop("TasksMax", uint64(spec.Limits.Pids)),
		prop("MemoryMax", uint64(spec.Limits.MemoryBytes)),
		prop("MemorySwapMax", uint64(0)),
		prop("CPUQuotaPerSecUSec", cpuQuotaUSec),
		prop("CPUWeight", uint64(100)),
		prop("IOWeight", uint64(100)),
		prop("RuntimeMaxUSec", uint64(spec.Limits.WallTimeMs)*1000),
		prop("ReadWritePaths", []string{spec.WorkspacePath}),
		prop("StateDirectory", []string{spec.StateDirectory}),
		prop("BindsTo", []string{daemonUnit}),
		// D-Bus accepts only the plain output modes for StandardOutput; file
		// appending goes through the dedicated *FileToAppend properties.
		prop("StandardOutputFileToAppend", spec.LogPath),
		prop("StandardErrorFileToAppend", spec.LogPath),
	}
	// networkProfileId "none" gets a private (empty) network namespace: the
	// tightest enforcement of "no network". Prep units are the exception:
	// they exist to fetch, so they keep host network with the prep profile's
	// AppArmor network rules as the mediating layer.
	if mode == modeJob && spec.NetworkProfileID == "none" {
		props = append(props, prop("PrivateNetwork", true))
	}
	profile := spec.AppArmorProfile
	if mode == modePrep && profile != "" {
		profile = PrepAppArmorProfile
	}
	if profile != "" {
		props = append(props, prop("AppArmorProfile", appArmorSetting{
			Ignore:  false,
			Profile: profile,
		}))
	}
	return props, nil
}

// ---------------------------------------------------------------------------
// in-memory fake for tests
// ---------------------------------------------------------------------------

// FakeUnit is the fake's per-unit record.
type FakeUnit struct {
	Name       string
	Props      []Property
	State      UnitState
	CgroupDir  string // test-controlled directory used by cgroupx
	StopCount  int
	StartCount int
}

// Fake is an in-memory Manager. It records started units and lets tests
// script failures and state transitions. When CgroupRoot is set, started
// units get a real cgroup-shaped directory (cgroup.events populated=1,
// cgroup.kill) so tests exercise the real cgroupx code.
type Fake struct {
	mu         sync.Mutex
	Units      map[string]*FakeUnit
	CgroupRoot string

	StartErr error // returned by the next StartTransientUnit, then cleared
	StopErr  error

	// KeepPopulatedOnStop simulates an uninterruptible remnant: the unit's
	// cgroup stays populated after stop (and after cgroup.kill).
	KeepPopulatedOnStop bool

	// OnStop, when set, is invoked after a unit is marked stopped.
	OnStop func(name string)
	// PrepResult/PrepExitStatus control the fake prep unit's terminal state
	// (default: success/0). Set before StartTransientUnit to model a failed
	// fetch.
	PrepResult     string
	PrepExitStatus int
}

// NewFake returns an empty fake Manager.
func NewFake() *Fake {
	return &Fake{Units: map[string]*FakeUnit{}}
}

func (f *Fake) StartTransientUnit(_ context.Context, name string, props []Property) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.StartErr != nil {
		err := f.StartErr
		f.StartErr = nil
		return err
	}
	if _, exists := f.Units[name]; exists {
		return fmt.Errorf("sysd fake: unit %s already exists", name)
	}
	u := &FakeUnit{
		Name:  name,
		Props: props,
		State: UnitState{
			Name:        name,
			LoadState:   "loaded",
			ActiveState: "active",
			SubState:    "running",
		},
		StartCount: 1,
	}
	if f.CgroupRoot != "" {
		dir := filepath.Join(f.CgroupRoot, "system.slice", name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "cgroup.events"), []byte("populated 1\n"), 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "cgroup.kill"), nil, 0o644); err != nil {
			return err
		}
		u.CgroupDir = dir
	}
	// Prep units model a fetch that completes immediately: empty cgroup plus
	// the runner's result marker in the workspace (parsed from the unit's
	// ReadWritePaths), so the daemon's settlement-based prep wait returns.
	// Tests that need a failed fetch set PrepResult before starting.
	if strings.HasPrefix(name, "statskey-fleet-prep-") {
		result := f.PrepResult
		status := f.PrepExitStatus
		if result == "" {
			result = "success"
		}
		u.State.ActiveState = "inactive"
		u.State.SubState = "exited"
		u.State.Result = result
		u.State.ExecMainStatus = status
		if u.CgroupDir != "" {
			os.WriteFile(filepath.Join(u.CgroupDir, "cgroup.events"), []byte("populated 0\n"), 0o644)
		}
		for _, p := range props {
			if p.Name == "ReadWritePaths" {
				if paths, ok := p.Value.Value().([]string); ok && len(paths) > 0 {
					marker := "ok"
					if result != "success" || status != 0 {
						marker = "failed: simulated fetch failure"
					}
					os.MkdirAll(paths[0], 0o755)
					os.WriteFile(filepath.Join(paths[0], ".statskey-prep-result"), []byte(marker), 0o644)
				}
			}
		}
	}
	f.Units[name] = u
	return nil
}

func (f *Fake) StopUnit(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.StopErr != nil {
		return f.StopErr
	}
	u, ok := f.Units[name]
	if !ok {
		return nil // stopping a missing unit is success
	}
	u.StopCount++
	u.State.ActiveState = "inactive"
	u.State.SubState = "dead"
	if u.State.Result == "" {
		u.State.Result = "success"
	}
	// A stopped unit's processes are dead: its cgroup empties (unless the
	// test simulates an uninterruptible remnant).
	if u.CgroupDir != "" && !f.KeepPopulatedOnStop {
		os.WriteFile(filepath.Join(u.CgroupDir, "cgroup.events"), []byte("populated 0\n"), 0o644)
	}
	if f.OnStop != nil {
		f.OnStop(name)
	}
	return nil
}

func (f *Fake) GetUnitState(_ context.Context, name string) (UnitState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.Units[name]
	if !ok {
		return UnitState{Name: name, LoadState: "not-found", ActiveState: "inactive"}, nil
	}
	return u.State, nil
}

func (f *Fake) ListJobUnits(_ context.Context) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for name := range f.Units {
		out = append(out, name)
	}
	return out, nil
}

func (f *Fake) CgroupPath(_ context.Context, name string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.Units[name]
	if !ok || u.CgroupDir == "" {
		return "", fmt.Errorf("sysd fake: no cgroup for %s", name)
	}
	// Report the path systemd would report on a real host.
	return "/sys/fs/cgroup/system.slice/" + name, nil
}

// UnitCount returns the number of known units (test helper, locked).
func (f *Fake) UnitCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Units)
}

// UnitCgroupDir returns the unit's local cgroup dir (test helper, locked).
func (f *Fake) UnitCgroupDir(name string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.Units[name]; ok {
		return u.CgroupDir
	}
	return ""
}

func (f *Fake) Close() {}

// Version returns a fake systemd version.
func (f *Fake) Version(context.Context) (string, error) { return "257", nil }

// CompleteUnit marks a unit exited with the given status (test helper).
func (f *Fake) CompleteUnit(name string, exitStatus int, result string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.Units[name]; ok {
		u.State.ActiveState = "inactive"
		u.State.SubState = "exited"
		u.State.Result = result
		u.State.ExecMainStatus = exitStatus
	}
}
