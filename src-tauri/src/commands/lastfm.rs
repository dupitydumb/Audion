//! Last.fm integration commands
//!
//! All scrobbling is strictly opt-in. The Last.fm session key is stored in the
//! user's platform app-data directory (`lastfm_session.json`) and never written
//! to world-readable storage.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const LASTFM_API_BASE: &str = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_LASTFM_API_KEY: &str = "c43224976722ec10b5c00e12ef5e9dc3";
const DEFAULT_LASTFM_API_SECRET: &str = "9231f13d80d28564b5853f0980f33f67";

// ── Session storage (app-data file) ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LastFmSession {
    pub username: String,
    pub session_key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LastFmStatus {
    pub connected: bool,
    pub username: Option<String>,
}

fn session_file_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("lastfm_session.json"))
}

async fn read_session(app: &tauri::AppHandle) -> Option<LastFmSession> {
    let path = session_file_path(app)?;
    let content = tokio::fs::read_to_string(&path).await.ok()?;
    serde_json::from_str::<LastFmSession>(&content).ok()
}

async fn write_session(app: &tauri::AppHandle, session: &LastFmSession) -> Result<(), String> {
    let path = session_file_path(app).ok_or("Cannot resolve app data directory")?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(())
}

fn create_api_signature(params: &[(String, String)], secret: &str) -> String {
    let mut sorted = params.to_vec();
    sorted.retain(|(k, _)| k != "format" && k != "callback");
    sorted.sort_by(|a, b| a.0.cmp(&b.0));

    let mut sig_string = String::new();
    for (k, v) in sorted {
        sig_string.push_str(&k);
        sig_string.push_str(&v);
    }
    sig_string.push_str(secret);

    let digest = md5::compute(sig_string.as_bytes());
    format!("{:x}", digest)
}

// ── Authentication & Commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn get_lastfm_auth_url() -> Result<String, String> {
    let url = format!(
        "https://www.last.fm/api/auth/?api_key={}&cb=audion://lastfm-callback",
        DEFAULT_LASTFM_API_KEY
    );
    Ok(url)
}

#[derive(Deserialize)]
struct LastFmSessionResponse {
    session: Option<LastFmSessionData>,
    error: Option<i32>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct LastFmSessionData {
    name: String,
    key: String,
}

#[tauri::command]
pub async fn complete_lastfm_auth(token: String, app: tauri::AppHandle) -> Result<String, String> {
    let mut params = vec![
        ("api_key".to_string(), DEFAULT_LASTFM_API_KEY.to_string()),
        ("method".to_string(), "auth.getSession".to_string()),
        ("token".to_string(), token.trim().to_string()),
    ];
    let sig = create_api_signature(&params, DEFAULT_LASTFM_API_SECRET);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let client = reqwest::Client::builder()
        .user_agent("Audion/1.5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(LASTFM_API_BASE)
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("Last.fm network error: {}", e))?;

    let data: LastFmSessionResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Last.fm auth response: {}", e))?;

    if let Some(err) = data.error {
        let msg = data.message.unwrap_or_else(|| "Unknown error".to_string());
        return Err(format!("Last.fm auth failed (code {}): {}", err, msg));
    }

    let session_data = data.session.ok_or("Missing session in response")?;
    let session = LastFmSession {
        username: session_data.name.clone(),
        session_key: session_data.key,
    };

    write_session(&app, &session).await?;
    tracing::info!("Last.fm authentication successful for user {}", session.username);
    Ok(session_data.name)
}

#[tauri::command]
pub async fn get_lastfm_status(app: tauri::AppHandle) -> Result<LastFmStatus, String> {
    if let Some(session) = read_session(&app).await {
        Ok(LastFmStatus {
            connected: true,
            username: Some(session.username),
        })
    } else {
        Ok(LastFmStatus {
            connected: false,
            username: None,
        })
    }
}

#[tauri::command]
pub async fn disconnect_lastfm(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(path) = session_file_path(&app) {
        let _ = tokio::fs::remove_file(path).await;
    }
    tracing::info!("Last.fm session disconnected");
    Ok(())
}

// ── Scrobbling ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn submit_lastfm_now_playing(
    artist: String,
    title: String,
    album: Option<String>,
    duration_secs: Option<i32>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let session = match read_session(&app).await {
        Some(s) => s,
        None => return Ok(()), // Not connected
    };

    let mut params = vec![
        ("api_key".to_string(), DEFAULT_LASTFM_API_KEY.to_string()),
        ("artist".to_string(), artist),
        ("method".to_string(), "track.updateNowPlaying".to_string()),
        ("sk".to_string(), session.session_key),
        ("track".to_string(), title),
    ];

    if let Some(ref a) = album {
        if !a.trim().is_empty() {
            params.push(("album".to_string(), a.clone()));
        }
    }
    if let Some(d) = duration_secs {
        if d > 0 {
            params.push(("duration".to_string(), d.to_string()));
        }
    }

    let sig = create_api_signature(&params, DEFAULT_LASTFM_API_SECRET);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let client = reqwest::Client::builder()
        .user_agent("Audion/1.5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(LASTFM_API_BASE)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Last.fm network error: {}", e))?;

    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        tracing::warn!("Last.fm updateNowPlaying error: {}", txt);
    }

    Ok(())
}

