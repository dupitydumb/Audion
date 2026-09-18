use lofty::prelude::*;
use lofty::probe::Probe;
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use crate::db::{queries, Database};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Path for user-imported lyrics.
/// `format` determines the extension: "lrc" → song.lrc, "ttml" → song.ttml.
/// The user-import slot always lives beside the music file (or hash.<fmt> in
/// the app cache dir for stream URLs).  Never overwritten by auto-fetchers.
fn resolve_user_lyrics_path(app: &AppHandle, music_path: &str, format: &str) -> PathBuf {
    let ext = sanitise_format(format);
    match fs::metadata(music_path) {
        Ok(metadata) if metadata.is_file() => {
            return PathBuf::from(music_path).with_extension(ext);
        }
        Ok(metadata) => {
            tracing::warn!(
                "[LYRICS] resolve_user_lyrics_path: music_path exists but is not a file (is_dir={} is_symlink={:?}), falling back to hash cache: {}",
                metadata.is_dir(), fs::symlink_metadata(music_path).map(|m| m.is_symlink()), music_path
            );
        }
        Err(e) => {
            tracing::warn!(
                "[LYRICS] resolve_user_lyrics_path: music_path invalid/unreachable ({}), falling back to hash cache: {}",
                e, music_path
            );
        }
    }
    let hash = hash_path(music_path);
    let dir = app_lyrics_dir(app);
    tracing::info!(
        "[LYRICS] resolve_user_lyrics_path: hash={} format={} cache_dir={}",
        hash, ext, dir.display()
    );
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!("[LYRICS] resolve_user_lyrics_path: failed to create cache dir {}: {}", dir.display(), e);
    }
    let path = dir.join(format!("{}.{}", hash, ext));
    tracing::info!("[LYRICS] resolve_user_lyrics_path: resolved fallback path={}", path.display());
    path
}

/// Path for a source-fetched lyrics file: song.<source_id>.<format>.
///
/// `source_id` lowercase  "musixmatch", "lrclib", "applettml".
/// `format` file format  "lrc", "ttml".
///
/// Adding a new provider requires a call with a new id/format.
fn resolve_source_lyrics_path(
    app: &AppHandle,
    music_path: &str,
    source_id: &str,
    format: &str,
) -> PathBuf {
    let ext = sanitise_format(format);
    match fs::metadata(music_path) {
        Ok(metadata) if metadata.is_file() => {
            let path = PathBuf::from(music_path);
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            return parent.join(format!("{}.{}.{}", stem, source_id, ext));
        }
        Ok(metadata) => {
            tracing::warn!(
                "[LYRICS] resolve_source_lyrics_path: music_path exists but is not a file (is_dir={} is_symlink={:?}), source_id={} falling back to hash cache: {}",
                metadata.is_dir(), fs::symlink_metadata(music_path).map(|m| m.is_symlink()), source_id, music_path
            );
        }
        Err(e) => {
            tracing::warn!(
                "[LYRICS] resolve_source_lyrics_path: music_path invalid/unreachable ({}), source_id={} falling back to hash cache: {}",
                e, source_id, music_path
            );
        }
    }
    let hash = hash_path(music_path);
    let dir  = app_lyrics_dir(app);
    tracing::info!(
        "[LYRICS] resolve_source_lyrics_path: hash={} source_id={} format={} cache_dir={}",
        hash, source_id, ext, dir.display()
    );
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!("[LYRICS] resolve_source_lyrics_path: failed to create cache dir {}: {}", dir.display(), e);
    }
    let path = dir.join(format!("{}.{}.{}", hash, source_id, ext));
    tracing::info!("[LYRICS] resolve_source_lyrics_path: resolved fallback path={}", path.display());
    path
}

/// Restrict format strings to known, safe extensions. Falls back to "lrc".
fn sanitise_format(format: &str) -> &str {
    match format {
        "lrc" | "ttml" | "xml" | "srt" | "json" => format,
        _ => {
            tracing::warn!("[LYRICS] sanitise_format: unrecognised format '{}', coercing to 'lrc'", format);
            "lrc"
        }
    }
}

/// All formats we probe when searching for an existing file.
/// must stay in sync with sanitise_format's allow-list
/// and the frontend's LyricsFormat type
/// load_user_lyrics_file, delete_user_lyrics_file, delete_lyrics_by_token
/// (bulk), and get_cached_sources all probe/match against this exact list
const KNOWN_FORMATS: &[&str] = &["lrc", "ttml", "xml", "srt", "json"];

