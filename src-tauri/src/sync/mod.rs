// Sync module — handles synchronization between client and server
//
// Architecture:
// - auth.rs: Token management, authenticated HTTP requests
// - mod.rs:  SyncService (queue processing, push/pull, merge logic)

pub mod auth;

use crate::db::queries::{self, SyncQueueEntry};
use crate::db::Database;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

// ─── Constants ───────────────────────────────────────────────────────────────

/// The sync server URL. Update this to your deployed server URL.
/// During development, use localhost or a tunnel.
const DEFAULT_SERVER_URL: &str = "https://api.audionplayer.com";

/// Max retry count before skipping a sync queue entry.
const MAX_RETRY_COUNT: i32 = 10;

/// Max changes per push request to avoid Cloudflare Worker timeouts.
const PUSH_CHUNK_SIZE: usize = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_syncing: bool,
    pub last_sync_at: Option<String>,
    pub pending_changes: i64,
    pub last_error: Option<String>,
}

/// Progress event emitted to the frontend during sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub phase: String,
    pub message: String,
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct SyncPushRequest {
    cursor: i64,
    #[serde(rename = "deviceId")]
    device_id: String,
    changes: Vec<ClientChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClientChange {
    #[serde(rename = "entityType")]
    entity_type: String,
    #[serde(rename = "entityId")]
    entity_id: String,
    operation: String,
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SyncPushResponse {
    #[serde(rename = "newCursor")]
    new_cursor: i64,
    #[serde(rename = "serverChanges")]
    server_changes: Vec<ServerChange>,
    conflicts: Vec<ServerChange>,
}

#[derive(Debug, Deserialize)]
struct ServerChange {
    #[serde(rename = "entityType")]
    entity_type: String,
    #[serde(rename = "entityId")]
    entity_id: String,
    operation: String,
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SyncFullResponse {
    cursor: i64,
    playlists: Vec<serde_json::Value>,
    #[serde(rename = "likedTracks")]
    liked_tracks: Vec<serde_json::Value>,
    #[serde(rename = "libraryTracks")]
    library_tracks: Vec<serde_json::Value>,
    settings: Option<serde_json::Value>,
}

// ─── SyncState (shared, managed by Tauri) ───────────────────────────────────

pub struct SyncState {
    pub is_syncing: Arc<AtomicBool>,
    pub server_url: String,
    pub app_handle: Option<tauri::AppHandle>,
}

impl SyncState {
    pub fn new() -> Self {
        Self {
            is_syncing: Arc::new(AtomicBool::new(false)),
            server_url: DEFAULT_SERVER_URL.to_string(),
            app_handle: None,
        }
    }

    pub fn new_with_handle(handle: tauri::AppHandle) -> Self {
        Self {
            is_syncing: Arc::new(AtomicBool::new(false)),
            server_url: DEFAULT_SERVER_URL.to_string(),
            app_handle: Some(handle),
        }
    }
}

/// Emit a progress event to the frontend (if AppHandle is available).
fn emit_progress(sync_state: &SyncState, phase: &str, message: &str, current: usize, total: usize) {
    tracing::info!("[sync:{}] {}/{} — {}", phase, current, total, message);
    if let Some(handle) = &sync_state.app_handle {
        let _ = handle.emit(
            "sync://progress",
            SyncProgress {
                phase: phase.to_string(),
                message: message.to_string(),
                current,
                total,
            },
        );
    }
}

// ─── Sync Service ───────────────────────────────────────────────────────────

/// Get the current sync status.
pub fn get_sync_status(db: &Database, sync_state: &SyncState) -> Result<SyncStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let pending = queries::get_sync_queue_count(&conn).map_err(|e| e.to_string())?;

    let last_sync_at = queries::get_sync_meta(&conn, "last_sync_at").map_err(|e| e.to_string())?;

    let last_error = queries::get_sync_meta(&conn, "last_sync_error").map_err(|e| e.to_string())?;

    Ok(SyncStatus {
        is_syncing: sync_state.is_syncing.load(Ordering::Relaxed),
        last_sync_at,
        pending_changes: pending,
        last_error,
    })
}

/// Perform a delta sync: push local changes, pull remote changes.
pub async fn perform_sync(db: &Database, sync_state: &SyncState) -> Result<SyncStatus, String> {
    // Prevent concurrent syncs
    if sync_state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Sync already in progress".to_string());
    }

    let result = perform_sync_inner(db, sync_state).await;

    sync_state.is_syncing.store(false, Ordering::SeqCst);

    if result.is_err() {
        let e = result.unwrap_err();
        tracing::error!("Sync failed: {}", e);
        if let Ok(conn) = db.conn.lock() {
            let _ = queries::set_sync_meta(&conn, "last_sync_error", &e);
        }
        return Err(e);
    }

    let mut status = result.unwrap();

    // On success — clear last error and update last_sync_at
    if let Ok(conn) = db.conn.lock() {
        let _ = queries::delete_sync_meta(&conn, "last_sync_error");
        let now = chrono_now();
        let _ = queries::set_sync_meta(&conn, "last_sync_at", &now);
        status.last_sync_at = Some(now);
    }

    status.is_syncing = false;
    Ok(status)
}

async fn perform_sync_inner(db: &Database, sync_state: &SyncState) -> Result<SyncStatus, String> {
    let server_url = &sync_state.server_url;

    emit_progress(sync_state, "sync", "Reading pending changes...", 0, 0);

    // 1. Read sync queue
    let queue_entries = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        queries::get_sync_queue(&conn).map_err(|e| e.to_string())?
    };

    // Filter out entries that have exceeded max retries
    let (sendable, _skipped): (Vec<&SyncQueueEntry>, Vec<&SyncQueueEntry>) = queue_entries
        .iter()
        .partition(|e| e.retry_count < MAX_RETRY_COUNT);

    // 2. Build the push request — deduplicate by (entity_type, entity_id)
    //    Keep the LAST operation for each entity (latest state wins)
    let cursor = auth::get_sync_cursor(db)?;
    let device_id = auth::get_or_create_device_id(db)?;

    let mut deduped: std::collections::HashMap<(String, String), &SyncQueueEntry> =
        std::collections::HashMap::new();
    for entry in &sendable {
        let key = (entry.entity_type.clone(), entry.entity_id.clone());
        deduped.insert(key, entry);
    }

    // Translate local IDs to server UUIDs
    let changes: Vec<ClientChange> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        deduped
            .values()
            .map(|entry| {
                let mut payload: serde_json::Value = entry
                    .payload
                    .as_ref()
                    .and_then(|p| serde_json::from_str(p).ok())
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                // Translate entity_id and payload references from local IDs to server UUIDs
                let server_entity_id =
                    translate_entity_id(&conn, &entry.entity_type, &entry.entity_id, &mut payload);

                ClientChange {
                    entity_type: entry.entity_type.clone(),
                    entity_id: server_entity_id,
                    operation: entry.operation.clone(),
                    payload,
                }
            })
            .collect()
    };

    let push_body = SyncPushRequest {
        cursor,
        device_id,
        changes,
    };

    let body_json =
        serde_json::to_string(&push_body).map_err(|e| format!("Failed to serialize: {}", e))?;

    // 3. Send to server
    emit_progress(
        sync_state,
        "sync",
        &format!("Pushing {} changes to server...", sendable.len()),
        0,
        sendable.len(),
    );

    let resp_body = auth::authenticated_request(db, &sync_state.server_url, "POST", "/sync/push", Some(&body_json)).await?;
    let response: SyncPushResponse = serde_json::from_str(&resp_body)
        .map_err(|e| format!("Failed to parse sync push response: {} — Raw body: {}", e, resp_body))?;

    emit_progress(
        sync_state,
        "sync",
        "Applying server changes...",
        sendable.len(),
        sendable.len(),
    );

    // 4. On success — delete ALL processed queue entries (including duplicates)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let processed_ids: Vec<i64> = sendable.iter().map(|e| e.id).collect();
        queries::delete_sync_queue_entries(&conn, &processed_ids).map_err(|e| e.to_string())?;
    }

    // 5. Update cursor
    auth::set_sync_cursor(db, response.new_cursor)?;

    // 6. Apply server changes to local DB
    apply_server_changes(db, &response.server_changes)?;

    // 7. Handle conflicts (log them for now; Phase 5 adds UI)
    if !response.conflicts.is_empty() {
        tracing::warn!(
            "Sync returned {} conflicts (auto-resolved with server-wins)",
            response.conflicts.len()
        );
    }

    get_sync_status(db, sync_state)
}

