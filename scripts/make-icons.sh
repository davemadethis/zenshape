#!/usr/bin/env bash
# Rebuilds assets/icon.png, icon.icns and icon.ico from assets/icon.svg (macOS: sips + iconutil).
set -euo pipefail
cd "$(dirname "$0")/../assets"
tmp=$(mktemp -d)
npx electron ../scripts/render-icon.cjs "$PWD/icon.png" >/dev/null 2>&1
set=$tmp/icon.iconset
mkdir -p "$set"
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "$set/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) icon.png --out "$set/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o icon.icns
ico=()
for s in 16 24 32 48 64 128 256; do
  sips -z $s $s icon.png --out "$tmp/ico_$s.png" >/dev/null
  ico+=("$tmp/ico_$s.png")
done
node ../scripts/png-to-ico.cjs icon.ico "${ico[@]}"
rm -rf "$tmp"
echo "wrote assets/icon.png assets/icon.icns assets/icon.ico"