fn hash_path(music_path: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    music_path.hash(&mut hasher);
    hasher.finish()
}

fn app_lyrics_dir(app: &AppHandle) -> PathBuf {
    match app.path().app_data_dir() {
        Ok(dir) => dir.join("lyrics"),
        Err(e) => {
            tracing::warn!("[LYRICS] app_lyrics_dir: app_data_dir() unavailable ({}), falling back to cwd-relative './lyrics'", e);
            PathBuf::from(".").join("lyrics")
        }
    }
}

// ---------------------------------------------------------------------------
// Shared return type for load commands
// ---------------------------------------------------------------------------

/// Raw lyrics content plus the format it was stored in.
/// The frontend uses `format` to pick the right parser (LRC vs TTML).
#[derive(serde::Serialize)]
pub struct RawLyricsFile {
    pub content: String,
    pub format:  String,
}

// ---------------------------------------------------------------------------
// User-import commands
// ---------------------------------------------------------------------------

/// Read a lyrics file from disk and return its raw content.
/// Used by the drag-and-drop handler in the frontend to hand off
/// content to importLyricsContent
#[tauri::command]
pub fn read_lyrics_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read lyrics file: {}", e))
}

/// Save a user-imported lyrics file.
/// `format` should be "lrc" or "ttml".  High priority; never overwritten by auto-fetchers.
#[tauri::command]
pub fn save_user_lyrics_file(
    app: AppHandle,
    music_path: String,
    format: String,
    content: String,
) -> Result<(), String> {
    // Remove any existing user lyrics in other formats so load_user_lyrics_file
    // doesn't return a stale file when the user re-imports in a different format.
    for fmt in KNOWN_FORMATS {
        if *fmt != format.as_str() {
            let old_path = resolve_user_lyrics_path(&app, &music_path, fmt);
            if old_path.exists() {
                let _ = fs::remove_file(&old_path); // non-fatal
            }
        }
    }
    let path = resolve_user_lyrics_path(&app, &music_path, &format);
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save user lyrics file: {}", e))
}

/// Load a user-imported lyrics file.
/// Probes all known formats in priority order; returns content + format, or null.
#[tauri::command]
pub fn load_user_lyrics_file(
    app: AppHandle,
    music_path: String,
) -> Result<Option<RawLyricsFile>, String> {
    for fmt in KNOWN_FORMATS {
        let path = resolve_user_lyrics_path(&app, &music_path, fmt);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read user lyrics file: {}", e))?;
            return Ok(Some(RawLyricsFile { content, format: fmt.to_string() }));
        }
    }
    Ok(None)
}

/// Delete all user-imported lyrics files (any format) for a music file.
#[tauri::command]
pub fn delete_user_lyrics_file(app: AppHandle, music_path: String) -> Result<bool, String> {
    tracing::info!("[LYRICS] delete_user_lyrics_file: music_path={}", music_path);
    let mut deleted = false;
    for fmt in KNOWN_FORMATS {
        let path = resolve_user_lyrics_path(&app, &music_path, fmt);
        let exists = path.exists();
        tracing::info!("[LYRICS] delete_user_lyrics_file: fmt={} path={} exists={}", fmt, path.display(), exists);
        if exists {
            match fs::remove_file(&path) {
                Ok(()) => {
                    tracing::info!("[LYRICS] delete_user_lyrics_file: removed {}", path.display());
                    deleted = true;
                }
                Err(e) => {
                    let msg = format!("Failed to delete user lyrics file: {}", e);
                    tracing::warn!("[LYRICS] delete_user_lyrics_file: remove_file failed for {}: {}; returning error to frontend: \"{}\"", path.display(), e, msg);
                    return Err(msg);
                }
            }
        }
    }
    tracing::info!("[LYRICS] delete_user_lyrics_file: done music_path={} deleted={}", music_path, deleted);
    Ok(deleted)
}

// ---------------------------------------------------------------------------
// source commands
// ---------------------------------------------------------------------------

/// Save an auto-fetched lyrics file for the given source.
/// Stored as song.<source_id>.<format>
#[tauri::command]
pub fn save_source_lyrics_file(
    app: AppHandle,
    music_path: String,
    source_id: String,
    format: String,
    content: String,
) -> Result<(), String> {
    let path = resolve_source_lyrics_path(&app, &music_path, &source_id, &format);
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save source lyrics file: {}", e))
}

