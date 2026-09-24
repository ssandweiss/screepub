# `app/` is frozen — and no, you may not delete it yet

If you found this directory while cleaning up and want the short answer:
**not yet, and the reasons are specific.** They are all below, and each one
is checkable rather than a matter of taste.

Frozen means: maintained for bug compatibility only. Fix a defect in what is
already here if a shipping user hits one. Do not write new Swift against
`ScreepubKit`, do not add a file, do not port a feature *into* this
directory. New behaviour goes in `src/` (the engine) and is driven from
`desktop/` (the Tauri app).

## Who decided this, and where

- ADR: `docs/adr/2026-09-12-cross-platform-tauri.md` — one Rust window over
  the existing TypeScript engine, replacing the macOS-only SwiftUI app.
- The retirement is piece F of that ADR, specified in
  `docs/superpowers/specs/2026-09-14-retire-swiftui-design.md`, which splits
  it into three stages: **F1 freeze** (this file), **F2 hand over**, **F3
  delete**. F1 is the only stage that could execute when it was written.
- The freeze is enforced, not just asserted: `tools/frozen-app-manifest.json`
  pins this directory's Swift file list and each file's code-line count, and
  `tests/frozen-app.test.ts` fails if either grows. Read that test's header
  comment before trying to make it pass; regenerating the manifest is
  deliberately not enough.

## What replaces it

`desktop/` — a Tauri shell (Rust window, TypeScript UI) over the same engine
in `src/`, plus the `screepub` CLI. Device logic, Calibre/KFX export, format
options, the settings sidecar and the `--json` contract already live in
`src/` and are tested by `bun test`.

## Why it is still here

**1. The replacement has never been built or run on a Mac.** Not by CI, not
by a person. `.github/workflows/desktop.yml` had never executed at the time
of the freeze. `app/` is what `README.md` links, what `site/index.html`'s
download buttons serve, what `brew install --cask ssandweiss/tap/screepub`
installs, and what `app/release.sh` signs and notarizes on every tag.
Deleting it before its replacement has run once on the platform leaves Mac
users with a dead cask and a dead download button.

**2. It is the only implementation of six user-facing features.** The Tauri
app has no updater, no Apple Books route, no Send-to-Kindle route, no
email-to-Kindle route, no "save a copy", and no Cancel. Deleting `app/` today
is not the removal of duplicated code; it is the removal of features.

**3. It is the only test coverage for a large body of behaviour.** The ADR
said "`kit-check` becomes `bun test`". Measured on 2026-09-14, that is true
of about a third of it. **171 of the 264 `check()` sites in
`Sources/KitCheck/main.swift` — 65% — assert behaviour that exists nowhere
else in this repository:**

| still only covered here | file(s) | checks |
| --- | --- | --- |
| the send menu: six destination kinds, route ordering, remembered choice, per-route send verb, catalog of unavailable routes | `ScreepubKit/ResultActions.swift` | 45 |
| self-update installer: codesign requirement pinning, in-place bundle swap | `ScreepubKit/UpdateInstall.swift` | 26 |
| updater version comparison | `ScreepubKit/UpdateCheck.swift` | 17 |
| update selection | `ScreepubKit/UpdateCheck.swift` | 17 |
| update decoding | `ScreepubKit/UpdateCheck.swift` | 14 |
| update error descriptions | `ScreepubKit/UpdateCheck.swift` | 11 |
| engine cancellation (the Tauri shell has no Cancel) | `ScreepubKit/Engine.swift` | part of 10 |
| default mail client, Apple Books launch | `ScreepubKit/AppleBooks.swift`, `SendToKindle.swift`, `InstalledApp.swift` | 5 |
| the feedback issue URL | `ScreepubKit/Feedback.swift` | 5 |

The genuinely ported sections — Kindle volume detection and transfer,
multi-vendor classification, `ebook-convert` discovery and AZW3/KEPUB
conversion, the reMarkable endpoint, the settings sidecar, device presets and
export freshness, the `--json` contract and format defaults, KFX toolchain
discovery — are covered by `tests/device-*.test.ts`,
`tests/export-*.test.ts`, `tests/cli*.test.ts`, `tests/presets.test.ts` and
`tests/options.test.ts`. Those you would not lose.

**4. Two things here have no copy anywhere else in the repository.**

- `Packages/KFXKit/Sources/KFXKit/Vendor/KFX_Output_plugin.zip` (485 KB, with
  its `PROVENANCE.md` and GPL-3 `COPYING`). `KFXToolchain.installPlugin()`
  installs it into the user's Calibre. `src/export/kfx.ts` ports *discovery*
  only. Delete this and Screepub can detect the plugin but no longer install
  it — and `THIRD-PARTY-NOTICES.md` points at two files that stop existing.
- `Sources/ScreepubApp/Theme.swift` is the declared source of truth for the
  brand colors. `tests/theme-colors.ts` parses it and
  `tests/brand-tokens.test.ts` pins `brand/tokens.json` to it. Deleting it
  means reversing that test's direction and editing `brand/README.md` and
  `brand/tokens.json`'s `$comment` too.

Also note `format-defaults.json` is pinned by **both** `tests/options.test.ts`
and `kit-check` (see the root `CLAUDE.md` invariant). While this directory
lives, that stays a double pin and both must change together.

## When you may delete it

Not on judgement — on three gates, stated in full in the spec:

1. The Tauri app has been built green on `macos-15` in CI **and** a person
   has mounted the DMG on a real Mac, launched it, and converted a script.
2. Every feature in section 2 above is either ported or written down by name
   in `docs/releases/<version>.md` as a thing that went away.
3. A Mac user has somewhere to get the new app: the Homebrew cask points at
   an artifact that exists and someone has installed through `brew`.

Then F2 (hand over — including the library migration for flat-layout
libraries, and verifying that the old app's updater *refuses* the new DMG,
whose bundle identifier differs) and only after a release cycle, F3 (delete,
with the reference sweep the spec tabulates).

## Meanwhile

CI still builds this directory and runs `kit-check`
(`.github/workflows/ci.yml`, the `app` job). That job is **coverage**, not
legacy weight, for the reasons in section 3. Do not remove it as part of a
cleanup; it goes when the directory goes.
