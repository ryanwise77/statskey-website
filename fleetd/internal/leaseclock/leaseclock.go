// Package leaseclock enforces lease deadlines on CLOCK_BOOTTIME so that
// suspend time counts against lease authority (invariant 5). On receipt of a
// signed LeaseUpdate the daemon converts the remaining wall time to a
// boottime deadline once; later wall-clock changes cannot extend authority.
//
// Sequence numbers must strictly increase; an equal-sequence update is
// accepted only when byte-identical to the stored one (invariant 4).
package leaseclock

import (
	"bytes"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrStaleSequence    = errors.New("leaseclock: lease sequence must strictly increase")
	ErrSequenceConflict = errors.New("leaseclock: equal sequence with different content")
	ErrUnknownLease     = errors.New("leaseclock: unknown ticket")
	ErrLeaseExists      = errors.New("leaseclock: lease already established")
	ErrExpired          = errors.New("leaseclock: lease already expired")
)

// Clock supplies wall and boottime readings. The Linux implementation uses
// CLOCK_BOOTTIME; tests use FakeClock.
type Clock interface {
	// BoottimeNow returns time since boot including suspend (CLOCK_BOOTTIME).
	BoottimeNow() (time.Duration, error)
	// WallNow returns the current wall-clock time.
	WallNow() time.Time
}

// Lease is the daemon's authority record for one ticket.
type Lease struct {
	TicketID        string
	HighestSequence int64
	DeadlineBoot    time.Duration // boottime deadline
	LeaseExpiresAt  time.Time     // wall-clock expiry from the latest update
	Cancelled       bool
	LastUpdateBytes []byte // canonical bytes of the accepted update
}

// Keeper tracks leases per ticket with strictly increasing sequences.
type Keeper struct {
	clock  Clock
	mu     sync.Mutex
	leases map[string]*Lease
}

// NewKeeper creates a Keeper on clock.
func NewKeeper(clock Clock) *Keeper {
	return &Keeper{clock: clock, leases: map[string]*Lease{}}
}

// Establish installs the initial lease from a verified ticket (sequence 0 or
// the ticket's leaseSequence) at receipt time.
func (k *Keeper) Establish(ticketID string, seq int64, leaseExpiresAt time.Time, raw []byte) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	if _, ok := k.leases[ticketID]; ok {
		return ErrLeaseExists
	}
	deadline, err := k.deadlineLocked(leaseExpiresAt)
	if err != nil {
		return err
	}
	k.leases[ticketID] = &Lease{
		TicketID:        ticketID,
		HighestSequence: seq,
		DeadlineBoot:    deadline,
		LeaseExpiresAt:  leaseExpiresAt,
		LastUpdateBytes: append([]byte(nil), raw...),
	}
	return nil
}

// deadlineLocked converts an absolute wall expiry to a boottime deadline
// using the current wall↔boottime delta. A past expiry yields a deadline of
// "now" (already expired; the reaper stops the unit).
func (k *Keeper) deadlineLocked(leaseExpiresAt time.Time) (time.Duration, error) {
	boot, err := k.clock.BoottimeNow()
	if err != nil {
		return 0, fmt.Errorf("leaseclock: boottime: %w", err)
	}
	remaining := leaseExpiresAt.Sub(k.clock.WallNow())
	if remaining < 0 {
		remaining = 0
	}
	return boot + remaining, nil
}

// Accept applies a verified LeaseUpdate. The caller must have already
// verified the coordinator signature, ticket binding, and
// leaseExpiresAt <= jobDeadlineAt. Returns duplicate=true when an
// equal-sequence byte-identical update was accepted without change.
func (k *Keeper) Accept(ticketID string, seq int64, leaseExpiresAt time.Time, cancelled bool, raw []byte) (duplicate bool, err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	l, ok := k.leases[ticketID]
	if !ok {
		return false, ErrUnknownLease
	}
	if seq < l.HighestSequence {
		return false, ErrStaleSequence
	}
	if seq == l.HighestSequence {
		if !bytes.Equal(l.LastUpdateBytes, raw) {
			return false, ErrSequenceConflict
		}
		return true, nil
	}
	deadline, err := k.deadlineLocked(leaseExpiresAt)
	if err != nil {
		return false, err
	}
	l.HighestSequence = seq
	l.DeadlineBoot = deadline
	l.LeaseExpiresAt = leaseExpiresAt
	l.Cancelled = cancelled
	l.LastUpdateBytes = append([]byte(nil), raw...)
	return false, nil
}

// Get returns a copy of the lease for a ticket.
func (k *Keeper) Get(ticketID string) (Lease, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	l, ok := k.leases[ticketID]
	if !ok {
		return Lease{}, false
	}
	cp := *l
	cp.LastUpdateBytes = append([]byte(nil), l.LastUpdateBytes...)
	return cp, true
}

// Remove deletes a lease (after settlement).
func (k *Keeper) Remove(ticketID string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.leases, ticketID)
}

// Expired returns the ticket IDs whose deadline has passed or that were
// cancelled, based on a single boottime reading.
func (k *Keeper) Expired() ([]string, error) {
	boot, err := k.clock.BoottimeNow()
	if err != nil {
		return nil, err
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	var out []string
	for id, l := range k.leases {
		if l.Cancelled || boot >= l.DeadlineBoot {
			out = append(out, id)
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// test clock
// ---------------------------------------------------------------------------

// FakeClock is a manually advanced Clock for tests.
type FakeClock struct {
	mu   sync.Mutex
	boot time.Duration
	wall time.Time
}

// NewFakeClock starts a fake clock at the given wall time.
func NewFakeClock(wall time.Time) *FakeClock {
	return &FakeClock{wall: wall}
}

func (f *FakeClock) BoottimeNow() (time.Duration, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.boot, nil
}

func (f *FakeClock) WallNow() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.wall
}

// Advance moves both clocks forward (normal passage of time).
func (f *FakeClock) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.boot += d
	f.wall = f.wall.Add(d)
}

// AdvanceWallOnly moves only the wall clock (a wall-clock jump, e.g. NTP
// step). Boottime-based deadlines are unaffected.
func (f *FakeClock) AdvanceWallOnly(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.wall = f.wall.Add(d)
}

// Suspend advances only the boottime clock (system suspend: wall time in
// userspace freezes but CLOCK_BOOTTIME keeps counting).
func (f *FakeClock) Suspend(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.boot += d
}
