// Database query operations
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_id: Option<i64>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
    pub local_src: Option<String>,
    pub track_cover: Option<String>,
    pub track_cover_path: Option<String>,
    pub disc_number: Option<i32>,
    pub metadata_json: Option<String>,
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: i64,
    pub name: String,
    pub artist: Option<String>,
    pub art_data: Option<String>,
    pub art_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artist {
    pub name: String,
    pub track_count: i32,
    pub album_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInsert {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_art: Option<Vec<u8>>,
    pub track_cover: Option<Vec<u8>>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
    pub content_hash: Option<String>,
    pub local_src: Option<String>,
    pub musicbrainz_recording_id: Option<String>,
    pub metadata_json: Option<String>,
}

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
                metadata_json = ?17
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

        Ok((track_id, false)) // Return (existing_id, was_new = false)
    } else {
        // insert new track
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, content_hash, local_src, disc_number, musicbrainz_recording_id, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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

        Ok((conn.last_insert_rowid(), true)) // Return (new_id, was_new = true)
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
    conn.query_row(
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
            })
        },
    )
    .optional()
}

fn get_or_create_album(
    conn: &Connection,
    name: &str,
    artist: Option<&str>,
    art_data: Option<&[u8]>,
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

/// Delete an album and all its associated tracks
pub fn delete_album(conn: &Connection, album_id: i64) -> Result<bool> {
    // Delete tracks first (foreign key relationship)
    conn.execute("DELETE FROM tracks WHERE album_id = ?1", params![album_id])?;

    // Then delete the album
    let deleted = conn.execute("DELETE FROM albums WHERE id = ?1", params![album_id])?;

    Ok(deleted > 0)
}

// FTS5 SEARCH FUNCTIONS

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

        -- Trigger to keep FTS in sync with tracks
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
    Ok(())
}

/// Search tracks using FTS5
pub fn search_tracks(
    conn: &Connection,
    query: &str,
    limit: i32,
    offset: i32,
) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks 
         WHERE id IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?1)
         ORDER BY artist, album, disc_number, track_number, title
         LIMIT ?2 OFFSET ?3",
    )?;

    let tracks = stmt
        .query_map(params![query, limit, offset], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

/// Get paginated tracks
pub fn get_tracks_paginated(conn: &Connection, limit: i32, offset: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks 
         ORDER BY artist, album, disc_number, track_number, title
         LIMIT ?1 OFFSET ?2",
    )?;

    let tracks = stmt
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

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
    let tracks = stmt
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let map_time = map_start.elapsed();
    let total_time = query_start.elapsed();

    println!(
        "[DB] get_all_tracks: Fetched {} tracks in {:?}",
        tracks.len(),
        total_time
    );

    Ok(tracks)
}

/// Get all tracks WITHOUT any cover data -fast)
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
    let tracks = stmt
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

    Ok(tracks)
}

/// Get all tracks WITH cover paths only (fast, for on-demand loading)
pub fn get_all_tracks_with_paths(conn: &Connection) -> Result<Vec<Track>> {
    let query_start = Instant::now();

    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks ORDER BY artist, album, disc_number, track_number, title",
    )?;

    let tracks = stmt
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_tracks_with_paths: Fetched {} tracks in {:?}",
        tracks.len(),
        total_time
    );

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

/// Get album art path
pub fn get_album_art_path(conn: &Connection, album_id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT art_path FROM albums WHERE id = ?1",
        [album_id],
        |row| row.get(0),
    )
    .optional()
}

/// Get all albums WITH art data (slow, for migration only)
pub fn get_all_albums(conn: &Connection) -> Result<Vec<Album>> {
    let query_start = Instant::now();

    let mut stmt = conn
        .prepare("SELECT id, name, artist, art_data, art_path FROM albums ORDER BY artist, name")?;

    let albums = stmt
        .query_map([], |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: row.get(3)?,
                art_path: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_albums: Fetched {} albums in {:?}",
        albums.len(),
        total_time
    );

    Ok(albums)
}

/// Get all albums WITHOUT art data (fast)
pub fn get_all_albums_lightweight(conn: &Connection) -> Result<Vec<Album>> {
    let query_start = Instant::now();

    let mut stmt = conn.prepare("SELECT id, name, artist FROM albums ORDER BY artist, name")?;

    let albums = stmt
        .query_map([], |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: None,
                art_path: None,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_albums_lightweight: Fetched {} albums in {:?}",
        albums.len(),
        total_time
    );

    Ok(albums)
}

