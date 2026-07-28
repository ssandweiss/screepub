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

notarize() {   # $1 = path to submit
  xcrun notarytool submit "$1" \
    --key "$AC_API_KEY_PATH" --key-id "$AC_API_KEY_ID" --issuer "$AC_API_ISSUER_ID" --wait
}
NOTARIZE=0
if [[ -n "${AC_API_KEY_PATH:-}" && -n "${AC_API_KEY_ID:-}" && -n "${AC_API_ISSUER_ID:-}" ]]; then
  NOTARIZE=1
fi

# Staple the .app BEFORE it goes into the DMG. Stapling only the DMG leaves
# the copied-out app with no local ticket, so its first launch needs an
# online notary check — which fails for an offline user, exactly the case
# this project is built for. notarytool takes an .app only inside a
# container, so both artifacts ride in one zip and one submission; the CLI
# is notarized the same way, though a bare Mach-O cannot be stapled (there
# is nowhere to put the ticket) and always resolves its check online.
if (( NOTARIZE )); then
  echo "── notarize the app + CLI, staple the app"
  ZIP="$BUILD/Screepub-notarize.zip"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$BUNDLE" "$ZIP"
  ditto -c -k "$DIST/screepub-macOS" "$BUILD/screepub-cli.zip"
  notarize "$ZIP"
  notarize "$BUILD/screepub-cli.zip"
  xcrun stapler staple "$BUNDLE"
  xcrun stapler validate "$BUNDLE"
  rm -f "$ZIP" "$BUILD/screepub-cli.zip"
fi

echo "── dmg (stable name)"
STAGING="$(mktemp -d)"
cp -R "$BUNDLE" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
DMG="$DIST/Screepub-macOS.dmg"
rm -f "$DMG"
hdiutil create -volname "Screepub" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
rm -rf "$STAGING"

# Sign the DMG too. An unsigned-but-stapled DMG does open, but it has no
# primary signature, so `spctl -a -t open` reports "no usable signature"
# and anyone auditing the download sees a red flag that isn't real.
echo "── sign dmg"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"

if (( NOTARIZE )); then
  echo "── notarize + staple the dmg"
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
else
  echo "⚠︎ notarization skipped (AC_API_* not set) — artifacts are signed but not notarized"
fi

shasum -a 256 "$DMG" "$DIST/screepub-macOS"
echo "release artifacts in $DIST"
