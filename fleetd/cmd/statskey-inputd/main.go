// statskey-inputd is the Fleet remote-session input injection helper for
// Windows hosts. The StatsKey desktop spawns it as the console user when a
// remote session with the screen.input capability activates; it listens on
// the named pipe \\.\pipe\statskey-input and executes validated mouse and
// keyboard primitives with SendInput.
//
// Security contract:
//
//   - Runs only as the console user. Never run it elevated or as a service:
//     SendInput from a higher integrity level would let injected input cross
//     into elevated windows.
//   - The pipe uses the default DACL (current user + SYSTEM) and rejects
//     remote clients, so only same-user processes can issue commands.
//   - Commands are one JSON object per line, at most 4 KiB, strictly parsed;
//     anything but bounded mouse/keyboard primitives is rejected, and an
//     oversized line closes the connection.
//   - No shell-outs, no filesystem access, no network access.
package main

import (
	"flag"
	"log"
)

func main() {
	pipeName := flag.String("pipe", `\\.\pipe\statskey-input`, "named pipe to listen on")
	flag.Parse()
	log.SetPrefix("statskey-inputd: ")
	log.SetFlags(0)
	if err := listenAndServe(*pipeName, sendInputExecutorForPlatform()); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}
