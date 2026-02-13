// Discord Rich Presence Module for Audion

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

const DISCORD_APP_ID: &str = "1464631480251715676";
const MAX_DISCORD_TEXT_LENGTH: usize = 128;
const MIN_DISCORD_TEXT_LENGTH: usize = 2;

pub struct DiscordState(pub Mutex<Option<DiscordIpcClient>>);

fn is_valid_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn sanitize_text(input: &str, fallback: &str) -> String {
    let trimmed = input.trim();

    if trimmed.is_empty() {
        let fallback_trimmed = fallback.trim();
        if fallback_trimmed.is_empty() {
            return "Unknown".to_string();
        }
        return sanitize_text(fallback_trimmed, "Unknown");
    }

    let mut result = if trimmed.len() > MAX_DISCORD_TEXT_LENGTH {
        let truncate_at = MAX_DISCORD_TEXT_LENGTH - 3;
        format!("{}...", &trimmed[..truncate_at])
    } else {
        trimmed.to_string()
    };

    if result.len() < MIN_DISCORD_TEXT_LENGTH {
        result.push(' ');
    }

    result
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PresenceData {
    pub song_title: String,
    pub artist: String,
    pub album: Option<String>,
    pub large_text: Option<String>,
    pub cover_url: Option<String>,
    pub current_time: Option<u64>,
    pub duration: Option<u64>,
    pub is_playing: bool,
    #[serde(default)]
    pub show_pause_icon: bool,
    #[serde(default)]
    pub status_display_text: String,
}

#[tauri::command]
pub fn discord_connect(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state
        .0
        .lock()
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
    let mut client_guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if let Some(client) = client_guard.as_mut() {
        let details_text = sanitize_text(&data.song_title, "Unknown Track");

        let state_text = if let Some(album) = &data.album {
            format!(
                "{} • {}",
                sanitize_text(&data.artist, "Unknown Artist"),
                sanitize_text(album, "Unknown Album")
            )
        } else {
            sanitize_text(&data.artist, "Unknown Artist")
        };

        let has_custom_status = !data.status_display_text.trim().is_empty();
        let custom_status_text = if has_custom_status {
            sanitize_text(&data.status_display_text, "Audion")
        } else {
            String::new()
        };

        let mut activity = activity::Activity::new()
            .details(&details_text)
            .state(&state_text)
            .activity_type(activity::ActivityType::Listening);

        if has_custom_status {
            activity = activity
                .name(&custom_status_text)
                .status_display_type(activity::StatusDisplayType::Name);
        } else {
            activity = activity
                .status_display_type(activity::StatusDisplayType::Name);
        }

        let current_ms = data.current_time.unwrap_or(0) as i64;
        let duration_ms = data.duration.unwrap_or(0) as i64;

        if duration_ms > 0 {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;

            if data.is_playing {
                let start_time_ms = now_ms - current_ms;
                let end_time_ms = start_time_ms + duration_ms;

                activity = activity.timestamps(
                    activity::Timestamps::new()
                        .start(start_time_ms)
                        .end(end_time_ms),
                );
            } else {
                activity = activity.timestamps(activity::Timestamps::new().start(now_ms));
            }
        }

        let mut assets = activity::Assets::new();
        let mut large_is_audion_logo = false;

        let large_text_content = if let Some(large_text) = &data.large_text {
            if !large_text.trim().is_empty() {
                sanitize_text(large_text, "Unknown")
            } else if let Some(album) = &data.album {
                sanitize_text(album, "Unknown Album")
            } else {
                sanitize_text(&data.song_title, "Unknown Track")
            }
        } else if let Some(album) = &data.album {
            sanitize_text(album, "Unknown Album")
        } else {
            sanitize_text(&data.song_title, "Unknown Track")
        };

        if let Some(cover) = &data.cover_url {
            if is_valid_url(cover) {
                if data.is_playing || !data.show_pause_icon {
                    assets = assets.large_image(cover).large_text(&large_text_content);
                } else {
                    assets = assets.large_image(cover).large_text("⏸ ");
                }
            } else {
                // Invalid URL → fallback to logo
                assets = assets
                    .large_image("audion_logo")
                    .large_text(&large_text_content);
                large_is_audion_logo = true;
            }
        }else {
            // Cover failed → fallback
            assets = assets
                .large_image("audion_logo")
                .large_text(&large_text_content);
            large_is_audion_logo = true;
        }

        // Unless large image IS audion_logo → show Audion as small image
        if !large_is_audion_logo {
            assets = assets.small_image("audion_logo").small_text("Audion");
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

        match client.recv() {
            Ok(_) => {}
            Err(e) => {
                eprintln!("[Discord RPC] Warning: Failed to read response: {:?}", e);
            }
        }

        Ok("Presence updated".to_string())
    } else {
        Err("Not connected to Discord".to_string())
    }
}

#[tauri::command]
pub fn discord_clear_presence(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if let Some(client) = client_guard.as_mut() {
        client
            .clear_activity()
            .map_err(|e| format!("Failed to clear activity: {}", e))?;

        match client.recv() {
            Ok(_) => {}
            Err(e) => {
                eprintln!(
                    "[Discord RPC] Warning: Failed to read clear response: {:?}",
                    e
                );
            }
        }

        Ok("Presence cleared".to_string())
    } else {
        Err("Not connected to Discord".to_string())
    }
}

#[tauri::command]
pub fn discord_disconnect(state: State<DiscordState>) -> Result<String, String> {
    let mut client_guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

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