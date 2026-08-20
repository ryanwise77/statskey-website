// Package runner is the fixed job runner executed by systemd as the job
// DynamicUser. It reads the root-owned request file, resolves the ticket's
// bare executable name against a fixed root-owned search path, materializes
// the pinned Git snapshot with every git escape hatch disabled, then execs
// the command with a scrubbed environment.
//
// The runner never runs as root (it aborts when euid==0): by the time it
// interprets ticket data, systemd has already selected the unprivileged job
// principal and applied containment (invariant 1).
package runner

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"statskey/fleetd/internal/wire"
)

// SearchPaths is the fixed executable search path from the design doc.
var SearchPaths = []string{"/usr/bin", "/bin", "/usr/local/bin"}

const (
	// maxRequestBytes bounds the root-owned request file.
	maxRequestBytes = 64 * 1024
	// maxCredentialBytes bounds the optional git credential file.
	maxCredentialBytes = 4096
	// credentialFileName is the LoadCredential name the unit may carry.
	credentialFileName = "fleet-git-credential"
	// PrepResultFile is the workspace-relative marker the prep phase writes
	// before exiting; the daemon reads it after the prep cgroup is empty.
	PrepResultFile = ".statskey-prep-result"
	// JobResultFile is the workspace-relative file the job phase writes with
	// the command's exit code before exiting; the daemon reads it after the
	// job cgroup is empty (systemd GC's successful units, so unit state is
	// not a reliable exit-status source).
	JobResultFile = ".statskey-job-result"
)

// ExitError carries the command's exit code so the runner process can exit
// identically (systemd's ExecMainStatus is the backstop, not the source).
type ExitError struct{ Code int }

func (e *ExitError) Error() string { return fmt.Sprintf("runner: command exited %d", e.Code) }

var (
	ErrRoot           = errors.New("runner: refusing to run as root")
	ErrUsage          = errors.New("runner: usage: statskey-fleet-runner <request.json> <workspace>")
	ErrNoExecutable   = errors.New("runner: no acceptable executable found")
	ErrBadWorkspace   = errors.New("runner: unsafe working directory")
	ErrCommitMismatch = errors.New("runner: checked-out commit does not match ticket")
)

// Seam bundles the runner's replaceable system dependencies (tests inject
// fakes; cmd/statskey-fleet-runner uses the real ones).
type Seam struct {
	GetEUID func() int
	// RunCommand runs the job command as a child process (never exec) and
	// returns its exit code, forwarding termination signals to the child.
	RunCommand   func(path string, argv []string, env []string) (exitCode int, err error)
	RunGit       func(dir string, env []string, args ...string) (string, error)
	Chdir        func(dir string) error
	SearchDirs   []string
	Stat         func(path string) (fs.FileInfo, error)
	EvalSymlinks func(path string) (string, error)
	Getenv       func(string) string
	Stderr       io.Writer
}

// Runner executes one job request.
type Runner struct {
	Seam Seam
}

func (r *Runner) getenv(k string) string {
	if r.Seam.Getenv != nil {
		return r.Seam.Getenv(k)
	}
	return os.Getenv(k)
}

func (r *Runner) stderr() io.Writer {
	if r.Seam.Stderr != nil {
		return r.Seam.Stderr
	}
	return os.Stderr
}

