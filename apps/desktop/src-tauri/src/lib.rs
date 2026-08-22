//! The desktop shell.
//!
//! Deliberately thin: every feature lives in the shared TypeScript core, and this
//! process exists to give that core a real filesystem, native dialogs and a window.
//! Anything added here would have to be reimplemented for the web and the extension.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Iconotype");
}
