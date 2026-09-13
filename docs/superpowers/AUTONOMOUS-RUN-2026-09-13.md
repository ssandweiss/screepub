# Autonomous run — 2026-09-13

Sam is away. Instruction: *"progress through all phases without stopping…
do your best attempt at everything and I can review when I return. Skip the
windows code signing for now."*

Normal approval gates are **waived by explicit instruction**. Every decision
I would otherwise have asked about is recorded here, newest last, with what
it costs if wrong. This file is the review surface — read it first.

## Standing constraints for this run

- **Skip Windows code signing** (explicit). Windows CLI artifacts ship
  unsigned; SmartScreen will warn. Recorded, not solved.
- **No `sudo`.** I cannot install system packages. Where that blocks a build,
  I write the code, document the exact command, and move on rather than stop.
  **Largely moot — see F1 below: the Tauri toolchain is already present.**
- **Nothing under `app/` is modified** until piece F, per the ADR.
- Every piece merges to `main` only with a green suite and `tsc` clean.
- **Piece D's UI work uses the `frontend-design` skill** (explicit
  instruction, 2026-09-13). It starts from `brand/components/` — the app's
  design system already exists there in HTML/CSS, with seven colour tokens
  pinned to `Theme.swift` by `tests/brand-tokens.test.ts`.

## Pieces, in order

| | Piece | State |
|---|---|---|
| B | CLI device commands | in progress |
| E1 | Cross-platform CLI release (unsigned) | pending |
| C | Tauri shell | pending — expected to hit the sudo wall |
| D | Tauri UI | pending |
| E2 | App bundles | pending — depends on C building |
| F | Retire SwiftUI | pending — gated on D reaching parity |

## Decisions

**D1 — piece B's CLI gets verbs, with a filename-shadowing rule.**
`screepub <file>` is the existing contract and every caller depends on it, so
a bare first positional cannot simply become a subcommand. Rule adopted: the
first positional is a verb only when it matches a known verb AND no file of
that name exists. `screepub devices` lists; `screepub ./devices` and
`screepub devices.pdf` convert. A real file named `devices` wins, because a
stolen filename would be silently unconvertible while the verb is always
reachable as a bare word. *Cost if wrong: a compatibility surface that both
directions are tested against.*

**D2 — `send` does not convert.** It sends a file that already exists. Making
it convert would fold two commands into one and put the conversion pipeline
back in scope for this piece. *Cost if wrong: users run two commands.*

**D3 — `send` with several devices connected and no `--device` fails rather
than guessing**, listing the ids. Sending a book to the wrong reader is
tedious to undo by hand. One device connected is unambiguous and is used
without asking. *Cost if wrong: one extra flag in the common multi-device
case.*

**D4 — the reMarkable probe runs concurrently with the mount scan** in
`devices`, so the command costs one probe timeout rather than timeout + scan
on the many machines with no reMarkable. *Cost if wrong: nothing; it is
strictly faster.*

**D5 — piece B's implementation plan is drafted by a subagent, not by me.**
In piece A, five of the six fix rounds traced to weak tests in plans I wrote:
prose asserting a property the tests could not actually catch. The drafter is
instructed to check every test against "would a plausible wrong
implementation still pass this?" before writing it down, and I review the
plan before execution. *Cost if wrong: I rewrite a plan.*

## Findings

**F1 — piece C is NOT blocked by sudo. The Tauri toolchain is already on this
machine.** I expected the WebKitGTK wall and went looking for it early. What
is actually installed:

| Requirement | State |
|---|---|
| `rustc` / `cargo` | 1.98.1, in `/usr/bin` |
| `webkit2gtk-4.1` | 2.52.6 — the exact library Tauri v2 links against, visible to `pkg-config` |
| `gtk3`, `libsoup3`, `librsvg`, `openssl`, `pkgconf`, `base-devel`, `gcc` | all present |
| crates.io | reachable (index returns 200) |
| **`patchelf`** | **MISSING** — needed only for AppImage *bundling*, not for building or running |

Verified end to end rather than inferred: created a throwaway crate, added
`serde_json` as a dependency, and `cargo run` fetched, compiled and executed
it successfully. So piece C can be built and run here, and piece D's UI can be
tested in a real window.

