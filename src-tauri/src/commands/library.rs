// Library-related Tauri commands
use crate::db::{queries, Database};
use crate::scanner::{extract_metadata, scan_directory};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub tracks_added: usize,
    pub tracks_updated: usize,
    pub tracks_deleted: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Library {
    pub tracks: Vec<queries::Track>,
    pub albums: Vec<queries::Album>,
    pub artists: Vec<queries::Artist>,
}

#[tauri::command]
pub async fn scan_music(paths: Vec<String>, db: State<'_, Database>) -> Result<ScanResult, String> {
    let mut tracks_added = 0;
    let mut errors = Vec::new();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Add folders to database
    for path in &paths {
        if let Err(e) = queries::add_music_folder(&conn, path) {
            errors.push(format!("Failed to add folder {}: {}", path, e));
        }
    }

    // Cleanup deleted tracks in these folders before scanning
    let _ = queries::cleanup_deleted_tracks(&conn, &paths)
        .map_err(|e| errors.push(format!("Failed to cleanup deleted tracks: {}", e)));

    for path in paths {
        let scan_result = scan_directory(&path);
        errors.extend(scan_result.errors);

        for file_path in scan_result.audio_files {
            if let Some(track_data) = extract_metadata(&file_path) {
                match queries::insert_or_update_track(&conn, &track_data) {
                    Ok(_) => tracks_added += 1,
                    Err(e) => errors.push(format!("Failed to insert {}: {}", file_path, e)),
                }
            }
        }

        // Update last scanned time
        if let Err(e) = queries::update_folder_last_scanned(&conn, &path) {
            errors.push(format!("Failed to update scan time for {}: {}", path, e));
        }
    }

    Ok(ScanResult {
        tracks_added,
        tracks_updated: 0, // TODO: Distinguish between insert and update
        tracks_deleted: 0,
        errors,
    })
}

#[tauri::command]
pub async fn rescan_music(db: State<'_, Database>) -> Result<ScanResult, String> {
    let mut tracks_added = 0;
    let mut tracks_deleted = 0;
    let mut errors = Vec::new();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all scanned folders
    let folders = queries::get_music_folders(&conn).map_err(|e| e.to_string())?;

    // Clean up deleted tracks first
    tracks_deleted = queries::cleanup_deleted_tracks(&conn, &folders)
        .map_err(|e| format!("Failed to cleanup deleted tracks: {}", e))?;

    // Rescan all folders
    for path in folders {
        let scan_result = scan_directory(&path);
        errors.extend(scan_result.errors);

        for file_path in scan_result.audio_files {
            if let Some(track_data) = extract_metadata(&file_path) {
                match queries::insert_or_update_track(&conn, &track_data) {
                    Ok(_) => tracks_added += 1,
                    Err(e) => errors.push(format!("Failed to insert {}: {}", file_path, e)),
                }
            }
        }

        // Update last scanned time
        if let Err(e) = queries::update_folder_last_scanned(&conn, &path) {
            errors.push(format!("Failed to update scan time for {}: {}", path, e));
        }
    }

    Ok(ScanResult {
        tracks_added,
        tracks_updated: 0, // TODO: Distinguish between insert and update
        tracks_deleted,
        errors,
    })
}

#[tauri::command]
pub async fn get_library(db: State<'_, Database>) -> Result<Library, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let tracks = queries::get_all_tracks(&conn).map_err(|e| e.to_string())?;
    let albums = queries::get_all_albums(&conn).map_err(|e| e.to_string())?;
    let artists = queries::get_all_artists(&conn).map_err(|e| e.to_string())?;

    Ok(Library {
        tracks,
        albums,
        artists,
    })
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
            "SELECT DISTINCT a.id, a.name, a.artist, a.art_data 
         FROM albums a
         INNER JOIN tracks t ON t.album_id = a.id
         WHERE t.artist = ?1
         ORDER BY a.name",
        )
        .map_err(|e| e.to_string())?;

    let albums = stmt
        .query_map([&artist], |row| {
            Ok(queries::Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(albums)
}

/// Delete a track from the library
#[tauri::command]
pub async fn delete_track(track_id: i64, db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get track path first to delete file if it exists and is local
    let track_path: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT path, source_type FROM tracks WHERE id = ?1",
            [track_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((path, source_type)) = track_path {
        // Only delete file if it's a local track (soure_type is null or "local")
        let is_local = source_type.is_none() || source_type.as_deref() == Some("local");

        if is_local {
            let path_obj = std::path::Path::new(&path);
            if path_obj.exists() {
                if let Err(e) = std::fs::remove_file(path_obj) {
                    println!("Failed to delete file {}: {}", path, e);
                    // Continue to delete from DB even if file deletion fails
                }
            }
        }
    }

    queries::delete_track(&conn, track_id).map_err(|e| format!("Failed to delete track: {}", e))
}

/// Delete an album and all its tracks
#[tauri::command]
pub async fn delete_album(album_id: i64, db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all tracks for this album to delete files
    let tracks = queries::get_tracks_by_album(&conn, album_id).map_err(|e| e.to_string())?;

    for track in tracks {
        // Only delete file if it's a local track
        let is_local = track.source_type.is_none() || track.source_type.as_deref() == Some("local");

        if is_local {
            let path_obj = std::path::Path::new(&track.path);
            if path_obj.exists() {
                let _ = std::fs::remove_file(path_obj);
            }
        }
    }

    queries::delete_album(&conn, album_id).map_err(|e| format!("Failed to delete album: {}", e))
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Use stream_url as path if provided, otherwise construct from source_type://external_id
    let path = track
        .stream_url
        .clone()
        .unwrap_or_else(|| format!("{}://{}", track.source_type, track.external_id));

    let track_insert = queries::TrackInsert {
        path,
        title: Some(track.title),
        artist: Some(track.artist),
        album: track.album,
        track_number: None,
        duration: track.duration,
        album_art: None, // External tracks use cover_url instead
        format: track.format,
        bitrate: track.bitrate,
        source_type: Some(track.source_type),
        cover_url: track.cover_url,
        external_id: Some(track.external_id),
    };

    queries::insert_or_update_track(&conn, &track_insert)
        .map_err(|e| format!("Failed to add external track: {}", e))
}
