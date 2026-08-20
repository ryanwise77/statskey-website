package runner

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// RealSeam returns the production system dependencies.
func RealSeam() Seam {
	return Seam{
		GetEUID:    unix.Geteuid,
		RunCommand: runCommandReal,
		RunGit:     runGitReal,
	}
}

// runCommandReal runs the job command as a child (never exec-replace, so the
// runner survives to record the exit code), forwarding termination signals.
func runCommandReal(path string, argv []string, env []string) (int, error) {
	cmd := exec.Command(path, argv[1:]...)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = nil
	if err := cmd.Start(); err != nil {
		return -1, fmt.Errorf("runner: start command: %w", err)
	}
	// Forward termination to the child; the cgroup is the hard backstop.
	sigCh := make(chan os.Signal, 4)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case sig, ok := <-sigCh:
				if !ok {
					return
				}
				_ = cmd.Process.Signal(sig)
			case <-done:
				return
			}
		}
	}()
	err := cmd.Wait()
	signal.Stop(sigCh)
	close(sigCh)
	<-done
	if err == nil {
		return 0, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode(), nil
	}
	return -1, fmt.Errorf("runner: wait command: %w", err)
}

// runGitReal executes git with a bounded runtime, capturing stdout and
// discarding nothing from stderr (it flows to the job log via the caller).
func runGitReal(dir string, env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", firstArg(args), err, truncate(stderr.String(), 400))
	}
	return stdout.String(), nil
}

func firstArg(args []string) string {
	if len(args) > 0 {
		return args[0]
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func base64Encode(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

// Main is the cmd/statskey-fleet-runner entry point.
func Main(argv []string) int {
	r := &Runner{Seam: RealSeam()}
	err := r.Run(context.Background(), argv)
	if err == nil {
		return 0
	}
	var exitErr *ExitError
	if errors.As(err, &exitErr) {
		return exitErr.Code
	}
	fmt.Fprintf(os.Stderr, "statskey-fleet-runner: %v\n", err)
	return 1
}
