//! live filesystem watcher for registered music folders
//!
//! 1. Watches every folder currently in music_folders
//!    (kept in sync via [sync_watches], called from the add_folder / remove_folder commands after each registry mutation)
//! 2. resolves the two genuinely ambiguous event kinds (Create, Remove) via file_id identity
//!    rather than trusting the debouncer's own rename pairing, because that pairing is a best-effort layer on top of OS primitives
//!    (a move to an unwatched destination never gets a paired arrived event at the kernel level)
//!    Modify never needs file_id: same path, same row, only mtime/size decide whether a re-parse is worth doing
//! 3. feeds every resulting add/update/delete through the same ScanBatchEvent/ScanProgress shapes the manual progressive scan already emits,
//!   so the existing frontend batch-merge logic in progressiveScan.ts can pick these up
//!   only the event names differ (watch-batch-ready)
//!
//! known, accepted limitation: if the "remove" half and the "create" half of a single rename land in different debounce batches
//! (a slow disk, or timing right on the batch boundary),
//! the remove is processed first and the row is deleted before the create's file_id lookup has anything to match against
//! the result is a fresh insert (new date_added) rather than an in-place path update

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecursiveMode, Watcher as _};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::db::{queries, Database};
use crate::scanner::{extract_metadata, walker::is_supported_audio_file};

use super::metadata::stat_identity;

type AudionDebouncer = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// how long the debouncer waits for related events to settle before handing us a batch
/// short enough that a single save feels instant
/// long enough to coalesce a multi-file save/drop into one batch
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(800);

/// tauri-managed state holding the live debouncer and the set of paths currently under watch
/// (so add/remove-folder can stay idempotent)
pub struct WatcherState {
    debouncer: Mutex<Option<AudionDebouncer>>,
    watched: Mutex<HashSet<String>>,
}

impl WatcherState {
    fn new() -> Self {
        Self {
            debouncer: Mutex::new(None),
            watched: Mutex::new(HashSet::new()),
        }
    }
}

/// start the watcher and register every folder currently in music_folders
/// call once from the app's .setup(), after the database is initialized
/// errors are logged, not fatal since manual scan is alwas possible
pub fn start(app: &AppHandle, db: &Database) -> WatcherState {
    let state = WatcherState::new();

    let app_handle = app.clone();
    let db_for_handler = db.clone();

    let debouncer = new_debouncer(
        DEBOUNCE_WINDOW,
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => handle_batch(&app_handle, &db_for_handler, events),
            Err(errors) => {
                for e in errors {
                    eprintln!("[Watcher] notify error: {e}");
                }
            }
        },
    );

    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[Watcher] Failed to start filesystem watcher: {e}. \
                       Live change detection is disabled; manual rescan still works.");
            return state;
        }
    };

    let folders = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Watcher] Failed to lock db during startup: {e}");
                return state;
            }
        };
        queries::get_music_folders(&conn).unwrap_or_default()
    };

    let mut watched = state.watched.lock().unwrap();
    for folder in folders {
        match debouncer.watch(Path::new(&folder), RecursiveMode::Recursive) {
            Ok(()) => {
                watched.insert(folder);
            }
            Err(e) => eprintln!("[Watcher] Failed to watch folder {folder}: {e}"),
        }
    }
    drop(watched);

    *state.debouncer.lock().unwrap() = Some(debouncer);
    state
}

/// register a new watch root
/// call this from add_folder /register_music_folder so the watch set never drifts from music_folders
/// safe to call redundantly
pub fn add_watch(state: &WatcherState, folder_path: &str) {
    let mut watched = state.watched.lock().unwrap();
    if watched.contains(folder_path) {
        return;
    }
    if let Some(debouncer) = state.debouncer.lock().unwrap().as_mut() {
        match debouncer.watch(Path::new(folder_path), RecursiveMode::Recursive) {
            Ok(()) => {
                watched.insert(folder_path.to_string());
            }
            Err(e) => eprintln!("[Watcher] Failed to watch folder {folder_path}: {e}"),
        }
    }
}

