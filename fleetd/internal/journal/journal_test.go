package journal

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

const testTicketID = "ticket_0123456789abcdef0123456789abcdef"
const testTicketID2 = "ticket_fedcba9876543210fedcba9876543210"

func openTemp(t *testing.T) *Journal {
	t.Helper()
	j, err := Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	return j
}

func TestCommitAndLoad(t *testing.T) {
	j := openTemp(t)
	ticket := []byte(`{"domain":"x"}`)
	existed, err := j.CommitTicket(testTicketID, ticket)
	if err != nil {
		t.Fatal(err)
	}
	if existed {
		t.Fatal("fresh commit reported existing")
	}
	got, err := j.LoadTicket(testTicketID)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(ticket) {
		t.Fatal("content mismatch")
	}
	// Request path is derived and inside the journal.
	p, err := j.RequestPath(testTicketID)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(p) != filepath.Join(j.Root(), testTicketID) {
		t.Fatalf("unexpected request path %s", p)
	}
}

func TestCommitDuplicateAndConflict(t *testing.T) {
	j := openTemp(t)
	a := []byte(`{"a":1}`)
	if _, err := j.CommitTicket(testTicketID, a); err != nil {
		t.Fatal(err)
	}
	// Byte-identical duplicate is accepted.
	existed, err := j.CommitTicket(testTicketID, a)
	if err != nil || !existed {
		t.Fatalf("duplicate: existed=%v err=%v", existed, err)
	}
	// Different content under the same ticket ID is a hard conflict.
	if _, err := j.CommitTicket(testTicketID, []byte(`{"a":2}`)); !errors.Is(err, ErrTicketConflict) {
		t.Fatalf("conflict: %v", err)
	}
}

func TestInvalidTicketID(t *testing.T) {
	j := openTemp(t)
	for _, bad := range []string{
		"",
		"ticket_short",
		"ticket_UPPERCASE7890123456789012345678ab",
		"../etc",
		"ticket_0123456789abcdef0123456789abcdeg", // non-hex
		"ticket_0123456789abcdef0123456789abcdef/..",
	} {
		if _, err := j.CommitTicket(bad, []byte(`{}`)); !errors.Is(err, ErrInvalidTicketID) {
			t.Fatalf("CommitTicket(%q): %v", bad, err)
		}
		if _, err := j.LoadTicket(bad); !errors.Is(err, ErrInvalidTicketID) {
			t.Fatalf("LoadTicket(%q): %v", bad, err)
		}
	}
}

func TestMarkStartingOnce(t *testing.T) {
	j := openTemp(t)
	if _, err := j.CommitTicket(testTicketID, []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	marked, err := j.StartingMarked(testTicketID)
	if err != nil || marked {
		t.Fatalf("before: marked=%v err=%v", marked, err)
	}
	if err := j.MarkStarting(testTicketID); err != nil {
		t.Fatal(err)
	}
	marked, err = j.StartingMarked(testTicketID)
	if err != nil || !marked {
		t.Fatalf("after: marked=%v err=%v", marked, err)
	}
	// Second start attempt is ambiguous and refused.
	if err := j.MarkStarting(testTicketID); !errors.Is(err, ErrStartAmbiguous) {
		t.Fatalf("second mark: %v", err)
	}
	// Unknown ticket cannot be marked.
	if err := j.MarkStarting(testTicketID2); !errors.Is(err, ErrUnknownTicket) {
		t.Fatalf("unknown: %v", err)
	}
}

func TestReceipts(t *testing.T) {
	j := openTemp(t)
	if _, err := j.CommitTicket(testTicketID, []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := j.ReadReceipt(testTicketID, ReceiptStarted); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("missing receipt: %v", err)
	}
	if err := j.WriteReceipt(testTicketID, ReceiptStarted, []byte(`{"r":1}`)); err != nil {
		t.Fatal(err)
	}
	got, err := j.ReadReceipt(testTicketID, ReceiptStarted)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"r":1}` {
		t.Fatal("receipt mismatch")
	}
	// Receipt for unknown ticket.
	if err := j.WriteReceipt(testTicketID2, ReceiptStarted, []byte(`{}`)); !errors.Is(err, ErrUnknownTicket) {
		t.Fatalf("unknown ticket receipt: %v", err)
	}
	// Invalid receipt name (path escape attempt).
	if err := j.WriteReceipt(testTicketID, "../../etc", []byte(`{}`)); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("bad name: %v", err)
	}
}

func TestScanAndCrashRecovery(t *testing.T) {
	j := openTemp(t)
	// Ticket 1: committed only.
	if _, err := j.CommitTicket(testTicketID, []byte(`{"n":1}`)); err != nil {
		t.Fatal(err)
	}
	// Ticket 2: committed + starting + started.
	if _, err := j.CommitTicket(testTicketID2, []byte(`{"n":2}`)); err != nil {
		t.Fatal(err)
	}
	if err := j.MarkStarting(testTicketID2); err != nil {
		t.Fatal(err)
	}
	if err := j.WriteReceipt(testTicketID2, ReceiptStarted, []byte(`{"s":1}`)); err != nil {
		t.Fatal(err)
	}
	// Simulate an interrupted atomic write: stray temp files.
	tmpFile := filepath.Join(j.Root(), testTicketID, ".request.json.tmp.123")
	if err := os.WriteFile(tmpFile, []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A non-ticket entry is ignored.
	if err := os.MkdirAll(filepath.Join(j.Root(), "not-a-ticket"), 0o755); err != nil {
		t.Fatal(err)
	}

	recs, err := j.Scan()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 2 {
		t.Fatalf("scan returned %d records, want 2", len(recs))
	}
	byID := map[string]TicketRecord{}
	for _, r := range recs {
		byID[r.TicketID] = r
	}
	r1 := byID[testTicketID]
	if r1.Request == nil || r1.Starting || r1.Started || r1.Terminated {
		t.Fatalf("ticket1 state: %+v", r1)
	}
	r2 := byID[testTicketID2]
	if r2.Request == nil || !r2.Starting || !r2.Started || r2.Terminated {
		t.Fatalf("ticket2 state: %+v", r2)
	}
	// Temp file cleaned up by scan.
	if _, err := os.Stat(tmpFile); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("stray temp file not cleaned")
	}
}

func TestRemove(t *testing.T) {
	j := openTemp(t)
	if _, err := j.CommitTicket(testTicketID, []byte(`{"n":1}`)); err != nil {
		t.Fatal(err)
	}
	if err := j.Remove(testTicketID); err != nil {
		t.Fatal(err)
	}
	if _, err := j.LoadTicket(testTicketID); !errors.Is(err, ErrUnknownTicket) {
		t.Fatalf("after remove: %v", err)
	}
	if err := j.Remove(testTicketID); !errors.Is(err, ErrUnknownTicket) {
		t.Fatalf("double remove: %v", err)
	}
}

func TestDirPermissions(t *testing.T) {
	j := openTemp(t)
	if _, err := j.CommitTicket(testTicketID, []byte(`{"n":1}`)); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(j.Root())
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("jobs dir mode = %o, want 700", st.Mode().Perm())
	}
	st, err = os.Stat(filepath.Join(j.Root(), testTicketID))
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("ticket dir mode = %o, want 700", st.Mode().Perm())
	}
	st, err = os.Stat(filepath.Join(j.Root(), testTicketID, "request.json"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o644 {
		t.Fatalf("request mode = %o, want 644", st.Mode().Perm())
	}
}
