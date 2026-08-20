//go:build !windows

package main

import "errors"

// listenAndServe is available only on Windows: input injection uses the
// Windows named pipe plus SendInput path. Other platforms fail closed.
func listenAndServe(pipeName string, exec Executor) error {
	return errors.New("statskey-inputd: input injection is only supported on Windows")
}

// sendInputExecutorForPlatform returns nil: no executor exists off Windows.
func sendInputExecutorForPlatform() Executor { return nil }
