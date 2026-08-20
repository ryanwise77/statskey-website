// Package journal implements the root-owned ticket journal of
// FLEETD_DESIGN.md: /var/lib/statskey-fleetd/jobs/<ticketId>/ with
// write-fsync-rename atomicity, crash-recovery scan, and the markers the
// daemon needs for one-start-per-ticket semantics.
//
// Layout per ticket:
//
//	jobs/<ticketId>/request.json            canonical ticket bytes (0644)
//	jobs/<ticketId>/starting                start-attempt marker (0644)
//	jobs/<ticketId>/receipts/started.json   start receipt (0644)
//	jobs/<ticketId>/receipts/termination.json
//
// The starting marker is journaled before the daemon asks systemd to start
// the unit. A ticket whose marker exists but whose started receipt is
// missing has an ambiguous start outcome and must never be started again
// (invariants 3 and 15: fail closed).
package journal

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"statskey/fleetd/internal/wire"
)

var (
	ErrTicketConflict  = errors.New("journal: ticket ID already committed with different content")
	ErrStartAmbiguous  = errors.New("journal: start was already attempted for this ticket")
	ErrUnknownTicket   = errors.New("journal: unknown ticket")
	ErrInvalidTicketID = errors.New("journal: invalid ticket ID")
	ErrInvalidName     = errors.New("journal: invalid receipt name")
)

// Receipt names are a closed set.
const (
	ReceiptStarted     = "started"
	ReceiptTermination = "termination"
)

var receiptNamePattern = regexp.MustCompile(`^[a-z]{1,16}$`)

// TicketRecord is one journaled ticket's on-disk state.
type TicketRecord struct {
	TicketID   string
	Request    []byte // canonical ticket bytes
	Starting   bool   // start marker present
	Started    bool   // started receipt present
	Terminated bool   // termination receipt present
}

// Journal is a rooted ticket journal. All paths are derived from validated
// opaque ticket IDs; no caller-provided path ever reaches the filesystem.
type Journal struct {
	root string
}

// Open creates (if needed) and opens the journal rooted at root/jobs.
func Open(root string) (*Journal, error) {
	jobsDir := filepath.Join(root, "jobs")
	if err := os.MkdirAll(jobsDir, 0o700); err != nil {
		return nil, fmt.Errorf("journal: create %s: %w", jobsDir, err)
	}
	if err := os.Chmod(jobsDir, 0o700); err != nil {
		return nil, fmt.Errorf("journal: chmod %s: %w", jobsDir, err)
	}
	return &Journal{root: jobsDir}, nil
}

// Root returns the jobs directory path.
func (j *Journal) Root() string { return j.root }

func (j *Journal) ticketDir(ticketID string) (string, error) {
	if !wire.TicketIDPattern.MatchString(ticketID) {
		return "", ErrInvalidTicketID
	}
	return filepath.Join(j.root, ticketID), nil
}

// RequestPath returns the path of the ticket's request file (the file the
// systemd unit passes to the runner).
func (j *Journal) RequestPath(ticketID string) (string, error) {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "request.json"), nil
}

// CommitTicket journals the canonical ticket bytes. It returns
// existed=true when the ticket was already committed; identical bytes are an
// exact duplicate, different bytes are a hard conflict.
func (j *Journal) CommitTicket(ticketID string, canonicalTicket []byte) (existed bool, err error) {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return false, err
	}
	reqPath := filepath.Join(dir, "request.json")
	existing, readErr := os.ReadFile(reqPath)
	if readErr == nil {
		if bytes.Equal(existing, canonicalTicket) {
			return true, nil
		}
		return true, ErrTicketConflict
	}
	if !errors.Is(readErr, fs.ErrNotExist) {
		return false, fmt.Errorf("journal: read existing request: %w", readErr)
	}
	// Fresh ticket: create the directory structure, then the request file.
	if err := os.MkdirAll(filepath.Join(dir, "receipts"), 0o755); err != nil {
		return false, fmt.Errorf("journal: create ticket dir: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return false, fmt.Errorf("journal: chmod ticket dir: %w", err)
	}
	if err := writeFileAtomic(dir, "request.json", canonicalTicket, 0o644); err != nil {
		return false, err
	}
	return false, nil
}

