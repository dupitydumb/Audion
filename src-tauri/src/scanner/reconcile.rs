//! startup reconciliation: catches up on filesystem changes made while the app was closed
//! "notify' only exists while the process is running
//!
//! a directory walk is readdir/stat only (no tag parsing) for every file
//! tags are only re-parsed for files whose mtime/size actually differ from what's stored
//!
//! runs entirely on its own DB connection (Database::open_secondary_connection)
//!   1. read music_folders, then read every track's identity projection
//!   2. the disk walk, per-file 'stat', classification against the DB
//!      snapshot from (1), and
//!      any tag re-parsing (extract_metadata) all run with no DB lock held
//!   3. DB writes happen in short-lived, per-batch transactions
//!      rows that don't need a re-parse (pure moves, identity backfills, deletes)
//!      are batched the same way, just without the extraction channel in front of them
//!
//! call [run] once at startup, before or after [super::watcher::start]

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rayon::prelude::*;
use tauri::AppHandle;

use crate::commands::library::calculate_batch_size;
use crate::db::{queries, Database};
use crate::scanner::{extract_metadata, scan_directory};

use super::metadata::stat_identity;
use super::watcher::{emit_batch, Outcome};

/// "path_is_within' mirrors commands::library::path_is_within
fn path_is_within(path: &str, folder: &str) -> bool {
    let folder = folder.trim_end_matches(['/', '\\']);
    if path == folder {
        return true;
    }
    path.strip_prefix(folder)
        .map(|rest| rest.starts_with('/') || rest.starts_with('\\'))
        .unwrap_or(false)
}

/// one row's outcome from comparing disk state to its last-known DB identity,
/// computed entirely in memory against the snapshot taken in phase 1
enum PendingOp {
    /// legacy row (no mtime/size baseline yet) or an unchanged file whose file_id just needs backfilling
    Backfill {
        id: i64,
        file_id: Option<String>,
        mtime: Option<i64>,
        size: Option<i64>,
    },
    /// pure move: same content (mtime/size unchanged), different path
    Move {
        id: i64,
        new_path: String,
        mtime: Option<i64>,
        size: Option<i64>,
    },
    /// new file, or an existing file whose content changed => needs a tag re-parse
    /// prior_move, when present, must be applied in the same transaction before insert_or_update_track runs,
    /// since that call upserts by path and would otherwise create a duplicate row at the new path instead of updating the moved one
    Reparse {
        path: String,
        prior_move: Option<(i64, Option<i64>, Option<i64>)>,
    },
    Delete {
        id: i64,
    },
}

