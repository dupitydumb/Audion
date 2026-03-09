// Playlist-related Tauri commands
use crate::db::{queries, Database};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub async fn create_playlist(name: String, db: State<'_, Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = queries::create_playlist(&conn, &name).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        let payload = serde_json::json!({ "name": name }).to_string();
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist",
            &format!("local_{}", id),
            "create",
            Some(&payload),
        );
    }

    Ok(id)
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
    queries::add_track_to_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        // Get the position that was just assigned
        let position: i32 = conn.query_row(
            "SELECT COALESCE(position, 0) FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            rusqlite::params![playlist_id, track_id],
            |row| row.get(0),
        ).unwrap_or(0);

        let mut payload = serde_json::json!({
            "playlistId": format!("local_{}", playlist_id),
            "position": position,
        });
        // Attach track metadata for cross-device matching
        if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
            let track_hash = queries::build_track_hash_str(
                track.title.as_deref(),
                track.artist.as_deref(),
                track.album.as_deref(),
            );
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
            "playlist_track",
            &format!("local_{}_{}", playlist_id, track_id),
            "create",
            Some(&payload.to_string()),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::remove_track_from_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        let payload = serde_json::json!({
            "playlistId": format!("local_{}", playlist_id),
        })
        .to_string();
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist_track",
            &format!("local_{}_{}", playlist_id, track_id),
            "delete",
            Some(&payload),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_playlist(playlist_id: i64, db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::delete_playlist(&conn, playlist_id).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist",
            &format!("local_{}", playlist_id),
            "delete",
            None,
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn rename_playlist(
    playlist_id: i64,
    new_name: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::rename_playlist(&conn, playlist_id, &new_name).map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        let payload = serde_json::json!({ "name": new_name }).to_string();
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist",
            &format!("local_{}", playlist_id),
            "update",
            Some(&payload),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn update_playlist_cover(
    playlist_id: i64,
    cover_url: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::update_playlist_cover(&conn, playlist_id, cover_url.as_deref())
        .map_err(|e| e.to_string())?;

    // Enqueue sync change
    if queries::is_logged_in(&conn) {
        let payload = serde_json::json!({ "coverUrl": cover_url }).to_string();
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist",
            &format!("local_{}", playlist_id),
            "update",
            Some(&payload),
        );
    }

    Ok(())
}

/// Reorder tracks in a playlist by moving a track from one position to another

/// from_index - The current index of the track to move (0-based)
/// to_index - The target index where the track should be moved (0-based)
#[tauri::command]
pub async fn reorder_playlist_tracks(
    playlist_id: i64,
    from_index: i64,
    to_index: i64,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all tracks in the playlist ordered by position
    let mut stmt = conn
        .prepare(
            "SELECT track_id, position FROM playlist_tracks 
         WHERE playlist_id = ?1 
         ORDER BY position",
        )
        .map_err(|e| e.to_string())?;

    let tracks: Vec<(i64, i64)> = stmt
        .query_map(params![playlist_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if tracks.is_empty() {
        return Err("Playlist is empty".to_string());
    }

    // Validate indices
    let max_index = tracks.len() as i64 - 1;
    if from_index < 0 || from_index > max_index {
        return Err(format!("Invalid from_index: {}", from_index));
    }
    if to_index < 0 || to_index > max_index {
        return Err(format!("Invalid to_index: {}", to_index));
    }

    // If indices are the same, no reordering needed
    if from_index == to_index {
        return Ok(());
    }

    // Create a new ordered list of track IDs
    let mut track_ids: Vec<i64> = tracks.iter().map(|(id, _)| *id).collect();

    // Remove the track from its current position
    let moved_track_id = track_ids.remove(from_index as usize);

    // Insert it at the new position
    track_ids.insert(to_index as usize, moved_track_id);

    // Update all positions in the database
    // Use a transaction to ensure atomicity
    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| e.to_string())?;

    for (new_position, track_id) in track_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_tracks 
             SET position = ?1 
             WHERE playlist_id = ?2 AND track_id = ?3",
            params![new_position as i64, playlist_id, track_id],
        )
        .map_err(|e| {
            // Rollback on error
            let _ = conn.execute("ROLLBACK", []);
            e.to_string()
        })?;
    }

    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

    // Enqueue sync change for the reorder
    if queries::is_logged_in(&conn) {
        let payload = serde_json::json!({
            "playlistId": format!("local_{}", playlist_id),
            "fromIndex": from_index,
            "toIndex": to_index,
        })
        .to_string();
        let _ = queries::enqueue_sync_change(
            &conn,
            "playlist_track",
            &format!("local_{}_reorder", playlist_id),
            "update",
            Some(&payload),
        );
    }

    Ok(())
}
