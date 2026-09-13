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
        .map_err(|e| {
            format!(
                "could not find the Screepub engine (looked for a sidecar named {SIDECAR:?}): {e}. \
                 Run `bun tools/build-sidecar.ts --host` to build it."
            )
        })?
        .args(args)
        .output()
        .await
        .map_err(|e| {
            format!(
                "could not start the Screepub engine (sidecar {SIDECAR:?}): {e}. \
                 Run `bun tools/build-sidecar.ts --host` to build it."
            )
        })?;

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
