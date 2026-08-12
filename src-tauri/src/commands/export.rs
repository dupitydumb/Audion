// playlist export => streams a ZIP file directly to disk
//
// 2 step to avoid holding the DB mutex during file I/O:
//   1 : short lock: load all playlist/track metadata into Vec
//   2 : no lock:    open each file and stream it into the zip
//
// peak memory: one BufReader buffer (8 KB) per track)
// zip is written entry-by-entry directly to the destination file

use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
use tauri::Manager;

// serialisable types (written into playlist.json) =================================
#[derive(Serialize)]
pub struct ExportTrack {
    pub id: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i32>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub date_added: Option<String>,
    /// relative path inside the zip (e.g. files/track.flac)
    /// None for streaming-only tracks that have no local file
    pub zip_path: Option<String>,
}

#[derive(Serialize)]
pub struct ExportPlaylist {
    pub id: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub created_at: Option<String>,
    pub exported_at: String,
    pub tracks: Vec<ExportTrack>,
}

// internal type carrying the resolved local path ===========================

struct TrackEntry {
    export: ExportTrack,
    /// absolute path on disk, None means no local file (streaming-only)
    local_path: Option<PathBuf>,
}

// return type===================================================================================

pub struct ExportSummary {
    /// Total tracks in the playlist.
    pub track_count: usize,
    /// Tracks skipped because no local file was available.
    pub skipped_count: usize,
}

// 1: load metadata (call with lock held)======================================================

