// Play history, top tracks/albums/artists, stats summary
use rusqlite::{params, Connection, OptionalExtension, Result};

use super::models::{Album, AlbumWithCount, Artist, ArtistWithCount, StatsSummary, Track, TrackWithCount};
use super::artists;

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
                    artists: Vec::new(),
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
                    artists: Vec::new(),
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

pub fn get_top_artists(conn: &Connection, limit: i32) -> Result<Vec<ArtistWithCount>> {
    let mut stmt = conn.prepare(
        "SELECT ar.name, COUNT(ph.id) as play_count
         FROM artists ar
         INNER JOIN track_artists ta ON ta.artist_id = ar.id
         INNER JOIN play_history ph ON ph.track_id = ta.track_id
         WHERE strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY ar.id
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
            "SELECT ar.name
         FROM artists ar
         INNER JOIN track_artists ta ON ta.artist_id = ar.id
         INNER JOIN play_history ph ON ph.track_id = ta.track_id
         WHERE strftime('%Y-%m', ph.played_at) = strftime('%Y-%m', 'now')
         GROUP BY ar.id
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