/// Load an auto-fetched lyrics file for the given source.
/// Probes all known formats; returns content + format, or null.
#[tauri::command]
pub fn load_source_lyrics_file(
    app: AppHandle,
    music_path: String,
    source_id: String,
) -> Result<Option<RawLyricsFile>, String> {
    for fmt in KNOWN_FORMATS {
        let path = resolve_source_lyrics_path(&app, &music_path, &source_id, fmt);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read source lyrics file: {}", e))?;
            return Ok(Some(RawLyricsFile { content, format: fmt.to_string() }));
        }
    }
    Ok(None)
}

/// Delete all cached lyrics files for the given source (any format).
#[tauri::command]
pub fn delete_source_lyrics_file(
    app: AppHandle,
    music_path: String,
    source_id: String,
) -> Result<bool, String> {
    tracing::info!("[LYRICS] delete_source_lyrics_file: music_path={} source_id={}", music_path, source_id);
    let mut deleted = false;
    for fmt in KNOWN_FORMATS {
        let path = resolve_source_lyrics_path(&app, &music_path, &source_id, fmt);
        let exists = path.exists();
        tracing::info!("[LYRICS] delete_source_lyrics_file: fmt={} path={} exists={}", fmt, path.display(), exists);
        if exists {
            match fs::remove_file(&path) {
                Ok(()) => {
                    tracing::info!("[LYRICS] delete_source_lyrics_file: removed {}", path.display());
                    deleted = true;
                }
                Err(e) => {
                    let msg = format!("Failed to delete source lyrics file: {}", e);
                    tracing::warn!("[LYRICS] delete_source_lyrics_file: remove_file failed for {}: {}; returning error to frontend: \"{}\"", path.display(), e, msg);
                    return Err(msg);
                }
            }
        }
    }
    tracing::info!("[LYRICS] delete_source_lyrics_file: done music_path={} source_id={} deleted={}", music_path, source_id, deleted);
    Ok(deleted)
}

/// Return which sources have a cached file for the given music path, and what
/// format each is stored in.
///
/// The user-import slot is always checked first and reported as source_id "user".
/// `source_ids` is the full list of API source IDs to check.
#[tauri::command]
pub fn get_cached_sources(
    app: AppHandle,
    music_path: String,
    source_ids: Vec<String>,
) -> Result<Vec<CachedSourceInfo>, String> {
    let mut cached: Vec<CachedSourceInfo> = Vec::new();

    // User-import slot
    for fmt in KNOWN_FORMATS {
        if resolve_user_lyrics_path(&app, &music_path, fmt).exists() {
            cached.push(CachedSourceInfo { source_id: "user".to_string(), format: fmt.to_string() });
            break;
        }
    }

    // API-fetched sources
    for source_id in &source_ids {
        for fmt in KNOWN_FORMATS {
            if resolve_source_lyrics_path(&app, &music_path, source_id, fmt).exists() {
                cached.push(CachedSourceInfo { source_id: source_id.clone(), format: fmt.to_string() });
                break; // one format per source
            }
        }
    }

    Ok(cached)
}

#[derive(serde::Serialize)]
pub struct CachedSourceInfo {
    pub source_id: String,
    pub format:    String,
}

// ======================================================
// bulk delete by token (Settings => Lyrics)
// =======================================================

/// does filename belong to the given token?
/// expected shapes: 
/// <id>.<ext> (user-imported file, no source segment)
/// <id>.<source>.<ext> (auto fetched, one segment per source)
/// token == all matches any recognised lyrics file regardless of source
/// purely structural => never checks against a list of known source ids, so new sources added later need no maintainenence
fn filename_matches_token(filename: &str, token: &str) -> bool {
    // match from the right
    let mut rsplit = filename.rsplitn(3, '.');
    let ext = match rsplit.next() {
        Some(e) => e,
        None => return false,
    };
    if !KNOWN_FORMATS.contains(&ext) {
        return false;
    }
    let middle = match rsplit.next() {
        Some(m) => m,
        None => return false,
    };
    // if there's nothing left before middle, then middle is the stem
    // (no source segment) => user-imported file
    if rsplit.next().is_none() {
        token == "all" || token == "user"
    } else {
        token == "all" || middle.to_lowercase() == token
    }
}

/// result of a bulk delete by token
/// 'matched' (found) can be > 'deleted' when some files couldn't actually be removed
#[derive(serde::Serialize)]
pub struct BulkDeleteResult {
    pub matched: u32,
    pub deleted: u32,
}

