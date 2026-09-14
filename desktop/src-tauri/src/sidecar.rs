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
//! It hands back BYTES rather than a `String`, and that is a transport fix,
//! not a change of contract — the bytes are the same stdout, undecoded.
//! Tauri routes an IPC answer one of two ways (`tauri-2.11.5/src/ipc/
//! protocol.rs:373-407`): a raw body goes down the channel, while a JSON
//! body does only when it starts with `{` or `[`. A Rust `String` serialises
//! as `"…"`, so it fell to `responder_eval` — the whole answer injected into
//! WebKitGTK as a JS string literal — which above roughly 400 KB arrives
//! TRUNCATED, nondeterministically: measured here, a 384 KB answer came back
//! whole twice and short twice in one session. A raw body takes the channel
//! and arrives intact. `desktop/ui/app.js` decodes it; nothing in this file
//! looks at what it decoded to.
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

pub async fn run(app: &AppHandle, args: Vec<String>) -> Result<Vec<u8>, String> {
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
                diagnostics.push_str(&line);
            }
            CommandEvent::Terminated(status) => exit = status.code,
            _ => {}
        }
    }

    // Trimmed first, then handed over as bytes: `into_bytes` is the String's
    // own buffer, so this costs no copy and reads nothing.
    let stdout = stdout.trim().to_string().into_bytes();
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
