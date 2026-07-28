#!/usr/bin/env bash
# Shared build steps for Screepub.app. Source this; call the sp_* functions.
# Env knobs: UNIVERSAL=1 builds arm64+x86_64 (release); unset = host arch (dev).
set -euo pipefail

sp_paths() {                       # sets APP_DIR REPO_DIR BUILD DIST BUNDLE
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_DIR="$(dirname "$APP_DIR")"
  BUILD="$APP_DIR/build"
  DIST="$APP_DIR/dist"
  BUNDLE="$DIST/Screepub.app"
  mkdir -p "$BUILD"
}

sp_build_engine() {                # -> $BUILD/screepub-engine (universal or host)
  echo "── engine (bun build --compile)"
  if [[ "${UNIVERSAL:-}" == "1" ]]; then
    (cd "$REPO_DIR" && bun build --compile --target=bun-darwin-arm64 src/cli.ts \
        --outfile "$BUILD/screepub-engine-arm64" >/dev/null)
    (cd "$REPO_DIR" && bun build --compile --target=bun-darwin-x64 src/cli.ts \
        --outfile "$BUILD/screepub-engine-x64" >/dev/null)
    lipo -create -output "$BUILD/screepub-engine" \
        "$BUILD/screepub-engine-arm64" "$BUILD/screepub-engine-x64"
  else
    (cd "$REPO_DIR" && bun build --compile src/cli.ts \
        --outfile "$BUILD/screepub-engine" >/dev/null)
  fi
}

sp_build_icon() {
  echo "── icon (svg → icns)"
  swift "$APP_DIR/make-icon.swift" "$REPO_DIR/assets/icon.svg" "$BUILD/Screepub.icns"
}

sp_build_swift() {                 # -> echoes the ScreepubApp binary path
  if [[ "${UNIVERSAL:-}" == "1" ]]; then
    # Universal without full Xcode: multi-arch `swift build --arch` needs
    # xcbuild (Xcode); this project is Command Line Tools only. So build each
    # slice natively — x86_64 under Rosetta — then lipo. Each arch lands in a
    # distinct .build/<triple>/release dir, so the two ScreepubApp binaries
    # don't collide.
    echo "── shell (swift build -c release, arm64)" >&2
    (cd "$APP_DIR" && swift build -c release 2>&1 | tail -2 >&2)
    local arm_bin; arm_bin="$(cd "$APP_DIR" && swift build -c release --show-bin-path)/ScreepubApp"
    echo "── shell (swift build -c release, x86_64 via Rosetta)" >&2
    (cd "$APP_DIR" && arch -x86_64 swift build -c release 2>&1 | tail -2 >&2)
    local x64_bin; x64_bin="$(cd "$APP_DIR" && arch -x86_64 swift build -c release --show-bin-path)/ScreepubApp"
    local uni="$BUILD/ScreepubApp-universal"
    lipo -create -output "$uni" "$arm_bin" "$x64_bin"
    echo "$uni"
  else
    echo "── shell (swift build -c release)" >&2
    (cd "$APP_DIR" && swift build -c release 2>&1 | tail -2 >&2)
    echo "$(cd "$APP_DIR" && swift build -c release --show-bin-path)/ScreepubApp"
  fi
}

sp_assemble_bundle() {             # $1 = version string
  local version="$1" swift_bin; swift_bin="$(sp_build_swift)"
  echo "── bundle ($version)"
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
  cp "$swift_bin" "$BUNDLE/Contents/MacOS/Screepub"
  cp "$BUILD/screepub-engine" "$BUNDLE/Contents/Resources/screepub-engine"
  cp "$BUILD/Screepub.icns" "$BUNDLE/Contents/Resources/Screepub.icns"
  # The AGPL requires the license to travel with the binary, and the
  # compiled sidecar embeds Apache-2.0 and MIT libraries whose terms
  # require attribution on redistribution. Both ship inside the bundle.
  cp "$REPO_DIR/LICENSE" "$BUNDLE/Contents/Resources/LICENSE"
  cp "$REPO_DIR/THIRD-PARTY-NOTICES.md" \
     "$BUNDLE/Contents/Resources/THIRD-PARTY-NOTICES.md"
  cat > "$BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>Screepub</string>
  <key>CFBundleDisplayName</key>     <string>Screepub</string>
  <key>CFBundleIdentifier</key>      <string>com.darkwell.screepub</string>
  <key>CFBundleVersion</key>         <string>$version</string>
  <key>CFBundleShortVersionString</key> <string>$version</string>
  <key>CFBundleExecutable</key>      <string>Screepub</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>LSMinimumSystemVersion</key>  <string>14.0</string>
  <key>NSPrincipalClass</key>        <string>NSApplication</string>
  <key>NSHighResolutionCapable</key> <true/>
  <key>CFBundleIconFile</key>        <string>Screepub</string>
  <key>NSHumanReadableCopyright</key>
  <string>© 2026 Darkwell Entertainment LLC. AGPL-3.0-or-later.</string>
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
}
