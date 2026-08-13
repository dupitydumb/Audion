// Audion - Local Spotify-style Music Player
// Main library entry point

mod commands;
mod db;
#[cfg(desktop)]
mod integrations;
mod scanner;
mod security;
mod sync;
mod utils;

// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// We provide a native audio backend using rodio that bypasses the WebView.
// This is now the default backend for all platforms.
// =============================================================================
mod audio;

// =============================================================================
// ANDROID AUDIO CONTEXT INIT (JNI)
// =============================================================================
// cpal's android backend needs ndk_context::initialize_android_context called once before it can open an AAudio stream
// called from Kotlin (MainActivity.onCreate) via this JNI export
// =============================================================================
#[cfg(target_os = "android")]
mod android_audio_context {
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// JNI export for MainActivity
    // initAudioContext. non static native method
    /// so the second parameter is the calling Activity instance rather than a jclass
    /// passed implicitly by the JVM
    #[no_mangle]
    pub extern "system" fn Java_com_audion_app_MainActivity_initAudioContext(
        env: jni::JNIEnv<'_>,
        activity: jni::objects::JObject<'_>,
    ) {
        INIT.call_once(|| {
            let vm = match env.get_java_vm() {
                Ok(vm) => vm,
                Err(e) => {
                    tracing::error!("[Android] Failed to get JavaVM for audio context: {e}");
                    return;
                }
            };
            let global_activity = match env.new_global_ref(&activity) {
                Ok(g) => g,
                Err(e) => {
                    tracing::error!("[Android] Failed to create global ref for activity: {e}");
                    return;
                }
            };

            let vm_ptr = vm.get_java_vm_pointer() as *mut std::ffi::c_void;
            let activity_ptr = global_activity.as_obj().as_raw() as *mut std::ffi::c_void;

            // ndk_context needs this pointer to stay valid for the lifetime of the process
            std::mem::forget(global_activity);

            // called exactly once with valid pointers obtained from the current JNI call
            // guarded by 'Once' above
            unsafe {
                ndk_context::initialize_android_context(vm_ptr, activity_ptr);
            }
            tracing::info!("[Android] ndk_context initialized for native audio (cpal/AAudio)");
        });
    }
}

use db::Database;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Listener, Manager, WindowEvent};
use crate::integrations::discord;
use crate::integrations::smtc;
#[cfg(desktop)]
use tauri::{
    menu::{CheckMenuItem, IconMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIcon, TrayIconBuilder},
};

// =============================================================================
// OTA install on close exit gate
// =============================================================================
// by default a window close request is NOT intercepted
// only when the frontend explicitly arms intercept 
// Later on a downloaded OTA update) do we hold the close open, notify the
// frontend via OTA_BEFORE_EXIT_EVENT, and wait for ota_confirm_exit before
// letting the window actually close
// =============================================================================
struct OtaExitGate {
    /// frontend wants us to gate the next close request (set via ota_set_close_intercept)
    intercept: AtomicBool,
    /// have we already emitted OTA_BEFORE_EXIT_EVENT for the close request currently being held
    notified: AtomicBool,
    /// frontend finished its install-on-close work; let the next close through
    confirmed: AtomicBool,
}

/// event emitted to the frontend when the OS requests the window close and we
/// need it to run any deferred OTA install (see otaUpdate.ts::registerOtaExitHandler)
const OTA_BEFORE_EXIT_EVENT: &str = "ota://before-exit";

/// called by the frontend (deferOtaInstallToClose) when the user picks
/// later , on a downloaded update, or to clear the gate
/// (e.g. after restarting immediately, skipping the version, or disabling OTA)
#[tauri::command]
fn ota_set_close_intercept(window: tauri::Window, enabled: bool) {
    if let Some(gate) = window.app_handle().try_state::<OtaExitGate>() {
        gate.intercept.store(enabled, Ordering::SeqCst);
        if !enabled {
            gate.notified.store(false, Ordering::SeqCst);
            gate.confirmed.store(false, Ordering::SeqCst);
        }
    }
}

/// called by the frontend once it has finished any deferred install-on-close
/// arms the gate and actually goes through this time
#[tauri::command]
fn ota_confirm_exit(window: tauri::Window) {
    if let Some(gate) = window.app_handle().try_state::<OtaExitGate>() {
        gate.confirmed.store(true, Ordering::SeqCst);
    }
    let _ = window.close();
}    
// TRAY STATE
// holds handles to the menu items that need dynamic updates:
// 1) now_playing_title / now_playing_artist  => updated by smtc_set_metadata
// 2) play_pause                              => updated by smtc_set_playback
// 3) shuffle / repeat                        => updated by tray_update_toggles
// the TrayIcon itself is kept alive here (dropping it removes the tray icon)
// =============================================================================
#[cfg(desktop)]
pub struct TrayState {
    pub _tray: TrayIcon,
    pub now_playing_title: MenuItem<tauri::Wry>,
    pub now_playing_artist: MenuItem<tauri::Wry>,
    pub play_pause: MenuItem<tauri::Wry>,
    pub shuffle: CheckMenuItem<tauri::Wry>,
    pub repeat: MenuItem<tauri::Wry>,
    // last known artist name, used by the artist menu item click handler
    pub current_artist: std::sync::Mutex<String>,
}

struct PendingPluginInstall(pub std::sync::Mutex<Option<String>>);

#[tauri::command]
fn get_pending_plugin_install(state: tauri::State<'_, PendingPluginInstall>) -> Option<String> {
    let mut pending = state.0.lock().unwrap();
    pending.take()
}

// mirrors PendingPluginInstall: on a cold start via jump list
// a bare emit is silently dropped on cold start 
// it only works when the app is already running and the listener is live
// stashing the track id here lets the frontend pull it once it's actually ready to play it
struct PendingPlayTrack(pub std::sync::Mutex<Option<String>>);

#[tauri::command]
fn get_pending_play_track(state: tauri::State<'_, PendingPlayTrack>) -> Option<String> {
    let mut pending = state.0.lock().unwrap();
    pending.take()
}

