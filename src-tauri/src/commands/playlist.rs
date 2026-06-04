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
pub async fn reorder_playlist_tracks(
    playlist_id: i64,
    from_index: i64,
    to_index: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.reorder_playlist_tracks(playlist_id, from_index, to_index).await
}
