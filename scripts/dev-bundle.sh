#!/usr/bin/env bash
# Runs before `npm start`. Dev runs Electron's own Electron.app, and the Dock
# takes its name and icon from that bundle, so rename it to Zenshape and give
# it our icon. It also gets its own bundle ID: other Electron projects on the
# machine share com.github.Electron, and the Dock resolved the name from one
# of those. And the Dock labels apps by their folder name ("Electron.app")
# unless the bundle declares a localized display name, so it gets one. macOS
# only honours that name while the default CFBundleDisplayName matches the
# folder name (otherwise it assumes the user renamed the app), so the default
# stays "Electron" and the English localization says "Zenshape".
# Re-signed ad hoc afterwards so macOS still trusts the edited
# bundle. Idempotent; reapplied after every npm install. macOS only.
set -euo pipefail
[ "$(uname)" = Darwin ] || exit 0
cd "$(dirname "$0")/.."
app=node_modules/electron/dist/Electron.app
plist=$app/Contents/Info.plist
[ -f "$plist" ] || exit 0
pb=/usr/libexec/PlistBuddy
id=com.zenshape.app.dev
if [ "$($pb -c 'Print :CFBundleName' "$plist")" = Zenshape ] &&
  [ "$($pb -c 'Print :CFBundleIdentifier' "$plist")" = "$id" ] &&
  [ "$($pb -c 'Print :LSHasLocalizedDisplayName' "$plist" 2>/dev/null)" = true ] &&
  [ "$($pb -c 'Print :CFBundleDisplayName' "$plist" 2>/dev/null)" = Electron ] &&
  [ -f "$app/Contents/Resources/en.lproj/InfoPlist.strings" ] &&
  cmp -s assets/icon.icns "$app/Contents/Resources/electron.icns"; then
  exit 0
fi
$pb -c 'Set :CFBundleName Zenshape' "$plist"
$pb -c "Set :CFBundleIdentifier $id" "$plist"
$pb -c 'Set :CFBundleDisplayName Electron' "$plist" 2>/dev/null ||
  $pb -c 'Add :CFBundleDisplayName string Electron' "$plist"
$pb -c 'Set :LSHasLocalizedDisplayName true' "$plist" 2>/dev/null ||
  $pb -c 'Add :LSHasLocalizedDisplayName bool true' "$plist"
mkdir -p "$app/Contents/Resources/en.lproj"
printf 'CFBundleDisplayName = "Zenshape";\nCFBundleName = "Zenshape";\n' |
  iconv -f UTF-8 -t UTF-16 >"$app/Contents/Resources/en.lproj/InfoPlist.strings"
cp assets/icon.icns "$app/Contents/Resources/electron.icns"
codesign --force --deep --sign - "$app" >/dev/null 2>&1
# Make Launch Services pick up the new name and icon.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f -R -trusted "$app" >/dev/null 2>&1 || true
echo "dev bundle: Electron.app now shows as Zenshape"
