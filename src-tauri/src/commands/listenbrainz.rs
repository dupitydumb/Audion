//! ListenBrainz integration commands
//!
//! All scrobbling is fully opt-in. The user token is stored as a file inside
//! the platform app-data directory (user-readable only). It is never written
//! to the main SQLite database or to any world-readable location.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const LB_API_BASE: &str = "https://api.listenbrainz.org/1";

// ── Token storage (app-data file) ─────────────────────────────────────────────

fn token_file_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("lb_token"))
}

async fn read_token(app: &tauri::AppHandle) -> Option<String> {
    let path = token_file_path(app)?;
    let t = tokio::fs::read_to_string(&path).await.ok()?;
    let t = t.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Store or clear the ListenBrainz user token.
#[tauri::command]
pub async fn set_listenbrainz_token(
    token: Option<String>,
    app: tauri::AppHandle,
    lb_state: tauri::State<'_, ListenBrainzState>,
) -> Result<(), String> {
    let path = token_file_path(&app).ok_or("Cannot resolve app data directory")?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Clear cache whenever token changes
    if let Ok(mut cache) = lb_state.cache.lock() {
        *cache = None;
    }

    match token {
        Some(t) => tokio::fs::write(&path, t.trim().as_bytes())
            .await
            .map_err(|e| e.to_string()),
        None => {
            let _ = tokio::fs::remove_file(&path).await;
            Ok(())
        }
    }
}

/// Returns `true` if a token is currently stored.
#[tauri::command]
pub async fn get_listenbrainz_token_set(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(read_token(&app).await.is_some())
}

/// Retrieve the currently stored ListenBrainz token.
#[tauri::command]
pub async fn get_listenbrainz_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_token(&app).await)
}

/// Remove the stored ListenBrainz token.
#[tauri::command]
pub async fn delete_listenbrainz_token(
    app: tauri::AppHandle,
    lb_state: tauri::State<'_, ListenBrainzState>,
) -> Result<(), String> {
    if let Some(path) = token_file_path(&app) {
        let _ = tokio::fs::remove_file(path).await;
    }

    // Clear cache
    if let Ok(mut cache) = lb_state.cache.lock() {
        *cache = None;
    }

    Ok(())
}

// ── Token validation ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ValidateTokenResponse {
    valid: bool,
    user_name: Option<String>,
}

/// Validate a token against the ListenBrainz API. Returns the username on
/// success, or an error string if the token is invalid or the network fails.
#[tauri::command]
pub async fn verify_listenbrainz_token(token: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/validate-token", LB_API_BASE))
        .header("Authorization", format!("Token {}", token.trim()))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let data: ValidateTokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    if data.valid {
        Ok(data.user_name.unwrap_or_default())
    } else {
        Err("Invalid ListenBrainz token".into())
    }
}

// ── Submit listen ─────────────────────────────────────────────────────────────

/// Submit a single listen (`now_playing = false`) or a "playing_now" event
/// (`now_playing = true`). Silently succeeds if no token is configured.
#[tauri::command]
pub async fn submit_listenbrainz_listen(
    artist: String,
    title: String,
    album: Option<String>,
    duration_secs: Option<i32>,
    now_playing: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let token = match read_token(&app).await {
        Some(t) => t,
        None => return Ok(()), // silently skip – no token configured
    };

    let listen_type = if now_playing { "playing_now" } else { "single" };

    let mut additional_info = serde_json::json!({
        "media_player": "Audion",
        "submission_client": "Audion",
    });

    if let Some(d) = duration_secs {
        additional_info["duration_ms"] =
            serde_json::Value::Number(serde_json::Number::from(d * 1000));
    }

    let mut track_meta = serde_json::json!({
        "artist_name": artist,
        "track_name": title,
        "additional_info": additional_info,
    });

    if let Some(a) = album {
        track_meta["release_name"] = serde_json::Value::String(a);
    }

    let payload = if now_playing {
        serde_json::json!({
            "listen_type": listen_type,
            "payload": [{ "track_metadata": track_meta }]
        })
    } else {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        serde_json::json!({
            "listen_type": listen_type,
            "payload": [{
                "listened_at": ts,
                "track_metadata": track_meta,
            }]
        })
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/submit-listens", LB_API_BASE))
        .header("Authorization", format!("Token {}", token))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::warn!(error = %text, "ListenBrainz submission failed");
        return Err(format!("ListenBrainz error: {}", text));
    }

    Ok(())
}

