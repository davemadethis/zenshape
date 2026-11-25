#!/usr/bin/env bash
# One launch of the installed .deb under Xvfb: start it, look for an error
# box, run the smoke test, look again, and take whole-screen shots, then stop
# it (the next launch needs the single-instance lock).
# Usage: launch-linux.sh <out-dir> [hidden]
#   hidden: the profile was seeded with the tab bar hidden; also shoots the
#   screen before the test (hidden) and after it (check g leaves it peeked).
set -u
out=$1
mkdir -p "$out"
export ZS_SMOKE_OUT=$out ZS_SMOKE_LOG=$out/app.log
export ZS_SMOKE_HIDDEN=$([ "${2:-}" = hidden ] && echo 1)
bin=$(dpkg -L zenshape | grep -E '/bin/' | head -1)
echo "app: $bin"
nohup "$bin" --remote-debugging-port="$ZS_SMOKE_PORT" > "$ZS_SMOKE_LOG" 2>&1 &
app=$!
failed=0
sleep 15
bash test/smoke/no-error-dialog.sh after-start || failed=1
if [ -n "$ZS_SMOKE_HIDDEN" ]; then
  import -window root "$out/screen.png" || true
fi
npm run test:smoke || failed=1
bash test/smoke/no-error-dialog.sh after-test || failed=1
import -window root "$out/$([ -n "$ZS_SMOKE_HIDDEN" ] && echo screen-peeked || echo screen).png" || true
kill "$app" 2>/dev/null
# By process name: the checkout's own path contains "zenshape" too.
pkill -x zenshape 2>/dev/null
for _ in $(seq 30); do pgrep -x zenshape > /dev/null || break; sleep 1; done
exit $failed
