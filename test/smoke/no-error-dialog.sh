#!/usr/bin/env bash
# Fails if a top-level window is Electron's main-process error box. A
# synchronous throw in the main process shows only that box, and writes
# nothing to the app's output, so check e can't see it.
# Usage: no-error-dialog.sh <label>; appends the window list to
# $ZS_SMOKE_OUT/windows.txt.
set -u
tree=$(xwininfo -root -tree)
{ echo "== $1"; echo "$tree"; } >> "$ZS_SMOKE_OUT/windows.txt"
# Under Xvfb the box is a GTK dialog captioned just "Error", owned by the app
# (WM_CLASS "zenshape"); without GTK it would carry the message as its title.
if echo "$tree" | grep -E '"Error": \("zenshape"|JavaScript error'; then
  echo "::error::$1: main-process error box is open"
  exit 1
fi
echo "$1: no error box"
