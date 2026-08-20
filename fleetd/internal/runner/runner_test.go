package runner

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

const (
	testTicketID  = "ticket_0123456789abcdef0123456789abcdef"
	testJobID     = "job_0123456789abcdef0123456789abcdef"
	testLeaseID   = "lease_0123456789abcdef0123456789abcdef"
	testDeviceID  = "dev_0123456789abcdef0123456789abcdef"
	testServiceID = "svc_0123456789abcdef0123456789abcdef"
	testHelperID  = "hi_0123456789abcdef0123456789abcdef"
	testDigestHex = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	testCommit    = "0123456789abcdef0123456789abcdef01234567"
)

func testTicket(t *testing.T) []byte {
	t.Helper()
	priv, err := keys.Generate()
	if err != nil {
		t.Fatal(err)
	}
	ticket := &wire.ExecutionTicket{
		TicketID:           testTicketID,
		JobRequestDigest:   testDigestHex,
		JobID:              testJobID,
		Attempt:            1,
		LeaseID:            testLeaseID,
		LeaseSequence:      0,
		GrantReceiptDigest: testDigestHex,
		OwnerUID:           "user_abc",
		WorkerDeviceID:     testDeviceID,
		ControllerDeviceID: testDeviceID,
		ExecutionServiceID: testServiceID,
		HelperInstanceID:   testHelperID,
		RepositoryIdentity: "github.com/statskey/ci-tests",
		Commit:             testCommit,
		ExecutorProfileID:  "command-v1",
		SandboxProfileID:   "ubuntu-build-v1",
		NetworkProfileID:   "none",
		Command:            wire.CommandSpec{Executable: "node", Arguments: []string{"--version"}, WorkingDirectory: "."},
		Resources: wire.ResourceLimits{
			CPUMilli: 1000, MemoryBytes: 1073741824, Pids: 64, DiskBytes: 1073741824, WallTimeMs: 60000,
		},
		ServerIssuedAt:        time.Date(2026, 8, 19, 20, 0, 0, 0, time.UTC),
		LeaseExpiresAt:        time.Date(2026, 8, 19, 20, 5, 0, 0, time.UTC),
		JobDeadlineAt:         time.Date(2026, 8, 19, 21, 0, 0, 0, time.UTC),
		MinimumHelperProtocol: 1,
		MinimumPolicyEpoch:    1,
	}
	if err := ticket.Sign(priv); err != nil {
		t.Fatal(err)
	}
	raw, err := ticket.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// fakeFileInfo implements fs.FileInfo with configurable mode/uid.
type fakeFileInfo struct {
	name string
	mode fs.FileMode
	uid  uint32
}

func (f fakeFileInfo) Name() string      { return f.name }
func (f fakeFileInfo) Size() int64       { return 0 }
func (f fakeFileInfo) Mode() fs.FileMode { return f.mode }
func (f fakeFileInfo) ModTime() time.Time {
	return time.Time{}
}
func (f fakeFileInfo) IsDir() bool { return f.mode.IsDir() }
func (f fakeFileInfo) Sys() any    { return &syscall.Stat_t{Uid: f.uid} }

// fakeFS models the executable search path for resolution tests.
type fakeFS struct {
	files map[string]fakeFileInfo // resolved path → info
	links map[string]string       // path → symlink target
}

func (f fakeFS) stat(path string) (fs.FileInfo, error) {
	if fi, ok := f.files[path]; ok {
		return fi, nil
	}
	return nil, fs.ErrNotExist
}

func (f fakeFS) evalSymlinks(path string) (string, error) {
	if target, ok := f.links[path]; ok {
		return target, nil
	}
	if _, ok := f.files[path]; ok {
		return path, nil
	}
	return "", fs.ErrNotExist
}

func rootExec(name string) fakeFileInfo {
	return fakeFileInfo{name: name, mode: 0o755, uid: 0}
}

func TestResolveExecutableRules(t *testing.T) {
	dirs := []string{"/usr/bin", "/bin", "/usr/local/bin"}
	newRunner := func(f fakeFS) *Runner {
		return &Runner{Seam: Seam{
			GetEUID:      func() int { return 1000 },
			Stat:         f.stat,
			EvalSymlinks: f.evalSymlinks,
		}}
	}

	// Acceptable: root-owned 0755 regular file.
	r := newRunner(fakeFS{files: map[string]fakeFileInfo{"/usr/bin/node": rootExec("node")}})
	p, err := r.resolveExecutable("node", dirs)
	if err != nil || p != "/usr/bin/node" {
		t.Fatalf("resolve: %q %v", p, err)
	}

	// Search order: /usr/bin wins over /bin.
	r = newRunner(fakeFS{files: map[string]fakeFileInfo{
		"/usr/bin/node": rootExec("node"),
		"/bin/node":     rootExec("node"),
	}})
	if p, _ := r.resolveExecutable("node", dirs); p != "/usr/bin/node" {
		t.Fatalf("order: %q", p)
	}

	cases := []struct {
		name  string
		files map[string]fakeFileInfo
		links map[string]string
	}{
		{"group-writable", map[string]fakeFileInfo{"/usr/bin/node": {name: "node", mode: 0o775, uid: 0}}, nil},
		{"world-writable", map[string]fakeFileInfo{"/usr/bin/node": {name: "node", mode: 0o757, uid: 0}}, nil},
		{"not-root-owned", map[string]fakeFileInfo{"/usr/bin/node": {name: "node", mode: 0o755, uid: 1000}}, nil},
		{"not-executable", map[string]fakeFileInfo{"/usr/bin/node": {name: "node", mode: 0o644, uid: 0}}, nil},
		{"directory", map[string]fakeFileInfo{"/usr/bin/node": {name: "node", mode: fs.ModeDir | 0o755, uid: 0}}, nil},
		{"symlink-escape", nil, map[string]string{"/usr/bin/node": "/tmp/evil/node"}},
		{"symlink-to-nonroot", map[string]fakeFileInfo{"/usr/local/bin/node": {name: "node", mode: 0o755, uid: 1000}}, map[string]string{"/usr/bin/node": "/usr/local/bin/node"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newRunner(fakeFS{files: tc.files, links: tc.links})
			if _, err := r.resolveExecutable("node", dirs); !errors.Is(err, ErrNoExecutable) {
				t.Fatalf("accepted %s: %v", tc.name, err)
			}
		})
	}

	// Symlink within the fixed dirs to a root-owned file is accepted.
	r = newRunner(fakeFS{
		files: map[string]fakeFileInfo{"/usr/local/bin/node": rootExec("node")},
		links: map[string]string{"/usr/bin/node": "/usr/local/bin/node"},
	})
	if p, err := r.resolveExecutable("node", dirs); err != nil || p != "/usr/local/bin/node" {
		t.Fatalf("symlink within dirs: %q %v", p, err)
	}

	// Names with path separators never reach the filesystem.
	r = newRunner(fakeFS{})
	for _, bad := range []string{"../bin/sh", "/bin/sh", "a/b", ".", ".."} {
		if _, err := r.resolveExecutable(bad, dirs); err == nil {
			t.Fatalf("accepted name %q", bad)
		}
	}
}

// runHarness captures a full Run with fake git and exec.
type runCapture struct {
	execPath string
	execArgv []string
	execEnv  []string
	chdirTo  string
	gitCalls [][]string
	commit   string // what fake rev-parse returns
}

func (c *runCapture) seam(workspace string) Seam {
	return Seam{
		GetEUID: func() int { return 1000 },
		RunCommand: func(path string, argv []string, env []string) (int, error) {
			c.execPath, c.execArgv, c.execEnv = path, argv, env
			return 0, nil
		},
		Chdir: func(dir string) error {
			c.chdirTo = dir
			return nil
		},
		RunGit: func(dir string, env []string, args ...string) (string, error) {
			c.gitCalls = append(c.gitCalls, append([]string{}, args...))
			// The checkout creates the working tree.
			for i, a := range args {
				if a == "checkout" && i+1 < len(args) {
					os.MkdirAll(dir, 0o755)
				}
				if a == "rev-parse" {
					return c.commit + "\n", nil
				}
			}
			return "", nil
		},
		Stat: func(path string) (fs.FileInfo, error) {
			if path == "/usr/bin/node" {
				return rootExec("node"), nil
			}
			// The request file is root-owned 0644 per the design.
			if strings.HasSuffix(path, ".json") {
				return fakeFileInfo{name: filepath.Base(path), mode: 0o644, uid: 0}, nil
			}
			return nil, fs.ErrNotExist
		},
		EvalSymlinks: func(path string) (string, error) { return path, nil },
		Getenv:       func(string) string { return "" },
	}
}

func TestRunEndToEnd(t *testing.T) {
	dir := t.TempDir()
	reqPath := filepath.Join(dir, "request.json")
	if err := os.WriteFile(reqPath, testTicket(t), 0o644); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(dir, "ws")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	// Job mode runs after the prep unit materialized the checkout: the repo
	// dir already exists and rev-parse proves the pinned commit.
	if err := os.MkdirAll(filepath.Join(workspace, "repo"), 0o755); err != nil {
		t.Fatal(err)
	}
	cap := &runCapture{commit: testCommit}
	r := &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner", reqPath, workspace}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if cap.execPath != "/usr/bin/node" {
		t.Fatalf("exec path: %s", cap.execPath)
	}
	if len(cap.execArgv) != 2 || cap.execArgv[0] != "node" || cap.execArgv[1] != "--version" {
		t.Fatalf("exec argv: %v", cap.execArgv)
	}
	// Environment is scrubbed: fixed PATH, no inherited values.
	os.Setenv("LEAKED_SECRET", "x")
	defer os.Unsetenv("LEAKED_SECRET")
	envJoined := strings.Join(cap.execEnv, "\n")
	if !strings.Contains(envJoined, "PATH=/usr/local/bin:/usr/bin:/bin") {
		t.Fatalf("env PATH: %v", cap.execEnv)
	}
	for _, e := range cap.execEnv {
		if strings.HasPrefix(e, "LEAKED_SECRET=") || strings.HasPrefix(e, "SSH_") || strings.HasPrefix(e, "GIT_") {
			t.Fatalf("env leaked: %s", e)
		}
	}
	if cap.chdirTo != filepath.Join(workspace, "repo") {
		t.Fatalf("chdir: %s", cap.chdirTo)
	}
	// Job mode only verifies the checkout: exactly one read-only rev-parse
	// carrying the safety flags, never a fetch/checkout (no network here).
	if len(cap.gitCalls) != 1 {
		t.Fatalf("job-mode git calls: %v", cap.gitCalls)
	}
	joined := strings.Join(cap.gitCalls[0], " ")
	if !strings.Contains(joined, "rev-parse") || !strings.Contains(joined, "core.hooksPath=/dev/null") {
		t.Fatalf("job-mode git call: %v", cap.gitCalls[0])
	}
}

