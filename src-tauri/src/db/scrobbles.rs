use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedScrobble {
    pub id: i64,
    pub service: String,
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub duration: Option<i32>,
    pub timestamp: u64,
    pub retry_count: i32,
}

pub fn insert_cached_scrobble(
    conn: &Connection,
    service: &str,
    artist: &str,
    title: &str,
    album: Option<&str>,
    duration: Option<i32>,
    timestamp: u64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO scrobble_cache (service, artist, title, album, duration, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
        params![service, artist, title, album, duration, timestamp as i64],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_cached_scrobbles(conn: &Connection, limit: usize) -> Result<Vec<CachedScrobble>> {
    let mut stmt = conn.prepare(
        "SELECT id, service, artist, title, album, duration, timestamp, retry_count
         FROM scrobble_cache
         ORDER BY timestamp ASC
         LIMIT ?1;",
    )?;

    let rows = stmt.query_map(params![limit as i64], |row| {
        let ts_i64: i64 = row.get(6)?;
        Ok(CachedScrobble {
            id: row.get(0)?,
            service: row.get(1)?,
            artist: row.get(2)?,
            title: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            timestamp: ts_i64 as u64,
            retry_count: row.get(7)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub fn delete_cached_scrobble(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM scrobble_cache WHERE id = ?1;", params![id])?;
    Ok(())
}

pub fn increment_scrobble_retry(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE scrobble_cache SET retry_count = retry_count + 1 WHERE id = ?1;",
        params![id],
    )?;
    Ok(())
}
