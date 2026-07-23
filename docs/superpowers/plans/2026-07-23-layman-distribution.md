# Layman-Friendly Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Screepub as a notarized, universal `.dmg` a non-technical Mac user can download and double-click, published automatically by CI on a version tag, fronted by a README that reads like a product page.

**Architecture:** Refactor `app/build-app.sh` into a shared library so a new `app/release.sh` can build a *universal* (arm64+x86_64) bundle, sign it with Developer ID + hardened runtime, package a stable-named DMG, and notarize/staple it. A tag-triggered GitHub Actions workflow runs that script with secrets and publishes a GitHub Release. Homebrew (tap cask + CLI formula), GitHub Pages, and a styled DMG are a **separate phase-2 plan**.

**Tech Stack:** Bash, Bun `--compile` (cross-arch), SwiftPM (`--arch`), `codesign`, `xcrun notarytool`/`stapler`, `hdiutil`, `lipo`, GitHub Actions, `gh` CLI.

**Note on testing:** This is packaging/infra work, not unit-testable TS. The engine's `bun test` suite and `kit-check` are untouched and stay green (safety net). Per-task "verification" is a concrete `lipo`/`codesign`/`hdiutil` command with expected output. Steps marked **[CI-only]** or **[needs Developer ID cert]** can only be fully verified on a machine with the signing identity (the owner's Mac) or in CI once secrets are set — the plan says so explicitly rather than faking output.

---

## File Structure

- Create `app/build-lib.sh` — sourced bash library: universal engine build, icon, universal Swift build, bundle assembly (version-parameterized). One responsibility: turn sources into an unsigned `Screepub.app`.
- Rewrite `app/build-app.sh` — dev entry point. Sources the lib, builds host-arch only (fast), ad-hoc signs. **Behavior identical to today.**
- Create `app/release.sh` — release entry point. Sources the lib, builds universal, injects version, Developer-ID-signs, packages DMG, notarizes+staples (guarded), emits the standalone CLI binary.
- Create `app/screepub-engine.entitlements` — hardened-runtime entitlements for the Bun sidecar (JIT).
- Create `.github/workflows/release.yml` — tag-triggered release job.
- Create `docs/release-secrets.md` — owner's guide to generating the Actions secrets (instructions only, no values).
- Modify `README.md` — restructure the top into a landing page.
- Modify `app/Sources/ScreepubKit/Engine.swift` — **only in the Task 1 fallback branch** (arch-suffixed sidecar lookup).

---

## Task 1: Universal engine sidecar

**Files:**
- Modify: `app/build-app.sh` (temporary throwaway check here; real change is in `build-lib.sh` at Task 2)

The whole universal strategy rests on one unknown: can two Bun-`--compile` binaries be `lipo`'d into a working fat binary? Bun appends its payload after the Mach-O, and `lipo` may or may not preserve that. **Resolve this first** so the rest of the plan is built on a known-good approach.

- [ ] **Step 1: Build both thin engine binaries**

Run from repo root:
```bash
mkdir -p build
bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile build/screepub-engine-arm64
bun build --compile --target=bun-darwin-x64  src/cli.ts --outfile build/screepub-engine-x64
```
Expected: two executables in `build/`.

- [ ] **Step 2: lipo them and inspect**

```bash
lipo -create -output build/screepub-engine build/screepub-engine-arm64 build/screepub-engine-x64
lipo -info build/screepub-engine
```
Expected: `Architectures in the fat file: build/screepub-engine are: x86_64 arm64`

- [ ] **Step 3: Verify the fat binary actually runs on both slices**

```bash
arch -arm64   build/screepub-engine --help
arch -x86_64  build/screepub-engine --help   # uses Rosetta on Apple Silicon
```
Expected: the CLI `--help` text prints **both** times (exit 0).

- [ ] **Step 4: Decide the approach**

  - **If Step 3 passes both arches → PRIMARY approach.** The lib (Task 2) produces one universal `screepub-engine`; **no Swift change needed** (`Engine.binaryURL()` already looks for exactly that name). Delete the scratch binaries: `rm build/screepub-engine-*`. Proceed to Task 2.
  - **If the x86_64 (or arm64) slice crashes/garbles → FALLBACK approach.** Do not lipo. Ship **both** thin binaries in `Resources/` and select at runtime. Apply this exact edit to `app/Sources/ScreepubKit/Engine.swift`, replacing the bundled-lookup block (lines ~40-43):

