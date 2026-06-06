// Activity-related Tauri commands (liked tracks + play history)
use crate::db::{queries, Database};
use tauri::State;

// ============================================================================
// Liked Tracks commands
// ============================================================================

#[tauri::command]
pub async fn like_track(
    track_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.like_track(track_id).await
}

#[tauri::command]
pub async fn unlike_track(
    track_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<(), String> {
    let provider = sync_state.active_provider();
    provider.unlike_track(track_id).await
}

#[tauri::command]
pub async fn is_track_liked(
    track_id: i64,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<bool, String> {
    let provider = sync_state.active_provider();
    provider.is_track_liked(track_id).await
}

#[tauri::command]
pub async fn get_liked_track_ids(
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<i64>, String> {
    let provider = sync_state.active_provider();
    provider.get_liked_track_ids().await
}

#[tauri::command]
pub async fn get_liked_tracks(
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::Track>, String> {
    let provider = sync_state.active_provider();
    provider.get_liked_tracks().await
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
    if queries::is_logged_in(&conn) {
        if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
            let track_hash = queries::build_track_hash_str(
                track.title.as_deref(),
                track.artist.as_deref(),
                track.album.as_deref(),
            );
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
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::TrackWithCount>, String> {
    if let crate::sync::provider::ProviderMode::Server = *sync_state.provider_mode.lock().unwrap() {
        return Ok(vec![]);
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut tracks = queries::get_top_tracks(&conn, limit).map_err(|e| e.to_string())?;
    let server_url = sync_state.server_url.lock().unwrap().clone();
    let token = crate::sync::auth::get_access_token(&db).ok().flatten();
    for t in &mut tracks {
        crate::sync::provider::resolve_track(&mut t.track, &server_url, token.as_deref());
    }
    Ok(tracks)
}

#[tauri::command]
pub async fn get_top_albums(
    limit: i32,
    db: State<'_, Database>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::AlbumWithCount>, String> {
    if let crate::sync::provider::ProviderMode::Server = *sync_state.provider_mode.lock().unwrap() {
        return Ok(vec![]);
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut albums = queries::get_top_albums(&conn, limit).map_err(|e| e.to_string())?;
    let server_url = sync_state.server_url.lock().unwrap().clone();
    let token = crate::sync::auth::get_access_token(&db).ok().flatten();
    for a in &mut albums {
        crate::sync::provider::resolve_album(&mut a.album, &server_url, token.as_deref());
    }
    Ok(albums)
}

#[tauri::command]
pub async fn get_recently_played(
    limit: i32,
    db: State<'_, Database>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::Track>, String> {
    if let crate::sync::provider::ProviderMode::Server = *sync_state.provider_mode.lock().unwrap() {
        return Ok(vec![]);
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut tracks = queries::get_recently_played(&conn, limit).map_err(|e| e.to_string())?;
    let server_url = sync_state.server_url.lock().unwrap().clone();
    let token = crate::sync::auth::get_access_token(&db).ok().flatten();
    crate::sync::provider::resolve_tracks(&mut tracks, &server_url, token.as_deref());
    Ok(tracks)
}

#[tauri::command]
pub async fn get_top_artists(
    limit: i32,
    db: State<'_, Database>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<Vec<queries::ArtistWithCount>, String> {
    if let crate::sync::provider::ProviderMode::Server = *sync_state.provider_mode.lock().unwrap() {
        return Ok(vec![]);
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_top_artists(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_stats_summary(
    db: State<'_, Database>,
    sync_state: State<'_, crate::sync::SyncState>,
) -> Result<queries::StatsSummary, String> {
    if let crate::sync::provider::ProviderMode::Server = *sync_state.provider_mode.lock().unwrap() {
        return Ok(queries::StatsSummary {
            total_plays: 0,
            total_duration_seconds: 0,
            top_artist: None,
            top_genre: None,
        });
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_stats_summary(&conn).map_err(|e| e.to_string())
}
