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