/// Get all albums WITH paths only (for on-demand loading)
pub fn get_all_albums_with_paths(conn: &Connection) -> Result<Vec<Album>> {
    let query_start = Instant::now();

    let mut stmt =
        conn.prepare("SELECT id, name, artist, art_path FROM albums ORDER BY artist, name")?;

    let albums = stmt
        .query_map([], |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: None,
                art_path: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_albums_with_paths: Fetched {} albums in {:?}",
        albums.len(),
        total_time
    );

    Ok(albums)
}

/// Get paginated albums
pub fn get_albums_paginated(conn: &Connection, limit: i32, offset: i32) -> Result<Vec<Album>> {
    let query_start = Instant::now();

    let mut stmt = conn.prepare(
        "SELECT id, name, artist, art_path FROM albums 
         ORDER BY artist, name
         LIMIT ?1 OFFSET ?2",
    )?;

    let albums = stmt
        .query_map(params![limit, offset], |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: None,
                art_path: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_albums_paginated: Fetched {} albums (limit: {}, offset: {}) in {:?}",
        albums.len(),
        limit,
        offset,
        total_time
    );

    Ok(albums)
}

pub fn get_all_artists(conn: &Connection) -> Result<Vec<Artist>> {
    let query_start = Instant::now();

    let mut stmt = conn.prepare(
        "SELECT artist, COUNT(*) as track_count, COUNT(DISTINCT album) as album_count 
         FROM tracks 
         WHERE artist IS NOT NULL 
         GROUP BY artist 
         ORDER BY artist",
    )?;

    let artists = stmt
        .query_map([], |row| {
            Ok(Artist {
                name: row.get(0)?,
                track_count: row.get(1)?,
                album_count: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let total_time = query_start.elapsed();
    println!(
        "[DB] get_all_artists: Fetched {} artists in {:?}",
        artists.len(),
        total_time
    );

    Ok(artists)
}

pub fn get_tracks_by_album(conn: &Connection, album_id: i64) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks WHERE album_id = ?1 ORDER BY disc_number, track_number, title",
    )?;

    let tracks = stmt
        .query_map([album_id], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_tracks_by_artist(conn: &Connection, artist: &str) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id, local_src, track_cover, track_cover_path, disc_number, metadata_json, date_added 
         FROM tracks WHERE artist = ?1 ORDER BY album, disc_number, track_number, title",
    )?;

    let tracks = stmt
        .query_map([artist], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_album_by_id(conn: &Connection, album_id: i64) -> Result<Option<Album>> {
    conn.query_row(
        "SELECT id, name, artist, art_data, art_path FROM albums WHERE id = ?1",
        [album_id],
        |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: row.get(3)?,
                art_path: row.get(4)?,
            })
        },
    )
    .optional()
}

// Playlist operations
pub fn create_playlist(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name])?;
    Ok(conn.last_insert_rowid())
}

pub fn get_all_playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut stmt =
        conn.prepare("SELECT id, name, cover_url, created_at FROM playlists ORDER BY name")?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                cover_url: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(playlists)
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i64) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id, t.local_src, t.track_cover, t.track_cover_path, t.disc_number, t.metadata_json, t.date_added 
         FROM tracks t
         INNER JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position",
    )?;

    let tracks = stmt
        .query_map([playlist_id], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn add_track_to_playlist(conn: &Connection, playlist_id: i64, track_id: i64) -> Result<()> {
    let position: i32 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
        [playlist_id],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
        params![playlist_id, track_id, position],
    )?;

    Ok(())
}

pub fn remove_track_from_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_id: i64,
) -> Result<()> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, playlist_id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])?;
    Ok(())
}

pub fn rename_playlist(conn: &Connection, playlist_id: i64, new_name: &str) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![new_name, playlist_id],
    )?;
    Ok(())
}

pub fn update_playlist_cover(
    conn: &Connection,
    playlist_id: i64,
    cover_url: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET cover_url = ?1 WHERE id = ?2",
        params![cover_url, playlist_id],
    )?;
    Ok(())
}

// Music folder operations
pub fn add_music_folder(conn: &Connection, path: &str) -> Result<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO music_folders (path, last_scanned) VALUES (?1, CURRENT_TIMESTAMP)",
        [path],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_music_folders(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM music_folders ORDER BY path")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    let mut folders = Vec::new();
    for folder in rows {
        folders.push(folder?);
    }
    Ok(folders)
}

pub fn remove_music_folder(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM music_folders WHERE path = ?1", [path])?;
    Ok(())
}

