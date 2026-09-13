# Tauri Shell Implementation Plan (piece C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real application window that converts a screenplay PDF by spawning the existing engine binary as a Tauri sidecar and rendering the `--json` object it prints. Nothing pretty — piece D designs the interface. C proves the plumbing: the shell finds the engine, runs it, and shows what came back, including the engine's own error text when the engine fails.

**Architecture:** Three layers, and the middle one is deliberately almost empty.

- **The engine** is unchanged. `src/cli.ts` already answers `--json` with exactly one parseable object on stdout, on success and on failure alike. Nothing in this piece edits `src/`.
- **A Bun tool**, `tools/build-sidecar.ts`, compiles that engine for a target and puts it where Tauri looks, under the name Tauri demands. It reuses `tools/build-cli.ts`'s compile and format-verification helpers rather than restating them, and adds exactly one new fact: the Bun-target → Rust-triple map. That map is the only piece of this plan with real branching, so it is the only piece that gets a dense unit-test suite.
- **The Rust** spawns the sidecar with an argv the *frontend* built, captures stdout, and returns it as an opaque `String`. It never parses that string, never appends a flag to that argv, never knows what a device or a scene or an EPUB is. `serde_json` is not a dependency and the word does not appear in the crate. The frontend calls `JSON.parse`.
- **The frontend** is three static files — `index.html`, `app.js`, `style.css` — embedded into the binary by `tauri-build`. No bundler, no dev server, no npm dependency, no framework. Piece D replaces all three using `brand/components/`.

**Tech Stack:** Rust 1.98.1 / cargo (installed), `tauri` 2.11.5, `tauri-build` 2, `tauri-plugin-shell` 2.3.6, `tauri-plugin-dialog` 2.7.3 — all four resolved, downloaded and **compile-checked on this machine** while writing this plan, against the exact source in Task 4. TypeScript/Bun for the build tool and every test. No new npm dependency; `package.json` is not edited.

**Spec:** [`docs/superpowers/specs/2026-09-13-tauri-shell-design.md`](../specs/2026-09-13-tauri-shell-design.md)
**Program ADR:** [`docs/adr/2026-09-12-cross-platform-tauri.md`](../../adr/2026-09-12-cross-platform-tauri.md)
**Follows:** [piece B — CLI device commands](2026-09-13-cli-device-commands.md), [piece E1 — cross-platform CLI release](2026-09-13-cross-platform-cli-release.md)

---

## Global Constraints

- **Rust is a window, not a brain.** The governing rule of the whole program. Operationally, for this piece, it means all five of these and each one is pinned by a test in Task 6:
  1. `serde_json` is not a declared dependency of the crate and the token does not appear in any `.rs` file. The Rust therefore *cannot* look inside the engine's answer.
  2. No `.rs` file contains a string literal beginning `--`. The frontend builds the whole argv, including `--json`; the Rust appends nothing and so knows no flag.
  3. No `.rs` file mentions the domain: no `kindle`, `kobo`, `remarkable`, `tolino`, `epub`, `mobi`, `fountain`, `azw3`, `scene`, `screenplay`, `slug`, `dialogue`, `character`. (`pdf` is allowed in exactly one place, the file-dialog filter, and the test allows it only there.)
  4. Total non-blank, non-comment Rust under `desktop/src-tauri/src/` stays at or under **200 lines**. The spec's "a reviewer can read it in one sitting" becomes a number so it can fail.
  5. The frontend never spawns anything. It calls two `invoke` names and nothing else.
- **`app/` is not touched.** The SwiftUI app keeps working until piece F. `git status --short app/` must print nothing before every commit, and the Final Verification diffs it against `main`.
- **`src/` is not touched.** The engine's behaviour is piece B's, already tested. If this piece finds itself wanting a new engine flag, it has smuggled logic and should stop.
- **Nothing in C runs during `bun test`'s hot path.** No test in `tests/` invokes `cargo`. The Rust guard tests read files and count lines; they cost milliseconds. Building Rust belongs to a developer's hands (Task 7) and to CI (Task 8), never to the engine's loop.
- **No binary enters the repo.** A compiled engine is 64–119 MB. `desktop/src-tauri/binaries/` and `desktop/src-tauri/target/` are gitignored in Task 3, and a test pins those ignore rules so a later `git add -A` cannot quietly stage 100 MB.
- **The bundle identifier is `com.darkwell.screepub.desktop`, not `com.darkwell.screepub`.** The Swift app claims the latter and `app/Sources/KitCheck/main.swift` pins its code signature to it. Two applications sharing an identifier is a Launch Services hazard on the one platform where both will exist at once. Piece F may reclaim the short identifier when the Swift app retires; until then the desktop shell uses its own.
- **`package.json`'s version is not bumped.** It says 0.5.4 today; `tauri.conf.json` says 0.6.0 because that is the program's target version, and the two are allowed to disagree during the transition. The window therefore shows `engine 0.5.4`, which is correct: it reports what the engine reported. Bumping `package.json` is the release's job, not this piece's — the same rule piece E1 adopted.
- **No conversion behaviour changes**, so `docs/formatting-options-log.md` is not updated. No new formatting option exists in this piece.
- **`tsconfig.json` includes only `src` and `tests`.** The new tool is typechecked because its tests import it, exactly as `tools/build-cli.ts` is. `verbatimModuleSyntax` is on: type-only imports must be spelled `import type`.
- **Existing suite stays green** and `bunx tsc --noEmit` stays clean after every task.

## What is checkable here, and what is not

Stated plainly, because the spec asks for it.

**Checkable on this machine, and therefore required before this piece is done:**

- The crate compiles (`cargo build`) — the toolchain was measured linking here.
- The sidecar rule, discovered by observation in Task 1 rather than recited.
- The app launching, converting `tests/fixtures/screenplay.pdf`, and displaying the real title and scene count the engine reported.
- The app showing the engine's own message for `tests/fixtures/prose.pdf` (the not-a-screenplay guard).
- Every guard test in Task 6, and the whole triple map in Task 2.

**Not checkable here, and stated as such rather than implied:**

- **That it runs on macOS or Windows.** Nobody on this project has a Windows machine and the Mac is elsewhere. Task 8 adds a CI job that *compiles* the crate on `macos-15` and `windows-latest`; compiling is not running, and the plan does not pretend otherwise. First real execution on those platforms happens in piece E2.
- **That it bundles, installs, or is signed anywhere.** That is E2 in its entirety. `patchelf` is not installed on this machine and is not needed, because nothing here builds an AppImage.
- **That the sidecar rule is identical on macOS and Windows.** Task 1 observes it on Linux. The naming convention is per-triple by construction, so the map in Task 2 covers all five targets, but only the Linux row has been watched working.
- **`tauri dev`.** This piece never uses the Tauri CLI at all (see the ambiguity notes below); the loop is `cargo run`.

## Ambiguities in the spec, and how this plan resolved them

1. **"`tauri dev` expects the sidecar present before the app starts."** The spec's development paragraph assumes the Tauri CLI. This plan does not install or use it. Because the frontend is three static files, `tauri-build` embeds them at compile time and `cargo run` is a complete dev loop — no npm dependency, no dev server, no watcher, one fewer toolchain to install on three platforms. The Tauri CLI becomes necessary for *bundling*, which is piece E2's job and which E2 can add without changing anything here. The spec's real requirement — "the tool supports producing just the host target quickly, so the loop stays fast" — is met by `bun tools/build-sidecar.ts --host` (Task 3), and it is still met if E2 later introduces `tauri dev`.
2. **macOS has no row in `tools/build-cli.ts`'s `TARGETS`.** That table deliberately refuses to build a Mach-O, because the signed and notarized macOS CLI comes from `app/release.sh`. But a sidecar is not a release artifact, and without a darwin row a Mac developer cannot start the app at all and the CI job that proves macOS compiles cannot run. Resolved: the triple map in Task 2 is its own table covering **all five** desktop Bun targets, and a test pins that every `build-cli.ts` target id is present in it (so the two tables cannot silently diverge). `build-sidecar.ts` never packages, never checksums, and never uploads, so no unsigned macOS artifact can reach a release from here.
3. **Who appends `--json`?** The frontend. Rust appending it would be one small piece of contract knowledge, and one is how two become five. With the frontend owning the whole argv, "the Rust contains no `--` literal" becomes a mechanical test, which is worth more than the small safety of a forced flag. Consequence, accepted: a frontend bug that drops `--json` produces human-readable text the frontend fails to parse, and the error path in Task 5 shows the raw stdout, so it is immediately diagnosable.
4. **"Rust commands ... map the engine's error codes to something the UI can show."** Taken literally that is a table of codes in Rust, which is exactly the brain the ADR forbids — and it would duplicate `src/cli-errors.ts`, where the fourteen codes already live and are already tested. Resolved: the Rust distinguishes only the two things it is *in a position* to know — "I could not find or start the binary" (rejects with a plain-text message) and "the engine answered" (resolves with the raw stdout). Everything the engine itself classified is classified in `src/`, and `desktop/ui/app.js` renders `error.message` verbatim with `error.code` beside it. That satisfies the spec's actual requirement, which is acceptance criterion 3: the engine's own message reaches the window.
5. **A non-zero exit is not a failure.** `src/cli.ts` exits 1 for every error under `--json` *while printing a valid object*. So the Rust must ignore the exit status and treat a non-empty stdout as the answer. This is plumbing, not interpretation, and Task 4 comments it at the site.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `desktop/README.md` | How to build and run the shell, and the recorded sidecar rule from Task 1. |
| `desktop/src-tauri/Cargo.toml` | The crate. Four dependencies, no `serde_json`. |
| `desktop/src-tauri/Cargo.lock` | Committed: this is an application, not a library. |
| `desktop/src-tauri/build.rs` | `tauri_build::build()` and nothing else. |
| `desktop/src-tauri/tauri.conf.json` | Window, identifier, `frontendDist`, `externalBin`. |
| `desktop/src-tauri/capabilities/default.json` | `core:default` only. The frontend is granted no plugin permission. |
| `desktop/src-tauri/src/main.rs` | The builder and the two commands. |
| `desktop/src-tauri/src/sidecar.rs` | Spawn the sidecar, hand back stdout as an opaque string. |
| `desktop/ui/index.html` | The one window's markup. |
| `desktop/ui/app.js` | Builds argv, invokes, parses, renders. |
| `desktop/ui/style.css` | Plain. Piece D replaces it. |
| `tools/sidecar-targets.ts` | Bun target ↔ Rust triple, and the sidecar filename rule. |
| `tools/build-sidecar.ts` | Compile the engine for a target, name it, place it, verify it. |
| `tests/sidecar-targets.test.ts` | The map, exhaustively, plus the cross-pin to `build-cli.ts`. |
| `tests/build-sidecar.test.ts` | The tool's arguments, paths, verification and ignore rules. |
| `tests/desktop-shell.test.ts` | The "Rust is a window" guards, and the config/capability pins. |
| `.github/workflows/desktop.yml` | Compile the crate on Linux, macOS and Windows. |