/// delete every cached lyrics file matching token, across the entire library 
/// sidecar files beside each local music file, fetched directly from the db
/// and the shared hashed cache dir (used for stream/URL tracks, which have no folder of their own to keep a sidecar file in)
/// token is matched against the source-id segment of each lyrics filename
/// user matches imported files (no source segment)
/// all matches every lyrics file regardless of source
/// matching is filename pattern based only
#[tauri::command]
pub fn delete_lyrics_by_token(
    app: AppHandle,
    db: State<'_, Database>,
    token: String,
) -> Result<BulkDeleteResult, String> {
    let token = token.trim().to_lowercase();
    if token.is_empty() {
        tracing::warn!("[LYRICS] delete_lyrics_by_token: rejected, empty token; returning error to frontend: \"Empty token\"");
        return Err("Empty token".to_string());
    }

    let music_paths: Vec<String> = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                let msg = e.to_string();
                tracing::warn!("[LYRICS] delete_lyrics_by_token: db connection lock poisoned/unavailable; returning error to frontend: \"{}\"", msg);
                return Err(msg);
            }
        };
        match queries::get_all_track_paths(&conn) {
            Ok(paths) => paths,
            Err(e) => {
                let msg = e.to_string();
                tracing::warn!("[LYRICS] delete_lyrics_by_token: get_all_track_paths query failed; returning error to frontend: \"{}\"", msg);
                return Err(msg);
            }
        }
    };

    let mut matched: u32 = 0;
    let mut deleted: u32 = 0;
    // caps how many raw entries/paths get dumped below
    const DUMP_LIMIT: usize = 500;
    let mut cache_dump = 0usize;
    let mut meta_fail_dump = 0usize;
    let mut sidecar_dump = 0usize;

    tracing::info!(
        "[LYRICS] delete_lyrics_by_token: token={} tracks_in_db={}",
        token,
        music_paths.len()
    );

    // shared hashed cache dir (stream/URL tracks) ==========================================
    let cache_dir = app_lyrics_dir(&app);
    match fs::read_dir(&cache_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
                let is_match = filename_matches_token(name, &token);
                if cache_dump < DUMP_LIMIT {
                    tracing::info!("[LYRICS] cache_dir entry: {} matched={}", path.display(), is_match);
                    cache_dump += 1;
                }
                if is_match {
                    matched += 1;
                    match fs::remove_file(&path) {
                        Ok(()) => deleted += 1,
                        Err(e) => tracing::warn!("[LYRICS] failed to delete {}: {}", path.display(), e),
                    }
                }
            }
        }
        Err(e) => {
            tracing::warn!("[LYRICS] cache_dir unreadable at {}: {}", cache_dir.display(), e);
        }
    }

    // sidecar files beside each local music file ===================================
    for music_path in &music_paths {
        let path = Path::new(music_path);
        match fs::metadata(path) {
            Ok(m) if m.is_file() => {}
            other => {
                // not a local file (stream URL), or the path is unreachable e.g.
                // an android content:// / SAF path that fs::metadata can't stat
                if meta_fail_dump < DUMP_LIMIT {
                    tracing::info!("[LYRICS] skipping music_path (metadata={:?}): {}", other, music_path);
                    meta_fail_dump += 1;
                }
                continue;
            }
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let Some(parent) = path.parent() else { continue };
        let entries = match fs::read_dir(parent) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("[LYRICS] sidecar dir unreadable at {}: {}", parent.display(), e);
                continue;
            }
        };
        let prefix = format!("{}.", stem);
        for entry in entries.flatten() {
            let epath = entry.path();
            if !epath.is_file() { continue; }
            let Some(name) = epath.file_name().and_then(|n| n.to_str()) else { continue };
            if !name.starts_with(&prefix) {
                if sidecar_dump < DUMP_LIMIT {
                    tracing::info!("[LYRICS] sidecar entry (prefix mismatch, prefix={}): {}", prefix, epath.display());
                    sidecar_dump += 1;
                }
                continue;
            }
            let is_match = filename_matches_token(name, &token);
            if sidecar_dump < DUMP_LIMIT {
                tracing::info!("[LYRICS] sidecar entry: {} matched={}", epath.display(), is_match);
                sidecar_dump += 1;
            }
            if is_match {
                matched += 1;
                match fs::remove_file(&epath) {
                    Ok(()) => deleted += 1,
                    Err(e) => tracing::warn!("[LYRICS] failed to delete {}: {}", epath.display(), e),
                }
            }
        }
    }

    tracing::info!(
        "[LYRICS] delete_lyrics_by_token done: token={} matched={} deleted={}",
        token, matched, deleted
    );

    Ok(BulkDeleteResult { matched, deleted })
}