pub fn update_folder_last_scanned(conn: &Connection, path: &str) -> Result<()> {
    conn.execute(
        "UPDATE music_folders SET last_scanned = CURRENT_TIMESTAMP WHERE path = ?1",
        [path],
    )?;
    Ok(())
}

// Cleanup tracks that no longer exist on filesystem
pub fn cleanup_deleted_tracks(conn: &Connection, folder_paths: &[String]) -> Result<usize> {
    if folder_paths.is_empty() {
        return Ok(0);
    }

    // Build query with OR conditions for each folder
    let conditions: Vec<String> = folder_paths
        .iter()
        .enumerate()
        .map(|(i, _)| format!("path LIKE ?{}", i + 1))
        .collect();
    let query = format!(
        "SELECT id, path FROM tracks WHERE {}",
        conditions.join(" OR ")
    );

    let mut params = Vec::new();
    for folder in folder_paths {
        params.push(format!("{}%", folder));
    }

    let mut stmt = conn.prepare(&query)?;
    let track_rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut deleted_count = 0;
    for track_result in track_rows {
        let (id, path) = track_result?;
        if !std::path::Path::new(&path).exists() {
            // Track file doesn't exist, remove it
            conn.execute("DELETE FROM tracks WHERE id = ?1", [id])?;
            deleted_count += 1;
        }
    }

    Ok(deleted_count)
}

/// Cleanup albums that have no tracks associated with them
pub fn cleanup_empty_albums(conn: &Connection) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)",
        [],
    )?;
    Ok(deleted)
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

// ============================================================================
// Liked Tracks operations
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackWithCount {
    pub track: Track,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumWithCount {
    pub album: Album,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistWithCount {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsSummary {
    pub total_plays: i64,
    pub total_duration_seconds: i64,
    pub top_artist: Option<String>,
    pub top_genre: Option<String>, // Placeholder for now
}

pub fn like_track(conn: &Connection, track_id: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO liked_tracks (track_id) VALUES (?1)",
        params![track_id],
    )?;
    Ok(())
}

pub fn unlike_track(conn: &Connection, track_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM liked_tracks WHERE track_id = ?1",
        params![track_id],
    )?;
    Ok(())
}

pub fn is_track_liked(conn: &Connection, track_id: i64) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM liked_tracks WHERE track_id = ?1",
        params![track_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn get_liked_track_ids(conn: &Connection) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT track_id FROM liked_tracks ORDER BY liked_at DESC")?;
    let ids = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;
    Ok(ids)
}

pub fn get_liked_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id, t.local_src, t.track_cover_path, t.disc_number, t.metadata_json, t.date_added
         FROM tracks t
         INNER JOIN liked_tracks lt ON t.id = lt.track_id
         ORDER BY lt.liked_at DESC",
    )?;

    let tracks = stmt
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

// ============================================================================
// Play History operations
// ============================================================================

pub fn record_play(
    conn: &Connection,
    track_id: i64,
    album_id: Option<i64>,
    duration_played: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO play_history (track_id, album_id, duration_played) VALUES (?1, ?2, ?3)",
        params![track_id, album_id, duration_played],
    )?;
    Ok(())
}

