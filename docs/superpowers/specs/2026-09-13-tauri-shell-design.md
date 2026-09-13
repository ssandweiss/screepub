# Design: the Tauri shell (piece C)

Date: 2026-09-13 · Status: accepted (autonomous — see the run log)
Program: [ADR 2026-09-12 — cross-platform rewrite](../../adr/2026-09-12-cross-platform-tauri.md)
Follows: [piece B — CLI device commands](2026-09-13-cli-device-commands-design.md),
[piece E1 — cross-platform CLI release](2026-09-13-cross-platform-cli-release-design.md)
Target version: 0.6.0

## Goal

A real application window, on macOS, Linux and Windows, that converts a
screenplay PDF. Nothing pretty — piece D does the designed interface. C's job
is to prove the plumbing: a Tauri shell that finds the engine, runs it, and
shows what came back.

## The rule this piece exists to honour

**Rust is a window, not a brain.** No business logic lives in Rust — not
conversion, not device detection, not settings. The shell spawns the engine
and renders its answer. Everything else is TypeScript, where the CLI, the app
and any future integration share one implementation and one test suite.

Without that rule, this piece would quietly become a second codebase and the
rewrite would have traded Swift debt for Rust debt. With it, the Rust stays
small enough for one maintainer to hold.

## What is already proven

Not assumed — measured on this machine:

- **The toolchain links.** A crate depending on `tauri` v2 + `tauri-build` v2
  compiles in 31.5s, pulling in `webkit2gtk 2.0.2`, `javascriptcore-rs`,
  `soup3`, `tao` and `muda`. Those crates resolve the system libraries through
  pkg-config and fail at build time when they are missing, so their success is
  direct evidence rather than inference.
- **The engine ships as a single self-contained binary.** `tools/build-cli.ts`
  (piece E1) cross-compiles it for every target; an artifact extracted from a
  release tarball converted a real fixture PDF to EPUB on this machine.
- **The contract already exists and is tested.** Piece B's `--json` commands —
  convert, `devices`, `send` — are the API. Their shape is pinned by tests and
  by the absolute rule that every `--json` exit is exactly one parseable JSON
  object on stdout.

## Where it lives

A new top-level `desktop/` directory. `app/` stays exactly where it is: it
holds the SwiftUI application, which keeps working until piece F retires it,
and nothing in this program has modified it.

`desktop/` is chosen over `tauri/` because the framework is an implementation
detail and the directory outlives it.

## The sidecar

Tauri bundles external binaries by declaring them in its config and resolving
them at runtime by name. It requires each to be suffixed with the Rust target
triple — `screepub-engine-x86_64-unknown-linux-gnu`, and so on — so that a
bundle carries the right binary for the platform it was built for.

`tools/build-cli.ts` already produces the binaries; what it does not do is
name them the way Tauri expects. Rather than duplicating the build matrix, C
adds a thin step that maps a Bun target to its Rust triple and places the
binary where Tauri will find it. **The exact naming and resolution rule is
verified empirically in the first task, not taken from memory** — get it wrong
and the failure is a confusing runtime "sidecar not found" rather than a build
error.

Development is the awkward case: `tauri dev` expects the sidecar present
before the app starts. The tool therefore supports producing just the host
target quickly, so the loop stays fast.

## What C delivers

- A Tauri project that builds and runs on this machine.
- One window. Choose a PDF, convert it, see the result — title, scene count,
  and where the EPUB was written — or see the error the engine reported.
- Rust commands that spawn the sidecar, pass `--json`, and return the parsed
  result to the frontend. They map the engine's error codes to something the
  UI can show; they do not interpret, retry, or decide anything.
- A frontend that is deliberately plain HTML and CSS. **Piece D replaces it**
  using `brand/components/`, which already holds this app's design system in
  web form, with seven colour tokens pinned to `Theme.swift` by a test.

## What C explicitly does not do

The designed interface, the reader view, the settings surface, the device
send flow in the UI (piece D). Bundling and installers (E2). Retiring the
Swift app (F). Auto-update. Anything that needs a signing certificate.

## Testing

The honest position: **Rust that only spawns a subprocess and forwards JSON
is thin enough that its value is proven by running it, not by unit tests.**
So the weight goes on:

- **The sidecar resolution rule**, verified empirically against a real Tauri
  build rather than asserted from documentation.
- **The triple mapping**, unit-tested in TypeScript beside the build tool —
  every Bun target maps to exactly one Rust triple, and an unknown target is
  an error rather than a silent default.
- **A real build and launch on this machine**, which is possible precisely
  because the toolchain was proven to link. A screenshot or a recorded
  conversion is worth more here than a mock.

What is NOT claimed: that it runs on Windows or macOS. Nobody on this project
has a Windows machine, and the Mac is elsewhere. Those ride on CI building
them and on piece E2's bundling, and the limits get stated rather than
implied.

## Acceptance criteria

1. `desktop/` builds with `cargo build` on this machine.
2. The app launches, converts `tests/fixtures/screenplay.pdf` through the
   bundled sidecar, and displays the real title and scene count from the
   engine's JSON.
3. An engine error (a non-screenplay PDF) surfaces in the window as the
   engine's own message, not a crash or a blank pane.
4. No Rust code makes a decision the engine could make: no parsing, no device
   logic, no formatting rules. A reviewer can read the Rust in one sitting.
5. Nothing under `app/` is modified; the existing suite stays green and
   `bunx tsc --noEmit` clean.

## Risks

- **The sidecar naming rule is the most likely thing to go wrong**, and its
  failure mode is a runtime "not found" rather than a compile error. Hence
  verifying it empirically first.
- **Build times.** A full Tauri dependency tree took 31.5s cold here; release
  builds will be slower. This does not touch `bun test`, which stays the
  engine's own loop.
- **Two GUIs exist at once** between C and F. That is intentional and
  temporary, and the Swift one keeps its own device logic until F.
