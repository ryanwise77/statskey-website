//go:build unix

package runner

import (
	"io/fs"
	"syscall"
)

// fileOwnerUID extracts the owner UID from a stat result.
func fileOwnerUID(st fs.FileInfo) (uint32, bool) {
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		return sys.Uid, true
	}
	return 0, false
}
