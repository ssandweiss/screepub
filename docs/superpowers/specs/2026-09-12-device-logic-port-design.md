# Design: device logic → TypeScript (cross-platform piece A)

Date: 2026-09-12 · Status: approved (user-approved)
Program: [ADR 2026-09-12 — cross-platform rewrite](../../adr/2026-09-12-cross-platform-tauri.md)
Target version: 0.6.0

## Goal

Move ScreepubKit's core logic out of Swift and into the TypeScript engine, so
that every platform shares one implementation and one test suite. This is the
load-bearing piece: B (CLI device commands), C/D (Tauri), E1 (cross-platform
CLI release) and F (retire SwiftUI) all depend on it.

It also ends the Linux development blockage as a side effect. `kit-check`'s
1,532 lines of assertions are the only regression net the device code has;
today they run on macOS alone.

## Scope

**In:** `Device`, `KindleDevice`, `RemarkableDevice`, `DevicePreset`,
`EbookConvert` + `KFXToolchain`, `ScriptSettings`, `FormatSettings`, `Export`.

**Out:** `UpdateCheck`, `UpdateInstall`, `ReleaseNotes` (Tauri ships its own
updater — deferred to piece C, where they may not need porting at all);
`AppleBooks`, `SendToKindle`, `Feedback`, `InstalledApp` (OS-launch shims,
also piece C). `Engine.swift` is **not ported**: it exists only to shell out to
the TypeScript engine, and has nothing left to do once the logic is
TypeScript.

`ResultActions` was in the approved port scope and has been **moved to piece
D** during spec review. It is the route *presentation* model — user-facing
titles, button verbs, preselection, and a `storageKey` deliberately keyed on
device kind rather than name or volume path. Three of its six destinations
(Apple Books, Send to Kindle, email to Kindle) depend on the launch shims
already deferred to piece C, and nothing in A or B renders routes at all, so
porting it here would mean unconsumed code with no test that could prove it
right. It travels with the UI that uses it.

**Explicitly not in this piece:** no CLI commands (piece B), no Swift deleted
or modified (piece F), no Tauri.

## Piece A is purely additive

The Swift app keeps working, untouched, for the whole of this piece.
TypeScript *gains* the logic; nothing yet consumes it. The switchover — the
Mac app shelling out to the CLI instead of using its own copy — happens in
piece B, once the commands it would call exist.

This keeps A reviewable in isolation, and means a half-finished A cannot break
the shipping app.

## Why the tests are ported first

The device code is hardware-validated and cannot be re-validated here. No
Kobo, tolino or reMarkable has ever been plugged into this project; the Kindle
findings came from one real device, some of them several firmware versions
ago. The existing assertions encode facts nobody can re-derive by reading the
code.

Therefore, for every module: **port its `kit-check` assertions as failing
`bun test` cases first, then write the implementation under them.** Do not
adjust an assertion while porting the thing it exists to catch. If an
assertion looks wrong, stop and raise it rather than "fixing" it in passing.

## Architecture

```
src/device/     volumes.ts   classify.ts   kindle.ts   remarkable.ts   transfer.ts
src/export/     formats.ts   freshness.ts  artifact.ts  calibre.ts  kfx.ts
src/settings/   sidecar.ts   presets.ts
```

Feature directories, matching the existing `parser/`, `fountain/`, `epub/`,
`mobi/` layout.

### The enumerate/classify seam

Swift gets volume enumeration free from `FileManager.mountedVolumeURLs`.
TypeScript does not, and that enumeration is the only part of this port that
cannot be unit-tested — it depends on what is physically plugged in.

The design concentrates that risk into one small function and keeps everything
else pure:

- **`classify(path)`** (`device/classify.ts`) — a pure filesystem predicate.
  Holds all device knowledge: `documents/` plus a Kindle-ish name or `system/`
  means Kindle; a `.kobo` directory means Kobo; a tolino-ish volume name means
  tolino. Portable, and the target of every ported assertion, all of which
  already use temp directories.
