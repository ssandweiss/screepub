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

The sidecar must exist before the app starts — on this toolchain it must
exist before `cargo build` even *compiles*, see below.

## How Tauri finds the engine (observed 2026-09-13, on aarch64-unknown-linux-gnu)

This section is a transcript, not a summary. Tauri 2.11.5 /
tauri-build 2.4.x / tauri-plugin-shell 2.3.6, rustc 1.98.1, Linux.

**The requirement is enforced at BUILD time, by the build script, and the
error names the exact file it wanted.** With `"externalBin":
["binaries/screepub-engine"]` in `tauri.conf.json` and an unsuffixed stub
at `desktop/src-tauri/binaries/screepub-engine`, `cargo build` failed:

    error: failed to run custom build command for `screepub-desktop v0.6.0 (.../desktop/src-tauri)`

    Caused by:
      process didn't exit successfully: `.../target/debug/build/screepub-desktop-c47a0d512ab3847e/build-script-build` (exit status: 1)
      --- stdout
      ...
      cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE=aarch64-unknown-linux-gnu
      resource path `binaries/screepub-engine-aarch64-unknown-linux-gnu` doesn't exist

So: the config value is a **prefix**, and the file on disk must carry
`-` + the triple `rustc -vV` reports as `host:` — here
`screepub-engine-aarch64-unknown-linux-gnu` — and it must sit at a path
resolved **relative to the directory containing `tauri.conf.json`**
(`desktop/src-tauri/binaries/`). Renaming the stub to that exact name made
the build pass with no further complaint.

**A second build-time failure is unrelated to the sidecar but happens in the
same breath**, so it is recorded here. Without `desktop/src-tauri/icons/icon.png`
the `generate_context!` macro panics at compile time:

    error: proc macro panicked
      --> src/main.rs:40:14
       |
    40 |         .run(tauri::generate_context!())
       |              ^^^^^^^^^^^^^^^^^^^^^^^^^^
       |
       = help: message: failed to open icon .../desktop/src-tauri/icons/icon.png: No such file or directory (os error 2)

Fixed by `rsvg-convert -w 512 -h 512 assets/icon.svg -o
desktop/src-tauri/icons/icon.png` plus `"icon": ["icons/icon.png"]` in the
`bundle` object. A plain `cargo build` needs an icon; this is not only a
bundling concern.

**After a successful build the file appears beside the app binary, with the
triple STRIPPED OFF:**

    $ ls -l target/debug/ | grep -i screepub-engine
    -rwxr-xr-x 1 sandywho sandywho        52 Sep 13 15:44 screepub-engine

**The running app looks next to its own executable and asks for the stripped
name.** The probe (`desktop/src-tauri/src/main.rs` as it stood in Task 1)
printed:

    PROBE exe = .../desktop/src-tauri/target/debug/screepub-desktop
    PROBE looking beside the app, in .../desktop/src-tauri/target/debug
    PROBE   found: screepub-engine
    PROBE sidecar("screepub-engine") ran; stdout = {"ok":true,"version":"stub-probe"}

Two names, therefore, and they are different: **on disk in `binaries/` it is
suffixed; in `sidecar("…")` it is not.** Passing the suffixed name to
`sidecar()` fails — observed directly:

    // sidecar("screepub-engine-aarch64-unknown-linux-gnu")
    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

Deleting `target/debug/screepub-engine` while `binaries/` still held the
suffixed original gave the same failure, which confirms the *running* app
reads the copy beside the executable and never looks in `binaries/`:

    PROBE looking beside the app, in .../desktop/src-tauri/target/debug
    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

### The failure text to search for

**`sidecar()` does not fail on a wrong name.** With the name deliberately
misspelled as `screepub-engin`, `handle.shell().sidecar(...)` still returned
`Ok` — it only builds a command — and the failure surfaced later, from
`.output()`, as an OS error that names nothing at all:

    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

That is the entire message: no filename, no path, no mention of "sidecar".
It is identical to the message you get when the sidecar was simply never
built. Any Rust that spawns the sidecar must therefore add its own context
(the name it asked for, and "run `bun tools/build-sidecar.ts --host`") before
this string reaches the window, or the only clue a maintainer gets is
`os error 2`.
