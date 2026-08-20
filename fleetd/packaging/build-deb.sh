#!/usr/bin/env bash
# build-deb.sh — reproducible statskey-fleetd Debian package builder.
#
# Builds the four linux/amd64 binaries from ../cmd (unless --bin-dir is
# given), assembles the Debian layout in a temp dir with the exact
# permissions from FLEETD_DESIGN.md, writes md5sums, and builds with
# `dpkg-deb --build --root-owner-group`. Prints the package SHA-256 and
# writes a binary manifest used by verify-install.sh.
#
# Runs on macOS (needs GNU dpkg-deb, e.g. `brew install dpkg`) and Linux.
# Bash 3.2-compatible (macOS system bash): no mapfile/assoc arrays.
#
# Usage:
#   ./build-deb.sh [--out DIR] [--bin-dir DIR] [--stage-only]
#
# Environment:
#   PKG_VERSION        Debian version (default: 0.1.0-1)
#   BUILD_ID           pinned build stamp embedded via -X build.id=
#                      (default: PKG_VERSION)
#   SOURCE_DATE_EPOCH  reproducibility epoch (default: 1787097600 =
#                      2026-08-19T00:00:00Z, the design-doc date)
#   GO_BUILD_LDFLAGS   full -ldflags override (default: "-X build.id=$BUILD_ID")
set -euo pipefail

PKG_NAME="statskey-fleetd"
PKG_VERSION="${PKG_VERSION:-0.1.0-1}"
PKG_ARCH="amd64"
# Exported: dpkg-deb reads SOURCE_DATE_EPOCH from the environment to pin the
# ar member timestamps in the .deb itself.
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1787097600}"
export SOURCE_DATE_EPOCH
BUILD_ID="${BUILD_ID:-$PKG_VERSION}"
GO_BUILD_LDFLAGS="${GO_BUILD_LDFLAGS:--X build.id=$BUILD_ID}"
BINARIES="statskey-fleetd statskey-fleet-agent statskey-fleet-runner statskey-fleet-enroll"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
PKG_DIR="$SCRIPT_DIR"
FLEETD_DIR="$(dirname "$PKG_DIR")"

BIN_DIR=""
OUT_DIR=""
STAGE_ONLY=0

