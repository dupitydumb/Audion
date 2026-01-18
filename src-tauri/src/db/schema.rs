// Database schema initialization
use rusqlite::{Connection, Result};

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- Albums table
        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            artist TEXT,
            art_data TEXT
        );

        -- Tracks table
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            track_number INTEGER,
            duration INTEGER,
            album_id INTEGER,
            format TEXT,
            bitrate INTEGER,
            source_type TEXT DEFAULT 'local',
            cover_url TEXT,
            external_id TEXT,
            content_hash TEXT,
            FOREIGN KEY (album_id) REFERENCES albums(id)
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

        -- Create indexes for faster queries
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
        CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
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

    // Create index for content_hash after migration ensures column exists
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash)",
        [],
    );

    // Add cover_url to playlists table for existing databases
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN cover_url TEXT", []);

    Ok(())
}
