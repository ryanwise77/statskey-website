// statskey-fleet-enroll is the enrollment helper. "request" generates (or
// reuses) the device Ed25519 keypair and prints the candidate payload for
// the owner to approve from their controller. "accept" stores the approved
// enrollment (endpoint, coordinator key pin, device ID) with 0600/0700
// permissions.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/enroll"
	"statskey/fleetd/internal/fleetclient"
	"statskey/fleetd/internal/keys"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	log.SetPrefix("statskey-fleet-enroll: ")
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "request":
		err = runRequest(os.Args[2:])
	case "accept":
		err = runAccept(os.Args[2:])
	case "sign":
		err = runSign(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `usage:
  statskey-fleet-enroll request --label <name> [--max-jobs 1] [--state-dir /var/lib/statskey-fleet]
  statskey-fleet-enroll accept  --endpoint <url> --coordinator-key-id <id> --coordinator-public-key-spki <spki> --device-id <dev_...> [--state-dir ...]
  statskey-fleet-enroll sign    --action <pairing.candidate|...> [--state-dir ...] < payload.json

request prints the candidate payload for the owner to approve from their
controller. accept stores the approved enrollment. sign reads a JSON payload
on stdin and prints a signed device request envelope (used for the
pairing.candidate proof during owner-approved pairing).
`)
}

func runRequest(args []string) error {
	fs := flag.NewFlagSet("request", flag.ExitOnError)
	stateDir := fs.String("state-dir", envOr("STATSKEY_FLEET_AGENT_STATE_DIR", "/var/lib/statskey-fleet"), "agent state directory")
	label := fs.String("label", "", "device label shown to the owner")
	maxJobs := fs.Int64("max-jobs", 1, "maximum concurrent jobs")
	fs.Parse(args)

	store := &enroll.Store{Dir: *stateDir}
	priv, created, err := store.LoadOrCreateDeviceKey()
	if err != nil {
		return err
	}
	if created {
		log.Printf("generated new device key in %s", *stateDir)
	}
	candidate, err := enroll.CandidatePayload(*label, keys.Public(priv), *maxJobs)
	if err != nil {
		return err
	}
	out, err := json.MarshalIndent(candidate, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func runAccept(args []string) error {
	fs := flag.NewFlagSet("accept", flag.ExitOnError)
	stateDir := fs.String("state-dir", envOr("STATSKEY_FLEET_AGENT_STATE_DIR", "/var/lib/statskey-fleet"), "agent state directory")
	endpoint := fs.String("endpoint", "", "coordinator device endpoint (https)")
	keyID := fs.String("coordinator-key-id", "", "coordinator response key id")
	spki := fs.String("coordinator-public-key-spki", "", "coordinator response public key (base64url SPKI)")
	deviceID := fs.String("device-id", "", "approved device id (dev_...)")
	fs.Parse(args)

	store := &enroll.Store{Dir: *stateDir}
	// The stored device key must match the approved device ID.
	priv, _, err := store.LoadOrCreateDeviceKey()
	if err != nil {
		return err
	}
	localID, err := keys.DeviceID(keys.Public(priv))
	if err != nil {
		return err
	}
	if localID != *deviceID {
		return fmt.Errorf("approved device id %s does not match the local device key (%s)", *deviceID, localID)
	}
	e := &enroll.Enrollment{
		Version:                  1,
		Endpoint:                 *endpoint,
		CoordinatorKeyID:         *keyID,
		CoordinatorPublicKeySpki: *spki,
		DeviceID:                 *deviceID,
	}
	if err := store.SaveEnrollment(e); err != nil {
		return err
	}
	log.Printf("enrollment stored in %s", *stateDir)
	return nil
}

func runSign(args []string) error {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	stateDir := fs.String("state-dir", envOr("STATSKEY_FLEET_AGENT_STATE_DIR", "/var/lib/statskey-fleet"), "agent state directory")
	action := fs.String("action", "", "device action being signed (e.g. pairing.candidate)")
	fs.Parse(args)
	if *action == "" {
		return fmt.Errorf("--action is required")
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 128*1024))
	if err != nil {
		return err
	}
	// FromJSON keeps integer literals exact; a plain Unmarshal would decode
	// to float64 and the canonical encoder would (correctly) refuse to sign.
	payload, err := canon.FromJSON(raw)
	if err != nil {
		return fmt.Errorf("payload must be canonical-compatible JSON: %w", err)
	}
	store := &enroll.Store{Dir: *stateDir}
	priv, _, err := store.LoadOrCreateDeviceKey()
	if err != nil {
		return err
	}
	deviceID, err := keys.DeviceID(keys.Public(priv))
	if err != nil {
		return err
	}
	requestID, err := fleetclient.NewRequestID()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	envelope, err := fleetclient.CreateSignedRequest(
		priv, deviceID, *action, payload, now, now+60_000, requestID,
	)
	if err != nil {
		return err
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}
