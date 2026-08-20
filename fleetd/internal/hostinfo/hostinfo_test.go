package hostinfo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBootIDDigest(t *testing.T) {
	d, err := BootIDDigest("0f2e3d4c-5b6a-7890-abcd-ef1234567890")
	if err != nil {
		t.Fatal(err)
	}
	if len(d) != len("sha256:")+43 {
		t.Fatalf("digest shape: %q", d)
	}
	// Bare hex form also accepted.
	if _, err := BootIDDigest("0f2e3d4c5b6a7890abcdef1234567890"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "xyz", "0f2e3d4c-5b6a-7890-abcd-ef1234567890\nextra", "UPPERCASE-ONLY-AAAA-BBBB-CCCCDDDDEEEE"} {
		if _, err := BootIDDigest(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestParseOSRelease(t *testing.T) {
	id, vid, err := ParseOSRelease(`PRETTY_NAME="Ubuntu 26.04 LTS"
ID=ubuntu
VERSION_ID="26.04"
`)
	if err != nil || id != "ubuntu" || vid != "26.04" {
		t.Fatalf("got %q %q %v", id, vid, err)
	}
	if _, _, err := ParseOSRelease("ID=ubuntu\n"); err == nil {
		t.Fatal("accepted missing VERSION_ID")
	}
}

func TestParseSystemdVersion(t *testing.T) {
	for in, want := range map[string]string{
		"257":            "257",
		`"257"`:          "257",
		"257.1-2ubuntu1": "257",
		"255+deb13":      "255",
	} {
		got, err := ParseSystemdVersion(in)
		if err != nil || got != want {
			t.Fatalf("ParseSystemdVersion(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := ParseSystemdVersion("abc"); err == nil {
		t.Fatal("accepted non-numeric version")
	}
}

func TestDigestFileHex(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "profile")
	if err := os.WriteFile(p, []byte("profile body"), 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := DigestFileHex(p)
	if err != nil {
		t.Fatal(err)
	}
	want := DigestBytesHex([]byte("profile body"))
	if d != want {
		t.Fatalf("digest %q != %q", d, want)
	}
	if _, err := DigestFileHex(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("accepted missing file")
	}
}
