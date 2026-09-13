// swappable slot for the webview facing AppHandle used by the audio engine's two actor threads
// (worker.rs's PlaybackStateSync, player.rs's PlayerStateSync)
// to emit "audio://event" / "player://event" to the frontend
//
// this exists (rather than each actor just owning an AppHandle from construction) 
// because on android those actors can be cold started by android_auto's jni bridge before any AppHandle exists
// (MainActivity/tauri's own App never ran) =>
// the actor threads have to be constructible with no handle yet,
// and start emitting to the webview the moment one shows up,
// without restarting the thread or losing in flight playback state
//
// a plain 'static OnceLock' (not Arc<OnceLock<..>>) is enough here:
// this is process wide singleton state exactly like jni_bridge's own DATABASE
use std::sync::OnceLock;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// called once real app is up
/// desktop: immediately in .setup()
/// android: also in .setup(), which may run after the audio engine was already cold started and is mid playback
pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// none before the real app has started
/// (e.g. android cold start, webview not up yet) =>
/// callers should treat that as "skip the UI notification"
pub fn get_app_handle() -> Option<tauri::AppHandle> {
    APP_HANDLE.get().cloned()
}