```swift
        // Universal sidecar: prefer an arch-suffixed binary, then a fat/legacy one.
        #if arch(arm64)
        let archName = "screepub-engine-arm64"
        #else
        let archName = "screepub-engine-x64"
        #endif
        if let res = Bundle.main.resourceURL {
            for name in [archName, "screepub-engine"] {
                let candidate = res.appendingPathComponent(name)
                if FileManager.default.isExecutableFile(atPath: candidate.path) {
                    return candidate
                }
            }
        }
```
  Then Task 2's `sp_assemble_bundle` copies **both** `screepub-engine-arm64` and `screepub-engine-x64` into `Resources/` instead of one fat `screepub-engine`, and Task 4 signs **each** with the entitlements. The rest of the plan is unchanged. Add a kit-check note that the dev path still resolves the host binary.

- [ ] **Step 5: Commit the finding**

Record which approach won in the commit body so later tasks are unambiguous.
```bash
git add -A
git commit -m "build: determine universal-sidecar strategy (lipo vs dual-binary)" \
  -m "Step 3 result: <PASS both arches = lipo primary | FAIL = dual-binary fallback>."
```

---

## Task 2: Shared build library + universal builders

**Files:**
- Create: `app/build-lib.sh`
- Rewrite: `app/build-app.sh`

- [ ] **Step 1: Write `app/build-lib.sh`**

This is the primary (lipo) version. If Task 1 chose the fallback, change `sp_build_engine` to skip `lipo` and have `sp_assemble_bundle` copy both thin binaries (noted inline).

```bash
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
  echo "── shell (swift build -c release)" >&2
  local archflags=()
  [[ "${UNIVERSAL:-}" == "1" ]] && archflags=(--arch arm64 --arch x86_64)
  (cd "$APP_DIR" && swift build -c release "${archflags[@]}" 2>&1 | tail -2 >&2)
  echo "$(cd "$APP_DIR" && swift build -c release "${archflags[@]}" --show-bin-path)/ScreepubApp"
}

sp_assemble_bundle() {             # $1 = version string
  local version="$1" swift_bin; swift_bin="$(sp_build_swift)"
  echo "── bundle ($version)"
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
  cp "$swift_bin" "$BUNDLE/Contents/MacOS/Screepub"
  cp "$BUILD/screepub-engine" "$BUNDLE/Contents/Resources/screepub-engine"
  cp "$BUILD/Screepub.icns" "$BUNDLE/Contents/Resources/Screepub.icns"
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
```
(**Fallback variant:** in `sp_build_engine` drop the `lipo` line; in `sp_assemble_bundle` replace the single `cp …/screepub-engine` with two `cp` lines for `screepub-engine-arm64` and `screepub-engine-x64`.)

- [ ] **Step 2: Rewrite `app/build-app.sh` to use the lib (dev behavior unchanged)**

```bash
#!/usr/bin/env bash
# Dev build: host-arch Screepub.app, ad-hoc signed. No Xcode required.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/build-lib.sh"
sp_paths
sp_build_engine
sp_build_icon
sp_assemble_bundle "0.1.0-dev"
codesign --force --deep -s - "$BUNDLE"
echo "built: $BUNDLE"
```

- [ ] **Step 3: Verify dev build still works**

Run: `app/build-app.sh`
Expected: ends with `built: …/app/dist/Screepub.app`, no errors.

- [ ] **Step 4: Verify the app launches**

Run: `open app/dist/Screepub.app` (then quit it)
Expected: the Screepub window appears; a drop-convert still works.

- [ ] **Step 5: Verify universal builders produce fat binaries [needs a moment]**

```bash
UNIVERSAL=1 bash -c 'source app/build-lib.sh; sp_paths; sp_build_engine; sp_build_icon; sp_assemble_bundle 9.9.9'
lipo -info app/dist/Screepub.app/Contents/MacOS/Screepub
lipo -info app/dist/Screepub.app/Contents/Resources/screepub-engine   # skip in fallback (two thin files)
```
Expected: both report `x86_64 arm64`.

- [ ] **Step 6: Commit**

```bash
git add app/build-lib.sh app/build-app.sh
git commit -m "build: extract shared build-lib, add universal (arm64+x86_64) path"
```

---

## Task 3: Sidecar hardened-runtime entitlements

