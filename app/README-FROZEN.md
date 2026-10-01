# `app/` is frozen, and not yet deletable

If you found this directory while cleaning up: **not yet, and the reasons are
specific.** Each one below is checkable rather than a matter of taste.

Frozen means: maintained for bug compatibility only. Fix a defect a user
still running it hits. Do not write new Swift against `ScreepubKit`, do not
add a file, do not port a feature *into* this directory. New behaviour goes in `src/`
(the engine) and is driven from `desktop/` (the Tauri window).

## Who decided this, and where

- ADR: `docs/adr/2026-09-12-cross-platform-tauri.md`: one Rust window over
  the TypeScript engine, replacing the macOS-only SwiftUI app.
- The retirement is piece F of that ADR, specified in
  `docs/superpowers/specs/2026-09-14-retire-swiftui-design.md` in three
  stages: **F1 freeze** (this file), **F2 hand over** (the identifier
  release), **F3 delete**.
- The freeze is enforced: `tools/frozen-app-manifest.json` pins this
  directory's Swift file list and each file's code-line count, and
  `tests/frozen-app.test.ts` fails if either grows. Read that test's header
  before trying to make it pass; regenerating the manifest is deliberately
  not enough.

## What replaces it

`desktop/`: a Tauri window over the same engine in `src/`, plus the
`screepub` CLI. It ships on every tag for macOS, Windows and Linux, and on a
Mac it is signed, notarized and updates itself. Since the identifier release
it is `Screepub.app` with this app's identifier, `com.darkwell.screepub`, and
`Screepub-macOS.dmg` is its image.

## Why it is still here

**1. Its users are still crossing over.** This app is no longer published
and the Homebrew cask is retired, but copies of it are still installed. Its
own updater, where it is switched on, finds the window's
`Screepub-macOS.dmg` on the newest release and installs it in its place.
F3 waits one release after the identifier release, so a handover that goes
wrong still has this source to fix it from. `app/release.sh` also still
builds and signs the Mac command-line archives that the Homebrew formula
serves, until that build moves out of this directory.

**2. Its `kit-check` is the only test of its own Swift code.** While copies
of the app are still installed, its behaviour is worth asserting. The
sections that matter most for the retirement cover `ResultActions.swift` (the send menu),
`UpdateCheck.swift` and `UpdateInstall.swift` (its updater), and
`AppleBooks.swift`. `docs/retired-coverage.md` records, section by section,
what the window and `src/` now do in their place and what was decided as
an accepted loss.

**3. Two things here have no copy anywhere else.**

- `Packages/KFXKit/Sources/KFXKit/Vendor/KFX_Output_plugin.zip`, with its
  `PROVENANCE.md` and GPL-3 `COPYING`. This app installs the plugin from that
  zip. The engine and the window do not need it: `screepub kfx-install`
  fetches the plugin from Calibre's own plugin index. `THIRD-PARTY-NOTICES.md`
  points at the two files.
- `Sources/ScreepubApp/Theme.swift` is the declared source of truth for the
  brand colours. `tests/theme-colors.ts` parses it and
  `tests/brand-tokens.test.ts` pins `brand/tokens.json` to it. Deleting it
  means reversing that test's direction and editing `brand/README.md` and
  `brand/tokens.json`'s `$comment` too.

`format-defaults.json` is pinned by **both** `tests/options.test.ts` and
`kit-check` (see the root `CLAUDE.md`). While this directory lives, that is
a double pin and both change together.

## When it may go

On three gates, stated in full in the spec:

1. **The window is built green on `macos-15` in CI, and a person has
   installed its DMG on a real Mac and converted a script.** Met: see
   `docs/verification-ledger.md`.
2. **Every feature this app has is ported, or named in
   `docs/releases/<version>.md` as a thing that went away.** In progress:
   `docs/retired-coverage.md` tracks each one.
3. **A Mac user can get the new app where they get this one.** Met at the
   identifier release: the download button, the README and this app's own
   updater all give the window. The Homebrew cask is retired rather than
   pointed at the window (owner's decision, 2026-10-01).

F2, the identifier release, is done: the window took this app's identifier,
and this app's own updater carries its users across, as
`docs/adr/2026-09-20-swift-app-migrates-itself.md` decides. F3 (delete, with
the reference sweep in `tools/app-references.json`) comes after a release
cycle.

## Meanwhile

CI builds this directory and runs `kit-check` (`.github/workflows/ci.yml`,
the `app` job), and `weekly-toolchain.yml` runs its Calibre checks every
Monday. Both cover an app that is still installed on some Macs, and a
directory that still builds the Mac command-line archives. They go when the
directory goes.