#[tauri::command]
pub async fn submit_lastfm_scrobble(
    artist: String,
    title: String,
    album: Option<String>,
    duration_secs: Option<i32>,
    timestamp: Option<u64>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let session = match read_session(&app).await {
        Some(s) => s,
        None => return Ok(()), // Not connected
    };

    let scrobble_time = timestamp.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    });

    let mut params = vec![
        ("api_key".to_string(), DEFAULT_LASTFM_API_KEY.to_string()),
        ("artist".to_string(), artist.clone()),
        ("method".to_string(), "track.scrobble".to_string()),
        ("sk".to_string(), session.session_key),
        ("timestamp".to_string(), scrobble_time.to_string()),
        ("track".to_string(), title.clone()),
    ];

    if let Some(ref a) = album {
        if !a.trim().is_empty() {
            params.push(("album".to_string(), a.clone()));
        }
    }
    if let Some(d) = duration_secs {
        if d > 0 {
            params.push(("duration".to_string(), d.to_string()));
        }
    }

    let sig = create_api_signature(&params, DEFAULT_LASTFM_API_SECRET);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let client = reqwest::Client::builder()
        .user_agent("Audion/1.5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let send_res = client
        .post(LASTFM_API_BASE)
        .form(&params)
        .send()
        .await;

    match send_res {
        Ok(resp) => {
            if !resp.status().is_success() {
                let txt = resp.text().await.unwrap_or_default();
                tracing::warn!("Last.fm scrobble error: {}", txt);
                if !txt.contains("Invalid session key") {
                    cache_failed_scrobble(&app, "lastfm", &artist, &title, album.as_deref(), duration_secs, scrobble_time);
                }
            } else {
                tracing::info!("Last.fm scrobble successful");
            }
        }
        Err(e) => {
            tracing::warn!("Last.fm network error, caching scrobble for later: {}", e);
            cache_failed_scrobble(&app, "lastfm", &artist, &title, album.as_deref(), duration_secs, scrobble_time);
        }
    }

    Ok(())
}

fn cache_failed_scrobble(
    app: &tauri::AppHandle,
    service: &str,
    artist: &str,
    title: &str,
    album: Option<&str>,
    duration: Option<i32>,
    timestamp: u64,
) {
    if let Some(db) = app.try_state::<crate::db::Database>() {
        if let Ok(conn) = db.conn.lock() {
            let _ = crate::db::scrobbles::insert_cached_scrobble(
                &conn,
                service,
                artist,
                title,
                album,
                duration,
                timestamp,
            );
        }
    }
}

#[tauri::command]
pub async fn replay_cached_scrobbles(app: tauri::AppHandle) -> Result<usize, String> {
    let session = match read_session(&app).await {
        Some(s) => s,
        None => return Ok(0),
    };

    let cached = {
        let db = app.try_state::<crate::db::Database>()
            .ok_or_else(|| "Database not available".to_string())?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::scrobbles::get_cached_scrobbles(&conn, 50).map_err(|e| e.to_string())?
    };

    if cached.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder()
        .user_agent("Audion/1.5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut replayed = 0;

    for item in cached {
        if item.service == "lastfm" {
            let mut params = vec![
                ("api_key".to_string(), DEFAULT_LASTFM_API_KEY.to_string()),
                ("artist".to_string(), item.artist.clone()),
                ("method".to_string(), "track.scrobble".to_string()),
                ("sk".to_string(), session.session_key.clone()),
                ("timestamp".to_string(), item.timestamp.to_string()),
                ("track".to_string(), item.title.clone()),
            ];

            if let Some(ref a) = item.album {
                if !a.trim().is_empty() {
                    params.push(("album".to_string(), a.clone()));
                }
            }
            if let Some(d) = item.duration {
                if d > 0 {
                    params.push(("duration".to_string(), d.to_string()));
                }
            }

            let sig = create_api_signature(&params, DEFAULT_LASTFM_API_SECRET);
            params.push(("api_sig".to_string(), sig));
            params.push(("format".to_string(), "json".to_string()));

            let res = client.post(LASTFM_API_BASE).form(&params).send().await;

            let is_success;
            let should_break;
            let should_delete;
            let should_retry;

            match res {
                Ok(resp) => {
                    if resp.status().is_success() {
                        is_success = true;
                        should_break = false;
                        should_delete = true;
                        should_retry = false;
                    } else {
                        is_success = false;
                        let txt = resp.text().await.unwrap_or_default();
                        if txt.contains("Invalid session key") {
                            should_break = true;
                            should_delete = false;
                            should_retry = false;
                        } else if item.retry_count >= 10 {
                            should_break = false;
                            should_delete = true;
                            should_retry = false;
                        } else {
                            should_break = false;
                            should_delete = false;
                            should_retry = true;
                        }
                    }
                }
                Err(_) => {
                    is_success = false;
                    should_break = true;
                    should_delete = false;
                    should_retry = true;
                }
            }

            let db = app.state::<crate::db::Database>();
            if let Ok(conn) = db.conn.lock() {
                if should_delete {
                    let _ = crate::db::scrobbles::delete_cached_scrobble(&conn, item.id);
                } else if should_retry {
                    let _ = crate::db::scrobbles::increment_scrobble_retry(&conn, item.id);
                }
            }

            if is_success {
                replayed += 1;
            }
            if should_break {
                break;
            }
        }
    }

    if replayed > 0 {
        tracing::info!("Successfully replayed {} cached offline scrobbles", replayed);
    }

    Ok(replayed)
}
