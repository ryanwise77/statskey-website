//go:build !linux

package daemon

import (
	"errors"
	"net"
)

// PeerUID is unavailable off Linux; tests inject a fake via SetPeerUIDFunc.
// The daemon fails closed when no peer UID can be determined.
func PeerUID(net.Conn) (uint32, error) {
	return 0, errors.New("daemon: SO_PEERCRED requires Linux")
}