**Modified:**

| File | Change |
|---|---|
| `.gitignore` | `desktop/src-tauri/target/` and `desktop/src-tauri/binaries/`. |
| `README.md` | One short "Desktop app (in progress)" paragraph pointing at `desktop/README.md`. |

**Untouched, and verified so:** everything under `app/`, everything under `src/`, `tools/build-cli.ts`, `tools/bump-tap.sh`, `tests/fixtures/`, `tests/fixture-stability.test.ts`, `package.json`, `.github/workflows/{ci,release,pages,tap-freshness,weekly-toolchain}.yml`.

---

### Task 1: Discover how Tauri actually resolves the sidecar

**This task is an experiment, not an implementation.** Everything downstream — the filename `build-sidecar.ts` writes, the directory it writes into, the name the Rust passes to `sidecar()` — is downstream of one rule that this project has never observed. Getting it wrong does not fail the build; it produces a runtime "sidecar not found" in a window, which is the most expensive kind of wrong.

So: build something, run it, and **write down what happened**. The steps below carry an expectation, and the expectation is there to be checked against reality, not asserted. **Where the observation and the expectation disagree, the observation wins and Tasks 2, 3 and 4 are adjusted to match it before they are started.**

What is deliberately unknown going in, and what the experiment must answer:

- **A.** Does the sidecar file have to carry the Rust target triple as a filename suffix, and if so, spelled exactly how?
- **B.** Is that requirement enforced at *build* time (a `cargo build` error naming the file) or only at *run* time?
- **C.** Where does the file have to sit relative to `tauri.conf.json`?
- **D.** What name does the *running* app ask for — the suffixed one or a stripped one — and where does it look?

**Files:**
- Create: `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/build.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`, `desktop/src-tauri/src/main.rs`, `desktop/ui/index.html`, `desktop/README.md`
- Create (temporary, deleted in Task 3): `desktop/src-tauri/binaries/screepub-engine`

**Interfaces:** none yet. This task produces *observations*, recorded in `desktop/README.md` under a heading `## How Tauri finds the engine (observed <date>)`.

- [ ] **Step 1: Scaffold the crate**

Create `desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "screepub-desktop"
version = "0.6.0"
edition = "2021"
rust-version = "1.77"
license = "AGPL-3.0-or-later"
publish = false
description = "Screepub desktop shell. A window around the engine; no logic lives here."

[build-dependencies]
tauri-build = "2"

[dependencies]
# No serde_json, on purpose and permanently. The engine's answer is an
# opaque string on its way to the frontend; a JSON parser in this crate is
# the first step to a decision being made in it.
tauri = "2"
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
```

Create `desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

Create `desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Screepub",
  "version": "0.6.0",
  "identifier": "com.darkwell.screepub.desktop",
  "build": {
    "frontendDist": "../ui"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Screepub",
        "width": 860,
        "height": 620,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'"
    }
  },
  "bundle": {
    "externalBin": ["binaries/screepub-engine"]
  }
}
```

Two notes on that config, both load-bearing:

- `withGlobalTauri` is what lets `desktop/ui/app.js` reach `window.__TAURI__.core.invoke` with no npm package and no bundler. It is the reason this piece needs no JavaScript toolchain at all.
- The CSP forbids inline script, so `app.js` is a separate file. Keep it that way; an inline `<script>` would silently do nothing.

Create `desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "The window may call this app's own two commands. It is granted no plugin permission: the shell and dialog plugins are used only from Rust.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

Create `desktop/ui/index.html` — a stub for now, Task 5 writes the real one:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Screepub</title>
  </head>
  <body>
    <p>probe</p>
  </body>
</html>
```

- [ ] **Step 2: Create a stub sidecar, deliberately NOT suffixed**

The stub stands in for the 100 MB engine so the experiment costs seconds and stages nothing large. It answers the same shape the engine answers for `--version --json`.

```bash
mkdir -p desktop/src-tauri/binaries
cat > desktop/src-tauri/binaries/screepub-engine <<'EOF'
#!/bin/sh
echo '{"ok":true,"version":"stub-probe"}'
EOF
chmod +x desktop/src-tauri/binaries/screepub-engine
```

- [ ] **Step 3: Build, and record what the build says about that file**

Run: `cd desktop/src-tauri && cargo build 2>&1 | tail -40`

**Record the outcome verbatim.** It will be one of:

- **B-at-build-time:** the build fails and the error names a filename. That filename is the answer to questions A and C, stated by the tool itself rather than by anyone's memory. Copy it down exactly, including how the triple is spelled.
- **B-at-run-time:** the build succeeds and says nothing about the file. Then the requirement is not enforced here, and Step 5's run is the only thing that can answer A, C and D. Note that the enforcement point is runtime — it changes how a future mistake will present, and `desktop/README.md` should say so.

If the build instead fails for a missing icon (`bundle.icon` resolution), that is unrelated to the sidecar: convert `assets/icon.svg` to a 512×512 PNG at `desktop/src-tauri/icons/icon.png` (`rsvg-convert -w 512 -h 512` or `magick`), add `"icon": ["icons/icon.png"]` to the `bundle` object, and continue. Record that this was needed; Task 8 needs to know.

- [ ] **Step 4: Satisfy whatever Step 3 demanded, and look at the target directory**

If Step 3 demanded a suffixed name, rename to exactly the name it demanded and rebuild:

```bash
# The triple this machine's own rustc reports. Use it; do not type one from memory.
rustc -vV | sed -n 's/^host: //p'
```

Then, whether or not a rename was needed:

```bash
cargo build
ls -l target/debug/ | grep -i screepub-engine || echo "NOTHING named screepub-engine next to the app binary"
```

**Record:** did a copy of the stub appear beside `target/debug/screepub-desktop`? Under what name — suffixed, or stripped? This is question D's first half, and it is the difference between "Tauri reads it from `binaries/`" and "something copies it next to the executable and the running app looks there."

- [ ] **Step 5: Run a probe that asks the running app directly**

Replace `desktop/src-tauri/src/main.rs` with the probe. Task 4 replaces this file wholesale; it exists to answer D.

```rust
// TASK 1 PROBE. Replaced entirely by Task 4 — do not build on this file.
//
// Its only job is to make the running app say, out loud, where it looks for
// the sidecar and whether it found one.
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let exe = std::env::current_exe().expect("current_exe");
            eprintln!("PROBE exe = {}", exe.display());

            let dir = exe.parent().expect("exe has a parent").to_path_buf();
            eprintln!("PROBE looking beside the app, in {}", dir.display());
            for entry in std::fs::read_dir(&dir).expect("read_dir").flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains("screepub-engine") {
                    eprintln!("PROBE   found: {name}");
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match handle.shell().sidecar("screepub-engine") {
                    Ok(cmd) => match cmd.args(["--version", "--json"]).output().await {
                        Ok(out) => eprintln!(
                            "PROBE sidecar(\"screepub-engine\") ran; stdout = {}",
                            String::from_utf8_lossy(&out.stdout).trim()
                        ),
                        Err(e) => eprintln!("PROBE sidecar resolved but failed to run: {e}"),
                    },
                    Err(e) => eprintln!("PROBE sidecar(\"screepub-engine\") did NOT resolve: {e}"),
                }
                handle.exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run");
}
```

Run: `cd desktop/src-tauri && cargo run 2>&1 | grep PROBE`

Expected, if the sketch is right: the exe path under `target/debug/`, a `found:` line naming a file, and `stdout = {"ok":true,"version":"stub-probe"}`.

**If instead it says `did NOT resolve`, that message is the finding.** Read it, and use it to correct the name or the location. Repeat Steps 4–5 until the stub's stdout comes back. Do not proceed on a `did NOT resolve`; every later task assumes this line printed.

- [ ] **Step 6: Also ask what a *wrong* name does**

One more run, with `sidecar("screepub-engine")` changed to `sidecar("screepub-engin")`, purely to see the failure mode with your own eyes. Record the message. It is what a future maintainer will be staring at, and `desktop/README.md` should quote it so it is searchable.

Change the name back afterwards.

- [ ] **Step 7: Write the rule down**

Create `desktop/README.md`. It is the only documentation this piece adds and it exists because the next person must not have to re-run this experiment.

```markdown
# Screepub desktop shell

A Tauri window around the Screepub engine. **No logic lives in this
directory.** The shell spawns the engine binary, passes it the arguments the
frontend built, and renders the JSON object the engine printed. Parsing,
device knowledge and formatting rules are all in `src/` (TypeScript), where
the CLI and the app share one implementation and one test suite. See
[ADR 2026-09-12](../docs/adr/2026-09-12-cross-platform-tauri.md).

## Build and run

    bun tools/build-sidecar.ts --host    # ~30s: compiles the engine for THIS machine
    cd desktop/src-tauri && cargo run

`cargo run` is the whole dev loop. The frontend is three static files that
`tauri-build` embeds at compile time, so there is no dev server, no bundler
and no npm dependency. The Tauri CLI is not used here; bundling and
installers are piece E2.

