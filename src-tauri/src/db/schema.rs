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
            metadata_json TEXT,
            date_added TEXT DEFAULT CURRENT_TIMESTAMP,
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

    // Verify or add columns one by one for better reliability
    let tracks_columns = [
        ("format", "TEXT"),
        ("bitrate", "INTEGER"),
        ("source_type", "TEXT DEFAULT 'local'"),
        ("cover_url", "TEXT"),
        ("external_id", "TEXT"),
        ("content_hash", "TEXT"),
        ("local_src", "TEXT"),
        ("track_cover", "TEXT"),
        ("disc_number", "INTEGER"),
        ("track_cover_path", "TEXT"),
        ("musicbrainz_recording_id", "TEXT"),
        ("date_added", "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("genre", "TEXT"),
        ("metadata_json", "TEXT"),
    ];

    for (col_name, col_def) in tracks_columns {
        if !column_exists(conn, "tracks", col_name)? {
            println!(
                "[DB] Adding missing column '{}' to tracks table...",
                col_name
            );
            // SQLite limitation: ALTER TABLE cannot add a column with non-constant default like CURRENT_TIMESTAMP
            // So we add it without the default first
            let base_def = if col_name == "date_added" {
                "TEXT"
            } else {
                col_def
            };
            let sql = format!("ALTER TABLE tracks ADD COLUMN {} {}", col_name, base_def);

            if let Err(e) = conn.execute(&sql, []) {
                eprintln!("[DB] Failed to add column '{}': {}", col_name, e);
            } else {
                println!("[DB] Successfully added column '{}'.", col_name);

                // If we're adding date_added, populate existing rows with current time
                if col_name == "date_added" {
                    println!("[DB] Populating date_added for existing tracks...");
                    let _ = conn.execute(
                        "UPDATE tracks SET date_added = CURRENT_TIMESTAMP WHERE date_added IS NULL",
                        [],
                    );
                }
            }
        }
    }

    // Safety backfill: some older DBs or custom insert paths may still have NULL date_added.
    // Keep this idempotent so Date Added is always present for existing tracks.
    let _ = conn.execute(
        "UPDATE tracks SET date_added = CURRENT_TIMESTAMP WHERE date_added IS NULL",
        [],
    );

    // Create index for content_hash after migration ensures column exists
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)",
        [],
    );

    // Create index for MusicBrainz ID
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_mbid ON tracks(musicbrainz_recording_id)",
        [],
    );

    // Verify or add columns to albums table
    if !column_exists(conn, "albums", "art_path")? {
        println!("[DB] Adding missing column 'art_path' to albums table...");
        let _ = conn.execute("ALTER TABLE albums ADD COLUMN art_path TEXT", []);
    }

    // ─── Sync infrastructure tables ──────────────────────────────────────────
    conn.execute_batch(
        "
        -- Unified sync queue: all pending changes to push to server
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,   -- 'playlist' | 'playlist_track' | 'liked_track' | 'settings'
            entity_id TEXT NOT NULL,     -- local ID or composite key
            operation TEXT NOT NULL,     -- 'create' | 'update' | 'delete'
            payload TEXT,               -- JSON snapshot of the entity at time of change
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            retry_count INTEGER DEFAULT 0
        );

        -- Sync metadata: stores auth tokens, sync cursor, user info
        CREATE TABLE IF NOT EXISTS sync_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Sync ID mapping: maps local integer IDs to server UUIDs
        CREATE TABLE IF NOT EXISTS sync_id_map (
            local_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            server_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (local_id, entity_type)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_id_map_server
            ON sync_id_map(server_id, entity_type);
        ",
    )?;

    // Add sync columns to playlists (safe migrations for existing DBs)
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN server_id TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE playlists ADD COLUMN version INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE playlists ADD COLUMN deleted INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN folder_path TEXT", []);
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_server_id ON playlists(server_id)",
        [],
    );

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

/// Check if a column exists in a specific table
fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table_name))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}
