// Library-related Tauri commands
use crate::db::{queries, Database};
use crate::scanner::{cover_storage, extract_metadata, scan_directory};
use crate::security;
use base64::{engine::general_purpose::STANDARD, Engine};
use crossbeam::channel::{bounded, Receiver, Sender};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tauri::State;

/// Emitted per-batch during progressive rescan so the frontend can render
/// tracks as they arrive, without waiting for the full scan to complete.
#[derive(Debug, Serialize, Clone)]
pub struct ScanBatchEvent {
    pub tracks: Vec<queries::Track>,
    pub progress: ScanProgress,
}

#[derive(Debug, Serialize, Clone)]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub current_batch: usize,
    pub batch_size: usize,
    pub estimated_time_remaining_ms: u64,
    pub tracks_added: usize,
    pub tracks_updated: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanResult {
    pub tracks_added: usize,
    pub tracks_updated: usize,
    pub tracks_deleted: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn import_audio_file(
    file_path: String,
    overwrite: bool,
    db: State<'_, Database>,
) -> Result<queries::Track, String> {
    // Log received path for debugging
    eprintln!("[import_audio_file] received path: {}", file_path);

    let path_buf = PathBuf::from(&file_path);
    let canonical = path_buf.canonicalize().unwrap_or(path_buf.clone());
    let file_str = canonical.to_string_lossy().to_string();

    // Early existence check to provide clearer errors
    if !std::path::Path::new(&file_str).exists() {
        eprintln!("[import_audio_file] file does not exist: {}", file_str);
        return Err(format!("file_not_found: {}", file_str));
    }

    let track_data = crate::scanner::extract_metadata(&file_str)
        .ok_or_else(|| format!("Failed to extract metadata for {}", file_str))?;

    handle_track_import(db, track_data, overwrite).await
}

#[tauri::command]
pub async fn import_audio_bytes(
    filename: String,
    base64_data: String,
    overwrite: bool,
    db: State<'_, Database>,
) -> Result<queries::Track, String> {
    // Decode base64 payload
    let bytes = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Determine app base dir via cover storage helper
    let covers_dir = crate::scanner::cover_storage::get_covers_directory()
        .map_err(|e| format!("Failed to get covers dir: {}", e))?;
    let base_dir = covers_dir
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| covers_dir.clone());

    // Ensure imports directory
    let imports_dir = base_dir.join("imports");
    std::fs::create_dir_all(&imports_dir)
        .map_err(|e| format!("Failed to create imports dir: {}", e))?;

    let file_path = imports_dir.join(&filename);
    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Failed to write imported file: {}", e))?;

    let file_path_str = file_path.to_string_lossy().to_string();
    let track_data = crate::scanner::extract_metadata(&file_path_str)
        .ok_or_else(|| "Failed to extract metadata".to_string())?;

    handle_track_import(db, track_data, overwrite).await
}

