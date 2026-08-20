//go:build !linux

package leaseclock

import "time"

// SystemClock is the non-Linux fallback: Go's monotonic clock reading, which
// excludes suspend on some platforms. It exists so the daemon binary compiles
// and tests run on macOS; production deployments use the Linux clock.
type SystemClock struct {
	start time.Time
}

// NewSystemClock returns the fallback clock.
func NewSystemClock() *SystemClock { return &SystemClock{start: time.Now()} }

// BoottimeNow returns monotonic time since process start.
func (c *SystemClock) BoottimeNow() (time.Duration, error) {
	return time.Since(c.start), nil
}

// WallNow returns the wall clock.
func (SystemClock) WallNow() time.Time { return time.Now() }
