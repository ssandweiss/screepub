# Layman-Friendly Distribution — design

2026-07-23 · approved in brainstorm. Decisions: notarized Developer ID
build (Apple account = Clockwork Post Production LLC, a Darkwell
subsidiary); universal binary; full CI automation on tag; direct `.dmg`
download button; Homebrew tap (cask + formula) as phase-2; GitHub Pages
+ styled DMG as phase-2.

## Purpose

Make Screepub trivially installable by a non-technical Mac user. Today
the app is ad-hoc signed and never released — a downloader would hit
Gatekeeper and give up. Goal: a notarized `.dmg` that double-clicks
clean, a README that reads like a product page with one obvious
Download button, and a one-command CI release. Homebrew (`brew install
--cask …` for the app, `brew install …` for the CLI) follows as a
phase-2 layer over the same release artifacts.

Copyright is Darkwell Entertainment LLC; the code-signing identity is
Clockwork Post Production LLC (independent of copyright — the Gatekeeper
dialog will name Clockwork Post). See the AGPL-3.0 license shipped
2026-07-23.

## v1 — the core

### 1. Build refactor + universal binary

Extract the bundle-assembly in `app/build-app.sh` so two callers share
it: **local dev** (ad-hoc `codesign -s -`, unchanged behavior) and
**release** (real Developer ID identity + version injected). Parameterize
the signing identity and the version string (currently the Info.plist
heredoc hardcodes `0.1.0`).

Build **universal (arm64 + x86_64)** so it runs on Apple Silicon and
Intel Macs:
- Bun sidecar: compile once per arch (`bun build --compile
  --target=bun-darwin-arm64` and `--target=bun-darwin-x64`), then `lipo
  -create` into one fat `screepub-engine`.
- Swift shell: `swift build -c release --arch arm64 --arch x86_64`
  produces a universal binary directly.

### 2. Signing + notarization

Sign **inner-to-outer**, both with hardened runtime and a secure
timestamp:
1. `screepub-engine` (the embedded Mach-O) — Developer ID Application,
   `--options runtime`, with an **entitlements plist** (see Risk).
2. The `.app` bundle — Developer ID Application, `--options runtime
   --timestamp`. (Drop the deprecated `--deep`; sign nested code
   explicitly.)

Notarize the packaged DMG with `xcrun notarytool submit --wait` using an
**App Store Connect API key** (issuer id + key id + `.p8`), then `xcrun
stapler staple` the DMG. Verify with `codesign --verify --strict`,
`spctl -a -t open --context context:primary-signature`, and `stapler
validate`.

### 3. DMG packaging

Functional DMG via `hdiutil`: a staging folder containing `Screepub.app`
+ a symlink to `/Applications`, converted to a compressed read-only DMG.
**Stable filename `Screepub-macOS.dmg`** (no version in the name) so the
permalink `releases/latest/download/Screepub-macOS.dmg` always resolves
to the newest build; the version lives in the release tag/title and the
app's About box. (Styled DMG background is phase-2.)

### 4. Release workflow — `.github/workflows/release.yml`

- **Trigger:** `push` on tags matching `v*`.
- **Runner:** `macos-15` (matches the existing app job).
- **Permissions:** `contents: write` scoped to this job only; the
  existing test jobs stay `contents: read`.
- **Steps:** checkout → setup-bun (existing pinned SHA) → `bun install
  --frozen-lockfile` → import Developer ID cert into a throwaway keychain
  → build universal (component 1) → sign (component 2) → package DMG
  (component 3) → notarize + staple → compute `shasum -a 256` → `gh
  release create "$TAG" Screepub-macOS.dmg --title --notes` (checksum in
  notes).
- Also publish a **standalone universal `screepub` CLI binary** as a
  second release asset (`screepub-macOS`, signed) for the Homebrew
  formula to consume.
- Use the built-in `gh` CLI (no third-party release action) to honor the
  repo's SHA-pin / least-privilege posture. Any third-party action added
  is SHA-pinned per the existing `ci.yml` convention.
- Include a commented, disabled **auto-bump hook** stub (a final step
  that will later push the updated cask/formula to the tap — see phase-2)
  so wiring it up is an enable, not a retrofit.

