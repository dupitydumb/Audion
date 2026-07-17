// Track CRUD, FTS search, and cover-path helpers
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::collections::HashMap;
use std::time::Instant;

use super::models::{Album, Playlist, Artist, Track, TrackInsert};
use super::artists;

// ─── Private helpers ─────────────────────────────────────────────────────────

fn get_or_create_album(
    conn: &Connection,
    name: &str,
    artist: Option<&str>,
    _art_data: Option<&[u8]>,
) -> Result<i64> {
    // Match by album name only to avoid splitting albums when tracks have different artists
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM albums WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        // Update artist if not set yet
        if let Some(album_artist) = artist {
            conn.execute(
                "UPDATE albums SET artist = ?1 WHERE id = ?2 AND artist IS NULL",
                params![album_artist, id],
            )?;
        }
        return Ok(id);
    }

    // Create new album (without art_data, we'll save file separately)
    conn.execute(
        "INSERT INTO albums (name, artist) VALUES (?1, ?2)",
        params![name, artist],
    )?;

    Ok(conn.last_insert_rowid())
}

fn build_fts_query(query: &str) -> Option<String> {
    let tokens: Vec<String> = query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();
    if tokens.is_empty() { None } else { Some(tokens.join(" AND ")) }
}

fn build_like_tokens(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("%{}%", t.to_lowercase()))
        .collect()
}

// ─── Track CRUD ───────────────────────────────────────────────────────────────

// Track operations
pub fn insert_or_update_track(conn: &Connection, track: &TrackInsert) -> Result<(i64, bool)> {
    // Check if a track with the same content_hash already exists (skip duplicates)
    if let Some(ref hash) = track.content_hash {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM tracks WHERE content_hash = ?1 AND path != ?2",
                params![hash, track.path],
                |row| row.get(0),
            )
            .ok();

        if existing.is_some() {
            // Duplicate detected - skip this track
            return Ok((0, false)); // Return tuple
        }
    }

    // Check if track already exists by path
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM tracks WHERE path = ?1",
            params![track.path],
            |row| row.get(0),
        )
        .ok();

    // First, handle album if present
    let album_id = if let Some(album_name) = &track.album {
        let artist = track.artist.as_deref();
        Some(get_or_create_album(
            conn,
            album_name,
            artist,
            track.album_art.as_deref(),
        )?)
    } else {
        None
    };

    if let Some(track_id) = existing_id {
        // update existing track
        conn.execute(
            "UPDATE tracks SET
                title = ?1,
                artist = ?2,
                album = ?3,
                track_number = ?4,
                duration = ?5,
                album_id = ?6,
                format = ?7,
                bitrate = ?8,
                source_type = ?9,
                cover_url = ?10,
                external_id = ?11,
                content_hash = ?12,
                local_src = ?13,
                disc_number = ?15,
                musicbrainz_recording_id = ?16,
                metadata_json = ?17,
                date_added = COALESCE(date_added, CURRENT_TIMESTAMP)
             WHERE id = ?14",
            params![
                track.title,
                track.artist,
                track.album,
                track.track_number,
                track.duration,
                album_id,
                track.format,
                track.bitrate,
                track.source_type,
                track.cover_url,
                track.external_id,
                track.content_hash,
                track.local_src,
                track_id, // Use existing ID
                track.disc_number,
                track.musicbrainz_recording_id,
                track.metadata_json,
            ],
        )?;

        super::artists::sync_track_artists_for_track(conn, track_id, track.artist.as_deref())?;

        Ok((track_id, false)) // Return (existing_id, was_new = false)
    } else {
        // insert new track
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, content_hash, local_src, disc_number, musicbrainz_recording_id, metadata_json, date_added)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, CURRENT_TIMESTAMP)",
            params![
                track.path,
                track.title,
                track.artist,
                track.album,
                track.track_number,
                track.duration,
                album_id,
                track.format,
                track.bitrate,
                track.source_type,
                track.cover_url,
                track.external_id,
                track.content_hash,
                track.local_src,
                track.disc_number,
                track.musicbrainz_recording_id,
                track.metadata_json,
            ],
        )?;

        let new_id = conn.last_insert_rowid();
        super::artists::sync_track_artists_for_track(conn, new_id, track.artist.as_deref())?;

        Ok((new_id, true)) // Return (new_id, was_new = true)
    }
}

