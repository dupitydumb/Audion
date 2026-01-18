// Playlist-related Tauri commands
use crate::db::{queries, Database};
use tauri::State;

#[tauri::command]
pub async fn create_playlist(name: String, db: State<'_, Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::create_playlist(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_playlists(db: State<'_, Database>) -> Result<Vec<queries::Playlist>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_all_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_playlist_tracks(
    playlist_id: i64,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_playlist_tracks(&conn, playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::add_track_to_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::remove_track_from_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_playlist(playlist_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::delete_playlist(&conn, playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_playlist(
    playlist_id: i64,
    new_name: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::rename_playlist(&conn, playlist_id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_playlist_cover(
    playlist_id: i64,
    cover_url: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::update_playlist_cover(&conn, playlist_id, cover_url.as_deref())
        .map_err(|e| e.to_string())
}
