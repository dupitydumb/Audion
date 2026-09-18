// log file access + export commands
//
// the active log directory is set once, at startup,
// by whichever init_logging variant runs for the current platform (see lib.rs)
// desktop knows its log dir immediately;
// mobile only learns its real, writable app-data dir once Tauri's .setup() hook runs
use std::path::PathBuf;
use std::sync::OnceLock;

pub static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Find the most recently written `audion.log*` file in the active log dir.
/// The rolling appender names files `audion.log.YYYY-MM-DD`, so "most
/// recently modified" is equivalent to "today's file" without us having to
/// duplicate the appender's own date-formatting logic.
fn current_log_file() -> Result<PathBuf, String> {
    let dir = LOG_DIR
        .get()
        .ok_or_else(|| "Log directory not initialized yet".to_string())?;

    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    entries
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .file_name()
                .map(|n| n.to_string_lossy().starts_with("audion.log"))
                .unwrap_or(false)
        })
        .max_by_key(|entry| {
            entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        })
        .map(|entry| entry.path())
        .ok_or_else(|| "No log file found yet".to_string())
}

/// path of the currently active log file, for display in settings
#[tauri::command]
pub async fn get_log_file_path() -> Result<String, String> {
    current_log_file().map(|p| p.to_string_lossy().into_owned())
}

/// copy the currently active log file to dest_path
///
/// on desktop dest_path is the real filesystem destination chosen via the save dialog
/// on android it's a temp path in the app cache dir;
/// the frontend copies from there into the user-picked 'content://' URI via commitAndroidSave afterwards (mirrors export_playlist_zip)
#[tauri::command]
pub async fn export_log_file(dest_path: String) -> Result<(), String> {
    let src = current_log_file()?;
    std::fs::copy(&src, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// forward a webview 'console.*' call into the same tracing pipeline as the backend,
/// so a single exported file has both side's logs
/// tagged with 'target: "webview"' to make the origin obvious
#[tauri::command]
pub async fn log_from_frontend(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target: "webview", "{}", message),
        "warn" => tracing::warn!(target: "webview", "{}", message),
        "debug" => tracing::debug!(target: "webview", "{}", message),
        _ => tracing::info!(target: "webview", "{}", message),
    }
}