// artist entity + track_artists join table helpers
//
// tracks.artist (and albums.artist) stay as the raw, unsplit display string written by the tagger
// this module is responsible for keeping the derived artists/track_artists tables in sync with that raw string
// using scanner::artist_parser::split_artists (currently hardcoded rules -
// see that module's doc comment)

use rusqlite::{params, Connection, Result};
use std::collections::HashMap;

use crate::scanner::artist_parser::split_artists;
use super::models::{AlbumArtistMode, Track};

/// process wide cache of the currently active AlbumArtistMode
/// populated once at startup from commands::app_settings::load_app_settings (see lib.rs setup)
/// refreshed by commands::app_settings::set_album_artist_mode
static ACTIVE_ALBUM_ARTIST_MODE: std::sync::OnceLock<std::sync::RwLock<AlbumArtistMode>> =
    std::sync::OnceLock::new();

fn active_album_artist_mode_lock() -> &'static std::sync::RwLock<AlbumArtistMode> {
    ACTIVE_ALBUM_ARTIST_MODE.get_or_init(|| std::sync::RwLock::new(AlbumArtistMode::default()))
}

pub fn set_active_album_artist_mode(mode: AlbumArtistMode) {
    if let Ok(mut guard) = active_album_artist_mode_lock().write() {
        *guard = mode;
    }
}

pub fn active_album_artist_mode() -> AlbumArtistMode {
    active_album_artist_mode_lock()
        .read()
        .map(|guard| *guard)
        .unwrap_or_default()
}

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

/// unconditionally re derive track_artists for every track using whatever delimiter rules are currently active
/// scanner::artist_parser::active_delimiters
///
/// unlike backfill_track_artists_if_needed, this always runs regardless of whether track_artists already has rows
/// call it right after the user saves new split rules
/// commands::app_settings::set_artist_split_rules
/// returns the number of tracks re derived
pub fn resplit_all_track_artists(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare("SELECT id, artist FROM tracks")?;
    let rows: Vec<(i64, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>>>()?;
    drop(stmt);

    let total = rows.len();
    for (track_id, artist) in rows {
        sync_track_artists_for_track(conn, track_id, artist.as_deref())?;
    }

    Ok(total)
}

/// re derive and persist the album_artists rows for a single album from its raw artist string (albums.artist)
/// call this any time albums.artist is written/changed, whichever
/// AlbumArtistMode produced that value (tag based or first-track fallback)
/// see db::tracks::get_or_create_album
pub fn sync_album_artists_for_album(
    conn: &Connection,
    album_id: i64,
    raw_artist: Option<&str>,
) -> Result<()> {
    conn.execute(
        "DELETE FROM album_artists WHERE album_id = ?1",
        params![album_id],
    )?;

    let Some(raw) = raw_artist else {
        return Ok(());
    };

    let names = split_artists(raw);
    for (position, name) in names.iter().enumerate() {
        let artist_id = get_or_create_artist_id(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO album_artists (album_id, artist_id, position) VALUES (?1, ?2, ?3)",
            params![album_id, artist_id, position as i64],
        )?;
    }

    Ok(())
}

/// one time migration for databases that predate the album_artists table
/// safe to call every startup (only does work the first time)
pub fn backfill_album_artists_if_needed(conn: &Connection) -> Result<()> {
    let album_artists_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM album_artists", [], |row| row.get(0))?;
    if album_artists_count > 0 {
        return Ok(());
    }

    let album_count: i64 = conn.query_row("SELECT COUNT(*) FROM albums", [], |row| row.get(0))?;
    if album_count == 0 {
        return Ok(());
    }

    println!("[DB] Backfilling album_artists from existing albums.artist values...");

    let mut stmt = conn.prepare("SELECT id, artist FROM albums")?;
    let rows: Vec<(i64, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>>>()?;
    drop(stmt);

    let total = rows.len();
    for (album_id, artist) in rows {
        sync_album_artists_for_album(conn, album_id, artist.as_deref())?;
    }

    println!("[DB] Backfilled album_artists for {} albums.", total);
    Ok(())
}

/// batch populate album.artists (the split per artist name list) for a slice of already fetched albums
/// in a single query keyed by their ids
/// call at the end of any query function that returns Vec<Album>/Option<Album>, right before returning
///
/// falls back to a single element vec built from the raw artist string
/// if an album has no rows in album_artists yet
/// (e.g. created before this feature, pending the startup backfill)
pub fn attach_album_artists(conn: &Connection, albums: &mut [super::models::Album]) -> Result<()> {
    if albums.is_empty() {
        return Ok(());
    }

    let ids: Vec<i64> = albums.iter().map(|a| a.id).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT aa.album_id, ar.name
         FROM album_artists aa
         JOIN artists ar ON ar.id = aa.artist_id
         WHERE aa.album_id IN ({})
         ORDER BY aa.album_id, aa.position",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut by_album: HashMap<i64, Vec<String>> = HashMap::new();
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (album_id, name) = row?;
        by_album.entry(album_id).or_default().push(name);
    }

    for album in albums.iter_mut() {
        match by_album.remove(&album.id) {
            Some(names) => album.artists = names,
            None => album.artists = album.artist.as_deref().map(split_artists).unwrap_or_default(),
        }
    }

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