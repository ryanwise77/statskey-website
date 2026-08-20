// Command wireinterop proves byte-level wire compatibility between this Go
// module and the coordinator's fleetHelperProtocol.js. In "emit" mode it
// signs a TerminationReceiptV1 and ExecutionStartedReceiptV1 with a fresh
// helper key and prints them as canonical JSON for the JS side to verify.
// In "verify <ticket-file> <spki-file>" mode it decodes and verifies a
// coordinator-signed ExecutionTicketV1 produced by the JS side.
package main

import (
	"fmt"
	"os"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

func emit() error {
	priv, err := keys.Generate()
	if err != nil {
		return err
	}
	spki, err := keys.SPKIBase64url(keys.Public(priv))
	if err != nil {
		return err
	}
	ticketID := "ticket_11111111111111111111111111111111"
	term := &wire.TerminationReceipt{
		TicketID:             ticketID,
		JobID:                "job_00000000000000000000000000000000",
		Attempt:              1,
		LeaseID:              "lease_22222222222222222222222222222222",
		HelperInstanceID:     "hi_33333333333333333333333333333333",
		HighestLeaseSequence: 2,
		ExitStatus:           0,
		TerminationReason:    "exited",
		UnitName:             "statskey-fleet-job-" + ticketID + ".service",
		CgroupPath:           "/sys/fs/cgroup/system.slice/statskey-fleet-job-" + ticketID + ".service",
		Populated:            false,
		Accounting: wire.ResourceAccounting{
			CPUUsageNs:      1_000_000,
			MemoryPeakBytes: 4096,
			PidsPeak:        12,
			IOReadBytes:     1024,
			IOWriteBytes:    2048,
		},
		FinishedAt:            time.Date(2026, 8, 19, 6, 31, 0, 0, time.UTC),
		FinishedAtMonotonicMs: 123_456,
	}
	if err := term.Sign(priv); err != nil {
		return err
	}
	started := &wire.ExecutionStartedReceipt{
		TicketID:         ticketID,
		JobID:            term.JobID,
		Attempt:          1,
		LeaseID:          term.LeaseID,
		HelperInstanceID: term.HelperInstanceID,
		UnitName:         term.UnitName,
		CgroupPath:       term.CgroupPath,
		EffectiveLimits: wire.ResourceLimits{
			CPUMilli:    4000,
			MemoryBytes: 8 << 30,
			Pids:        256,
			DiskBytes:   20 << 30,
			WallTimeMs:  3_600_000,
		},
		RunnerBuildID:        "sha256:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		StartedAt:            time.Date(2026, 8, 19, 6, 30, 5, 0, time.UTC),
		StartedAtMonotonicMs: 60_000,
	}
	if err := started.Sign(priv); err != nil {
		return err
	}
	termBytes, err := term.Marshal()
	if err != nil {
		return err
	}
	startedBytes, err := started.Marshal()
	if err != nil {
		return err
	}
	out := map[string]any{
		"helperPublicKeySpki": spki,
		"terminationReceipt":  string(termBytes),
		"startedReceipt":      string(startedBytes),
	}
	enc, err := canon.Encode(out)
	if err != nil {
		return err
	}
	fmt.Println(string(enc))
	return nil
}

func verifyTicket(ticketPath, spkiPath string) error {
	ticketBytes, err := os.ReadFile(ticketPath)
	if err != nil {
		return err
	}
	spki, err := os.ReadFile(spkiPath)
	if err != nil {
		return err
	}
	pub, _, err := keys.ParsePublicKeySPKI(string(spki))
	if err != nil {
		return err
	}
	ticket, err := wire.DecodeExecutionTicket(ticketBytes)
	if err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	if err := ticket.Verify(pub); err != nil {
		return fmt.Errorf("verify: %w", err)
	}
	fmt.Printf("ticket %s verified for job %s attempt %d\n", ticket.TicketID, ticket.JobID, ticket.Attempt)
	return nil
}

func main() {
	if len(os.Args) == 4 && os.Args[1] == "verify" {
		if err := verifyTicket(os.Args[2], os.Args[3]); err != nil {
			fmt.Fprintln(os.Stderr, "verify failed:", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "emit" {
		if err := emit(); err != nil {
			fmt.Fprintln(os.Stderr, "emit failed:", err)
			os.Exit(1)
		}
		return
	}
	fmt.Fprintln(os.Stderr, "usage: wireinterop emit | verify <ticket-file> <spki-file>")
	os.Exit(2)
}