// same cold start race as PendingPlayTrack, but for files opened via file association
struct PendingOpenFile(pub std::sync::Mutex<Option<String>>);

#[tauri::command]
fn get_pending_open_file(state: tauri::State<'_, PendingOpenFile>) -> Option<String> {
    let mut pending = state.0.lock().unwrap();
    pending.take()
}

const ASSOCIATED_AUDIO_EXTENSIONS: &[&str] =
    &["flac", "mp3", "wav", "ogg", "m4a", "aac", "alac"];

fn is_associated_audio_file(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ASSOCIATED_AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// handle a file opened via file association
/// stash then emit pattern for the cold start race
/// path is stashed in PendingOpenFile regardless of whether the emit lands
fn handle_open_file(app_handle: &tauri::AppHandle, path: &str) {
    if !is_associated_audio_file(path) {
        tracing::info!("Ignoring opened file with unsupported extension: {}", path);
        return;
    }

    tracing::info!("Opening file via file association: {}", path);

    if let Some(pending_state) = app_handle.try_state::<PendingOpenFile>() {
        *pending_state.0.lock().unwrap() = Some(path.to_string());
    }
    let _ = app_handle.emit("app://open-file", path.to_string());

    #[cfg(not(target_os = "android"))]
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Handle a deep link URL — extract tokens, store them, fetch profile, trigger sync.
/// Called from both the deep-link event listener (macOS) and the single-instance
/// callback (Windows/Linux).
fn handle_deep_link_url(app_handle: &tauri::AppHandle, url_str: &str) {
    tracing::info!("Processing deep link: {}", url_str);

    let url = match url::Url::parse(url_str) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("Failed to parse deep link URL: {}", e);
            return;
        }
    };

    // audion://install-plugin?url=... or audion://plugin/install?url=...
    if url.host_str() == Some("install-plugin")
        || (url.host_str() == Some("plugin") && url.path().trim_matches('/') == "install")
    {
        let mut repo_url = None;
        for (key, value) in url.query_pairs() {
            if key == "url" || key == "repo" {
                repo_url = Some(value.into_owned());
            }
        }
        if let Some(repo) = repo_url {
            tracing::info!("Deep link plugin install request: {}", repo);
            if let Some(pending_state) = app_handle.try_state::<PendingPluginInstall>() {
                *pending_state.0.lock().unwrap() = Some(repo.clone());
            }
            let _ = app_handle.emit("plugin://install-request", repo);
        } else {
            tracing::error!("Deep link plugin install missing 'url' or 'repo' query parameter");
        }
        return;
    }

    // audion://play/<track_id> => emitted by jump list entries
    if url.host_str() == Some("play") {
        let track_id = url.path().trim_start_matches('/');
        tracing::info!("Deep link: play track id={}", track_id);
        // always stash it => covers the cold-start race
        // emit still fires for the already running case where the listener is live
        if let Some(pending_state) = app_handle.try_state::<PendingPlayTrack>() {
            *pending_state.0.lock().unwrap() = Some(track_id.to_string());
        }
        let _ = app_handle.emit("app://play-track", track_id.to_string());
        // focus the window so the user sees playback start (desktop only)
        #[cfg(not(target_os = "android"))]
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    // audion://auth/callback
    if url.host_str() != Some("auth") || url.path().trim_matches('/') != "callback" {
        tracing::info!(
            "Deep link is not an auth callback or plugin install, ignoring: {}",
            url
        );
        return;
    }

    let mut access_token = None;
    let mut refresh_token = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "access_token" => access_token = Some(value.to_string()),
            "refresh_token" => refresh_token = Some(value.to_string()),
            _ => {}
        }
    }

    let (at, rt) = match (access_token, refresh_token) {
        (Some(a), Some(r)) => (a, r),
        _ => {
            tracing::error!("Deep link missing access_token or refresh_token");
            return;
        }
    };

    let db = app_handle.state::<Database>();
    let sync_state = app_handle.state::<sync::SyncState>();

    // Store tokens
    if let Err(e) = sync::auth::store_auth_tokens(&db, &at, &rt) {
        tracing::error!("Failed to store auth tokens: {}", e);
        return;
    }

    // Fetch profile and trigger sync in background
    let db_clone = db.inner().clone();
    let server_url_str = sync_state.server_url.lock().unwrap().clone();
    let server_url_arc = sync_state.server_url.clone();
    let is_syncing = sync_state.is_syncing.clone();
    let handle = app_handle.clone();
    let at_clone = at.clone();

    tauri::async_runtime::spawn(async move {
        // Fetch profile
        match sync::auth::fetch_and_store_profile(&db_clone, &server_url_str, &at_clone).await {
            Ok(state) => {
                tracing::info!("Profile fetched: {:?}", state.email);
                let _ = handle.emit("sync://auth-state-changed", &state);
            }
            Err(e) => {
                tracing::error!("Failed to fetch profile: {}", e);
            }
        }

        // Initial full sync
        let temp_state = sync::SyncState {
            is_syncing,
            server_url: server_url_arc,
            app_handle: Some(handle.clone()),
            provider_mode: std::sync::Arc::new(std::sync::Mutex::new(sync::provider::ProviderMode::Local)),
            sse_join_handle: std::sync::Arc::new(std::sync::Mutex::new(None)),
            is_connected: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            db: db_clone.clone(),
        };
        match sync::perform_full_sync(&db_clone, &temp_state).await {
            Ok(status) => {
                tracing::info!("Initial sync completed");
                let _ = handle.emit("sync://status-changed", &status);
            }
            Err(e) => {
                tracing::error!("Initial sync failed: {}", e);
            }
        }
    });
}

// =============================================================================
// LOGGING SETUP
// =============================================================================
// - Rotates daily (e.g. audion.2026-02-22.log)
// - Prunes logs older than LOG_RETAIN_DAYS on startup
// - Captures panics/crashes to the log before exit
// - Level: WARN for deps, INFO for audion (configurable via RUST_LOG env var)
// =============================================================================

const LOG_RETAIN_DAYS: u64 = 3;