// The prep unit materializes with network and never execs.
func TestPrepareMaterializes(t *testing.T) {
	dir := t.TempDir()
	reqPath := filepath.Join(dir, "request.json")
	if err := os.WriteFile(reqPath, testTicket(t), 0o644); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(dir, "ws")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	cap := &runCapture{commit: testCommit}
	r := &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner", "--prepare", reqPath, workspace}); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if cap.execPath != "" {
		t.Fatalf("prep must never exec, got %s", cap.execPath)
	}
	// Git safety: every call carries the safety flags; no submodule commands.
	if len(cap.gitCalls) < 4 {
		t.Fatalf("git calls: %v", cap.gitCalls)
	}
	for _, call := range cap.gitCalls {
		joined := strings.Join(call, " ")
		for _, want := range []string{"core.hooksPath=/dev/null", "credential.helper=", "http.followRedirects=false", "protocol.file.allow=never", "protocol.ssh.allow=never", "submodule.recurse=false"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("git call missing %q: %v", want, call)
			}
		}
		if strings.Contains(joined, "submodule") && !strings.Contains(joined, "submodule.recurse=false") {
			t.Fatalf("submodule command: %v", call)
		}
	}
	// The remote URL is derived from the validated identity.
	var remoteAdd string
	for _, call := range cap.gitCalls {
		for i, a := range call {
			if a == "add" && i+1 < len(call) {
				remoteAdd = call[i+2]
			}
		}
	}
	if remoteAdd != "https://github.com/statskey/ci-tests" {
		t.Fatalf("remote: %s", remoteAdd)
	}
}

