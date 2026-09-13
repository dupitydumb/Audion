// jni bridge for android auto => this is the direct channel from the plan:
// MediaNotificationService (kotlin) calls these exports straight into rust,
// bypassing evaluateJs/webview entirely,
// so browsing/playback-resolution keeps working even if the webview is suspended or the activity was torn down
//
// only compiled on android
use std::path::PathBuf;
use std::sync::{Once, OnceLock};

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::audio::player::{AdvanceDirection, PlayerCommand, PlayerStateSync, RepeatMode};
use crate::audio::worker::{AudioCommand, PlaybackStateSync};
use crate::db::Database;
use super::{resolve_children, resolve_leaf, resolve_playback_context, search_scoped, SearchScope};

/// set once from the tauri setup hook (see lib.rs), read from every jni call below
/// a plain OnceLock rather than tauri's own state system because
/// these are raw native exports with no Tauri command injection available
static DATABASE: OnceLock<Database> = OnceLock::new();

/// the two audio engine actors, settable from either android's own cold start path
/// (init_database_cold_start, before any AppHandle/Tauri App exists)
/// or from lib.rs's .setup() hook on the first non cold start boot
/// setup() checks get_playback_and_player()
/// and reuses them rather than building a second engine (see lib.rs)
/// neither actor needs an AppHandle to run =>
/// see audio::event_bridge for how they reach the webview once one exists
static PLAYBACK: OnceLock<PlaybackStateSync> = OnceLock::new();
static PLAYER: OnceLock<PlayerStateSync> = OnceLock::new();

pub fn set_database(db: Database) {
    // ignore the error if already set => setup only runs once in practice,
    // but this keeps a stray second call from panicking
    let _ = DATABASE.set(db);
}

/// sets both together, never independently =>
/// they're only ever meaningful as a pair
pub fn set_playback_and_player(playback: PlaybackStateSync, player: PlayerStateSync) {
    let _ = PLAYBACK.set(playback);
    let _ = PLAYER.set(player);
}

/// used by lib.rs's .setup() to check whether android auto already cold
/// started the audio engine before
pub fn get_playback_and_player() -> Option<(PlaybackStateSync, PlayerStateSync)> {
    match (PLAYBACK.get(), PLAYER.get()) {
        (Some(pb), Some(pl)) => Some((pb.clone(), pl.clone())),
        _ => None,
    }
}

/// json string for an empty/failed result
/// kept as one constant so every early-return below produces the same shape kotlin already expects
const EMPTY_ARRAY: &str = "[]";

pub fn get_database() -> Option<Database> {
    match DATABASE.get() {
        Some(db) => Some(db.clone()),
        None => {
            tracing::warn!("[android_auto] jni call before database was initialized");
            None
        }
    }
}

static COLD_START_INIT: Once = Once::new();

/// initializes the database and the settings derived caches lib.rs's setup hook applies
/// without needing tauri's App/AppHandle at all =>
/// this is what lets android auto browse a real library on a cold start
/// app_data_dir must be the exact same path tauri's app_data_dir() resolves to on android
/// (Context.dataDir, NOT Context.filesDir) =>
/// see the caller in MediaNotificationService.kt for where that's sourced from
pub fn init_database_cold_start(app_data_dir: &str) {
    COLD_START_INIT.call_once(|| {
        if DATABASE.get().is_some() {
            // lib.rs's setup hook already present
            // (e.g. the process was already  running with the app open before auto connected)
            return;
        }

        let dir = PathBuf::from(app_data_dir);
        if let Err(e) = std::fs::create_dir_all(&dir) {
            tracing::error!("[android_auto] failed to create app data dir: {e}");
        }

        // mirrors the settings block in lib.rs's setup hook,
        // but reading the file directly
        // since there's no AppHandle to hand load_app_settings
        let settings_path = dir.join("app_settings.json");
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            match serde_json::from_str::<crate::commands::app_settings::AppSettings>(&content) {
                Ok(settings) => {
                    crate::scanner::artist_parser::set_active_delimiters(
                        settings.artist_split_rules.delimiters,
                    );
                    crate::db::artists::set_active_album_artist_mode(
                        settings.album_artist_mode,
                    );
                }
                Err(e) => {
                    tracing::warn!("[android_auto] cold start: couldn't parse app_settings.json, using defaults: {e}");
                }
            }
        }

        crate::scanner::cover_storage::init_app_data_dir(dir.clone());

        match Database::new(&dir) {
            Ok(db) => {
                set_database(db);
                tracing::info!("[android_auto] database cold-started from {app_data_dir}");
            }
            Err(e) => {
                tracing::error!("[android_auto] cold start database init failed: {e}");
            }
        }

        // bring up the two audio actor threads too
        // this is what lets playTrackNative etc. actually play audio on a cold start
        let (player_event_tx, player_event_rx) = crossbeam::channel::unbounded::<crate::audio::AudioEvent>();
        let playback = PlaybackStateSync::new(player_event_tx);
        let player = PlayerStateSync::new(player_event_rx, playback.clone());
        set_playback_and_player(playback, player);
        tracing::info!("[android_auto] audio engine cold-started");
    });
}