// Run executes the job described by argv[1] inside workspace argv[2]. On
// success it does not return (the process is replaced by exec).
//
// Two modes, two units (FLEETD_DESIGN.md): the prep unit runs
// `--prepare` with network access to fetch and check out the pinned commit
// (no repository-controlled code ever executes there); the job unit runs
// without network and only verifies the checkout before exec.
func (r *Runner) Run(ctx context.Context, argv []string) error {
	if euid := r.Seam.GetEUID(); euid == 0 {
		return ErrRoot
	}
	prepare := len(argv) == 4 && argv[1] == "--prepare"
	if (prepare && len(argv) != 4) || (!prepare && len(argv) != 3) {
		return ErrUsage
	}
	if prepare {
		argv = []string{argv[0], argv[2], argv[3]}
	}
	workspace := argv[2]

	// Production units deliver the request through systemd LoadCredential
	// ("@fleet-request"): systemd copies the root-owned file into the unit's
	// read-only credentials tmpfs before this process starts, so the job can
	// read but never replace it. A direct path is still accepted for tests.
	requestPath := argv[1]
	fromCredential := false
	if name, ok := strings.CutPrefix(requestPath, "@"); ok {
		credDir := r.getenv("CREDENTIALS_DIRECTORY")
		if credDir == "" || name == "" || strings.ContainsAny(name, "/\\") {
			return ErrUsage
		}
		requestPath = filepath.Join(credDir, name)
		fromCredential = true
	}

	ticket, err := r.readRequest(requestPath, fromCredential)
	if err != nil {
		return err
	}

	// Resolve the executable before doing any repository work.
	searchDirs := r.Seam.SearchDirs
	if len(searchDirs) == 0 {
		searchDirs = SearchPaths
	}
	execPath, err := r.resolveExecutable(ticket.Command.Executable, searchDirs)
	if err != nil {
		return err
	}

	// Materialize the pinned snapshot (prep unit, network enabled) or verify
	// the already-materialized checkout (job unit, no network).
	repoDir := filepath.Join(workspace, "repo")
	if prepare {
		// The daemon reads this marker only after the unit's cgroup is empty
		// (all processes exited), so the write here happens-before its read.
		resultPath := filepath.Join(workspace, PrepResultFile)
		err := r.materialize(ctx, ticket, repoDir)
		result := "ok"
		if err != nil {
			result = "failed: " + err.Error()
		}
		if werr := os.WriteFile(resultPath, []byte(result), 0o644); werr != nil {
			return fmt.Errorf("runner: write prep result: %w (materialize: %v)", werr, err)
		}
		return err
	}
	if err := r.verifyCheckout(ticket, repoDir); err != nil {
		return err
	}

	// Resolve the working directory inside the checkout.
	workDir, err := resolveWorkdir(repoDir, ticket.Command.WorkingDirectory)
	if err != nil {
		return err
	}

	// Scrub the environment, then run the command as a child (not exec): the
	// runner records the exit code in the workspace before exiting so the
	// daemon has a race-free exit status after systemd GC's the unit.
	env := execEnv(workspace)
	argvExec := append([]string{ticket.Command.Executable}, ticket.Command.Arguments...)
	chdir := r.Seam.Chdir
	if chdir == nil {
		chdir = os.Chdir
	}
	if err := chdir(workDir); err != nil {
		return fmt.Errorf("runner: chdir: %w", err)
	}
	runCmd := r.Seam.RunCommand
	if runCmd == nil {
		return errors.New("runner: no command runner configured")
	}
	exitCode, err := runCmd(execPath, argvExec, env)
	// The marker write happens-before this process exits, hence before the
	// cgroup reads empty.
	if werr := os.WriteFile(filepath.Join(workspace, JobResultFile), []byte(strconv.Itoa(exitCode)), 0o644); werr != nil {
		return fmt.Errorf("runner: write job result: %w", werr)
	}
	if err != nil {
		return err
	}
	if exitCode != 0 {
		return &ExitError{Code: exitCode}
	}
	return nil
}

