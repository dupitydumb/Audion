// Discord Rich Presence Module for Audion

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
const DISCORD_APP_ID: &str = "1464631480251715676";

pub struct DiscordState(pub Mutex<Option<DiscordIpcClient>>);

fn is_valid_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PresenceData {
    pub song_title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub current_time: Option<u64>,
    pub duration: Option<u64>,
    pub is_playing: bool,
}

#[tauri::command]
pub fn discord_connect(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state.0.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    // Don't reconnect if already connected
    if client_guard.is_some() {
        return Ok("Already connected".to_string());
    }

    // Create client
    let mut client = DiscordIpcClient::new(DISCORD_APP_ID);

    // Connect
    client
        .connect()
        .map_err(|e| format!("Failed to connect: {}", e))?;

    *client_guard = Some(client);

    Ok("Connected to Discord".to_string())
}

#[tauri::command]
pub fn discord_update_presence(
    state: State<DiscordState>,
    data: PresenceData,
) -> Result<String, String> {
    let mut client_guard = state.0.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if let Some(client) = client_guard.as_mut() {
        // Format:
        // Line 1 (details): Song Title
        // Line 2 (state): Artist - Album (or just Artist)
        let state_text = if let Some(album) = &data.album {
            format!("{} • {}", data.artist, album)
        } else {
            data.artist.clone()
        };

        let mut activity = activity::Activity::new()
            .details(&data.song_title)
            .state(&state_text)
            .activity_type(activity::ActivityType::Listening); // Set activity type to Listening

        // Add timestamps for progress bar
        let current = data.current_time.unwrap_or(0) as i64;
        let duration = data.duration.unwrap_or(0) as i64;

        if duration > 0 && data.is_playing {
            // Only show timestamps when actively playing
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            let start_time = now - current;
            let end_time = start_time + duration;

            activity =
                activity.timestamps(activity::Timestamps::new().start(start_time).end(end_time));
        }
        // When paused/stopped, don't set any timestamps at all

        // Add album art as large image
        let mut assets = activity::Assets::new();
        let mut large_is_audion_logo = false;

        if let Some(cover) = &data.cover_url {
            if is_valid_url(cover) {
                // Real album art
                assets = assets
                    .large_image(cover)
                    .large_text(&data.song_title);
            } else {
                // Invalid URL → fallback to logo
                assets = assets
                    .large_image("audion_logo")
                    .large_text(&data.song_title);
                large_is_audion_logo = true;
            }
        }else {
            // Cover failed → fallback
            assets = assets
                .large_image("audion_logo")
                .large_text(&data.song_title);

            large_is_audion_logo = true;
        }

        // Unless large image IS audion_logo → show Audion as small image
        if !large_is_audion_logo {
            assets = assets
                .small_image("audion_logo")
                .small_text("Audion");
        }

        activity = activity.assets(assets);


        // Add download button with icon
        activity = activity.buttons(vec![activity::Button::new(
            "Download Audion ↓",
            "https://audionplayer.com/download",
        )]);

        client
            .set_activity(activity)
            .map_err(|e| format!("Failed to set activity: {}", e))?;

        Ok("Presence updated".to_string())
    } else {
        Err("Not connected to Discord".to_string())
    }
}

#[tauri::command]
pub fn discord_clear_presence(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state.0.lock().unwrap();

    if let Some(client) = client_guard.as_mut() {
        client
            .clear_activity()
            .map_err(|e| format!("Failed to clear activity: {}", e))?;
        Ok("Presence cleared".to_string())
    } else {
        Err("Not connected to Discord".to_string())
    }
}

#[tauri::command]
pub fn discord_disconnect(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state.0.lock().unwrap();

    if let Some(mut client) = client_guard.take() {
        let _ = client.close();
        Ok("Disconnected from Discord".to_string())
    } else {
        Ok("Already disconnected".to_string())
    }
}

#[tauri::command]
pub fn discord_reconnect(state: State<DiscordState>) -> Result<String, String> {
    discord_disconnect(state.clone())?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    discord_connect(state)
}