**Files:**
- Create: `app/screepub-engine.entitlements`

- [ ] **Step 1: Write the entitlements plist**

Bun runs JavaScriptCore, which JITs. Under hardened runtime the sidecar needs these or it notarizes yet crashes on launch.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>                        <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key> <true/>
  <key>com.apple.security.cs.disable-library-validation</key>       <true/>
</dict>
</plist>
```

- [ ] **Step 2: Commit**

```bash
git add app/screepub-engine.entitlements
git commit -m "build: hardened-runtime entitlements for the Bun sidecar (JIT)"
```

---

## Task 4: Release build + sign + DMG script

**Files:**
- Create: `app/release.sh`

**Env contract** (set by the workflow or the owner locally):
`VERSION` (e.g. `0.2.0`), `SIGN_IDENTITY` (e.g. `Developer ID Application: Clockwork Post Production LLC (TEAMID)`). Optional notarization: `AC_API_KEY_PATH`, `AC_API_KEY_ID`, `AC_API_ISSUER_ID` — if all set, notarize+staple; else skip with a warning (lets the owner test signing/DMG locally before wiring secrets).

- [ ] **Step 1: Write `app/release.sh`**

```bash
#!/usr/bin/env bash
# Release build: universal, Developer-ID-signed, notarized, stapled DMG.
# Also emits a standalone signed universal `screepub` CLI binary.
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
```

- [ ] **Step 2: [needs Developer ID cert] Dry-run signing + DMG locally (no notarization)**

On the owner's Mac, with the cert in the login keychain:
```bash
SIGN_IDENTITY="$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | sed -E 's/.*"(.*)"/\1/')"
VERSION=0.0.1-test SIGN_IDENTITY="$SIGN_IDENTITY" app/release.sh
```
Expected: `codesign --verify --strict` passes; the notarization block prints the skip warning; a `Screepub-macOS.dmg` + `screepub-macOS` + two SHA-256 lines appear.

- [ ] **Step 3: [needs Developer ID cert] Verify the DMG mounts and installs**

```bash
hdiutil attach app/dist/Screepub-macOS.dmg
ls "/Volumes/Screepub"        # expect Screepub.app + Applications symlink
hdiutil detach "/Volumes/Screepub"
```

- [ ] **Step 4: Commit**

```bash
git add app/release.sh
git commit -m "release: universal Developer-ID sign + notarize + stable-name DMG script"
```

---

## Task 5: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Mirrors `ci.yml` conventions: least privilege (scoped `contents: write`), first-party actions, the existing pinned `setup-bun` SHA. Uses the built-in `gh` CLI (no third-party release action).

```yaml
# Release on version tags. Requires repo secrets (see docs/release-secrets.md):
#   DEVELOPER_ID_CERT_P12_BASE64, CERT_PASSWORD, KEYCHAIN_PASSWORD,
#   AC_API_KEY_P8_BASE64, AC_API_KEY_ID, AC_API_ISSUER_ID
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  release:
    runs-on: macos-15
    permissions:
      contents: write        # create the GitHub Release + upload assets
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
      - run: bun install --frozen-lockfile

      - name: Import Developer ID certificate
        env:
          CERT_B64: ${{ secrets.DEVELOPER_ID_CERT_P12_BASE64 }}
          CERT_PASSWORD: ${{ secrets.CERT_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          KC="$RUNNER_TEMP/build.keychain-db"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
          security set-keychain-settings -lut 21600 "$KC"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
          echo "$CERT_B64" | base64 --decode > "$RUNNER_TEMP/cert.p12"
          security import "$RUNNER_TEMP/cert.p12" -k "$KC" -P "$CERT_PASSWORD" \
            -T /usr/bin/codesign
          security list-keychains -d user -s "$KC" login.keychain-db
          security set-key-partition-list -S apple-tool:,apple: \
            -k "$KEYCHAIN_PASSWORD" "$KC"
          echo "SIGN_IDENTITY=$(security find-identity -v -p codesigning "$KC" \
            | grep 'Developer ID Application' | head -1 | sed -E 's/.*"(.*)"/\1/')" >> "$GITHUB_ENV"

      - name: Write App Store Connect API key
        env:
          AC_KEY_B64: ${{ secrets.AC_API_KEY_P8_BASE64 }}
        run: |
          echo "$AC_KEY_B64" | base64 --decode > "$RUNNER_TEMP/ac_api_key.p8"
          echo "AC_API_KEY_PATH=$RUNNER_TEMP/ac_api_key.p8" >> "$GITHUB_ENV"

      - name: Build, sign, notarize, package
        env:
          VERSION: ${{ github.ref_name }}   # 'v0.2.0'; stripped below
          AC_API_KEY_ID: ${{ secrets.AC_API_KEY_ID }}
          AC_API_ISSUER_ID: ${{ secrets.AC_API_ISSUER_ID }}
        run: |
          export VERSION="${VERSION#v}"
          app/release.sh

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.ref_name }}
        run: |
          VERSION="${TAG#v}"
          SHA="$(shasum -a 256 app/dist/Screepub-macOS.dmg | awk '{print $1}')"
          gh release create "$TAG" \
            app/dist/Screepub-macOS.dmg app/dist/screepub-macOS \
            --title "Screepub $VERSION" \
            --notes "Notarized universal build for macOS 14+.

          **Install:** download \`Screepub-macOS.dmg\`, open it, drag Screepub to Applications.

          DMG SHA-256: \`$SHA\`"
```

