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
        let target = MAX_DISCORD_TEXT_LENGTH - 3;
        // find the byte offset of the last char that starts at or before `target`
        let cut = trimmed
            .char_indices()
            .map(|(i, _)| i)
            .take_while(|&i| i <= target)
            .last()
            .unwrap_or(0);
        format!("{}...", &trimmed[..cut])
    } else {
        trimmed.to_string()
    };

    if result.len() < MIN_DISCORD_TEXT_LENGTH {
        result.push(' ');
    }

    result
}

async fn upload_cover_to_catbox(path: &str) -> Result<String, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        upload_to_catbox(path),
    )
    .await
    .map_err(|_| "Catbox upload timed out after 30s".to_string())
    .and_then(|r| r)
}

/// upload a local cover image file to catbox.moe and return the resulting URL
async fn upload_to_catbox(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read cover file '{}': {}", path, e))?;

    let ext = path.rsplit('.').next().unwrap_or("jpg").to_lowercase();
    let (mime, file_name) = match ext.as_str() {
        "jpg" | "jpeg" => ("image/jpeg", "cover.jpg".to_string()),
        "png"          => ("image/png",  "cover.png".to_string()),
        "webp"         => ("image/webp", "cover.webp".to_string()),
        _              => ("image/jpeg", "cover.jpg".to_string()),
    };

    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .part(
            "fileToUpload",
            reqwest::multipart::Part::bytes(bytes)
                .file_name(file_name)
                .mime_str(mime)
                .map_err(|e| format!("Invalid MIME type: {}", e))?,
        );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; local/1.0)")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = client
        .post("https://catbox.moe/user/api.php")
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            let mut msg = format!("Catbox upload request failed: {}", e);
            let mut source = std::error::Error::source(&e);
            while let Some(cause) = source {
                msg.push_str(&format!(" | caused by: {}", cause));
                source = std::error::Error::source(cause);
            }
            msg
        })?;

    let url = response
        .text()
        .await
        .map_err(|e| format!("Failed to read catbox response: {}", e))?
        .trim()
        .to_string();

    if url.starts_with("https://") {
        Ok(url)
    } else {
        Err(format!("Catbox returned unexpected response: {}", url))
    }
}

/// check DB cache for a previously uploaded cover URL,
/// upload to catbox if not cached, persist the result, and return it
/// used by both discord_resolve_cover and discord_update_presence
async fn resolve_cover_cached(
    db: &crate::db::Database,
    track_id: i64,
    cover_path: &str,
) -> Option<String> {
    let cached = {
        let conn = db.conn.lock().ok()?;
        crate::db::queries::get_track_by_id(&conn, track_id)
            .ok()
            .flatten()
            .and_then(|t| t.cover_url)
            .filter(|u| u.starts_with("https://"))
    };

    if let Some(url) = cached {
        return Some(url);
    }

    match upload_cover_to_catbox(cover_path).await {
        Ok(url) => {
            if let Ok(conn) = db.conn.lock() {
                if let Err(e) = crate::db::queries::update_track_cover_url(&conn, track_id, Some(&url)) {
                    tracing::warn!("[Discord RPC] Failed to persist cover URL for track {}: {}", track_id, e);
                }
            }
            Some(url)
        }
        Err(e) => {
            tracing::warn!("[Discord RPC] Cover upload failed for track {}: {}", track_id, e);
            None
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PresenceData {
    pub line1: String,
    pub line2: String,
    pub line3: Option<String>,
    pub app_name: Option<String>,
    pub status_display_type: String,
    pub cover_url: Option<String>,
    pub current_time: Option<u64>,
    pub duration: Option<u64>,
    pub is_playing: bool,
    #[serde(default)]
    pub show_pause_icon: bool,
    // local cover fields => used to upload cover art to catbox for discord display
    // track_cover_path is the raw filesystem path (not an asset:// URL)
    pub track_id: Option<i64>,
    pub track_cover_path: Option<String>,
}

/// resolve and return the cover URL for a local track
/// checks the DB cache first; if not present, uploads to catbox and persists the result
/// called by the plugin when it needs the cover URL to enter the cover race on first play
#[tauri::command]
pub async fn discord_resolve_cover(
    db: State<'_, crate::db::Database>,
    track_id: i64,
    track_cover_path: String,
) -> Result<Option<String>, String> {
    Ok(resolve_cover_cached(&db, track_id, &track_cover_path).await)
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
pub async fn discord_update_presence(
    state: State<'_, DiscordState>,
    db: State<'_, crate::db::Database>,
    data: PresenceData,
) -> Result<String, String> {

    // -------------------------------------------------------------------------
    // resolve cover URL
    // priority:
    // 1. data.cover_url is already a valid https URL => use it directly
    // 2. track_id + track_cover_path provided => check DB cache, else upload
    // 3. Nothing available => fall back to Audion logo in Discord
    // -------------------------------------------------------------------------
    let resolved_cover: Option<String> = if let Some(ref url) = data.cover_url {
        if url.starts_with("https://") {
            Some(url.clone())
        } else {
            None
        }
    } else if let (Some(track_id), Some(ref cover_path)) = (data.track_id, &data.track_cover_path) {
        resolve_cover_cached(&db, track_id, cover_path).await
    } else {
        None
    };

    // -------------------------------------------------------------------------
    // build and send discord activity
    // -------------------------------------------------------------------------
    let mut client_guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if let Some(client) = client_guard.as_mut() {
        let line1_text = sanitize_text(&data.line1, "Unknown");
        let line2_text = sanitize_text(&data.line2, "Unknown");

        let mut activity = activity::Activity::new()
            .details(&line1_text)
            .state(&line2_text)
            .activity_type(activity::ActivityType::Listening);

        // Set app name if provided
        let app_name_value = if let Some(app_name) = &data.app_name {
            let app_name_trimmed = app_name.trim();
            if !app_name_trimmed.is_empty() {
                Some(sanitize_text(app_name_trimmed, "Audion"))
            } else {
                None
            }
        } else {
            None
        };

        if let Some(ref app_name_str) = app_name_value {
            activity = activity.name(app_name_str);
        }

        // Set status display type
        let status_type_str = data.status_display_type.to_lowercase();
        let status_type = match status_type_str.as_str() {
            "name" => activity::StatusDisplayType::Name,
            "details" => activity::StatusDisplayType::Details,
            "state" => activity::StatusDisplayType::State,
            _ => activity::StatusDisplayType::Name,
        };
        activity = activity.status_display_type(status_type);

        // Set timestamps
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

        // Set assets
        let mut assets = activity::Assets::new();
        let mut large_is_audion_logo = false;

        let large_text_content = if let Some(line3) = &data.line3 {
            if !line3.trim().is_empty() {
                sanitize_text(line3, "Unknown")
            } else {
                sanitize_text(&data.line1, "Unknown")
            }
        } else {
            sanitize_text(&data.line1, "Unknown")
        };

        if let Some(ref cover) = resolved_cover {
            if data.is_playing || !data.show_pause_icon {
                assets = assets.large_image(cover).large_text(&large_text_content);
            } else {
                assets = assets.large_image(cover).large_text("⏸ ");
            }
        } else {
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