async fn handle_track_import(
    db: State<'_, Database>,
    track_data: queries::TrackInsert,
    overwrite: bool,
) -> Result<queries::Track, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get current album matching mode
    let album_mode = queries::get_album_matching_mode(&conn);

    // Check duplicate by content_hash
    if let Some(ref hash) = track_data.content_hash {
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM tracks WHERE content_hash = ?1",
                rusqlite::params![hash],
                |row| row.get(0),
            )
            .ok();
        if exists.is_some() && !overwrite {
            return Err("duplicate".to_string());
        }
    }

    let (track_id, _was_new) = crate::db::queries::insert_or_update_track(&conn, &track_data, album_mode)
        .map_err(|e| format!("DB error: {e}"))?;

    if track_id == 0 {
        return Err("failed_to_insert".to_string());
    }

    // Save track cover if present
    let cover_path = if let Some(ref cover_bytes) = track_data.track_cover {
        match cover_storage::save_track_cover(track_id, cover_bytes) {
            Ok(p) => {
                let _ = queries::update_track_cover_path(&conn, track_id, Some(&p));
                Some(p)
            }
            Err(e) => {
                eprintln!("[Import] Failed to save track cover: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Save album art if present and album doesn't have one
    let album_id = conn
        .query_row(
            "SELECT album_id FROM tracks WHERE id = ?1",
            [track_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .unwrap_or(None);

    if let Some(id) = album_id {
        if let Some(ref art_bytes) = track_data.album_art {
            let has_art: bool = conn
                .query_row(
                    "SELECT art_path IS NOT NULL FROM albums WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !has_art {
                if let Ok(p) = cover_storage::save_album_art(id, art_bytes) {
                    let _ = queries::update_album_art_path(&conn, id, Some(&p));
                }
            }
        }
    }

    // Return the full track object for the frontend
    let track = queries::Track {
        id: track_id,
        path: track_data.path.clone(),
        title: track_data.title.clone(),
        artist: track_data.artist.clone(),
        album: track_data.album.clone(),
        album_artist: track_data.album_artist.clone(),
        track_number: track_data.track_number,
        duration: track_data.duration,
        album_id,
        format: track_data.format.clone(),
        bitrate: track_data.bitrate,
        source_type: track_data.source_type.clone(),
        cover_url: track_data.cover_url.clone(),
        external_id: track_data.external_id.clone(),
        local_src: track_data.local_src.clone(),
        track_cover: None, // Frontend uses track_cover_path via convertFileSrc
        track_cover_path: cover_path,
        disc_number: track_data.disc_number,
    };

    Ok(track)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Library {
    pub tracks: Vec<queries::Track>,
    pub albums: Vec<queries::Album>,
    pub artists: Vec<queries::Artist>,
}

/// Adaptive batch sizing for rescan_music
fn calculate_batch_size(
    tracks_processed: usize,
    _total_tracks: usize,
    queue_depth: usize,
) -> usize {
    if tracks_processed == 0 {
        return 20; // instant first batch
    }

    let base_size = if tracks_processed < 500 {
        25 + (tracks_processed / 20) // 25 → 50
    } else if tracks_processed < 2000 {
        50 + ((tracks_processed - 500) / 30) // 50 → 100
    } else {
        100 + ((tracks_processed - 2000) / 200).min(50) // 100 → 150
    };

    let adjusted = if queue_depth > base_size * 3 {
        (base_size as f32 * 1.5) as usize // back-pressure: bigger batches
    } else if queue_depth < base_size / 2 {
        (base_size as f32 * 0.8) as usize // draining fast: smaller for smoother UI
    } else {
        base_size
    };

    adjusted.clamp(20, 200)
}

#[tauri::command]
pub async fn scan_music(paths: Vec<String>, db: State<'_, Database>) -> Result<ScanResult, String> {
    let mut tracks_added = 0;
    let mut tracks_updated = 0;
    let mut errors = Vec::new();

    // Use spawn_blocking for the file system scanning and metadata extraction
    // This prevents blocking the Tauri async executor's threads
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);

    for path in paths.clone() {
        let db_clone = db.inner().clone();
        let path_clone = path.clone();
        let tx_clone = tx.clone();

        tokio::task::spawn_blocking(move || {
            let scan_result = scan_directory(&path_clone);
            let conn = db_clone.conn.lock().unwrap();

            let album_mode = queries::get_album_matching_mode(&conn);

            // Add folder to database
            let _ = queries::add_music_folder(&conn, &path_clone);

            for file_path in scan_result.audio_files {
                if let Some(track_data) = extract_metadata(&file_path) {
                    match queries::insert_or_update_track(&conn, &track_data, album_mode) {
                        Ok((track_id, was_new)) => {
                            if track_id > 0 {
                                // Track the operation type
                                let result = if was_new { 1 } else { 0 };

                                // Save track cover if present
                                if let Some(ref cover_bytes) = track_data.track_cover {
                                    let _ = cover_storage::save_track_cover(track_id, cover_bytes)
                                        .map(|p| {
                                            let _ = queries::update_track_cover_path(
                                                &conn,
                                                track_id,
                                                Some(&p),
                                            );
                                        });
                                }

                                // Save album art if present and album doesn't have one
                                if let Some(album_id) = track_data.album.as_ref().and_then(|_| {
                                    conn.query_row(
                                        "SELECT album_id FROM tracks WHERE id = ?1",
                                        [track_id],
                                        |row| row.get::<_, Option<i64>>(0),
                                    )
                                    .ok()
                                    .flatten()
                                }) {
                                    if let Some(ref art_bytes) = track_data.album_art {
                                        let has_art: bool = conn
                                            .query_row(
                                                "SELECT art_path IS NOT NULL FROM albums WHERE id = ?1",
                                                [album_id],
                                                |row| row.get(0),
                                            )
                                            .unwrap_or(false);

                                        if !has_art {
                                            let _ =
                                                cover_storage::save_album_art(album_id, art_bytes)
                                                    .map(|p| {
                                                        let _ = queries::update_album_art_path(
                                                            &conn,
                                                            album_id,
                                                            Some(&p),
                                                        );
                                                    });
                                        }
                                    }
                                }

                                let _ = tx_clone.blocking_send(Ok((result, 0)));
                            }
                        }
                        Err(e) => {
                            let _ = tx_clone.blocking_send(Err(e.to_string()));
                        }
                    }
                }
            }
            let _ = queries::update_folder_last_scanned(&conn, &path_clone);
        });
    }

    drop(tx); // Close sender so receiver finishes

    while let Some(res) = rx.recv().await {
        match res {
            Ok((added, updated)) => {
                tracks_added += added;
                tracks_updated += updated;
            }
            Err(e) => errors.push(e),
        }
    }

    // Cleanup after scan
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tracks_deleted = queries::cleanup_deleted_tracks(&conn, &paths).unwrap_or_else(|e| {
        errors.push(format!("Failed to cleanup deleted tracks: {}", e));
        0
    });
    let _ = queries::cleanup_empty_albums(&conn);

    Ok(ScanResult {
        tracks_added,
        tracks_updated,
        tracks_deleted,
        errors,
    })
}

/// Add a music folder with path validation
#[tauri::command]
pub async fn add_folder(path: String, db: State<'_, Database>) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);

    // Validate path exists and is a directory
    if !path_buf.exists() {
        return Err("Invalid path: Does not exist".to_string());
    }

    if !path_buf.is_dir() {
        return Err("Invalid path: Not a directory".to_string());
    }

    // Canonicalize path to prevent traversal/obfuscation
    let canonical_path = path_buf
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {}", e))?;

    let path_str = canonical_path.to_string_lossy().to_string();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::add_music_folder(&conn, &path_str)
        .map_err(|e| format!("Failed to add folder: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn rescan_music(
    window: tauri::Window,
    db: State<'_, Database>,
) -> Result<ScanResult, String> {
    let total_start = Instant::now();

    // 1: Cleanup
    let (folders, tracks_deleted) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Get all scanned folders
        let folders = queries::get_music_folders(&conn).map_err(|e| e.to_string())?;

        let tracks_deleted = queries::cleanup_deleted_tracks(&conn, &folders)
            .map_err(|e| format!("Failed to cleanup deleted tracks: {}", e))?;

        // Clean up empty albums after track cleanup
        let _ = queries::cleanup_empty_albums(&conn);

        (folders, tracks_deleted)
    }; // conn dropped here

    // 2: Directory walk
    let mut all_files = Vec::new();
    let mut scan_errors = Vec::new();

    for folder in &folders {
        let result = scan_directory(folder);
        all_files.extend(result.audio_files);
        scan_errors.extend(result.errors);
    }

    let total_files = all_files.len();

    if total_files == 0 {
        return Ok(ScanResult {
            tracks_added: 0,
            tracks_updated: 0,
            tracks_deleted,
            errors: scan_errors,
        });
    }

    // 3: Parallel metadata extraction
    let (tx, rx): (Sender<queries::TrackInsert>, Receiver<queries::TrackInsert>) = bounded(500);
    let extracted_count = Arc::new(AtomicUsize::new(0));
    let extracted_count_clone = extracted_count.clone();

    std::thread::spawn(move || {
        all_files.par_iter().for_each(|file_path| {
            if let Some(track_data) = extract_metadata(file_path) {
                let _ = tx.send(track_data);
                extracted_count_clone.fetch_add(1, Ordering::Relaxed);
            }
        });
    });

    // 4: Batch assembly + DB writes + frontend updates
    let window_clone = window.clone();
    let db_conn = Arc::clone(&db.conn);
    let folders_clone = folders.clone();
    let total_start_clone = total_start;

    let batch_result = tauri::async_runtime::spawn_blocking(move || {
        let mut tracks_added = 0usize;
        let mut tracks_updated = 0usize;
        let mut batches_sent = 0usize;
        let mut tracks_sent = 0usize;
        let mut errors = Vec::new();
        let mut pending = Vec::new();

        let mut conn = db_conn.lock().unwrap();
        let album_mode = queries::get_album_matching_mode(&conn);

        loop {
            // Collect one batch from the channel
            let queue_depth = rx.len();
            let batch_size = calculate_batch_size(tracks_sent, total_files, queue_depth);

            while pending.len() < batch_size {
                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(track_data) => pending.push(track_data),
                    Err(_) => {
                        // If extraction is done, stop waiting
                        if extracted_count.load(Ordering::Relaxed) >= total_files {
                            break;
                        }
                    }
                }
            }

            if pending.is_empty() {
                break; // nothing left anywhere
            }

            // Single transaction for the whole batch
            let tx_db = conn.transaction().unwrap();
            let mut batch_tracks = Vec::new();

            for track_data in &pending {
                match queries::insert_or_update_track(&tx_db, track_data, album_mode) {
                    Ok((track_id, was_new)) if track_id > 0 => {
                        if was_new {
                            tracks_added += 1;
                        } else {
                            tracks_updated += 1;
                        }

                        // Save track cover
                        let cover_path = track_data.track_cover.as_ref().and_then(|bytes| {
                            cover_storage::save_track_cover(track_id, bytes).ok()
                        });

                        if let Some(ref path) = cover_path {
                            if let Err(e) =
                                queries::update_track_cover_path(&tx_db, track_id, Some(path))
                            {
                                errors.push(format!(
                                    "Cover path update failed for track {}: {}",
                                    track_id, e
                                ));
                            }
                        }

                        // Save album art (only if the album doesn't have one yet)
                        if let Some(album_id) = track_data.album.as_ref().and_then(|_| {
                            tx_db
                                .query_row(
                                    "SELECT album_id FROM tracks WHERE id = ?1",
                                    [track_id],
                                    |row| row.get::<_, Option<i64>>(0),
                                )
                                .ok()
                                .flatten()
                        }) {
                            if let Some(ref art_bytes) = track_data.album_art {
                                let has_art: bool = tx_db
                                    .query_row(
                                        "SELECT art_path IS NOT NULL FROM albums WHERE id = ?1",
                                        [album_id],
                                        |row| row.get(0),
                                    )
                                    .unwrap_or(false);

                                if !has_art {
                                    match cover_storage::save_album_art(album_id, art_bytes) {
                                        Ok(art_path) => {
                                            if let Err(e) = queries::update_album_art_path(
                                                &tx_db,
                                                album_id,
                                                Some(&art_path),
                                            ) {
                                                errors.push(format!(
                                                    "Art path update failed for album {}: {}",
                                                    album_id, e
                                                ));
                                            }
                                        }
                                        Err(e) => errors.push(format!(
                                            "Album art save failed for album {}: {}",
                                            album_id, e
                                        )),
                                    }
                                }
                            }
                        }

                        // Build Track struct for frontend
                        let album_id = tx_db
                            .query_row(
                                "SELECT album_id FROM tracks WHERE id = ?1",
                                [track_id],
                                |row| row.get::<_, Option<i64>>(0),
                            )
                            .ok()
                            .flatten();

                        batch_tracks.push(queries::Track {
                            id: track_id,
                            path: track_data.path.clone(),
                            title: track_data.title.clone(),
                            artist: track_data.artist.clone(),
                            album: track_data.album.clone(),
                            album_artist: track_data.album_artist.clone(),
                            track_number: track_data.track_number,
                            duration: track_data.duration,
                            album_id,
                            format: track_data.format.clone(),
                            bitrate: track_data.bitrate,
                            source_type: track_data.source_type.clone(),
                            cover_url: track_data.cover_url.clone(),
                            external_id: track_data.external_id.clone(),
                            local_src: track_data.local_src.clone(),
                            track_cover: None,
                            track_cover_path: cover_path,
                            disc_number: track_data.disc_number,
                        });
                    }
                    Ok(_) => {}
                    Err(e) => errors.push(format!("Insert failed for {}: {}", track_data.path, e)),
                }
            }

            tx_db.commit().unwrap();

            // Emit batch to frontend
            tracks_sent += batch_tracks.len();
            batches_sent += 1;

            let elapsed_ms = total_start_clone.elapsed().as_millis() as u64;
            let avg_ms_per_track = if tracks_sent > 0 {
                elapsed_ms / tracks_sent as u64
            } else {
                0
            };
            let eta_ms = total_files.saturating_sub(tracks_sent) as u64 * avg_ms_per_track;

            let _ = window_clone.emit(
                "scan-batch-ready",
                ScanBatchEvent {
                    tracks: batch_tracks,
                    progress: ScanProgress {
                        current: tracks_sent,
                        total: total_files,
                        current_batch: batches_sent,
                        batch_size: pending.len(),
                        estimated_time_remaining_ms: eta_ms,
                        tracks_added,
                        tracks_updated,
                    },
                },
            );

            pending.clear();

            if tracks_sent >= total_files {
                break;
            }
        }

        // Update folder timestamps
        for folder in &folders_clone {
            if let Err(e) = queries::update_folder_last_scanned(&conn, folder) {
                errors.push(format!("Scan time update failed for {}: {}", folder, e));
            }
        }

        (tracks_added, tracks_updated, batches_sent, errors)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (tracks_added, tracks_updated, _batches_sent, mut errors) = batch_result;
    errors.extend(scan_errors);

    let conn_cleanup = Arc::clone(&db.conn);
    if let Ok(conn) = conn_cleanup.lock() {
        let cleanup_start = std::time::Instant::now();
        let _ = queries::cleanup_empty_albums(&conn);
        println!("[TIMING] cleanup_empty_albums (start) took {:?}", cleanup_start.elapsed());
    }

    // Emit completion event
    let _ = window.emit(
        "scan-complete",
        ScanResult {
            tracks_added,
            tracks_updated,
            tracks_deleted,
            errors: errors.clone(),
        },
    );

    // Background orphan cleanup (non-blocking)
    let db_conn_cleanup = Arc::clone(&db.conn);
    tauri::async_runtime::spawn(async move {
        if let Ok(conn) = db_conn_cleanup.lock() {
            let _ = cover_storage::cleanup_orphaned_covers(&conn);
        }
    });

    Ok(ScanResult {
        tracks_added,
        tracks_updated,
        tracks_deleted,
        errors,
    })
}

#[tauri::command]
pub async fn get_library(db: State<'_, Database>) -> Result<Library, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Ensure FTS is initialized on first load
    let _ = queries::init_fts(&conn);

    // Fetch tracks WITHOUT cover data (ultra-fast)
    let tracks = queries::get_all_tracks_with_paths(&conn).map_err(|e| e.to_string())?;

    // Fetch albums WITHOUT art data (fast)
    let albums = queries::get_all_albums_with_paths(&conn).map_err(|e| e.to_string())?;

    // Fetch artists
    let artists = queries::get_all_artists(&conn).map_err(|e| e.to_string())?;

    // Background orphan cleanup
    let db_conn_cleanup = db.conn.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(conn) = db_conn_cleanup.lock() {
            let _ = cover_storage::cleanup_orphaned_covers(&conn);
        }
    });

    Ok(Library {
        tracks,
        albums,
        artists,
    })
}

#[tauri::command]
pub async fn get_tracks_paginated(
    limit: i32,
    offset: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_tracks_paginated(&conn, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_albums_paginated(
    limit: i32,
    offset: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::Album>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_albums_paginated(&conn, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_album_matching_mode(
    mode: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    
    let matching_mode = match mode.as_str() {
        "name_and_artist" => queries::AlbumMatchingMode::NameAndArtist,
        _ => queries::AlbumMatchingMode::NameOnly,
    };
    
    queries::set_album_matching_mode(&conn, matching_mode)
        .map_err(|e| format!("Failed to set album matching mode: {}", e))
}

#[tauri::command]
pub async fn search_library(
    query: String,
    limit: i32,
    offset: i32,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::search_tracks(&conn, &query, limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tracks_by_album(
    album_id: i64,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_tracks_by_album(&conn, album_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tracks_by_artist(
    artist: String,
    db: State<'_, Database>,
) -> Result<Vec<queries::Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_tracks_by_artist(&conn, &artist).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_album(
    album_id: i64,
    db: State<'_, Database>,
) -> Result<Option<queries::Album>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    queries::get_album_by_id(&conn, album_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_albums_by_artist(
    artist: String,
    db: State<'_, Database>,
) -> Result<Vec<queries::Album>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT a.id, a.name, a.album_artist, a.art_data, a.art_path 
             FROM albums a
             INNER JOIN tracks t ON t.album_id = a.id
             WHERE t.album_artist = ?1
             ORDER BY a.name",
        )
        .map_err(|e| e.to_string())?;

    let albums = stmt
        .query_map([&artist], |row| {
            Ok(queries::Album {
                id: row.get(0)?,
                name: row.get(1)?,
                album_artist: row.get(2)?,
                art_data: row.get(3)?,
                art_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(albums)
}

/// Delete a track from the library (moves file to trash for safety)
#[tauri::command]
pub async fn delete_track(track_id: i64, db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get track info before deletion
    let track_info: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT path, source_type, track_cover_path FROM tracks WHERE id = ?1",
            [track_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    if let Some((path, source_type, cover_path)) = track_info {
        // Only delete file if it's a local track
        let is_local = source_type.is_none() || source_type.as_deref() == Some("local");

        if is_local {
            let path_obj = std::path::Path::new(&path);
            // Use secure deletion (moves to trash with path validation)
            if let Err(e) = security::safe_delete_file(path_obj) {
                log::error!("[AUDIT] Failed to delete track file {}: {}", path, e);
                // Continue to delete from DB even if file deletion fails
            }
        }

        // Delete cover file
        let _ = cover_storage::delete_track_cover_file(cover_path.as_deref());
    }

    let result = queries::delete_track(&conn, track_id)
        .map_err(|e| format!("Failed to delete track: {}", e))?;

    // Clean up empty albums after track deletion
    let _ = queries::cleanup_empty_albums(&conn);

    log::info!("[AUDIT] Track {} deleted from library", track_id);
    Ok(result)
}

/// Delete an album and all its tracks (moves files to trash for safety)
#[tauri::command]
pub async fn delete_album(album_id: i64, db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get album art path before deletion
    let art_path: Option<String> = conn
        .query_row(
            "SELECT art_path FROM albums WHERE id = ?1",
            [album_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    // Get all tracks for this album to delete files
    let tracks = queries::get_tracks_by_album(&conn, album_id).map_err(|e| e.to_string())?;

    log::info!(
        "[AUDIT] Deleting album {} with {} tracks",
        album_id,
        tracks.len()
    );

    for track in tracks {
        // Only delete file if it's a local track
        let is_local = track.source_type.is_none() || track.source_type.as_deref() == Some("local");

        if is_local {
            let path_obj = std::path::Path::new(&track.path);
            // Use secure deletion (moves to trash with path validation)
            if let Err(e) = security::safe_delete_file(path_obj) {
                log::error!("[AUDIT] Failed to delete track file {}: {}", track.path, e);
                // Continue with other tracks
            }
        }

        // Delete track cover file
        let _ = cover_storage::delete_track_cover_file(track.track_cover_path.as_deref());
    }

    // Delete album art file
    let _ = cover_storage::delete_album_art_file(art_path.as_deref());

    let result = queries::delete_album(&conn, album_id)
        .map_err(|e| format!("Failed to delete album: {}", e))?;

    log::info!("[AUDIT] Album {} deleted from library", album_id);
    Ok(result)
}

/// Input for adding an external (streaming) track to the library
#[derive(Debug, Serialize, Deserialize)]
pub struct ExternalTrackInput {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration: Option<i32>,
    pub cover_url: Option<String>,
    pub source_type: String, // e.g., "tidal", "url"
    pub external_id: String, // Source-specific ID (e.g., Tidal track ID)
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub stream_url: Option<String>, // The decoded stream URL
}

/// Add an external (streaming) track to the library
/// If stream_url is provided, use it as the path (for direct playback)
/// Otherwise, construct path as "{source_type}://{external_id}" for uniqueness
#[tauri::command]
pub async fn add_external_track(
    track: ExternalTrackInput,
    db: State<'_, Database>,
) -> Result<i64, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let album_mode = queries::get_album_matching_mode(&conn);

    // Use stream_url as path if provided, otherwise construct from source_type://external_id
    let path = track
        .stream_url
        .clone()
        .unwrap_or_else(|| format!("{}://{}", track.source_type, track.external_id));

    // Generate content hash for external tracks
    let mut hasher = DefaultHasher::new();
    let combined = format!(
        "{}|{}|{}|{}",
        track.title.trim().to_lowercase(),
        track.artist.trim().to_lowercase(),
        track.album.as_deref().unwrap_or("").trim().to_lowercase(),
        track.duration.map(|d| d.to_string()).unwrap_or_default()
    );
    combined.hash(&mut hasher);
    let content_hash = Some(format!("{:016x}", hasher.finish()));

    // Clone artist once to use for both fields
    let artist_value = Some(track.artist);

    let track_insert = queries::TrackInsert {
        path,
        title: Some(track.title),
        artist: artist_value.clone(),           
        album: track.album,
        album_artist: artist_value,            
        track_number: None,
        disc_number: None,
        duration: track.duration,
        album_art: None,   // External tracks use cover_url instead
        track_cover: None, // External tracks use cover_url instead
        format: track.format,
        bitrate: track.bitrate,
        source_type: Some(track.source_type),
        cover_url: track.cover_url,
        external_id: Some(track.external_id),
        content_hash,
        local_src: None,
    };

    queries::insert_or_update_track(&conn, &track_insert, album_mode)
        .map(|(track_id, _was_new)| track_id)
        .map_err(|e| format!("Failed to add external track: {}", e))
}

/// Reset the database by clearing all data
#[tauri::command]
pub async fn reset_database(db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute_batch(
        "
        DELETE FROM playlist_tracks;
        DELETE FROM playlists;
        DELETE FROM tracks;
        DELETE FROM albums;
        DELETE FROM music_folders;
        ",
    )
    .map_err(|e| format!("Failed to reset database: {}", e))?;

    Ok(())
}

/// Return a list of default music directories that exist on this device.
/// On Android this checks common paths like /storage/emulated/0/Music, Download, etc.
/// On desktop this checks the user's Music directory.
#[tauri::command]
pub fn get_default_music_dirs() -> Vec<String> {
    let mut dirs = Vec::new();

    // Standard dirs crate paths
    if let Some(audio_dir) = dirs::audio_dir() {
        if audio_dir.is_dir() {
            dirs.push(audio_dir.to_string_lossy().to_string());
        }
    }

    // Home directory based paths
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join("Music"),
            home.join("music"),
            home.join("Download"),
            home.join("Downloads"),
        ];
        for c in &candidates {
            if c.is_dir() {
                let s = c.to_string_lossy().to_string();
                if !dirs.contains(&s) {
                    dirs.push(s);
                }
            }
        }
    }

    // Android-specific external storage paths
    #[cfg(target_os = "android")]
    {
        let android_paths = [
            "/storage/emulated/0/Music",
            "/storage/emulated/0/Download",
            "/storage/emulated/0/Downloads",
            "/storage/emulated/0/DCIM",
            "/sdcard/Music",
            "/sdcard/Download",
        ];
        for p in &android_paths {
            let path = std::path::PathBuf::from(p);
            if path.is_dir() {
                let s = path.to_string_lossy().to_string();
                if !dirs.contains(&s) {
                    dirs.push(s);
                }
            }
        }
    }

    dirs
}
