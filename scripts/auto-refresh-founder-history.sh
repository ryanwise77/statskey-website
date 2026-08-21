#!/bin/sh
# Nightly founder-history archive refresh, run by launchd on Ryan's Mac
# (com.statskey.founder-archive-refresh). It operates in a dedicated checkout
# so it never touches an interactive working tree, rebuilds the static archive
# from the public Firestore replica, and pushes to origin/main only when the
# archive files actually changed. The site merges recent meals live in the
# browser, so a missed night degrades gracefully instead of going stale.
#
# The archive builder requires this checkout to live directly inside
# ~/Projects, because it resolves ../StatsKey and ../Training for the
# projection helpers and local history inputs.
set -eu

REPO="${STATSKEY_ARCHIVE_REFRESH_REPO:-$HOME/Projects/.statskey-website-archive-refresh}"
LOCK="$REPO/.refresh.lock"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

[ -d "$REPO/.git" ] || { echo "refresh checkout missing at $REPO" >&2; exit 1; }
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another refresh is already running" >&2
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO"
git fetch origin main
git reset --hard origin/main
git clean -fd public/statskey-app/founder-history

npm ci --no-audit --no-fund --prefer-offline
npm run test:founder-history
npm run refresh:founder-history

git add public/statskey-app/founder-history public/statskey-app/founder-live-fallback.json
if git diff --cached --quiet; then
  echo "archive already current; nothing to push"
  exit 0
fi
git -c user.name="statskey-archive-refresh" \
    -c user.email="ryanwsullivan71@users.noreply.github.com" \
    commit -m "Refresh founder history archive (scheduled)"
git push origin HEAD:main