- **`enumerate()`** (`device/volumes.ts`) — deliberately dumb, three branches:
  - macOS: entries under `/Volumes`
  - Linux: entries under `/run/media/$USER`, `/media/$USER`, `/media`
  - Windows: existing drive roots `A:\`–`Z:\`, skipping the system drive

  Volume name is the directory's own name. On Windows that is the drive
  letter: reading a real volume label means shelling out to PowerShell, which
  enumeration must never do — it has to stay fast and side-effect-free, and a
  label, if ever wanted, is a separate lookup. `enumerate()` accepts an
  optional injected root list so tests can drive it without real hardware.

`mounted()` is then `enumerate().map(classify).filter(Boolean)` — the
composition every caller uses.

### Per-module notes

**`device/kindle.ts`** — `isKindleVolume`, `copy` (into `documents/`,
replacing), `name`. Four detection assertions and three copy assertions port
directly.

**`device/transfer.ts`** — per-vendor destination: Kindle → `documents/`, Kobo
→ volume root, tolino → `Books/` at the root, created if missing (subfolders
of it are not reliably indexed). reMarkable has no volume and must throw
rather than silently pick a path.

**`device/remarkable.ts`** — the tablet's fixed USB address, `probe()`, and
`upload()`. Three behaviors are load-bearing and each has an assertion: the
size cap is checked **before any network call**; the root listing is a `GET
/documents/` that must succeed before `POST /upload`, because `/upload` writes
into whichever folder the interface listed last — the GET is aim, not
courtesy; and a failed listing aborts without a blind POST. Tests run against
a `Bun.serve` stub that records its request sequence, mirroring kit-check's.

**`export/freshness.ts`** — `needsRegeneration`. The asymmetry is deliberate
and must survive the port verbatim: an unreadable **artifact** date falls back
to the distant past (regenerate), an unreadable **EPUB** date falls back to
the distant future (also regenerate). Ties count as stale. Getting either
fallback backwards silently serves users a stale book.

**`export/formats.ts`** — the Kindle sideload ladder: KFX when the full
toolchain is present, AZW3 with Calibre alone, the engine's own MOBI with
nothing.

**`export/artifact.ts`** — `mobiSibling`, `available()`, and
`freshKindleArtifact`, the orchestrator that walks the ladder and returns a
Kindle-format file guaranteed current with its EPUB. One simplification lands
here: the Swift MOBI branch shells out to the engine as a subprocess and then
parses its JSON, because Swift had no other way in. In TypeScript it calls
`convertFountain` directly, in process. The behavior that must survive is the
documented side effect — that branch **rewrites the EPUB in place** before
writing the `.mobi` beside it, so callers cannot treat the input EPUB as
untouched.

**`export/calibre.ts`** — `ebook-convert` discovery and the AZW3/KEPUB
recipes, including the format-guard flags that stop Calibre re-breaking scenes
and deleting the dialogue column's margins. Discovery becomes per-OS (macOS
`/Applications/calibre.app/...`, Linux `PATH`, Windows Program Files).

**`export/kfx.ts`** — KFX requires Amazon's Kindle Previewer, which has no
Linux build. No special-casing is needed: the ladder already degrades, so
Linux reports `kfxReady: false` and lands on AZW3. Windows gains the KFX rung
later for free, since Previewer ships there.

**`settings/sidecar.ts`** — `<Stem>.screepub.json` beside the `.fountain`.
Absent or unreadable sidecar falls back to the supplied base settings.

**`settings/presets.ts`** — `DevicePreset`, including `matching()`, which
answers "which preset am I on?" by value equality rather than a remembered
name.

## Two simplifications this port collects

1. **The sidecar's manual overlay collapses into `resolveFormatOptions`.**
   `ScriptSettings.load` overlays eighteen optional fields by hand, and its own
   comment says it is "mirroring the engine's `resolveFormatOptions` merge
   semantics." In TypeScript it can simply *be* that function, given a base
   other than the defaults. `resolveFormatOptions` grows an optional second
   parameter; the eighteen-line overlay disappears.
2. **The `format-defaults.json` triple-pin becomes a double-pin.**
   `FormatSettings.swift` is the third copy; porting removes the need for it.
   The existing pin test stays exactly as it is during piece A, because the
   Swift file still exists until piece F.

## Testing

- Every module's assertions ported before its implementation.
- Calibre-dependent tests self-skip when `ebook-convert` is absent, matching
  `kit-check`'s existing behavior, so CI stays green on bare runners.
- reMarkable tests use a local `Bun.serve` stub; no test touches a real
  network.
- `enumerate()` is tested through injected roots, never against real mounts.

## Acceptance criteria

1. All 606 existing tests still pass; `bunx tsc --noEmit` clean.
2. Every in-scope `kit-check` assertion has a corresponding `bun test`
   assertion, traceable one-to-one.
3. No file under `app/` is modified.
4. `bun test` passes on Linux both with Calibre installed and with it absent.
5. The ported modules are consumed by nothing yet — no CLI surface, no
   behavior change for any existing user.

## Risks

- **Silent behavioral drift in code nobody can hardware-test.** Mitigated by
  the tests-first rule, which is the entire reason for it.
- **`needsRegeneration`'s asymmetric fallbacks** are the single easiest thing
  to get subtly wrong. Must be asserted in both directions.
- **Windows volume enumeration ships unproven.** No Windows machine exists for
  this project. Accepted and recorded in the ADR.
- **Bun's filesystem semantics differ from Foundation's** around case
  sensitivity and volume naming. The classify assertions use temp
  directories, which will catch the naming cases but not real-volume behavior
  on macOS.
