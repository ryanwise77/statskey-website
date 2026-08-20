// Package hostinfo collects the host facts the daemon attests to: boot ID,
// os-release identity, kernel release, cgroup v2, systemd version, and
// AppArmor state. Parsing is portable and tested; probing is Linux-only.
package hostinfo

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"statskey/fleetd/internal/wire"
)

// Facts are the probed host facts for attestation.
type Facts struct {
	BootIDDigest string
	Platform     wire.PlatformInfo
	Security     wire.SecurityInfo
}

var (
	bootIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	// boot IDs may also be presented as 32 bare hex digits.
	bootIDHexPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// BootIDDigest returns sha256:<base64url> of the raw boot ID string bytes.
func BootIDDigest(bootID string) (string, error) {
	bootID = strings.TrimSpace(bootID)
	if !bootIDPattern.MatchString(bootID) && !bootIDHexPattern.MatchString(bootID) {
		return "", errors.New("hostinfo: invalid boot ID")
	}
	sum := sha256.Sum256([]byte(bootID))
	return "sha256:" + base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// ParseOSRelease extracts ID and VERSION_ID from os-release content.
func ParseOSRelease(content string) (id, versionID string, err error) {
	fields := map[string]string{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"'`)
		fields[k] = v
	}
	id = fields["ID"]
	versionID = fields["VERSION_ID"]
	if id == "" || versionID == "" {
		return "", "", errors.New("hostinfo: os-release missing ID or VERSION_ID")
	}
	return id, versionID, nil
}

// DigestFileHex returns sha256:<64 lowercase hex> of a file's contents
// (build IDs, AppArmor profile digests).
func DigestFileHex(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(b) == 0 || len(b) > 256*1024*1024 {
		return "", fmt.Errorf("hostinfo: file %s size invalid", path)
	}
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// DigestBytesHex returns sha256:<64 lowercase hex> of b.
func DigestBytesHex(b []byte) string {
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// ParseSystemdVersion extracts the major version from a systemd version
// string like "257" or "257.1-2ubuntu1".
func ParseSystemdVersion(s string) (string, error) {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, `"`)
	if i := strings.IndexAny(s, ".-+"); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return "", errors.New("hostinfo: empty systemd version")
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return "", fmt.Errorf("hostinfo: bad systemd version %q", s)
		}
	}
	return s, nil
}
