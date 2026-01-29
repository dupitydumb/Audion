// Rlist - Local Spotify-style Music Player
// Main library entry point

mod commands;
mod db;
mod scanner;
mod discord;

use db::Database;
use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Get app data directory and create database
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            // Ensure directory exists
            std::fs::create_dir_all(&app_dir).ok();

            // Initialize database
            let database = Database::new(&app_dir).expect("Failed to initialize database");

            app.manage(database);

            // Initialize Discord RPC state
            app.manage(discord::DiscordState(std::sync::Mutex::new(None)));

            // Handle window start mode
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Library commands
            commands::scan_music,
            commands::add_folder,
            commands::rescan_music,
            commands::get_library,
            commands::get_tracks_by_album,
            commands::get_tracks_by_artist,
            commands::get_album,
            commands::get_albums_by_artist,
            commands::add_external_track,
            commands::delete_track,
            commands::delete_album,
            commands::reset_database,
            // Playlist commands
            commands::create_playlist,
            commands::get_playlists,
            commands::get_playlist_tracks,
            commands::add_track_to_playlist,
            commands::remove_track_from_playlist,
            commands::delete_playlist,
            commands::rename_playlist,
            commands::update_playlist_cover,
            // Lyrics commands
            commands::save_lrc_file,
            commands::load_lrc_file,
            commands::delete_lrc_file,
            commands::musixmatch_request,
            // Metadata commands
            commands::download_and_save_audio,
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
            commands::save_notification_image, // currently ignored by windows
            // Network commands
            commands::proxy_fetch,
            // Window commands
            commands::window::get_window_start_mode,
            commands::window::set_window_start_mode,
            // Discord RPC commands
            discord::discord_connect,
            discord::discord_update_presence,
            discord::discord_clear_presence,
            discord::discord_disconnect,
            discord::discord_reconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}