/// Perform an initial full sync (first login on a new device).
pub async fn perform_full_sync(
    db: &Database,
    sync_state: &SyncState,
) -> Result<SyncStatus, String> {
    if sync_state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Sync already in progress".to_string());
    }

    let result = perform_full_sync_inner(db, sync_state).await;

    sync_state.is_syncing.store(false, Ordering::SeqCst);

    if result.is_err() {
        let e = result.unwrap_err();
        tracing::error!("Full sync failed: {}", e);
        if let Ok(conn) = db.conn.lock() {
            let _ = queries::set_sync_meta(&conn, "last_sync_error", &e);
        }
        return Err(e);
    }

    let mut status = result.unwrap();

    // On success — clear last error and update last_sync_at
    if let Ok(conn) = db.conn.lock() {
        let _ = queries::delete_sync_meta(&conn, "last_sync_error");
        let now = chrono_now();
        let _ = queries::set_sync_meta(&conn, "last_sync_at", &now);
        status.last_sync_at = Some(now);
    }

    status.is_syncing = false;
    Ok(status)
}

async fn perform_full_sync_inner(
    db: &Database,
    sync_state: &SyncState,
) -> Result<SyncStatus, String> {
    // ── Step 1: Pull existing data from server ──────────────────────────
    emit_progress(sync_state, "pull", "Downloading data from server...", 0, 0);

    let resp_body = auth::authenticated_request(db, &sync_state.server_url, "GET", "/sync/full", None).await?;
    let response: SyncFullResponse = serde_json::from_str(&resp_body)
        .map_err(|e| format!("Failed to parse full sync response: {} — Raw body: {}", e, resp_body))?;

    tracing::info!(
        "Full sync pull: {} playlists, {} liked tracks, {} library tracks, cursor={}",
        response.playlists.len(),
        response.liked_tracks.len(),
        response.library_tracks.len(),
        response.cursor,
    );

    // Apply server data to local DB
    if let Some(settings) = &response.settings {
        apply_settings_from_server(db, settings)?;
    }

    // Apply playlists (with their tracks) from server
    apply_full_sync_playlists(db, &response.playlists, sync_state)?;

    // Apply liked tracks from server
    apply_full_sync_liked_tracks(db, &response.liked_tracks, sync_state)?;

    // Apply library tracks from server
    apply_full_sync_library_tracks(db, &response.library_tracks, sync_state)?;

    // Set cursor to server's current value
    auth::set_sync_cursor(db, response.cursor)?;

    // ── Step 2: Push local data to server ───────────────────────────────
    // On first sync, we need to upload existing local playlists, liked tracks,
    // and the full track library so they are available on other devices.
    emit_progress(
        sync_state,
        "push",
        "Preparing local data for upload...",
        0,
        0,
    );
    push_local_data_to_server(db, sync_state).await?;

    emit_progress(sync_state, "done", "Sync complete!", 1, 1);

    // Mark full sync as completed
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let _ = queries::set_sync_meta(&conn, "full_sync_done", "true");
    }

    get_sync_status(db, sync_state)
}