/// drop a watch root
/// call this from remove_folder / remove_folder_with_tracks so a removed folder stops generating events immediately
pub fn remove_watch(state: &WatcherState, folder_path: &str) {
    let mut watched = state.watched.lock().unwrap();
    if !watched.remove(folder_path) {
        return;
    }
    if let Some(debouncer) = state.debouncer.lock().unwrap().as_mut() {
        if let Err(e) = debouncer.unwatch(Path::new(folder_path)) {
            eprintln!("[Watcher] Failed to unwatch folder {folder_path}: {e}");
        }
    }
}

/// reconcile the watch set against the current full contents of music_folders
/// needed because register_music_folder/remove_folder_with_tracks can collapse or absorb neighboring folders as a side effect (nesting auto-collapse)
/// so what changed isn't always just the one path a caller passed in
/// call this after any folder-registry mutation with the freshly re-queried folder list, from the same command handler
pub fn sync_watches(state: &WatcherState, current_folders: &[String]) {
    let current: HashSet<String> = current_folders.iter().cloned().collect();
    let mut watched = state.watched.lock().unwrap();

    let to_add: Vec<String> = current.difference(&watched).cloned().collect();
    let to_remove: Vec<String> = watched.difference(&current).cloned().collect();

    if let Some(debouncer) = state.debouncer.lock().unwrap().as_mut() {
        for folder in &to_remove {
            if let Err(e) = debouncer.unwatch(Path::new(folder)) {
                eprintln!("[Watcher] Failed to unwatch folder {folder}: {e}");
            } else {
                watched.remove(folder);
            }
        }
        for folder in &to_add {
            if let Err(e) = debouncer.watch(Path::new(folder), RecursiveMode::Recursive) {
                eprintln!("[Watcher] Failed to watch folder {folder}: {e}");
            } else {
                watched.insert(folder.clone());
            }
        }
    }
}

/// one touched track's outcome, for building the batch event / progress counters
/// mirrors the was_new/updated/deleted split the rest of the scan pipeline already reports
pub(crate) enum Outcome {
    Added(queries::Track),
    Updated(queries::Track),
    /// carries the deleted row's id so listeners (the frontend store) can actually remove the right track
    Deleted(i64),
}

