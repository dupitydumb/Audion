// one-time migration
// content_hash switched from DefaultHasher to sha256 but reconcile skips unchanged files
// => old rows kept stale hashes and later copies of the same song slipped past the duplicate check
// recompute every local hash from the stored tags, then merge the rows that now collide

use crate::scanner::metadata::generate_content_hash;
use rusqlite::{params, Connection, Result, Transaction, TransactionBehavior};
use std::cmp::Reverse;
use std::collections::HashMap;

// bump when the hash formula changes again so every install rehashes once
const MIGRATION_VERSION: i32 = 1;

pub fn rehash_and_merge_duplicates_if_needed(conn: &Connection) -> Result<()> {
    // immediate => take the write lock up front, so a second connection
    // (android auto cold start opens its own Database) either waits for us or fails busy, never both
    // migrating version is read inside the lock => whoever lost the race sees the bump and does nothing
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let version: i32 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= MIGRATION_VERSION {
        return Ok(());
    }

    let (rehashed, merged) = rehash_and_merge(&tx)?;
    tx.pragma_update(None, "user_version", MIGRATION_VERSION)?;
    tx.commit()?;

    if rehashed > 0 || merged > 0 {
        println!("[DB] Hash migration: {} rehashed, {} duplicates merged", rehashed, merged);
    }
    Ok(())
}

// sync placeholders store 'title|artist|album' in content_hash => leave anything that is not a generated hash alone
fn is_generated_hash(h: &str) -> bool {
    h.len() == 16 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

type TrackRow = (i64, Option<String>, Option<String>, Option<String>, Option<i32>, Option<String>);

fn rehash_and_merge(conn: &Connection) -> Result<(usize, usize)> {
    let rows: Vec<TrackRow> = {
        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album, duration, content_hash FROM tracks
             WHERE COALESCE(source_type, 'local') = 'local'",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?;
        mapped.collect::<Result<_>>()?
    };

    let mut rehashed = 0;
    let mut groups: HashMap<String, Vec<i64>> = HashMap::new();

    for (id, title, artist, album, duration, old) in rows {
        if let Some(ref h) = old {
            if !is_generated_hash(h) {
                continue;
            }
        }
        let new = generate_content_hash(title.as_deref(), artist.as_deref(), album.as_deref(), duration);
        if old.as_deref() != Some(new.as_str()) {
            conn.execute("UPDATE tracks SET content_hash = ?1 WHERE id = ?2", params![new, id])?;
            rehashed += 1;
        }
        groups.entry(new).or_default().push(id);
    }

    let mut merged = 0;
    for (_, ids) in groups.into_iter().filter(|(_, ids)| ids.len() > 1) {
        // keep the row with the most user data, then the oldest
        let mut scored: Vec<(i64, i64)> = ids
            .iter()
            .map(|&id| Ok((user_data_score(conn, id)?, id)))
            .collect::<Result<_>>()?;
        scored.sort_by_key(|&(score, id)| (Reverse(score), id));

        let keeper = scored[0].1;
        for &(_, loser) in &scored[1..] {
            merge_into(conn, keeper, loser)?;
            merged += 1;
        }
    }

    Ok((rehashed, merged))
}

fn user_data_score(conn: &Connection, id: i64) -> Result<i64> {
    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM liked_tracks WHERE track_id = ?1)
              + (SELECT COUNT(*) FROM playlist_tracks WHERE track_id = ?1)
              + (SELECT COUNT(*) FROM play_history WHERE track_id = ?1)",
        params![id],
        |r| r.get(0),
    )
}

// move likes, playlist entries, plays and sync mapping to the keeper before the loser goes
// (every child table cascades on delete, so skipping this would wipe the history)
fn merge_into(conn: &Connection, keeper: i64, loser: i64) -> Result<()> {
    let album_id: Option<i64> = conn.query_row(
        "SELECT album_id FROM tracks WHERE id = ?1",
        params![loser],
        |r| r.get(0),
    )?;

    conn.execute(
        "UPDATE play_history SET track_id = ?1 WHERE track_id = ?2",
        params![keeper, loser],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO liked_tracks (track_id, liked_at)
         SELECT ?1, liked_at FROM liked_tracks WHERE track_id = ?2",
        params![keeper, loser],
    )?;
    // keeper already in the playlist => ignored here, the leftover row cascades away
    conn.execute(
        "UPDATE OR IGNORE playlist_tracks SET track_id = ?1 WHERE track_id = ?2",
        params![keeper, loser],
    )?;

    let keeper_key = format!("lib_{}", keeper);
    let loser_key = format!("lib_{}", loser);
    conn.execute(
        "UPDATE OR IGNORE sync_id_map SET local_id = ?1
         WHERE local_id = ?2 AND entity_type = 'library_track'",
        params![keeper_key, loser_key],
    )?;
    conn.execute(
        "DELETE FROM sync_id_map WHERE local_id = ?1 AND entity_type = 'library_track'",
        params![loser_key],
    )?;

    conn.execute("DELETE FROM tracks WHERE id = ?1", params![loser])?;

    if let Some(album_id) = album_id {
        conn.execute(
            "DELETE FROM albums WHERE id = ?1
             AND NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = ?1)",
            params![album_id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_formula_is_pinned() {
        // changing this value => ship a MIGRATION_VERSION bump with it
        assert_eq!(
            generate_content_hash(Some("DHAK DHAK"), Some("Aanchal Tyagi"), Some("DHAK DHAK"), Some(202)),
            "da24a21c2fbb6e25"
        );
    }

    #[test]
    fn generated_hash_detection() {
        assert!(is_generated_hash("da24a21c2fbb6e25"));
        assert!(!is_generated_hash("title|artist|album"));
        assert!(!is_generated_hash("DA24A21C2FBB6E25"));
    }
}
