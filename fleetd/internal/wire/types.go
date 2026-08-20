// Package wire defines the Fleet protocol wire types of FLEETD_DESIGN.md:
// HelperAttestationV1, ExecutionTicketV1, LeaseUpdateV1,
// ExecutionStartedReceiptV1, TerminationReceiptV1, and the local IPC frames.
//
// All signed structures are canonical JSON (internal/canon). Decoding is
// strict: unknown fields, bad shapes, out-of-range values, and non-canonical
// bytes all fail closed. Signatures are Ed25519 over the canonical bytes of
// the object without its "signature" field.
package wire

import (
	"crypto/ed25519"
	"errors"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
)

const (
	DomainHelperAttestationV1       = "statskey.fleet.helper-attestation.v1"
	DomainExecutionTicketV1         = "statskey.fleet.execution-ticket.v1"
	DomainLeaseUpdateV1             = "statskey.fleet.lease-update.v1"
	DomainExecutionStartedReceiptV1 = "statskey.fleet.execution-started-receipt.v1"
	DomainTerminationReceiptV1      = "statskey.fleet.termination-receipt.v1"

	// HelperProtocol is the helper protocol version this daemon speaks.
	HelperProtocol = 1
)

var (
	ErrSignatureInvalid = errors.New("wire: signature verification failed")
	ErrDomain           = errors.New("wire: wrong domain")
)

// Bounds for resource fields. The daemon additionally clamps to host policy
// ceilings (it may tighten, never loosen).
const (
	MaxCPUMilli    = 1_000_000
	MaxPids        = 4_194_304
	MaxWallTimeMs  = 7 * 24 * 3600 * 1000 // 7 days
	MaxAttempt     = 1024
	MaxProtocolRev = 64
	MaxPolicyEpoch = 1 << 32
)

// ResourceLimits mirrors the ticket's resources object and the receipts'
// effectiveLimits object.
type ResourceLimits struct {
	CPUMilli    int64
	MemoryBytes int64
	Pids        int64
	DiskBytes   int64
	WallTimeMs  int64
}

func (r ResourceLimits) toMap() map[string]any {
	return map[string]any{
		"cpuMilli":    r.CPUMilli,
		"memoryBytes": r.MemoryBytes,
		"pids":        r.Pids,
		"diskBytes":   r.DiskBytes,
		"wallTimeMs":  r.WallTimeMs,
	}
}

func decodeResourceLimits(o *Obj) (ResourceLimits, error) {
	var r ResourceLimits
	var err error
	if r.CPUMilli, err = o.Int("cpuMilli", 1, MaxCPUMilli); err != nil {
		return r, err
	}
	if r.MemoryBytes, err = o.Int("memoryBytes", 1, canon.MaxSafeInteger); err != nil {
		return r, err
	}
	if r.Pids, err = o.Int("pids", 1, MaxPids); err != nil {
		return r, err
	}
	if r.DiskBytes, err = o.Int("diskBytes", 0, canon.MaxSafeInteger); err != nil {
		return r, err
	}
	if r.WallTimeMs, err = o.Int("wallTimeMs", 1, MaxWallTimeMs); err != nil {
		return r, err
	}
	return r, o.Done()
}

// CommandSpec is the ticket's command object.
type CommandSpec struct {
	Executable       string
	Arguments        []string
	WorkingDirectory string
}

func (c CommandSpec) toMap() map[string]any {
	args := make([]any, len(c.Arguments))
	for i, a := range c.Arguments {
		args[i] = a
	}
	return map[string]any{
		"executable":       c.Executable,
		"arguments":        args,
		"workingDirectory": c.WorkingDirectory,
	}
}

func decodeCommandSpec(o *Obj) (CommandSpec, error) {
	var c CommandSpec
	var err error
	if c.Executable, err = o.Str("executable", ExecutablePattern); err != nil {
		return c, err
	}
	if c.Arguments, err = o.StrSlice("arguments", 64, 4096); err != nil {
		return c, err
	}
	for i, a := range c.Arguments {
		if !validArgument(a) {
			return c, errors.New("wire: command.arguments contains NUL or invalid value")
		}
		_ = i
	}
	if c.WorkingDirectory, err = o.Str("workingDirectory", nil); err != nil {
		return c, err
	}
	if err := ValidateRelativeWorkdir(c.WorkingDirectory); err != nil {
		return c, err
	}
	return c, o.Done()
}

