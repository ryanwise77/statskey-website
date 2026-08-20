package daemon

import (
	"fmt"
	"net"
	"os"
	"path/filepath"

	"github.com/coreos/go-systemd/v22/activation"
)

// ListenControl returns the control socket listener: the socket-activated
// listener when systemd handed us one, otherwise a freshly created socket at
// cfg.SocketPath owned root:statskey-fleet mode 0660 (matching
// statskey-fleetd.socket).
func ListenControl(socketPath string, agentGID uint32) (net.Listener, error) {
	listeners, err := activation.Listeners()
	if err != nil {
		return nil, fmt.Errorf("daemon: socket activation: %w", err)
	}
	if len(listeners) == 1 {
		return listeners[0], nil
	}
	if len(listeners) > 1 {
		return nil, fmt.Errorf("daemon: expected at most one activated socket, got %d", len(listeners))
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o750); err != nil {
		return nil, err
	}
	// Remove a stale socket file; refusing to unlink non-sockets.
	if st, err := os.Lstat(socketPath); err == nil {
		if st.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("daemon: %s exists and is not a socket", socketPath)
		}
		if err := os.Remove(socketPath); err != nil {
			return nil, err
		}
	}
	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("daemon: listen %s: %w", socketPath, err)
	}
	if err := os.Chmod(socketPath, 0o660); err != nil {
		ln.Close()
		return nil, err
	}
	if agentGID != 0 {
		if err := os.Chown(socketPath, 0, int(agentGID)); err != nil {
			ln.Close()
			return nil, fmt.Errorf("daemon: chown socket: %w", err)
		}
	}
	return ln, nil
}