/// Java_com_audion_app_AudionLibraryBridge_initDatabaseNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_initDatabaseNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    app_data_dir: JString<'local>,
) {
    let path = read_jstring(&mut env, &app_data_dir);
    init_database_cold_start(&path);
}

fn jstring_from(env: &mut JNIEnv, s: &str) -> jstring {
    match env.new_string(s) {
        Ok(j) => j.into_raw(),
        Err(e) => {
            tracing::error!("[android_auto] failed to build jstring: {e}");
            std::ptr::null_mut()
        }
    }
}

fn read_jstring(env: &mut JNIEnv, s: &JString) -> String {
    match env.get_string(s) {
        Ok(java_str) => String::from(java_str),
        Err(e) => {
            tracing::error!("[android_auto] failed to read jstring arg: {e}");
            String::new()
        }
    }
}

/// Java_com_audion_app_AudionLibraryBridge_getChildrenNative
/// returns a json array of BrowseNode
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_getChildrenNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    node_id: JString<'local>,
) -> jstring {
    let id = read_jstring(&mut env, &node_id);

    let Some(db) = get_database() else {
        return jstring_from(&mut env, EMPTY_ARRAY);
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };
    let json = match resolve_children(&conn, &id) {
        Ok(nodes) => serde_json::to_string(&nodes).unwrap_or_else(|_| EMPTY_ARRAY.to_string()),
        Err(e) => {
            tracing::error!("[android_auto] resolve_children({id}) failed: {e}");
            EMPTY_ARRAY.to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}

/// Java_com_audion_app_AudionLibraryBridge_getItemNative
/// returns a json Track object, or the literal "null" if not found/leaf wasn't a track id
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_getItemNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    node_id: JString<'local>,
) -> jstring {
    let id = read_jstring(&mut env, &node_id);

    let Some(db) = get_database() else {
        return jstring_from(&mut env, "null");
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, "null");
        }
    };
    let json = match resolve_leaf(&conn, &id) {
        Ok(Some(track)) => serde_json::to_string(&track).unwrap_or_else(|_| "null".to_string()),
        Ok(None) => "null".to_string(),
        Err(e) => {
            tracing::error!("[android_auto] resolve_leaf({id}) failed: {e}");
            "null".to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}

/// Java_com_audion_app_AudionLibraryBridge_searchNative
/// scope is one of "tracks" / "albums" / "artists" / "playlists",
/// matching the 4 library chips (anything else returns an empty array)
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_searchNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    scope: JString<'local>,
    query: JString<'local>,
) -> jstring {
    let scope_str = read_jstring(&mut env, &scope);
    let query_str = read_jstring(&mut env, &query);

    let scope = match scope_str.as_str() {
        "tracks" => SearchScope::Tracks,
        "albums" => SearchScope::Albums,
        "artists" => SearchScope::Artists,
        "playlists" => SearchScope::Playlists,
        other => {
            tracing::warn!("[android_auto] unknown search scope: {other}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };

    let Some(db) = get_database() else {
        return jstring_from(&mut env, EMPTY_ARRAY);
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };
    let json = match search_scoped(&conn, scope, &query_str) {
        Ok(nodes) => serde_json::to_string(&nodes).unwrap_or_else(|_| EMPTY_ARRAY.to_string()),
        Err(e) => {
            tracing::error!("[android_auto] search_scoped failed: {e}");
            EMPTY_ARRAY.to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}

// =============================================================================
// playback control => bypasses evaluateJs/webview entirely
// audio_play/pause/resume/stop/seek and next/prev
// already live behind two existing actor threads (PlaybackStateSync, PlayerStateSync)
// fed by plain message channels => 
// these exports just reach the same channels directly
// =============================================================================

fn playback() -> Option<&'static PlaybackStateSync> {
    let pb = PLAYBACK.get();
    if pb.is_none() {
        tracing::warn!("[android_auto] jni playback call before the audio engine was cold-started");
    }
    pb
}

fn player() -> Option<&'static PlayerStateSync> {
    let pl = PLAYER.get();
    if pl.is_none() {
        tracing::warn!("[android_auto] jni playback call before the audio engine was cold-started");
    }
    pl
}

/// deliberately skips resolve_audio_path's server track download branch:
/// that's async (network + auth token lookup) and 
/// android auto's use case is the local library
fn resolve_local_path(track: &crate::db::models::Track) -> String {
    if let Some(local) = &track.local_src {
        if std::path::Path::new(local).exists() {
            return local.clone();
        }
    }
    track.path.clone()
}

/// Java_com_audion_app_AudionLibraryBridge_playTrackNative
/// mediaId is one of our own "track:<id>" node ids
/// also syncs an album-context queue into PlayerStateSync
/// (see resolve_playback_context)
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_playTrackNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    media_id: JString<'local>,
) {
    let id = read_jstring(&mut env, &media_id);

    let Some(db) = get_database() else { return };
    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return;
        }
    };

    let track = match resolve_leaf(&conn, &id) {
        Ok(Some(t)) => t,
        Ok(None) => {
            tracing::warn!("[android_auto] playTrackNative: no track for {id}");
            return;
        }
        Err(e) => {
            tracing::error!("[android_auto] playTrackNative: resolve_leaf failed: {e}");
            return;
        }
    };

    let (queue, index) = match resolve_playback_context(&conn, &track) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("[android_auto] playTrackNative: context resolution failed: {e}");
            (vec![track.clone()], 0)
        }
    };
    drop(conn);

    let path = resolve_local_path(&track);

    if let Some(pb) = playback() {
        if let Err(e) = pb.send(AudioCommand::Play(path, None)) {
            tracing::error!("[android_auto] playTrackNative: AudioCommand::Play failed: {e}");
        }
    }

    // sync the queue context so next/prev has something to work with,
    // but this happens after the direct play above =>
    // the tapped track starts immediately, it doesn't wait on the queue sync round trip
    if let Some(pl) = player() {
        let track_refs: Vec<crate::audio::player::TrackRef> = queue
            .iter()
            .map(|t| crate::audio::player::TrackRef {
                id: t.id,
                path: resolve_local_path(t),
                duration_secs: t.duration.map(|d| d as f64),
                is_streaming: t.source_type.as_deref() == Some("server"),
            })
            .collect();
        let _ = pl.send(PlayerCommand::SyncQueue {
            tracks: track_refs,
            index,
            repeat: RepeatMode::Off,
            shuffle: false,
            shuffled_indices: Vec::new(),
            shuffled_index: 0,
        });
        let _ = pl.send(PlayerCommand::SetCurrent { index });
    }
}