/// run the startup reconciliation pass and emit a watch-batch-ready event
/// errors along the way are logged and skipped per-item
pub fn run(app: &AppHandle, db: &Database) {
    let mut conn = match db.open_secondary_connection() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[Reconcile] Failed to open secondary connection: {e}");
            return;
        }
    };

    // phase 1a: read the folder list only ===================================
    let folders = match queries::get_music_folders(&conn) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[Reconcile] Failed to read music folders: {e}");
            return;
        }
    };
    if folders.is_empty() {
        return;
    }

    // disk walk + stat, no DB lock held: readdir + stat only, no tag parsing
    let mut disk_paths: HashMap<String, (Option<String>, Option<i64>, Option<i64>)> =
        HashMap::new();
    for folder in &folders {
        let result = scan_directory(folder);
        for e in &result.errors {
            eprintln!("[Reconcile] {e}");
        }
        for path_str in result.audio_files {
            let stat = stat_identity(Path::new(&path_str));
            disk_paths.insert(path_str, stat);
        }
    }

    // phase 1b: snapshot every track's identity projection =============================
    let all_identities = match queries::get_all_track_identities(&conn) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[Reconcile] Failed to read track identities: {e}");
            return;
        }
    };

    // DB-side, scoped to rows whose path actually falls under a watched folder
    // excludes sync/external placeholder rows
    let db_identities: Vec<_> = all_identities
        .into_iter()
        .filter(|t| folders.iter().any(|f| path_is_within(&t.path, f)))
        .collect();

    let by_path: HashMap<&str, &queries::TrackIdentity> =
        db_identities.iter().map(|t| (t.path.as_str(), t)).collect();
    let by_file_id: HashMap<&str, &queries::TrackIdentity> = db_identities
        .iter()
        .filter_map(|t| t.file_id.as_deref().map(|id| (id, t)))
        .collect();

    // phase 2: classify every disk path against the snapshot, purely in memory ===============================
    let mut ops: Vec<PendingOp> = Vec::new();
    let mut resolved_ids: HashSet<i64> = HashSet::new();

    for (path_str, (file_id, mtime, size)) in &disk_paths {
        if let Some(row) = by_path.get(path_str.as_str()) {
            resolved_ids.insert(row.id);

            // legacy row from before this feature shipped: mtime/size were never stored,
            // so treat as "no known change" instead
            // just backfill identity
            if row.mtime.is_none() && row.size.is_none() {
                ops.push(PendingOp::Backfill {
                    id: row.id,
                    file_id: file_id.clone(),
                    mtime: *mtime,
                    size: *size,
                });
                continue;
            }

            if row.mtime == *mtime && row.size == *size {
                // unchanged content
                // opportunistically backfill file_id for legacy rows (pre-upgrade, file_id still NULL)
                if row.file_id.is_none() && file_id.is_some() {
                    ops.push(PendingOp::Backfill {
                        id: row.id,
                        file_id: file_id.clone(),
                        mtime: *mtime,
                        size: *size,
                    });
                }
                continue;
            }

            // content changed while closed => needs a re-parse
            ops.push(PendingOp::Reparse {
                path: path_str.clone(),
                prior_move: None,
            });
            continue;
        }

        // path not in DB=> heck if it's actually a move
        // (same file_id, different remembered path) before treating it as new
        if let Some(id) = file_id.as_deref() {
            if let Some(row) = by_file_id.get(id) {
                resolved_ids.insert(row.id);

                if row.mtime == *mtime && row.size == *size {
                    ops.push(PendingOp::Move {
                        id: row.id,
                        new_path: path_str.clone(),
                        mtime: *mtime,
                        size: *size,
                    });
                } else {
                    // moved and content changed =>
                    // the path update has to land in the same transaction as the re-parse,
                    // before insert_or_update_track runs (see PendingOp::Reparse)
                    ops.push(PendingOp::Reparse {
                        path: path_str.clone(),
                        prior_move: Some((row.id, *mtime, *size)),
                    });
                }
                continue;
            }
        }

        // genuinely new
        ops.push(PendingOp::Reparse {
            path: path_str.clone(),
            prior_move: None,
        });
    }

    // any DB row scoped to a watched folder that wasn't matched to a disk path
    // (directly or via a file_id-resolved move) is gone
    for row in &db_identities {
        if !resolved_ids.contains(&row.id) {
            ops.push(PendingOp::Delete { id: row.id });
        }
    }

    if ops.is_empty() {
        return;
    }

    // split into ops that need a tag re-parse (CPU-bound, no DB) and
    // ops that are a single cheap DB write with no parsing dependency
    let (reparse_ops, other_ops): (Vec<PendingOp>, Vec<PendingOp>) = ops
        .into_iter()
        .partition(|op| matches!(op, PendingOp::Reparse { .. }));

    let mut outcomes: Vec<Outcome> = Vec::new();

    // phase 3a: parallel tag extraction for reparse_ops, ==============================================
    // no DB lock held anywhere in this phase
    let total_reparse = reparse_ops.len();
    let (tx, rx): (
        crossbeam::channel::Sender<(Option<(i64, Option<i64>, Option<i64>)>, queries::TrackInsert)>,
        crossbeam::channel::Receiver<(Option<(i64, Option<i64>, Option<i64>)>, queries::TrackInsert)>,
    ) = crossbeam::channel::bounded(500);
    let extracted_count = Arc::new(AtomicUsize::new(0));

    if total_reparse > 0 {
        let extracted_count_producer = extracted_count.clone();
        std::thread::spawn(move || {
            reparse_ops.into_par_iter().for_each(|op| {
                if let PendingOp::Reparse { path, prior_move } = op {
                    if let Some(track_data) = extract_metadata(&path) {
                        let _ = tx.send((prior_move, track_data));
                    }
                }
                extracted_count_producer.fetch_add(1, Ordering::Relaxed);
            });
            // tx is dropped here once every job has been processed,
            // which unblocks the consumer's recv_timeout loop below even if a
            // straggler extraction never sends anything
        });
    }

    // phase 3b: consume extracted tracks in batches, one short-lived transaction per batch ==============================
    // the DB is only ever locked for the duration of a single commit
    if total_reparse > 0 {
        let mut processed = 0usize;
        let mut pending_batch: Vec<(Option<(i64, Option<i64>, Option<i64>)>, queries::TrackInsert)> =
            Vec::new();

        loop {
            let queue_depth = rx.len();
            let batch_size = calculate_batch_size(processed, total_reparse, queue_depth);

            while pending_batch.len() < batch_size {
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(item) => pending_batch.push(item),
                    Err(_) => {
                        if extracted_count.load(Ordering::Relaxed) >= total_reparse {
                            break;
                        }
                    }
                }
            }

            if pending_batch.is_empty() {
                break;
            }

            let batch_len = pending_batch.len();
            {
                let tx_db = match conn.transaction() {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("[Reconcile] Failed to begin transaction: {e}");
                        break;
                    }
                };

                for (prior_move, track_data) in pending_batch.drain(..) {
                    if let Some((id, mtime, size)) = prior_move {
                        if let Err(e) =
                            queries::update_track_path_and_stat(&tx_db, id, &track_data.path, mtime, size)
                        {
                            eprintln!(
                                "[Reconcile] Failed to update path for moved track {id}: {e}"
                            );
                            continue; // skip the reparse too; next run will retry both
                        }
                    }

                    match queries::insert_or_update_track(&tx_db, &track_data) {
                        Ok((track_id, was_new)) if track_id > 0 => {
                            crate::scanner::cover_storage::persist_track_covers(
                                &tx_db, track_id, &track_data,
                            );
                            if let Ok(Some(track)) = queries::get_track_by_id(&tx_db, track_id) {
                                outcomes.push(if was_new && prior_move.is_none() {
                                    Outcome::Added(track)
                                } else {
                                    Outcome::Updated(track)
                                });
                            }
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!(
                            "[Reconcile] Failed to update track at {}: {e}",
                            track_data.path
                        ),
                    }
                }

                if let Err(e) = tx_db.commit() {
                    eprintln!("[Reconcile] Failed to commit batch transaction: {e}");
                }
            } // batch transaction committed, scope ends before the next batch is collected

            processed += batch_len;
            if processed >= total_reparse {
                break;
            }
        }
    }

    // phase 3c: the cheap ops (backfill/move/delete) ==========================================
    // never depended on extraction, so batch and commit them the same way, in fixed-size chunks
    const CHEAP_BATCH_SIZE: usize = 200;
    for chunk in other_ops.chunks(CHEAP_BATCH_SIZE) {
        let tx_db = match conn.transaction() {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[Reconcile] Failed to begin transaction: {e}");
                break;
            }
        };

        for op in chunk {
            match op {
                PendingOp::Backfill {
                    id,
                    file_id,
                    mtime,
                    size,
                } => {
                    if let Err(e) =
                        queries::update_track_identity(&tx_db, *id, file_id.as_deref(), *mtime, *size)
                    {
                        eprintln!("[Reconcile] Failed to backfill identity for track {id}: {e}");
                    }
                }
                PendingOp::Move {
                    id,
                    new_path,
                    mtime,
                    size,
                } => {
                    if let Err(e) =
                        queries::update_track_path_and_stat(&tx_db, *id, new_path, *mtime, *size)
                    {
                        eprintln!("[Reconcile] Failed to update path for track {id}: {e}");
                    } else if let Ok(Some(track)) = queries::get_track_by_id(&tx_db, *id) {
                        outcomes.push(Outcome::Updated(track));
                    }
                }
                PendingOp::Delete { id } => match queries::delete_track_by_id(&tx_db, *id) {
                    Ok(true) => outcomes.push(Outcome::Deleted(*id)),
                    Ok(false) => {}
                    Err(e) => eprintln!("[Reconcile] Failed to delete stale track {id}: {e}"),
                },
                PendingOp::Reparse { .. } => unreachable!("reparse ops were partitioned out above"),
            }
        }

        if let Err(e) = tx_db.commit() {
            eprintln!("[Reconcile] Failed to commit batch transaction: {e}");
        }
    } // batch transaction committed, scope ends after each chunk

    // phase 4: final cleanup, then emit =====================
    {
        if let Err(e) = queries::cleanup_empty_albums(&conn) {
            eprintln!("[Reconcile] Failed to clean up empty albums: {e}");
        }
    }

    if outcomes.is_empty() {
        return;
    }

    emit_batch(app, "watch-batch-ready", outcomes);
}