The one gap is `patchelf`, which bites only when producing an AppImage in
piece E2. If you want Linux AppImage bundles:

```
sudo pacman -S --needed patchelf
```

A `.deb` bundle needs nothing extra, so E2 has a route that does not require
you at all.

**F2 — `origin/main` is 30 commits behind local `main`, and that is a trap for
worktrees.** Piece A was merged locally and never pushed (you chose "merge
locally"). The harness's worktree tool branches from `origin/<default>` by
default, so a new worktree would have forked from `88c649c` — *before* piece A
— and piece B would have been built against a tree with no `src/device/` in
it. Nothing would have failed loudly; the imports would simply not resolve.

Worked around by creating the worktree from local `HEAD` explicitly. **I did
not push to fix it**: pushing to a shared branch is one of the few actions I
hold for you even under an autonomy instruction. Push whenever you like —
`git push origin main` — and the default stops being wrong.

## Decisions (continued)

The piece B plan drafter resolved six spec ambiguities. I reviewed each and
kept all six; recorded here because they are design decisions, not typos.

**D6 — verb dispatch lives in `src/cli-devices.ts`, not `src/cli.ts`.** The
spec put it in `cli.ts`, but that module runs `main()` on import, so a test
cannot import it — and the spec also requires dispatch be tested directly.
Same reasoning that produced `cli-errors.ts`. *Cost if wrong: one module
boundary.*

**D7 — only `argv[0]` may be a verb.** The spec said "the first positional",
but positionals are not known until after `parseArgs`. A later token is
indistinguishable from a flag's value (`--title send`). *Cost if wrong:
`screepub --json devices` converts rather than listing; tested.*

**D8 — `no-devices` beats `unknown-device`** when `--device` is given and
nothing is connected: it is the actionable fact. `--device` beats
`ambiguous-device` when several are connected. Pinned by an ordering test
built on an input where the two orders actually disagree. *Cost if wrong: a
less helpful error message.*

**D9 — a `send` file that does not exist reports the existing `unreadable`
code**, checked *before* the device list is built — so a typo costs neither
the reMarkable probe timeout nor a misleading `no-devices`. *Cost if wrong:
nothing; strictly faster and more accurate.*

**D10 — `remarkableAccepts()` is extracted from `remarkable.ts`** so the CLI
can reject an unsupported extension without substring-matching an error
message, which `cli-errors.ts` forbids. One copy of the extension rule, shared
by both callers. *Cost if wrong: one small exported predicate.*

**D11 — two device-only environment seams,
`SCREEPUB_VOLUME_ROOTS` and `SCREEPUB_REMARKABLE_ENDPOINT`.** The end-to-end
CLI tests spawn a real binary, which would otherwise read this machine's real
mounts and hit a real network. These inject fakes instead. The cost is two
hidden inputs to production code; mitigated by a Final Verification step that
greps the conversion path to prove nothing there reads them. *Cost if wrong:
two env vars nobody sets in production.*

**F3 — piece E1 is far cheaper than the ADR assumed: Bun cross-compiles every
target from this one machine.** The ADR treated cross-platform CLI releases as
"mostly a release-workflow change", implying a per-OS build matrix. It does
not need one. Verified by building all four targets here on aarch64 Linux and
checking what actually came out with `file`:

| Target | Time | `file` says |
|---|---|---|
| `bun-linux-x64` | 2.1s | ELF 64-bit LSB executable, x86-64 |
| `bun-windows-x64` | 2.4s | PE32+ executable for MS Windows, x86-64 |
| `bun-darwin-arm64` | 1.8s | Mach-O 64-bit arm64 executable |
| `bun-linux-arm64` (native) | 0.1s | runs: `screepub 0.5.4` |

Bun downloads each target's runtime on demand and emits a genuine native
executable for it. The whole matrix builds in about six seconds.

Consequences for E1's design:

- No per-OS CI runners are needed to BUILD the CLI. One job can produce every
  artifact, which also drops this half of the release off paid macOS runners.
- Binaries are large (65-119 MB) because each embeds a Bun runtime. That is
  the known cost of the sidecar approach, recorded in the 2026-07-22 ADR.
- **Cross-compiling is not cross-TESTING.** A Windows binary built here has
  never executed. The existing CI smoke test (compile, convert a fixture,
  assert `"ok":true`) can only run on a matching runner, so E1 will still
  smoke-test each artifact on its own OS even though one job builds them all.
  Windows device behaviour in particular stays unproven — nobody on this
  project has a Windows machine.

## Piece B — merged

`924ca03`, 10 commits, 799 pass / 3 skip / 0 fail on merged main. `screepub
devices` and `screepub send` are live; `app/` untouched; worktree and branch
cleaned up. The whole-branch review returned "ready to merge" with 2 Important
and 9 Minor findings, all fixed in one wave, then re-reviewed clean.

Two things from piece B worth your eye:

- **A pre-existing `--json` leak was found and fixed.** Under `--json`, both
  `--help` and `--version` printed raw text, breaking the contract that every
  exit in that mode is exactly one parseable JSON object. The suite already
  asserted that property for the no-input path — the explicit flags had been
  missed. Fixed at all four sites. The Mac app never passes those flags, so
  nothing could break.
- **I made an error and caught it late.** My fix brief said "settle on one
  wording" for a reMarkable message without saying which way to unify. The
  implementer reasonably changed the LIBRARY text to match the CLI's, which
  broke piece A's byte-for-byte parity with `RemarkableDevice.swift` — an
  invariant piece A's reviewers had verified explicitly. It survived the suite
  only by luck: the test asserts `.toThrow('azw3')` and the new message
  happened to contain the filename. Corrected by unifying downward; all four
  messages re-verified against the Swift, and the test now asserts the literal
  `not .azw3.`.

## Decisions (continued)

**D12 — piece E1 is ADDITIVE: macOS CLI artifacts keep being built exactly as
they are today.** The obvious move, given that Bun cross-compiles everything
from one machine (F3), was to build every target in one cheap Linux job. I am
not doing that, for one decisive reason and one supporting one:

1. `app/release.sh` **signs and notarizes** the macOS CLI binaries, and
   notarization requires Apple's toolchain on macOS. A cross-compiled macOS
   binary cannot be notarized from Linux, so consolidating would trade a
   Gatekeeper-clean download for a scary warning — a regression on the only
   platform with actual users.
2. `tools/bump-tap.sh` hardcodes `screepub-cli-macos-arm64.tar.gz` and
   `-x64.tar.gz`; moving or renaming them breaks the Homebrew tap, which has
   its own freshness alarm.

So E1 adds Linux x64, Linux arm64 and Windows x64 from a cheap Ubuntu job and
leaves the macOS and DMG paths completely alone. *Cost if wrong: the macOS CLI
keeps being built on a paid runner that could in principle be cheaper.*

**D13 — Linux arm64 ships even though CI may not be able to smoke-test it.**
It covers Asahi, Raspberry Pi and ARM servers, and it is the architecture this
project is developed on daily, so it is the best-exercised Linux target in
practice even if GitHub has no free arm64 runner. If `ubuntu-24.04-arm` is
available it gets smoke-tested; if not, it ships and the notes say it is
untested rather than implying otherwise. *Cost if wrong: an artifact whose
first execution is on a user's machine — mitigated by it being the maintainer's
own architecture.*

**D14 — the build matrix is a TypeScript tool, not a shell script.**
`tools/build-cli.ts`, runnable by hand. A build matrix in bash is exactly the
platform-locked tooling the ADR is retiring, and a release tool nobody can run
locally is one nobody can debug. It verifies what it produced — existence,
non-emptiness, and binary format where the host can tell — rather than trusting
the compiler's exit code. *Cost if wrong: one more TS file instead of one more
shell script.*

**D15 — E1's plan was drafted by a subagent (as B's was), and I resolved its
one placeholder myself.** The plan left `<UPLOAD_SHA>`/`<DOWNLOAD_SHA>` for the
two new pinned GitHub Actions, which genuinely cannot be known at planning
time. `gh` is authenticated here, so I resolved them:
`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` and
`actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`, both the
commit the `v4` tag points at, matching how the repo already pins actions.