// ---------------------------------------------------------------------------
// Musixmatch proxy
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn musixmatch_request(
    action: String,
    params: Vec<(String, String)>,
) -> Result<String, String> {
    // Build a client with cookie store and proper redirect policy
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let url = format!("https://apic-desktop.musixmatch.com/ws/1.1/{}", action);

    // Build query string
    let mut query_params: Vec<(String, String)> = params;
    query_params.push(("app_id".to_string(), "web-desktop-app-v1.0".to_string()));
    query_params.push((
        "t".to_string(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string(),
    ));

    let response = client
        .get(&url)
        .query(&query_params)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Origin", "https://www.musixmatch.com")
        .header("Referer", "https://www.musixmatch.com/")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    response.text().await.map_err(|e| format!("Failed to read response: {}", e))
}

// ---------------------------------------------------------------------------
// LRC parsing os used only by get_lyrics / get_current_lyric.
// TTML parsing happens entirely on the frontend via DOMParser.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct WordTimingJson {
    word: String,
    time: f64,
    end_time: f64,
}

/// Lyric line structure for JSON serialization
#[derive(serde::Serialize)]
pub struct LyricLineJson {
    time: f64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<Vec<WordTimingJson>>,
}

/// Current lyric structure for JSON serialization
#[derive(serde::Serialize)]
pub struct CurrentLyricJson {
    index: usize,
    time: f64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<Vec<WordTimingJson>>,
}

/// Parse LRC timestamp format
fn parse_lrc_timestamp(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let minutes: f64 = parts[0].parse().ok()?;
    let sec_parts: Vec<&str> = parts[1].split('.').collect();
    let seconds: f64 = sec_parts[0].parse().ok()?;
    let subsec: f64 = if sec_parts.len() > 1 {
        let raw = sec_parts[1];
        format!("{:0<3}", raw).parse().unwrap_or(0.0) / 1000.0
    } else { 0.0 };
    Some(minutes * 60.0 + seconds + subsec)
}

/// Returns true only if the content contains at least one valid LRC timestamp
/// like [mm:ss.xx] .not just any square bracket (e.g. [Verse 1]).
fn looks_like_lrc(content: &str) -> bool {
    let mut rest = content;
    while let Some(ob) = rest.find('[') {
        rest = &rest[ob + 1..];
        if let Some(cb) = rest.find(']') {
            let inner = &rest[..cb];
            if parse_lrc_timestamp(inner).is_some() {
                return true;
            }
            rest = &rest[cb + 1..];
        } else {
            break;
        }
    }
    false
}

/// Parse LRC content into structured format
fn parse_lrc_content(lrc: &str) -> Vec<LyricLineJson> {
    let mut lyrics = Vec::new();

    for line in lrc.lines() {
        if !line.starts_with('[') { continue; }
        let cb = match line.find(']') { Some(p) => p, None => continue };
        let timestamp = &line[1..cb];
        let text = line[cb + 1..].trim();
        if text.is_empty() { continue; }
        let time = match parse_lrc_timestamp(timestamp) { Some(t) => t, None => continue };

        let mut words: Vec<WordTimingJson> = Vec::new();
        let mut clean = String::new();

        // ── Angle-bracket word timing: <mm:ss.xx>word ──────────────────────
        if text.contains('<') {
            let mut i = 0;
            let chars: Vec<char> = text.chars().collect();
            while i < chars.len() {
                if chars[i] == '<' {
                    i += 1;
                    let mut ts = String::new();
                    let mut closed = false;
                    while i < chars.len() {
                        if chars[i] == '>' { closed = true; i += 1; break; }
                        ts.push(chars[i]); i += 1;
                    }
                    if closed {
                        if let Some(wt) = parse_lrc_timestamp(&ts) {
                            let mut wb = String::new();
                            while i < chars.len() && chars[i] != '<' { wb.push(chars[i]); i += 1; }
                            let word = wb.trim();
                            if !word.is_empty() {
                                words.push(WordTimingJson { word: word.to_string(), time: wt, end_time: 0.0 });
                                clean.push_str(word); clean.push(' ');
                            }
                        }
                    } else { clean.push('<'); clean.push_str(&ts); }
                } else {
                    if words.is_empty() { clean.push(chars[i]); }
                    i += 1;
                }
            }
            // Fill end_times: each word ends when the next begins
            for j in 0..words.len() {
                words[j].end_time = if j + 1 < words.len() { words[j+1].time } else { words[j].time + 0.5 };
            }

        // ── Square-bracket word timing: word[mm:ss.xxx]word ────────────────
        // timestamp trails the word that just ended.
        // The line timestamp is the start of the first word.
        } else if text.contains('[') {
            let mut current_time = time;
            let mut remaining = text;
            loop {
                match remaining.find('[') {
                    None => {
                        let word = remaining.trim();
                        if !word.is_empty() {
                            words.push(WordTimingJson { word: word.to_string(), time: current_time, end_time: current_time + 0.5 });
                            clean.push_str(word); clean.push(' ');
                        }
                        break;
                    }
                    Some(ob) => {
                        let pending_word = remaining[..ob].trim().to_string();
                        remaining = &remaining[ob + 1..];
                        match remaining.find(']') {
                            None => break,
                            Some(cb2) => {
                                let ts_str = &remaining[..cb2];
                                remaining = &remaining[cb2 + 1..];
                                if let Some(next_time) = parse_lrc_timestamp(ts_str) {
                                    if !pending_word.is_empty() {
                                        words.push(WordTimingJson {
                                            word: pending_word.clone(),
                                            time: current_time,
                                            end_time: next_time,
                                        });
                                        clean.push_str(&pending_word); clean.push(' ');
                                    }
                                    current_time = next_time;
                                }
                            }
                        }
                    }
                }
            }
        }

        let final_text = if words.is_empty() { text.to_string() } else { clean.trim().to_string() };
        lyrics.push(LyricLineJson {
            time, text: final_text,
            words: if words.is_empty() { None } else { Some(words) },
        });
    }

    // Sort by time
    lyrics.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());
    lyrics
}

