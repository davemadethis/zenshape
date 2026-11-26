#!/usr/bin/env bash
# One launch of the installed .deb under Xvfb: start it, look for an error
# box, run the smoke test, look again, and take whole-screen shots, then stop
# it (the next launch needs the single-instance lock).
# Usage: launch-linux.sh <out-dir> [hidden]
#   hidden: the profile was seeded with the tab bar hidden; also shoots the
#   screen before the test (hidden) and after it (check g leaves it peeked).
# Then step h: the Z's menu (shot, not judged) and Ctrl+T with no menu bar.
set -u
out=$1
mkdir -p "$out"
export ZS_SMOKE_OUT=$out ZS_SMOKE_LOG=$out/app.log
export ZS_SMOKE_HIDDEN=$([ "${2:-}" = hidden ] && echo 1)
# The app says on stdout when the Z's menu opens and closes (check h).
export ZENSHAPE_TRACE_MENUS=1
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
# Before h, which may leave it unpeeked.
if [ -n "$ZS_SMOKE_HIDDEN" ]; then
  import -window root "$out/screen-peeked.png" || true
fi
# h: the Z's menu stays open for the shot; one Esc closes it (a spare one
# would reach the page). Then Ctrl+T, with no menu bar drawn: only the
# application menu's accelerator can open the tab the last pass counts.
ZS_SMOKE_PASS=menu npm run test:smoke || failed=1
sleep 2
import -window root "$out/screen-menu.png" || true
xdotool key Escape
sleep 1
# Its title is "Zenshape"; WM_CLASS "zenshape" as a fallback.
win=$(xdotool search --onlyvisible --name '^Zenshape$' | head -1)
[ -n "$win" ] || win=$(xdotool search --onlyvisible --class zenshape | head -1)
echo "window: ${win:-none}"
if [ -n "$win" ]; then
  xdotool windowactivate --sync "$win" key ctrl+t || failed=1
else
  echo "::error::h: no Zenshape window to send Ctrl+T to"
  failed=1
fi
sleep 3
ZS_SMOKE_PASS=after-menu npm run test:smoke || failed=1
bash test/smoke/no-error-dialog.sh after-test || failed=1
import -window root "$out/$([ -n "$ZS_SMOKE_HIDDEN" ] && echo screen-end || echo screen).png" || true
# The next launch deletes the profile, which fails while any of the app's
# processes still writes to it. Its helpers run the same binary, so match
# them by its real path (the checkout's own path contains "zenshape" too).
real=$(readlink -f "$bin")
kill "$app" 2>/dev/null
pkill -f "^$real" 2>/dev/null
for _ in $(seq 30); do
  kill -0 "$app" 2>/dev/null || pgrep -f "^$real" > /dev/null || break
  sleep 1
done
if pgrep -f "^$real" > /dev/null; then
  echo "still running after 30 s, killing:"; pgrep -af "^$real"
  pkill -9 -f "^$real"
  sleep 2
fi
exit $failed