/// Push all local playlists, liked tracks, and the full track library to the server.
/// Called during initial full sync so existing data is uploaded.
/// Guarded: skips if initial push was already completed.
async fn push_local_data_to_server(db: &Database, sync_state: &SyncState) -> Result<(), String> {
    // Skip if we already completed the initial push
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(v) =
            queries::get_sync_meta(&conn, "full_sync_done").map_err(|e| e.to_string())?
        {
            if v == "true" {
                tracing::info!(
                    "Initial push already completed, skipping push_local_data_to_server"
                );
                return Ok(());
            }
        }
    }

    let server_url = &sync_state.server_url;

    // 1. Gather local playlists + their tracks
    let playlist_tracks_map = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let playlists = queries::get_all_playlists(&conn).map_err(|e| e.to_string())?;

        let mut playlist_tracks_map: Vec<(queries::Playlist, Vec<queries::Track>)> = Vec::new();
        for pl in &playlists {
            let tracks = queries::get_playlist_tracks(&conn, pl.id).map_err(|e| e.to_string())?;
            playlist_tracks_map.push((pl.clone(), tracks));
        }

        playlist_tracks_map
    };

    // 2. Build changes list
    let mut changes: Vec<ClientChange> = Vec::new();

    // Playlists
    for (playlist, tracks) in &playlist_tracks_map {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let playlist_local_id = playlist.id.to_string();
        let playlist_server_id =
            queries::get_or_create_server_id(&conn, &playlist_local_id, "playlist")
                .map_err(|e| e.to_string())?;
        // Also store on the playlists table for apply_server_changes lookups
        let _ = queries::set_playlist_server_id(&conn, playlist.id, &playlist_server_id);
        drop(conn);

        changes.push(ClientChange {
            entity_type: "playlist".to_string(),
            entity_id: playlist_server_id.clone(),
            operation: "create".to_string(),
            payload: serde_json::json!({
                "name": playlist.name,
                "coverUrl": playlist.cover_url,
                "createdAt": playlist.created_at,
            }),
        });

        // Tracks in this playlist
        for (position, track) in tracks.iter().enumerate() {
            let track_hash = build_track_hash(track);
            let pt_local_id = format!("{}_{}", playlist.id, track.id);
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let pt_server_id =
                queries::get_or_create_server_id(&conn, &pt_local_id, "playlist_track")
                    .map_err(|e| e.to_string())?;
            drop(conn);

            changes.push(ClientChange {
                entity_type: "playlist_track".to_string(),
                entity_id: pt_server_id,
                operation: "create".to_string(),
                payload: serde_json::json!({
                    "playlistId": playlist_server_id,
                    "trackHash": track_hash,
                    "position": position,
                    "title": track.title,
                    "artist": track.artist,
                    "album": track.album,
                    "duration": track.duration,
                    "externalId": track.external_id,
                    "sourceType": track.source_type,
                    "coverUrl": track.cover_url,
                }),
            });
        }
    }

    // Liked tracks
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let liked_tracks = queries::get_liked_tracks(&conn).map_err(|e| e.to_string())?;
        for track in &liked_tracks {
            let track_hash = build_track_hash(track);
            let liked_local_id = format!("liked_{}", track.id);
            let liked_server_id =
                queries::get_or_create_server_id(&conn, &liked_local_id, "liked_track")
                    .map_err(|e| e.to_string())?;

            changes.push(ClientChange {
                entity_type: "liked_track".to_string(),
                entity_id: liked_server_id,
                operation: "create".to_string(),
                payload: serde_json::json!({
                    "trackHash": track_hash,
                    "title": track.title,
                    "artist": track.artist,
                    "album": track.album,
                    "duration": track.duration,
                    "externalId": track.external_id,
                    "sourceType": track.source_type,
                    "coverUrl": track.cover_url,
                }),
            });
        }
    }

    // Full track library
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let all_tracks = queries::get_all_tracks_lightweight(&conn).map_err(|e| e.to_string())?;
        for track in &all_tracks {
            let track_hash = build_track_hash(track);
            let lib_local_id = format!("lib_{}", track.id);
            let lib_server_id =
                queries::get_or_create_server_id(&conn, &lib_local_id, "library_track")
                    .map_err(|e| e.to_string())?;

            changes.push(ClientChange {
                entity_type: "library_track".to_string(),
                entity_id: lib_server_id,
                operation: "create".to_string(),
                payload: serde_json::json!({
                    "trackHash": track_hash,
                    "title": track.title,
                    "artist": track.artist,
                    "album": track.album,
                    "trackNumber": track.track_number,
                    "discNumber": track.disc_number,
                    "duration": track.duration,
                    "format": track.format,
                    "bitrate": track.bitrate,
                    "sourceType": track.source_type,
                    "externalId": track.external_id,
                    "contentHash": track.path,
                    "coverUrl": track.cover_url,
                }),
            });
        }
    }

    if changes.is_empty() {
        tracing::info!("No local data to push to server");
        emit_progress(sync_state, "push", "Nothing to upload", 0, 0);
        return Ok(());
    }

    let total_changes = changes.len();
    let total_chunks = (total_changes + PUSH_CHUNK_SIZE - 1) / PUSH_CHUNK_SIZE;

    tracing::info!(
        "Pushing local data to server: {} total changes in {} chunks",
        total_changes,
        total_chunks,
    );

    emit_progress(
        sync_state,
        "push",
        &format!("Uploading {} items...", total_changes),
        0,
        total_changes,
    );

    // 3. Push to server in chunks to avoid Cloudflare Worker timeouts
    let device_id = auth::get_or_create_device_id(db)?;
    let mut sent: usize = 0;

    for (chunk_idx, chunk) in changes.chunks(PUSH_CHUNK_SIZE).enumerate() {
        let cursor = auth::get_sync_cursor(db)?;

        let push_body = SyncPushRequest {
            cursor,
            device_id: device_id.clone(),
            changes: chunk.to_vec(),
        };

        let body_json = serde_json::to_string(&push_body)
            .map_err(|e| format!("Failed to serialize chunk {}: {}", chunk_idx + 1, e))?;

        emit_progress(
            sync_state,
            "push",
            &format!(
                "Uploading batch {}/{} ({} items)...",
                chunk_idx + 1,
                total_chunks,
                chunk.len()
            ),
            sent,
            total_changes,
        );

        let response_text =
            auth::authenticated_request(db, server_url, "POST", "/sync/push", Some(&body_json))
                .await?;

        let response: SyncPushResponse = serde_json::from_str(&response_text).map_err(|e| {
            format!(
                "Failed to parse push response (chunk {}): {}",
                chunk_idx + 1,
                e
            )
        })?;

        // Update cursor after each successful chunk
        auth::set_sync_cursor(db, response.new_cursor)?;

        sent += chunk.len();

        tracing::info!(
            "Chunk {}/{} pushed — {} items sent, new cursor: {}",
            chunk_idx + 1,
            total_chunks,
            sent,
            response.new_cursor,
        );
    }

    emit_progress(
        sync_state,
        "push",
        &format!("Upload complete — {} items synced", total_changes),
        total_changes,
        total_changes,
    );

    Ok(())
}