// LoadTicket returns the committed canonical ticket bytes.
func (j *Journal) LoadTicket(ticketID string) ([]byte, error) {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(dir, "request.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrUnknownTicket
	}
	if err != nil {
		return nil, err
	}
	return b, nil
}

// MarkStarting records that a start is about to be attempted. It fails with
// ErrStartAmbiguous if a start was already attempted (marker present).
func (j *Journal) MarkStarting(ticketID string) error {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, "request.json")); errors.Is(err, fs.ErrNotExist) {
		return ErrUnknownTicket
	}
	marker := filepath.Join(dir, "starting")
	f, err := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return ErrStartAmbiguous
	}
	if err != nil {
		return fmt.Errorf("journal: create start marker: %w", err)
	}
	if _, err := f.WriteString("1\n"); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return syncDir(dir)
}

// StartingMarked reports whether a start was ever attempted.
func (j *Journal) StartingMarked(ticketID string) (bool, error) {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(filepath.Join(dir, "starting"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// WriteReceipt atomically writes a receipt under receipts/<name>.json.
func (j *Journal) WriteReceipt(ticketID, name string, b []byte) error {
	if !receiptNamePattern.MatchString(name) {
		return ErrInvalidName
	}
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return err
	}
	receiptsDir := filepath.Join(dir, "receipts")
	if _, err := os.Stat(receiptsDir); errors.Is(err, fs.ErrNotExist) {
		return ErrUnknownTicket
	}
	return writeFileAtomic(receiptsDir, name+".json", b, 0o644)
}

// ReadReceipt reads receipts/<name>.json; os.IsNotExist applies.
func (j *Journal) ReadReceipt(ticketID, name string) ([]byte, error) {
	if !receiptNamePattern.MatchString(name) {
		return nil, ErrInvalidName
	}
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(dir, "receipts", name+".json"))
}

// Scan enumerates all journaled tickets for crash recovery. Leftover
// temporary files from interrupted atomic writes are removed.
func (j *Journal) Scan() ([]TicketRecord, error) {
	entries, err := os.ReadDir(j.root)
	if err != nil {
		return nil, fmt.Errorf("journal: scan: %w", err)
	}
	var out []TicketRecord
	for _, e := range entries {
		if !e.IsDir() || !wire.TicketIDPattern.MatchString(e.Name()) {
			continue
		}
		dir := filepath.Join(j.root, e.Name())
		cleanTmpFiles(dir)
		cleanTmpFiles(filepath.Join(dir, "receipts"))
		rec := TicketRecord{TicketID: e.Name()}
		req, err := os.ReadFile(filepath.Join(dir, "request.json"))
		if err == nil {
			rec.Request = req
		} else if !errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("journal: scan %s: %w", e.Name(), err)
		}
		if _, err := os.Stat(filepath.Join(dir, "starting")); err == nil {
			rec.Starting = true
		}
		if _, err := os.Stat(filepath.Join(dir, "receipts", "started.json")); err == nil {
			rec.Started = true
		}
		if _, err := os.Stat(filepath.Join(dir, "receipts", "termination.json")); err == nil {
			rec.Terminated = true
		}
		out = append(out, rec)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].TicketID < out[b].TicketID })
	return out, nil
}

// Remove deletes a ticket's journal directory after settlement and workspace
// cleanup. Terminated tickets only: the daemon enforces that ordering.
func (j *Journal) Remove(ticketID string) error {
	dir, err := j.ticketDir(ticketID)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, "request.json")); errors.Is(err, fs.ErrNotExist) {
		return ErrUnknownTicket
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("journal: remove %s: %w", ticketID, err)
	}
	return syncDir(j.root)
}

// cleanTmpFiles removes interrupted atomic-write leftovers.
func cleanTmpFiles(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if len(name) > 1 && name[0] == '.' {
			os.Remove(filepath.Join(dir, name))
		}
	}
}

// writeFileAtomic writes data to dir/name with write-fsync-rename
// atomicity, then fsyncs the directory.
func writeFileAtomic(dir, name string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(dir, "."+name+".tmp.*")
	if err != nil {
		return fmt.Errorf("journal: create temp: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { os.Remove(tmpName) }
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		cleanup()
		return fmt.Errorf("journal: rename: %w", err)
	}
	return syncDir(dir)
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	if err := d.Sync(); err != nil {
		return fmt.Errorf("journal: fsync dir: %w", err)
	}
	return nil
}
