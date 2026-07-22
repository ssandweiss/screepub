#!/usr/bin/env bash
# Build Screepub.app: compile the Bun engine sidecar, build the SwiftUI
# shell, assemble the bundle, ad-hoc sign. No Xcode required.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$APP_DIR")"
BUILD="$APP_DIR/build"
DIST="$APP_DIR/dist"
BUNDLE="$DIST/Screepub.app"

echo "── engine (bun build --compile)"
mkdir -p "$BUILD"
(cd "$REPO_DIR" && bun build --compile src/cli.ts --outfile "$BUILD/screepub-engine" >/dev/null)

echo "── shell (swift build -c release)"
(cd "$APP_DIR" && swift build -c release 2>&1 | tail -2)
SWIFT_BIN="$(cd "$APP_DIR" && swift build -c release --show-bin-path)/ScreepubApp"

echo "── bundle"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$SWIFT_BIN" "$BUNDLE/Contents/MacOS/Screepub"
cp "$BUILD/screepub-engine" "$BUNDLE/Contents/Resources/screepub-engine"

cat > "$BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>Screepub</string>
  <key>CFBundleDisplayName</key>     <string>Screepub</string>
  <key>CFBundleIdentifier</key>      <string>com.darkwell.screepub</string>
  <key>CFBundleVersion</key>         <string>0.1.0</string>
  <key>CFBundleShortVersionString</key> <string>0.1.0</string>
  <key>CFBundleExecutable</key>      <string>Screepub</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>LSMinimumSystemVersion</key>  <string>14.0</string>
  <key>NSPrincipalClass</key>        <string>NSApplication</string>
  <key>NSHighResolutionCapable</key> <true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>    <string>PDF Screenplay</string>
      <key>LSItemContentTypes</key>  <array><string>com.adobe.pdf</string></array>
      <key>CFBundleTypeRole</key>    <string>Viewer</string>
    </dict>
  </array>
</dict>
</plist>
PLIST

codesign --force --deep -s - "$BUNDLE"
echo "built: $BUNDLE"