// ─── Apply full sync data from server ────────────────────────────────────────

/// Apply playlists (with their tracks) from the full sync response to the local DB.
fn apply_full_sync_playlists(
    db: &Database,
    playlists: &[serde_json::Value],
    sync_state: &SyncState,
) -> Result<(), String> {
    let total = playlists.len();
    if total == 0 {
        tracing::info!("No playlists to import from server");
        return Ok(());
    }

    emit_progress(
        sync_state,
        "pull",
        &format!("Importing {} playlists...", total),
        0,
        total,
    );

    for (i, pl) in playlists.iter().enumerate() {
        let server_id = pl.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let name = pl
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Playlist");
        let cover_url = pl.get("coverUrl").and_then(|v| v.as_str());
        let tracks = pl.get("tracks").and_then(|v| v.as_array());

        if server_id.is_empty() {
            tracing::warn!("Skipping playlist with missing server_id");
            continue;
        }

        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Check if we already have this playlist locally
        let existing =
            queries::find_playlist_by_server_id(&conn, server_id).map_err(|e| e.to_string())?;

        let local_playlist_id = if let Some(id) = existing {
            id
        } else {
            // Create the playlist
            let id = queries::create_playlist(&conn, name).map_err(|e| e.to_string())?;
            queries::set_playlist_server_id(&conn, id, server_id).map_err(|e| e.to_string())?;
            let _ = queries::store_id_mapping(&conn, &id.to_string(), "playlist", server_id);
            if let Some(url) = cover_url {
                queries::update_playlist_cover(&conn, id, Some(url)).map_err(|e| e.to_string())?;
            }
            tracing::info!(
                "Created playlist '{}' (local_id={}, server_id={})",
                name,
                id,
                server_id
            );
            id
        };

        // Add tracks to the playlist
        if let Some(tracks) = tracks {
            for track_val in tracks {
                let track_hash = track_val
                    .get("trackHash")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = track_val.get("title").and_then(|v| v.as_str());
                let artist = track_val.get("artist").and_then(|v| v.as_str());
                let album = track_val.get("album").and_then(|v| v.as_str());
                let duration = track_val
                    .get("duration")
                    .and_then(|v| v.as_i64())
                    .map(|d| d as i32);
                let source_type = track_val.get("sourceType").and_then(|v| v.as_str());
                let external_id = track_val.get("externalId").and_then(|v| v.as_str());
                let cover_url = track_val.get("coverUrl").and_then(|v| v.as_str());

                let local_track_id = find_or_create_synced_track(
                    &conn,
                    track_hash,
                    title,
                    artist,
                    album,
                    duration,
                    source_type,
                    external_id,
                    cover_url,
                );

                if let Ok(Some(track_id)) = local_track_id {
                    let _ = queries::add_track_to_playlist(&conn, local_playlist_id, track_id);
                }
            }
        }

        drop(conn);

        emit_progress(
            sync_state,
            "pull",
            &format!("Imported playlist '{}' ({}/{})", name, i + 1, total),
            i + 1,
            total,
        );
    }

    tracing::info!("Imported {} playlists from server", total);
    Ok(())
}

