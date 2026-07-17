// artist entity + track_artists join table helpers
//
// tracks.artist (and albums.artist) stay as the raw, unsplit display string written by the tagger
// this module is responsible for keeping the derived artists/track_artists tables in sync with that raw string
// using scanner::artist_parser::split_artists (currently hardcoded rules -
// see that module's doc comment)

use rusqlite::{params, Connection, Result};
use std::collections::HashMap;

use crate::scanner::artist_parser::split_artists;
use super::models::Track;

/// look up an artist by (case insensitive) name, inserting it if it doesn't exist yet, and return its id
fn get_or_create_artist_id(conn: &Connection, name: &str) -> Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM artists WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        return Ok(id);
    }

    conn.execute("INSERT INTO artists (name) VALUES (?1)", params![name])?;
    Ok(conn.last_insert_rowid())
}

/// re derive and persist the track_artists rows for a single track from its raw artist string
/// call this any time tracks.artist is written
/// (insert, update, manual tag edit) so the join table never drifts out of sync with the raw column
///
/// existing track_artists rows for this track are cleared first
pub fn sync_track_artists_for_track(
    conn: &Connection,
    track_id: i64,
    raw_artist: Option<&str>,
) -> Result<()> {
    conn.execute(
        "DELETE FROM track_artists WHERE track_id = ?1",
        params![track_id],
    )?;

    let Some(raw) = raw_artist else {
        return Ok(());
    };

    let names = split_artists(raw);
    for (position, name) in names.iter().enumerate() {
        let artist_id = get_or_create_artist_id(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?1, ?2, ?3)",
            params![track_id, artist_id, position as i64],
        )?;
    }

    Ok(())
}

/// one time migration for existing databases:
///    if tracks exist but track_artists is still empty, walk every track and populate it from the existing raw artist strings
/// safe to call on every startup
///    it only does work the first time a db created before this feature is opened
///
/// this uses whatever the hardcoded default split rules are
/// if the rules change later (e.g. once they're user configurable), a full re backfill will be needed
/// TODO : handle rebackfill when configurable rules are added
pub fn backfill_track_artists_if_needed(conn: &Connection) -> Result<()> {
    let track_artists_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM track_artists", [], |row| row.get(0))?;
    if track_artists_count > 0 {
        return Ok(());
    }

    let track_count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))?;
    if track_count == 0 {
        return Ok(());
    }

    println!("[DB] Backfilling track_artists from existing tracks.artist values...");

    let mut stmt = conn.prepare("SELECT id, artist FROM tracks")?;
    let rows: Vec<(i64, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>>>()?;
    drop(stmt);

    let total = rows.len();
    for (track_id, artist) in rows {
        sync_track_artists_for_track(conn, track_id, artist.as_deref())?;
    }

    println!("[DB] Backfilled track_artists for {} tracks.", total);
    Ok(())
}

/// batch populate track.artists (the split per artist name list)
/// for a slice of already fetched tracks, in a single query keyed by their ids
/// call this at the end of any query function that returns Vec<Track>, right before returning, e.g:
///
/// ```ignore
/// let mut tracks = ...; // built the usual way, artists left empty
/// attach_artists(conn, &mut tracks)?;
/// Ok(tracks)
/// ```
///
/// falls back to a single element vec built from the raw artist string if a track has no rows in track_artists yet
pub fn attach_artists(conn: &Connection, tracks: &mut [Track]) -> Result<()> {
    if tracks.is_empty() {
        return Ok(());
    }

    let ids: Vec<i64> = tracks.iter().map(|t| t.id).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT ta.track_id, ar.name
         FROM track_artists ta
         JOIN artists ar ON ar.id = ta.artist_id
         WHERE ta.track_id IN ({})
         ORDER BY ta.track_id, ta.position",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut by_track: HashMap<i64, Vec<String>> = HashMap::new();
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (track_id, name) = row?;
        by_track.entry(track_id).or_default().push(name);
    }

    for track in tracks.iter_mut() {
        match by_track.remove(&track.id) {
            Some(names) => track.artists = names,
            // not backfilled yet, or artist is NULL => derive on the fly
            // so the field is never surprisingly empty for a track that does have a raw artist string
            None => track.artists = track.artist.as_deref().map(split_artists).unwrap_or_default(),
        }
    }

    Ok(())
}