- [ ] **Step 2: Lint the workflow (if actionlint present)**

Run: `actionlint .github/workflows/release.yml` (skip if not installed)
Expected: no errors. (If unavailable, visually confirm YAML indentation.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered notarized release workflow"
```

- [ ] **Step 4: [CI-only] Real verification is a tag push**

This can only be verified once Task 7's secrets exist. When they do:
```bash
git tag v0.2.0 && git push origin v0.2.0
```
Watch the `release` job. Expected: green job, a `v0.2.0` GitHub Release with `Screepub-macOS.dmg` + `screepub-macOS` attached. **Then** do the end-to-end gate (Task 8, Step 5).

---

## Task 6: README landing page

**Files:**
- Modify: `README.md` (top section only)
- Create: `assets/hero.png` (screenshot — owner-replaceable)

- [ ] **Step 1: Capture a hero screenshot**

```bash
app/build-app.sh && open app/dist/Screepub.app
# with the window focused:
screencapture -w assets/hero.png
```
Expected: `assets/hero.png` exists. (Owner will likely swap this for a nicer shot; a real capture is the placeholder.)

- [ ] **Step 2: Replace the top of `README.md`**

Replace the current lines 1-7 (title through the "durable, editable artifact." paragraph) with the block below. Everything from `## Why` down stays. All prose here is **draft copy** — clearly first-pass wording the owner will rewrite.

````markdown
# Screepub

[![Release](https://img.shields.io/github/v/release/ssandweiss/screepub)](https://github.com/ssandweiss/screepub/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple)

**Turn a screenplay PDF into something that actually reads well on a Kindle.**

<p align="center">
  <a href="https://github.com/ssandweiss/screepub/releases/latest/download/Screepub-macOS.dmg">
    <strong>⬇️ Download Screepub for macOS</strong>
  </a>
</p>

![Screepub converting a screenplay](assets/hero.png)

## Install

1. **Download** the `.dmg` (button above).
2. **Open it** and drag **Screepub** into your Applications folder.
3. **Double-click** Screepub. It's notarized by Apple, so it just opens —
   no security warnings to click through.

Drop a screenplay PDF on the window and it converts, then sends straight
to a connected e-reader.

**Requirements:** macOS 14 (Sonoma) or later, Apple Silicon or Intel.
[Calibre](https://calibre-ebook.com) is optional — only needed for the
AZW3 Kindle-sideload format.

---

*Screepub is a three-stage pipeline — PDF → Fountain → EPUB3/MOBI — with
a small Mac app on top. The `.fountain` intermediate is kept as a
durable, editable artifact.*
````

- [ ] **Step 3: Verify it renders**

Run: `git diff --stat README.md` and eyeball the file top.
Expected: badges, a centered download link, the hero image, a 3-step install list. (Badges/image render on GitHub after push.)

- [ ] **Step 4: Commit**

```bash
git add README.md assets/hero.png
git commit -m "docs: README landing page — download button, install steps, hero"
```

---

## Task 7: Release-secrets guide (owner's manual step)

**Files:**
- Create: `docs/release-secrets.md`

- [ ] **Step 1: Write the guide**

```markdown
# Release secrets

The `release` workflow needs these repo **Actions secrets**
(Settings → Secrets and variables → Actions). Instructions only — never
commit the values.

## 1. Developer ID Application certificate
Export from Keychain Access (login keychain → your "Developer ID
Application: Clockwork Post Production LLC" cert → right-click → Export →
`.p12`, set a password). Then:
```bash
base64 -i Certificates.p12 | pbcopy    # → secret DEVELOPER_ID_CERT_P12_BASE64
```
- `DEVELOPER_ID_CERT_P12_BASE64` — the base64 above
- `CERT_PASSWORD` — the `.p12` export password
- `KEYCHAIN_PASSWORD` — any strong random string (CI's throwaway keychain)

## 2. App Store Connect API key (for notarization)
App Store Connect → Users and Access → Integrations → App Store Connect
API → generate a key with the **Developer** role. Download the `.p8`
(once only). Then:
```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy   # → secret AC_API_KEY_P8_BASE64
```
- `AC_API_KEY_P8_BASE64` — the base64 above
- `AC_API_KEY_ID` — the key's ID (the `XXXXXXXXXX`)
- `AC_API_ISSUER_ID` — the Issuer ID shown on that page

## Sanity check
Push a tag (`git tag v0.0.2-rc && git push origin v0.0.2-rc`) and watch
the `release` job. Delete the test release/tag afterward if you like.
```

- [ ] **Step 2: Commit**

```bash
git add docs/release-secrets.md
git commit -m "docs: release-secrets setup guide"
```

- [ ] **Step 3: [owner action] Add the six secrets**

Follow the guide in the repo's Actions secrets. Not a code step — but Task 5 Step 4 and Task 8 Step 5 depend on it.

---

## Task 8: Repo metadata + end-to-end gate

**Files:** none (uses `gh`)

- [ ] **Step 1: Set the repo "About"**

`gh` is already authed as `ssandweiss`.
```bash
gh repo edit ssandweiss/screepub \
  --description "Screenplay PDF → reflowable EPUB/MOBI for e-readers, with a Mac app." \
  --homepage "https://github.com/ssandweiss/screepub/releases/latest" \
  --add-topic screenplay --add-topic epub --add-topic kindle \
  --add-topic fountain --add-topic macos --add-topic ebook
```
Expected: `gh repo view` shows the description, homepage, and topics.

- [ ] **Step 2: [CI-only, after Task 7 secrets] The real acceptance test**

Push a version tag (Task 5 Step 4). Then, **on a Mac that is not the build machine** (or a fresh user account), download the DMG from the Release page, open it, drag to Applications, double-click, and convert a real PDF.
Expected: **no Gatekeeper wall**, the app launches, and conversion works — i.e. the Bun-JIT entitlements are correct. If it launches-then-crashes, revisit Task 3 (entitlements) and re-release. This gate — not green CI — is "done."

---

## Phase-2 (separate plan, after the first release ships)

Do **not** build these here; they depend on a published release existing. A follow-up plan (`docs/superpowers/plans/…-homebrew-and-landing.md`) will cover:
- **Homebrew tap** `ssandweiss/homebrew-tap`: `Casks/screepub.rb` (app → the DMG) + `Formula/screepub.rb` (CLI → the `screepub-macOS` asset), plus a release-workflow step that commits the bumped `version`+`sha256` to the tap.
- **GitHub Pages** landing page (reuses `assets/hero.png` + README copy).
- **Styled DMG** (`create-dmg` background + icon positions).
- **Official Homebrew** submission once notable.

---

## Self-Review

- **Spec coverage:** §1 build refactor/universal → T1,T2. §2 signing/notarization → T3,T4. §3 DMG → T4. §4 release workflow → T5. §5 version-from-tag → T2 (param) + T5 (`${VERSION#v}`). §6 README → T6. §7 repo About → T8. §8 secrets doc → T7. Key risk (JIT) → T3 + T8 gate. Phase-2 → deferred section. All covered.
- **Placeholders:** none — the one genuine unknown (lipo vs dual-binary) is a real spike (T1) with a concrete test and both branches spelled out, not a TODO.
- **Type/name consistency:** `screepub-engine` (fat) / `screepub-engine-arm64`+`-x64` (fallback) used consistently; DMG always `Screepub-macOS.dmg`; CLI asset always `screepub-macOS`; env names (`VERSION`, `SIGN_IDENTITY`, `AC_API_*`) match between `release.sh` (T4) and `release.yml` (T5); secret names match between T5 and T7.
