package daemon

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/coreos/go-systemd/v22/daemon"
)

// watchdogLoop sends WATCHDOG=1 keepalives at half the configured
// WatchdogSec interval. When the daemon hangs, systemd stops it and
// BindsTo=statskey-fleetd.service stops every job unit (invariant 6).
// Without a watchdog environment this is a no-op.
func watchdogLoop(ctx context.Context, logf *log.Logger) {
	usecStr := os.Getenv("WATCHDOG_USEC")
	if usecStr == "" || os.Getenv("WATCHDOG_PID") == "" {
		return
	}
	usec, err := strconv.ParseInt(usecStr, 10, 64)
	if err != nil || usec <= 0 {
		return
	}
	interval := time.Duration(usec/2) * time.Microsecond
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if _, err := daemon.SdNotify(false, daemon.SdNotifyWatchdog); err != nil {
				logf.Printf("watchdog notify: %v", err)
			}
		}
	}
}