**Worth revisiting when you can run a release:** those are v4, while the latest
releases are upload-artifact v7.0.1 and download-artifact v8.0.1. I pinned v4
deliberately — it is the well-documented, known-compatible pair, the upload and
download halves are not guaranteed compatible across majors, and a workflow
cannot be tested without tagging. Jumping two majors unattended, on the one
part of this piece that rides untested until a tag, was the wrong risk to take.
*Cost if wrong: the new jobs use an older action generation than they could.*

**Plan quality note.** The drafter caught something I would likely have missed:
`release.yml`'s `checks` job greps the release notes for `sha-?256` and fails
the release if it finds one, because the workflow appends the real checksums
itself and two on a page both look official. So the notes must never name the
new `SHA256SUMS` asset. The plan adds that term to the in-suite banned list, so
a mistake fails in nine seconds instead of after notarization.

**F4 — piece C is fully buildable here: a real Tauri v2 dependency tree
compiles and links against this machine's WebKitGTK.** F1 established the
libraries were installed; that is not the same as a successful link, so I
scaffolded a throwaway crate depending on `tauri` v2 + `tauri-build` v2 and
built it.

Result: `cargo build` succeeded in **31.5 s**, and the crates that matter
compiled — `webkit2gtk v2.0.2`, `javascriptcore-rs v1.1.2`, `soup3 v0.5.0`,
plus `tao` (windowing) and `muda` (menus). Those crates' build scripts resolve
the system libraries through pkg-config and fail at build time when they are
missing, so their success is direct evidence the linkage works, not an
inference from `pacman -Q`.

