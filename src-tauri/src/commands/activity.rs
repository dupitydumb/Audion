// Activity-related Tauri commands (liked tracks + play history)
use crate::db::{queries, Database};
use tauri::State;

/// Helper: check if user is logged in (for sync enqueuing)
fn is_logged_in(conn: &rusqlite::Connection) -> bool {
    queries::get_sync_meta(conn, "access_token")
        .ok()
        .flatten()
        .is_some()
        && queries::get_sync_meta(conn, "user_id")
            .ok()
            .flatten()
            .is_some()
}

/// Helper: build a track hash for sync payloads (title|artist|album)
fn build_track_hash(track: &queries::Track) -> String {
    format!(
        "{}|{}|{}",
        track.title.as_deref().unwrap_or(""),
        track.artist.as_deref().unwrap_or(""),
        track.album.as_deref().unwrap_or("")
    )
}

// ============================================================================
// Liked Tracks commands
// ============================================================================

#[tauri::command]
pub async fn like_track(track_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::like_track(&conn, track_id).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if is_logged_in(&conn) {
        let mut payload = serde_json::json!({});
        if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
            let track_hash = build_track_hash(&track);
            payload["trackHash"] = serde_json::Value::String(track_hash);
            payload["title"] = serde_json::json!(track.title);
            payload["artist"] = serde_json::json!(track.artist);
            payload["album"] = serde_json::json!(track.album);
            payload["duration"] = serde_json::json!(track.duration);
            payload["externalId"] = serde_json::json!(track.external_id);
            payload["sourceType"] = serde_json::json!(track.source_type);
            payload["coverUrl"] = serde_json::json!(track.cover_url);
        }
        let _ = queries::enqueue_sync_change(
            &conn,
            "liked_track",
            &format!("local_liked_{}", track_id),
            "create",
            Some(&payload.to_string()),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn unlike_track(track_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Build payload before deleting (need track info for the hash)
    let mut payload = serde_json::json!({});
    let logged_in = is_logged_in(&conn);
    if logged_in {
        if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
            let track_hash = build_track_hash(&track);
            payload["trackHash"] = serde_json::Value::String(track_hash);
        }
    }

    queries::unlike_track(&conn, track_id).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if logged_in {
        let _ = queries::enqueue_sync_change(
            &conn,
            "liked_track",
            &format!("local_liked_{}", track_id),
            "delete",
            Some(&payload.to_string()),
        );
    }

    Ok(())
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
    queries::record_play(&conn, track_id, album_id, duration_played).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if is_logged_in(&conn) {
        if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
            let track_hash = build_track_hash(&track);
            let payload = serde_json::json!({
                "trackHash": track_hash,
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "duration": track.duration,
                "durationPlayed": duration_played,
                "sourceType": track.source_type,
                "externalId": track.external_id,
                "playedAt": chrono::Utc::now().to_rfc3339(),
                "coverUrl": track.cover_url,
            });

            let _ = queries::enqueue_sync_change(
                &conn,
                "play_history",
                &format!(
                    "play_{}_{}",
                    track_id,
                    chrono::Utc::now().timestamp_millis()
                ),
                "create",
                Some(&payload.to_string()),
            );
        }
    }

    Ok(())
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

#[tauri::command]
pub async fn get_top_artists(
    limit: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::ArtistWithCount>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_top_artists(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_stats_summary(db: State<'_, Database>) -> Result<queries::StatsSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_stats_summary(&conn).map_err(|e| e.to_string())
}