// readRequest reads and strictly decodes the ticket file. Direct paths must
// be regular, bounded, root-owned files (the daemon writes them 0644
// root:root; anything else means misconfiguration or tampering). Credential
// mode reads systemd's read-only credentials tmpfs instead: systemd copied
// the root-owned source before this process started and the job cannot
// replace it, so transport — not ownership — carries the guarantee.
func (r *Runner) readRequest(path string, fromCredential bool) (*wire.ExecutionTicket, error) {
	stat := r.Seam.Stat
	if stat == nil {
		stat = os.Stat
	}
	st, err := stat(path)
	if err != nil {
		return nil, fmt.Errorf("runner: stat request: %w", err)
	}
	if !st.Mode().IsRegular() || st.Size() > maxRequestBytes {
		return nil, errors.New("runner: request file is not a regular bounded file")
	}
	if !fromCredential {
		if uid, ok := fileOwnerUID(st); !ok || uid != 0 {
			return nil, errors.New("runner: request file is not root-owned")
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("runner: read request: %w", err)
	}
	ticket, err := wire.DecodeExecutionTicket(b)
	if err != nil {
		return nil, fmt.Errorf("runner: request decode: %w", err)
	}
	return ticket, nil
}

// resolveExecutable finds name in the fixed search path. The resolved file
// must be a regular, root-owned, non-group/world-writable, executable file.
func (r *Runner) resolveExecutable(name string, dirs []string) (string, error) {
	if !wire.ExecutablePattern.MatchString(name) {
		return "", fmt.Errorf("runner: executable name %q is not a bare name", name)
	}
	stat := r.Seam.Stat
	if stat == nil {
		stat = os.Stat
	}
	resolve := r.Seam.EvalSymlinks
	if resolve == nil {
		resolve = filepath.EvalSymlinks
	}
	for _, dir := range dirs {
		candidate := filepath.Join(dir, name)
		resolved, err := resolve(candidate)
		if err != nil {
			continue
		}
		// The resolved target must still live under one of the fixed dirs;
		// otherwise a symlink could escape the root-owned path set.
		if !underAnyDir(resolved, dirs) {
			continue
		}
		st, err := stat(resolved)
		if err != nil {
			continue
		}
		if acceptableExecutable(st) {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("%w: %s", ErrNoExecutable, name)
}

func underAnyDir(path string, dirs []string) bool {
	for _, dir := range dirs {
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			continue
		}
		if rel != ".." && !strings.HasPrefix(rel, "../") {
			return true
		}
	}
	return false
}

// acceptableExecutable enforces the design's executable rules.
func acceptableExecutable(st fs.FileInfo) bool {
	if !st.Mode().IsRegular() {
		return false
	}
	m := st.Mode().Perm()
	if m&0o022 != 0 { // group- or world-writable: never acceptable
		return false
	}
	if m&0o100 == 0 { // owner-executable required
		return false
	}
	uid, ok := fileOwnerUID(st)
	if !ok || uid != 0 {
		return false
	}
	return true
}

// resolveWorkdir maps the ticket's relative workingDirectory into the
// checkout, proving the result stays inside repoDir.
func resolveWorkdir(repoDir, wd string) (string, error) {
	if err := wire.ValidateRelativeWorkdir(wd); err != nil {
		return "", err
	}
	target := filepath.Join(repoDir, wd)
	clean := filepath.Clean(target)
	rel, err := filepath.Rel(repoDir, clean)
	if err != nil || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", ErrBadWorkspace
	}
	st, err := os.Stat(clean)
	if err != nil || !st.IsDir() {
		return "", ErrBadWorkspace
	}
	return clean, nil
}

// execEnv is the complete environment for the job process. Nothing is
// inherited: no SSH agent, no keyring, no credentials, no caller values.
func execEnv(workspace string) []string {
	return []string{
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"HOME=" + workspace,
		"TMPDIR=/tmp",
		"LANG=C.UTF-8",
		"USER=statskey-fleet-job",
		"STATSKEY_FLEET_JOB=1",
	}
}

// gitEnv is the environment for git itself: no system/global config, no
// terminal prompts, no SSH.
func gitEnv(workspace string) []string {
	return []string{
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"HOME=" + workspace,
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_SSH_COMMAND=false",
		"LANG=C.UTF-8",
	}
}

// gitSafetyFlags disable every git escape hatch: hooks, credential helpers,
// redirects, non-https protocols, and submodules. Config includes need no
// flag: GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL=/dev/null (gitEnv) leave
// no file an include could come from, and command-line includeIf with a
// relative gitdir is rejected by git outright.
func gitSafetyFlags() []string {
	return []string{
		"-c", "core.hooksPath=/dev/null",
		"-c", "credential.helper=",
		"-c", "http.followRedirects=false",
		"-c", "protocol.file.allow=never",
		"-c", "protocol.ext.allow=never",
		"-c", "protocol.git.allow=never",
		"-c", "protocol.ssh.allow=never",
		"-c", "submodule.recurse=false",
	}
}

// repoURL maps a validated repositoryIdentity to its HTTPS URL.
func repoURL(identity string) (string, error) {
	if !wire.RepositoryIdentityPattern.MatchString(identity) {
		return "", fmt.Errorf("runner: invalid repository identity %q", identity)
	}
	return "https://" + identity, nil
}

// materialize fetches and checks out the exact ticket commit.
func (r *Runner) materialize(ctx context.Context, ticket *wire.ExecutionTicket, repoDir string) error {
	url, err := repoURL(ticket.RepositoryIdentity)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		return fmt.Errorf("runner: create repo dir: %w", err)
	}
	env := gitEnv(filepath.Dir(repoDir))

	// Optional repository-scoped, short-lived credential via systemd
	// LoadCredential. Read into memory, then unlinked so the job's later
	// processes cannot read it back (invariant 16).
	credArgs, cleanup := r.loadCredentialArgs(url)
	defer cleanup()

	run := func(args ...string) (string, error) {
		full := append(append(append([]string{}, gitSafetyFlags()...), credArgs...), args...)
		return r.Seam.RunGit(repoDir, env, full...)
	}

	if _, err := run("init", "--quiet", repoDir); err != nil {
		return fmt.Errorf("runner: git init: %w", err)
	}
	if _, err := run("-C", repoDir, "remote", "add", "origin", url); err != nil {
		return fmt.Errorf("runner: git remote: %w", err)
	}
	// Prefer a shallow fetch of the exact commit; fall back to a full fetch
	// when the server disallows arbitrary-SHA fetches.
	if _, err := run("-C", repoDir, "fetch", "--quiet", "--depth", "1", "--recurse-submodules=no", "origin", ticket.Commit); err != nil {
		if _, err2 := run("-C", repoDir, "fetch", "--quiet", "--recurse-submodules=no", "origin"); err2 != nil {
			return fmt.Errorf("runner: git fetch: %v (shallow: %v)", err2, err)
		}
	}
	if _, err := run("-C", repoDir, "checkout", "--quiet", "--detach", ticket.Commit); err != nil {
		return fmt.Errorf("runner: git checkout: %w", err)
	}
	// Verify the checked-out commit exactly (40-hex, already shape-checked).
	out, err := run("-C", repoDir, "rev-parse", "--verify", "HEAD^{commit}")
	if err != nil {
		return fmt.Errorf("runner: git rev-parse: %w", err)
	}
	if strings.TrimSpace(out) != ticket.Commit {
		return ErrCommitMismatch
	}
	return nil
}

