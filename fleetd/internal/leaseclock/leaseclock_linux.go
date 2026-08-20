//go:build linux

package leaseclock

import (
	"time"

	"golang.org/x/sys/unix"
)

// SystemClock reads CLOCK_BOOTTIME (includes suspend time) and the wall
// clock from the kernel.
type SystemClock struct{}

// NewSystemClock returns the kernel-backed clock.
func NewSystemClock() *SystemClock { return &SystemClock{} }

// BoottimeNow returns CLOCK_BOOTTIME.
func (SystemClock) BoottimeNow() (time.Duration, error) {
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_BOOTTIME, &ts); err != nil {
		return 0, err
	}
	return time.Duration(ts.Sec)*time.Second + time.Duration(ts.Nsec)*time.Nanosecond, nil
}

// WallNow returns the wall clock.
func (SystemClock) WallNow() time.Time { return time.Now() }
