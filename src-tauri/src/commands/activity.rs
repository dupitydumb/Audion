// Activity-related Tauri commands (liked tracks + play history)
use crate::db::{queries, Database};
use tauri::State;

// ============================================================================
// Liked Tracks commands
// ============================================================================

#[tauri::command]
pub async fn like_track(track_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::like_track(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unlike_track(track_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::unlike_track(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_track_liked(track_id: i64, db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::is_track_liked(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_liked_track_ids(db: State<'_, Database>) -> Result<Vec<i64>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_liked_track_ids(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_liked_tracks(db: State<'_, Database>) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_liked_tracks(&conn).map_err(|e| e.to_string())
}

// ============================================================================
// Play History commands
// ============================================================================

#[tauri::command]
pub async fn record_play(
    track_id: i64,
    album_id: Option<i64>,
    duration_played: i64,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::record_play(&conn, track_id, album_id, duration_played).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_top_tracks(
    limit: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::TrackWithCount>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_top_tracks(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_top_albums(
    limit: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::AlbumWithCount>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_top_albums(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recently_played(
    limit: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_recently_played(&conn, limit).map_err(|e| e.to_string())
}