// verifyCheckout confirms the prep unit's checkout still matches the pinned
// commit. Read-only: the job unit has no network, so a mismatch fails closed
// instead of refetching.
func (r *Runner) verifyCheckout(ticket *wire.ExecutionTicket, repoDir string) error {
	run := func(args ...string) (string, error) {
		full := append(append([]string{}, gitSafetyFlags()...), args...)
		return r.Seam.RunGit(repoDir, gitEnv(filepath.Dir(repoDir)), full...)
	}
	out, err := run("-C", repoDir, "rev-parse", "--verify", "HEAD^{commit}")
	if err != nil {
		return fmt.Errorf("runner: checkout missing or unreadable: %w", err)
	}
	if strings.TrimSpace(out) != ticket.Commit {
		return ErrCommitMismatch
	}
	return nil
}

// loadCredentialArgs reads the optional LoadCredential-provided git
// credential and returns git -c arguments carrying an Authorization header.
// The returned cleanup removes the credential file (best effort).
func (r *Runner) loadCredentialArgs(url string) ([]string, func()) {
	noop := func() {}
	credDir := r.getenv("CREDENTIALS_DIRECTORY")
	if credDir == "" {
		return nil, noop
	}
	path := filepath.Join(credDir, credentialFileName)
	st, err := os.Stat(path)
	if err != nil || !st.Mode().IsRegular() || st.Size() > maxCredentialBytes {
		return nil, noop
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, noop
	}
	// Best-effort: make the credential unavailable to later job processes.
	os.Remove(path)
	header, err := credentialHeader(string(b))
	if err != nil {
		return nil, noop
	}
	// Scope the header to the exact repository host.
	host := strings.TrimPrefix(url, "https://")
	if i := strings.IndexByte(host, '/'); i >= 0 {
		host = host[:i]
	}
	return []string{"-c", "http.https://" + host + "/.extraheader=" + header}, noop
}

// credentialHeader renders an Authorization header from a credential file
// containing either "username:password" or a bare token.
func credentialHeader(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" || strings.ContainsAny(content, "\r\n") {
		return "", errors.New("runner: malformed credential")
	}
	userpass := content
	if !strings.Contains(content, ":") {
		userpass = "x-access-token:" + content
	}
	return "Authorization: Basic " + base64Encode([]byte(userpass)), nil
}