/// handle one debounced batch of filesystem events
/// runs on the debouncer's own callback thread
///
/// ordering matters: creates are resolved before removes, so that
/// a rename's arrival half can claim (via file_id) and path-update the row before the departure half is considered for deletion
/// see the module-level doc comment for the batch-boundary race this doesn't (and structurally can't fully) close
fn handle_batch(app: &AppHandle, db: &Database, events: Vec<notify_debouncer_full::DebouncedEvent>) {
    let mut create_paths: Vec<PathBuf> = Vec::new();
    let mut remove_paths: Vec<PathBuf> = Vec::new();
    let mut modify_paths: Vec<PathBuf> = Vec::new();
    // explicit (from, to) pairs the debouncer already matched for us
    // handled directly
    let mut renames: Vec<(PathBuf, PathBuf)> = Vec::new();

    for event in &events {
        match &event.kind {
            // debouncer successfully paired both halves of a rename into one event carrying [from, to]
            // the common case for a rename/move within watched territory
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => {
                let (from, to) = (event.paths[0].clone(), event.paths[1].clone());
                if is_supported_audio_file(&from) || is_supported_audio_file(&to) {
                    renames.push((from, to));
                }
                continue;
            }
            // unpaired halves:
            // RenameMode::From with no matching To
            // (e.g. moved to an unwatched destination) degrades to a plain remove
            // RenameMode::To with no matching From
            // (e.g. moved in from an unwatched source) degrades to a plain create
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for path in &event.paths {
                    if is_supported_audio_file(path) {
                        remove_paths.push(path.clone());
                    }
                }
                continue;
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for path in &event.paths {
                    if is_supported_audio_file(path) {
                        create_paths.push(path.clone());
                    }
                }
                continue;
            }
            // some platforms/backends can't tell which half of a rename an event represents and emit RenameMode::Any
            // we can't distinguish add vs. remove from the event alone, so route it through create_paths:
            // the create handler below already skips paths that no longer exist (if !path.is_file), and does a file_id lookup first,
            // so a real rename-via-Any still resolves as a move rather than a spurious delete+add
            // if the path turned out to be a departure, the paired remove event (or the next startup reconciliation pass) still cleans it up
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => {
                for path in &event.paths {
                    if is_supported_audio_file(path) {
                        create_paths.push(path.clone());
                    }
                }
                continue;
            }
            _ => {}
        }

        for path in &event.paths {
            if !is_supported_audio_file(path) {
                continue;
            }
            match &event.kind {
                EventKind::Create(_) => create_paths.push(path.clone()),
                EventKind::Remove(_) => remove_paths.push(path.clone()),
                EventKind::Modify(_) => modify_paths.push(path.clone()),
                _ => {}
            }
        }
    }

    if create_paths.is_empty()
        && remove_paths.is_empty()
        && modify_paths.is_empty()
        && renames.is_empty()
    {
        return;
    }

    let conn = match db.open_secondary_connection() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[Watcher] Failed to open secondary db connection for batch: {e}");
            return;
        }
    };

    let mut outcomes: Vec<Outcome> = Vec::new();

    // explicit debouncer-paired renames: apply the path change directly
    for (from, to) in renames {
        let from_str = from.to_string_lossy().to_string();
        let to_str = to.to_string_lossy().to_string();

        let identity = match queries::get_track_identity_by_path(&conn, &from_str) {
            Ok(Some(id)) => id,
            _ => {
                // old path wasn't tracked e.g. a non-audio file,
                // or the debouncer paired a rename we never had a row for
                // fall through to plain create handling for the new path
                create_paths.push(to.clone());
                continue;
            }
        };

        let (_file_id, mtime, size) = stat_identity(&to);
        if let Err(e) = queries::update_track_path_and_stat(&conn, identity.id, &to_str, mtime, size) {
            eprintln!("[Watcher] Failed to update path for track {}: {e}", identity.id);
        }

        if mtime != identity.mtime || size != identity.size {
            if let Some(track_data) = extract_metadata(&to_str) {
                match queries::insert_or_update_track(&conn, &track_data) {
                    Ok((track_id, _was_new)) if track_id > 0 => {
                        crate::scanner::cover_storage::persist_track_covers(&conn, track_id, &track_data);
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("[Watcher] Failed to update track at {to_str}: {e}"),
                }
            }
        }

        if let Ok(Some(track)) = queries::get_track_by_id(&conn, identity.id) {
            outcomes.push(Outcome::Updated(track));
        }
    }

    // modify: identity isn't in question, only staleness
    for path in modify_paths {
        let path_str = path.to_string_lossy().to_string();
        let identity = match queries::get_track_identity_by_path(&conn, &path_str) {
            Ok(Some(id)) => id,
            _ => continue, // not a tracked file yet; a future Create will pick it up
        };

        let (_file_id, mtime, size) = stat_identity(&path);
        if mtime == identity.mtime && size == identity.size {
            continue; // untouched content, e.g. an access-time-only touch
        }

        if let Some(track_data) = extract_metadata(&path_str) {
            match queries::insert_or_update_track(&conn, &track_data) {
                Ok((track_id, _was_new)) if track_id > 0 => {
                    crate::scanner::cover_storage::persist_track_covers(&conn, track_id, &track_data);
                    if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
                        outcomes.push(Outcome::Updated(track));
                    }
                }
                Ok(_) => {}
                Err(e) => eprintln!("[Watcher] Failed to update modified track at {path_str}: {e}"),
            }
        }
    }

    // create: might be genuinely new, or the arrival half of a move
    for path in create_paths {
        if !path.is_file() {
            continue; // could be a directory create, or already gone again
        }
        let path_str = path.to_string_lossy().to_string();
        let (file_id, mtime, size) = stat_identity(&path);

        let existing_by_id = file_id
            .as_deref()
            .and_then(|id| queries::find_track_by_file_id(&conn, id).ok().flatten());

        if let Some(identity) = existing_by_id {
            // same file, different (or same) path => a move, never a delete+add
            // update the path in place; re-parse tags only if mtime/size also changed (a move can coincide with an edit)
            if let Err(e) = queries::update_track_path_and_stat(&conn, identity.id, &path_str, mtime, size) {
                eprintln!("[Watcher] Failed to update path for track {}: {e}", identity.id);
            }

            if mtime != identity.mtime || size != identity.size {
                if let Some(track_data) = extract_metadata(&path_str) {
                    match queries::insert_or_update_track(&conn, &track_data) {
                        Ok((track_id, _was_new)) if track_id > 0 => {
                            crate::scanner::cover_storage::persist_track_covers(&conn, track_id, &track_data);
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("[Watcher] Failed to update moved track at {path_str}: {e}"),
                    }
                }
            }

            if let Ok(Some(track)) = queries::get_track_by_id(&conn, identity.id) {
                outcomes.push(Outcome::Updated(track));
            }
        } else if let Some(track_data) = extract_metadata(&path_str) {
            match queries::insert_or_update_track(&conn, &track_data) {
                Ok((track_id, was_new)) if track_id > 0 => {
                    crate::scanner::cover_storage::persist_track_covers(&conn, track_id, &track_data);
                    if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
                        outcomes.push(if was_new {
                            Outcome::Added(track)
                        } else {
                            Outcome::Updated(track)
                        });
                    }
                }
                Ok(_) => {}
                Err(e) => eprintln!("[Watcher] Failed to insert new track at {path_str}: {e}"),
            }
        }
    }

    // remove: only delete if nothing claimed this path via a move above
    for path in remove_paths {
        let path_str = path.to_string_lossy().to_string();
        let identity = match queries::get_track_identity_by_path(&conn, &path_str) {
            Ok(Some(id)) => id,
            _ => continue, // already moved away above, or was never tracked
        };
        if path.exists() {
            continue; // stale/duplicate remove event; file is actually still there
        }
        match queries::delete_track_by_id(&conn, identity.id) {
            Ok(true) => outcomes.push(Outcome::Deleted(identity.id)),
            Ok(false) => {}
            Err(e) => eprintln!("[Watcher] Failed to delete track {}: {e}", identity.id),
        }
    }

    if let Err(e) = queries::cleanup_empty_albums(&conn) {
        eprintln!("[Watcher] Failed to clean up empty albums: {e}");
    }
    drop(conn);

    if outcomes.is_empty() {
        return;
    }

    emit_batch(app, "watch-batch-ready", outcomes);
}