/// Update MusicBrainz Recording ID and/or genre for a track.
/// Uses COALESCE so that passing `None` preserves the existing DB value.
pub fn update_track_mb_data(
    conn: &Connection,
    track_id: i64,
    mbid: Option<&str>,
    genre: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE tracks
         SET musicbrainz_recording_id = COALESCE(?1, musicbrainz_recording_id),
             genre                    = COALESCE(?2, genre)
         WHERE id = ?3",
        params![mbid, genre, track_id],
    )?;
    Ok(())
}

/// Delete a track from the database by ID
pub fn delete_track(conn: &Connection, track_id: i64) -> Result<bool> {
    let deleted = conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
    Ok(deleted > 0)
}

/// Get a track by its ID
pub fn get_track_by_id(conn: &Connection, track_id: i64) -> Result<Option<Track>> {
    let track = conn.query_row(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover, track_cover_path, disc_number, metadata_json, date_added
         FROM tracks WHERE id = ?1",
        params![track_id],
        |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: row.get(14)?,
                track_cover_path: row.get(15)?,
                disc_number: row.get(16)?,
                metadata_json: row.get(17)?,
                date_added: row.get(18)?,
                artists: Vec::new(),
            })
        },
    )
    .optional()?;

    let mut track = track;
    if let Some(ref mut t) = track {
        artists::attach_artists(conn, std::slice::from_mut(t))?;
    }
    Ok(track)
}

/// Delete an album and all its associated tracks
pub fn delete_album(conn: &Connection, album_id: i64) -> Result<bool> {
    // Delete tracks first (foreign key relationship)
    conn.execute("DELETE FROM tracks WHERE album_id = ?1", params![album_id])?;

    // Then delete the album
    let deleted = conn.execute("DELETE FROM albums WHERE id = ?1", params![album_id])?;

    Ok(deleted > 0)
}

// ─── FTS5 search ──────────────────────────────────────────────────────────────

/// Initialize FTS5 virtual table for searching
pub fn init_fts(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
            title, 
            artist, 
            album, 
            content='tracks', 
            content_rowid='id'
        );

        -- Triggers to keep tracks FTS in sync
        CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
            INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
        END;
        CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
            INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES('delete', old.id, old.title, old.artist, old.album);
        END;
        CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
            INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES('delete', old.id, old.title, old.artist, old.album);
            INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, new.artist, new.album);
        END;"
    )?;

    // Always rebuild FTS to guarantee fresh search index on startup
    let _ = conn.execute("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');", []);

    Ok(())
}

/// search tracks using FTS5. called by the provider so it can resolve URLs before returning
pub fn search_tracks(conn: &Connection, query: &str, limit: i32, offset: i32) -> Result<Vec<Track>> {
    let fts_query = match build_fts_query(query) {
        Some(q) => q,
        None => return Ok(vec![]),
    };
    let sql = format!(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format,
                bitrate, source_type, cover_url, external_id, local_src, track_cover_path,
                disc_number, metadata_json, date_added
         FROM tracks
         WHERE id IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?1)
         ORDER BY artist, album, disc_number, track_number, title
         LIMIT {} OFFSET {}",
        limit, offset
    );
    let mut stmt = conn.prepare(&sql)?;
    let tracks = stmt
        .query_map(params![fts_query], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: None,
                track_cover_path: row.get(14)?,
                disc_number: row.get(15)?,
                metadata_json: row.get(16)?,
                date_added: row.get(17)?,
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    let mut tracks = tracks;
    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}