func TestRunRequestViaCredential(t *testing.T) {
	dir := t.TempDir()
	credDir := filepath.Join(dir, "creds")
	if err := os.MkdirAll(credDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// systemd delivers credentials owned by the job user (never root) on a
	// read-only tmpfs; credential mode must not apply the root-ownership
	// check that direct paths require.
	reqPath := filepath.Join(credDir, "fleet-request")
	if err := os.WriteFile(reqPath, testTicket(t), 0o400); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(dir, "ws")
	if err := os.MkdirAll(filepath.Join(workspace, "repo"), 0o755); err != nil {
		t.Fatal(err)
	}
	cap := &runCapture{commit: testCommit}
	seam := cap.seam(workspace)
	baseStat := seam.Stat
	seam.Stat = func(path string) (fs.FileInfo, error) {
		if path == reqPath {
			return fakeFileInfo{name: "fleet-request", mode: 0o400, uid: 61_000}, nil
		}
		return baseStat(path)
	}
	seam.Getenv = func(k string) string {
		if k == "CREDENTIALS_DIRECTORY" {
			return credDir
		}
		return ""
	}
	r := &Runner{Seam: seam}
	if err := r.Run(context.Background(), []string{"runner", "@fleet-request", workspace}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if cap.execPath != "/usr/bin/node" {
		t.Fatalf("exec path: %s", cap.execPath)
	}

	// Credential names are bare names: separators or a missing directory
	// fail before any file read.
	for _, bad := range []string{"@../escape", "@a/b", "@"} {
		r = &Runner{Seam: seam}
		if err := r.Run(context.Background(), []string{"runner", bad, workspace}); !errors.Is(err, ErrUsage) {
			t.Fatalf("credential %q: expected ErrUsage, got %v", bad, err)
		}
	}
	seam.Getenv = func(string) string { return "" }
	r = &Runner{Seam: seam}
	if err := r.Run(context.Background(), []string{"runner", "@fleet-request", workspace}); !errors.Is(err, ErrUsage) {
		t.Fatalf("missing CREDENTIALS_DIRECTORY: expected ErrUsage, got %v", err)
	}
}

func TestRunCommitMismatch(t *testing.T) {
	dir := t.TempDir()
	reqPath := filepath.Join(dir, "request.json")
	os.WriteFile(reqPath, testTicket(t), 0o644)
	workspace := filepath.Join(dir, "ws")
	os.MkdirAll(workspace, 0o755)
	cap := &runCapture{commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	r := &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner", reqPath, workspace}); !errors.Is(err, ErrCommitMismatch) {
		t.Fatalf("expected commit mismatch, got %v", err)
	}
	if cap.execPath != "" {
		t.Fatal("exec happened despite commit mismatch")
	}
}

func TestRunRefusesRoot(t *testing.T) {
	r := &Runner{Seam: Seam{GetEUID: func() int { return 0 }}}
	if err := r.Run(context.Background(), []string{"runner", "/x", "/y"}); !errors.Is(err, ErrRoot) {
		t.Fatalf("root: %v", err)
	}
}

func TestRunRejectsBadRequest(t *testing.T) {
	dir := t.TempDir()
	workspace := filepath.Join(dir, "ws")
	os.MkdirAll(workspace, 0o755)
	cap := &runCapture{commit: testCommit}

	// Not canonical / not a ticket.
	bad := filepath.Join(dir, "bad.json")
	os.WriteFile(bad, []byte(`{"domain": "wrong"}`), 0o644)
	r := &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner", bad, workspace}); err == nil {
		t.Fatal("accepted bad request")
	}
	// Directory as request.
	r = &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner", dir, workspace}); err == nil {
		t.Fatal("accepted directory as request")
	}
	// Request file not owned by root is rejected.
	cap2 := &runCapture{commit: testCommit}
	seam := cap2.seam(workspace)
	seam.Stat = func(path string) (fs.FileInfo, error) {
		if strings.HasSuffix(path, ".json") {
			return fakeFileInfo{name: filepath.Base(path), mode: 0o644, uid: 1000}, nil
		}
		return nil, fs.ErrNotExist
	}
	r = &Runner{Seam: seam}
	if err := r.Run(context.Background(), []string{"runner", bad, workspace}); err == nil {
		t.Fatal("accepted non-root-owned request")
	}
	// Usage.
	r = &Runner{Seam: cap.seam(workspace)}
	if err := r.Run(context.Background(), []string{"runner"}); !errors.Is(err, ErrUsage) {
		t.Fatalf("usage: %v", err)
	}
}