fn load_tracks(conn: &Connection, playlist_id: i64) -> Result<(String, Option<String>, Option<String>, Vec<TrackEntry>), String> {
    let (playlist_name, cover_url, created_at) = conn
        .query_row(
            "SELECT name, cover_url, created_at FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            )),
        )
        .map_err(|e| format!("Playlist {playlist_id} not found: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.path, t.title, t.artist, t.album,
                    t.track_number, t.disc_number, t.duration,
                    t.format, t.bitrate, t.source_type,
                    t.local_src, t.date_added
             FROM playlist_tracks pt
             JOIN tracks t ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position ASC, pt.rowid ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut seen_names: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();

    let entries = stmt
        .query_map(params![playlist_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,            // path (canonical DB path)
                row.get::<_, Option<String>>(2)?,    // title
                row.get::<_, Option<String>>(3)?,    // artist
                row.get::<_, Option<String>>(4)?,    // album
                row.get::<_, Option<i32>>(5)?,       // track_number
                row.get::<_, Option<i32>>(6)?,       // disc_number
                row.get::<_, Option<i32>>(7)?,       // duration
                row.get::<_, Option<String>>(8)?,    // format
                row.get::<_, Option<i32>>(9)?,       // bitrate
                row.get::<_, Option<String>>(10)?,   // source_type
                row.get::<_, Option<String>>(11)?,   // local_src
                row.get::<_, Option<String>>(12)?,   // date_added
            ))
        })
        .map_err(|e| e.to_string())?
        .map(|row| -> Result<TrackEntry, String> {
            let (id, path, title, artist, album, track_number, disc_number,
                 duration, format, bitrate, source_type, local_src, date_added) =
                row.map_err(|e| e.to_string())?;

            // prefer local_src (downloaded streaming track) over path
            let candidate = local_src.as_deref().unwrap_or(&path);
            let abs_path = PathBuf::from(candidate);
            let local_path = if abs_path.exists() { Some(abs_path) } else { None };

            // compute the deduplicated zip entry name while the DB lock is still held
            // cheap string work, means phase 2 straightforward
            let zip_path = local_path.as_ref().map(|p| {
                let raw = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| format!("track_{id}.bin"));
                dedupe_name(&raw, &mut seen_names)
            });

            Ok(TrackEntry {
                export: ExportTrack {
                    id, title, artist, album, track_number, disc_number,
                    duration, format, bitrate, source_type, date_added,
                    zip_path,
                },
                local_path,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok((playlist_name, cover_url, created_at, entries))
}

// 2: write zip (no lock held)====================================================================

fn write_zip(
    playlist_id: i64,
    playlist_name: String,
    cover_url: Option<String>,
    created_at: Option<String>,
    entries: Vec<TrackEntry>,
    dest: &Path,
) -> Result<ExportSummary, String> {
    let track_count = entries.len();
    let skipped_count = entries.iter().filter(|e| e.local_path.is_none()).count();

    // build the serialisable manifest (zip_path already computed instep 1)
    let export_tracks: Vec<ExportTrack> = entries.iter().map(|e| ExportTrack {
        id: e.export.id,
        title: e.export.title.clone(),
        artist: e.export.artist.clone(),
        album: e.export.album.clone(),
        track_number: e.export.track_number,
        disc_number: e.export.disc_number,
        duration: e.export.duration,
        format: e.export.format.clone(),
        bitrate: e.export.bitrate,
        source_type: e.export.source_type.clone(),
        date_added: e.export.date_added.clone(),
        zip_path: e.export.zip_path.clone(),
    }).collect();

    let manifest = ExportPlaylist {
        id: playlist_id,
        name: playlist_name,
        cover_url,
        created_at,
        exported_at: chrono::Utc::now().to_rfc3339(),
        tracks: export_tracks,
    };

    let json_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    // write to a temp file in the same directory first, then rename into place
    let tmp_dest = dest.with_extension("part");
    // cleanup of a stale temp file from a previous failed attempt
    let _ = std::fs::remove_file(&tmp_dest);

    let result = (|| -> Result<ExportSummary, String> {
        let dest_file = std::fs::File::create(&tmp_dest)
            .map_err(|e| format!("Cannot create {}: {e}", tmp_dest.display()))?;
        let dest_writer = std::io::BufWriter::new(dest_file);
        let mut zip = ZipWriter::new(dest_writer);

        let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored);
        // playlist.json
        zip.start_file("playlist.json", options).map_err(|e| e.to_string())?;
        zip.write_all(&json_bytes).map_err(|e| e.to_string())?;

        zip.add_directory("files/", options).map_err(|e| e.to_string())?;

        for entry in &entries {
            let (file_path, zip_name) = match (&entry.local_path, &entry.export.zip_path) {
                (Some(p), Some(n)) => (p, n),
                _ => continue, // no local file — skip
            };

            zip.start_file(zip_name, options).map_err(|e| e.to_string())?;

            let f = std::fs::File::open(file_path)
                .map_err(|e| format!("Cannot open {}: {e}", file_path.display()))?;

            // BufReader pulls 8 KB at a time; io::copy feeds it into
            // the ZipWriter => BufWriter => file
            let mut reader = BufReader::new(f);
            std::io::copy(&mut reader, &mut zip)
                .map_err(|e| format!("IO error writing {}: {e}", file_path.display()))?;
        }

        zip.finish().map_err(|e| e.to_string())?;

        Ok(ExportSummary { track_count, skipped_count })
    })();

    // only touch the real destination once everything above succeeded
    match result {
        Ok(summary) => {
            std::fs::rename(&tmp_dest, dest).map_err(|e| {
                format!(
                    "Export succeeded but failed to finalize {}: {e}",
                    dest.display()
                )
            })?;
            Ok(summary)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_dest);
            Err(e)
        }
    }
}

// liked songs: load tracks (call with lock held) ================================================

fn load_liked_tracks(conn: &Connection) -> Result<Vec<TrackEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.path, t.title, t.artist, t.album,
                    t.track_number, t.disc_number, t.duration,
                    t.format, t.bitrate, t.source_type,
                    t.local_src, t.date_added
             FROM liked_tracks lt
             JOIN tracks t ON t.id = lt.track_id
             ORDER BY lt.liked_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let mut seen_names: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();

    let entries = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i32>>(5)?,
                row.get::<_, Option<i32>>(6)?,
                row.get::<_, Option<i32>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<i32>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .map(|row| -> Result<TrackEntry, String> {
            let (id, path, title, artist, album, track_number, disc_number,
                 duration, format, bitrate, source_type, local_src, date_added) =
                row.map_err(|e| e.to_string())?;

            let candidate = local_src.as_deref().unwrap_or(&path);
            let abs_path = PathBuf::from(candidate);
            let local_path = if abs_path.exists() { Some(abs_path) } else { None };

            let zip_path = local_path.as_ref().map(|p| {
                let raw = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| format!("track_{id}.bin"));
                dedupe_name(&raw, &mut seen_names)
            });

            Ok(TrackEntry {
                export: ExportTrack {
                    id, title, artist, album, track_number, disc_number,
                    duration, format, bitrate, source_type, date_added,
                    zip_path,
                },
                local_path,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

// liked songs: public entry point (call from spawn_blocking) ====================================

pub fn build_liked_songs_zip(
    conn: &Connection,
    dest: &Path,
) -> Result<ExportSummary, String> {
    let entries = load_liked_tracks(conn)?;
    // playlist_id 0 = synthetic; cover_url/created_at not applicable
    write_zip(0, "Liked Songs".to_owned(), None, None, entries, dest)
}

// public entry point (call from spawn_blocking) =========================================================
pub fn build_playlist_zip(
    conn: &Connection,
    playlist_id: i64,
    dest: &Path,
) -> Result<ExportSummary, String> {
    // 1: DB work => lock held only for this call
    let (playlist_name, cover_url, created_at, entries) =
        load_tracks(conn, playlist_id)?;

    // lock is released here before any file I/O begins

    // step 2: file I/O => no lock
    write_zip(playlist_id, playlist_name, cover_url, created_at, entries, dest)
}

// helpers============================================================================

fn dedupe_name(raw: &str, seen: &mut std::collections::HashMap<String, u32>) -> String {
    let count = seen.entry(raw.to_owned()).or_insert(0);
    if *count == 0 {
        *count += 1;
        format!("files/{raw}")
    } else {
        let stem = Path::new(raw)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw.to_owned());
        let ext = Path::new(raw)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let name = format!("files/{stem}_{count}{ext}");
        *count += 1;
        name
    }
}

#[tauri::command]
pub async fn get_export_temp_path(
    app: tauri::AppHandle,
    name: String,
) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    // only allow a bare filename: strip any directory components
    let safe_name = Path::new(&name)
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    Ok(cache_dir.join(safe_name).to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn export_liked_songs_zip(
    dest_path: String,
    db: tauri::State<'_, crate::db::Database>,
) -> Result<serde_json::Value, String> {
    let dest = PathBuf::from(dest_path);
    let conn_arc = db.conn.clone();

    let summary = tokio::task::spawn_blocking(move || {
        let conn = conn_arc.lock().map_err(|e| e.to_string())?;
        build_liked_songs_zip(&conn, &dest)
    })
    .await
    .map_err(|e| format!("Export task panicked: {e}"))??;

    Ok(serde_json::json!({
        "track_count": summary.track_count,
        "skipped_count": summary.skipped_count,
    }))
}