// Audion - Local Spotify-style Music Player
// Main library entry point

mod commands;
mod db;
#[cfg(desktop)]
mod discord;
mod scanner;
mod security;
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
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize security audit logging
    security::init_logger();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

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

            // Ensure directory exists
            std::fs::create_dir_all(&app_dir).ok();

            // Initialize cover storage app data directory (cross-platform)
            scanner::cover_storage::init_app_data_dir(app_dir.clone());

            // Initialize database
            let database = Database::new(&app_dir).expect("Failed to initialize database");

            app.manage(database);

            // Initialize Discord RPC state (desktop only)
            #[cfg(desktop)]
            app.manage(discord::DiscordState(std::sync::Mutex::new(None)));

            // =============================================================================
            // NATIVE AUDIO BACKEND INITIALIZATION
            // =============================================================================
            // Initialize the native audio backend.
            // This is now the default backend for all platforms.
            // =============================================================================
            {
                log::info!("[AUDIO] Initializing native audio backend (rodio)...");
                app.manage(audio::PlaybackStateSync::new());
            }

            // Handle window start mode (desktop only)
            #[cfg(desktop)]
            {
                let window_config = commands::window::load_window_config(app.handle());
                if let Some(window) = app.get_webview_window("main") {
                    match window_config.start_mode {
                        commands::window::WindowStartMode::Maximized => {
                            window.maximize().ok();
                        }
                        commands::window::WindowStartMode::Minimized => {
                            window.minimize().ok();
                        }
                        commands::window::WindowStartMode::Normal => {
                            // Default behavior, do nothing (windowed)
                        }
                    }
                }
            }

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
                    // Lyrics commands
                    commands::save_lrc_file,
                    commands::load_lrc_file,
                    commands::delete_lrc_file,
                    commands::musixmatch_request,
                    commands::get_lyrics,
                    commands::get_current_lyric,
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
                    audio::audio_get_state,
                    audio::audio_is_finished,
                    audio::audio_set_eq,
                    audio::native_audio_available,
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
                    // Lyrics commands
                    commands::save_lrc_file,
                    commands::load_lrc_file,
                    commands::delete_lrc_file,
                    commands::musixmatch_request,
                    commands::get_lyrics,
                    commands::get_current_lyric,
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
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
