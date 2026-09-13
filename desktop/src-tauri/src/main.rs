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
