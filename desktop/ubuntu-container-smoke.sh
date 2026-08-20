#!/usr/bin/env bash
set -euo pipefail

deb_path="${1:-/release/StatsKey-0.21.8-linux-x64.deb}"
expected_version="${2:-0.21.8}"
startup_attempts="${3:-90}"

if [[ "$(id -u)" != "0" ]]; then
  echo "Ubuntu package smoke must run as root inside an isolated test machine." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}:${VERSION_ID:-}:$(uname -m)" != "ubuntu:26.04:x86_64" ]]; then
  echo "Ubuntu package smoke requires Ubuntu 26.04 LTS amd64." >&2
  exit 1
fi
if [[ ! -f "$deb_path" || -L "$deb_path" ]]; then
  echo "The Ubuntu DEB is missing or is not a regular file." >&2
  exit 1
fi
if [[ ! "$startup_attempts" =~ ^[0-9]+$ ]] ||
  (( startup_attempts < 30 || startup_attempts > 900 ))
then
  echo "Startup attempts must be between 30 and 900 seconds." >&2
  exit 1
fi

field() {
  dpkg-deb --field "$deb_path" "$1"
}

[[ "$(field Package)" == "statskey-desktop" ]]
[[ "$(field Version)" == "$expected_version" ]]
[[ "$(field Architecture)" == "amd64" ]]
[[ "$(field Homepage)" == "https://statskey.ai" ]]
[[ "$(field Section)" == "devel" ]]
[[ "$(field Priority)" == "optional" ]]

package_contents="$(dpkg-deb --contents "$deb_path")"
for required_path in \
  "./opt/StatsKey/statskey" \
  "./opt/StatsKey/resources/app.asar" \
  "./opt/StatsKey/resources/package-type" \
  "./opt/StatsKey/resources/apparmor-profile" \
  "./usr/share/applications/statskey.desktop" \
  "/apps/statskey.png"
do
  if [[ "$package_contents" != *"$required_path"* ]]; then
    echo "Ubuntu DEB is missing $required_path." >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  "$deb_path" \
  curl \
  dbus-x11 \
  jq \
  xauth \
  xvfb

[[ "$(cat /opt/StatsKey/resources/package-type)" == "deb" ]]
[[ -x /opt/StatsKey/statskey ]]
[[ ! -e /opt/StatsKey/resources/app.asar.unpacked/node_modules/node-pty/build ]]
[[ -f /opt/StatsKey/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-x64/pty.node ]]
[[ ! -L /opt/StatsKey/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-x64/pty.node ]]

expected_apparmor_profile=$'abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile "statskey" "/opt/StatsKey/statskey" flags=(unconfined) {\n  userns,\n\n  # Site-specific additions and overrides. See local/README for details.\n  include if exists <local/statskey>\n}'
packaged_apparmor_profile="$(< /opt/StatsKey/resources/apparmor-profile)"
if [[ "$packaged_apparmor_profile" != "$expected_apparmor_profile" ]]; then
  echo "The packaged AppArmor user-namespace policy was not reviewed." >&2
  exit 1
fi
if command -v apparmor_status >/dev/null 2>&1 &&
  apparmor_status --enabled >/dev/null 2>&1
then
  [[ -f /etc/apparmor.d/statskey && ! -L /etc/apparmor.d/statskey ]]
  [[ "$(stat -c '%U:%G' /etc/apparmor.d/statskey)" == "root:root" ]]
  cmp --silent \
    /opt/StatsKey/resources/apparmor-profile \
    /etc/apparmor.d/statskey
  apparmor_parser --skip-kernel-load --debug \
    /opt/StatsKey/resources/apparmor-profile >/dev/null
  echo "AppArmor user-namespace policy: installed and parseable"
else
  echo "AppArmor user-namespace policy: packaged (host enforcement disabled)"
fi

if ! id statskeytest >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash statskeytest
fi

