use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Runtime,
};

/// Opens an external link in the system browser, never inside the WebView.
fn open_external(url: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the launcher from flashing a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("explorer.exe")
            .arg(url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

/// Navigation guard: the WebView may only stay on app origins. Any other
/// http(s) destination is handed to the system browser and the navigation is
/// cancelled; everything else (unknown schemes, file URLs, …) is denied.
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let scheme = url.scheme();
            if matches!(
                scheme,
                "tauri" | "asset" | "customprotocol" | "ipc" | "about" | "blob" | "data"
            ) {
                return true;
            }
            if scheme == "http" || scheme == "https" {
                let host = url.host_str().unwrap_or("");
                if matches!(
                    host,
                    "localhost"
                        | "127.0.0.1"
                        | "[::1]"
                        | "::1"
                        | "tauri.localhost"
                        | "ipc.localhost"
                        | "asset.localhost"
                ) {
                    return true;
                }
                open_external(url.as_str());
            }
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Keep the title stable regardless of <title> changes so the
                // taskbar and window chrome always show the product name.
                let _ = window.set_title("Mehr Life OS");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mehr Life OS")
        // No background process hooks: the app starts with only its window.
        .run(|_, _| {});
}
