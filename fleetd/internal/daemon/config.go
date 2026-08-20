package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"statskey/fleetd/internal/wire"
)

// Policy is /etc/statskey/fleetd/policy.json: host ceilings, profile
// registry, and policy epoch. The daemon may tighten ticket resources to
// these ceilings, never loosen (invariant 12).
type Policy struct {
	PolicyEpoch        int64
	ExecutionServiceID string
	Ceilings           wire.ResourceLimits
	ExecutorProfileIDs []string
	SandboxProfileIDs  []string
	NetworkProfileIDs  []string
	// AttestationTTLMs bounds attestation lifetime (default 5 minutes).
	AttestationTTLMs int64
	// AppArmorProfile is applied to every job unit (fail closed when set and
	// the profile cannot be applied).
	AppArmorProfile string
}

type policyFile struct {
	Version            int    `json:"version"`
	PolicyEpoch        int64  `json:"policyEpoch"`
	ExecutionServiceID string `json:"executionServiceId"`
	ResourceCeilings   struct {
		CPUMilli    int64 `json:"cpuMilli"`
		MemoryBytes int64 `json:"memoryBytes"`
		Pids        int64 `json:"pids"`
		DiskBytes   int64 `json:"diskBytes"`
		WallTimeMs  int64 `json:"wallTimeMs"`
	} `json:"resourceCeilings"`
	ExecutorProfileIDs []string `json:"executorProfileIds"`
	SandboxProfileIDs  []string `json:"sandboxProfileIds"`
	NetworkProfileIDs  []string `json:"networkProfileIds"`
	AttestationTTLMs   int64    `json:"attestationTtlMs"`
	AppArmorProfile    string   `json:"apparmorProfile"`
}

// LoadPolicy reads and validates policy.json.
func LoadPolicy(path string) (Policy, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Policy{}, fmt.Errorf("daemon: read policy: %w", err)
	}
	if len(raw) > 64*1024 {
		return Policy{}, errors.New("daemon: policy file too large")
	}
	var f policyFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return Policy{}, fmt.Errorf("daemon: parse policy: %w", err)
	}
	if f.Version != 1 {
		return Policy{}, fmt.Errorf("daemon: unsupported policy version %d", f.Version)
	}
	if !wire.ServiceIDPattern.MatchString(f.ExecutionServiceID) {
		return Policy{}, errors.New("daemon: policy executionServiceId invalid")
	}
	if f.PolicyEpoch < 0 {
		return Policy{}, errors.New("daemon: policy epoch invalid")
	}
	p := Policy{
		PolicyEpoch:        f.PolicyEpoch,
		ExecutionServiceID: f.ExecutionServiceID,
		Ceilings: wire.ResourceLimits{
			CPUMilli:    f.ResourceCeilings.CPUMilli,
			MemoryBytes: f.ResourceCeilings.MemoryBytes,
			Pids:        f.ResourceCeilings.Pids,
			DiskBytes:   f.ResourceCeilings.DiskBytes,
			WallTimeMs:  f.ResourceCeilings.WallTimeMs,
		},
		ExecutorProfileIDs: f.ExecutorProfileIDs,
		SandboxProfileIDs:  f.SandboxProfileIDs,
		NetworkProfileIDs:  f.NetworkProfileIDs,
		AttestationTTLMs:   f.AttestationTTLMs,
		AppArmorProfile:    f.AppArmorProfile,
	}
	if p.AttestationTTLMs <= 0 {
		p.AttestationTTLMs = 5 * 60 * 1000
	}
	if p.AttestationTTLMs > 3600_000 {
		return Policy{}, errors.New("daemon: attestation TTL too large")
	}
	if p.Ceilings.CPUMilli < 1 || p.Ceilings.MemoryBytes < 1 || p.Ceilings.Pids < 1 || p.Ceilings.WallTimeMs < 1 {
		return Policy{}, errors.New("daemon: resource ceilings must be positive")
	}
	for _, id := range p.ExecutorProfileIDs {
		if !wire.ProfileIDPattern.MatchString(id) {
			return Policy{}, fmt.Errorf("daemon: bad executor profile id %q", id)
		}
	}
	for _, id := range p.SandboxProfileIDs {
		if !wire.ProfileIDPattern.MatchString(id) {
			return Policy{}, fmt.Errorf("daemon: bad sandbox profile id %q", id)
		}
	}
	for _, id := range p.NetworkProfileIDs {
		if !wire.ProfileIDPattern.MatchString(id) {
			return Policy{}, fmt.Errorf("daemon: bad network profile id %q", id)
		}
	}
	if len(p.ExecutorProfileIDs) == 0 || len(p.SandboxProfileIDs) == 0 || len(p.NetworkProfileIDs) == 0 {
		return Policy{}, errors.New("daemon: profile registries must be non-empty")
	}
	if p.AppArmorProfile != "" && !wire.ProfileIDPattern.MatchString(p.AppArmorProfile) {
		return Policy{}, fmt.Errorf("daemon: bad apparmor profile %q", p.AppArmorProfile)
	}
	return p, nil
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// clampLimits tightens ticket resources to the host ceilings (never loosen).
func clampLimits(ticket, ceiling wire.ResourceLimits) wire.ResourceLimits {
	out := ticket
	out.CPUMilli = min(ticket.CPUMilli, ceiling.CPUMilli)
	out.MemoryBytes = min(ticket.MemoryBytes, ceiling.MemoryBytes)
	out.Pids = min(ticket.Pids, ceiling.Pids)
	out.WallTimeMs = min(ticket.WallTimeMs, ceiling.WallTimeMs)
	if ceiling.DiskBytes > 0 {
		out.DiskBytes = min(ticket.DiskBytes, ceiling.DiskBytes)
	}
	return out
}