/// albums, artists, and playlists.called from search_library after the provider
/// has done its own track search (local FTS5 or remote)
pub fn search_related(
    conn: &Connection,
    query: &str,
    track_ids: &[i64],
) -> Result<(Vec<Album>, Vec<Artist>, Vec<Playlist>)> {
    if track_ids.is_empty() {
        return Ok((vec![], vec![], vec![]));
    }

    let placeholders = track_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

    // albums and artists are derived from track_ids which is already bounded to 100, so no separate limit needed
    let album_sql = format!(
        "SELECT DISTINCT a.id, a.name, a.artist, a.art_path
         FROM albums a INNER JOIN tracks t ON t.album_id = a.id
         WHERE t.id IN ({})
         ORDER BY a.artist, a.name",
        placeholders
    );
    let mut album_stmt = conn.prepare(&album_sql)?;
    let albums = album_stmt
        .query_map(rusqlite::params_from_iter(track_ids.iter()), |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: None,
                art_path: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let artist_sql = format!(
        "SELECT ar.name, COUNT(DISTINCT ta.track_id) as track_count, COUNT(DISTINCT t.album_id) as album_count
         FROM artists ar
         INNER JOIN track_artists ta ON ta.artist_id = ar.id
         INNER JOIN tracks t ON t.id = ta.track_id
         WHERE t.id IN ({})
         GROUP BY ar.id ORDER BY ar.name COLLATE NOCASE",
        placeholders
    );
    let mut artist_stmt = conn.prepare(&artist_sql)?;
    let artists = artist_stmt
        .query_map(rusqlite::params_from_iter(track_ids.iter()), |row| {
            Ok(Artist {
                name: row.get(0)?,
                track_count: row.get(1)?,
                album_count: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    // playlists: UNION of track-membership and direct name match
    let like_tokens = build_like_tokens(query);
    
    let name_conditions = if like_tokens.is_empty() {
        "1=0".to_string()
    } else {
        like_tokens
            .iter()
            .map(|_| "LOWER(p2.name) LIKE ?")
            .collect::<Vec<_>>()
            .join(" AND ")
    };
    
    let playlist_sql = format!(
        "SELECT DISTINCT p.id, p.name, p.cover_url, p.created_at, p.folder_path
            FROM playlists p
            INNER JOIN playlist_tracks pt ON p.id = pt.playlist_id
            WHERE pt.track_id IN ({})
            UNION
            SELECT DISTINCT p2.id, p2.name, p2.cover_url, p2.created_at, p2.folder_path
            FROM playlists p2 WHERE {}
            ORDER BY name",
        placeholders, name_conditions
    );
    
    let mut playlist_stmt = conn.prepare(&playlist_sql)?;
    let playlists = playlist_stmt
        .query_map(
            rusqlite::params_from_iter(
                track_ids.iter().map(|id| id as &dyn rusqlite::ToSql)
                    .chain(like_tokens.iter().map(|t| t as &dyn rusqlite::ToSql))
            ),
            |row| Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                cover_url: row.get(2)?,
                created_at: row.get(3)?,
                folder_path: row.get(4)?,
            }),
        )?
        .collect::<Result<Vec<_>>>()?;

    Ok((albums, artists, playlists))
}

// ─── Track getters ────────────────────────────────────────────────────────────

/// Get paginated tracks
pub fn get_tracks_paginated(conn: &Connection, limit: i32, offset: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks 
         ORDER BY artist, album, disc_number, track_number, title
         LIMIT ?1 OFFSET ?2",
    )?;

    let mut tracks = stmt
        .query_map(params![limit, offset], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: None,
                track_cover_path: row.get(14)?,
                disc_number: row.get(15)?,
                metadata_json: row.get(16)?,
                date_added: row.get(17)?,
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// Get all tracks WITH cover data (slow, for migration only)
pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let query_start = Instant::now();
    println!("[DB] get_all_tracks: Preparing query...");

    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks ORDER BY artist, album, disc_number, track_number, title",
    )?;

    let prepare_time = query_start.elapsed();
    println!("[DB] get_all_tracks: Query prepared in {:?}", prepare_time);

    let map_start = Instant::now();
    let mut tracks = stmt
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: row.get(14)?,
                track_cover_path: row.get(15)?,
                disc_number: row.get(16)?,
                metadata_json: row.get(17)?,
                date_added: row.get(18)?,
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let _map_time = map_start.elapsed();
    let total_time = query_start.elapsed();

    println!(
        "[DB] get_all_tracks: Fetched {} tracks in {:?}",
        tracks.len(),
        total_time
    );

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// Get all tracks WITHOUT any cover data (fast)
pub fn get_all_tracks_lightweight(conn: &Connection) -> Result<Vec<Track>> {
    let query_start = Instant::now();
    println!("[DB] get_all_tracks_lightweight: Preparing query...");

    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, disc_number, metadata_json, date_added 
         FROM tracks ORDER BY artist, album, disc_number, track_number, title",
    )?;

    let prepare_time = query_start.elapsed();
    println!(
        "[DB] get_all_tracks_lightweight: Query prepared in {:?}",
        prepare_time
    );

    let map_start = Instant::now();
    let mut tracks = stmt
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: None,
                track_cover_path: None,
                disc_number: row.get(14)?,
                metadata_json: row.get(15)?,
                date_added: row.get(16)?,
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let map_time = map_start.elapsed();
    let total_time = query_start.elapsed();

    println!(
        "[DB] get_all_tracks_lightweight: Fetched {} tracks in {:?} (prepare: {:?}, map: {:?})",
        tracks.len(),
        total_time,
        prepare_time,
        map_time
    );

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// Get all tracks WITH cover paths only (fast, for on-demand loading)
/// every track's file path only
/// used by bulk filesystem operations (e.g. sweeping sidecar lyrics files)
pub fn get_all_track_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM tracks")?;
    let paths = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;
    Ok(paths)
}

pub fn get_all_tracks_with_paths(conn: &Connection) -> Result<Vec<Track>> {
    let query_start = Instant::now();

    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks ORDER BY artist, album, disc_number, track_number, title",
    )?;

    let mut tracks = stmt
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                track_number: row.get(5)?,
                duration: row.get(6)?,
                album_id: row.get(7)?,
                format: row.get(8)?,
                bitrate: row.get(9)?,
                source_type: row.get(10)?,
                cover_url: row.get(11)?,
                external_id: row.get(12)?,
                local_src: row.get(13)?,
                track_cover: None,
                track_cover_path: row.get(14)?,
                disc_number: row.get(15)?,
                metadata_json: row.get(16)?,
                date_added: row.get(17)?,
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_tracks_with_paths: Fetched {} tracks in {:?}",
        tracks.len(),
        total_time
    );

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// Get single track cover path
pub fn get_track_cover_path(conn: &Connection, track_id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT track_cover_path FROM tracks WHERE id = ?1",
        [track_id],
        |row| row.get(0),
    )
    .optional()
}