#[cfg(not(mobile))]
fn init_logging(log_dir: &PathBuf) {
    use tracing_appender::rolling;
    use tracing_subscriber::{fmt, EnvFilter};

    std::fs::create_dir_all(log_dir).ok();

    // Prune old logs before setting up the new appender
    prune_old_logs(log_dir, LOG_RETAIN_DAYS);

    let file_appender = rolling::daily(log_dir, "audion.log");
    let (non_blocking, worker_guard) = tracing_appender::non_blocking(file_appender);

    // Leak the guard so it lives for the entire process lifetime.
    // This ensures the background writer thread is never dropped and logs are
    // always flushed, including during shutdown.
    Box::leak(Box::new(worker_guard));

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn,audion=info"));

    fmt::Subscriber::builder()
        .with_writer(non_blocking)
        .with_env_filter(filter)
        .with_ansi(false) // No ANSI color codes in log files
        .with_target(true) // Show module path (e.g. audion::audio)
        .with_thread_ids(false) // Keep lines short; enable if debugging races
        .init();
}

#[cfg(target_os = "android")]
fn init_logging(_log_dir: &PathBuf) {
    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Debug)
            .with_tag("audion"),
    );
}

/// Remove log files in `log_dir` that are older than `keep_days` days.
#[cfg(not(mobile))]
fn prune_old_logs(log_dir: &PathBuf, keep_days: u64) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(keep_days * 86_400))
        .unwrap();

    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only touch files that match the rolling appender naming pattern
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if !name.starts_with("audion.log") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.modified().map_or(false, |m| m < cutoff) {
                let _ = std::fs::remove_file(&path);
                // Can't use tracing here yet (not initialized), so silently skip
            }
        }
    }
}

/// Install a panic hook that writes crash info to the tracing log before exit.
fn init_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".into());

        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .unwrap_or_else(|| {
                info.payload()
                    .downcast_ref::<String>()
                    .map(|s| s.as_str())
                    .unwrap_or("(non-string panic payload)")
            });

        tracing::error!(
            location = %location,
            payload = %payload,
            "PANIC — application crashed"
        );

        // Give the non-blocking writer time to flush before the process dies.
        std::thread::sleep(std::time::Duration::from_millis(300));
    }));
}

// =============================================================================
// TRAY COMMANDS
// called from player.ts to keep tray menu items in sync with playback state
// =============================================================================

/// update the play/pause menu item label and the now-playing title/artist lines
/// called from player.ts at the same sites that call smtc_set_playback and smtc_set_metadata
#[tauri::command]
#[cfg(desktop)]
fn tray_update_playback(
    app: tauri::AppHandle,
    is_playing: bool,
    title: Option<String>,
    artist: Option<String>,
) {
    let state = app.state::<TrayState>();
    let label = if is_playing { "⏸  Pause" } else { "▶  Play" };
    if let Err(e) = state.play_pause.set_text(label) {
        tracing::warn!("[Tray] Failed to update play/pause label: {}", e);
    }
    if let Some(t) = title {
        let _ = state.now_playing_title.set_text(if t.is_empty() { "—".into() } else { t });
    }
    if let Some(a) = artist {
        let _ = state.now_playing_artist.set_text(if a.is_empty() { "—".into() } else { a.clone() });
        if let Ok(mut guard) = state.current_artist.lock() {
            *guard = a;
        }
    }
}

