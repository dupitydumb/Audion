// Liked tracks management
use rusqlite::{params, Connection, OptionalExtension, Result};

use super::models::Track;
use super::artists;

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

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}

/// Get tracks that were partially played (continue listening)
pub fn get_continue_listening(conn: &Connection, limit: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.track_number, t.duration, t.album_id, t.format, t.bitrate, t.source_type, t.cover_url, t.external_id, t.local_src, t.track_cover_path, t.disc_number, t.metadata_json, t.date_added, MAX(ph.played_at) as last_partial_play
         FROM tracks t
         INNER JOIN play_history ph ON t.id = ph.track_id
         WHERE ph.duration_played > 10 
           AND t.duration IS NOT NULL 
           AND t.duration > 20 
           AND ph.duration_played < (t.duration - 10)
         GROUP BY COALESCE(t.album_id, -t.id)
         ORDER BY last_partial_play DESC
         LIMIT ?1",
    )?;

    let mut tracks = stmt
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
                artists: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    artists::attach_artists(conn, &mut tracks)?;
    Ok(tracks)
}
