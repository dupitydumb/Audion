// Playlist-related Tauri commands
use crate::db::queries;
use tauri::State;

#[tauri::command]
pub async fn create_playlist(
    name: String,
    cover_url: Option<String>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<i64, String> {
    let provider = sync_state.active_provider();
    provider.create_playlist(&name, cover_url.as_deref()).await
}

#[tauri::command]
pub async fn get_playlists(
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::Playlist>, String> {
    let provider = sync_state.active_provider();
    provider.get_playlists().await
}

#[tauri::command]
pub async fn get_playlist_tracks(
    playlist_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::Track>, String> {
    let provider = sync_state.active_provider();
    provider.get_playlist_tracks(playlist_id).await
}

#[tauri::command]
pub async fn get_playlist_track_counts(
    playlist_ids: Vec<i64>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<std::collections::HashMap<i64, i64>, String> {
    let provider = sync_state.active_provider();
    provider.get_playlist_track_counts(&playlist_ids).await
}

#[tauri::command]
pub async fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.add_track_to_playlist(playlist_id, track_id).await
}

#[tauri::command]
pub async fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.remove_track_from_playlist(playlist_id, track_id).await
}

#[tauri::command]
pub async fn delete_playlist(
    playlist_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.delete_playlist(playlist_id).await
}

#[tauri::command]
pub async fn rename_playlist(
    playlist_id: i64,
    new_name: String,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.rename_playlist(playlist_id, &new_name).await
}

#[tauri::command]
pub async fn update_playlist_cover(
    playlist_id: i64,
    cover_url: Option<String>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.update_playlist_cover(playlist_id, cover_url.as_deref()).await
}

#[tauri::command]
pub async fn export_playlist_zip(
    playlist_id: i64,
    dest_path: String,
    db: tauri::State<'_, crate::db::Database>,
) -> Result<serde_json::Value, String> {
    let dest = std::path::PathBuf::from(dest_path);
    // clone arc => spawn_blocking takes ownership
    // mutex is only locked inside the task for phase 1 (metadata load), then released before file I/O
    let conn_arc = db.conn.clone();

    let summary = tokio::task::spawn_blocking(move || {
        let conn = conn_arc.lock().map_err(|e| e.to_string())?;
        crate::commands::export::build_playlist_zip(&conn, playlist_id, &dest)
    })
    .await
    .map_err(|e| format!("Export task panicked: {e}"))??;

    Ok(serde_json::json!({
        "track_count": summary.track_count,
        "skipped_count": summary.skipped_count,
    }))
}

#[tauri::command]
pub async fn reorder_playlist_tracks(
    playlist_id: i64,
    from_index: i64,
    to_index: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.reorder_playlist_tracks(playlist_id, from_index, to_index).await
}