// ── Recommendations ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LbRecommendation {
    pub recording_mbid: Option<String>,
    pub artist_name: String,
    pub track_name: String,
    pub release_name: Option<String>,
    pub score: Option<f64>,
    /// ID of a matching local track if found in the library.
    pub local_track_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LbCache {
    pub recommendations: Vec<LbRecommendation>,
    pub timestamp: SystemTime,
    pub username: String,
}

pub struct ListenBrainzState {
    pub cache: std::sync::Mutex<Option<LbCache>>,
}

impl ListenBrainzState {
    pub fn new() -> Self {
        Self {
            cache: std::sync::Mutex::new(None),
        }
    }
}

#[derive(Deserialize, Debug)]
struct LbMetadataRespItem {
    artist: Option<LbMetadataArtist>,
    recording: Option<LbMetadataRecording>,
    release: Option<LbMetadataRelease>,
}

#[derive(Deserialize, Debug)]
struct LbMetadataArtist {
    name: String,
}

#[derive(Deserialize, Debug)]
struct LbMetadataRecording {
    name: String,
}

#[derive(Deserialize, Debug)]
struct LbMetadataRelease {
    name: String,
}

/// Fetch personalised recording recommendations from ListenBrainz collaborative
/// filtering and try to match each one to a track in the local library.
#[tauri::command]
pub async fn fetch_listenbrainz_recommendations(
    limit: Option<usize>,
    db: tauri::State<'_, crate::db::Database>,
    lb_state: tauri::State<'_, ListenBrainzState>,
    app: tauri::AppHandle,
) -> Result<Vec<LbRecommendation>, String> {
    let token = match read_token(&app).await {
        Some(t) => t,
        None => {
            return Err("No ListenBrainz token configured. Enable it in Settings first.".into())
        }
    };

    // Resolve username from token
    let username = verify_listenbrainz_token(token.clone()).await?;
    if username.is_empty() {
        return Err("Could not determine ListenBrainz username from token".into());
    }

    // Check cache first
    {
        if let Ok(cache_guard) = lb_state.cache.lock() {
            if let Some(cache) = cache_guard.as_ref() {
                if cache.username == username {
                    if let Ok(elapsed) = cache.timestamp.elapsed() {
                        // Cache for 1 Day
                        if elapsed.as_secs() < 86400 {
                            eprintln!("[LB] Returning cached recommendations for {}", username);
                            return Ok(cache.recommendations.clone());
                        }
                    }
                }
            }
        }
    }

    let count = limit.unwrap_or(50);
    let client = reqwest::Client::new();
    let url = format!(
        "{}/cf/recommendation/user/{}/recording?count={}",
        LB_API_BASE, username, count
    );

    eprintln!("[LB] fetch_listenbrainz_recommendations called");
    let resp = client
        .get(&url)
        .header("Authorization", format!("Token {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();

    // 204 = "No recommendations yet" — the user hasn't been processed by CF yet.
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(vec![]);
    }

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ListenBrainz API error ({}): {}", status, text));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let recordings = data["payload"]["mbids"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    if recordings.is_empty() {
        return Ok(vec![]);
    }

    // ── Pre-fetch metadata for the MBIDs ─────────────────────────────────────
    // Collaborative filtering recommendations only return MBIDs + scores.
    // We need names + artists to show them and to match them locally.
    let mbids: Vec<String> = recordings
        .iter()
        .filter_map(|r| r["recording_mbid"].as_str().map(|s| s.to_string()))
        .collect();

    eprintln!(
        "[LB] Pre-fetching metadata for {} MBIDs: {:?}",
        mbids.len(),
        mbids
    );

    let mut metadata_map: HashMap<String, LbMetadataRespItem> = HashMap::new();

    if !mbids.is_empty() {
        let metadata_url = format!("{}/metadata/recording/", LB_API_BASE);
        let m_resp = client
            .get(&metadata_url)
            .query(&[
                ("recording_mbids", mbids.join(",")),
                ("inc", "artist".to_string()),
            ])
            .send()
            .await;

        if let Ok(resp) = m_resp {
            let status = resp.status();
            eprintln!("[LB] Metadata API response status: {}", status);
            if status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                eprintln!("[LB] Metadata API raw response length: {}", text.len());
                match serde_json::from_str::<HashMap<String, LbMetadataRespItem>>(&text) {
                    Ok(m_map) => {
                        eprintln!(
                            "[LB] Successfully parsed metadata for {} tracks",
                            m_map.len()
                        );
                        metadata_map = m_map;
                    }
                    Err(e) => {
                        eprintln!("[LB] Failed to parse metadata JSON: {}", e);
                    }
                }
            }
        } else if let Err(e) = m_resp {
            eprintln!("[LB] Metadata API request failed: {}", e);
        }
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    for rec in &recordings {
        let mbid = rec["recording_mbid"].as_str().map(|s| s.to_string());
        let score = rec["score"].as_f64();

        let (artist_name, track_name, release_name) =
            match mbid.as_ref().and_then(|m| metadata_map.get(m)) {
                Some(meta) => (
                    meta.artist
                        .as_ref()
                        .map(|a| a.name.clone())
                        .unwrap_or_else(|| "Unknown Artist".to_string()),
                    meta.recording
                        .as_ref()
                        .map(|r| r.name.clone())
                        .unwrap_or_else(|| "Unknown Track".to_string()),
                    meta.release.as_ref().map(|r| r.name.clone()),
                ),
                None => (
                    rec["mb_artist_credit_name"]
                        .as_str()
                        .unwrap_or("Unknown Artist")
                        .to_string(),
                    rec["mb_track_name"]
                        .as_str()
                        .unwrap_or("Unknown Track")
                        .to_string(),
                    rec["mb_release_name"].as_str().map(|s| s.to_string()),
                ),
            };

        let local_track_id = match_to_local(&conn, &mbid, &artist_name, &track_name);

        results.push(LbRecommendation {
            recording_mbid: mbid,
            artist_name,
            track_name,
            release_name,
            score,
            local_track_id,
        });
    }

    let final_results = results;

    // Update cache
    if let Ok(mut cache_guard) = lb_state.cache.lock() {
        *cache_guard = Some(LbCache {
            recommendations: final_results.clone(),
            timestamp: SystemTime::now(),
            username,
        });
    }

    Ok(final_results)
}

/// Try to find a matching local track by MBID first, then fuzzy artist+title.
fn match_to_local(
    conn: &rusqlite::Connection,
    mbid: &Option<String>,
    artist: &str,
    title: &str,
) -> Option<i64> {
    // 1. Exact MusicBrainz Recording ID
    if let Some(ref m) = mbid {
        if let Ok(id) = conn.query_row(
            "SELECT id FROM tracks WHERE musicbrainz_recording_id = ?1 LIMIT 1",
            rusqlite::params![m],
            |row| row.get::<_, i64>(0),
        ) {
            return Some(id);
        }
    }

    // 2. Case-insensitive artist + title match
    if let Ok(id) = conn.query_row(
        "SELECT id FROM tracks \
         WHERE lower(artist) = lower(?1) AND lower(title) = lower(?2) \
         LIMIT 1",
        rusqlite::params![artist, title],
        |row| row.get::<_, i64>(0),
    ) {
        return Some(id);
    }

    None
}