func TestWorkdirEscape(t *testing.T) {
	repo := t.TempDir()
	for _, bad := range []string{"..", "../..", "a/../../x", "/abs"} {
		if _, err := resolveWorkdir(repo, bad); err == nil {
			t.Fatalf("accepted workdir %q", bad)
		}
	}
	// Valid subdirectory.
	sub := filepath.Join(repo, "sub")
	os.MkdirAll(sub, 0o755)
	got, err := resolveWorkdir(repo, "sub")
	if err != nil || got != sub {
		t.Fatalf("sub: %q %v", got, err)
	}
	// Missing dir rejected.
	if _, err := resolveWorkdir(repo, "missing"); err == nil {
		t.Fatal("accepted missing workdir")
	}
}

func TestCredentialHeader(t *testing.T) {
	h, err := credentialHeader("user:pass")
	if err != nil || !strings.HasPrefix(h, "Authorization: Basic ") {
		t.Fatalf("header: %q %v", h, err)
	}
	// Bare token gets the x-access-token username.
	h2, err := credentialHeader("tok123")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(h2, "eC1hY2Nlc3MtdG9rZW46dG9rMTIz") { // base64("x-access-token:tok123")
		t.Fatalf("token header: %q", h2)
	}
	// Multiline credentials rejected.
	if _, err := credentialHeader("a:b\nc:d"); err == nil {
		t.Fatal("accepted multiline credential")
	}
	if _, err := credentialHeader(""); err == nil {
		t.Fatal("accepted empty credential")
	}
}
