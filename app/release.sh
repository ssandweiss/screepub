#!/usr/bin/env bash
# Release build: universal, Developer-ID-signed, notarized, stapled DMG.
# Also emits a standalone signed universal `screepub` CLI binary.
#
# Env: VERSION (e.g. 0.2.0), SIGN_IDENTITY (Developer ID Application: … (TEAMID)).
# Optional notarization (all three or none): AC_API_KEY_PATH AC_API_KEY_ID
# AC_API_ISSUER_ID — if set, notarize+staple; else skip (signing/DMG still run).
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/build-lib.sh"
sp_paths

: "${VERSION:?set VERSION (e.g. 0.2.0)}"
: "${SIGN_IDENTITY:?set SIGN_IDENTITY (Developer ID Application: … (TEAMID))}"

export UNIVERSAL=1
sp_build_engine
sp_build_icon
sp_assemble_bundle "$VERSION"

echo "── sign (inner → outer, hardened runtime)"
codesign --force --options runtime --timestamp \
  --entitlements "$APP_DIR/screepub-engine.entitlements" \
  --sign "$SIGN_IDENTITY" \
  "$BUNDLE/Contents/Resources/screepub-engine"
codesign --force --options runtime --timestamp \
  --sign "$SIGN_IDENTITY" "$BUNDLE"
codesign --verify --strict --verbose=2 "$BUNDLE"

echo "── standalone CLI binary"
cp "$BUILD/screepub-engine" "$DIST/screepub-macOS"
codesign --force --options runtime --timestamp \
  --entitlements "$APP_DIR/screepub-engine.entitlements" \
  --sign "$SIGN_IDENTITY" "$DIST/screepub-macOS"

echo "── dmg (stable name)"
STAGING="$(mktemp -d)"
cp -R "$BUNDLE" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
DMG="$DIST/Screepub-macOS.dmg"
rm -f "$DMG"
hdiutil create -volname "Screepub" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
rm -rf "$STAGING"

if [[ -n "${AC_API_KEY_PATH:-}" && -n "${AC_API_KEY_ID:-}" && -n "${AC_API_ISSUER_ID:-}" ]]; then
  echo "── notarize + staple"
  xcrun notarytool submit "$DMG" \
    --key "$AC_API_KEY_PATH" --key-id "$AC_API_KEY_ID" --issuer "$AC_API_ISSUER_ID" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
else
  echo "⚠︎ notarization skipped (AC_API_* not set) — DMG is signed but not notarized"
fi

shasum -a 256 "$DMG" "$DIST/screepub-macOS"
echo "release artifacts in $DIST"