usage() {
  cat <<'EOF'
Usage: build-deb.sh [--out DIR] [--bin-dir DIR] [--stage-only]

  --bin-dir DIR   use prebuilt linux/amd64 binaries from DIR instead of
                  building ../cmd/* with the Go toolchain
  --out DIR       output directory for the .deb + manifest (default: ./dist)
  --stage-only    assemble and validate the package tree, print its path,
                  and skip dpkg-deb (does not require dpkg-deb)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --bin-dir)
      BIN_DIR="${2:?error: --bin-dir requires a directory argument}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:?error: --out requires a directory argument}"
      shift 2
      ;;
    --stage-only)
      STAGE_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

OUT_DIR="${OUT_DIR:-$PKG_DIR/dist}"

# --- portable digest helpers ---------------------------------------------

md5_of() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q "$1"
  else
    echo "error: need md5sum or md5 to write DEBIAN/md5sums" >&2
    exit 1
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "error: need sha256sum or shasum" >&2
    exit 1
  fi
}

# --- preflight ------------------------------------------------------------

if [ "$STAGE_ONLY" -eq 0 ] && ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "error: dpkg-deb not found." >&2
  echo "  macOS:         brew install dpkg" >&2
  echo "  Debian/Ubuntu: sudo apt-get install dpkg-dev" >&2
  echo "  or re-run with --stage-only to assemble the tree without the .deb" >&2
  exit 1
fi

case "$PKG_VERSION" in
  [0-9]*)
    ;;
  *)
    echo "error: PKG_VERSION must start with a digit (Debian policy): '$PKG_VERSION'" >&2
    exit 1
    ;;
esac

REQUIRED_FILES=(
  "$PKG_DIR/deb/control"
  "$PKG_DIR/deb/conffiles"
  "$PKG_DIR/deb/postinst"
  "$PKG_DIR/deb/prerm"
  "$PKG_DIR/deb/postrm"
  "$PKG_DIR/systemd/statskey-fleetd.socket"
  "$PKG_DIR/systemd/statskey-fleetd.service"
  "$PKG_DIR/systemd/statskey-fleet-agent.service"
  "$PKG_DIR/sysusers.d/statskey-fleet.conf"
  "$PKG_DIR/tmpfiles.d/statskey-fleet.conf"
  "$PKG_DIR/apparmor/statskey-fleet-job" "$PKG_DIR/apparmor/statskey-fleet-prep"
  "$PKG_DIR/config/coordinator-keys.json"
  "$PKG_DIR/config/policy.json"
)
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "error: required packaging file missing: $f" >&2
    exit 1
  fi
done

# --- binaries -------------------------------------------------------------

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/statskey-fleetd-stage.XXXXXX")"
# mktemp creates the staging root 0700; the package root must be 0755.
chmod 0755 "$STAGE"
BIN_OUT="$(mktemp -d "${TMPDIR:-/tmp}/statskey-fleetd-bin.XXXXXX")"
KEEP_STAGE=0
cleanup() {
  if [ "$KEEP_STAGE" -eq 0 ]; then
    rm -rf "$STAGE"
  fi
  rm -rf "$BIN_OUT"
}
trap cleanup EXIT

verify_elf_amd64() {
  # Best-effort check that a binary is a linux/amd64 ELF (skipped with a
  # warning when `file` is unavailable).
  if command -v file >/dev/null 2>&1; then
    desc="$(file -b "$1")"
    case "$desc" in
      *ELF*64-bit*x86-64*)
        ;;
      *)
        echo "error: $1 is not a linux/amd64 ELF binary: $desc" >&2
        exit 1
        ;;
    esac
  else
    echo "warning: 'file' not available; cannot verify $1 is linux/amd64" >&2
  fi
}

if [ -n "$BIN_DIR" ]; then
  for b in $BINARIES; do
    if [ ! -f "$BIN_DIR/$b" ]; then
      echo "error: --bin-dir $BIN_DIR is missing $b" >&2
      exit 1
    fi
    verify_elf_amd64 "$BIN_DIR/$b"
  done
  SRC_BIN="$BIN_DIR"
else
  if ! command -v go >/dev/null 2>&1; then
    echo "error: Go toolchain not found; install Go 1.26 or pass --bin-dir" >&2
    exit 1
  fi
  if [ ! -f "$FLEETD_DIR/go.mod" ]; then
    echo "error: $FLEETD_DIR/go.mod not found." >&2
    echo "  The Go module is built by a separate workstream. Either wait for" >&2
    echo "  fleetd/cmd/* to land, or pass --bin-dir with prebuilt linux/amd64" >&2
    echo "  binaries (CGO_ENABLED=0 -trimpath -buildvcs=false)." >&2
    exit 1
  fi
  for b in $BINARIES; do
    if [ ! -d "$FLEETD_DIR/cmd/$b" ]; then
      echo "error: missing Go command directory: $FLEETD_DIR/cmd/$b" >&2
      exit 1
    fi
    echo "building $b (linux/amd64, CGO_ENABLED=0 -trimpath -buildvcs=false)"
    (
      cd "$FLEETD_DIR"
      CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
        go build -trimpath -buildvcs=false \
        -ldflags "$GO_BUILD_LDFLAGS" \
        -o "$BIN_OUT/$b" "./cmd/$b"
    )
    verify_elf_amd64 "$BIN_OUT/$b"
  done
  SRC_BIN="$BIN_OUT"
fi

# --- staging layout (permissions per FLEETD_DESIGN.md) --------------------
# Ownership is recorded as root:root by dpkg-deb --root-owner-group; only
# modes are set here.

install -d -m 0755 "$STAGE/DEBIAN"

# Binaries: root:root 0755. Daemon, agent, and the fixed runner live in
# /usr/libexec (never on PATH); the enroll CLI is admin-invoked, so it gets
# the conventional /usr/bin slot.
install -d -m 0755 "$STAGE/usr/libexec"
install -d -m 0755 "$STAGE/usr/bin"
install -m 0755 "$SRC_BIN/statskey-fleetd" "$STAGE/usr/libexec/statskey-fleetd"
install -m 0755 "$SRC_BIN/statskey-fleet-agent" "$STAGE/usr/libexec/statskey-fleet-agent"
install -m 0755 "$SRC_BIN/statskey-fleet-runner" "$STAGE/usr/libexec/statskey-fleet-runner"
install -m 0755 "$SRC_BIN/statskey-fleet-enroll" "$STAGE/usr/bin/statskey-fleet-enroll"

# systemd units (0644). /usr/lib/systemd/system is the merged-/usr location
# used by Ubuntu 26.04.
install -d -m 0755 "$STAGE/usr/lib/systemd/system"
install -m 0644 "$PKG_DIR/systemd/statskey-fleetd.socket" "$STAGE/usr/lib/systemd/system/statskey-fleetd.socket"
install -m 0644 "$PKG_DIR/systemd/statskey-fleetd.service" "$STAGE/usr/lib/systemd/system/statskey-fleetd.service"
install -m 0644 "$PKG_DIR/systemd/statskey-fleet-agent.service" "$STAGE/usr/lib/systemd/system/statskey-fleet-agent.service"

# sysusers.d / tmpfiles.d (0644).
install -d -m 0755 "$STAGE/usr/lib/sysusers.d"
install -m 0644 "$PKG_DIR/sysusers.d/statskey-fleet.conf" "$STAGE/usr/lib/sysusers.d/statskey-fleet.conf"
install -d -m 0755 "$STAGE/usr/lib/tmpfiles.d"
install -m 0644 "$PKG_DIR/tmpfiles.d/statskey-fleet.conf" "$STAGE/usr/lib/tmpfiles.d/statskey-fleet.conf"

# AppArmor profile (0644, package-managed — NOT a conffile; its digest is
# attested, so local edits must fail closed rather than survive upgrades).
install -d -m 0755 "$STAGE/etc/apparmor.d"
install -m 0644 "$PKG_DIR/apparmor/statskey-fleet-job" "$STAGE/etc/apparmor.d/statskey-fleet-job"
install -m 0644 "$PKG_DIR/apparmor/statskey-fleet-prep" "$STAGE/etc/apparmor.d/statskey-fleet-prep"

# /etc/statskey/fleetd (root:root 0755) with the coordinator key ring and
# policy (root:root 0644, conffiles — local pin changes survive upgrades).
install -d -m 0755 "$STAGE/etc/statskey/fleetd"
install -m 0644 "$PKG_DIR/config/coordinator-keys.json" "$STAGE/etc/statskey/fleetd/coordinator-keys.json"
install -m 0644 "$PKG_DIR/config/policy.json" "$STAGE/etc/statskey/fleetd/policy.json"

# /var/lib/* and /run/statskey-fleetd are intentionally NOT shipped in the
# package: systemd-tmpfiles creates them with the design-doc ownership at
# install time and at every boot.

# --- DEBIAN metadata ------------------------------------------------------

INSTALLED_SIZE="$(du -sk "$STAGE" | awk '{print $1}')"

sed "s/^Version:.*/Version: $PKG_VERSION/" "$PKG_DIR/deb/control" > "$STAGE/DEBIAN/control"
printf 'Installed-Size: %s\n' "$INSTALLED_SIZE" >> "$STAGE/DEBIAN/control"
chmod 0644 "$STAGE/DEBIAN/control"

install -m 0644 "$PKG_DIR/deb/conffiles" "$STAGE/DEBIAN/conffiles"
install -m 0755 "$PKG_DIR/deb/postinst" "$STAGE/DEBIAN/postinst"
install -m 0755 "$PKG_DIR/deb/prerm" "$STAGE/DEBIAN/prerm"
install -m 0755 "$PKG_DIR/deb/postrm" "$STAGE/DEBIAN/postrm"

# md5sums over every payload file (dpkg format: "<md5>  <relative path>").
(
  cd "$STAGE"
  find . -type f ! -path './DEBIAN/*' -print | LC_ALL=C sort | while IFS= read -r f; do
    rel="${f#./}"
    printf '%s  %s\n' "$(md5_of "$f")" "$rel"
  done > DEBIAN/md5sums
)
chmod 0644 "$STAGE/DEBIAN/md5sums"

# --- reproducibility: pin all archive member mtimes -----------------------

if date -u -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S >/dev/null 2>&1; then
  TS="$(date -u -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)"      # BSD date
else
  TS="$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)"     # GNU date
fi
find "$STAGE" -exec touch -h -t "$TS" {} +

# --- manifest (installed absolute paths; consumed by verify-install.sh) ---

mkdir -p "$OUT_DIR"
MANIFEST="$OUT_DIR/${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.manifest.sha256"
{
  printf '%s  /usr/libexec/%s\n' "$(sha256_of "$STAGE/usr/libexec/statskey-fleetd")" "statskey-fleetd"
  printf '%s  /usr/libexec/%s\n' "$(sha256_of "$STAGE/usr/libexec/statskey-fleet-agent")" "statskey-fleet-agent"
  printf '%s  /usr/libexec/%s\n' "$(sha256_of "$STAGE/usr/libexec/statskey-fleet-runner")" "statskey-fleet-runner"
  printf '%s  /usr/bin/%s\n' "$(sha256_of "$STAGE/usr/bin/statskey-fleet-enroll")" "statskey-fleet-enroll"
} > "$MANIFEST"
echo "wrote binary manifest: $MANIFEST"

# --- build ----------------------------------------------------------------

if [ "$STAGE_ONLY" -eq 1 ]; then
  KEEP_STAGE=1
  echo "stage-only: package tree assembled at $STAGE"
  echo "stage-only: skipping dpkg-deb --build"
  exit 0
fi

DEB_OUT="$OUT_DIR/${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.deb"
rm -f "$DEB_OUT"
dpkg-deb --build --root-owner-group "$STAGE" "$DEB_OUT"

DEB_SHA256="$(sha256_of "$DEB_OUT")"
printf '%s  %s\n' "$DEB_SHA256" "$(basename "$DEB_OUT")" > "$DEB_OUT.sha256"

echo ""
echo "built: $DEB_OUT"
echo "package sha256: $DEB_SHA256"
echo "checksum file: $DEB_OUT.sha256"
echo ""
dpkg-deb --info "$DEB_OUT"
