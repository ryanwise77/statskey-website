// statskey-fleet-runner is the fixed job runner executed by systemd as the
// job DynamicUser. argv[1] is the root-owned request file; argv[2] is the
// job workspace. It never runs as root.
package main

import (
	"os"

	"statskey/fleetd/internal/runner"
)

func main() {
	os.Exit(runner.Main(os.Args))
}