The sidecar must exist before the app starts. If you skip the first command
the window opens and every conversion fails with the message quoted below.

## How Tauri finds the engine (observed <date>, on <host triple>)

<Write, in five or six sentences, exactly what Tasks 1's steps observed:
 - the filename the sidecar must have in `desktop/src-tauri/binaries/`;
 - whether the requirement is enforced at build time or run time;
 - what appears beside the app binary in `target/debug/` after a build;
 - the name the running app passes to `sidecar()`;
 - the verbatim error text a wrong name produces, so it is searchable.
This section is an observation log. Do not replace it with a summary of
Tauri's documentation — the whole point is that it was watched happening on
a real machine.>
```

- [ ] **Step 8: Commit the experiment's result, not its scaffolding**

The stub sidecar is not committed (Task 3 gitignores `binaries/`); delete it at the end of Task 3. The probe `main.rs` is committed only as the interim state of a task-by-task branch and is replaced in Task 4.

Run: `git status --short app/ src/`
Expected: no output.

---

### Task 2: Bun target → Rust triple

The one genuinely branchy fact in this piece, and therefore the one that earns a dense test. A wrong triple does not fail the build: it produces a sidecar that Tauri never looks for, which is the exact failure mode Task 1 existed to avoid.

`tools/build-cli.ts`'s `TARGETS` deliberately holds no darwin row — its job is release artifacts, and a macOS one must come signed from `app/release.sh`. A *sidecar* is not a release artifact, so this table is its own and covers all five desktop Bun targets. The two tables are cross-pinned: a test fails if a target id exists in `build-cli.ts` and not here.

**Files:**
- Create: `tools/sidecar-targets.ts`
- Test: `tests/sidecar-targets.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type BunTarget =
    | 'bun-linux-x64' | 'bun-linux-arm64' | 'bun-windows-x64'
    | 'bun-darwin-x64' | 'bun-darwin-arm64';
  export interface SidecarTarget {
    bunTarget: BunTarget;
    rustTriple: string;
    /** What `bun build --compile` writes: bare, or with `.exe` on Windows. */
    exeSuffix: '' | '.exe';
    format: BinaryFormat;   // re-used from tools/build-cli.ts
  }
  export const SIDECAR_TARGETS: readonly SidecarTarget[];
  export const SIDECAR_BASENAME = 'screepub-engine';
  export function rustTripleFor(bunTarget: string): string;      // throws on unknown
  export function sidecarFileName(target: SidecarTarget): string; // 'screepub-engine-<triple>[.exe]'
  export function sidecarTargetFor(bunTarget: string): SidecarTarget; // throws on unknown
  export function hostBunTarget(platform: string, arch: string): BunTarget; // throws on unknown
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/sidecar-targets.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import {
  SIDECAR_TARGETS,
  SIDECAR_BASENAME,
  rustTripleFor,
  sidecarFileName,
  sidecarTargetFor,
  hostBunTarget,
} from '../tools/sidecar-targets';
import { TARGETS } from '../tools/build-cli';

describe('the triple map', () => {
  test('every Bun desktop target maps to exactly one Rust triple', () => {
    // Pinned whole, not sampled. These strings are not decorative: Tauri
    // resolves the sidecar by this exact filename suffix (Task 1), so a
    // typo here produces a window that cannot find its engine rather than
    // anything that fails to build.
    expect(
      Object.fromEntries(SIDECAR_TARGETS.map((t) => [t.bunTarget, t.rustTriple])),
    ).toEqual({
      'bun-linux-x64': 'x86_64-unknown-linux-gnu',
      'bun-linux-arm64': 'aarch64-unknown-linux-gnu',
      'bun-windows-x64': 'x86_64-pc-windows-msvc',
      'bun-darwin-x64': 'x86_64-apple-darwin',
      'bun-darwin-arm64': 'aarch64-apple-darwin',
    });
  });

  test('no two targets share a triple, and no triple is empty', () => {
    // A copy-paste that left two rows with the same triple would overwrite
    // one sidecar with the other's binary — same filename, wrong machine,
    // and it would run fine on the developer's own box.
    const triples = SIDECAR_TARGETS.map((t) => t.rustTriple);
    expect(new Set(triples).size).toBe(SIDECAR_TARGETS.length);
    for (const t of triples) expect(t.length).toBeGreaterThan(0);
  });

  test('each target names the binary format its output must have', () => {
    expect(
      Object.fromEntries(SIDECAR_TARGETS.map((t) => [t.bunTarget, t.format])),
    ).toEqual({
      'bun-linux-x64': 'elf-x86-64',
      'bun-linux-arm64': 'elf-aarch64',
      'bun-windows-x64': 'pe-x86-64',
      'bun-darwin-x64': 'macho-x86-64',
      'bun-darwin-arm64': 'macho-arm64',
    });
  });

  test('only the Windows target carries .exe', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(t.exeSuffix).toBe(t.bunTarget === 'bun-windows-x64' ? '.exe' : '');
    }
  });
});

describe('rustTripleFor', () => {
  test('answers for every known target', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(rustTripleFor(t.bunTarget)).toBe(t.rustTriple);
    }
  });

  test('an unknown target throws, and never falls back to a default', () => {
    // The failure this exists to prevent: a silent default would build the
    // host's binary, name it for a machine it cannot run on, and the
    // mistake would only surface on someone else's computer.
    for (const bad of ['bun-linux-riscv64', 'bun-darwin-arm', 'linux-x64', '', 'bun-windows-arm64']) {
      expect(() => rustTripleFor(bad)).toThrow(/unknown bun target/i);
    }
  });

  test('the error names the target it was given and the ones it knows', () => {
    expect(() => rustTripleFor('bun-linux-riscv64')).toThrow(/bun-linux-riscv64/);
    expect(() => rustTripleFor('bun-linux-riscv64')).toThrow(/bun-linux-x64/);
  });
});

describe('sidecarFileName', () => {
  test('is the basename, a hyphen, the triple, and the platform suffix', () => {
    // The single most important string in this piece. Task 1 observed the
    // rule on a real build; this pins the observation.
    const names = SIDECAR_TARGETS.map(sidecarFileName);
    expect(names).toEqual([
      'screepub-engine-x86_64-unknown-linux-gnu',
      'screepub-engine-aarch64-unknown-linux-gnu',
      'screepub-engine-x86_64-pc-windows-msvc.exe',
      'screepub-engine-x86_64-apple-darwin',
      'screepub-engine-aarch64-apple-darwin',
    ]);
  });

  test('every name begins with the basename the Rust asks for', () => {
    // desktop/src-tauri/src/sidecar.rs passes SIDECAR_BASENAME to
    // sidecar(); a name that did not start with it would never resolve.
    for (const t of SIDECAR_TARGETS) {
      expect(sidecarFileName(t).startsWith(`${SIDECAR_BASENAME}-`)).toBe(true);
    }
  });

  test('no name contains a path separator', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(sidecarFileName(t)).not.toContain('/');
      expect(sidecarFileName(t)).not.toContain('\\');
    }
  });
});

describe('hostBunTarget', () => {
  test('maps the platform/arch pairs a developer or runner can be on', () => {
    expect(hostBunTarget('linux', 'x64')).toBe('bun-linux-x64');
    expect(hostBunTarget('linux', 'arm64')).toBe('bun-linux-arm64');
    expect(hostBunTarget('win32', 'x64')).toBe('bun-windows-x64');
    expect(hostBunTarget('darwin', 'x64')).toBe('bun-darwin-x64');
    expect(hostBunTarget('darwin', 'arm64')).toBe('bun-darwin-arm64');
  });

  test('an unsupported host throws rather than guessing', () => {
    expect(() => hostBunTarget('linux', 'ia32')).toThrow(/no sidecar target/i);
    expect(() => hostBunTarget('freebsd', 'x64')).toThrow(/no sidecar target/i);
    expect(() => hostBunTarget('win32', 'arm64')).toThrow(/no sidecar target/i);
  });

  test('this machine is a supported host', () => {
    const t = hostBunTarget(process.platform, process.arch);
    expect(SIDECAR_TARGETS.map((x) => x.bunTarget)).toContain(t);
  });
});