func validArgument(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return false
		}
	}
	return true
}

// ValidateRelativeWorkdir enforces a workspace-relative working directory:
// no absolute paths, no dot-dot escapes, no empty segments.
func ValidateRelativeWorkdir(s string) error {
	if s == "." {
		return nil
	}
	if len(s) == 0 || len(s) > 256 {
		return errors.New("wire: workingDirectory length invalid")
	}
	if s[0] == '/' {
		return errors.New("wire: workingDirectory must be relative")
	}
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == '/' {
			seg := s[start:i]
			if seg == "" || seg == "." || seg == ".." {
				return errors.New("wire: workingDirectory has unsafe segment")
			}
			start = i + 1
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// HelperAttestationV1
// ---------------------------------------------------------------------------

type PlatformInfo struct {
	ID             string
	VersionID      string
	Arch           string
	KernelRelease  string
	CgroupVersion  int64
	SystemdVersion string
}

func (p PlatformInfo) toMap() map[string]any {
	return map[string]any{
		"id":             p.ID,
		"versionId":      p.VersionID,
		"arch":           p.Arch,
		"kernelRelease":  p.KernelRelease,
		"cgroupVersion":  p.CgroupVersion,
		"systemdVersion": p.SystemdVersion,
	}
}

type SecurityInfo struct {
	CgroupKill            bool
	Delegated             bool
	AppArmorEnforcing     bool
	AppArmorProfileDigest string
}

func (s SecurityInfo) toMap() map[string]any {
	return map[string]any{
		"cgroupKill":            s.CgroupKill,
		"delegated":             s.Delegated,
		"apparmorEnforcing":     s.AppArmorEnforcing,
		"apparmorProfileDigest": s.AppArmorProfileDigest,
	}
}

type HelperAttestation struct {
	ChallengeID        string
	ChallengeNonce     string
	DeviceID           string
	ExecutionServiceID string
	HelperInstanceID   string
	BootIDDigest       string
	HelperProtocol     int64
	HelperBuildID      string
	RunnerBuildID      string
	PolicyEpoch        int64
	Platform           PlatformInfo
	Security           SecurityInfo
	IssuedAt           time.Time
	ExpiresAt          time.Time
	Signature          string
}

func (h *HelperAttestation) unsignedMap() map[string]any {
	return map[string]any{
		"domain":             DomainHelperAttestationV1,
		"challengeId":        h.ChallengeID,
		"challengeNonce":     h.ChallengeNonce,
		"deviceId":           h.DeviceID,
		"executionServiceId": h.ExecutionServiceID,
		"helperInstanceId":   h.HelperInstanceID,
		"bootIdDigest":       h.BootIDDigest,
		"helperProtocol":     h.HelperProtocol,
		"helperBuildId":      h.HelperBuildID,
		"runnerBuildId":      h.RunnerBuildID,
		"policyEpoch":        h.PolicyEpoch,
		"platform":           h.Platform.toMap(),
		"security":           h.Security.toMap(),
		"issuedAt":           FormatTimestamp(h.IssuedAt),
		"expiresAt":          FormatTimestamp(h.ExpiresAt),
	}
}

// Map returns the full canonical form including the signature.
func (h *HelperAttestation) Map() map[string]any {
	m := h.unsignedMap()
	m["signature"] = h.Signature
	return m
}

func (h *HelperAttestation) Marshal() ([]byte, error) { return canon.Encode(h.Map()) }

// Sign sets h.Signature over the canonical unsigned bytes.
func (h *HelperAttestation) Sign(priv ed25519.PrivateKey) error {
	return signInto(priv, h.unsignedMap(), &h.Signature)
}

// Verify checks the signature against any of the given public keys.
func (h *HelperAttestation) Verify(pubs ...ed25519.PublicKey) error {
	return verifyAny(h.unsignedMap(), h.Signature, pubs)
}

// DecodeHelperAttestation strictly parses canonical bytes.
func DecodeHelperAttestation(b []byte) (*HelperAttestation, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	h := &HelperAttestation{}
	if err := checkDomain(o, DomainHelperAttestationV1); err != nil {
		return nil, err
	}
	if h.ChallengeID, err = o.Str("challengeId", ChallengeIDPattern); err != nil {
		return nil, err
	}
	if h.ChallengeNonce, err = o.Str("challengeNonce", ChallengeNoncePattern); err != nil {
		return nil, err
	}
	if h.DeviceID, err = o.Str("deviceId", DeviceIDPattern); err != nil {
		return nil, err
	}
	if h.ExecutionServiceID, err = o.Str("executionServiceId", ServiceIDPattern); err != nil {
		return nil, err
	}
	if h.HelperInstanceID, err = o.Str("helperInstanceId", HelperInstanceIDPattern); err != nil {
		return nil, err
	}
	if h.BootIDDigest, err = o.Str("bootIdDigest", DigestB64Pattern); err != nil {
		return nil, err
	}
	if h.HelperProtocol, err = o.Int("helperProtocol", 1, MaxProtocolRev); err != nil {
		return nil, err
	}
	if h.HelperBuildID, err = o.Str("helperBuildId", DigestHexPattern); err != nil {
		return nil, err
	}
	if h.RunnerBuildID, err = o.Str("runnerBuildId", DigestHexPattern); err != nil {
		return nil, err
	}
	if h.PolicyEpoch, err = o.Int("policyEpoch", 0, MaxPolicyEpoch); err != nil {
		return nil, err
	}
	po, err := o.Obj("platform")
	if err != nil {
		return nil, err
	}
	if h.Platform.ID, err = po.Str("id", PlatformIDPattern); err != nil {
		return nil, err
	}
	if h.Platform.VersionID, err = po.Str("versionId", PlatformVersionPattern); err != nil {
		return nil, err
	}
	if h.Platform.Arch, err = po.Str("arch", ArchPattern); err != nil {
		return nil, err
	}
	if h.Platform.KernelRelease, err = po.Str("kernelRelease", KernelReleasePattern); err != nil {
		return nil, err
	}
	if h.Platform.CgroupVersion, err = po.Int("cgroupVersion", 2, 2); err != nil {
		return nil, err
	}
	if h.Platform.SystemdVersion, err = po.Str("systemdVersion", SystemdVersionPattern); err != nil {
		return nil, err
	}
	if err := po.Done(); err != nil {
		return nil, err
	}
	so, err := o.Obj("security")
	if err != nil {
		return nil, err
	}
	if h.Security.CgroupKill, err = so.Bool("cgroupKill"); err != nil {
		return nil, err
	}
	if h.Security.Delegated, err = so.Bool("delegated"); err != nil {
		return nil, err
	}
	if h.Security.AppArmorEnforcing, err = so.Bool("apparmorEnforcing"); err != nil {
		return nil, err
	}
	if h.Security.AppArmorProfileDigest, err = so.Str("apparmorProfileDigest", DigestHexPattern); err != nil {
		return nil, err
	}
	if err := so.Done(); err != nil {
		return nil, err
	}
	if h.IssuedAt, err = o.Time("issuedAt"); err != nil {
		return nil, err
	}
	if h.ExpiresAt, err = o.Time("expiresAt"); err != nil {
		return nil, err
	}
	if !h.ExpiresAt.After(h.IssuedAt) {
		return nil, errors.New("wire: expiresAt must be after issuedAt")
	}
	if h.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(h.Signature); err != nil {
		return nil, err
	}
	return h, o.Done()
}

// ---------------------------------------------------------------------------
// ExecutionTicketV1
// ---------------------------------------------------------------------------

type ExecutionTicket struct {
	TicketID              string
	JobRequestDigest      string
	JobID                 string
	Attempt               int64
	LeaseID               string
	LeaseSequence         int64
	GrantReceiptDigest    string
	OwnerUID              string
	WorkerDeviceID        string
	ControllerDeviceID    string
	ExecutionServiceID    string
	HelperInstanceID      string
	RepositoryIdentity    string
	Commit                string
	ExecutorProfileID     string
	SandboxProfileID      string
	NetworkProfileID      string
	Command               CommandSpec
	Resources             ResourceLimits
	ServerIssuedAt        time.Time
	LeaseExpiresAt        time.Time
	JobDeadlineAt         time.Time
	MinimumHelperProtocol int64
	MinimumPolicyEpoch    int64
	Signature             string
}

func (t *ExecutionTicket) unsignedMap() map[string]any {
	return map[string]any{
		"domain":                DomainExecutionTicketV1,
		"ticketId":              t.TicketID,
		"jobRequestDigest":      t.JobRequestDigest,
		"jobId":                 t.JobID,
		"attempt":               t.Attempt,
		"leaseId":               t.LeaseID,
		"leaseSequence":         t.LeaseSequence,
		"grantReceiptDigest":    t.GrantReceiptDigest,
		"ownerUid":              t.OwnerUID,
		"workerDeviceId":        t.WorkerDeviceID,
		"controllerDeviceId":    t.ControllerDeviceID,
		"executionServiceId":    t.ExecutionServiceID,
		"helperInstanceId":      t.HelperInstanceID,
		"repositoryIdentity":    t.RepositoryIdentity,
		"commit":                t.Commit,
		"executorProfileId":     t.ExecutorProfileID,
		"sandboxProfileId":      t.SandboxProfileID,
		"networkProfileId":      t.NetworkProfileID,
		"command":               t.Command.toMap(),
		"resources":             t.Resources.toMap(),
		"serverIssuedAt":        FormatTimestamp(t.ServerIssuedAt),
		"leaseExpiresAt":        FormatTimestamp(t.LeaseExpiresAt),
		"jobDeadlineAt":         FormatTimestamp(t.JobDeadlineAt),
		"minimumHelperProtocol": t.MinimumHelperProtocol,
		"minimumPolicyEpoch":    t.MinimumPolicyEpoch,
	}
}

func (t *ExecutionTicket) Map() map[string]any {
	m := t.unsignedMap()
	m["signature"] = t.Signature
	return m
}

func (t *ExecutionTicket) Marshal() ([]byte, error) { return canon.Encode(t.Map()) }

func (t *ExecutionTicket) Sign(priv ed25519.PrivateKey) error {
	return signInto(priv, t.unsignedMap(), &t.Signature)
}

func (t *ExecutionTicket) Verify(pubs ...ed25519.PublicKey) error {
	return verifyAny(t.unsignedMap(), t.Signature, pubs)
}

// DecodeExecutionTicket strictly parses canonical ticket bytes.
func DecodeExecutionTicket(b []byte) (*ExecutionTicket, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	t := &ExecutionTicket{}
	if err := checkDomain(o, DomainExecutionTicketV1); err != nil {
		return nil, err
	}
	if t.TicketID, err = o.Str("ticketId", TicketIDPattern); err != nil {
		return nil, err
	}
	if t.JobRequestDigest, err = o.Str("jobRequestDigest", DigestHexPattern); err != nil {
		return nil, err
	}
	if t.JobID, err = o.Str("jobId", JobIDPattern); err != nil {
		return nil, err
	}
	if t.Attempt, err = o.Int("attempt", 1, MaxAttempt); err != nil {
		return nil, err
	}
	if t.LeaseID, err = o.Str("leaseId", LeaseIDPattern); err != nil {
		return nil, err
	}
	if t.LeaseSequence, err = o.Int("leaseSequence", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if t.GrantReceiptDigest, err = o.Str("grantReceiptDigest", DigestHexPattern); err != nil {
		return nil, err
	}
	if t.OwnerUID, err = o.Str("ownerUid", OwnerUIDPattern); err != nil {
		return nil, err
	}
	if t.WorkerDeviceID, err = o.Str("workerDeviceId", DeviceIDPattern); err != nil {
		return nil, err
	}
	if t.ControllerDeviceID, err = o.Str("controllerDeviceId", DeviceIDPattern); err != nil {
		return nil, err
	}
	if t.ExecutionServiceID, err = o.Str("executionServiceId", ServiceIDPattern); err != nil {
		return nil, err
	}
	if t.HelperInstanceID, err = o.Str("helperInstanceId", HelperInstanceIDPattern); err != nil {
		return nil, err
	}
	if t.RepositoryIdentity, err = o.Str("repositoryIdentity", RepositoryIdentityPattern); err != nil {
		return nil, err
	}
	if t.Commit, err = o.Str("commit", CommitPattern); err != nil {
		return nil, err
	}
	if t.ExecutorProfileID, err = o.Str("executorProfileId", ProfileIDPattern); err != nil {
		return nil, err
	}
	if t.SandboxProfileID, err = o.Str("sandboxProfileId", ProfileIDPattern); err != nil {
		return nil, err
	}
	if t.NetworkProfileID, err = o.Str("networkProfileId", ProfileIDPattern); err != nil {
		return nil, err
	}
	co, err := o.Obj("command")
	if err != nil {
		return nil, err
	}
	if t.Command, err = decodeCommandSpec(co); err != nil {
		return nil, err
	}
	ro, err := o.Obj("resources")
	if err != nil {
		return nil, err
	}
	if t.Resources, err = decodeResourceLimits(ro); err != nil {
		return nil, err
	}
	if t.ServerIssuedAt, err = o.Time("serverIssuedAt"); err != nil {
		return nil, err
	}
	if t.LeaseExpiresAt, err = o.Time("leaseExpiresAt"); err != nil {
		return nil, err
	}
	if t.JobDeadlineAt, err = o.Time("jobDeadlineAt"); err != nil {
		return nil, err
	}
	if !t.LeaseExpiresAt.After(t.ServerIssuedAt) {
		return nil, errors.New("wire: leaseExpiresAt must be after serverIssuedAt")
	}
	if t.JobDeadlineAt.Before(t.LeaseExpiresAt) {
		return nil, errors.New("wire: leaseExpiresAt must not exceed jobDeadlineAt")
	}
	if t.MinimumHelperProtocol, err = o.Int("minimumHelperProtocol", 1, MaxProtocolRev); err != nil {
		return nil, err
	}
	if t.MinimumPolicyEpoch, err = o.Int("minimumPolicyEpoch", 0, MaxPolicyEpoch); err != nil {
		return nil, err
	}
	if t.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(t.Signature); err != nil {
		return nil, err
	}
	return t, o.Done()
}

// ---------------------------------------------------------------------------
// LeaseUpdateV1
// ---------------------------------------------------------------------------

type LeaseUpdate struct {
	TicketID         string
	JobID            string
	Attempt          int64
	LeaseID          string
	HelperInstanceID string
	LeaseSequence    int64
	Cancelled        bool
	ServerIssuedAt   time.Time
	LeaseExpiresAt   time.Time
	Signature        string
}

func (l *LeaseUpdate) unsignedMap() map[string]any {
	return map[string]any{
		"domain":           DomainLeaseUpdateV1,
		"ticketId":         l.TicketID,
		"jobId":            l.JobID,
		"attempt":          l.Attempt,
		"leaseId":          l.LeaseID,
		"helperInstanceId": l.HelperInstanceID,
		"leaseSequence":    l.LeaseSequence,
		"cancelled":        l.Cancelled,
		"serverIssuedAt":   FormatTimestamp(l.ServerIssuedAt),
		"leaseExpiresAt":   FormatTimestamp(l.LeaseExpiresAt),
	}
}

func (l *LeaseUpdate) Map() map[string]any {
	m := l.unsignedMap()
	m["signature"] = l.Signature
	return m
}

func (l *LeaseUpdate) Marshal() ([]byte, error) { return canon.Encode(l.Map()) }

func (l *LeaseUpdate) Sign(priv ed25519.PrivateKey) error {
	return signInto(priv, l.unsignedMap(), &l.Signature)
}

func (l *LeaseUpdate) Verify(pubs ...ed25519.PublicKey) error {
	return verifyAny(l.unsignedMap(), l.Signature, pubs)
}

// DecodeLeaseUpdate strictly parses canonical lease-update bytes.
func DecodeLeaseUpdate(b []byte) (*LeaseUpdate, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	l := &LeaseUpdate{}
	if err := checkDomain(o, DomainLeaseUpdateV1); err != nil {
		return nil, err
	}
	if l.TicketID, err = o.Str("ticketId", TicketIDPattern); err != nil {
		return nil, err
	}
	if l.JobID, err = o.Str("jobId", JobIDPattern); err != nil {
		return nil, err
	}
	if l.Attempt, err = o.Int("attempt", 1, MaxAttempt); err != nil {
		return nil, err
	}
	if l.LeaseID, err = o.Str("leaseId", LeaseIDPattern); err != nil {
		return nil, err
	}
	if l.HelperInstanceID, err = o.Str("helperInstanceId", HelperInstanceIDPattern); err != nil {
		return nil, err
	}
	if l.LeaseSequence, err = o.Int("leaseSequence", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if l.Cancelled, err = o.Bool("cancelled"); err != nil {
		return nil, err
	}
	if l.ServerIssuedAt, err = o.Time("serverIssuedAt"); err != nil {
		return nil, err
	}
	if l.LeaseExpiresAt, err = o.Time("leaseExpiresAt"); err != nil {
		return nil, err
	}
	if l.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(l.Signature); err != nil {
		return nil, err
	}
	return l, o.Done()
}

// ---------------------------------------------------------------------------
// ExecutionStartedReceiptV1
// ---------------------------------------------------------------------------

type ExecutionStartedReceipt struct {
	TicketID             string
	JobID                string
	Attempt              int64
	LeaseID              string
	HelperInstanceID     string
	UnitName             string
	CgroupPath           string
	EffectiveLimits      ResourceLimits
	RunnerBuildID        string
	StartedAt            time.Time
	StartedAtMonotonicMs int64
	Signature            string
}

func (r *ExecutionStartedReceipt) unsignedMap() map[string]any {
	return map[string]any{
		"domain":               DomainExecutionStartedReceiptV1,
		"ticketId":             r.TicketID,
		"jobId":                r.JobID,
		"attempt":              r.Attempt,
		"leaseId":              r.LeaseID,
		"helperInstanceId":     r.HelperInstanceID,
		"unitName":             r.UnitName,
		"cgroupPath":           r.CgroupPath,
		"effectiveLimits":      r.EffectiveLimits.toMap(),
		"runnerBuildId":        r.RunnerBuildID,
		"startedAt":            FormatTimestamp(r.StartedAt),
		"startedAtMonotonicMs": r.StartedAtMonotonicMs,
	}
}

func (r *ExecutionStartedReceipt) Map() map[string]any {
	m := r.unsignedMap()
	m["signature"] = r.Signature
	return m
}

func (r *ExecutionStartedReceipt) Marshal() ([]byte, error) { return canon.Encode(r.Map()) }

func (r *ExecutionStartedReceipt) Sign(priv ed25519.PrivateKey) error {
	return signInto(priv, r.unsignedMap(), &r.Signature)
}

func (r *ExecutionStartedReceipt) Verify(pubs ...ed25519.PublicKey) error {
	return verifyAny(r.unsignedMap(), r.Signature, pubs)
}

// DecodeExecutionStartedReceipt strictly parses canonical bytes.
func DecodeExecutionStartedReceipt(b []byte) (*ExecutionStartedReceipt, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	r := &ExecutionStartedReceipt{}
	if err := checkDomain(o, DomainExecutionStartedReceiptV1); err != nil {
		return nil, err
	}
	if r.TicketID, err = o.Str("ticketId", TicketIDPattern); err != nil {
		return nil, err
	}
	if r.JobID, err = o.Str("jobId", JobIDPattern); err != nil {
		return nil, err
	}
	if r.Attempt, err = o.Int("attempt", 1, MaxAttempt); err != nil {
		return nil, err
	}
	if r.LeaseID, err = o.Str("leaseId", LeaseIDPattern); err != nil {
		return nil, err
	}
	if r.HelperInstanceID, err = o.Str("helperInstanceId", HelperInstanceIDPattern); err != nil {
		return nil, err
	}
	if r.UnitName, err = o.Str("unitName", UnitNamePattern); err != nil {
		return nil, err
	}
	if r.CgroupPath, err = o.Str("cgroupPath", CgroupPathPattern); err != nil {
		return nil, err
	}
	if err := validateCgroupPath(r.CgroupPath); err != nil {
		return nil, err
	}
	lo, err := o.Obj("effectiveLimits")
	if err != nil {
		return nil, err
	}
	if r.EffectiveLimits, err = decodeResourceLimits(lo); err != nil {
		return nil, err
	}
	if r.RunnerBuildID, err = o.Str("runnerBuildId", DigestHexPattern); err != nil {
		return nil, err
	}
	if r.StartedAt, err = o.Time("startedAt"); err != nil {
		return nil, err
	}
	if r.StartedAtMonotonicMs, err = o.Int("startedAtMonotonicMs", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(r.Signature); err != nil {
		return nil, err
	}
	return r, o.Done()
}

// validateCgroupPath rejects dot segments and backslashes beneath the prefix.
func validateCgroupPath(p string) error {
	rest := p[len("/sys/fs/cgroup/"):]
	start := 0
	for i := 0; i <= len(rest); i++ {
		if i == len(rest) || rest[i] == '/' {
			seg := rest[start:i]
			if seg == "" || seg == "." || seg == ".." {
				return errors.New("wire: cgroupPath has unsafe segment")
			}
			start = i + 1
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// TerminationReceiptV1
// ---------------------------------------------------------------------------

// ResourceAccounting is best-effort cgroup accounting at settlement time.
type ResourceAccounting struct {
	CPUUsageNs      int64
	MemoryPeakBytes int64
	PidsPeak        int64
	IOReadBytes     int64
	IOWriteBytes    int64
}

func (a ResourceAccounting) toMap() map[string]any {
	return map[string]any{
		"cpuUsageNs":      a.CPUUsageNs,
		"memoryPeakBytes": a.MemoryPeakBytes,
		"pidsPeak":        a.PidsPeak,
		"ioReadBytes":     a.IOReadBytes,
		"ioWriteBytes":    a.IOWriteBytes,
	}
}

type TerminationReceipt struct {
	TicketID              string
	JobID                 string
	Attempt               int64
	LeaseID               string
	HelperInstanceID      string
	HighestLeaseSequence  int64
	ExitStatus            int64
	TerminationReason     string
	UnitName              string
	CgroupPath            string
	Populated             bool
	Accounting            ResourceAccounting
	FinishedAt            time.Time
	FinishedAtMonotonicMs int64
	Signature             string
}

func (r *TerminationReceipt) unsignedMap() map[string]any {
	return map[string]any{
		"domain":                DomainTerminationReceiptV1,
		"ticketId":              r.TicketID,
		"jobId":                 r.JobID,
		"attempt":               r.Attempt,
		"leaseId":               r.LeaseID,
		"helperInstanceId":      r.HelperInstanceID,
		"highestLeaseSequence":  r.HighestLeaseSequence,
		"exitStatus":            r.ExitStatus,
		"terminationReason":     r.TerminationReason,
		"unitName":              r.UnitName,
		"cgroupPath":            r.CgroupPath,
		"populated":             r.Populated,
		"accounting":            r.Accounting.toMap(),
		"finishedAt":            FormatTimestamp(r.FinishedAt),
		"finishedAtMonotonicMs": r.FinishedAtMonotonicMs,
	}
}

func (r *TerminationReceipt) Map() map[string]any {
	m := r.unsignedMap()
	m["signature"] = r.Signature
	return m
}

func (r *TerminationReceipt) Marshal() ([]byte, error) { return canon.Encode(r.Map()) }

func (r *TerminationReceipt) Sign(priv ed25519.PrivateKey) error {
	return signInto(priv, r.unsignedMap(), &r.Signature)
}

func (r *TerminationReceipt) Verify(pubs ...ed25519.PublicKey) error {
	return verifyAny(r.unsignedMap(), r.Signature, pubs)
}

// DecodeTerminationReceipt strictly parses canonical bytes. A receipt
// claiming populated=true is invalid on its face (invariant 8).
func DecodeTerminationReceipt(b []byte) (*TerminationReceipt, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	r := &TerminationReceipt{}
	if err := checkDomain(o, DomainTerminationReceiptV1); err != nil {
		return nil, err
	}
	if r.TicketID, err = o.Str("ticketId", TicketIDPattern); err != nil {
		return nil, err
	}
	if r.JobID, err = o.Str("jobId", JobIDPattern); err != nil {
		return nil, err
	}
	if r.Attempt, err = o.Int("attempt", 1, MaxAttempt); err != nil {
		return nil, err
	}
	if r.LeaseID, err = o.Str("leaseId", LeaseIDPattern); err != nil {
		return nil, err
	}
	if r.HelperInstanceID, err = o.Str("helperInstanceId", HelperInstanceIDPattern); err != nil {
		return nil, err
	}
	if r.HighestLeaseSequence, err = o.Int("highestLeaseSequence", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.ExitStatus, err = o.Int("exitStatus", -1, 255); err != nil {
		return nil, err
	}
	if r.TerminationReason, err = o.StrEnum("terminationReason", TerminationReasons...); err != nil {
		return nil, err
	}
	if r.UnitName, err = o.Str("unitName", UnitNamePattern); err != nil {
		return nil, err
	}
	if r.CgroupPath, err = o.Str("cgroupPath", CgroupPathPattern); err != nil {
		return nil, err
	}
	if err := validateCgroupPath(r.CgroupPath); err != nil {
		return nil, err
	}
	if r.Populated, err = o.Bool("populated"); err != nil {
		return nil, err
	}
	if r.Populated {
		return nil, errors.New("wire: termination receipt with populated=true is invalid")
	}
	ao, err := o.Obj("accounting")
	if err != nil {
		return nil, err
	}
	if r.Accounting.CPUUsageNs, err = ao.Int("cpuUsageNs", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Accounting.MemoryPeakBytes, err = ao.Int("memoryPeakBytes", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Accounting.PidsPeak, err = ao.Int("pidsPeak", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Accounting.IOReadBytes, err = ao.Int("ioReadBytes", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Accounting.IOWriteBytes, err = ao.Int("ioWriteBytes", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if err := ao.Done(); err != nil {
		return nil, err
	}
	if r.FinishedAt, err = o.Time("finishedAt"); err != nil {
		return nil, err
	}
	if r.FinishedAtMonotonicMs, err = o.Int("finishedAtMonotonicMs", 0, canon.MaxSafeInteger); err != nil {
		return nil, err
	}
	if r.Signature, err = o.Str("signature", nil); err != nil {
		return nil, err
	}
	if _, err := keys.ParseSignature(r.Signature); err != nil {
		return nil, err
	}
	return r, o.Done()
}

// ---------------------------------------------------------------------------
// shared sign/verify helpers
// ---------------------------------------------------------------------------

func checkDomain(o *Obj, want string) error {
	d, err := o.Str("domain", nil)
	if err != nil {
		return err
	}
	if d != want {
		return ErrDomain
	}
	return nil
}

// signInto signs the canonical form of unsigned and stores the base64url
// signature into *dst. The unsigned map must not contain a signature field.
func signInto(priv ed25519.PrivateKey, unsigned map[string]any, dst *string) error {
	if _, ok := unsigned["signature"]; ok {
		return errors.New("wire: unsigned map contains signature field")
	}
	b, err := canon.Encode(unsigned)
	if err != nil {
		return err
	}
	s, err := keys.EncodeSignature(keys.Sign(priv, b))
	if err != nil {
		return err
	}
	*dst = s
	return nil
}

// verifyAny checks sigText against the canonical form of unsigned under any
// of the given public keys.
func verifyAny(unsigned map[string]any, sigText string, pubs []ed25519.PublicKey) error {
	sig, err := keys.ParseSignature(sigText)
	if err != nil {
		return err
	}
	b, err := canon.Encode(unsigned)
	if err != nil {
		return err
	}
	for _, pub := range pubs {
		if keys.Verify(pub, b, sig) {
			return nil
		}
	}
	return ErrSignatureInvalid
}
