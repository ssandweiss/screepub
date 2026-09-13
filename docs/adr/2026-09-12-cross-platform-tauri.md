# ADR: Cross-platform rewrite — Tauri shell, TypeScript core

Date: 2026-09-12 · Status: accepted (user-approved)
Supersedes: [2026-07-22-mac-app-stack.md](2026-07-22-mac-app-stack.md)

## Decision

Screepub becomes cross-platform: macOS, Linux, Windows. The SwiftUI app and
all of ScreepubKit are retired. In their place:

- **TypeScript/Bun** holds everything that thinks — the engine it already
  held, plus device detection, transfer, conversion toolchain, settings and
  export, all reached through the existing `--json` CLI contract.
- **Tauri (Rust)** is the application shell: one window, three platforms,
  bundling and signing handled by its bundler.
- **HTML/CSS** is the interface, built on `brand/components/`, which already
  carries the app's design system in web form.

Target version: **0.6.0**.

## The governing principle

**Rust is a window, not a brain.**

No business logic lives in Rust — not device detection, not transfer, not
settings, not conversion. The Tauri layer opens a window, forwards to the
sidecar, and renders what comes back. Everything else is TypeScript, where
the CLI, the app and any future integration share one implementation and
one test suite.

Without this rule the project trades Swift tech debt for Rust tech debt and
learns nothing. With it, the third language stays small enough that a single
maintainer can hold it.

## Why this supersedes the 2026-07-22 ADR

That ADR rejected Rust/Tauri on one stated ground: it "pays a cross-platform
complexity tax for a Mac-only app." The app is no longer Mac-only, so the
premise is gone and the conclusion goes with it. The tax it named is now the
thing being bought.

Its other two rejections still stand and are re-affirmed here:

- **Electron** is still not lightweight. Tauri uses the OS webview instead of
  shipping a browser.
- **Rewriting the engine** in another language still re-risks every hard-won
  parser fix. The ADR deferred a Swift port for this reason; the same reason
  forbids a Rust one. The engine stays TypeScript and ships as a sidecar.

## What is actually locked to macOS today

The distinction that matters is not "how many languages" but "how many
*platform locks*." Python runs everywhere and costs nothing; AppKit does not.

| System | Lines | Lock | Fate |
|---|---|---|---|
| Swift — ScreepubKit | ~2,600 | Hard (macOS) | → TypeScript (piece A) |
| Swift — ScreepubApp UI | 7 files | Hard (SwiftUI) | → Tauri (pieces D, F) |
| `app/make-icon.swift` | 52 | Hard — renders the SVG icon via AppKit | Deleted; `tauri icon` is cross-platform |
| `app/release.sh` | 121 | Hard — `xcrun`, `codesign`, `hdiutil` | Mostly deleted; Tauri's bundler owns packaging and signing per OS |
| `app/build-app.sh`, `build-lib.sh` | 136 | Hard — drive `swift build` | Deleted with the SwiftUI app |
| `tools/*.sh` | 219 | Soft — bash is fragile on Windows runners | → TypeScript |
| `tools/*.py` (fixtures) | 942 | None | → TypeScript, by maintainer decision (see Consequences) |
| epubcheck (Java), Calibre | external | None | Kept; both cross-platform, both optional |

Tauri therefore **deletes more than it adds**: roughly 300 lines of macOS-only
shell and AppKit leave, replaced by a bundler that already understands three
platforms.

## Why not the alternatives

- **Keep SwiftUI for Mac, add a local web UI elsewhere.** Two GUI codebases
  and three languages, forever, with every feature shipped twice. And the
  non-Mac experience would be "run a binary, then open localhost in a
  browser" — acceptable for developers, not for the screenwriters this is
  built for.
- **Keep SwiftUI and add Tauri alongside it.** The worst of both: the two
  codebases above *plus* Rust.
- **A native app per platform.** Not realistic for one maintainer.

## Decomposition

