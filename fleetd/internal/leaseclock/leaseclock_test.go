package leaseclock

import (
	"errors"
	"testing"
	"time"
)

var t0 = time.Date(2026, 8, 19, 20, 0, 0, 0, time.UTC)

func TestEstablishAndExpiry(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	expiry := t0.Add(5 * time.Minute)
	if err := k.Establish("ticket_a", 0, expiry, []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	exp, err := k.Expired()
	if err != nil {
		t.Fatal(err)
	}
	if len(exp) != 0 {
		t.Fatalf("unexpected expiry: %v", exp)
	}
	// Normal passage past the deadline expires the lease.
	clk.Advance(6 * time.Minute)
	exp, err = k.Expired()
	if err != nil {
		t.Fatal(err)
	}
	if len(exp) != 1 || exp[0] != "ticket_a" {
		t.Fatalf("expected ticket_a expired, got %v", exp)
	}
}

func TestSuspendCountsAgainstLease(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	if err := k.Establish("ticket_a", 0, t0.Add(5*time.Minute), []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	// Suspend for 10 minutes: wall clock for userspace froze, boottime
	// advanced. The lease must be expired even though "only" 0 wall minutes
	// passed for the process.
	clk.Suspend(10 * time.Minute)
	exp, err := k.Expired()
	if err != nil {
		t.Fatal(err)
	}
	if len(exp) != 1 {
		t.Fatal("suspend time did not count against the lease")
	}
}

func TestWallJumpCannotExtend(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	if err := k.Establish("ticket_a", 0, t0.Add(5*time.Minute), []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	// Wall clock jumps backward an hour (NTP/attack): the boottime deadline
	// is unaffected.
	clk.AdvanceWallOnly(-time.Hour)
	clk.Advance(6 * time.Minute)
	exp, err := k.Expired()
	if err != nil {
		t.Fatal(err)
	}
	if len(exp) != 1 {
		t.Fatal("wall-clock jump extended lease authority")
	}
}

func TestSequenceMonotonicity(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	if err := k.Establish("ticket_a", 0, t0.Add(5*time.Minute), []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	// Strictly increasing renewal accepted.
	dup, err := k.Accept("ticket_a", 1, t0.Add(10*time.Minute), false, []byte(`{"seq":1}`))
	if err != nil || dup {
		t.Fatalf("seq 1: dup=%v err=%v", dup, err)
	}
	// Equal sequence, byte-identical: accepted as duplicate.
	dup, err = k.Accept("ticket_a", 1, t0.Add(10*time.Minute), false, []byte(`{"seq":1}`))
	if err != nil || !dup {
		t.Fatalf("dup seq 1: dup=%v err=%v", dup, err)
	}
	// Equal sequence, different bytes: rejected.
	if _, err := k.Accept("ticket_a", 1, t0.Add(11*time.Minute), false, []byte(`{"seq":1,"x":1}`)); !errors.Is(err, ErrSequenceConflict) {
		t.Fatalf("conflict: %v", err)
	}
	// Lower sequence: rejected as stale.
	if _, err := k.Accept("ticket_a", 0, t0.Add(12*time.Minute), false, []byte(`{"seq":0}`)); !errors.Is(err, ErrStaleSequence) {
		t.Fatalf("stale: %v", err)
	}
	// Unknown ticket.
	if _, err := k.Accept("ticket_b", 5, t0.Add(time.Minute), false, nil); !errors.Is(err, ErrUnknownLease) {
		t.Fatalf("unknown: %v", err)
	}
	// Duplicate establish rejected.
	if err := k.Establish("ticket_a", 0, t0.Add(time.Minute), nil); !errors.Is(err, ErrLeaseExists) {
		t.Fatalf("re-establish: %v", err)
	}
}

func TestCancelAndRemove(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	if err := k.Establish("ticket_a", 0, t0.Add(5*time.Minute), []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := k.Accept("ticket_a", 1, t0.Add(5*time.Minute), true, []byte(`{"seq":1,"cancelled":true}`)); err != nil {
		t.Fatal(err)
	}
	// Cancelled leases are immediately expired regardless of deadline.
	exp, err := k.Expired()
	if err != nil {
		t.Fatal(err)
	}
	if len(exp) != 1 {
		t.Fatal("cancelled lease not expired")
	}
	k.Remove("ticket_a")
	if _, ok := k.Get("ticket_a"); ok {
		t.Fatal("lease not removed")
	}
}

func TestRenewalMovesDeadline(t *testing.T) {
	clk := NewFakeClock(t0)
	k := NewKeeper(clk)
	if err := k.Establish("ticket_a", 0, t0.Add(2*time.Minute), []byte(`{"seq":0}`)); err != nil {
		t.Fatal(err)
	}
	// At t+1m, renew to wall t+6m. Boottime is t+1m, remaining wall 5m, so
	// the boottime deadline lands at boot t+6m.
	clk.Advance(1 * time.Minute)
	if _, err := k.Accept("ticket_a", 1, t0.Add(6*time.Minute), false, []byte(`{"seq":1}`)); err != nil {
		t.Fatal(err)
	}
	l, ok := k.Get("ticket_a")
	if !ok {
		t.Fatal("missing lease")
	}
	if l.HighestSequence != 1 {
		t.Fatalf("seq = %d", l.HighestSequence)
	}
	// Advance past the original deadline: still alive.
	clk.Advance(90 * time.Second)
	if exp, _ := k.Expired(); len(exp) != 0 {
		t.Fatal("renewed lease expired early")
	}
	// Advance past the new deadline.
	clk.Advance(4 * time.Minute)
	if exp, _ := k.Expired(); len(exp) != 1 {
		t.Fatal("renewed lease did not expire at new deadline")
	}
}
