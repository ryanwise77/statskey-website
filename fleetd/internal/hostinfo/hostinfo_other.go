//go:build !linux

package hostinfo

import "errors"

// Probe is Linux-only.
func Probe(systemdVersion string, appArmorProfilePath string) (Facts, error) {
	return Facts{}, errors.New("hostinfo: probe requires Linux")
}