(The throwaway binary itself does not show WebKit in `ldd`, because its
`main.rs` never opens a window and the linker drops what nothing references.
The compiled webview crates are the real signal.)

So pieces C and D can be built AND RUN on this machine — the UI can be checked
in a real window rather than written blind. The only remaining external need in
the whole program is `patchelf`, and only for AppImage bundling in E2; a `.deb`
needs nothing extra.

## Piece E1 — merged

`382e3e8`, 10 commits + a 2-commit fix wave, 894 pass / 3 skip / 0 fail on
merged main. Fifteen tasks, **no fix rounds during execution** — the first
piece in this program where every task passed its own review first time. The
whole-branch review returned "ready to merge" with no Critical findings.

**Proven, not asserted.** Before merging I ran the tool for real: three
artifacts plus `SHA256SUMS` in 13.1s; `sha256sum -c` verified them
independently; the Linux tarball held `screepub` at `-rwxr-xr-x` and the zip
held `screepub.exe`; and the extracted linux-arm64 binary ran on this machine,
answered `devices --json`, and converted a fixture PDF to EPUB. That is E1's
whole value demonstrated from a release artifact rather than from source.

**The best catch of the piece** came from the whole-branch review, which traced
a bad build stage by stage — truncated binary, wrong architecture, missing
executable bit — and found exactly one unguarded row: artifacts crossed the
CI job boundary via upload/download-artifact and were shipped **without being
re-opened**, so `SHA256SUMS` was never checked against the files it names. One
line (`cd cli && sha256sum -c SHA256SUMS`, ordered before the upload and
pinned by a test) closed the only hole in the chain.

**Two limits are now stated rather than discovered:** Windows binaries are
unsigned and SmartScreen will warn; and device support on Windows and Linux
has never run on hardware, with tolino undetectable on Windows at all because
it is identified by volume name and a drive root carries none.

### The one thing I decided against the reviewer

It recommended adding a `smoke-linux-arm64` job, since GitHub offers free
`ubuntu-24.04-arm` runners to public repos and the spec said to use one "if
available" — which the workflow had resolved as "assume not available", an
assumption rather than a check. The reviewer is probably right.

I shipped without it anyway. I cannot verify a runner label from here, and the
failure mode is lopsided: if it does not resolve on a real tag, the smoke job
fails, `cross-upload` is gated on it, and the release publishes **without the
Linux and Windows assets while its own notes promise them**. A bad first tag
for a gain I could not confirm. The notes are honest that linux-arm64 ships
built-but-untested.

**Flip it when you can check:** copy `smoke-linux-x64` with
`runs-on: ubuntu-24.04-arm`, and delete the test in
`tests/release-artifacts.test.ts` asserting that job's absence — it names
itself for exactly this purpose.
