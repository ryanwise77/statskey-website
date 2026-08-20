#!/usr/bin/env bash
# verify-install.sh — post-install verification for statskey-fleetd on a
# real Ubuntu 26.04 amd64 host. Run as root after `apt install`/`dpkg -i`:
#
#   sudo ./verify-install.sh [--manifest PATH]
#
# --manifest defaults to the newest statskey-fleetd_*.manifest.sha256 in the
# current directory (written by build-deb.sh next to the .deb).
#
# Every check prints PASS/FAIL; the script exits nonzero if anything FAILs.
set -euo pipefail

PKG_NAME="statskey-fleetd"
MANIFEST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest)
      MANIFEST="${2:?error: --manifest requires a path}"
      shift 2
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

PASS_COUNT=0
FAIL_COUNT=0

ok()   { printf 'PASS  %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
bad()  { printf 'FAIL  %s\n' "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { printf 'INFO  %s\n' "$1"; }

# expect_eq <description> <actual> <expected>
expect_eq() {
  if [ "$2" = "$3" ]; then
    ok "$1 ($2)"
  else
    bad "$1 (got '$2', want '$3')"
  fi
}

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "error: run as root (sudo $0 $*)" >&2
  exit 2
fi

if [ "$(uname -m)" != "x86_64" ]; then
  bad "host architecture is x86_64"
fi

# --- 1. package installed -------------------------------------------------

if dpkg-query -W -f='${Status}' "$PKG_NAME" 2>/dev/null | grep -q 'install ok installed'; then
  ok "dpkg package $PKG_NAME installed"
else
  bad "dpkg package $PKG_NAME installed"
  echo "Package not installed; aborting remaining checks." >&2
  exit 1
fi

# --- 2. binary hashes against the build manifest --------------------------

if [ -z "$MANIFEST" ]; then
  # newest manifest in cwd, if any
  MANIFEST="$(ls -1t statskey-fleetd_*.manifest.sha256 2>/dev/null | head -n 1 || true)"
fi
if [ -z "$MANIFEST" ] || [ ! -f "$MANIFEST" ]; then
  bad "binary manifest found (pass --manifest PATH; written by build-deb.sh)"
else
  ok "binary manifest present: $MANIFEST"
  while read -r want_hash bin_path; do
    [ -n "$want_hash" ] || continue
    if [ ! -f "$bin_path" ]; then
      bad "installed binary exists: $bin_path"
      continue
    fi
    got_hash="$(sha256sum "$bin_path" | awk '{print $1}')"
    expect_eq "sha256 $bin_path" "$got_hash" "$want_hash"
  done < "$MANIFEST"
fi

# --- 3. binary ownership/modes ---------------------------------------------

for entry in \
  "/usr/libexec/statskey-fleetd 755 root:root" \
  "/usr/libexec/statskey-fleet-agent 755 root:root" \
  "/usr/libexec/statskey-fleet-runner 755 root:root" \
  "/usr/bin/statskey-fleet-enroll 755 root:root"; do
  path="${entry%% *}"
  want="$(echo "$entry" | awk '{print $2, $3}')"
  if [ -f "$path" ]; then
    expect_eq "mode/owner $path" "$(stat -c '%a %U:%G' "$path")" "$want"
  else
    bad "installed binary exists: $path"
  fi
done

# --- 4. unit file syntax ---------------------------------------------------

UNITS="statskey-fleetd.socket statskey-fleetd.service statskey-fleet-agent.service"
for unit in $UNITS; do
  unit_path="/usr/lib/systemd/system/$unit"
  if [ ! -f "$unit_path" ]; then
    bad "unit installed: $unit_path"
    continue
  fi
  if verify_out="$(systemd-analyze verify "$unit_path" 2>&1)"; then
    ok "systemd-analyze verify $unit"
  else
    bad "systemd-analyze verify $unit"
    printf '%s\n' "$verify_out" | sed 's/^/      /'
  fi
done

# Key directives, statically checked against the installed unit files.
unit_file_has() { # unit_file_has <unit> <directive-line>
  grep -qxF "$2" "/usr/lib/systemd/system/$1"
}
check_directive() { # check_directive <unit> <directive-line>
  if unit_file_has "$1" "$2"; then
    ok "$1: $2"
  else
    bad "$1: $2"
  fi
}

check_directive statskey-fleetd.socket "ListenStream=/run/statskey-fleetd/control.sock"
check_directive statskey-fleetd.socket "SocketUser=root"
check_directive statskey-fleetd.socket "SocketGroup=statskey-fleet"
check_directive statskey-fleetd.socket "SocketMode=0660"
check_directive statskey-fleetd.service "PrivateNetwork=yes"
check_directive statskey-fleetd.service "RestrictAddressFamilies=AF_UNIX AF_NETLINK"
check_directive statskey-fleetd.service "ReadWritePaths=/var/lib/statskey-fleetd /var/lib/statskey-fleet-jobs"
check_directive statskey-fleet-agent.service "User=statskey-fleet"
check_directive statskey-fleet-agent.service "After=network-online.target statskey-fleetd.socket"
check_directive statskey-fleet-agent.service "Requires=statskey-fleetd.socket"
check_directive statskey-fleet-agent.service "ReadWritePaths=/var/lib/statskey-fleet"

# --- 5. sysusers / tmpfiles applied ---------------------------------------

if getent passwd statskey-fleet >/dev/null 2>&1; then
  ok "user statskey-fleet exists"
  passwd_line="$(getent passwd statskey-fleet)"
  expect_eq "statskey-fleet home" "$(echo "$passwd_line" | cut -d: -f6)" "/var/lib/statskey-fleet"
  expect_eq "statskey-fleet shell" "$(echo "$passwd_line" | cut -d: -f7)" "/usr/sbin/nologin"
else
  bad "user statskey-fleet exists (systemd-sysusers statskey-fleet.conf)"
fi
if getent group statskey-fleet >/dev/null 2>&1; then
  ok "group statskey-fleet exists"
else
  bad "group statskey-fleet exists"
fi

for entry in \
  "/var/lib/statskey-fleet 700 statskey-fleet:statskey-fleet" \
  "/var/lib/statskey-fleetd 700 root:root" \
  "/var/lib/statskey-fleet-jobs 751 root:root" \
  "/run/statskey-fleetd 750 root:statskey-fleet"; do
  path="${entry%% *}"
  want="$(echo "$entry" | awk '{print $2, $3}')"
  if [ -d "$path" ]; then
    expect_eq "tmpfiles dir $path" "$(stat -c '%a %U:%G' "$path")" "$want"
  else
    bad "tmpfiles dir exists: $path (systemd-tmpfiles --create statskey-fleet.conf)"
  fi
done

# --- 6. AppArmor profile loaded and enforcing ------------------------------

PROFILES_FILE="/sys/kernel/security/apparmor/profiles"
if [ ! -e /sys/module/apparmor ]; then
  bad "kernel AppArmor enabled (/sys/module/apparmor missing)"
elif [ ! -r "$PROFILES_FILE" ]; then
  bad "AppArmor profiles file readable ($PROFILES_FILE)"
else
  if grep -qx 'statskey-fleet-job (enforce)' "$PROFILES_FILE"; then
    ok "AppArmor profile statskey-fleet-job loaded in enforce mode"
  elif grep -q '^statskey-fleet-job ' "$PROFILES_FILE"; then
    bad "AppArmor profile statskey-fleet-job in enforce mode (loaded but NOT enforcing)"
  else
    bad "AppArmor profile statskey-fleet-job loaded (run: apparmor_parser -r /etc/apparmor.d/statskey-fleet-job)"
  fi
fi

# --- 7. socket state --------------------------------------------------------

if systemctl is-active --quiet statskey-fleetd.socket; then
  sock="/run/statskey-fleetd/control.sock"
  if [ -S "$sock" ]; then
    expect_eq "control socket mode/owner" "$(stat -c '%a %U:%G' "$sock")" "660 root:statskey-fleet"
  else
    bad "control socket node exists: $sock"
  fi
else
  info "statskey-fleetd.socket not active (dormant); unit directives checked above"
fi

# --- 8. dormant services ----------------------------------------------------

for unit in statskey-fleetd.socket statskey-fleet-agent.service; do
  if [ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" = "enabled" ]; then
    ok "$unit enabled"
  else
    bad "$unit enabled"
  fi
done
for unit in statskey-fleetd.service statskey-fleet-agent.service; do
  if systemctl is-active --quiet "$unit"; then
    bad "$unit dormant (unexpectedly active before pairing/attestation)"
  else
    ok "$unit dormant (not running)"
  fi
done

# --- 9. daemon has no network listeners -------------------------------------

main_pid="$(systemctl show statskey-fleetd.service --property=MainPID --value 2>/dev/null || echo 0)"
if [ -n "$main_pid" ] && [ "$main_pid" != "0" ]; then
  if ss -H -ltnp 2>/dev/null | grep -q "pid=$main_pid,"; then
    bad "statskey-fleetd (pid $main_pid) has no TCP listeners"
  else
    ok "statskey-fleetd (pid $main_pid) has no TCP listeners"
  fi
  if ss -H -lunp 2>/dev/null | grep -q "pid=$main_pid,"; then
    bad "statskey-fleetd (pid $main_pid) has no UDP listeners"
  else
    ok "statskey-fleetd (pid $main_pid) has no UDP listeners"
  fi
else
  ok "statskey-fleetd has no network listeners (daemon not running; PrivateNetwork=yes checked above)"
fi

# --- 10. no leftover job units ----------------------------------------------

if systemctl list-units --all --no-legend --no-pager --plain 'statskey-fleet-job-*' 2>/dev/null | grep -q .; then
  bad "no statskey-fleet-job-* units present after install"
else
  ok "no statskey-fleet-job-* units present"
fi

# --- 11. conffiles ------------------------------------------------------------

for conf in /etc/statskey/fleetd/coordinator-keys.json /etc/statskey/fleetd/policy.json; do
  if [ -f "$conf" ]; then
    expect_eq "conffile mode/owner $conf" "$(stat -c '%a %U:%G' "$conf")" "644 root:root"
    if command -v python3 >/dev/null 2>&1; then
      if python3 -m json.tool "$conf" >/dev/null 2>&1; then
        ok "$conf is valid JSON"
      else
        bad "$conf is valid JSON"
      fi
    else
      info "python3 unavailable; skipped JSON validation of $conf"
    fi
  else
    bad "conffile exists: $conf"
  fi
done

# --- summary ------------------------------------------------------------------

echo ""
echo "verify-install: $PASS_COUNT PASS, $FAIL_COUNT FAIL"
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
exit 0
