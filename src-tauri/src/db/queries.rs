// Database query operations
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: i64,
    pub name: String,
    pub artist: Option<String>,
    pub art_data: Option<String>,
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
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInsert {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_art: Option<String>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
}

// Track operations
pub fn insert_or_update_track(conn: &Connection, track: &TrackInsert) -> Result<i64> {
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

    conn.execute(
        "INSERT INTO tracks (path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(path) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            track_number = excluded.track_number,
            duration = excluded.duration,
            album_id = excluded.album_id,
            format = excluded.format,
            bitrate = excluded.bitrate,
            source_type = excluded.source_type,
            cover_url = excluded.cover_url,
            external_id = excluded.external_id",
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
        ],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Delete a track from the database by ID
pub fn delete_track(conn: &Connection, track_id: i64) -> Result<bool> {
    let deleted = conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
    Ok(deleted > 0)
}

fn get_or_create_album(
    conn: &Connection,
    name: &str,
    artist: Option<&str>,
    art_data: Option<&str>,
) -> Result<i64> {
    // Try to find existing album
    let existing: Option<i64> = conn.query_row(
        "SELECT id FROM albums WHERE name = ?1 AND (artist = ?2 OR (artist IS NULL AND ?2 IS NULL))",
        params![name, artist],
        |row| row.get(0),
    ).ok();

    if let Some(id) = existing {
        // Update art if we have new art data and existing doesn't have it
        if let Some(art) = art_data {
            conn.execute(
                "UPDATE albums SET art_data = ?1 WHERE id = ?2 AND art_data IS NULL",
                params![art, id],
            )?;
        }
        return Ok(id);
    }

    // Create new album
    conn.execute(
        "INSERT INTO albums (name, artist, art_data) VALUES (?1, ?2, ?3)",
        params![name, artist, art_data],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Delete an album and all its associated tracks
pub fn delete_album(conn: &Connection, album_id: i64) -> Result<bool> {
    // Transaction to ensure atomicity
    conn.execute_batch(&format!(
        "BEGIN;
         DELETE FROM tracks WHERE album_id = {};
         DELETE FROM albums WHERE id = {};
         COMMIT;",
        album_id, album_id
    ))
    .map(|_| true)
    .map_err(|e| e)
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id 
         FROM tracks ORDER BY artist, album, track_number, title",
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_all_albums(conn: &Connection) -> Result<Vec<Album>> {
    let mut stmt =
        conn.prepare("SELECT id, name, artist, art_data FROM albums ORDER BY artist, name")?;

    let albums = stmt
        .query_map([], |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(albums)
}

pub fn get_all_artists(conn: &Connection) -> Result<Vec<Artist>> {
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

    Ok(artists)
}

pub fn get_tracks_by_album(conn: &Connection, album_id: i64) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id 
         FROM tracks WHERE album_id = ?1 ORDER BY track_number, title",
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_tracks_by_artist(conn: &Connection, artist: &str) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, track_number, duration, album_id, format, bitrate, source_type, cover_url, external_id 
         FROM tracks WHERE artist = ?1 ORDER BY album, track_number, title",
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn get_album_by_id(conn: &Connection, album_id: i64) -> Result<Option<Album>> {
    conn.query_row(
        "SELECT id, name, artist, art_data FROM albums WHERE id = ?1",
        [album_id],
        |row| {
            Ok(Album {
                id: row.get(0)?,
                name: row.get(1)?,
                artist: row.get(2)?,
                art_data: row.get(3)?,
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
    let mut stmt = conn.prepare("SELECT id, name, created_at FROM playlists ORDER BY name")?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(playlists)
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i64) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id 
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
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(tracks)
}

pub fn add_track_to_playlist(conn: &Connection, playlist_id: i64, track_id: i64) -> Result<()> {
    // Get the next position
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