/// emit one batch event carrying every track touched by this run, under the given event name
/// reuses the existing ScanBatchEvent/ScanProgress shapes from commands::library
/// so the frontend's batch-merge logic (progressiveScan.ts) needs no new parsing
/// only a decision on which event name(s) to subscribe to for watcher-driven vs. manual-scan updates
pub(crate) fn emit_batch(app: &AppHandle, event_name: &str, outcomes: Vec<Outcome>) {
    let total = outcomes.len();
    let mut tracks_added = 0usize;
    let mut tracks_updated = 0usize;
    let mut tracks = Vec::with_capacity(total);
    let mut deleted_ids: Vec<i64> = Vec::new();

    for outcome in outcomes {
        match outcome {
            Outcome::Added(t) => {
                tracks_added += 1;
                tracks.push(t);
            }
            Outcome::Updated(t) => {
                tracks_updated += 1;
                tracks.push(t);
            }
            Outcome::Deleted(id) => {
                deleted_ids.push(id);
            }
        }
    }

    let progress = crate::commands::library::ScanProgress {
        current: total,
        total,
        current_batch: 1,
        batch_size: total,
        estimated_time_remaining_ms: 0,
        tracks_added,
        tracks_updated,
    };

    let _ = app.emit(
        event_name,
        crate::commands::library::ScanBatchEvent { tracks, progress },
    );

    if !deleted_ids.is_empty() {
        let _ = app.emit("watch-tracks-deleted", deleted_ids);
    }
}