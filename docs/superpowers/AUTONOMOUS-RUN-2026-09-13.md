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