/// Find the best available LRC path for the external API commands.
/// TTML files are skipped here as they are parsed on the frontend.
fn resolve_best_lrc_path(app: &AppHandle, music_path: &str, source_priority: &[&str]) -> Option<PathBuf> {
    // User-imported LRC only (JSON user-imports are not LRC-parseable)
    let user = resolve_user_lyrics_path(app, music_path, "lrc");
    if user.exists() { return Some(user); }
 
    for src in source_priority {
        // Try LRC first; if absent try other text formats but skip JSON
        for fmt in &["lrc", "ttml", "xml"] {  // note: json deliberately excluded
            let p = resolve_source_lyrics_path(app, music_path, src, fmt);
            if p.exists() { return Some(p); }
        }
    }
    None
}


/// Get all parsed lyric lines (LRC only , TTML is parsed client-side).
#[tauri::command]
pub fn get_lyrics(app: AppHandle, music_path: String) -> Result<Option<Vec<LyricLineJson>>, String> {
    let prio = ["musixmatch", "lrclib"];
    let path = match resolve_best_lrc_path(&app, &music_path, &prio) {
        Some(p) => p,
        None => return Ok(None),
    };

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read lyrics: {}", e))?;

    Ok(Some(parse_lrc_content(&content)))
}

/// Get the active lyric line at a given playback time (LRC only).
#[tauri::command]
pub fn get_current_lyric(
    app: AppHandle,
    music_path: String,
    current_time: f64,
) -> Result<Option<CurrentLyricJson>, String> {
    let prio = ["musixmatch", "lrclib"];
    let path = match resolve_best_lrc_path(&app, &music_path, &prio) {
        Some(p) => p,
        None => return Ok(None),
    };

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read lyrics: {}", e))?;

    let lyrics = parse_lrc_content(&content);
    if lyrics.is_empty() { return Ok(None); }

    let mut active = None;
    for (i, line) in lyrics.iter().enumerate() {
        if line.time <= current_time { active = Some(i); } else { break; }
    }

    Ok(active.map(|idx| {
        let l = &lyrics[idx];
        CurrentLyricJson { index: idx, time: l.time, text: l.text.clone(), words: l.words.clone() }
    }))
}

/// Return type for get_embedded_lyrics.
///
/// `synced`   true when the content is LRC with real timestamps (either
///                  converted from SYLT or already LRC-formatted in a USLT tag).
///                  false = plain prose (no timestamps at all).
///
/// `content`   always LRC when `synced` is true; plain text otherwise.
///                  SYLT is converted to LRC in Rust so the frontend never needs
///                  to know whether the source was SYLT or a USLT-with-timestamps.
#[derive(serde::Serialize)]
pub struct EmbeddedLyricsResult {
    pub content: String,
    pub synced:  bool,
}

