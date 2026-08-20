package sysd

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"statskey/fleetd/internal/wire"
)

func testSpec() JobUnitSpec {
	return JobUnitSpec{
		TicketID:       "ticket_0123456789abcdef0123456789abcdef",
		RunnerPath:     "/usr/libexec/statskey-fleet-runner",
		RequestPath:    "/var/lib/statskey-fleetd/jobs/ticket_0123456789abcdef0123456789abcdef/request.json",
		WorkspacePath:  "/var/lib/statskey-fleet-jobs/ticket_0123456789abcdef0123456789abcdef",
		StateDirectory: "statskey-fleet-jobs/ticket_0123456789abcdef0123456789abcdef",
		LogPath:        "/var/lib/statskey-fleetd/jobs/ticket_0123456789abcdef0123456789abcdef/job.log",
		Limits: wire.ResourceLimits{
			CPUMilli:    4000,
			MemoryBytes: 8589934592,
			Pids:        256,
			DiskBytes:   21474836480,
			WallTimeMs:  3600000,
		},
		NetworkProfileID: "none",
		AppArmorProfile:  "statskey-fleet-job",
	}
}

func propMap(t *testing.T, props []Property) map[string]any {
	t.Helper()
	m := map[string]any{}
	for _, p := range props {
		if _, dup := m[p.Name]; dup {
			t.Fatalf("duplicate property %s", p.Name)
		}
		m[p.Name] = p.Value.Value()
	}
	return m
}

func TestBuildJobUnitProperties(t *testing.T) {
	props, err := BuildJobUnitProperties(testSpec())
	if err != nil {
		t.Fatal(err)
	}
	m := propMap(t, props)

	expect := map[string]any{
		"Type":                       "exec",
		"DynamicUser":                true,
		"Delegate":                   false,
		"KillMode":                   "control-group",
		"SendSIGKILL":                true,
		"TimeoutStopUSec":            uint64(30_000_000),
		"NoNewPrivileges":            true,
		"CapabilityBoundingSet":      uint64(0),
		"AmbientCapabilities":        uint64(0),
		"PrivateTmp":                 true,
		"PrivateDevices":             true,
		"ProtectSystem":              "strict",
		"ProtectHome":                "yes",
		"ProtectKernelTunables":      true,
		"ProtectKernelModules":       true,
		"ProtectKernelLogs":          true,
		"ProtectControlGroups":       true,
		"ProtectClock":               true,
		"ProtectHostname":            true,
		"LockPersonality":            true,
		"MemoryDenyWriteExecute":     true,
		"RestrictNamespaces":         uint64(restrictNamespacesAll),
		"SystemCallErrorNumber":      int32(1),
		"DevicePolicy":               "closed",
		"TasksMax":                   uint64(256),
		"MemoryMax":                  uint64(8589934592),
		"MemorySwapMax":              uint64(0),
		"CPUQuotaPerSecUSec":         uint64(4_000_000), // 4000 milli = 400%
		"CPUWeight":                  uint64(100),
		"IOWeight":                   uint64(100),
		"RuntimeMaxUSec":             uint64(3_600_000_000),
		"PrivateNetwork":             true,
		"StandardOutputFileToAppend": "/var/lib/statskey-fleetd/jobs/ticket_0123456789abcdef0123456789abcdef/job.log",
		"StandardErrorFileToAppend":  "/var/lib/statskey-fleetd/jobs/ticket_0123456789abcdef0123456789abcdef/job.log",
	}
	for name, want := range expect {
		got, ok := m[name]
		if !ok {
			t.Fatalf("missing property %s", name)
		}
		if got != want {
			t.Fatalf("property %s = %#v, want %#v", name, got, want)
		}
	}

	// Allow-list filters.
	scf, ok := m["SystemCallFilter"].(allowListFilter)
	if !ok || !scf.AllowList || len(scf.Values) != 1 || scf.Values[0] != "@system-service" {
		t.Fatalf("SystemCallFilter = %#v", m["SystemCallFilter"])
	}
	raf, ok := m["RestrictAddressFamilies"].(allowListFilter)
	if !ok || !raf.AllowList || len(raf.Values) != 4 {
		t.Fatalf("RestrictAddressFamilies = %#v", m["RestrictAddressFamilies"])
	}
	aa, ok := m["AppArmorProfile"].(appArmorSetting)
	if !ok || aa.Ignore || aa.Profile != "statskey-fleet-job" {
		t.Fatalf("AppArmorProfile = %#v", m["AppArmorProfile"])
	}
	rw, ok := m["ReadWritePaths"].([]string)
	if !ok || len(rw) != 1 || rw[0] != testSpec().WorkspacePath {
		t.Fatalf("ReadWritePaths = %#v", m["ReadWritePaths"])
	}
	binds, ok := m["BindsTo"].([]string)
	if !ok || len(binds) != 1 || binds[0] != "statskey-fleetd.service" {
		t.Fatalf("BindsTo = %#v", m["BindsTo"])
	}
	sd, ok := m["StateDirectory"].([]string)
	if !ok || len(sd) != 1 || sd[0] != testSpec().StateDirectory {
		t.Fatalf("StateDirectory = %#v", m["StateDirectory"])
	}
}