/// Apply liked tracks from the full sync response to the local DB.
fn apply_full_sync_liked_tracks(
    db: &Database,
    liked_tracks: &[serde_json::Value],
    sync_state: &SyncState,
) -> Result<(), String> {
    let total = liked_tracks.len();
    if total == 0 {
        tracing::info!("No liked tracks to import from server");
        return Ok(());
    }

    emit_progress(
        sync_state,
        "pull",
        &format!("Importing {} liked tracks...", total),
        0,
        total,
    );

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    for (i, lt) in liked_tracks.iter().enumerate() {
        let track_hash = lt.get("trackHash").and_then(|v| v.as_str()).unwrap_or("");
        let title = lt.get("title").and_then(|v| v.as_str());
        let artist = lt.get("artist").and_then(|v| v.as_str());
        let album = lt.get("album").and_then(|v| v.as_str());
        let duration = lt
            .get("duration")
            .and_then(|v| v.as_i64())
            .map(|d| d as i32);
        let source_type = lt.get("sourceType").and_then(|v| v.as_str());
        let external_id = lt.get("externalId").and_then(|v| v.as_str());
        let cover_url = lt.get("coverUrl").and_then(|v| v.as_str());

        let local_track_id = find_or_create_synced_track(
            &conn,
            track_hash,
            title,
            artist,
            album,
            duration,
            source_type,
            external_id,
            cover_url,
        );

        if let Ok(Some(track_id)) = local_track_id {
            let _ = queries::like_track(&conn, track_id);
        }

        if (i + 1) % 50 == 0 || i + 1 == total {
            emit_progress(
                sync_state,
                "pull",
                &format!("Liked tracks: {}/{}", i + 1, total),
                i + 1,
                total,
            );
        }
    }

    tracing::info!("Imported {} liked tracks from server", total);
    Ok(())
}

/// Find an existing local track by metadata, or create a placeholder track.
/// Returns the local track ID, or None if the track can't be created.
fn find_or_create_synced_track(
    conn: &rusqlite::Connection,
    track_hash: &str,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<i32>,
    source_type: Option<&str>,
    external_id: Option<&str>,
    cover_url: Option<&str>,
) -> Result<Option<i64>, String> {
    // 1. Try to find by title + artist in existing local tracks
    if let (Some(t), Some(a)) = (title, artist) {
        if let Ok(track_id) = find_local_track_by_metadata(conn, t, a) {
            return Ok(Some(track_id));
        }
    }

    // 2. Check if we already created a sync placeholder for this track hash
    let sync_path = format!("sync://{}", track_hash);
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM tracks WHERE path = ?1",
            rusqlite::params![sync_path],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        return Ok(Some(id));
    }

    // 3. Create a placeholder track with the server metadata
    let track = queries::TrackInsert {
        path: sync_path,
        title: title.map(|s| s.to_string()),
        artist: artist.map(|s| s.to_string()),
        album: album.map(|s| s.to_string()),
        track_number: None,
        disc_number: None,
        duration,
        album_art: None,
        track_cover: None,
        format: None,
        bitrate: None,
        source_type: source_type.map(|s| s.to_string()),
        cover_url: cover_url.map(|s| s.to_string()),
        external_id: external_id.map(|s| s.to_string()),
        content_hash: if track_hash.is_empty() {
            None
        } else {
            Some(track_hash.to_string())
        },
        local_src: None,
        musicbrainz_recording_id: None,
        metadata_json: None,
    };

    match queries::insert_or_update_track(conn, &track) {
        Ok((id, _)) if id > 0 => {
            tracing::debug!(
                "Created synced track placeholder: id={}, title={:?}, artist={:?}",
                id,
                title,
                artist,
            );
            Ok(Some(id))
        }
        Ok(_) => Ok(None), // duplicate detected
        Err(e) => {
            tracing::warn!("Failed to create synced track: {}", e);
            Ok(None)
        }
    }
}