/// Get batch cover paths efficiently
pub fn get_batch_cover_paths(conn: &Connection, track_ids: &[i64]) -> Result<HashMap<i64, String>> {
    if track_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<String> = track_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "SELECT id, track_cover_path FROM tracks WHERE id IN ({}) AND track_cover_path IS NOT NULL",
        placeholders.join(",")
    );

    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(track_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (id, path) = row?;
        map.insert(id, path);
    }

    Ok(map)
}

/// Update track cover path
pub fn update_track_cover_path(conn: &Connection, track_id: i64, path: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET track_cover_path = ?1 WHERE id = ?2",
        params![path, track_id],
    )?;
    Ok(())
}

/// Update album art path
pub fn update_album_art_path(conn: &Connection, album_id: i64, path: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE albums SET art_path = ?1 WHERE id = ?2",
        params![path, album_id],
    )?;
    Ok(())
}

pub fn update_track_after_download(
    conn: &Connection,
    track_id: i64,
    local_path: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET path = ?1, local_src = ?1, source_type = 'local' WHERE id = ?2",
        params![local_path, track_id],
    )?;
    Ok(())
}

pub fn update_track_cover_url(
    conn: &Connection,
    track_id: i64,
    cover_url: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET cover_url = ?1 WHERE id = ?2",
        params![cover_url, track_id],
    )?;
    Ok(())
}

pub fn update_local_src(conn: &Connection, track_id: i64, local_src: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET local_src = ?1 WHERE id = ?2",
        params![local_src, track_id],
    )?;
    Ok(())
}
