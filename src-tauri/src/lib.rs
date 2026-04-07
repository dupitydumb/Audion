// Audion - Local Spotify-style Music Player
// Main library entry point

mod commands;
mod db;
#[cfg(desktop)]
mod discord;
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

use db::Database;
use std::path::PathBuf;
use tauri::{Emitter, Listener, Manager};

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

    if url.path() != "/auth/callback" && url.path() != "auth/callback" {
        tracing::info!(
            "Deep link is not an auth callback, ignoring: {}",
            url.path()
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
    let server_url = sync_state.server_url.clone();
    let is_syncing = sync_state.is_syncing.clone();
    let handle = app_handle.clone();
    let at_clone = at.clone();

    tauri::async_runtime::spawn(async move {
        // Fetch profile
        match sync::auth::fetch_and_store_profile(&db_clone, &server_url, &at_clone).await {
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
            server_url: server_url.clone(),
            app_handle: Some(handle.clone()),
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

#[cfg(mobile)]
fn init_logging(_log_dir: &PathBuf) {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn,audion=info"));

    fmt::Subscriber::builder()
        .with_env_filter(filter)
        .with_ansi(true)
        .with_target(true)
        .init();
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
                }
            }

            // Focus the existing window
            if let Some(window) = app.get_webview_window("main") {
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    // Global shortcuts are desktop-only (not available on Android/iOS)
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .setup(|app| {
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

            // Initialize database
            let database = Database::new(&app_dir).map_err(|e| {
                tracing::error!(error = %e, "Failed to initialize database");
                e
            })?;
            tracing::info!("Database initialized");

            app.manage(database);
            app.manage(commands::listenbrainz::ListenBrainzState::new());

            // Initialize Discord RPC state (desktop only)
            #[cfg(desktop)]
            app.manage(discord::DiscordState(std::sync::Mutex::new(None)));

            // =============================================================================
            // NATIVE AUDIO BACKEND INITIALIZATION (Non-blocking, thread-safe)
            // =============================================================================
            // Register state immediately (empty) so commands are available.
            // The actual audio engine is only initialized lazily on a dedicated thread
            // when the first command is received. No mutexes or blocking on the UI thread.
            // =============================================================================
            {
                tracing::info!("Registering native audio backend state (lazy init)");
                app.manage(audio::PlaybackStateSync::new());
                audio::PlaybackStateSync::init_async(app.handle().clone());
            }

            // =============================================================================
            // SYNC STATE INITIALIZATION
            // =============================================================================
            {
                tracing::info!("Registering sync state");
                app.manage(sync::SyncState::new_with_handle(app.handle().clone()));
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
                let window_config = commands::window::load_window_config(app.handle());
                if let Some(window) = app.get_webview_window("main") {
                    match window_config.start_mode {
                        commands::window::WindowStartMode::Maximized => {
                            tracing::info!("Window start mode: Maximized");
                            window.maximize().ok();
                        }
                        commands::window::WindowStartMode::Minimized => {
                            tracing::info!("Window start mode: Minimized");
                            window.minimize().ok();
                        }
                        commands::window::WindowStartMode::Normal => {
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
                                    window.__TAURI__.window.getCurrentWindow().focus().catch(() => {});
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
                    commands::rescan_music,
                    commands::get_default_music_dirs,
                    commands::get_library,
                    commands::get_tracks_paginated,
                    commands::get_albums_paginated,
                    commands::search_library,
                    commands::get_tracks_by_album,
                    commands::get_tracks_by_artist,
                    commands::get_album,
                    commands::get_albums_by_artist,
                    commands::add_external_track,
                    commands::import_audio_file,
                    commands::begin_folder_import,
                    commands::delete_track,
                    commands::delete_album,
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
                    // Playlist commands
                    commands::create_playlist,
                    commands::get_playlists,
                    commands::get_playlist_tracks,
                    commands::add_track_to_playlist,
                    commands::remove_track_from_playlist,
                    commands::delete_playlist,
                    commands::rename_playlist,
                    commands::update_playlist_cover,
                    commands::reorder_playlist_tracks,
                    // Activity commands (liked tracks + play history)
                    commands::like_track,
                    commands::unlike_track,
                    commands::is_track_liked,
                    commands::get_liked_track_ids,
                    commands::get_liked_tracks,
                    commands::record_play,
                    commands::get_top_tracks,
                    commands::get_top_albums,
                    commands::get_recently_played,
                    commands::get_top_artists,
                    commands::get_stats_summary,
                    // Lyrics commands
                    commands::save_source_lyrics_file,
                    commands::load_source_lyrics_file,
                    commands::delete_source_lyrics_file,
                    commands::save_user_lyrics_file,
                    commands::load_user_lyrics_file,
                    commands::delete_user_lyrics_file,
                    commands::musixmatch_request,
                    commands::get_lyrics,
                    commands::get_current_lyric,
                    commands::get_embedded_lyrics,
                    commands::get_cached_sources,
                    commands::read_lyrics_file,
                    commands::parse_apple_lyrics_json_cmd,
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
                    commands::get_artist_top_tracks_mb,
                    // Window commands
                    commands::window::get_window_start_mode,
                    commands::window::set_window_start_mode,
                    // Discord RPC commands (desktop only)
                    discord::discord_connect,
                    discord::discord_update_presence,
                    discord::discord_clear_presence,
                    discord::discord_disconnect,
                    discord::discord_reconnect,
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
                    audio::audio_poll_event,
                    audio::audio_get_state,
                    audio::audio_set_eq,
                    audio::native_audio_available,
                    commands::proxy_fetch_bytes,
                    commands::save_image_to_gallery,
                ]
            }
            #[cfg(mobile)]
            {
                tauri::generate_handler![
                    // Library commands
                    commands::scan_music,
                    commands::add_folder,
                    commands::rescan_music,
                    commands::get_default_music_dirs,
                    commands::get_library,
                    commands::get_tracks_paginated,
                    commands::get_albums_paginated,
                    commands::search_library,
                    commands::get_tracks_by_album,
                    commands::get_tracks_by_artist,
                    commands::get_album,
                    commands::get_albums_by_artist,
                    commands::add_external_track,
                    commands::import_audio_file,
                    commands::begin_folder_import,
                    commands::delete_track,
                    commands::delete_album,
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
                    // Playlist commands
                    commands::create_playlist,
                    commands::get_playlists,
                    commands::get_playlist_tracks,
                    commands::add_track_to_playlist,
                    commands::remove_track_from_playlist,
                    commands::delete_playlist,
                    commands::rename_playlist,
                    commands::update_playlist_cover,
                    commands::reorder_playlist_tracks,
                    // Activity commands (liked tracks + play history)
                    commands::like_track,
                    commands::unlike_track,
                    commands::is_track_liked,
                    commands::get_liked_track_ids,
                    commands::get_liked_tracks,
                    commands::record_play,
                    commands::get_top_tracks,
                    commands::get_top_albums,
                    commands::get_recently_played,
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
                    // =========================================================================
                    // NATIVE AUDIO COMMANDS
                    // =========================================================================
                    audio::audio_play,
                    audio::audio_pause,
                    audio::audio_resume,
                    audio::audio_stop,
                    audio::audio_preload,
                    audio::audio_set_repeat_one,
                    audio::audio_poll_event,
                    audio::audio_set_volume,
                    audio::audio_seek,
                    audio::audio_get_state,
                    audio::audio_set_eq,
                    audio::native_audio_available,
                    commands::proxy_fetch_bytes,
                    commands::save_image_to_gallery,
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
