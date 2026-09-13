# Design: cross-platform CLI release (piece E1)

Date: 2026-09-13 · Status: accepted (autonomous — see the run log)
Program: [ADR 2026-09-12 — cross-platform rewrite](../../adr/2026-09-12-cross-platform-tauri.md)
Follows: [piece B — CLI device commands](2026-09-13-cli-device-commands-design.md)
Target version: 0.6.0

## Goal

Ship the command-line converter to Linux and Windows. The roadmap calls this
"the single biggest increase in who can use Screepub", and it lands before any
Rust is written — the engine has always been portable; only the release was
Mac-only.

## What changed the design

The ADR assumed a per-OS build matrix. It isn't needed: **Bun cross-compiles
every target from one machine.** Verified on aarch64 Linux — `bun-linux-x64`
in 2.1s, `bun-windows-x64` in 2.4s, `bun-darwin-arm64` in 1.8s, with `file`
confirming genuine ELF, PE32+ and Mach-O executables, and a natively compiled
binary running correctly.

## The shape: additive, not a rewrite

macOS CLI artifacts **keep being produced exactly as they are today**, on the
macOS runner by `app/release.sh`. Two reasons, and the first is decisive:

1. **`release.sh` signs and notarizes them.** Notarization requires Apple's
   toolchain on macOS. A cross-compiled macOS binary cannot be notarized from
   Linux, so moving that build would trade a Gatekeeper-clean download for a
   scary warning — a clear regression for the platform that has actual users.
2. `tools/bump-tap.sh` hardcodes `screepub-cli-macos-arm64.tar.gz` and
   `screepub-cli-macos-x64.tar.gz`. Renaming or relocating them breaks the
   Homebrew tap, which has its own freshness alarm.

So E1 **adds** Linux and Windows artifacts alongside, from a cheap Ubuntu job.
Nothing about the existing macOS or DMG path changes.

## Artifacts

| Target | Name | Packaging |
|---|---|---|
| Linux x86-64 | `screepub-cli-linux-x64.tar.gz` | tar.gz, executable bit preserved |
| Linux arm64 | `screepub-cli-linux-arm64.tar.gz` | tar.gz |
| Windows x86-64 | `screepub-cli-windows-x64.zip` | zip |

Linux arm64 is included deliberately rather than as an afterthought: it covers
Asahi, Raspberry Pi and ARM servers, and it is what the maintainer develops on,
so it is the one Linux target that gets exercised daily.

**Windows binaries are unsigned.** Authenticode signing needs a paid
certificate; that is out of scope by explicit instruction. SmartScreen will
warn on first run. The release notes must say so plainly rather than let users
discover it — see "Honesty" below.

## The build tool

`tools/build-cli.ts`, a Bun script, not shell. The project is consolidating
onto TypeScript for anything that thinks, and a build matrix expressed in bash
is exactly the kind of platform-locked tooling the ADR is retiring. It:

- takes a version and an output directory,
- cross-compiles each target with `bun build --compile --target=…`,
- packages each (tar.gz or zip),
- writes a `SHA256SUMS` file,
- and **verifies what it produced** rather than trusting the compiler's exit
  code: each artifact must exist, be non-empty, and — where the host can tell —
  be the expected binary format.

It is runnable by hand (`bun tools/build-cli.ts --version 0.6.0 --out dist/`),
because a release tool nobody can run locally is a release tool nobody can
debug.

## Smoke testing: build once, test per OS

Cross-compiling is not cross-testing. A Windows binary built on Linux has never
executed. So the workflow splits:

- **One Ubuntu job builds every artifact** and uploads them.
- **Per-OS jobs download their own artifact and run it**: convert
  `tests/fixtures/screenplay.pdf`, assert `"ok":true`, and run
  `screepub devices --json` to prove the new device command starts on that OS.
  Ubuntu covers linux-x64; `windows-latest` covers windows-x64.
- **linux-arm64 is built but not smoke-tested** unless an arm64 runner is
  available to the repo (`ubuntu-24.04-arm`). If it is, use it; if not, the
  artifact ships untested and the notes say so. Do not pretend otherwise.

`devices --json` returning an empty list is a pass — it proves the command ran,
which is the point.

## CI

`ci.yml` gains the cross-compile as a cheap early signal: build all three
targets on every push and assert the artifacts are the right binary formats.
This catches a target breaking without waiting for a tag. It does not need to
smoke-test there; the release workflow does that.

## Honesty

Two limits go in the release notes and the README, not discovered by users:

- **Windows binaries are unsigned** and SmartScreen will warn.
- **Device support on Windows and Linux is unproven on hardware.** The device
  code has only ever met one real Kindle. Windows volume enumeration in
  particular has never run, and tolino cannot be detected on Windows at all —
  it is identified by volume name, and a Windows drive root carries none.

## Acceptance criteria

1. `bun tools/build-cli.ts` produces all three artifacts plus `SHA256SUMS`,
   and fails loudly if any is missing, empty or the wrong format.
2. The existing macOS artifacts, the DMG, and the Homebrew tap bump are
   untouched and still produced by the same code as before.
3. The release workflow uploads the new artifacts beside the old ones.
4. linux-x64 and windows-x64 artifacts are smoke-tested on their own OS,
   converting the committed fixture and running `devices --json`.
5. The full existing suite still passes; `bunx tsc --noEmit` clean; nothing
   under `app/` modified.
6. README and release notes state the unsigned-Windows and unproven-hardware
   limits.

## Risks

- **A workflow change cannot be fully tested without tagging a release.** The
  build tool is therefore runnable and tested locally, so the part that can be
  verified is verified, and only the YAML wiring rides on the next tag.
- **No Windows machine exists on this project.** The Windows smoke test in CI
  is the only thing that will ever have run that binary before a user does.
- **Artifact size.** Each binary embeds a Bun runtime (65–119 MB), so a release
  grows by roughly 250 MB. That is the known cost of the sidecar approach,
  recorded in the 2026-07-22 ADR.