func TestExecStartContent(t *testing.T) {
	props, err := BuildJobUnitProperties(testSpec())
	if err != nil {
		t.Fatal(err)
	}
	m := propMap(t, props)
	v := reflect.ValueOf(m["ExecStart"])
	if v.Kind() != reflect.Slice || v.Len() != 1 {
		t.Fatalf("ExecStart = %v", v)
	}
	cmd := v.Index(0)
	path := cmd.FieldByName("Path").String()
	args := cmd.FieldByName("Args")
	if path != testSpec().RunnerPath {
		t.Fatalf("exec path = %s", path)
	}
	if args.Len() != 3 || args.Index(1).String() != "@fleet-request" || args.Index(2).String() != testSpec().WorkspacePath {
		t.Fatalf("exec args = %v", args)
	}
	cred, ok := m["LoadCredential"]
	if !ok {
		t.Fatal("LoadCredential missing")
	}
	creds, ok := cred.([]Credential)
	if !ok {
		t.Fatalf("LoadCredential type = %T", cred)
	}
	if len(creds) != 1 || creds[0].Name != "fleet-request" || creds[0].Source != testSpec().RequestPath {
		t.Fatalf("LoadCredential = %v", creds)
	}
	// The job log uses the append-file properties (D-Bus rejects append: in
	// StandardOutput).
	if m["StandardOutputFileToAppend"] != testSpec().LogPath ||
		m["StandardErrorFileToAppend"] != testSpec().LogPath {
		t.Fatalf("log properties = %v / %v", m["StandardOutputFileToAppend"], m["StandardErrorFileToAppend"])
	}
}

func TestBuildJobUnitPropertiesNetworkProfile(t *testing.T) {
	spec := testSpec()
	spec.NetworkProfileID = "egress-v1" // a signed non-none profile
	props, err := BuildJobUnitProperties(spec)
	if err != nil {
		t.Fatal(err)
	}
	m := propMap(t, props)
	if _, ok := m["PrivateNetwork"]; ok {
		t.Fatal("PrivateNetwork set for non-none network profile")
	}
}

func TestBuildJobUnitPropertiesRejects(t *testing.T) {
	spec := testSpec()
	spec.TicketID = "bogus"
	if _, err := BuildJobUnitProperties(spec); err == nil {
		t.Fatal("accepted bad ticket id")
	}
	spec = testSpec()
	spec.Limits.Pids = 0
	if _, err := BuildJobUnitProperties(spec); err == nil {
		t.Fatal("accepted zero pids")
	}
	spec = testSpec()
	spec.RunnerPath = ""
	if _, err := BuildJobUnitProperties(spec); err == nil {
		t.Fatal("accepted empty runner path")
	}
}

func TestUnitName(t *testing.T) {
	name := UnitName("ticket_0123456789abcdef0123456789abcdef")
	if !strings.HasPrefix(name, JobUnitPrefix) || !strings.HasSuffix(name, ".service") {
		t.Fatalf("unit name %s", name)
	}
	if !wire.UnitNamePattern.MatchString(name) {
		t.Fatalf("unit name %s does not match wire pattern", name)
	}
}

func TestFakeManager(t *testing.T) {
	f := NewFake()
	ctx := context.Background()
	name := UnitName("ticket_0123456789abcdef0123456789abcdef")

	// Duplicate start fails (mode "fail" semantics).
	if err := f.StartTransientUnit(ctx, name, nil); err != nil {
		t.Fatal(err)
	}
	if err := f.StartTransientUnit(ctx, name, nil); err == nil {
		t.Fatal("duplicate start accepted")
	}
	st, err := f.GetUnitState(ctx, name)
	if err != nil || !st.Active() {
		t.Fatalf("state: %+v err=%v", st, err)
	}
	// Stop is idempotent.
	if err := f.StopUnit(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := f.StopUnit(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := f.StopUnit(ctx, "statskey-fleet-job-ticket_ffffffffffffffffffffffffffffffff.service"); err != nil {
		t.Fatal("stopping missing unit must succeed")
	}
	st, _ = f.GetUnitState(ctx, name)
	if st.Active() {
		t.Fatal("unit still active after stop")
	}
	list, err := f.ListJobUnits(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v err=%v", list, err)
	}
}
