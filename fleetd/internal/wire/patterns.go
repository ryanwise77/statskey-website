package wire

import "regexp"

// Field patterns from FLEETD_DESIGN.md and fleetAuth.js. Every signed field
// is shape-checked at decode time; anything else fails closed.
var (
	DeviceIDPattern         = regexp.MustCompile(`^dev_[a-f0-9]{32}$`)
	ChallengeIDPattern      = regexp.MustCompile(`^chal_[a-f0-9]{32}$`)
	ServiceIDPattern        = regexp.MustCompile(`^svc_[a-f0-9]{32}$`)
	HelperInstanceIDPattern = regexp.MustCompile(`^hi_[a-f0-9]{32}$`)
	TicketIDPattern         = regexp.MustCompile(`^ticket_[a-f0-9]{32}$`)
	JobIDPattern            = regexp.MustCompile(`^job_[a-f0-9]{32}$`)
	LeaseIDPattern          = regexp.MustCompile(`^lease_[a-f0-9]{32}$`)
	RequestIDPattern        = regexp.MustCompile(`^req_[a-f0-9]{32}$`)

	// DigestB64Pattern matches "sha256:<43 base64url>" (boot ID digest).
	DigestB64Pattern = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)
	// DigestHexPattern matches "sha256:<64 lowercase hex>" (build IDs,
	// request/grant digests, AppArmor profile digests).
	DigestHexPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

	CommitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)

	// ChallengeNoncePattern: 43-128 base64url chars per the design doc.
	ChallengeNoncePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)

	// RepositoryIdentityPattern matches "github.com/owner/repo" with GitHub's
	// owner and repository name rules.
	RepositoryIdentityPattern = regexp.MustCompile(
		`^github\.com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9._-]{1,100}$`)

	// ExecutablePattern is a bare executable name: no path separators, never
	// "." or "..", resolved by the runner against a fixed search path.
	ExecutablePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$`)

	// ProfileIDPattern covers executor/sandbox/network profile IDs such as
	// "command-v1", "ubuntu-build-v1", "none".
	ProfileIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

	// OwnerUIDPattern: opaque platform user identifier bound into the ticket.
	OwnerUIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

	// UnitNamePattern: job unit names are derived from the ticket ID only.
	UnitNamePattern = regexp.MustCompile(`^statskey-fleet-job-ticket_[a-f0-9]{32}\.service$`)

	// CgroupPathPattern: absolute path beneath the unified cgroup root with
	// no dot segments.
	CgroupPathPattern = regexp.MustCompile(`^/sys/fs/cgroup/[A-Za-z0-9:_.\-/]{1,300}$`)

	PlatformIDPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	PlatformVersionPattern = regexp.MustCompile(`^[0-9][0-9A-Za-z.+-]{0,31}$`)
	ArchPattern            = regexp.MustCompile(`^[a-z0-9_]{2,16}$`)
	KernelReleasePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$`)
	SystemdVersionPattern  = regexp.MustCompile(`^[0-9]{1,4}$`)

	// ActionPattern matches fleetAuth.js ACTION_PATTERN.
	ActionPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,63}$`)
	// ResponseKeyIDPattern matches fleetAuth.js RESPONSE_KEY_ID_PATTERN.
	ResponseKeyIDPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,63}$`)

	timestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
)

// Termination reasons for TerminationReceiptV1.
var TerminationReasons = []string{
	"exited",
	"failed",
	"lease-expired",
	"cancelled",
	"stop-requested",
	"daemon-restart",
	"watchdog",
	"runtime-exceeded",
	"oom",
	"signal",
}
