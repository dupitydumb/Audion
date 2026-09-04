// Playlist management queries
use rusqlite::{params, Connection, Result};

use super::models::{Playlist, Track};
use super::artists;

// Playlist operations
pub fn create_playlist(conn: &Connection, name: &str, cover_url: Option<&str>) -> Result<i64> {
    conn.execute(
        "INSERT INTO playlists (name, cover_url) VALUES (?1, ?2)",
        params![name, cover_url],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_all_playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut stmt =
        conn.prepare("SELECT id, name, cover_url, created_at, folder_path FROM playlists ORDER BY name")?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                cover_url: row.get(2)?,
                created_at: row.get(3)?,
                folder_path: row.get(4)?,
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

    let mut tracks = stmt
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
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// track counts for every playlist in one query
/// playlists with zero tracks are absent from the result map
pub fn get_playlist_track_counts(conn: &Connection) -> Result<std::collections::HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "SELECT playlist_id, COUNT(*) FROM playlist_tracks GROUP BY playlist_id",
    )?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows.into_iter().collect())
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

pub fn get_folder_playlists(conn: &Connection) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_path FROM playlists WHERE folder_path IS NOT NULL"
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub fn set_playlist_folder_path(conn: &Connection, playlist_id: i64, folder_path: &str) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET folder_path = ?1 WHERE id = ?2",
        params![folder_path, playlist_id],
    )?;
    Ok(())
}
