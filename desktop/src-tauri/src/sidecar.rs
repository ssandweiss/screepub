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
//! It spawns rather than waits, for ONE reason: the engine writes a line to
//! its diagnostic stream as it works, and a window that only gets the answer
//! at the end cannot draw a moving bar. Each such line is forwarded verbatim
//! under one name. This file never looks inside a line. If a change here
//! needs to know what a line MEANS, the change belongs in `desktop/ui/`.
//!
//! This is deliberately NOT a third command: the two registered commands are
//! unchanged, and the window is granted no new permission.
//!
//! The name below is resolved by Tauri against the bundled external binary;
//! `desktop/README.md` records how that resolution was observed working.

use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Must match `SIDECAR_BASENAME` in `tools/sidecar-targets.ts`.
/// `tests/desktop-shell.test.ts` pins the two together.
pub const SIDECAR: &str = "screepub-engine";

/// Every line the engine writes to its diagnostic stream is forwarded under
/// this name, uninspected. The window decides what a line is.
pub const LINE_EVENT: &str = "engine-line";

pub async fn run(app: &AppHandle, args: Vec<String>) -> Result<String, String> {
    // Nothing here kills the engine if the app quits while this call is
    // running: the engine finishes its work in the background. Deliberate,
    // and approved by the owner on 2026-09-24 after a code review. Killing
    // it mid-write could leave a half-written book or a half-installed
    // Calibre plugin; letting it finish is the safer failure, and every
    // file the engine writes goes to a temporary file first and is renamed
    // into place.
    let (mut rx, _child) = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| {
            format!(
                "could not find the Screepub engine (looked for a sidecar named {SIDECAR:?}): {e}. \
                 Run `bun tools/build-sidecar.ts --host` to build it."
            )
        })?
        .args(args)
        .spawn()
        .map_err(|e| {
            format!(
                "could not start the Screepub engine (sidecar {SIDECAR:?}): {e}. \
                 Run `bun tools/build-sidecar.ts --host` to build it."
            )
        })?;

    let mut stdout = String::new();
    let mut diagnostics = String::new();
    let mut exit: Option<i32> = None;
    // Each event carries ONE line, newline included (the shell plugin's
    // reader keeps the delimiter — verified live, see desktop/README.md).
    // So concatenation alone reassembles each stream byte for byte, and a
    // multi-line answer arrives whole rather than run together.
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => stdout.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                // Ignoring the result on purpose: a window that has gone
                // away must not turn into an engine failure.
                let _ = app.emit(LINE_EVENT, line.clone());
                // Kept in full, unbounded on purpose. The engine's stderr is
                // progress lines and notes — about 100 short lines on the
                // longest `--progress` run, so a few KB — and it lives only
                // for this one call. A cap would have to choose between the
                // head and the tail of a crash report, and the tail is what
                // the empty-stdout branch below needs. If the engine ever
                // learns to stream something per-scene, cap it then.
                diagnostics.push_str(&line);
            }
            CommandEvent::Terminated(status) => exit = status.code,
            _ => {}
        }
    }

    let stdout = stdout.trim().to_string();
    if stdout.is_empty() {
        // Nothing on stdout means the engine died before it could honour
        // its own contract. What it said on the way down is all that is left.
        return Err(format!(
            "the Screepub engine exited with {exit:?} and printed nothing: {}",
            diagnostics.trim()
        ));
    }
    Ok(stdout)
}
