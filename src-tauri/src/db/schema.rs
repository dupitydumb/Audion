// Database schema initialization
use rusqlite::{Connection, Result};

pub fn init_schema(conn: &Connection) -> Result<()> {
    // Enable foreign keys for this connection
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    conn.execute_batch(
        "
        -- Albums table
        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            artist TEXT,
            art_data TEXT,
            art_path TEXT
        );

        -- Tracks table
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            track_number INTEGER,
            disc_number INTEGER,
            duration INTEGER,
            album_id INTEGER,
            format TEXT,
            bitrate INTEGER,
            source_type TEXT DEFAULT 'local',
            cover_url TEXT,
            external_id TEXT,
            content_hash TEXT,
            local_src TEXT,
            track_cover TEXT,
            track_cover_path TEXT,
            FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
        );

        -- Playlists table
        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cover_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Playlist tracks junction table
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        -- Scanned music folders
        CREATE TABLE IF NOT EXISTS music_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            last_scanned TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Liked tracks table
        CREATE TABLE IF NOT EXISTS liked_tracks (
            track_id INTEGER PRIMARY KEY,
            liked_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        -- Play history table (one row per play event)
        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            album_id INTEGER,
            played_at TEXT DEFAULT CURRENT_TIMESTAMP,
            duration_played INTEGER DEFAULT 0,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        -- Play history indexes for fast aggregation
        CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
        CREATE INDEX IF NOT EXISTS idx_play_history_album ON play_history(album_id);
        CREATE INDEX IF NOT EXISTS idx_play_history_time ON play_history(played_at);

        -- Composite index
        -- This single index covers: ORDER BY artist, album, track_number, title
        CREATE INDEX IF NOT EXISTS idx_tracks_sort ON tracks(artist, album, track_number, title);
        

        -- Create indexes for faster queries (except content_hash which needs migration first)
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
        ",
    )?;

    // Migrations for existing databases
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN format TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN bitrate INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE tracks ADD COLUMN source_type TEXT DEFAULT 'local'",
        [],
    );
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN cover_url TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN external_id TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN content_hash TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN local_src TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN track_cover TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN disc_number INTEGER", []);

    // Add path columns for file-based cover storage
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN track_cover_path TEXT", []);
    let _ = conn.execute("ALTER TABLE albums ADD COLUMN art_path TEXT", []);

    // Create index for content_hash after migration ensures column exists
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)",
        [],
    );

    // Add cover_url to playlists table for existing databases
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN cover_url TEXT", []);

    // Initialize playlist positions for existing playlists
    initialize_playlist_positions(conn)?;

    Ok(())
}

/// Initialize positions for playlists that don't have them
/// Safe to run multiple times - only affects playlists with NULL positions
fn initialize_playlist_positions(conn: &Connection) -> Result<()> {
    use rusqlite::params;

    // Get all unique playlist IDs that have tracks without positions
    let mut stmt = conn.prepare(
        "SELECT DISTINCT playlist_id 
         FROM playlist_tracks 
         WHERE position IS NULL",
    )?;

    let playlist_ids: Vec<i64> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>>>()?;

    // For each playlist, assign sequential positions
    for playlist_id in playlist_ids {
        // Get all track_ids in this playlist (in insertion order via rowid)
        let mut track_stmt = conn.prepare(
            "SELECT track_id 
             FROM playlist_tracks 
             WHERE playlist_id = ?1 
             ORDER BY rowid",
        )?;

        let track_ids: Vec<i64> = track_stmt
            .query_map(params![playlist_id], |row| row.get(0))?
            .collect::<Result<Vec<_>>>()?;

        // Assign sequential positions
        for (pos, track_id) in track_ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlist_tracks 
                 SET position = ?1 
                 WHERE playlist_id = ?2 AND track_id = ?3",
                params![pos as i64, playlist_id, track_id],
            )?;
        }
    }

    Ok(())
}