pub fn get_top_tracks(conn: &Connection, limit: i32) -> Result<Vec<TrackWithCount>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id, t.local_src, t.track_cover_path, t.disc_number, t.metadata_json, t.date_added, COUNT(ph.id) as play_count
         FROM tracks t
         INNER JOIN play_history ph ON t.id = ph.track_id
         WHERE strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY t.id
         ORDER BY play_count DESC
         LIMIT ?1",
    )?;

    let results = stmt
        .query_map(params![limit], |row| {
            Ok(TrackWithCount {
                track: Track {
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
                },
                play_count: row.get(18)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(results)
}

pub fn get_top_albums(conn: &Connection, limit: i32) -> Result<Vec<AlbumWithCount>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, a.artist, a.art_data, a.art_path, COUNT(ph.id) as play_count
         FROM albums a
         INNER JOIN play_history ph ON a.id = ph.album_id
         WHERE ph.album_id IS NOT NULL 
         AND strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY a.id
         ORDER BY play_count DESC
         LIMIT ?1",
    )?;

    let results = stmt
        .query_map(params![limit], |row| {
            Ok(AlbumWithCount {
                album: Album {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    artist: row.get(2)?,
                    art_data: row.get(3)?,
                    art_path: row.get(4)?,
                },
                play_count: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(results)
}

pub fn get_recently_played(conn: &Connection, limit: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id, t.local_src, t.track_cover_path, t.disc_number, t.metadata_json, t.date_added, MAX(ph.played_at) as last_played
         FROM tracks t
         INNER JOIN play_history ph ON t.id = ph.track_id
         GROUP BY t.id
         ORDER BY last_played DESC
         LIMIT ?1",
    )?;

    let tracks = stmt
        .query_map(params![limit], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_top_artists(conn: &Connection, limit: i32) -> Result<Vec<ArtistWithCount>> {
    let mut stmt = conn.prepare(
        "SELECT t.artist, COUNT(ph.id) as play_count
         FROM tracks t
         INNER JOIN play_history ph ON t.id = ph.track_id
         WHERE t.artist IS NOT NULL
         AND strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY t.artist
         ORDER BY play_count DESC
         LIMIT ?1",
    )?;

    let results = stmt
        .query_map(params![limit], |row| {
            Ok(ArtistWithCount {
                artist: row.get(0)?,
                play_count: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(results)
}

pub fn get_stats_summary(conn: &Connection) -> Result<StatsSummary> {
    let total_plays: i64 =
        conn.query_row("SELECT COUNT(*) FROM play_history WHERE strftime('%Y-%m', played_at) = strftime('%Y-%m', 'now')", [], |row| row.get(0))?;

    let total_duration: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_played), 0) FROM play_history WHERE strftime('%Y-%m', played_at) = strftime('%Y-%m', 'now')",
        [],
        |row| row.get(0),
    )?;

    let top_artist: Option<String> = conn
        .query_row(
            "SELECT t.artist
         FROM tracks t
         INNER JOIN play_history ph ON t.id = ph.track_id
         WHERE t.artist IS NOT NULL
         AND strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY t.artist
         ORDER BY COUNT(ph.id) DESC
         LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    Ok(StatsSummary {
        total_plays,
        total_duration_seconds: total_duration,
        top_artist,
        top_genre: None,
    })
}

// =============================================================================
// SYNC QUEUE & METADATA OPERATIONS
// =============================================================================

/// A single pending change queued for sync to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    pub payload: Option<String>,
    pub created_at: Option<String>,
    pub retry_count: i32,
}

/// Enqueue a change to the sync queue.
pub fn enqueue_sync_change(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    operation: &str,
    payload: Option<&str>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, operation, payload)
         VALUES (?1, ?2, ?3, ?4)",
        params![entity_type, entity_id, operation, payload],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get all pending sync queue entries, ordered by id.
pub fn get_sync_queue(conn: &Connection) -> Result<Vec<SyncQueueEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, operation, payload, created_at, retry_count
         FROM sync_queue
         ORDER BY id",
    )?;

    let entries = stmt
        .query_map([], |row| {
            Ok(SyncQueueEntry {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                operation: row.get(3)?,
                payload: row.get(4)?,
                created_at: row.get(5)?,
                retry_count: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(entries)
}

/// Get the count of pending sync queue entries.
pub fn get_sync_queue_count(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM sync_queue", [], |row| row.get(0))
}

/// Delete processed sync queue entries (by their IDs).
pub fn delete_sync_queue_entries(conn: &Connection, ids: &[i64]) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "DELETE FROM sync_queue WHERE id IN ({})",
        placeholders.join(",")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Increment retry_count for failed sync queue entries.
pub fn increment_sync_retry(conn: &Connection, ids: &[i64]) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id IN ({})",
        placeholders.join(",")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

/// Clear the entire sync queue (e.g., on logout).
pub fn clear_sync_queue(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM sync_queue", [])?;
    Ok(())
}

// ─── Sync Metadata (key-value store) ────────────────────────────────────────

/// Get a sync metadata value by key.
pub fn get_sync_meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM sync_metadata WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// Helper: check if user is logged in (for sync enqueuing)
pub fn is_logged_in(conn: &Connection) -> bool {
    get_sync_meta(conn, "access_token").ok().flatten().is_some()
        && get_sync_meta(conn, "user_id").ok().flatten().is_some()
}

/// Set a sync metadata value (upsert).
pub fn set_sync_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_metadata (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Delete a sync metadata key.
pub fn delete_sync_meta(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM sync_metadata WHERE key = ?1", params![key])?;
    Ok(())
}

/// Clear all sync metadata (e.g., on logout).
pub fn clear_sync_metadata(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM sync_metadata", [])?;
    Ok(())
}

// ─── Playlist sync helpers ──────────────────────────────────────────────────

/// Get a playlist's server_id mapping.
pub fn get_playlist_server_id(conn: &Connection, local_id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT server_id FROM playlists WHERE id = ?1",
        params![local_id],
        |row| row.get(0),
    )
    .optional()
}

/// Set a playlist's server_id mapping.
pub fn set_playlist_server_id(conn: &Connection, local_id: i64, server_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET server_id = ?1 WHERE id = ?2",
        params![server_id, local_id],
    )?;
    Ok(())
}

/// Find a local playlist by its server_id.
pub fn find_playlist_by_server_id(conn: &Connection, server_id: &str) -> Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM playlists WHERE server_id = ?1",
        params![server_id],
        |row| row.get(0),
    )
    .optional()
}

/// Soft-delete a playlist (mark as deleted without removing from DB).
pub fn soft_delete_playlist(conn: &Connection, playlist_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET deleted = 1 WHERE id = ?1",
        params![playlist_id],
    )?;
    Ok(())
}

/// Get the content_hash for a track by ID (used to identify tracks across devices).
pub fn get_track_content_hash(conn: &Connection, track_id: i64) -> Result<Option<String>> {
    conn.query_row(
        "SELECT content_hash FROM tracks WHERE id = ?1",
        params![track_id],
        |row| row.get(0),
    )
    .optional()
}

/// Get basic track info for sync payload (denormalized).
pub fn get_track_sync_info(
    conn: &Connection,
    track_id: i64,
) -> Result<
    Option<(
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<String>,
    )>,
> {
    conn.query_row(
        "SELECT COALESCE(content_hash, ''), title, artist, album, duration, cover_url
         FROM tracks WHERE id = ?1",
        params![track_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        },
    )
    .optional()
}

// =============================================================================
// SYNC ID MAPPING (local integer IDs ↔ server UUIDs)
// =============================================================================

/// Get or create a server UUID for a local entity ID.
/// If a mapping already exists, returns it; otherwise generates a new UUID.
pub fn get_or_create_server_id(
    conn: &Connection,
    local_id: &str,
    entity_type: &str,
) -> Result<String> {
    // Check if mapping already exists
    let existing: Option<String> = conn
        .query_row(
            "SELECT server_id FROM sync_id_map WHERE local_id = ?1 AND entity_type = ?2",
            params![local_id, entity_type],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(server_id) = existing {
        return Ok(server_id);
    }

    // Generate new UUID
    let server_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO sync_id_map (local_id, entity_type, server_id) VALUES (?1, ?2, ?3)",
        params![local_id, entity_type, server_id],
    )?;

    Ok(server_id)
}

/// Get server ID for a local entity (returns None if not mapped).
pub fn get_server_id(
    conn: &Connection,
    local_id: &str,
    entity_type: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT server_id FROM sync_id_map WHERE local_id = ?1 AND entity_type = ?2",
        params![local_id, entity_type],
        |row| row.get(0),
    )
    .optional()
}

/// Get local ID from server ID.
pub fn get_local_id_from_server(
    conn: &Connection,
    server_id: &str,
    entity_type: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT local_id FROM sync_id_map WHERE server_id = ?1 AND entity_type = ?2",
        params![server_id, entity_type],
        |row| row.get(0),
    )
    .optional()
}

/// Store a server-to-local ID mapping (used when applying server changes).
pub fn store_id_mapping(
    conn: &Connection,
    local_id: &str,
    entity_type: &str,
    server_id: &str,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sync_id_map (local_id, entity_type, server_id) VALUES (?1, ?2, ?3)",
        params![local_id, entity_type, server_id],
    )?;
    Ok(())
}

/// Clear all sync ID mappings (e.g., on logout).
pub fn clear_sync_id_map(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM sync_id_map", [])?;
    Ok(())
}

/// Helper: build a track hash for sync payloads (title|artist|album)
pub fn build_track_hash_str(
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}",
        title.unwrap_or(""),
        artist.unwrap_or(""),
        album.unwrap_or("")
    )
}

/// Enqueue a library track sync change.
pub fn enqueue_track_sync_change(conn: &Connection, track: &Track, operation: &str) -> Result<()> {
    if !is_logged_in(conn) {
        return Ok(());
    }

    let track_hash = build_track_hash_str(
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
        "externalId": track.external_id,
        "sourceType": track.source_type,
        "coverUrl": track.cover_url,
        "trackNumber": track.track_number,
        "discNumber": track.disc_number,
        "format": track.format,
        "bitrate": track.bitrate,
    });

    let _ = enqueue_sync_change(
        conn,
        "library_track",
        &format!("local_lib_{}", track.id),
        operation,
        Some(&payload.to_string()),
    );

    Ok(())
}