describe('the two target tables agree', () => {
  test('every release target in build-cli.ts has a sidecar triple', () => {
    // The drift this catches: someone adds a target to the release matrix
    // and the desktop app silently stops shipping an engine for it. The
    // reverse is allowed — darwin is a sidecar target and not a release
    // target, deliberately, because signed macOS artifacts come from
    // app/release.sh.
    const sidecarBunTargets = new Set<string>(SIDECAR_TARGETS.map((t) => t.bunTarget));
    for (const t of TARGETS) {
      expect(`${t.id} has a sidecar triple: ${sidecarBunTargets.has(t.bunTarget)}`).toBe(
        `${t.id} has a sidecar triple: true`,
      );
    }
  });

  test('where both tables name a format, they name the same one', () => {
    for (const t of TARGETS) {
      expect(sidecarTargetFor(t.bunTarget).format).toBe(t.format);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sidecar-targets.test.ts`
Expected: FAIL — `tools/sidecar-targets.ts` does not exist.

- [ ] **Step 3: Implement**

Create `tools/sidecar-targets.ts`:

```ts
// Which Rust target triple corresponds to each Bun compile target, and what
// the sidecar file must therefore be called.
//
// This is the one fact in piece C that a mistake hides rather than reveals.
// Tauri resolves a bundled external binary by name, with the Rust triple as
// a filename suffix; the rule was VERIFIED by running a real build and a
// real app on this machine (see desktop/README.md, "How Tauri finds the
// engine"), not read out of documentation. A wrong triple here compiles
// cleanly, bundles cleanly, and fails at runtime on someone else's computer.
//
// Two tables exist on purpose. tools/build-cli.ts's TARGETS is the RELEASE
// matrix and holds no darwin row, because a macOS artifact must come signed
// and notarized from app/release.sh. A sidecar is not a release artifact:
// it is an input to a build, so darwin belongs here. tests/sidecar-targets
// .test.ts pins that the release table is a subset of this one.

import type { BinaryFormat } from './build-cli';

export type BunTarget =
  | 'bun-linux-x64'
  | 'bun-linux-arm64'
  | 'bun-windows-x64'
  | 'bun-darwin-x64'
  | 'bun-darwin-arm64';

export interface SidecarTarget {
  bunTarget: BunTarget;
  /** The suffix Tauri requires on the sidecar's filename. */
  rustTriple: string;
  /** What `bun build --compile` actually writes for this target. */
  exeSuffix: '' | '.exe';
  /** What the compiled binary must be. Checked, never assumed. */
  format: BinaryFormat;
}

/** The name the Rust passes to `sidecar()`. Every file below starts with it. */
export const SIDECAR_BASENAME = 'screepub-engine';

export const SIDECAR_TARGETS: readonly SidecarTarget[] = [
  {
    bunTarget: 'bun-linux-x64',
    rustTriple: 'x86_64-unknown-linux-gnu',
    exeSuffix: '',
    format: 'elf-x86-64',
  },
  {
    bunTarget: 'bun-linux-arm64',
    rustTriple: 'aarch64-unknown-linux-gnu',
    exeSuffix: '',
    format: 'elf-aarch64',
  },
  {
    bunTarget: 'bun-windows-x64',
    rustTriple: 'x86_64-pc-windows-msvc',
    exeSuffix: '.exe',
    format: 'pe-x86-64',
  },
  {
    bunTarget: 'bun-darwin-x64',
    rustTriple: 'x86_64-apple-darwin',
    exeSuffix: '',
    format: 'macho-x86-64',
  },
  {
    bunTarget: 'bun-darwin-arm64',
    rustTriple: 'aarch64-apple-darwin',
    exeSuffix: '',
    format: 'macho-arm64',
  },
];

const KNOWN = SIDECAR_TARGETS.map((t) => t.bunTarget).join(', ');

export function sidecarTargetFor(bunTarget: string): SidecarTarget {
  const found = SIDECAR_TARGETS.find((t) => t.bunTarget === bunTarget);
  if (!found) {
    throw new Error(
      `build-sidecar: unknown bun target "${bunTarget}"; known targets are ${KNOWN}`,
    );
  }
  return found;
}

export function rustTripleFor(bunTarget: string): string {
  return sidecarTargetFor(bunTarget).rustTriple;
}

export function sidecarFileName(target: SidecarTarget): string {
  return `${SIDECAR_BASENAME}-${target.rustTriple}${target.exeSuffix}`;
}

/** Which target this machine is. Throws rather than guessing: a guess would
 *  produce a sidecar named for a machine it cannot run on. */
export function hostBunTarget(platform: string, arch: string): BunTarget {
  if (platform === 'linux' && arch === 'x64') return 'bun-linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'bun-linux-arm64';
  if (platform === 'win32' && arch === 'x64') return 'bun-windows-x64';
  if (platform === 'darwin' && arch === 'x64') return 'bun-darwin-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'bun-darwin-arm64';
  throw new Error(
    `build-sidecar: no sidecar target for ${platform}/${arch}; known targets are ${KNOWN}`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sidecar-targets.test.ts && bunx tsc --noEmit`
Expected: pass, and `tsc` silent.

**If Task 1 observed a different naming rule than `<basename>-<triple><exe>`, change `sidecarFileName` and the pinned list in the test to match the observation, and say in the commit message what was observed.**

- [ ] **Step 5: Commit**

`git add tools/sidecar-targets.ts tests/sidecar-targets.test.ts && git commit`

---

### Task 3: `tools/build-sidecar.ts`

Compile the engine for one or more targets, name each file the way Task 1 observed, and put it where `tauri.conf.json`'s `externalBin` points. Small, because almost everything it needs already exists in `tools/build-cli.ts`: the compile invocation, the format detection, the size floor. Reusing them is not just economy — it means the sidecar and the released CLI are verified by the same code, so they cannot disagree about what a valid binary is.

The `--host` path is what keeps the dev loop fast: one target, about thirty seconds, and the app can start.

**Files:**
- Create: `tools/build-sidecar.ts`
- Modify: `.gitignore`
- Test: `tests/build-sidecar.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export const BINARIES_DIR: string;        // <repo>/desktop/src-tauri/binaries
  export interface SidecarArgs { targets: BunTarget[]; outDir: string; }
  export function parseSidecarArgs(argv: string[], platform?: string, arch?: string): SidecarArgs;
  export function sidecarPath(target: SidecarTarget, outDir: string): string;
  export function compileSidecarArgv(target: SidecarTarget, outDir: string): string[];
  export function buildSidecar(target: SidecarTarget, outDir: string, spawn?: Spawn, repoDir?: string): string;
  export function verifySidecar(target: SidecarTarget, outDir: string, floor?: number): void;
  export const SIDECAR_FLOOR_BYTES: number;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/build-sidecar.test.ts`:

```ts
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BINARIES_DIR,
  SIDECAR_FLOOR_BYTES,
  parseSidecarArgs,
  sidecarPath,
  compileSidecarArgv,
  buildSidecar,
  verifySidecar,
} from '../tools/build-sidecar';
import { SIDECAR_TARGETS, sidecarTargetFor, sidecarFileName } from '../tools/sidecar-targets';
import type { Spawn } from '../tools/build-cli';

const tmps: string[] = [];
function tmpOut(): string {
  const d = mkdtempSync(join(tmpdir(), 'screepub-sidecar-'));
  tmps.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe('parseSidecarArgs', () => {
  test('--host resolves the running machine', () => {
    expect(parseSidecarArgs(['--host'], 'linux', 'arm64').targets).toEqual(['bun-linux-arm64']);
    expect(parseSidecarArgs(['--host'], 'darwin', 'arm64').targets).toEqual(['bun-darwin-arm64']);
  });

  test('--target names one or several, and commas split', () => {
    expect(parseSidecarArgs(['--target', 'bun-windows-x64']).targets).toEqual(['bun-windows-x64']);
    expect(parseSidecarArgs(['--target', 'bun-linux-x64,bun-darwin-arm64']).targets).toEqual([
      'bun-linux-x64',
      'bun-darwin-arm64',
    ]);
  });

  test('--all is every target, in table order', () => {
    expect(parseSidecarArgs(['--all']).targets).toEqual(SIDECAR_TARGETS.map((t) => t.bunTarget));
  });

  test('no target selector at all is an error, not a default', () => {
    // A default of "--all" would cost five cross-compiles (~500 MB and
    // minutes) to someone who typed the command to see its help; a default
    // of "--host" would silently build the wrong thing in CI for another
    // platform. Say which.
    expect(() => parseSidecarArgs([])).toThrow(/--host, --target .* or --all/);
  });

  test('an unknown target is rejected by name', () => {
    expect(() => parseSidecarArgs(['--target', 'bun-linux-riscv64'])).toThrow(/bun-linux-riscv64/);
  });

  test('the default output directory is the externalBin directory tauri.conf.json names', () => {
    // Not a coincidence to be maintained by hand: the config says
    // "binaries/screepub-engine", relative to src-tauri.
    expect(parseSidecarArgs(['--host'], 'linux', 'arm64').outDir).toBe(BINARIES_DIR);
    expect(BINARIES_DIR.endsWith(join('desktop', 'src-tauri', 'binaries'))).toBe(true);
  });

  test('--out overrides it, so a test never writes into the repo', () => {
    expect(parseSidecarArgs(['--host', '--out', '/tmp/x'], 'linux', 'x64').outDir).toBe('/tmp/x');
  });
});

describe('sidecarPath', () => {
  test('is the output directory plus the triple-suffixed name', () => {
    const win = sidecarTargetFor('bun-windows-x64');
    const lin = sidecarTargetFor('bun-linux-arm64');
    expect(sidecarPath(win, '/out')).toBe('/out/screepub-engine-x86_64-pc-windows-msvc.exe');
    expect(sidecarPath(lin, '/out')).toBe('/out/screepub-engine-aarch64-unknown-linux-gnu');
  });

  test('no two targets land on the same path', () => {
    const paths = SIDECAR_TARGETS.map((t) => sidecarPath(t, '/out'));
    expect(new Set(paths).size).toBe(SIDECAR_TARGETS.length);
  });
});

describe('compileSidecarArgv', () => {
  test('compiles the engine entry point for the named target', () => {
    const argv = compileSidecarArgv(sidecarTargetFor('bun-linux-x64'), '/out');
    expect(argv.slice(0, 4)).toEqual(['bun', 'build', '--compile', '--target=bun-linux-x64']);
    expect(argv).toContain('src/cli.ts');
  });

  test('the outfile we PASS never carries .exe; bun appends it', () => {
    // The trap tools/build-cli.ts already hit: passing 'x.exe' produces
    // 'x.exe.exe'. Here it would produce a file Tauri never looks for.
    const win = sidecarTargetFor('bun-windows-x64');
    const outfile = compileSidecarArgv(win, '/out').find((a) => a.startsWith('--outfile='))!;
    expect(outfile.endsWith('.exe')).toBe(false);
    expect(outfile).toBe('--outfile=/out/screepub-engine-x86_64-pc-windows-msvc');
    // ...and the file we then expect on disk DOES.
    expect(sidecarPath(win, '/out').endsWith('.exe')).toBe(true);
  });
});

describe('buildSidecar', () => {
  test('reports the compiler’s own stderr when the compile fails', () => {
    const spawn: Spawn = () => ({ exitCode: 1, stderr: 'error: no such target' });
    expect(() => buildSidecar(sidecarTargetFor('bun-linux-x64'), tmpOut(), spawn)).toThrow(
      /no such target/,
    );
  });

  test('a compile that exits 0 without writing the file is still a failure', () => {
    // The mistake this catches: trusting the exit code. `bun build` can
    // succeed and write nothing where we expected it, and the app would
    // then open and fail at runtime with "sidecar not found" — the exact
    // failure this whole piece is arranged to prevent.
    const spawn: Spawn = () => ({ exitCode: 0, stderr: '' });
    expect(() => buildSidecar(sidecarTargetFor('bun-linux-x64'), tmpOut(), spawn)).toThrow(
      /screepub-engine-x86_64-unknown-linux-gnu/,
    );
  });

  test('returns the path it wrote, which is the path Tauri will look for', () => {
    const out = tmpOut();
    const target = sidecarTargetFor('bun-linux-x64');
    const spawn: Spawn = (argv) => {
      const outfile = argv.find((a) => a.startsWith('--outfile='))!.slice('--outfile='.length);
      writeFileSync(outfile + target.exeSuffix, 'x');
      return { exitCode: 0, stderr: '' };
    };
    expect(buildSidecar(target, out, spawn)).toBe(sidecarPath(target, out));
  });
});

describe('verifySidecar', () => {
  const elf = (machine: number, bytes: number): Uint8Array => {
    const b = new Uint8Array(bytes);
    b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
    new DataView(b.buffer).setUint16(0x12, machine, true);
    return b;
  };

  test('accepts a binary of the right format and size', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0x3e, 4096));
    expect(() => verifySidecar(t, out, 1024)).not.toThrow();
  });

  test('rejects a binary built for the wrong machine', () => {
    // The single failure a file-exists check cannot see, and the one that
    // silently ships: aarch64 bytes under the x86_64 name. This is why the
    // check reads the ELF e_machine field rather than stat()ing the path.
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0xb7, 4096));
    expect(() => verifySidecar(t, out, 1024)).toThrow(/elf-aarch64.*expected.*elf-x86-64/);
  });

  test('rejects a truncated write', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0x3e, 64));
    expect(() => verifySidecar(t, out, 1024)).toThrow(/under the 1024-byte floor/);
  });

  test('rejects a missing file, naming the exact path Tauri needs', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-darwin-arm64');
    expect(() => verifySidecar(t, out)).toThrow(new RegExp(sidecarFileName(t)));
  });

  test('the production floor is large enough to reject anything but a real build', () => {
    // A compiled engine embeds the whole Bun runtime: 64-119 MB. A floor of
    // a few kilobytes would pass a shell script named like a binary.
    expect(SIDECAR_FLOOR_BYTES).toBeGreaterThanOrEqual(20_000_000);
  });
});