fn mpeg_samples_per_frame(properties: &lofty::mpeg::MpegProperties) -> u64 {
    use lofty::mpeg::{Layer, MpegVersion};
    match (properties.version(), properties.layer()) {
        (MpegVersion::V1, Layer::Layer1)                          => 384,
        (MpegVersion::V1, Layer::Layer2)                          => 1152,
        (MpegVersion::V1, Layer::Layer3)                          => 1152,
        (MpegVersion::V2 | MpegVersion::V2_5, Layer::Layer1)     => 384,
        (MpegVersion::V2 | MpegVersion::V2_5, Layer::Layer2)     => 1152,
        (MpegVersion::V2 | MpegVersion::V2_5, Layer::Layer3)     => 576,
        _                                                          => 1152,
    }
}

/// Convert a SYLT content vec to an LRC string.
///
/// Each entry is `(timestamp_ms, line_text)`.  Lines with empty text are
/// skipped (some taggers insert a trailing empty cue).
fn sylt_to_lrc(entries: &[(u32, String)]) -> String {
    let mut lrc = String::new();
    for (ms, text) in entries {
        let text = text.trim();
        if text.is_empty() { continue; }
        let total_secs = ms / 1000;
        let minutes    = total_secs / 60;
        let seconds    = total_secs % 60;
        let centisecs  = (ms % 1000) / 10;
        lrc.push_str(&format!("[{:02}:{:02}.{:02}]{}\n", minutes, seconds, centisecs, text));
    }
    lrc
}

/// Extract embedded lyrics from a music file's tags using lofty.
///
/// Priority:
///   1. SYLT (ID3v2 only) .synchronized; converted to LRC before returning.
///      Prefers English; falls back to the first language found.
///      MPEG-frames timestamp format is parsed according to lofty 0.22.4
///   2. USLT (ID3v2) — iterates frames directly, same language preference.
///   3. Generic ItemKey::Lyrics accessor  for FLAC/Vorbis, MP4, APEv2, etc.
///   4. metaflac fallback. reads the LYRICS Vorbis comment directly.
///   5. mp4ameta fallback. reads the iTunes lyrics atom directly.
///
/// Returns None if no tag or no lyrics field is found at all.
#[tauri::command]
pub fn get_embedded_lyrics(music_path: String) -> Result<Option<EmbeddedLyricsResult>, String> {
    use lofty::config::ParseOptions;
    use lofty::file::AudioFile;
    use lofty::id3::v2::{Frame, FrameFlags, SynchronizedTextFrame, TimestampFormat};
    use lofty::mpeg::MpegFile;
    use lofty::prelude::TaggedFileExt;
    use lofty::tag::TagType;

    let path = Path::new(&music_path);
    if !path.exists() {
        return Ok(None);
    }

    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .options(ParseOptions::new().read_properties(false))
        .read()
        .map_err(|e| e.to_string())?;

    // ---- Path 1: ID3v2  scan frames for SYLT then USLT --------------------
    if tagged.contains_tag_type(TagType::Id3v2) {
        // Re-open as a typed MpegFile so we can get &Id3v2Tag directly.
        // For non-MPEG files that happen to have an ID3v2 tag (e.g. AIFF),
        // we fall through to the generic path below which covers USLT via ItemKey::Lyrics.
        //
        // WAV files are explicitly skipped here: lofty can misidentify them as MPEG
        let is_wav = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("wav"))
            .unwrap_or(false);

        if !is_wav {
            let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            if let Ok(mpeg) = MpegFile::read_from(&mut file, ParseOptions::new()) {
                // Compute these once for MPEG-frame SYLT conversion
                let properties = mpeg.properties();
                let sr = properties.sample_rate() as u64;
                let sr = if sr > 0 { sr } else { 44100 };
                let spf = mpeg_samples_per_frame(properties);
                if let Some(id3) = mpeg.id3v2() {
                    let mut sylt_best: Option<String> = None;
                    let mut uslt_best: Option<String> = None;

                    for frame in id3 {
                        match frame {
                            Frame::Binary(bin) if bin.id().as_str() == "SYLT" => {
                                // Parse the raw SYLT bytes
                                let parsed = match SynchronizedTextFrame::parse(
                                    &bin.data,
                                    FrameFlags::default(),
                                ) {
                                    Ok(p) => p,
                                    Err(_) => continue,
                                };

                                let lrc = if parsed.timestamp_format == TimestampFormat::MPEG {
                                    let converted: Vec<(u32, String)> = parsed.content
                                        .iter()
                                        .map(|(frame_num, text)| {
                                            let ms = (*frame_num as u64 * spf * 1000) / sr;
                                            (ms as u32, text.clone())
                                        })
                                        .collect();
                                    sylt_to_lrc(&converted)
                                } else {
                                    sylt_to_lrc(&parsed.content)
                                };

                                if lrc.is_empty() {
                                    continue;
                                }

                                let lang = std::str::from_utf8(&parsed.language)
                                    .unwrap_or("")
                                    .to_lowercase();
                                let is_eng = lang == "eng" || lang.starts_with("en");

                                if is_eng || sylt_best.is_none() {
                                    sylt_best = Some(lrc);
                                }
                                if is_eng {
                                    break; // English SYLT found. no need to keep scanning
                                }
                            }

                            Frame::UnsynchronizedText(uslt) => {
                                let content = uslt.content.trim().to_string();
                                if content.is_empty() {
                                    continue;
                                }

                                let lang = std::str::from_utf8(&uslt.language)
                                    .unwrap_or("")
                                    .to_lowercase();
                                let is_eng = lang == "eng" || lang.starts_with("en");

                                if is_eng || uslt_best.is_none() {
                                    uslt_best = Some(content);
                                }
                                // Don't break. a later SYLT frame may still appear
                            }

                            _ => {}
                        }
                    }

                    // SYLT wins over USLT when both are present
                    if let Some(lrc) = sylt_best {
                        return Ok(Some(EmbeddedLyricsResult { content: lrc, synced: true }));
                    }

                    if let Some(content) = uslt_best {
                        let synced = looks_like_lrc(&content);
                        return Ok(Some(EmbeddedLyricsResult { content, synced }));
                    }

                    return Ok(None);
                }
            }
        } // if !is_wav
    }

    // ---- Path 2: non-ID3v2 tags (FLAC, MP4, APEv2, …) via lofty ----------
    let tag = match tagged.primary_tag().or_else(|| tagged.first_tag()) {
        Some(t) => t,
        None => {
            // lofty found no tags . fall through to format-specific fallbacks
            return get_embedded_lyrics_fallback(path);
        }
    };

    let lyrics_content = tag.get_string(ItemKey::Lyrics).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let unsynced_content = tag.get_string(ItemKey::UnsyncLyrics).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let result = match (lyrics_content, unsynced_content) {
        (Some(l), _) if looks_like_lrc(&l) => Some(EmbeddedLyricsResult { content: l, synced: true }),
        (_, Some(u)) => {
            let synced = looks_like_lrc(&u);
            Some(EmbeddedLyricsResult { content: u, synced })
        }
        (Some(l), None) => Some(EmbeddedLyricsResult { content: l, synced: false }),
        (None, None) => None,
    };

    if result.is_some() {
        return Ok(result);
    }

    // lofty found tags but no lyrics field .try format-specific fallbacks
    get_embedded_lyrics_fallback(path)
}
 