Six pieces. Each gets its own design spec and implementation plan; this ADR
records only the order and the dependencies.

| | Piece | Depends on |
|---|---|---|
| **A** | Device logic → TypeScript. `kit-check`'s assertions port first as a golden master, then the logic moves under them. Per-OS mount enumeration added. | — |
| **B** | CLI device commands (`screepub devices`, `screepub send`) — the contract Tauri consumes. | A |
| **E1** | Cross-platform **CLI** release artifacts (macOS, Linux, Windows). | B |
| **C** | Tauri shell: Rust project, engine as bundled sidecar, one window, convert a PDF. | B |
| **D** | Tauri UI: drop well, reader and rail, export panel, save flow, the eighteen settings, release notes. | C |
| **E2** | App bundles, per-OS signing, tap/winget/AUR distribution. | D |
| **F** | Retire SwiftUI. | D |

Scope of A is **core**: `Device`, `KindleDevice`, `RemarkableDevice`,
`DevicePreset`, `EbookConvert` + KFXKit, `ScriptSettings`, `FormatSettings`,
`Export`, `ResultActions`. The updater (`UpdateCheck`, `UpdateInstall`,
`ReleaseNotes`) and the OS-launch shims (`AppleBooks`, `SendToKindle`,
`Feedback`, `InstalledApp`) are deferred to piece C, where Tauri's own
plugins may answer them outright. `Engine.swift` is not ported at all — it
exists only to shell out to the TypeScript engine, and disappears once the
logic *is* TypeScript.

**E1 is the first user-visible milestone**, and it lands before any Rust is
written. The roadmap calls Windows and Linux command-line builds "the single
biggest increase in who can use Screepub"; this sequence ships that at the
halfway point rather than at the end.

## Consequences / notes

- **`kit-check` becomes `bun test`.** Its 1,532 lines of assertions run on
  every platform instead of only macOS, and most CI jobs move off paid macOS
  runners onto free Ubuntu ones.
- **The `format-defaults.json` triple-pin becomes a double-pin.**
  `FormatSettings.swift` duplicates `src/options.ts`; porting it removes one
  of the three copies the current tests hold in agreement.
- **During the transition (A through F) the Mac app shells out to the CLI**
  for device work rather than keeping its own copy. One source of truth, no
  drift — the same arrangement it already has with the engine. The
  alternative is two copies of hardware-validated logic diverging for months.
- **The device code is hardware-validated and cannot be re-tested here.**
  No Kobo, tolino or reMarkable has ever been plugged in, and the Kindle
  findings came from one real device. This is why piece A ports the tests
  before the logic: the existing assertions are the only golden master that
  exists.
- **Windows signing is a procurement problem, not an engineering one.**
  Authenticode certificates cost money and unsigned binaries draw SmartScreen
  warnings. Tauri does not make this free; it only makes it documented.
- **Nobody has a Windows machine to test on.** Drive-letter volume detection
  and Windows device behavior will ship less proven than the macOS paths.
  This is a known and accepted gap, not an oversight.
- **The Python fixture port was accepted against the recommendation in
  brainstorming.** The argument against was that Python carries no platform
  lock, so the rewrite buys no portability and risks the code that generates
  the test corpus. The maintainer chose one language on principle. The
  mitigating fact, missed in that discussion: `tests/fixture-stability.test.ts`
  already guards fixture reproduction. The acceptance bar is therefore
  **parser-output equivalence, not byte-identical PDFs** — byte equality
  across two languages' PDF writers is not a realistic target. All tests must
  pass against regenerated fixtures, and stability is rebaselined exactly
  once, in one reviewable commit.
- **Calibre and epubcheck stay.** Both are cross-platform, neither is shipped
  to users, and Calibre remains optional — the engine's own MOBI writer is
  still the dependency-free USB path. Writing our own AZW3 was considered and
  rejected for now: large work on a format only verifiable on hardware.