/// Java_com_audion_app_AudionLibraryBridge_resumeNative (MediaSessionCompat.onPlay)
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_resumeNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    if let Some(pb) = playback() {
        let _ = pb.send(AudioCommand::Resume);
    }
}

/// Java_com_audion_app_AudionLibraryBridge_pauseNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_pauseNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    if let Some(pb) = playback() {
        let _ = pb.send(AudioCommand::Pause);
    }
}

/// Java_com_audion_app_AudionLibraryBridge_stopNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_stopNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    if let Some(pb) = playback() {
        let _ = pb.send(AudioCommand::Stop);
    }
}

/// Java_com_audion_app_AudionLibraryBridge_seekNative
/// positionSeconds is an absolute position, not a 0.0-1.0 fraction => see
/// AudioCommand::SeekAbsolute / AudioEngine::seek_absolute
/// for why this needs its own command rather than reusing Seek
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_seekNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    position_seconds: jni::sys::jdouble,
) {
    if let Some(pb) = playback() {
        let _ = pb.send(AudioCommand::SeekAbsolute(position_seconds));
    }
}

/// Java_com_audion_app_AudionLibraryBridge_nextNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_nextNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    if let Some(pl) = player() {
        let _ = pl.send(PlayerCommand::ColdAdvance { direction: AdvanceDirection::Next });
    }
}

/// Java_com_audion_app_AudionLibraryBridge_previousNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_previousNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    if let Some(pl) = player() {
        let _ = pl.send(PlayerCommand::ColdAdvance { direction: AdvanceDirection::Previous });
    }
}

/// Java_com_audion_app_AudionLibraryBridge_setShuffleNative
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_setShuffleNative<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    enabled: jni::sys::jboolean,
) {
    if let Some(pl) = player() {
        let _ = pl.send(PlayerCommand::SetShuffleMode(enabled != 0));
    }
}

/// Java_com_audion_app_AudionLibraryBridge_setRepeatNative
/// mode is one of "none" / "one" / "all", matching the frontend's repeat store
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_setRepeatNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    mode: JString<'local>,
) {
    let mode_str = read_jstring(&mut env, &mode);
    let mode = match mode_str.as_str() {
        "one" => RepeatMode::One,
        "all" => RepeatMode::All,
        _ => RepeatMode::Off,
    };
    if let Some(pl) = player() {
        let _ = pl.send(PlayerCommand::SetRepeatMode(mode));
    }
}