/// Fallback lyrics extraction using metaflac (FLAC) and mp4ameta (M4A/MP4).
/// Called when lofty either found no tags or found tags but no lyrics field.
fn get_embedded_lyrics_fallback(path: &Path) -> Result<Option<EmbeddedLyricsResult>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
 
    match ext.as_str() {
        // ---- FLAC: read LYRICS Vorbis comment via metaflac -----------------
        "flac" => {
            match FlacTag::read_from_path(path) {
                Ok(tag) => {
                    // Vorbis comments are case-insensitive by convention; metaflac
                    // stores them uppercased, so "LYRICS" is the canonical key.
                    if let Some(values) = tag.get_vorbis("LYRICS") {
                        let content: String = values.map(|s| s.to_string()).collect::<Vec<_>>().join("\n");
                        let content = content.trim().to_string();
                        if !content.is_empty() {
                            let synced = looks_like_lrc(&content);
                            return Ok(Some(EmbeddedLyricsResult { content, synced }));
                        }
                    }
                    Ok(None)
                }
                Err(e) => {
                    tracing::warn!("[LYRICS] metaflac fallback failed for {}: {}", path.display(), e);
                    Ok(None)
                }
            }
        }
 
        // ---- M4A / MP4 / ALAC: read lyrics atom via mp4ameta ---------------
        "m4a" | "mp4" | "alac" => {
            match Mp4Tag::read_from_path(path) {
                Ok(tag) => {
                    if let Some(content) = tag.lyrics() {
                        let content = content.trim().to_string();
                        if !content.is_empty() {
                            let synced = looks_like_lrc(&content);
                            return Ok(Some(EmbeddedLyricsResult { content, synced }));
                        }
                    }
                    Ok(None)
                }
                Err(e) => {
                    tracing::warn!("[LYRICS] mp4ameta fallback failed for {}: {}", path.display(), e);
                    Ok(None)
                }
            }
        }
 
        // No fallback available for this format
        _ => Ok(None),
    }
}
 
