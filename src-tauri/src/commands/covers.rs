// Cover management Tauri commands
use crate::db::{queries, Database};
use crate::scanner::cover_storage::{
    cleanup_orphaned_covers, get_album_art_file_path, get_track_cover_file_path,
    save_album_art_from_base64, save_track_cover_from_base64,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::State;
use std::io::Read;
use sha2::{Sha256, Digest};
use rayon::prelude::*;
use crossbeam::channel::{bounded, Sender, Receiver};
use std::sync::{Arc};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;
use tauri::Emitter;

// Progress Tracking
#[derive(Debug, Serialize, Clone)]
pub struct MigrationBatchEvent {
    pub items: Vec<MigrationItem>,
    pub progress: MigrationProgressUpdate,
}

#[derive(Debug, Serialize, Clone)]
pub struct MigrationItem {
    pub id: i64,
    pub item_type: String, // "track" or "album"
    pub path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct MigrationProgressUpdate {
    pub current: usize,
    pub total: usize,
    pub current_batch: usize,
    pub batch_size: usize,
    pub estimated_time_remaining_ms: u64,
    pub tracks_migrated: usize,
    pub albums_migrated: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MigrationProgress {
    pub total: usize,
    pub processed: usize,
    pub tracks_migrated: usize,
    pub albums_migrated: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MergeBatchEvent {
    pub progress: MergeProgressUpdate,
}

#[derive(Debug, Serialize, Clone)]
pub struct MergeProgressUpdate {
    pub current_album: usize,
    pub total_albums: usize,
    pub covers_merged: usize,
    pub space_saved_bytes: u64,
    pub estimated_time_remaining_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergeCoverResult {
    pub covers_merged: usize,
    pub space_saved_bytes: u64,
    pub albums_processed: usize,
    pub errors: Vec<String>,
}

// Helper trait for cleaner error conversion
trait ToStringErr<T> {
    fn to_str_err(self) -> Result<T, String>;
}

impl<T, E: std::fmt::Display> ToStringErr<T> for Result<T, E> {
    fn to_str_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

// Calculate optimal batch size based on progress and queue depth
fn calculate_batch_size(
    items_processed: usize,
    total_items: usize,
    queue_depth: usize,
) -> usize {
    if items_processed == 0 {
        return 20; // instant first batch
    }

    let base_size = if items_processed < 500 {
        25 + (items_processed / 20)          // 25 → 50
    } else if items_processed < 2000 {
        50 + ((items_processed - 500) / 30)  // 50 → 100
    } else {
        100 + ((items_processed - 2000) / 200).min(50) // 100 → 150
    };

    let adjusted = if queue_depth > base_size * 3 {
        (base_size as f32 * 1.5) as usize   // back-pressure: bigger batches
    } else if queue_depth < base_size / 2 {
        (base_size as f32 * 0.8) as usize   // draining fast: smaller for smoother UI
    } else {
        base_size
    };

    adjusted.clamp(20, 200)
}

// Migration
enum MigrationWorkItem {
    Track(i64, String),  // (track_id, base64_data)
    Album(i64, String),  // (album_id, base64_data)
}

struct MigrationResult {
    id: i64,
    path: String,
    item_type: String,
}

/// Migrate all existing base64 covers to files
#[tauri::command]
pub async fn migrate_covers_to_files(
    window: tauri::Window,
    db: State<'_, Database>,
) -> Result<MigrationProgress, String> {
    println!("[MIGRATION] Starting cover migration...");
    let total_start = Instant::now();

    // 1: Fetch all items to migrate (with lock)
    let (tracks, albums) = {
        let conn = db.conn.lock().to_str_err()?;
        
        println!("[MIGRATION] Fetching tracks from database...");
        let mut stmt = conn.prepare(
            "SELECT id, track_cover FROM tracks WHERE track_cover IS NOT NULL AND track_cover_path IS NULL"
        ).to_str_err()?;
        
        let tracks: Vec<(i64, String)> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .to_str_err()?
        .filter_map(|r| r.ok())
        .collect();
        
        println!("[MIGRATION] Found {} tracks to migrate", tracks.len());

        println!("[MIGRATION] Fetching albums from database...");
        let mut stmt = conn.prepare(
            "SELECT id, art_data FROM albums WHERE art_data IS NOT NULL AND art_path IS NULL"
        ).to_str_err()?;
        
        let albums: Vec<(i64, String)> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .to_str_err()?
        .filter_map(|r| r.ok())
        .collect();
        
        println!("[MIGRATION] Found {} albums to migrate", albums.len());
        
        (tracks, albums)
    }; // Lock released here

    let total_items = tracks.len() + albums.len();

    if total_items == 0 {
        return Ok(MigrationProgress {
            total: 0,
            processed: 0,
            tracks_migrated: 0,
            albums_migrated: 0,
            errors: Vec::new(),
        });
    }

    // 2: Parallel extraction (base64 decode + file write)
    let (tx, rx): (Sender<MigrationResult>, Receiver<MigrationResult>) = bounded(500);
    let extracted_count = Arc::new(AtomicUsize::new(0));
    let extracted_count_for_spawn = extracted_count.clone();
    let extracted_count_for_batch = extracted_count.clone();

    // Combine tracks and albums into work items
    let mut work_items = Vec::with_capacity(total_items);
    for (track_id, data) in tracks {
        work_items.push(MigrationWorkItem::Track(track_id, data));
    }
    for (album_id, data) in albums {
        work_items.push(MigrationWorkItem::Album(album_id, data));
    }

    std::thread::spawn(move || {
        work_items.par_iter().for_each(|item| {
            let result = match item {
                MigrationWorkItem::Track(track_id, cover_data) => {
                    save_track_cover_from_base64(*track_id, cover_data)
                        .ok()
                        .map(|path| MigrationResult {
                            id: *track_id,
                            path,
                            item_type: "track".to_string(),
                        })
                }
                MigrationWorkItem::Album(album_id, art_data) => {
                    save_album_art_from_base64(*album_id, art_data)
                        .ok()
                        .map(|path| MigrationResult {
                            id: *album_id,
                            path,
                            item_type: "album".to_string(),
                        })
                }
            };

            if let Some(res) = result {
                let _ = tx.send(res);
                extracted_count_for_spawn.fetch_add(1, Ordering::Relaxed);
            }
        });
    });

    // 3: Batch assembly  db writes ,frontend updates
    let window_clone = window.clone();
    let db_conn = Arc::clone(&db.conn);
    let total_start_clone = total_start;

    let batch_result = tauri::async_runtime::spawn_blocking(move || {
        let mut tracks_migrated = 0usize;
        let mut albums_migrated = 0usize;
        let mut batches_sent = 0usize;
        let mut items_sent = 0usize;
        let mut errors = Vec::new();
        let mut pending = Vec::new();

        let mut conn = db_conn.lock().unwrap();

        loop {
            // Adaptive batch sizing based on queue depth
            let queue_depth = rx.len();
            let batch_size = calculate_batch_size(items_sent, total_items, queue_depth);

            // Collect one batch from the channel
            while pending.len() < batch_size {
                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(result) => pending.push(result),
                    Err(_) => {
                        // If extraction is done, stop waiting
                        if extracted_count_for_batch.load(Ordering::Relaxed) >= total_items {
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
            let mut batch_items = Vec::new();

            for result in &pending {
                let update_result = if result.item_type == "track" {
                    queries::update_track_cover_path(&tx_db, result.id, Some(&result.path))
                        .map(|_| {
                            tracks_migrated += 1;
                            "track"
                        })
                } else {
                    queries::update_album_art_path(&tx_db, result.id, Some(&result.path))
                        .map(|_| {
                            albums_migrated += 1;
                            "album"
                        })
                };

                match update_result {
                    Ok(_) => {
                        batch_items.push(MigrationItem {
                            id: result.id,
                            item_type: result.item_type.clone(),
                            path: result.path.clone(),
                        });
                    }
                    Err(e) => {
                        errors.push(format!(
                            "Failed to update {} {}: {}",
                            result.item_type, result.id, e
                        ));
                    }
                }
            }

            tx_db.commit().unwrap();

            // Emit batch to frontend with progress
            items_sent += batch_items.len();
            batches_sent += 1;

            let elapsed_ms = total_start_clone.elapsed().as_millis() as u64;
            let avg_ms_per_item = if items_sent > 0 {
                elapsed_ms / items_sent as u64
            } else {
                0
            };
            let eta_ms = total_items.saturating_sub(items_sent) as u64 * avg_ms_per_item;

            let _ = window_clone.emit("migration-batch-ready", MigrationBatchEvent {
                items: batch_items,
                progress: MigrationProgressUpdate {
                    current: items_sent,
                    total: total_items,
                    current_batch: batches_sent,
                    batch_size: pending.len(),
                    estimated_time_remaining_ms: eta_ms,
                    tracks_migrated,
                    albums_migrated,
                },
            });

            pending.clear();

            if items_sent >= total_items {
                break;
            }
        }

        (tracks_migrated, albums_migrated, errors)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (tracks_migrated, albums_migrated, errors) = batch_result;

    let elapsed = total_start.elapsed();
    
    println!("[MIGRATION] MIGRATION COMPLETE");
    
    println!("[MIGRATION]   Total processed: {}", tracks_migrated + albums_migrated);
    println!("[MIGRATION]   Tracks migrated: {}", tracks_migrated);
    println!("[MIGRATION]   Albums migrated: {}", albums_migrated);
    println!("[MIGRATION]   Errors: {}", errors.len());
    println!("[MIGRATION]   Duration: {:.2}s", elapsed.as_secs_f64());
    println!("[MIGRATION]   Throughput: {:.2} items/sec", 
             (tracks_migrated + albums_migrated) as f64 / elapsed.as_secs_f64());

    // Emit completion event
    let _ = window.emit("migration-complete", MigrationProgress {
        total: total_items,
        processed: tracks_migrated + albums_migrated,
        tracks_migrated,
        albums_migrated,
        errors: errors.clone(),
    });

    // Cleanup :
    drop(extracted_count);

    Ok(MigrationProgress {
        total: total_items,
        processed: tracks_migrated + albums_migrated,
        tracks_migrated,
        albums_migrated,
        errors,
    })
}

// Merge Duplicates
struct AlbumCoverGroup {
    album_name: String,
    cover_groups: HashMap<String, Vec<(String, u64)>>, // hash -> [(path, size)]
    filepath_to_tracks: HashMap<String, Vec<i64>>,
}

/// Merge duplicate covers
#[tauri::command]
pub async fn merge_duplicate_covers(
    window: tauri::Window,
    db: State<'_, Database>,
) -> Result<MergeCoverResult, String> {
    println!("[MERGE] Starting cover merge...");
    let total_start = Instant::now();

    let mut errors = Vec::new();

    // 1: Get all albums
    let albums = {
        let conn = db.conn.lock().to_str_err()?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT album, album_id FROM tracks WHERE album IS NOT NULL")
            .to_str_err()?;

        let albums: Vec<(String, Option<i64>)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
            })
            .to_str_err()?
            .filter_map(|r| r.ok())
            .collect();

        println!("[MERGE] Found {} albums to process", albums.len());
        albums
    };

    let total_albums = albums.len();
    let albums_processed = Arc::new(AtomicUsize::new(0));

    // 2: album analysis
    let (tx, rx): (Sender<AlbumCoverGroup>, Receiver<AlbumCoverGroup>) = bounded(100);
    let albums_processed_for_thread = albums_processed.clone();
    let tx_for_spawn = tx.clone();
    let db_clone = db.inner().clone();

    std::thread::spawn(move || {
        albums.par_iter().for_each(|(album_name, _album_id)| {
            let album_count = albums_processed_for_thread.fetch_add(1, Ordering::Relaxed) + 1;

            if album_count % 50 == 0 {
                println!("[MERGE] Analyzed {} / {} albums...", album_count, total_albums);
            }

            // Get all tracks for this album with cover paths
            let tracks = {
                let conn = db_clone.conn.lock().unwrap();
                let mut track_stmt = conn
                    .prepare(
                        "SELECT id, track_cover_path FROM tracks 
                         WHERE album = ? AND track_cover_path IS NOT NULL AND track_cover_path != ''"
                    )
                    .unwrap();

                let tracks: Vec<(i64, String)> = track_stmt
                    .query_map([&album_name], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect();

                tracks
            };

            if tracks.len() < 2 {
                return;
            }

            // Group by filepath
            let mut filepath_to_tracks: HashMap<String, Vec<i64>> = HashMap::new();
            for (track_id, cover_path) in &tracks {
                filepath_to_tracks
                    .entry(cover_path.clone())
                    .or_insert_with(Vec::new)
                    .push(*track_id);
            }

            let unique_covers: Vec<String> = filepath_to_tracks.keys().cloned().collect();

            if unique_covers.len() < 2 {
                return;
            }

            // Pre-filter by size
            let mut size_groups: HashMap<u64, Vec<(String, u64)>> = HashMap::new();

            for cover_path in unique_covers {
                if let Ok(metadata) = fs::metadata(&cover_path) {
                    let size = metadata.len();
                    let size_key = size / 1024; // Round to nearest KB
                    size_groups
                        .entry(size_key)
                        .or_insert_with(Vec::new)
                        .push((cover_path, size));
                }
            }

            // Only hash files with potential duplicates (2+ files same size)
            let files_to_hash: Vec<(String, u64)> = size_groups
                .into_iter()
                .filter(|(_, group)| group.len() >= 2)
                .flat_map(|(_, group)| group)
                .collect();

            if files_to_hash.is_empty() {
                return;
            }

            // hash within this album
            let cover_groups: HashMap<String, Vec<(String, u64)>> = files_to_hash
                .par_iter()
                .filter_map(|(path, size)| get_file_hash(path).ok().map(|hash| (hash, (path.clone(), *size))))
                .fold(
                    || HashMap::new(),
                    |mut acc, (hash, file)| {
                        acc.entry(hash).or_insert_with(Vec::new).push(file);
                        acc
                    },
                )
                .reduce(
                    || HashMap::new(),
                    |mut a, b| {
                        for (hash, mut files) in b {
                            a.entry(hash).or_insert_with(Vec::new).append(&mut files);
                        }
                        a
                    },
                );

            // Only send if we found actual duplicates
            let has_duplicates = cover_groups.values().any(|group| group.len() >= 2);
            if has_duplicates {
                let _ = tx_for_spawn.send(AlbumCoverGroup {
                    album_name: album_name.clone(),
                    cover_groups,
                    filepath_to_tracks,
                });
            }
        });
        // Thread ends naturally when par_iter completes
    });

    // Drop the original tx so only the spawned thread holds it
    drop(tx);

    // 3: Process merge results(runs concurrently with analysis)
    let albums_processed_for_emit = albums_processed.clone();
    let window_clone = window.clone();
    let db_conn = Arc::clone(&db.conn);
    let total_start_clone = total_start;

    let merge_result = tauri::async_runtime::spawn_blocking(move || {
        let mut covers_merged = 0;
        let mut space_saved_bytes = 0u64;
        let mut errors = Vec::new();

        for album_group in rx.iter() {

            for (hash, mut group) in album_group.cover_groups {
                if group.len() < 2 {
                    continue;
                }

                println!(
                    "[MERGE]   Album '{}': Found {} duplicate covers (hash: {}...)",
                    album_group.album_name,
                    group.len(),
                    &hash[..8]
                );

                // Sort by path to get consistent canonical cover
                group.sort_by(|a, b| a.0.cmp(&b.0));
                let canonical_cover = &group[0].0;

                // Collect updates
                let mut updates: Vec<(i64, String)> = Vec::new();
                let mut files_to_delete: Vec<(String, u64)> = Vec::new();

                for (old_cover_path, file_size) in &group[1..] {
                    if let Some(track_ids) = album_group.filepath_to_tracks.get(old_cover_path) {
                        for track_id in track_ids {
                            updates.push((*track_id, canonical_cover.clone()));
                        }
                        files_to_delete.push((old_cover_path.clone(), *file_size));
                    }
                }

                // Batch update in transaction
                if !updates.is_empty() {
                    let mut conn = db_conn.lock().unwrap();
                    let tx_db = match conn.transaction() {
                        Ok(tx) => tx,
                        Err(e) => {
                            errors.push(format!("Failed to create transaction: {}", e));
                            continue;
                        }
                    };
                    
                    for (track_id, canonical_path) in &updates {
                        if let Err(e) = tx_db.execute(
                            "UPDATE tracks SET track_cover_path = ?1 WHERE id = ?2",
                            rusqlite::params![canonical_path, track_id],
                        ) {
                            errors.push(format!("Failed to update track {}: {}", track_id, e));
                        }
                    }

                    if let Err(e) = tx_db.commit() {
                        errors.push(format!("Failed to commit transaction: {}", e));
                        continue;
                    }

                    println!("[MERGE]       Updated {} tracks to use canonical cover", updates.len());
                }

                // Delete duplicate files
                for (old_cover_path, file_size) in files_to_delete {
                    match fs::remove_file(&old_cover_path) {
                        Ok(_) => {
                            space_saved_bytes += file_size;
                            covers_merged += 1;
                            println!("[MERGE]       Deleted: {}", old_cover_path);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                            println!("[MERGE]       Already deleted: {}", old_cover_path);
                        }
                        Err(e) => {
                            errors.push(format!("Failed to delete {}: {}", old_cover_path, e));
                        }
                    }
                }
            }

            // Emit progress
            let current_album = albums_processed_for_emit.load(Ordering::Relaxed);
            let elapsed_ms = total_start_clone.elapsed().as_millis() as u64;
            let avg_ms_per_album = if current_album > 0 {
                elapsed_ms / current_album as u64
            } else {
                0
            };
            let eta_ms = total_albums.saturating_sub(current_album) as u64 * avg_ms_per_album;

            let _ = window_clone.emit("merge-batch-ready", MergeBatchEvent {
                progress: MergeProgressUpdate {
                    current_album,
                    total_albums,
                    covers_merged,
                    space_saved_bytes,
                    estimated_time_remaining_ms: eta_ms,
                },
            });
        }

        (covers_merged, space_saved_bytes, errors)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (covers_merged, space_saved_bytes, mut merge_errors) = merge_result;
    errors.append(&mut merge_errors);

    let elapsed = total_start.elapsed();
    let final_albums_processed = albums_processed.load(Ordering::Relaxed);
    println!("[MERGE] MERGE COMPLETE");
    println!("[MERGE]   Albums processed: {}", final_albums_processed);
    println!("[MERGE]   Covers merged: {}", covers_merged);
    println!(
        "[MERGE]   Space saved: {} bytes ({:.2} MB)",
        space_saved_bytes,
        space_saved_bytes as f64 / (1024.0 * 1024.0)
    );
    println!("[MERGE]   Errors: {}", errors.len());
    println!("[MERGE]   Duration: {:.2}s", elapsed.as_secs_f64());
    if final_albums_processed > 0 {
        println!("[MERGE]   Avg time per album: {:.2}ms", 
                 elapsed.as_millis() as f64 / final_albums_processed as f64);
    }

    // Emit completion event
    let _ = window.emit("merge-complete", MergeCoverResult {
        covers_merged,
        space_saved_bytes,
        albums_processed: final_albums_processed,
        errors: errors.clone(),
    });

    // Cleanup:
    drop(albums_processed);
    // Analysis thread finishes naturally when channel is consumed
    
    println!("[MERGE] Memory cleanup complete");

    Ok(MergeCoverResult {
        covers_merged,
        space_saved_bytes,
        albums_processed: final_albums_processed,
        errors,
    })
}

/// Sync cover paths from files
#[tauri::command]
pub async fn sync_cover_paths_from_files(
    window: tauri::Window,
    db: State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<MigrationProgress, String> {
    println!("[SYNC] Syncing cover paths from existing files...");
    let start = std::time::Instant::now();

    use tauri::Manager;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let covers_dir = app_data_dir.join("covers");
    let tracks_dir = covers_dir.join("tracks");
    let albums_dir = covers_dir.join("albums");

    println!("[SYNC] Covers directory: {:?}", covers_dir);

    let mut errors = Vec::new();

    // directory scanning
    let (track_updates, album_updates) = rayon::join(
        || scan_covers_directory(&tracks_dir),
        || scan_covers_directory(&albums_dir),
    );

    println!(
        "[SYNC] Found {} track covers, {} album covers",
        track_updates.len(),
        album_updates.len()
    );

    let total_items = track_updates.len() + album_updates.len();
    let mut processed = 0;
    let mut tracks_synced = 0;
    let mut albums_synced = 0;

    // Batch update tracks
    tracks_synced = batch_update_paths_with_progress(
        &db,
        &track_updates,
        "tracks",
        "track_cover_path",
        &mut errors,
        &window,
        &mut processed,
        total_items,
        &mut tracks_synced,
        &mut albums_synced,
    )?;

    // Batch update albums
    albums_synced = batch_update_paths_with_progress(
        &db,
        &album_updates,
        "albums",
        "art_path",
        &mut errors,
        &window,
        &mut processed,
        total_items,
        &mut tracks_synced,
        &mut albums_synced,
    )?;

    let elapsed = start.elapsed();
    println!("[SYNC] SYNC COMPLETE");
    println!("[SYNC]   Tracks synced: {}", tracks_synced);
    println!("[SYNC]   Albums synced: {}", albums_synced);
    println!("[SYNC]   Total synced: {}", tracks_synced + albums_synced);
    println!("[SYNC]   Duration: {:.2}s", elapsed.as_secs_f64());
    println!("[SYNC]   Throughput: {:.2} items/sec", 
             (tracks_synced + albums_synced) as f64 / elapsed.as_secs_f64());

    Ok(MigrationProgress {
        total: tracks_synced + albums_synced,
        processed: tracks_synced + albums_synced,
        tracks_migrated: tracks_synced,
        albums_migrated: albums_synced,
        errors,
    })
}

// Helper: Batch update database paths
fn batch_update_paths_with_progress(
    db: &State<Database>,
    updates: &[(String, i64)],
    table: &str,
    column: &str,
    errors: &mut Vec<String>,
    window: &tauri::Window,
    processed: &mut usize,
    total_items: usize,
    tracks_synced: &mut usize,
    albums_synced: &mut usize,
) -> Result<usize, String> {
    if updates.is_empty() {
        return Ok(0);
    }

    const BATCH_SIZE: usize = 100;
    let mut synced = 0;
    let start_time = std::time::Instant::now();

    for (batch_idx, chunk) in updates.chunks(BATCH_SIZE).enumerate() {
        let mut conn = db.conn.lock().to_str_err()?;
        let tx = conn.transaction().to_str_err()?;

        for (path_str, id) in chunk {
            let sql = format!("UPDATE {} SET {} = ?1 WHERE id = ?2", table, column);
            match tx.execute(&sql, rusqlite::params![path_str, id]) {
                Ok(updated) => {
                    if updated > 0 {
                        synced += 1;
                        *processed += 1;
                        
                        // Update the appropriate counter
                        if table == "tracks" {
                            *tracks_synced = synced;
                        } else if table == "albums" {
                            *albums_synced = synced;
                        }
                    }
                }
                Err(e) => {
                    errors.push(format!("Failed to update {} {}: {}", table, id, e));
                }
            }
        }

        tx.commit().to_str_err()?;

        // Emit progress event after each batch
        let elapsed_ms = start_time.elapsed().as_millis() as u64;
        let items_per_ms = if elapsed_ms > 0 {
            *processed as f64 / elapsed_ms as f64
        } else {
            0.0
        };
        let remaining_items = total_items.saturating_sub(*processed);
        let estimated_remaining_ms = if items_per_ms > 0.0 {
            (remaining_items as f64 / items_per_ms) as u64
        } else {
            0
        };

        let _ = window.emit("migration-batch-ready", MigrationBatchEvent {
            items: vec![], // Empty for sync, as we don't track individual items
            progress: MigrationProgressUpdate {
                current: *processed,
                total: total_items,
                current_batch: batch_idx + 1,
                batch_size: chunk.len(),
                estimated_time_remaining_ms: estimated_remaining_ms,
                tracks_migrated: *tracks_synced,
                albums_migrated: *albums_synced,
            },
        });
    }

    Ok(synced)
}

// Helper: Scan directory
fn scan_covers_directory(dir: &std::path::Path) -> Vec<(String, i64)> {
    if !dir.exists() {
        return Vec::new();
    }

    let entries: Vec<_> = match fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(_) => return Vec::new(),
    };

    entries
        .par_iter()
        .filter_map(|entry| {
            let path = entry.path();

            if !path.is_file() {
                return None;
            }

            let extension = path.extension()?.to_string_lossy().to_lowercase();
            if !["jpg", "jpeg", "png", "webp"].contains(&extension.as_str()) {
                return None;
            }

            let stem = path.file_stem()?.to_string_lossy();
            let id = stem.parse::<i64>().ok()?;
            let path_str = path.to_string_lossy().to_string();

            Some((path_str, id))
        })
        .collect()
}

// Helper function for hashing
fn get_file_hash(path: &str) -> Result<String, String> {
    let path = std::path::Path::new(path);

    // Calculate hash
    let mut file = fs::File::open(path).to_str_err()?;
    let mut hasher = Sha256::new();

    // Read in 64KB chunks for efficiency
    let mut buffer = [0u8; 65536];
    loop {
        let bytes_read = file.read(&mut buffer).to_str_err()?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let hash = format!("{:x}", hasher.finalize());
    Ok(hash)
}

#[tauri::command]
pub async fn get_track_cover_path(
    track_id: i64,
    db: State<'_, Database>,
) -> Result<Option<String>, String> {
    let conn = db.conn.lock().to_str_err()?;
    get_track_cover_file_path(&conn, track_id).to_str_err()
}

#[tauri::command]
pub async fn get_batch_cover_paths(
    track_ids: Vec<i64>,
    db: State<'_, Database>,
) -> Result<HashMap<i64, String>, String> {
    let conn = db.conn.lock().to_str_err()?;
    queries::get_batch_cover_paths(&conn, &track_ids).to_str_err()
}

#[tauri::command]
pub async fn get_album_art_path(
    album_id: i64,
    db: State<'_, Database>,
) -> Result<Option<String>, String> {
    let conn = db.conn.lock().to_str_err()?;
    get_album_art_file_path(&conn, album_id).to_str_err()
}

#[tauri::command]
pub async fn get_cover_as_asset_url(file_path: String) -> Result<String, String> {
    Ok(file_path)
}

#[tauri::command]
pub async fn preload_covers(_track_ids: Vec<i64>, _db: State<'_, Database>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn cleanup_orphaned_cover_files(db: State<'_, Database>) -> Result<usize, String> {
    let conn = db.conn.lock().to_str_err()?;
    cleanup_orphaned_covers(&conn).to_str_err()
}

#[tauri::command]
pub async fn clear_base64_covers(db: State<'_, Database>) -> Result<usize, String> {
    let conn = db.conn.lock().to_str_err()?;

    let tracks_cleared = conn
        .execute(
            "UPDATE tracks SET track_cover = NULL WHERE track_cover_path IS NOT NULL",
            [],
        )
        .map_err(|e| format!("Failed to clear track covers: {}", e))?;

    let albums_cleared = conn
        .execute(
            "UPDATE albums SET art_data = NULL WHERE art_path IS NOT NULL",
            [],
        )
        .map_err(|e| format!("Failed to clear album art: {}", e))?;

    let total_cleared = tracks_cleared + albums_cleared;
    println!(
        "[CLEANUP] Cleared {} base64 entries from database",
        total_cleared
    );

    Ok(total_cleared)
}