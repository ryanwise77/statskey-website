// sysdprobe bisects StartTransientUnit property acceptance on a live systemd:
// each property from BuildJobUnitProperties is tried individually over a
// minimal base, and failures are printed with the property name. Run as root
// on a systemd host. Deletes every unit it creates.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"statskey/fleetd/internal/sysd"
	"statskey/fleetd/internal/wire"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	mgr, err := sysd.NewSystemManager(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "manager:", err)
		os.Exit(1)
	}
	defer mgr.Close()

	spec := sysd.JobUnitSpec{
		TicketID:         "ticket_0123456789abcdef0123456789abcdef",
		RunnerPath:       "/bin/true",
		RequestPath:      "/etc/hostname",
		WorkspacePath:    "/tmp/sysdprobe-ws",
		StateDirectory:   "statskey-fleet-jobs/ticket_0123456789abcdef0123456789abcdef",
		LogPath:          "/tmp/sysdprobe.log",
		Limits:           wire.ResourceLimits{CPUMilli: 1000, MemoryBytes: 1 << 30, Pids: 64, DiskBytes: 1 << 30, WallTimeMs: 60000},
		NetworkProfileID: "none",
		AppArmorProfile:  "",
	}
	props, err := sysd.BuildJobUnitProperties(spec)
	if err != nil {
		fmt.Fprintln(os.Stderr, "build:", err)
		os.Exit(1)
	}

	base := []sysd.Property{}
	for _, p := range props {
		if p.Name == "Description" || p.Name == "Type" || p.Name == "ExecStart" {
			base = append(base, p)
		}
	}
	// Clear leftovers from earlier probe runs.
	for _, p := range props {
		_ = mgr.StopUnit(ctx, "sysdprobe-"+p.Name+".service")
	}
	for i := range 4 {
		_ = mgr.StopUnit(ctx, fmt.Sprintf("sysdprobe-variant-%d.service", i))
	}

	failed := 0
	for _, p := range props {
		if p.Name == "Description" || p.Name == "Type" || p.Name == "ExecStart" {
			continue
		}
		unit := "sysdprobe-" + p.Name + ".service"
		try := append(append([]sysd.Property{}, base...), p)
		err := mgr.StartTransientUnit(ctx, unit, try)
		if err != nil {
			fmt.Printf("FAIL  %s: %v\n", p.Name, err)
			failed++
			continue
		}
		fmt.Printf("ok    %s\n", p.Name)
		_ = mgr.StopUnit(ctx, unit)
	}
	// Variant probes: what D-Bus encodings does this systemd accept?
	type variant struct {
		name  string
		props []sysd.Property
	}
	variants := []variant{
		{"StandardOutputFileToAppend", []sysd.Property{sysd.TestProp("StandardOutputFileToAppend", "/tmp/sysdprobe.log")}},
		{"StandardErrorFileToAppend", []sysd.Property{sysd.TestProp("StandardErrorFileToAppend", "/tmp/sysdprobe.log")}},
		{"StandardOutput=journal", []sysd.Property{sysd.TestProp("StandardOutput", "journal")}},
		{"LoadCredential=a(ss)-path", []sysd.Property{sysd.TestProp("LoadCredential", []sysd.Credential{{Name: "probe", Source: "/etc/hostname"}})}},
	}
	for i, v := range variants {
		unit := fmt.Sprintf("sysdprobe-variant-%d.service", i)
		try := append(append([]sysd.Property{}, base...), v.props...)
		if err := mgr.StartTransientUnit(ctx, unit, try); err != nil {
			fmt.Printf("FAIL  %s: %v\n", v.name, err)
			failed++
			continue
		}
		fmt.Printf("ok    %s\n", v.name)
		_ = mgr.StopUnit(ctx, unit)
	}
	if failed > 0 {
		os.Exit(1)
	}
}
