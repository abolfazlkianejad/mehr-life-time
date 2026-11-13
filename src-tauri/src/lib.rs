use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The frontend is a fully offline-first web app persisted in
            // IndexedDB; no native commands or plugins are exposed.
            if let Some(window) = app.get_webview_window("main") {
                // Keep the title stable regardless of <title> changes so the
                // taskbar and window chrome always show the product name.
                let _ = window.set_title("Mehr Life OS");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mehr Life OS")
}
