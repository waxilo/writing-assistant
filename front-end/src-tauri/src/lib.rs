// The web frontend talks to the backend with the webview's native fetch, so
// no custom commands or plugins are needed. Keep this file minimal.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