describe('nothing large can be committed', () => {
  test('.gitignore covers the sidecar directory and the cargo target directory', () => {
    const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    for (const rule of ['desktop/src-tauri/binaries/', 'desktop/src-tauri/target/']) {
      expect(ignore).toContain(rule);
    }
  });

  test('git itself agrees, which the file contents alone do not prove', () => {
    // A rule can be present and still not match — a leading slash, a typo,
    // an earlier negation. Ask git, which is the thing that decides.
    mkdirSync(BINARIES_DIR, { recursive: true });
    const probe = join(BINARIES_DIR, 'screepub-engine-probe');
    writeFileSync(probe, 'probe');
    try {
      const proc = Bun.spawnSync(['git', 'check-ignore', '-q', probe], {
        cwd: new URL('..', import.meta.url).pathname,
      });
      expect(proc.exitCode).toBe(0); // 0 = ignored
    } finally {
      rmSync(probe, { force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/build-sidecar.test.ts`
Expected: FAIL — `tools/build-sidecar.ts` does not exist.

- [ ] **Step 3: Add the ignore rules**

Append to `.gitignore`, after the `app/build/` block:

```gitignore
# Desktop shell (piece C). The compiled engine sidecar is 64-119 MB per
# target and cargo's target/ is larger still; neither belongs in a repo.
# tests/build-sidecar.test.ts asks `git check-ignore` whether these actually
# match, because a rule that is present but wrong ignores nothing.
desktop/src-tauri/binaries/
desktop/src-tauri/target/
```

- [ ] **Step 4: Implement**

Create `tools/build-sidecar.ts`:

```ts
// Compile the Screepub engine and put it where the Tauri shell looks for it.
//
//   bun tools/build-sidecar.ts --host           # this machine, ~30s
//   bun tools/build-sidecar.ts --target bun-windows-x64
//   bun tools/build-sidecar.ts --all            # every target (~500 MB)
//
// This is a build input, not a release artifact: it produces no archive, no
// checksum and nothing that reaches a user. Release artifacts are
// tools/build-cli.ts's job, and the signed macOS CLI is app/release.sh's.
//
// The binary's NAME is the whole point. Tauri resolves a bundled external
// binary by name with the Rust target triple as a suffix — a rule verified
// by running a real build and a real app on this machine, recorded in
// desktop/README.md. Get it wrong and nothing fails until the window is
// open.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR, readBinaryFormat, type Spawn } from './build-cli';
import {
  SIDECAR_TARGETS,
  sidecarTargetFor,
  sidecarFileName,
  hostBunTarget,
  type BunTarget,
  type SidecarTarget,
} from './sidecar-targets';

/** Exactly the directory tauri.conf.json's `externalBin` points at. */
export const BINARIES_DIR = join(REPO_DIR, 'desktop', 'src-tauri', 'binaries');

/** A compiled engine embeds the whole Bun runtime: 64-119 MB. Anything an
 *  order of magnitude under that is a truncated write or a stub, not a
 *  lean build. Same reasoning, same order of magnitude, as
 *  build-cli.ts's RELEASE_FLOORS.binaryBytes. */
export const SIDECAR_FLOOR_BYTES = 20_000_000;

const realSpawn: Spawn = (argv, cwd) => {
  const proc = Bun.spawnSync(argv, { cwd, stdout: 'inherit', stderr: 'pipe' });
  return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
};

export interface SidecarArgs {
  targets: BunTarget[];
  outDir: string;
}

export function parseSidecarArgs(
  argv: string[],
  platform: string = process.platform,
  arch: string = process.arch,
): SidecarArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      target: { type: 'string', multiple: true },
      out: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const named = (values.target ?? [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  let targets: BunTarget[];
  if (values.all) {
    targets = SIDECAR_TARGETS.map((t) => t.bunTarget);
  } else if (named.length) {
    // sidecarTargetFor throws, by name, on anything unknown.
    targets = named.map((n) => sidecarTargetFor(n).bunTarget);
  } else if (values.host) {
    targets = [hostBunTarget(platform, arch)];
  } else {
    throw new Error(
      'build-sidecar: say which targets — --host, --target <bun-target> or --all. ' +
        'There is no default: --all costs five cross-compiles and about 500 MB, ' +
        'and --host would build the wrong machine’s binary in CI.',
    );
  }

  const outDir = values.out
    ? isAbsolute(values.out)
      ? values.out
      : resolve(values.out)
    : BINARIES_DIR;

  return { targets, outDir };
}

/** Where this target's sidecar must sit, under the name Tauri asks for. */
export function sidecarPath(target: SidecarTarget, outDir: string): string {
  return join(outDir, sidecarFileName(target));
}

/** The one invocation, as data, so it is asserted element by element.
 *  `--outfile` never carries `.exe`: bun appends it for the windows target
 *  and passing it would produce `...msvc.exe.exe`, which Tauri would not
 *  find. */
export function compileSidecarArgv(target: SidecarTarget, outDir: string): string[] {
  const full = sidecarPath(target, outDir);
  const bare = full.slice(0, full.length - target.exeSuffix.length);
  return [
    'bun',
    'build',
    '--compile',
    `--target=${target.bunTarget}`,
    'src/cli.ts',
    `--outfile=${bare}`,
  ];
}

/** Returns the path actually written. Checks that it exists rather than
 *  trusting the exit code: `bun build` can exit 0 and leave nothing where
 *  we expected it, and the only later symptom is a window that cannot find
 *  its engine. */
export function buildSidecar(
  target: SidecarTarget,
  outDir: string,
  spawn: Spawn = realSpawn,
  repoDir: string = REPO_DIR,
): string {
  mkdirSync(outDir, { recursive: true });
  const { exitCode, stderr } = spawn(compileSidecarArgv(target, outDir), repoDir);
  if (exitCode !== 0) {
    throw new Error(
      `build-sidecar: ${target.bunTarget} failed to compile (exit ${exitCode})\n${stderr.trim()}`,
    );
  }
  const path = sidecarPath(target, outDir);
  if (!existsSync(path)) {
    throw new Error(
      `build-sidecar: ${target.bunTarget} compiled but wrote nothing at ${path}. ` +
        `Tauri looks for exactly ${sidecarFileName(target)}; see desktop/README.md.`,
    );
  }
  return path;
}

/** Check what was PRODUCED. A mis-typed --target= exits 0 while producing a
 *  perfectly valid binary for the wrong machine, and a file-exists check
 *  cannot tell the difference. */
export function verifySidecar(
  target: SidecarTarget,
  outDir: string,
  floor: number = SIDECAR_FLOOR_BYTES,
): void {
  const path = sidecarPath(target, outDir);
  if (!existsSync(path)) {
    throw new Error(`build-sidecar: no sidecar at ${path} (expected ${sidecarFileName(target)})`);
  }
  const bytes = statSync(path).size;
  if (bytes < floor) {
    throw new Error(
      `build-sidecar: ${sidecarFileName(target)} is ${bytes} bytes, under the ${floor}-byte floor`,
    );
  }
  const format = readBinaryFormat(path);
  if (format !== target.format) {
    throw new Error(
      `build-sidecar: ${sidecarFileName(target)} is ${format}, expected ${target.format}`,
    );
  }
}

if (import.meta.main) {
  try {
    const { targets, outDir } = parseSidecarArgs(process.argv.slice(2));
    for (const bunTarget of targets) {
      const target = sidecarTargetFor(bunTarget);
      console.log(`building ${bunTarget} → ${sidecarFileName(target)}`);
      buildSidecar(target, outDir);
      verifySidecar(target, outDir);
      console.log(`  ok: ${sidecarPath(target, outDir)}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/build-sidecar.test.ts && bunx tsc --noEmit`
Expected: pass, `tsc` silent.

- [ ] **Step 6: Build the real host sidecar and delete the Task 1 stub**

```bash
rm -f desktop/src-tauri/binaries/screepub-engine
bun tools/build-sidecar.ts --host
ls -l desktop/src-tauri/binaries/
```
Expected: one file of 64–119 MB, named for this machine's triple. Compare its name against what `rustc -vV | sed -n 's/^host: //p'` prints.

- [ ] **Step 7: Prove nothing large is staged**

```bash
git status --short
git check-ignore -v desktop/src-tauri/binaries/*
```
Expected: `git status` shows only `.gitignore`, `tools/build-sidecar.ts` and `tests/build-sidecar.test.ts`; `check-ignore` names the rule that matched.

- [ ] **Step 8: Commit**

---

### Task 4: The Rust

Everything the shell does, in two files. It spawns the sidecar with an argv the frontend built, and hands back stdout. That is the whole brief.

**Every line here was compile-checked on this machine against `tauri` 2.11.5, `tauri-plugin-shell` 2.3.6 and `tauri-plugin-dialog` 2.7.3 while this plan was written**, including the `sidecar(...).args(...).output().await` chain, `DialogExt::blocking_pick_file`, `FilePath::into_path`, and `#[tauri::command]` with no direct `serde` dependency. If cargo disagrees, the versions moved; do not respond by adding `serde_json`.

**Files:**
- Replace: `desktop/src-tauri/src/main.rs` (the Task 1 probe)
- Create: `desktop/src-tauri/src/sidecar.rs`

**Interfaces:**
- Two `invoke` names, which `desktop/ui/app.js` calls in Task 5 and `tests/desktop-shell.test.ts` pins in Task 6:
  - `run_engine(args: string[]) -> string` — resolves to the engine's raw stdout; rejects with a plain-text message if it could not run.
  - `pick_file() -> string | null` — resolves to an absolute path, or `null` if the user cancelled.

- [ ] **Step 1: Write `sidecar.rs`**

```rust
//! Run the engine. That is all this file does.
//!
//! The engine is `src/cli.ts`, compiled by `tools/build-sidecar.ts` and
//! bundled as a Tauri external binary. Its `--json` contract is that every
//! exit prints exactly one parseable JSON object on stdout — on success and
//! on failure alike. So this file:
//!
//!   * does not parse that object (`serde_json` is not a dependency),
//!   * does not add or remove an argument (the frontend builds the argv),
//!   * does not treat a non-zero exit as a failure, because an engine error
//!     exits 1 *and prints a perfectly good error object*. Stdout is the
//!     contract; the exit code is not.
//!
//! The name below is resolved by Tauri against the bundled external binary;
//! `desktop/README.md` records how that resolution was observed working.

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Must match `SIDECAR_BASENAME` in `tools/sidecar-targets.ts`.
/// `tests/desktop-shell.test.ts` pins the two together.
pub const SIDECAR: &str = "screepub-engine";

pub async fn run(app: &AppHandle, args: Vec<String>) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| format!("could not find the Screepub engine: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("could not start the Screepub engine: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        // Nothing on stdout means the engine died before it could honour
        // its own contract. Its stderr is the only thing left to show.
        return Err(format!(
            "the Screepub engine exited with {:?} and printed nothing: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(stdout)
}
```

- [ ] **Step 2: Write `main.rs`**

```rust
// The Screepub desktop shell.
//
// A window, not a brain. Two commands: run the engine, and ask the OS for a
// file path. Neither makes a decision the engine could make. If a change to
// this file needs to know what a scene, a device or an EPUB is, the change
// belongs in `src/` (TypeScript) instead — see ADR 2026-09-12.

mod sidecar;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Run the engine with exactly the arguments the window supplied, and
/// resolve with exactly what it printed. The window parses it.
#[tauri::command]
async fn run_engine(app: AppHandle, args: Vec<String>) -> Result<String, String> {
    sidecar::run(&app, args).await
}

/// Ask the OS for a file. Returns `null` when the user cancels.
///
/// `blocking_pick_file` must not run on the main thread; an async command
/// runs on a worker, which is why this one is `async` despite awaiting
/// nothing.
#[tauri::command]
async fn pick_file(app: AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Screenplay", &["pdf", "fountain", "txt"])
        .blocking_pick_file()?;
    Some(picked.into_path().ok()?.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_engine, pick_file])
        .run(tauri::generate_context!())
        .expect("the Screepub window failed to start");
}
```

- [ ] **Step 3: Build**

Run: `cd desktop/src-tauri && cargo build 2>&1 | tail -20`
Expected: `Finished`. The dependency tree is already warm from Task 1, so this is seconds, not the 31.5s cold figure.

If `#[tauri::command]` demands a direct `serde` dependency, add `serde = { version = "1", features = ["derive"] }` — **`serde`, never `serde_json`.** The ban is on the ability to look inside the engine's answer, not on the ipc layer's own encoding. Task 6's test bans `serde_json` specifically, for this reason.

- [ ] **Step 4: Count what was written**

```bash
cd desktop/src-tauri && grep -vE '^\s*(//|//!|$)' src/*.rs | wc -l
```
Expected: comfortably under 100. Task 6 sets the ceiling at 200 to leave piece D a little room without leaving room for a brain.

- [ ] **Step 5: Commit**

---

### Task 5: The window

Three static files. `tauri-build` embeds them; there is no build step, no bundler and no npm package. Deliberately plain — **piece D replaces all three** with `brand/components/`, and anything designed here would be thrown away.

It does three things: on startup it asks the engine its version (which proves the sidecar resolves without needing a file), it picks a file and converts it, and it renders whichever half of the `--json` object came back.

**Files:**
- Replace: `desktop/ui/index.html` (the Task 1 stub)
- Create: `desktop/ui/app.js`, `desktop/ui/style.css`

**Interfaces:**
- Consumes `run_engine` and `pick_file` from Task 4.
- Consumes the engine's `--json` object from `src/cli.ts`: on success `{ ok: true, title, author, pages, scenes, characters, epubPath, fountainPath, warnings }`; on failure `{ ok: false, error: { code, message } }`; for `--version --json`, `{ ok: true, version }`.

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Screepub</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Screepub</h1>
      <p id="engine" class="muted">looking for the engine…</p>

      <button id="convert" type="button">Choose a screenplay…</button>

      <section id="result" hidden></section>
      <section id="failure" hidden></section>
    </main>
    <script src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `app.js`**

```js
// The window's whole share of the work: build an argv, hand it to Rust,
// parse what comes back, render it.
//
// The Rust does not know these flags and must not learn them. `--json` is
// this file's responsibility, and so is deciding what the answer means.
// See ADR 2026-09-12: Rust is a window, not a brain.

const invoke = window.__TAURI__.core.invoke;

const engineLine = document.getElementById('engine');
const convertButton = document.getElementById('convert');
const resultBox = document.getElementById('result');
const failureBox = document.getElementById('failure');

/** Run the engine and parse its one line of stdout.
 *  Throws an Error whose message is fit to show a person. */
async function engine(args) {
  let stdout;
  try {
    stdout = await invoke('run_engine', { args });
  } catch (message) {
    // Rust rejected: it could not find or start the binary at all.
    throw new Error(String(message));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // The engine printed something that is not its contract. Show it raw
    // rather than swallowing it — this is how a dropped --json presents.
    throw new Error(`the engine did not answer in JSON:\n${stdout}`);
  }
}

function show(box, html) {
  box.innerHTML = html;
  box.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

async function showEngineVersion() {
  try {
    const answer = await engine(['--version', '--json']);
    engineLine.textContent = `engine ${answer.version}`;
  } catch (err) {
    engineLine.textContent = err.message;
    engineLine.classList.add('bad');
  }
}

async function convert() {
  resultBox.hidden = true;
  failureBox.hidden = true;

  const path = await invoke('pick_file');
  if (!path) return; // cancelled

  convertButton.disabled = true;
  convertButton.textContent = 'Converting…';
  try {
    const answer = await engine([path, '--json']);
    if (answer.ok) {
      // Only the engine's own numbers. Nothing is computed here.
      show(
        resultBox,
        `<h2>${escapeHtml(answer.title)}</h2>` +
          (answer.author ? `<p>${escapeHtml(answer.author)}</p>` : '') +
          `<p>${escapeHtml(answer.pages)} pages · ${escapeHtml(answer.scenes)} scenes · ` +
          `${escapeHtml(answer.characters)} speaking characters</p>` +
          `<p class="path">${escapeHtml(answer.epubPath)}</p>` +
          (answer.warnings ?? [])
            .map((w) => `<p class="warning">${escapeHtml(w)}</p>`)
            .join(''),
      );
    } else {
      // The engine's own message, verbatim. Not reworded, not re-classified.
      show(
        failureBox,
        `<p class="bad">${escapeHtml(answer.error.message)}</p>` +
          `<p class="muted">${escapeHtml(answer.error.code)}</p>`,
      );
    }
  } catch (err) {
    show(failureBox, `<pre class="bad">${escapeHtml(err.message)}</pre>`);
  } finally {
    convertButton.disabled = false;
    convertButton.textContent = 'Choose a screenplay…';
  }
}

convertButton.addEventListener('click', convert);
showEngineVersion();
```

- [ ] **Step 3: `style.css`**

```css
/* Deliberately plain. Piece D replaces this file with brand/components/. */
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
h1 {
  font-size: 1.25rem;
  margin: 0 0 0.25rem;
}
h2 {
  font-size: 1.1rem;
  margin: 0 0 0.25rem;
}
button {
  font: inherit;
  padding: 0.6rem 1rem;
  margin: 1rem 0;
}
section {
  border-top: 1px solid currentColor;
  padding-top: 1rem;
  margin-top: 1rem;
}
.muted {
  opacity: 0.7;
}
.bad {
  color: #a11;
}
.warning {
  opacity: 0.8;
  font-size: 0.9rem;
}
.path,
pre {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-all;
}
```

- [ ] **Step 4: Build and glance at it**

Run: `cd desktop/src-tauri && cargo run`
Expected: a window headed "Screepub" whose second line reads `engine 0.5.4` — the version `package.json` currently names. If it reads an error instead, the sidecar is not where Task 1 said it must be; re-run `bun tools/build-sidecar.ts --host` before debugging anything else.

- [ ] **Step 5: Commit**

---

### Task 6: The guards that keep the brain out

The spec's fourth acceptance criterion — "no Rust code makes a decision the engine could make" — is the one a later task is most likely to erode, one reasonable-looking line at a time. These tests are what make that erosion fail out loud, and they are TypeScript so they cost nothing in `bun test`.

**On test strength, said plainly: no unit test is written for the Rust itself, and that is a judgement, not an omission.** `sidecar.rs` is a subprocess spawn and a string trim; a unit test for it would need a fake `AppHandle`, would assert that a spawn was spawned, and would pass against every wrong implementation that still spawned something. Its real proof is Task 7, where the app converts a real fixture and prints a real title. The tests below therefore assert the *shape* of the Rust — what it may not contain — which is exactly the property a plausible wrong implementation would violate and a mock could never catch.

**Files:**
- Test: `tests/desktop-shell.test.ts` (create)

**Interfaces:** none. This file only reads.

- [ ] **Step 1: Write the test**

```ts
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SIDECAR_BASENAME } from '../tools/sidecar-targets';

const REPO = new URL('..', import.meta.url).pathname;
const RUST_DIR = join(REPO, 'desktop', 'src-tauri', 'src');
const CARGO = readFileSync(join(REPO, 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8');
const CONFIG = JSON.parse(
  readFileSync(join(REPO, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);

const rustFiles = readdirSync(RUST_DIR).filter((f) => f.endsWith('.rs'));
const rustSources = rustFiles.map((f) => ({
  name: f,
  text: readFileSync(join(RUST_DIR, f), 'utf8'),
}));

/** Source with comments and blank lines removed — what a reviewer must read. */
function code(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));
}

describe('Rust is a window, not a brain', () => {
  test('the crate cannot parse the engine’s answer', () => {
    // THE load-bearing assertion of this whole piece. Without serde_json,
    // the engine's stdout is an opaque string on its way to the frontend,
    // and no amount of well-meant Rust can start branching on what is
    // inside it. `serde` itself is allowed: it is how the ipc layer encodes
    // arguments, and it cannot read an arbitrary JSON document.
    expect(CARGO).not.toMatch(/^\s*serde_json\s*=/m);
    for (const { name, text } of rustSources) {
      expect(`${name}: ${text}`).not.toContain('serde_json');
    }
  });

  test('the Rust knows no engine flag', () => {
    // The frontend builds the whole argv, --json included. A literal
    // starting with "--" in here would be the first piece of contract
    // knowledge to leak across the boundary.
    for (const { name, text } of rustSources) {
      const literals = text.match(/"(--[^"]*)"/g) ?? [];
      expect(`${name} contains flag literals: ${literals.join(', ')}`).toBe(
        `${name} contains flag literals: `,
      );
    }
  });

  test('the Rust knows nothing about screenplays or e-readers', () => {
    const banned = [
      'kindle', 'kobo', 'tolino', 'remarkable', 'calibre',
      'epub', 'mobi', 'azw3', 'kfx', 'fountain',
      'scene', 'screenplay', 'slug', 'dialogue', 'character',
    ];
    for (const { name, text } of rustSources) {
      const lower = text.toLowerCase();
      for (const word of banned) {
        expect(`${name} mentions ${word}: ${lower.includes(word)}`).toBe(
          `${name} mentions ${word}: false`,
        );
      }
    }
  });

  test('"pdf" appears only in the file dialog’s filter', () => {
    // The one domain word the Rust legitimately holds, because the OS file
    // picker needs an extension list and that is a window’s job. Anywhere
    // else it would mean the Rust had started deciding what a file is.
    for (const { name, text } of rustSources) {
      for (const line of text.split('\n')) {
        if (!line.toLowerCase().includes('pdf')) continue;
        expect(`${name}: ${line.trim()}`).toContain('add_filter');
      }
    }
  });

  test('a reviewer can read the whole thing in one sitting', () => {
    // The spec's acceptance criterion, as a number so it can fail. If a
    // change needs more than this, it is almost certainly logic that
    // belongs in src/.
    const lines = rustSources.flatMap(({ text }) => code(text));
    expect(lines.length).toBeLessThanOrEqual(200);
  });

  test('exactly two commands are registered', () => {
    // A third command is the shape every "just one small thing in Rust"
    // takes. Adding one is allowed — but it must be a deliberate edit to
    // this list, in a diff someone reviews.
    const main = rustSources.find((f) => f.name === 'main.rs')!.text;
    const handler = main.match(/generate_handler!\[([^\]]*)\]/);
    expect(handler).not.toBeNull();
    const registered = handler![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(registered.sort()).toEqual(['pick_file', 'run_engine']);
  });

  test('the Rust ignores the exit code and reads stdout', () => {
    // `--json` errors exit 1 while printing a valid error object. A shell
    // that failed on a non-zero status would turn every not-a-screenplay
    // into "the engine crashed", which is acceptance criterion 3 broken.
    const sidecar = rustSources.find((f) => f.name === 'sidecar.rs')!.text;
    expect(sidecar).toContain('output.stdout');
    expect(sidecar).not.toMatch(/status\s*\.\s*success\s*\(\)/);
  });
});

describe('the sidecar name is agreed on both sides', () => {
  test('the Rust asks for the basename the build tool writes', () => {
    // Two languages, one string. They cannot be checked by the compiler,
    // so they are checked here. A mismatch is a runtime "not found" in a
    // window — the exact failure Task 1 was arranged to prevent.
    const sidecar = rustSources.find((f) => f.name === 'sidecar.rs')!.text;
    expect(sidecar).toContain(`"${SIDECAR_BASENAME}"`);
  });

  test('tauri.conf.json points externalBin at the same basename', () => {
    expect(CONFIG.bundle.externalBin).toEqual([`binaries/${SIDECAR_BASENAME}`]);
  });
});

describe('the window is granted no more than it needs', () => {
  test('the frontend holds no plugin permission', () => {
    // The shell and dialog plugins are called only from Rust. If the
    // frontend ever gains `shell:allow-execute`, the window can spawn
    // arbitrary processes and the sidecar boundary stops meaning anything.
    const cap = JSON.parse(
      readFileSync(join(REPO, 'desktop', 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    );
    expect(cap.permissions).toEqual(['core:default']);
  });

  test('the identifier does not collide with the Swift app’s', () => {
    // app/Sources/KitCheck/main.swift pins com.darkwell.screepub to the
    // Swift app's code signature, and both apps exist at once until piece F.
    expect(CONFIG.identifier).toBe('com.darkwell.screepub.desktop');
    expect(CONFIG.identifier).not.toBe('com.darkwell.screepub');
  });

  test('the frontend is static files, not a dev server', () => {
    // A `devUrl` or a `beforeDevCommand` would reintroduce the npm
    // toolchain this piece deliberately does without.
    expect(CONFIG.build.frontendDist).toBe('../ui');
    expect(CONFIG.build.devUrl).toBeUndefined();
    expect(CONFIG.build.beforeDevCommand).toBeUndefined();
  });
});

describe('the frontend owns the contract', () => {
  const APP_JS = readFileSync(join(REPO, 'desktop', 'ui', 'app.js'), 'utf8');

  test('it passes --json itself, because the Rust will not', () => {
    expect(APP_JS).toContain("'--json'");
  });

  test('it parses the engine’s answer', () => {
    expect(APP_JS).toContain('JSON.parse');
  });

  test('it invokes only the two commands that exist', () => {
    const names = [...APP_JS.matchAll(/invoke\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual(['pick_file', 'run_engine']);
  });
});

describe('nothing under app/ or src/ was drawn into this', () => {
  test('no Rust file references the Swift app or the engine sources', () => {
    for (const { name, text } of rustSources) {
      expect(`${name} reaches outside desktop/: ${/\.\.\/\.\.\/(app|src)\b/.test(text)}`).toBe(
        `${name} reaches outside desktop/: false`,
      );
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test tests/desktop-shell.test.ts`
Expected: pass. If the line-count guard fails, the fix is to move code into `src/`, not to raise the ceiling.

- [ ] **Step 3: Confirm the whole suite is unaffected and still fast**

Run: `time bun test`
Expected: green, and the wall-clock time within noise of the pre-task figure. Nothing here invokes cargo.

- [ ] **Step 4: Commit**

---

### Task 7: Build it, run it, convert a real fixture

The acceptance evidence. The spec is explicit that for Rust this thin, running it is worth more than mocking it — so this task is done by hand, at a keyboard, and its output is recorded.

**Files:** none created or modified. This task produces observations.

**Interfaces:** none.

- [ ] **Step 1: Build from cold, and time it**

```bash
rm -rf desktop/src-tauri/target
bun tools/build-sidecar.ts --host
cd desktop/src-tauri && time cargo build
```
Record the time. It belongs in `desktop/README.md` so the next person knows whether their four-minute wait is normal. (Spec acceptance criterion 1.)

- [ ] **Step 2: Convert the happy-path fixture**

`cargo run`, then click through to `tests/fixtures/screenplay.pdf`.

Expected: the window shows the fixture's title, and page / scene / character counts. **Cross-check every number against the engine run directly**, which is the only way to know the window is showing the engine's answer rather than something it made up:

```bash
bun src/cli.ts tests/fixtures/screenplay.pdf --json -o /tmp/screepub-check.epub | bun -e \
  'const j = JSON.parse(await Bun.stdin.text()); console.log(j.title, j.pages, j.scenes, j.characters);'
```
The two must agree exactly. (Spec acceptance criterion 2.)

Note that `screenplay.pdf` is an **invented, committed** fixture, so its title is safe to put in a commit message or a screenshot. A real script from root `/fixtures/` is not: never let a real title, author or character name reach an assertion, a doc or a screenshot.

- [ ] **Step 3: Convert the not-a-screenplay fixture**

Same window, choose `tests/fixtures/prose.pdf`.

Expected: the engine's own `not-screenplay` message, rendered as text. Not a crash, not a blank pane, not a reworded message. Compare it word-for-word with:

```bash
bun src/cli.ts tests/fixtures/prose.pdf --json 2>/dev/null | bun -e \
  'const j = JSON.parse(await Bun.stdin.text()); console.log(j.error.code, "|", j.error.message);'
```
(Spec acceptance criterion 3.)

- [ ] **Step 4: See the missing-sidecar failure on purpose**

```bash
mv desktop/src-tauri/binaries desktop/src-tauri/binaries.off
cd desktop/src-tauri && cargo run
```
Expected: the window opens and the engine line shows "could not find the Screepub engine: …". A window that opens and then fails legibly is the whole reason the sidecar spawn is wrapped in a `Result` rather than an `expect`.

Then: `mv desktop/src-tauri/binaries.off desktop/src-tauri/binaries`

- [ ] **Step 5: Record the timings and the screenshots**

Add the cold-build time to `desktop/README.md`. If a screenshot is taken, it must show only the committed fixture.

- [ ] **Step 6: Confirm nothing leaked**

```bash
git status --short
du -sh desktop/src-tauri/target desktop/src-tauri/binaries
git status --short app/ src/
```
Expected: `git status` clean apart from `desktop/README.md`; the two large directories exist and are untracked; nothing under `app/` or `src/`.

---

### Task 8: CI compiles it on three platforms, and the README says so

The spec is explicit that macOS and Windows "ride on CI building them." This task is that sentence, discharged — and nothing more. It compiles; it does not bundle, sign, install or run. Those are piece E2.

A separate workflow rather than a job in `ci.yml`, for one reason: `ci.yml`'s engine job is the fast feedback loop and a cargo build is minutes. Keeping them apart means a Rust regression never slows a parser change.

**Files:**
- Create: `.github/workflows/desktop.yml`
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Write the workflow**

```yaml
# The desktop shell compiles on all three platforms. It does NOT bundle,
# sign, install or run here -- that is piece E2. Nobody on this project has
# a Windows machine and the Mac is elsewhere, so these two jobs are the only
# evidence that exists that the shell builds there at all. Compiling is not
# running, and this workflow does not claim otherwise.
#
# Separate from ci.yml on purpose: that workflow is the engine's fast loop,
# and a cargo build is minutes. A parser change should never wait on Rust.
name: desktop
on:
  push:
    paths: ['desktop/**', 'tools/build-sidecar.ts', 'tools/sidecar-targets.ts', '.github/workflows/desktop.yml']
  pull_request:
    paths: ['desktop/**', 'tools/build-sidecar.ts', 'tools/sidecar-targets.ts', '.github/workflows/desktop.yml']
permissions:
  contents: read
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-15, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14
      # webkit2gtk, soup3 and their pkg-config files. The Rust crates fail at
      # BUILD time when these are missing, so their absence is loud.
      - name: Linux webview libraries
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            desktop/src-tauri/target
          key: cargo-${{ matrix.os }}-${{ hashFiles('desktop/src-tauri/Cargo.lock') }}
      - run: bun install --frozen-lockfile
      # tauri-build needs the sidecar present, under the host's own triple.
      # --host is the fast path: one target, not five.
      - name: Build the engine sidecar for this runner
        run: bun tools/build-sidecar.ts --host
      - name: Compile the shell
        working-directory: desktop/src-tauri
        run: cargo build --locked
```

- [ ] **Step 2: Confirm the job graph parses and says what it should**

Append to `tests/desktop-shell.test.ts`:

```ts
describe('the desktop workflow', () => {
  const WF = Bun.YAML.parse(
    readFileSync(join(REPO, '.github', 'workflows', 'desktop.yml'), 'utf8'),
  ) as {
    on: { push: { paths: string[] } };
    jobs: Record<string, { strategy?: { matrix?: { os?: string[] } }; steps: { run?: string }[] }>;
  };

  test('compiles on all three platforms', () => {
    // The spec's stated position is that macOS and Windows "ride on CI
    // building them". If this matrix quietly became ubuntu-only, that
    // sentence would be false and nothing else would notice.
    expect(WF.jobs.build.strategy?.matrix?.os).toEqual([
      'ubuntu-latest',
      'macos-15',
      'windows-latest',
    ]);
  });

  test('the sidecar is built before the shell is compiled', () => {
    // tauri-build needs it present. Reversed, every job fails with the
    // confusing not-found this piece exists to eliminate.
    const runs = WF.jobs.build.steps.map((s) => s.run ?? '');
    const sidecar = runs.findIndex((r) => r.includes('build-sidecar.ts'));
    const cargo = runs.findIndex((r) => r.includes('cargo build'));
    expect(sidecar).toBeGreaterThanOrEqual(0);
    expect(cargo).toBeGreaterThan(sidecar);
  });

  test('it does not bundle, sign or run anything', () => {
    // Scope guard. Bundling is piece E2; a `tauri build` appearing here
    // would mean C had grown an installer nobody reviewed.
    const all = JSON.stringify(WF);
    expect(all).not.toContain('tauri build');
    expect(all).not.toContain('codesign');
    expect(all).not.toContain('appimage');
  });

  test('it is path-filtered, so a parser change never waits on three cargo builds', () => {
    // Vacuous alternatives rejected: asserting the `on` key merely exists
    // would pass for a workflow that runs on every push, which is the thing
    // this test is for. Assert the filter itself.
    const triggers = (WF as unknown as { on: { push: { paths: string[] } } }).on;
    expect(triggers.push.paths).toContain('desktop/**');
    expect(triggers.push.paths).not.toContain('src/**');
  });
});
```

Run: `bun test tests/desktop-shell.test.ts`
Expected: pass.

- [ ] **Step 3: README**

Add one short section to the root `README.md`, after the existing install material:

```markdown
### Desktop app (in progress)

A cross-platform window is being built in `desktop/`, on Tauri, around this
same engine — the app spawns the CLI binary and renders its `--json` answer,
so there is exactly one implementation of everything that thinks. It builds
and runs on Linux today; macOS and Windows compile in CI but have not been
run. Installers are not built yet. Build instructions: [`desktop/README.md`](desktop/README.md).

The macOS app in `app/` is the shipping one until that work lands.
```

- [ ] **Step 4: Commit**

---

## Final Verification

The spec's five acceptance criteria, as checkable steps.

- [ ] **1. `desktop/` builds with `cargo build` on this machine**

```bash
bun tools/build-sidecar.ts --host
cd desktop/src-tauri && cargo build --locked && echo "exit=$?"
```
Expected: `Finished`, exit 0. Record the warm and cold times in `desktop/README.md`.

- [ ] **2. The app converts `tests/fixtures/screenplay.pdf` through the bundled sidecar and shows the engine's real numbers**

Run `cargo run`, choose the fixture, and compare every displayed number against a direct engine run (Task 7 Step 2). They must agree exactly. A window that showed plausible numbers it invented would pass a screenshot and fail this.

- [ ] **3. An engine error surfaces as the engine's own message**

Run `cargo run`, choose `tests/fixtures/prose.pdf`. Expected: the `not-screenplay` message, word-for-word as the engine printed it, in the window. Not a crash, not a blank pane. Then repeat with the sidecar directory renamed away (Task 7 Step 4) and confirm the window still opens and still explains itself.

- [ ] **4. No Rust makes a decision the engine could make**

```bash
bun test tests/desktop-shell.test.ts
cd desktop/src-tauri && grep -vE '^\s*(//|//!|$)' src/*.rs | wc -l
grep -n 'serde_json' desktop/src-tauri/Cargo.toml desktop/src-tauri/src/*.rs ; echo "grep exit=$?"
```
Expected: tests pass; the line count well under 200; the `grep` prints nothing and exits 1.

Then read all of `desktop/src-tauri/src/` end to end. That is the acceptance criterion, and no test replaces it. Ask of every line: could the engine have answered this? If yes, it is in the wrong language.

- [ ] **5. Nothing under `app/` is modified; the suite is green and `tsc` clean**

```bash
git diff --stat main -- app/ src/ tools/build-cli.ts package.json
bun test
bunx tsc --noEmit
git status --short app/
```
Expected: the first prints nothing; the suite passes with the pre-existing count plus the new tests, 3 skipped as before; `tsc` silent; `git status` empty.

- [ ] **6. No binary escaped into the repository**

```bash
git status --short
git check-ignore -v desktop/src-tauri/binaries/* desktop/src-tauri/target
find . -name 'screepub-engine-*' -not -path './.git/*' -exec ls -lh {} \;
du -sh .git
```
Expected: `git status` shows only source files; `check-ignore` names a matching rule for each path; the `find` lists large files that `git status` did *not* mention; `.git` has not grown by hundreds of megabytes.

- [ ] **7. The observation from Task 1 is written down, not paraphrased**

Read `desktop/README.md`'s "How Tauri finds the engine" section. It must name the exact filename, say whether the rule is enforced at build or run time, and quote the verbatim error a wrong name produces. If it reads like a summary of Tauri's documentation, the experiment was not actually run and Task 1 should be redone — the next person's alternative is to rediscover it through a window that does nothing.

## What piece D inherits

Recorded here so D does not have to re-derive it:

- `run_engine(args)` takes a whole argv and returns raw stdout. `screepub devices --json` and `screepub send <file> --device <id> --json` work through it unchanged; no Rust needs to be written for the device flow.
- `--progress` writes NDJSON to **stderr**, which this piece discards. Live progress needs the Rust to stream stderr as a Tauri event — the one addition to the shell that D can justify, and it still parses nothing.
- `desktop/ui/` is three files and is meant to be replaced wholesale by `brand/components/`. The seven colour tokens pinned to `Theme.swift` are already in `brand/tokens.css`.
- The line-count ceiling in `tests/desktop-shell.test.ts` is 200 against roughly 80 written. That headroom is for the stderr stream and a window-state command, not for a second brain.