/// Apply library tracks from the full sync response to the local DB.
/// These are metadata-only references — actual audio files must be present locally to play.
/// Creates placeholder tracks so the library view shows what's synced across devices.
fn apply_full_sync_library_tracks(
    db: &Database,
    library_tracks: &[serde_json::Value],
    sync_state: &SyncState,
) -> Result<(), String> {
    let total = library_tracks.len();
    if total == 0 {
        tracing::info!("No library tracks to import from server");
        return Ok(());
    }

    emit_progress(
        sync_state,
        "pull",
        &format!("Importing {} library tracks...", total),
        0,
        total,
    );

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    for (i, lt) in library_tracks.iter().enumerate() {
        let track_hash = lt.get("trackHash").and_then(|v| v.as_str()).unwrap_or("");
        let title = lt.get("title").and_then(|v| v.as_str());
        let artist = lt.get("artist").and_then(|v| v.as_str());
        let album = lt.get("album").and_then(|v| v.as_str());
        let track_number = lt
            .get("trackNumber")
            .and_then(|v| v.as_i64())
            .map(|n| n as i32);
        let disc_number = lt
            .get("discNumber")
            .and_then(|v| v.as_i64())
            .map(|n| n as i32);
        let duration = lt
            .get("duration")
            .and_then(|v| v.as_i64())
            .map(|d| d as i32);
        let format = lt.get("format").and_then(|v| v.as_str());
        let bitrate = lt.get("bitrate").and_then(|v| v.as_i64()).map(|b| b as i32);
        let source_type = lt.get("sourceType").and_then(|v| v.as_str());
        let external_id = lt.get("externalId").and_then(|v| v.as_str());
        let content_hash = lt.get("contentHash").and_then(|v| v.as_str());
        let cover_url = lt.get("coverUrl").and_then(|v| v.as_str());

        // Skip if a local track with this title+artist already exists
        if let (Some(t), Some(a)) = (title, artist) {
            if find_local_track_by_metadata(&conn, t, a).is_ok() {
                continue;
            }
        }

        // Skip if a sync placeholder already exists for this track hash
        let sync_path = format!("sync://{}", track_hash);
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM tracks WHERE path = ?1",
                rusqlite::params![sync_path],
                |row| row.get(0),
            )
            .ok();

        if existing.is_some() {
            continue;
        }

        // Create the track with full metadata from the server
        let track = queries::TrackInsert {
            path: sync_path,
            title: title.map(|s| s.to_string()),
            artist: artist.map(|s| s.to_string()),
            album: album.map(|s| s.to_string()),
            track_number,
            disc_number,
            duration,
            album_art: None,
            track_cover: None,
            format: format.map(|s| s.to_string()),
            bitrate,
            source_type: source_type.map(|s| s.to_string()),
            cover_url: cover_url.map(|s| s.to_string()),
            external_id: external_id.map(|s| s.to_string()),
            content_hash: if let Some(hash) = content_hash {
                Some(hash.to_string())
            } else if !track_hash.is_empty() {
                Some(track_hash.to_string())
            } else {
                None
            },
            local_src: None,
            musicbrainz_recording_id: None,
            metadata_json: None,
        };

        match queries::insert_or_update_track(&conn, &track) {
            Ok((id, _)) if id > 0 => {
                imported += 1;
                tracing::debug!(
                    "Created library track from server: id={}, title={:?}, artist={:?}",
                    id,
                    title,
                    artist,
                );
            }
            Ok(_) => {} // duplicate detected, skip
            Err(e) => {
                tracing::warn!("Failed to create library track: {}", e);
            }
        }

        if (i + 1) % 100 == 0 || i + 1 == total {
            emit_progress(
                sync_state,
                "pull",
                &format!("Library tracks: {}/{}", i + 1, total),
                i + 1,
                total,
            );
        }
    }

    tracing::info!(
        "Imported {}/{} library tracks from server ({} already existed)",
        imported,
        total,
        total - imported,
    );
    Ok(())
}

// ─── Apply server changes ───────────────────────────────────────────────────

fn apply_server_changes(db: &Database, changes: &[ServerChange]) -> Result<(), String> {
    for change in changes {
        if let Err(e) = apply_single_server_change(db, change) {
            tracing::error!(
                "Failed to apply server change ({} {} {}): {}",
                change.entity_type,
                change.entity_id,
                change.operation,
                e
            );
            // Continue applying other changes even if one fails
        }
    }
    Ok(())
}

