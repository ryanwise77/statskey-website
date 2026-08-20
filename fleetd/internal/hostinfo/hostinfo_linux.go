//go:build linux

package hostinfo

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"

	"statskey/fleetd/internal/wire"
)

// Probe collects host facts. systemdVersion comes from the D-Bus Manager
// Version property (passed in by the caller, which owns the connection);
// appArmorProfilePath is the shipped profile file to digest (empty when no
// profile is configured).
func Probe(systemdVersion string, appArmorProfilePath string) (Facts, error) {
	var f Facts

	bootID, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return f, fmt.Errorf("hostinfo: boot id: %w", err)
	}
	if f.BootIDDigest, err = BootIDDigest(string(bootID)); err != nil {
		return f, err
	}

	osRelease, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return f, fmt.Errorf("hostinfo: os-release: %w", err)
	}
	id, versionID, err := ParseOSRelease(string(osRelease))
	if err != nil {
		return f, err
	}

	var uts unix.Utsname
	if err := unix.Uname(&uts); err != nil {
		return f, fmt.Errorf("hostinfo: uname: %w", err)
	}
	kernel := unix.ByteSliceToString(uts.Release[:])
	machine := unix.ByteSliceToString(uts.Machine[:])

	sv, err := ParseSystemdVersion(systemdVersion)
	if err != nil {
		return f, err
	}

	// cgroup v2: the unified hierarchy has cgroup.controllers at its root.
	if _, err := os.Stat("/sys/fs/cgroup/cgroup.controllers"); err != nil {
		return f, fmt.Errorf("hostinfo: cgroup v2 required: %w", err)
	}
	// cgroup.kill support (kernel >= 5.14). The file exists only in non-root
	// cgroups, so probe by creating a real cgroup and checking inside it.
	probe := "/sys/fs/cgroup/statskey-fleetd-hostinfo.probe"
	if err := os.Mkdir(probe, 0o755); err != nil {
		return f, fmt.Errorf("hostinfo: cgroup probe create: %w", err)
	}
	_, killErr := os.Stat(filepath.Join(probe, "cgroup.kill"))
	if err := os.Remove(probe); err != nil {
		return f, fmt.Errorf("hostinfo: cgroup probe remove: %w", err)
	}
	if killErr != nil {
		return f, fmt.Errorf("hostinfo: cgroup.kill required: %w", killErr)
	}

	f.Platform = wire.PlatformInfo{
		ID:             id,
		VersionID:      versionID,
		Arch:           machine,
		KernelRelease:  kernel,
		CgroupVersion:  2,
		SystemdVersion: sv,
	}

	// AppArmor: enforcing when the module is enabled; the profile digest
	// binds the exact shipped profile.
	aaEnforcing := false
	if b, err := os.ReadFile("/sys/module/apparmor/parameters/enabled"); err == nil {
		aaEnforcing = strings.TrimSpace(string(b)) == "Y"
	}
	digest := ""
	if appArmorProfilePath != "" {
		digest, err = DigestFileHex(appArmorProfilePath)
		if err != nil {
			return f, fmt.Errorf("hostinfo: apparmor profile digest: %w", err)
		}
	} else {
		// No profile configured: record a digest of the empty profile and
		// report not-enforcing so policy can fail closed.
		digest = DigestBytesHex([]byte{})
		aaEnforcing = false
	}
	f.Security = wire.SecurityInfo{
		CgroupKill:            true,
		Delegated:             false,
		AppArmorEnforcing:     aaEnforcing,
		AppArmorProfileDigest: digest,
	}
	return f, nil
}