sandbox_owner="$(stat -c '%U:%G' /opt/StatsKey/chrome-sandbox)"
sandbox_mode="$(stat -c '%a' /opt/StatsKey/chrome-sandbox)"
[[ "$sandbox_owner" == "root:root" ]]
if [[ "$sandbox_mode" == "4755" ]]; then
  echo "Chromium sandbox: setuid fallback"
elif [[ "$sandbox_mode" == "755" ]] &&
  runuser -u statskeytest -- unshare --user true
then
  echo "Chromium sandbox: unprivileged user namespace"
else
  echo "The installed Chromium sandbox is not usable." >&2
  exit 1
fi

pty_probe=/home/statskeytest/statskey-node-pty-smoke.cjs
rm -f "$pty_probe"
cat >"$pty_probe" <<'NODE'
const pty = require(
  '/opt/StatsKey/resources/app.asar.unpacked/node_modules/node-pty'
)
const child = pty.spawn('/bin/bash', ['-lc', 'printf statskey-ubuntu-pty-ok'], {
  cols: 80,
  rows: 24,
  cwd: '/tmp',
  env: { HOME: '/home/statskeytest', PATH: '/usr/bin:/bin' },
})
let output = ''
const deadline = setTimeout(() => {
  process.stderr.write('node-pty smoke timed out\n')
  child.kill()
  process.exit(1)
}, 10_000)
child.onData((value) => {
  output += value
})
child.onExit(({ exitCode }) => {
  clearTimeout(deadline)
  if (exitCode !== 0 || !output.includes('statskey-ubuntu-pty-ok')) {
    process.stderr.write(`node-pty smoke failed: ${JSON.stringify(output)}\n`)
    process.exit(1)
  }
  process.stdout.write('node-pty: ready\n')
})
NODE
chown statskeytest:statskeytest "$pty_probe"
node_pty_passed=true
if ! runuser -u statskeytest -- env \
  ELECTRON_RUN_AS_NODE=1 \
  HOME=/home/statskeytest \
  /opt/StatsKey/statskey "$pty_probe"
then
  node_pty_passed=false
  echo "node-pty probe failed; continuing to collect the app-startup result." >&2
fi

if ! runuser -u statskeytest -- env \
  ELECTRON_RUN_AS_NODE=1 \
  HOME=/home/statskeytest \
  /opt/StatsKey/statskey -e "
    const server = require('node:net').createServer()
    server.once('error', () => process.exit(1))
    server.listen(43127, '127.0.0.1', () => server.close())
  "
then
  echo "Port 43127 is already occupied before the StatsKey smoke." >&2
  exit 1
fi

log_path=/home/statskeytest/statskey-smoke.log
setsid runuser -u statskeytest -- env HOME=/home/statskeytest \
  dbus-run-session -- xvfb-run -a \
  /opt/StatsKey/statskey --disable-gpu >"$log_path" 2>&1 &
app_pid=$!

cleanup() {
  kill -TERM -- "-$app_pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! kill -0 -- "-$app_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  kill -KILL -- "-$app_pid" >/dev/null 2>&1 || true
  wait "$app_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 "$startup_attempts"); do
  if response="$(curl --fail --silent \
    http://localhost:43127/.well-known/statskey-desktop-health)"
  then
    jq -e \
      --arg version "$expected_version" \
      '.status == "ready" and
       .version == $version and
       .architecture == "x64" and
       .updateFeed == null' <<<"$response" >/dev/null
    printf '%s\n' "$response"
    if [[ "$node_pty_passed" != "true" ]]; then
      echo "StatsKey started, but the node-pty probe failed." >&2
      exit 1
    fi
    echo "Ubuntu package smoke passed."
    exit 0
  fi
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    echo "StatsKey exited before its renderer became ready:" >&2
    while IFS= read -r line; do
      printf '%s\n' "$line" >&2
    done <"$log_path"
    exit 1
  fi
  sleep 1
done

echo "StatsKey did not become ready before the smoke deadline:" >&2
while IFS= read -r line; do
  printf '%s\n' "$line" >&2
done <"$log_path"
exit 1