fn apply_single_server_change(db: &Database, change: &ServerChange) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    match change.entity_type.as_str() {
        "settings" => {
            drop(conn); // release lock before calling the method that re-acquires it
            apply_settings_from_server(db, &change.payload)?;
        }
        "playlist" => {
            match change.operation.as_str() {
                "create" => {
                    let name = change
                        .payload
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled Playlist");
                    let cover_url = change.payload.get("coverUrl").and_then(|v| v.as_str());

                    // Check if a playlist with this server_id already exists locally
                    let existing = queries::find_playlist_by_server_id(&conn, &change.entity_id)
                        .map_err(|e| e.to_string())?;

                    if existing.is_none() {
                        // Create the playlist locally
                        let local_id =
                            queries::create_playlist(&conn, name).map_err(|e| e.to_string())?;
                        // Map it to the server ID
                        queries::set_playlist_server_id(&conn, local_id, &change.entity_id)
                            .map_err(|e| e.to_string())?;
                        // Store in sync_id_map for future ID translations
                        let _ = queries::store_id_mapping(
                            &conn,
                            &local_id.to_string(),
                            "playlist",
                            &change.entity_id,
                        );
                        // Set cover if provided
                        if let Some(url) = cover_url {
                            queries::update_playlist_cover(&conn, local_id, Some(url))
                                .map_err(|e| e.to_string())?;
                        }
                        tracing::info!(
                            "Created local playlist {} (server_id={})",
                            local_id,
                            change.entity_id
                        );
                    }
                }
                "update" => {
                    if let Some(local_id) =
                        queries::find_playlist_by_server_id(&conn, &change.entity_id)
                            .map_err(|e| e.to_string())?
                    {
                        if let Some(name) = change.payload.get("name").and_then(|v| v.as_str()) {
                            queries::rename_playlist(&conn, local_id, name)
                                .map_err(|e| e.to_string())?;
                        }
                        if let Some(cover) = change.payload.get("coverUrl").and_then(|v| v.as_str())
                        {
                            queries::update_playlist_cover(&conn, local_id, Some(cover))
                                .map_err(|e| e.to_string())?;
                        }
                        tracing::info!("Updated local playlist {} from server", local_id);
                    }
                }
                "delete" => {
                    if let Some(local_id) =
                        queries::find_playlist_by_server_id(&conn, &change.entity_id)
                            .map_err(|e| e.to_string())?
                    {
                        queries::soft_delete_playlist(&conn, local_id)
                            .map_err(|e| e.to_string())?;
                        tracing::info!("Soft-deleted local playlist {} from server", local_id);
                    }
                }
                _ => {
                    tracing::warn!("Unknown playlist operation: {}", change.operation);
                }
            }
        }
        "playlist_track" => {
            let playlist_server_id = change
                .payload
                .get("playlistId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let track_hash = change
                .payload
                .get("trackHash")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if !playlist_server_id.is_empty() && !track_hash.is_empty() {
                // 1. Find local playlist ID
                if let Ok(Some(local_playlist_id)) =
                    queries::find_playlist_by_server_id(&conn, playlist_server_id)
                {
                    // 2. Find local track ID
                    let parts: Vec<&str> = track_hash.splitn(3, '|').collect();
                    if parts.len() == 3 {
                        if let (Some(t), Some(a)) = (Some(parts[0]), Some(parts[1])) {
                            if !t.is_empty() && !a.is_empty() {
                                if let Ok(local_track_id) =
                                    find_local_track_by_metadata(&conn, t, a)
                                {
                                    match change.operation.as_str() {
                                        "create" | "update" => {
                                            let _ = queries::add_track_to_playlist(
                                                &conn,
                                                local_playlist_id,
                                                local_track_id,
                                            );
                                            tracing::info!(
                                                "Added track {} to playlist {} via sync",
                                                local_track_id,
                                                local_playlist_id
                                            );
                                        }
                                        "delete" => {
                                            let _ = queries::remove_track_from_playlist(
                                                &conn,
                                                local_playlist_id,
                                                local_track_id,
                                            );
                                            tracing::info!(
                                                "Removed track {} from playlist {} via sync",
                                                local_track_id,
                                                local_playlist_id
                                            );
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        "liked_track" => {
            match change.operation.as_str() {
                "create" => {
                    // Try to find a matching local track by the track hash
                    let track_hash = change
                        .payload
                        .get("trackHash")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !track_hash.is_empty() {
                        // Search for a local track matching this hash
                        // The hash format is "title|artist|album"
                        let parts: Vec<&str> = track_hash.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let title = if parts[0].is_empty() {
                                None
                            } else {
                                Some(parts[0])
                            };
                            let artist = if parts[1].is_empty() {
                                None
                            } else {
                                Some(parts[1])
                            };

                            // Try to find a matching track in the local DB
                            if let (Some(t), Some(a)) = (title, artist) {
                                if let Ok(track_id) = find_local_track_by_metadata(&conn, t, a) {
                                    let _ = queries::like_track(&conn, track_id);
                                    tracing::info!(
                                        "Liked local track {} from server sync",
                                        track_id
                                    );
                                }
                            }
                        }
                    }
                }
                "delete" => {
                    let track_hash = change
                        .payload
                        .get("trackHash")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !track_hash.is_empty() {
                        let parts: Vec<&str> = track_hash.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let title = if parts[0].is_empty() {
                                None
                            } else {
                                Some(parts[0])
                            };
                            let artist = if parts[1].is_empty() {
                                None
                            } else {
                                Some(parts[1])
                            };

                            if let (Some(t), Some(a)) = (title, artist) {
                                if let Ok(track_id) = find_local_track_by_metadata(&conn, t, a) {
                                    let _ = queries::unlike_track(&conn, track_id);
                                    tracing::info!(
                                        "Unliked local track {} from server sync",
                                        track_id
                                    );
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        "library_track" => {
            tracing::info!(
                "Server change: library_track {} {} (track library synced)",
                change.entity_id,
                change.operation
            );
            // Library tracks from server are metadata-only references.
            // The actual audio files must be present locally to play.
            // This is informational — the client already has its own scan-based library.
        }
        "play_history" => {
            if change.operation == "create" {
                let track_hash = change
                    .payload
                    .get("trackHash")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let duration_played = change
                    .payload
                    .get("durationPlayed")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let _played_at = change.payload.get("playedAt").and_then(|v| v.as_str());

                if !track_hash.is_empty() {
                    let parts: Vec<&str> = track_hash.splitn(3, '|').collect();
                    if parts.len() == 3 {
                        let title = if parts[0].is_empty() {
                            None
                        } else {
                            Some(parts[0])
                        };
                        let artist = if parts[1].is_empty() {
                            None
                        } else {
                            Some(parts[1])
                        };

                        if let (Some(t), Some(a)) = (title, artist) {
                            if let Ok(track_id) = find_local_track_by_metadata(&conn, t, a) {
                                let _ =
                                    queries::record_play(&conn, track_id, None, duration_played);
                            }
                        }
                    }
                }
            }
        }
        _ => {
            tracing::warn!("Unknown entity type from server: {}", change.entity_type);
        }
    }
    Ok(())
}

/// Find a local track by title and artist metadata.
fn find_local_track_by_metadata(
    conn: &rusqlite::Connection,
    title: &str,
    artist: &str,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT id FROM tracks WHERE title = ?1 AND artist = ?2 LIMIT 1",
        rusqlite::params![title, artist],
        |row| row.get(0),
    )
    .map_err(|e| format!("Track not found: {}", e))
}

fn apply_settings_from_server(db: &Database, _settings: &serde_json::Value) -> Result<(), String> {
    // Settings sync will be fully implemented in Phase 2
    // For now, just log that we received settings
    tracing::info!("Received settings from server (not yet applied — Phase 2)");
    let _ = db; // suppress warning
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Translate a local entity_id (like "local_12" or "local_12_1147") to a server UUID.
/// Also updates payload fields that contain local IDs (e.g., playlistId).
fn translate_entity_id(
    conn: &rusqlite::Connection,
    entity_type: &str,
    local_entity_id: &str,
    payload: &mut serde_json::Value,
) -> String {
    match entity_type {
        "playlist" => {
            let raw_id = local_entity_id
                .strip_prefix("local_")
                .unwrap_or(local_entity_id);
            let server_id = queries::get_or_create_server_id(conn, raw_id, "playlist")
                .unwrap_or_else(|_| local_entity_id.to_string());

            // CRITICAL: Also update the playlists table so subsequent pull doesn't create a duplicate
            if let Ok(id) = raw_id.parse::<i64>() {
                let _ = queries::set_playlist_server_id(conn, id, &server_id);
            }

            server_id
        }
        "playlist_track" => {
            // entity_id format: "local_{playlist_id}_{track_id}" or "local_{playlist_id}_reorder"
            let stripped = local_entity_id
                .strip_prefix("local_")
                .unwrap_or(local_entity_id);
            // Generate a UUID for this playlist_track entry
            let pt_server_id = queries::get_or_create_server_id(conn, stripped, "playlist_track")
                .unwrap_or_else(|_| local_entity_id.to_string());

            // Also translate the playlistId in the payload
            if let Some(obj) = payload.as_object_mut() {
                if let Some(pl_id_val) = obj
                    .get("playlistId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                {
                    let raw_pl_id = pl_id_val.strip_prefix("local_").unwrap_or(&pl_id_val);
                    if let Ok(server_pl_id) =
                        queries::get_or_create_server_id(conn, raw_pl_id, "playlist")
                    {
                        obj.insert("playlistId".to_string(), serde_json::json!(server_pl_id));
                    }
                }
            }

            pt_server_id
        }
        "liked_track" => {
            // entity_id format: "local_liked_{track_id}"
            let stripped = local_entity_id.strip_prefix("local_liked_").unwrap_or(
                local_entity_id
                    .strip_prefix("local_")
                    .unwrap_or(local_entity_id),
            );
            let liked_local_key = format!("liked_{}", stripped);
            queries::get_or_create_server_id(conn, &liked_local_key, "liked_track")
                .unwrap_or_else(|_| local_entity_id.to_string())
        }
        "library_track" => {
            let stripped = local_entity_id.strip_prefix("local_lib_").unwrap_or(
                local_entity_id
                    .strip_prefix("local_")
                    .unwrap_or(local_entity_id),
            );
            let lib_local_key = format!("lib_{}", stripped);
            queries::get_or_create_server_id(conn, &lib_local_key, "library_track")
                .unwrap_or_else(|_| local_entity_id.to_string())
        }
        "play_history" => local_entity_id.to_string(),
        _ => {
            // Unknown entity type — pass through as-is
            local_entity_id.to_string()
        }
    }
}

/// Build a stable track hash for identifying tracks across devices.
/// Uses content_hash if available, otherwise falls back to "title|artist|album".
fn build_track_hash(track: &queries::Track) -> String {
    // Prefer the stable title|artist|album hash for cross-device matching
    format!(
        "{}|{}|{}",
        track.title.as_deref().unwrap_or(""),
        track.artist.as_deref().unwrap_or(""),
        track.album.as_deref().unwrap_or("")
    )
}

/// Get the current timestamp as an ISO string.
fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