### 5. Version flow

Tag `vX.Y.Z` → strip the `v` → inject into `CFBundleShortVersionString`
and `CFBundleVersion` at bundle-assembly time. Single source of truth is
the git tag.

### 6. README as a landing page

Restructure only the **top** of `README.md`; the existing CLI /
Development / Architecture sections slide below untouched. New top order:
title + one-liner → badges (release version, AGPL-3.0, macOS) → a
prominent **"⬇️ Download Screepub for macOS"** link pointing directly at
`releases/latest/download/Screepub-macOS.dmg` → a **hero screenshot**
(captured from the running app) → **3-step install** (download → open the
`.dmg` → drag Screepub to Applications; then just double-click — it's
notarized) → **Requirements** (macOS 14+, Apple Silicon or Intel; Calibre
optional, only for AZW3). All new prose is clearly-marked **draft copy**
the owner will rewrite in their own voice.

### 7. Repo "About" metadata

Set via `gh repo edit`: a one-line description, topics (e.g.
`screenplay`, `epub`, `kindle`, `fountain`, `macos`, `ebook`), and
homepage (the releases page for now, Pages later).

### 8. Signing secrets (owner's manual step)

The workflow needs repo **Actions secrets** the owner must create from
the Apple account (cannot be automated here). The plan ships a short doc
(`docs/release-secrets.md`, committed — instructions only, no secret
values) with exact generation commands for: base64 Developer ID
Application `.p12` + its password, a keychain password, and the App Store
Connect API key (issuer id, key id, base64 `.p8`) + team id. Until set, the release job
fails loudly and does not affect normal CI.

## Phase-2 — fast-follows (after the first release exists)

### P1. Homebrew tap — `ssandweiss/homebrew-tap`

A new repo. Contains:
- `Casks/screepub.rb` — cask pointing at the release DMG (`version`,
  `sha256`, `url .../releases/download/v#{version}/Screepub-macOS.dmg`,
  `app "Screepub.app"`, `depends_on macos: ">= :sonoma"`). Install:
  `brew install --cask ssandweiss/tap/screepub`.
- `Formula/screepub.rb` — formula installing the standalone universal
  `screepub` CLI binary from the release asset (`bin.install`). Install:
  `brew install ssandweiss/tap/screepub`.
- **CI auto-bump:** enable the release-workflow hook (component 4) to
  commit the new `version` + `sha256` to the tap on each release, so
  `brew upgrade` always tracks latest.

### P2. GitHub Pages landing page

A friendly non-repo URL (`ssandweiss.github.io/screepub`) for sending to
non-technical users — hero, screenshots, giant Download button — reusing
the README's assets/copy.

### P3. Styled DMG

`create-dmg` (or AppleScript) background image with a "drag to
Applications" arrow + fixed icon positions.

### P4. Official Homebrew

Submit to `homebrew/cask` (and optionally `homebrew/core`) once Screepub
meets the notability bar, enabling the un-prefixed `brew install --cask
screepub`.

## Key risk — Bun JIT under hardened runtime

A Bun-compiled binary runs JavaScriptCore, which JITs. Under hardened
runtime it will likely need `com.apple.security.cs.allow-jit` (and
possibly `allow-unsigned-executable-memory` and
`disable-library-validation`) in the sidecar's entitlements, or it will
pass notarization yet **crash on launch**. Build these in from the start
and confirm on a *real downloaded, stapled* DMG on a clean machine — this
is the most likely spot to need an iteration. Verification is not "CI
green" but "the notarized DMG opens without Gatekeeper friction and the
app actually converts a PDF."

## Verification

- `codesign --verify --strict`, `spctl` assessment, `stapler validate`
  on the built DMG in CI.
- End-to-end manual gate: download the released DMG, install, launch,
  convert a real PDF — on a machine that is not the build machine.
- Existing `ci.yml` (engine tests, kit-check) stays green and unchanged.

## Out of scope (YAGNI)

Mac App Store distribution; Sparkle/in-app auto-update; Windows/Linux
packaging; signing the CLI-only path for non-brew distribution.