/// update the shuffle and repeat menu items
/// called from player.ts via store subscriptions on shuffle / repeat
#[tauri::command]
#[cfg(desktop)]
fn tray_update_toggles(
    app: tauri::AppHandle,
    shuffle: bool,
    // none | one | all
    repeat: String,
) {
    let state = app.state::<TrayState>();
    if let Err(e) = state.shuffle.set_checked(shuffle) {
        tracing::warn!("[Tray] Failed to update shuffle checkmark: {}", e);
    }
    let repeat_label = match repeat.as_str() {
        "all" => "🔁  Repeat: All",
        "one" => "🔁  Repeat: One",
        _     => "🔁  Repeat: Off",
    };
    if let Err(e) = state.repeat.set_text(repeat_label) {
        tracing::warn!("[Tray] Failed to update repeat label: {}", e);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ------------------------------------------------------------------
    // Resolve the log directory before Tauri starts so we can log early
    // failures. Use the platform app-data dir when available, otherwise
    // fall back to the current directory.
    // ------------------------------------------------------------------
    let log_dir = dirs::data_local_dir()
        .map(|d| d.join("audion").join("logs"))
        .unwrap_or_else(|| PathBuf::from("logs"));

    init_logging(&log_dir);
    init_panic_hook();

    tracing::info!("Audion starting up");

    // Initialize security audit logging
    security::init_logger();

    let mut builder = tauri::Builder::default();

    // ==========================================================================
    // PLUGIN REGISTRATION ORDER MATTERS!
    // Single-instance MUST be first (Tauri requirement), then deep-link.
    // ==========================================================================

    // 1. Single-instance plugin (MUST be first): routes deep links to existing
    //    window on Windows/Linux instead of spawning a new process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            tracing::info!(
                "Single instance: another instance launched with args: {:?}",
                argv
            );

            // On Windows/Linux, deep links arrive as command-line arguments
            for arg in argv.iter().skip(1) {
                if arg.starts_with("audion://") {
                    handle_deep_link_url(app, arg);
                } else if is_associated_audio_file(arg) {
                    handle_open_file(app, arg);
                } else {
                    integrations::cli::handle(app, arg);
                }
            }

            // Focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                // the window may be hidden (minimized-to-tray via window.hide())
                window.show().ok();
                window.unminimize().ok();
                window.set_focus().ok();
            }
        }));
    }

    // 2. Deep-link plugin (must come after single-instance)
    builder = builder.plugin(tauri_plugin_deep_link::init());

    // 3. All other plugins
    builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    // Global shortcuts are desktop-only (not available on Android/iOS)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    // autostart (launch on startup) is desktop-only
    // not enabled by default
    // driven entirely by the settings toggle via get/set_autostart_enabled
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    // Updater is desktop-only (not available on Android/iOS)
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }


    builder
        .setup(|app| {
            // set AppUserModelID before any UI or jump list manipulation
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
                use windows::core::HSTRING;
                if let Err(e) = unsafe {
                    SetCurrentProcessExplicitAppUserModelID(&HSTRING::from("com.audion.app"))
                } {
                    tracing::warn!("[App] SetCurrentProcessExplicitAppUserModelID failed: {:?}", e);
                }
            }

            // "Play with Audion" right click context menu entry - idempotent
            #[cfg(desktop)]
            {
                integrations::context_menu::register_context_menu(ASSOCIATED_AUDIO_EXTENSIONS);
            }

            // Get app data directory and create database
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            tracing::info!(path = %app_dir.display(), "App data directory resolved");

            // Ensure directory exists
            if let Err(e) = std::fs::create_dir_all(&app_dir) {
                tracing::error!(error = %e, "Failed to create app data directory");
            }

            // Initialize cover storage app data directory (cross-platform)
            scanner::cover_storage::init_app_data_dir(app_dir.clone());
            tracing::info!("Cover storage initialized");

            // into the process wide caches used by scanner::artist_parser and
            // load persisted artist split delimiter rules and album artist mode
            // db::artists before opening the database - init_schema
            // called from Database::new below
            // runs the one time track_artists/album_artists backfill immediately
            // so the caches must already reflect the user's saved settings
            {
                let app_settings = commands::app_settings::load_app_settings(app.handle());
                crate::scanner::artist_parser::set_active_delimiters(
                    app_settings.artist_split_rules.delimiters,
                );
                crate::db::artists::set_active_album_artist_mode(
                    app_settings.album_artist_mode,
                );
            }

            // Initialize database
            let database = Database::new(&app_dir).map_err(|e| {
                tracing::error!(error = %e, "Failed to initialize database");
                e
            })?;
            tracing::info!("Database initialized");

            app.manage(database.clone());
            app.manage(commands::listenbrainz::ListenBrainzState::new());
            app.manage(integrations::window::CloseConfirmed::default());

            // OTA install-on-close gate => starts un-armed; see ota_set_close_intercept
            #[cfg(desktop)]
            app.manage(OtaExitGate {
                intercept: AtomicBool::new(false),
                notified: AtomicBool::new(false),
                confirmed: AtomicBool::new(false),
            });

            app.manage(PendingPluginInstall(std::sync::Mutex::new(None)));
            app.manage(PendingPlayTrack(std::sync::Mutex::new(None)));
            app.manage(PendingOpenFile(std::sync::Mutex::new(None)));
            #[cfg(desktop)]
            app.manage(integrations::cli::PendingCliAction(std::sync::Mutex::new(None)));

            // Initialize Discord RPC state (desktop only)
            #[cfg(desktop)]
            app.manage(integrations::discord::DiscordState(std::sync::Mutex::new(None)));

            // =============================================================================
            // NATIVE AUDIO BACKEND INITIALIZATION (Non-blocking, thread-safe)
            // =============================================================================
            // Register state immediately (empty) so commands are available.
            // The actual audio engine is only initialized lazily on a dedicated thread
            // when the first command is received. No mutexes or blocking on the UI thread.
            // =============================================================================
            {
                tracing::info!("Registering native audio backend state (lazy init)");
                app.manage(audio::PlaybackStateSync::new(app.handle().clone()));
            }

            // SMTC / OS media controls init (desktop only)
            // =============================================================================
            // driven entirely by player.ts over invoke/listen, regardless
            // of whether native or html5 playback is active
            // needs the main window's HWND
            // on windows, so state is registered now but init (which grabs the handle)
            // runs later in setup(), after the window is confirmed to exist
            // =============================================================================
            #[cfg(desktop)]
            {
                tracing::info!("Registering SMTC state");
                app.manage(integrations::smtc::SmtcState::uninitialized());
            }

            // =============================================================================
            // SYNC STATE INITIALIZATION
            // =============================================================================
            {
                tracing::info!("Registering sync state");
                let sync_state = sync::SyncState::new_with_handle(app.handle().clone(), database.clone());
                
                let has_server_credentials = {
                    let conn = database.conn.lock().unwrap();
                    let server_url = crate::db::queries::get_sync_meta(&conn, "server_url").unwrap_or(None);
                    let access_token = crate::db::queries::get_sync_meta(&conn, "access_token").unwrap_or(None);
                    
                    if let (Some(url), Some(_token)) = (server_url, access_token) {
                        *sync_state.server_url.lock().unwrap() = url;
                        *sync_state.provider_mode.lock().unwrap() = crate::sync::provider::ProviderMode::Server;
                        sync_state.is_connected.store(true, std::sync::atomic::Ordering::SeqCst);
                        true
                    } else {
                        false
                    }
                };

                if has_server_credentials {
                    tracing::info!("Found stored server credentials. Starting SSE listener for auto-connect.");
                    sync::start_sse_listener(&sync_state, database.clone());
                }

                app.manage(sync_state);
            }

            // =============================================================================
            // DEEP LINK HANDLER (audion:// OAuth callback)
            // =============================================================================
            // On macOS, deep links arrive via the deep-link://new-url event.
            // On Windows/Linux, they arrive via single-instance argv (handled above).
            // =============================================================================
            {
                let app_handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event: tauri::Event| {
                    let payload_str = event.payload();
                    tracing::info!("Deep link event received: {}", payload_str);

                    if let Ok(urls) = serde_json::from_str::<Vec<String>>(payload_str) {
                        for url_str in &urls {
                            if url_str.starts_with("audion://") {
                                handle_deep_link_url(&app_handle, url_str);
                            }
                        }
                    }
                });
            }

            // Also check if the app was started with a deep link (cold start)
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    tracing::info!("App started with deep link: {:?}", urls);
                    for url in &urls {
                        let url_str = url.to_string();
                        if url_str.starts_with("audion://") {
                            handle_deep_link_url(app.handle(), &url_str);
                        }
                    }
                }
            }

            // =============================================================================
            // FILE ASSOCIATION + CLI PLAYBACK FLAGS - COLD START (windows/linux)
            // =============================================================================
            // double clicking an associated file (or "Open with Audion") launches the
            // process with the file path as a plain CLI argument on these platforms
            // deep-link plugin only recognizes registered URL schemes, not bare paths
            // if second instance was launched instead, this is handled by the
            // single-instance callback above
            //
            // playback flags (--play/--next/etc, e.g. from .desktop file quick actions)
            // are also handled here
            // PendingCliAction stashes them for the frontend
            // which applies them after persisted queue state is restored
            //=============================================================================
            #[cfg(any(windows, target_os = "linux"))]
            {
                for arg in std::env::args().skip(1) {
                    if is_associated_audio_file(&arg) {
                        handle_open_file(app.handle(), &arg);
                        break;
                    }
                    integrations::cli::handle(app.handle(), &arg);
                }
            }

            // Register deep-link schemes at runtime (required on Windows/Linux for dev builds)
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    tracing::warn!("Failed to register deep link schemes: {}", e);
                }
            }

            // Handle window start mode (desktop only)
            #[cfg(desktop)]
            {
                let window_config = integrations::window::load_window_config(app.handle());
                if let Some(window) = app.get_webview_window("main") {
                    match window_config.start_mode {
                        integrations::window::WindowStartMode::Maximized => {
                            tracing::info!("Window start mode: Maximized");
                            window.maximize().ok();
                        }
                        integrations::window::WindowStartMode::Minimized => {
                            tracing::info!("Window start mode: Minimized");
                            window.minimize().ok();
                        }
                        integrations::window::WindowStartMode::Normal => {
                            tracing::info!("Window start mode: Normal");
                        }
                    }

                    // Focus Fix: Ensure the window is focused after creation and setup.
                    // This is especially critical on macOS with custom titlebars to ensure the window becomes "key".
                    let w = window.clone();
                    window.set_focus().ok();
                    window.run_on_main_thread(move || {
                        w.eval(
                            "
                            document.addEventListener('mousedown', () => {
                                if (window.__TAURI__ && window.__TAURI__.window) {
                                    window.__TAURI__.window.getCurrentWindow().setFocus().catch(() => {});
                                }
                            }, { once: true });
                        ",
                        )
                        .ok();
                    })
                    .ok();
                } else {
                    tracing::warn!("Main webview window not found during setup");
                }

                // SMTC init needs a real HWND on windows, so this runs only after
                // the main window block above has confirmed the window exists
                if let Err(e) = integrations::smtc::init(app.handle().clone()) {
                    tracing::warn!("SMTC initialization failed (non-fatal): {}", e);
                }
            }

            // =============================================================================
            // SYSTEM TRAY SETUP (desktop only)
            // =============================================================================
            // menu layout:
            //   [icon] Now Playing             <= focuses window on click
            //   <title>                        <= focuses window on click
            //   <artist>                       <= focuses window + navigates to artist
            //   __________________________________
            //   ⏮ Previous
            //   ⏸ Play / Pause
            //   ⏭ Next
            //   ____________________________________
            //   🔀 Shuffle
            //   🔁 Repeat: Off / All / One
            //   ____________________________________
            //   Quit
            // =============================================================================
            #[cfg(desktop)]
            {
                let icon_img = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap();

                // static header (clicking focuses the window, reuses show handler) =================================
                let header_i = IconMenuItem::with_id(
                    app, "show", "Now Playing", true,
                    Some(icon_img.clone()), None::<&str>,
                )?;

                // track info (dynamic) =====================================
                let title_i  = MenuItem::with_id(app, "now_playing_title",  "—", true, None::<&str>)?;
                let artist_i = MenuItem::with_id(app, "now_playing_artist", "—", true, None::<&str>)?;

                let sep1 = PredefinedMenuItem::separator(app)?;

                // transport =================================
                let prev_i  = MenuItem::with_id(app, "previous",  "⏮  Previous", true, None::<&str>)?;
                let pp_i    = MenuItem::with_id(app, "play_pause", "⏸  Pause",    true, None::<&str>)?;
                let next_i  = MenuItem::with_id(app, "next",       "⏭  Next",     true, None::<&str>)?;

                let sep2 = PredefinedMenuItem::separator(app)?;

                // toggles ==========================
                let shuffle_i = CheckMenuItem::with_id(app, "shuffle", "🔀  Shuffle", true, false, None::<&str>)?;
                let repeat_i  = MenuItem::with_id(app, "repeat", "🔁  Repeat: Off", true, None::<&str>)?;

                let sep3 = PredefinedMenuItem::separator(app)?;

                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

                let menu = Menu::with_items(app, &[
                    &header_i,
                    &title_i,
                    &artist_i,
                    &sep1,
                    &prev_i,
                    &pp_i,
                    &next_i,
                    &sep2,
                    &shuffle_i,
                    &repeat_i,
                    &sep3,
                    &quit_i,
                ])?;

                let tray = TrayIconBuilder::new()
                    .icon(icon_img)
                    .tooltip("Audion")
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            // Now Playing header => focus window
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    window.show().ok();
                                    window.unminimize().ok();
                                    window.set_focus().ok();
                                }
                            }
                            // track title => focus window and togglefullscreen
                            "now_playing_title" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    window.show().ok();
                                    window.unminimize().ok();
                                    window.set_focus().ok();
                                }
                                let _ = app.emit("tray://open-fullscreen", ());
                            }
                            // artist name => focus window + navigate to artist
                            "now_playing_artist" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    window.show().ok();
                                    window.unminimize().ok();
                                    window.set_focus().ok();
                                }
                                let artist = app
                                    .state::<TrayState>()
                                    .current_artist
                                    .lock()
                                    .map(|g| g.clone())
                                    .unwrap_or_default();
                                if !artist.is_empty() {
                                    let _ = app.emit("tray://go-to-artist", artist);
                                }
                            }
                            // transport => reuse smtc://event
                            "previous" => {
                                let _ = app.emit("smtc://event", serde_json::json!({ "type": "Previous" }));
                            }
                            "play_pause" => {
                                let _ = app.emit("smtc://event", serde_json::json!({ "type": "Toggle" }));
                            }
                            "next" => {
                                let _ = app.emit("smtc://event", serde_json::json!({ "type": "Next" }));
                            }
                            "shuffle" => {
                                let _ = app.emit("tray://toggle-shuffle", ());
                            }
                            "repeat" => {
                                let _ = app.emit("tray://toggle-repeat", ());
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: MouseButton::Left, ..
                        } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.unminimize().ok();
                                window.set_focus().ok();
                            }
                        }
                    })
                    .show_menu_on_left_click(false)
                    .build(app)?;

                app.manage(TrayState {
                    _tray: tray,
                    now_playing_title: title_i,
                    now_playing_artist: artist_i,
                    play_pause: pp_i,
                    shuffle: shuffle_i,
                    repeat: repeat_i,
                    current_artist: std::sync::Mutex::new(String::new()),
                });

                tracing::info!("System tray initialized");
            }

            tracing::info!("App setup complete");
            Ok(())
        })
        .invoke_handler({
            // =============================================================================
            // DESKTOP WITH NATIVE AUDIO: All commands + native audio backend
            // =============================================================================
            // This block is used on Linux (always) or when native-audio feature is enabled.
            // =============================================================================
            #[cfg(desktop)]
            {
                tauri::generate_handler![
                    // Library commands
                    commands::scan_music,
                    commands::add_folder,
                    commands::set_single_music_folder,
                    commands::rescan_music,
                    commands::scan_folder,
                    commands::get_default_music_dirs,
                    commands::get_music_folders,
                    commands::get_artist_split_rules,
                    commands::set_artist_split_rules,
                    commands::get_album_artist_mode,
                    commands::set_album_artist_mode,
                    commands::resplit_all_artists,
                    commands::get_library,
                    commands::get_tracks_paginated,
                    commands::get_albums_paginated,
                    commands::search_library,
                    commands::get_tracks_by_album,
                    commands::get_tracks_by_artist,
                    commands::get_album,
                    commands::get_albums_by_artist,
                    commands::add_external_track,
                    commands::open_or_import_track_by_path,
                    commands::import_audio_file,
                    commands::begin_folder_import,
                    commands::delete_track,
                    commands::delete_album,
                    commands::remove_folder,
                    commands::reset_database,
                    commands::sync_cover_paths_from_files,
                    // Cover Management commands
                    commands::covers::migrate_covers_to_files,
                    commands::covers::get_track_cover_path,
                    commands::covers::get_batch_cover_paths,
                    commands::covers::get_album_art_path,
                    commands::covers::get_cover_as_asset_url,
                    commands::covers::preload_covers,
                    commands::covers::cleanup_orphaned_cover_files,
                    commands::covers::clear_base64_covers,
                    commands::covers::merge_duplicate_covers,
                    commands::covers::extract_palette,
                    // Playlist commands
                    commands::create_playlist,
                    commands::get_playlists,
                    commands::get_playlist_tracks,
                    commands::get_playlist_track_counts,
                    commands::add_track_to_playlist,
                    commands::remove_track_from_playlist,
                    commands::delete_playlist,
                    commands::rename_playlist,
                    commands::update_playlist_cover,
                    commands::reorder_playlist_tracks,
                    commands::export_playlist_zip,
                    commands::get_export_temp_path,
                    // Activity commands (liked tracks + play history)
                    commands::like_track,
                    commands::unlike_track,
                    commands::is_track_liked,
                    commands::get_liked_track_ids,
                    commands::get_liked_tracks,
                    commands::export_liked_songs_zip,
                    commands::record_play,
                    commands::get_top_tracks,
                    commands::get_top_albums,
                    commands::get_recently_played,
                    commands::get_continue_listening,
                    commands::get_recently_added_albums,
                    commands::get_top_artists,
                    commands::get_stats_summary,
                    // Lyrics commands
                    commands::save_source_lyrics_file,
                    commands::load_source_lyrics_file,
                    commands::delete_source_lyrics_file,
                    commands::save_user_lyrics_file,
                    commands::load_user_lyrics_file,
                    commands::delete_user_lyrics_file,
                    commands::delete_lyrics_by_token,
                    commands::musixmatch_request,
                    commands::get_lyrics,
                    commands::get_current_lyric,
                    commands::get_embedded_lyrics,
                    commands::get_cached_sources,
                    commands::read_lyrics_file,
                    commands::parse_apple_lyrics_json_cmd,
                    commands::parse_genius_lyrics_json_cmd,
                    // Metadata commands
                    commands::download_and_save_audio,
                    commands::update_track_after_download,
                    commands::update_local_src,
                    commands::update_track_cover_url,
                    // Plugin commands
                    commands::list_plugins,
                    commands::install_plugin,
                    commands::uninstall_plugin,
                    commands::enable_plugin,
                    commands::disable_plugin,
                    commands::get_plugin_permissions,
                    commands::grant_permissions,
                    commands::check_cross_plugin_permission,
                    commands::get_cross_plugin_permissions,
                    commands::revoke_permissions,
                    commands::get_plugin_dir,
                    commands::check_plugin_updates,
                    commands::update_plugin,
                    commands::save_notification_image,
                    integrations::notifications::show_native_notification,
                    commands::plugin_save_data,
                    commands::plugin_get_data,
                    commands::plugin_list_keys,
                    commands::plugin_clear_data,
                    // Network commands
                    commands::proxy_fetch,
                    // ListenBrainz commands
                    commands::set_listenbrainz_token,
                    commands::get_listenbrainz_token,
                    commands::get_listenbrainz_token_set,
                    commands::delete_listenbrainz_token,
                    commands::verify_listenbrainz_token,
                    commands::submit_listenbrainz_listen,
                    commands::fetch_listenbrainz_recommendations,
                    // MusicBrainz commands
                    commands::get_artist_musicbrainz_info,
                    commands::get_top_genres_from_mb,
                    commands::enrich_track_metadata_mb,
                    commands::get_release_mb_info,
                    commands::get_similar_artists_mb,
                    commands::get_artist_discography_mb,
                    commands::search_artists_mb,
                    commands::search_releases_mb,
                    commands::get_release_group_tracks_mb,
                    commands::get_artist_top_tracks_mb,
                    // Window commands
                    integrations::window::get_window_start_mode,
                    integrations::window::set_window_start_mode,
                    // Discord RPC commands (desktop only)
                    integrations::discord::discord_connect,
                    integrations::discord::discord_update_presence,
                    integrations::discord::discord_clear_presence,
                    integrations::discord::discord_resolve_cover,
                    integrations::discord::discord_disconnect,
                    integrations::discord::discord_reconnect,
                    // =========================================================================
                    // SYNC COMMANDS
                    // =========================================================================
                    commands::sync_get_auth_state,
                    commands::sync_handle_auth_callback,
                    commands::sync_logout,
                    commands::sync_trigger,
                    commands::sync_get_status,
                    commands::sync_get_server_url,
                    commands::sync_link_kofi,
                    commands::sync_enqueue_change,
                    commands::sync_delete_account,
                    commands::sync_get_access_token,
                    commands::sync_get_device_id,
                    commands::server_test_connection,
                    commands::server_connect,
                    commands::server_disconnect,
                    commands::server_get_status,
                    // =========================================================================
                    // NATIVE AUDIO COMMANDS
                    // =========================================================================
                    // These commands control the native audio backend (rodio).
                    // Now available on all platforms.
                    // =========================================================================
                    audio::audio_play,
                    audio::audio_pause,
                    audio::audio_resume,
                    audio::audio_stop,
                    audio::audio_set_volume,
                    audio::audio_seek,
                    audio::audio_preload,
                    audio::audio_set_repeat_one,
                    audio::audio_set_eq,
                    audio::audio_set_replay_gain_enabled,
                    audio::audio_set_limiter_enabled,
                    audio::audio_set_crossfade_seconds,
                    audio::audio_trigger_crossfade,
                    audio::audio_list_output_devices,
                    audio::audio_set_output_device,
                    audio::audio_get_device_info,
                    audio::native_audio_available,
                    audio::audio_resolve_path,
                    audio::audio_get_stream_url,
                    integrations::windows_thumbar::windows_init_thumbar,
                    integrations::windows_thumbar::windows_update_thumbar_state,
                    integrations::windows_thumbar::windows_set_taskbar_progress,
                    integrations::windows_thumbar::windows_clear_taskbar_progress,
                    integrations::windows_thumbar::windows_update_jump_list,
                    integrations::windows_thumbar::windows_clear_jump_list,
                    integrations::smtc::smtc_set_metadata,
                    integrations::smtc::smtc_set_playback,
                    integrations::smtc::smtc_set_volume,
                    tray_update_playback,
                    tray_update_toggles,
                    commands::proxy_fetch_bytes,
                    commands::save_image_to_gallery,
                    // Window close-to-tray and minimize-to-tray commands
                    integrations::window::get_close_to_tray,
                    integrations::window::set_close_to_tray,
                    integrations::window::get_minimize_to_tray,
                    integrations::window::set_minimize_to_tray,
                    // OTA install-on-close
                    ota_set_close_intercept,
                    ota_confirm_exit,
                    // launch on startup (desktop only)
                    integrations::window::get_autostart_enabled,
                    integrations::window::set_autostart_enabled,
                    // last visited view (startup page = last-visited)
                    integrations::window::confirm_close,
                    get_pending_plugin_install,
                    get_pending_play_track,
                    get_pending_open_file,
                    integrations::cli::get_pending_cli_action,
                ]
            }
            #[cfg(mobile)]
            {
                tauri::generate_handler![
                    // Library commands
                    commands::scan_music,
                    commands::add_folder,
                    commands::set_single_music_folder,
                    commands::rescan_music,
                    commands::scan_folder,
                    commands::get_default_music_dirs,
                    commands::get_music_folders,
                    commands::get_artist_split_rules,
                    commands::set_artist_split_rules,
                    commands::get_album_artist_mode,
                    commands::set_album_artist_mode,
                    commands::resplit_all_artists,
                    commands::get_library,
                    commands::get_tracks_paginated,
                    commands::get_albums_paginated,
                    commands::search_library,
                    commands::get_tracks_by_album,
                    commands::get_tracks_by_artist,
                    commands::get_album,
                    commands::get_albums_by_artist,
                    commands::add_external_track,
                    commands::open_or_import_track_by_path,
                    commands::import_audio_file,
                    commands::begin_folder_import,
                    commands::delete_track,
                    commands::delete_album,
                    commands::remove_folder,
                    commands::reset_database,
                    commands::sync_cover_paths_from_files,
                    // Cover Management commands
                    commands::covers::migrate_covers_to_files,
                    commands::covers::get_track_cover_path,
                    commands::covers::get_batch_cover_paths,
                    commands::covers::get_album_art_path,
                    commands::covers::get_cover_as_asset_url,
                    commands::covers::preload_covers,
                    commands::covers::cleanup_orphaned_cover_files,
                    commands::covers::clear_base64_covers,
                    commands::covers::merge_duplicate_covers,
                    commands::covers::extract_palette,
                    // Playlist commands
                    commands::create_playlist,
                    commands::get_playlists,
                    commands::get_playlist_tracks,
                    commands::get_playlist_track_counts,
                    commands::add_track_to_playlist,
                    commands::remove_track_from_playlist,
                    commands::delete_playlist,
                    commands::rename_playlist,
                    commands::update_playlist_cover,
                    commands::reorder_playlist_tracks,
                    commands::export_playlist_zip,
                    commands::get_export_temp_path,
                    // Activity commands (liked tracks + play history)
                    commands::like_track,
                    commands::unlike_track,
                    commands::is_track_liked,
                    commands::get_liked_track_ids,
                    commands::get_liked_tracks,
                    commands::export_liked_songs_zip,
                    commands::record_play,
                    commands::get_top_tracks,
                    commands::get_top_albums,
                    commands::get_recently_played,
                    commands::get_continue_listening,
                    commands::get_recently_added_albums,
                    commands::get_top_artists,
                    commands::get_stats_summary,
                    // Lyrics commands
                    commands::save_user_lyrics_file,
                    commands::save_source_lyrics_file,
                    commands::load_user_lyrics_file,
                    commands::load_source_lyrics_file,
                    commands::delete_user_lyrics_file,
                    commands::delete_source_lyrics_file,
                    commands::musixmatch_request,
                    commands::get_lyrics,
                    commands::get_current_lyric,
                    commands::get_embedded_lyrics,
                    commands::get_cached_sources,
                    commands::read_lyrics_file,
                    commands::parse_apple_lyrics_json_cmd,
                    commands::parse_genius_lyrics_json_cmd,
                    // Metadata commands
                    commands::download_and_save_audio,
                    commands::update_track_after_download,
                    commands::update_local_src,
                    commands::update_track_cover_url,
                    // Plugin commands
                    commands::list_plugins,
                    commands::install_plugin,
                    commands::uninstall_plugin,
                    commands::enable_plugin,
                    commands::disable_plugin,
                    commands::get_plugin_permissions,
                    commands::grant_permissions,
                    commands::check_cross_plugin_permission,
                    commands::get_cross_plugin_permissions,
                    commands::revoke_permissions,
                    commands::get_plugin_dir,
                    commands::check_plugin_updates,
                    commands::update_plugin,
                    commands::save_notification_image,
                    commands::plugin_save_data,
                    commands::plugin_get_data,
                    commands::plugin_list_keys,
                    commands::plugin_clear_data,
                    // Network commands
                    commands::proxy_fetch,
                    // ListenBrainz commands
                    commands::set_listenbrainz_token,
                    commands::get_listenbrainz_token,
                    commands::get_listenbrainz_token_set,
                    commands::delete_listenbrainz_token,
                    commands::verify_listenbrainz_token,
                    commands::submit_listenbrainz_listen,
                    commands::fetch_listenbrainz_recommendations,
                    // MusicBrainz commands
                    commands::get_artist_musicbrainz_info,
                    commands::get_top_genres_from_mb,
                    commands::enrich_track_metadata_mb,
                    commands::get_release_mb_info,
                    commands::get_similar_artists_mb,
                    commands::get_artist_discography_mb,
                    commands::search_artists_mb,
                    commands::search_releases_mb,
                    commands::get_release_group_tracks_mb,
                    // =========================================================================
                    // SYNC COMMANDS
                    // =========================================================================
                    commands::sync_get_auth_state,
                    commands::sync_handle_auth_callback,
                    commands::sync_logout,
                    commands::sync_trigger,
                    commands::sync_get_status,
                    commands::sync_get_server_url,
                    commands::sync_link_kofi,
                    commands::sync_enqueue_change,
                    commands::sync_delete_account,
                    commands::sync_get_access_token,
                    commands::sync_get_device_id,
                    commands::server_test_connection,
                    commands::server_connect,
                    commands::server_disconnect,
                    commands::server_get_status,
                    // =========================================================================
                    // NATIVE AUDIO COMMANDS
                    // =========================================================================
                    audio::audio_play,
                    audio::audio_pause,
                    audio::audio_resume,
                    audio::audio_stop,
                    audio::audio_preload,
                    audio::audio_set_repeat_one,
                    audio::audio_set_volume,
                    audio::audio_seek,
                    audio::audio_set_eq,
                    audio::audio_set_replay_gain_enabled,
                    audio::audio_set_limiter_enabled,
                    audio::audio_set_crossfade_seconds,
                    audio::audio_trigger_crossfade,
                    audio::audio_list_output_devices,
                    audio::audio_set_output_device,
                    audio::audio_get_device_info,
                    audio::native_audio_available,
                    audio::audio_resolve_path,
                    audio::audio_get_stream_url,
                    commands::proxy_fetch_bytes,
                    commands::save_image_to_gallery,
                ]
            }
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Check if close-to-tray is enabled
                let config = integrations::window::load_window_config(window.app_handle());
                if config.close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    tracing::info!("Window hidden to tray");
                    return;
                }

                // real quit path

                // if we already confirmed the close and are closing for real
                // (see confirm_close), let this CloseRequested through
                // regardless of the OTA gate below
                let confirmed = window
                    .app_handle()
                    .state::<integrations::window::CloseConfirmed>();
                if confirmed.0.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }

                // only intercept for OTA reasons if the frontend armed the gate
                let gate = window.app_handle().state::<OtaExitGate>();
                if gate.intercept.load(Ordering::SeqCst) && !gate.confirmed.load(Ordering::SeqCst) {
                    api.prevent_close();
                    if !gate.notified.swap(true, Ordering::SeqCst) {
                        tracing::info!("Close requested, notifying frontend for OTA install-on-close");
                        let _ = window.emit(OTA_BEFORE_EXIT_EVENT, ());
                    }
                    return;
                }

                // first close attempt: hold the window open,
                // let the frontend react to app://request-last-view (e.g.
                // cache the current view to localStorage), then it calls
                // confirm_close to re-trigger the real close
                api.prevent_close();

                let app_handle = window.app_handle().clone();
                let window_clone = window.clone();
                let _ = window.emit("app://request-last-view", ());
                tracing::info!("CloseRequested: notifying frontend before close");

                // fallback in case the frontend never responds
                // without this the app would become unclosable
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    let confirmed = app_handle.state::<integrations::window::CloseConfirmed>();
                    if !confirmed.0.load(std::sync::atomic::Ordering::SeqCst) {
                        tracing::warn!(
                            "No response from frontend for close notification, closing anyway"
                        );
                        confirmed.0.store(true, std::sync::atomic::Ordering::SeqCst);
                        let close_target = window_clone.clone();
                        let _ = window_clone.run_on_main_thread(move || {
                            let _ = close_target.close();
                        });
                    }
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // file association open event
            // mac only
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    for url in urls {
                        if url.scheme() == "file" {
                            if let Ok(path) = url.to_file_path() {
                                handle_open_file(app_handle, &path.to_string_lossy());
                            }
                        }
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let _ = (app_handle, event);
            }
        });
}