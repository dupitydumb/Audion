//! Subsonic API integration
//!
//! Credentials stored in {app_data_dir}/subsonic_config.json (never SQLite or localStorage).
//! Auth: token = md5(password + salt), salt is random per request, per Subsonic spec.

use serde::{Deserialize, Serialize};
use tauri::Manager;

const SUBSONIC_API_VERSION: &str = "1.16.1";
const SUBSONIC_CLIENT: &str = "Audion";
const CONFIG_FILENAME: &str = "subsonic_config.json";

// ── Config persistence ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SubsonicConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub enabled: bool,
}

pub struct SubsonicState {
    pub config: std::sync::Mutex<SubsonicConfig>,
}

impl SubsonicState {
    pub fn new() -> Self {
        Self {
            config: std::sync::Mutex::new(SubsonicConfig::default()),
        }
    }
}

fn config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(CONFIG_FILENAME))
}

pub async fn load_config_from_disk(app: &tauri::AppHandle) -> SubsonicConfig {
    let Some(path) = config_path(app) else {
        return SubsonicConfig::default();
    };
    let Ok(text) = tokio::fs::read_to_string(&path).await else {
        return SubsonicConfig::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

// ── Auth param construction ───────────────────────────────────────────────────

/// Build a fully-qualified Subsonic REST URL with token auth baked into the query string.
/// token = md5(password + salt); salt = nanosecond hex timestamp (unique per call).
fn build_subsonic_url(
    base: &str,
    endpoint: &str,
    username: &str,
    password: &str,
    extra: &[(&str, &str)],
) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let salt = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos()
    );
    let token_input = format!("{}{}", password, salt);
    let token = format!("{:x}", md5::compute(token_input.as_bytes()));

    let base = base.trim_end_matches('/');
    let rest_base = if base.ends_with("/rest") {
        base.to_string()
    } else {
        format!("{}/rest", base)
    };

    let mut pairs = vec![
        ("u", username.to_string()),
        ("t", token),
        ("s", salt),
        ("v", SUBSONIC_API_VERSION.to_string()),
        ("c", SUBSONIC_CLIENT.to_string()),
        ("f", "json".to_string()),
    ];
    for (k, v) in extra {
        pairs.push((k, v.to_string()));
    }

    let query = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{}/{}.view?{}", rest_base, endpoint, query)
}

// ── Response plumbing ─────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct SubsonicResponse {
    #[serde(rename = "subsonic-response")]
    inner: SubsonicInner,
}

#[derive(Deserialize, Debug)]
struct SubsonicInner {
    status: String,
    error: Option<SubsonicApiError>,
    #[serde(flatten)]
    data: serde_json::Value,
}

#[derive(Deserialize, Debug)]
struct SubsonicApiError {
    code: u32,
    message: String,
}

fn check_ok(inner: &SubsonicInner) -> Result<(), String> {
    if inner.status != "ok" {
        if let Some(e) = &inner.error {
            return Err(format!("Subsonic error {}: {}", e.code, e.message));
        }
        return Err("Subsonic request failed".into());
    }
    Ok(())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

// ── Public return types ───────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicUser {
    pub username: String,
    pub server_version: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicArtist {
    pub id: String,
    pub name: String,
    pub album_count: Option<u32>,
    pub cover_art: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicSong {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<u32>,
    pub cover_art: Option<String>,
    pub track: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicAlbum {
    pub id: String,
    pub name: String,
    pub artist: Option<String>,
    pub cover_art: Option<String>,
    pub songs: Vec<SubsonicSong>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicPlaylist {
    pub id: String,
    pub name: String,
    pub song_count: Option<u32>,
    pub cover_art: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SubsonicSearchResult {
    pub artists: Vec<SubsonicArtist>,
    pub songs: Vec<SubsonicSong>,
}

fn parse_song(s: &serde_json::Value) -> SubsonicSong {
    SubsonicSong {
        id: s["id"].as_str().unwrap_or("").to_string(),
        title: s["title"].as_str().unwrap_or("Unknown").to_string(),
        artist: s["artist"].as_str().map(str::to_string),
        album: s["album"].as_str().map(str::to_string),
        duration: s["duration"].as_u64().map(|n| n as u32),
        cover_art: s["coverArt"].as_str().map(str::to_string),
        track: s["track"].as_u64().map(|n| n as u32),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn subsonic_save_config(
    url: String,
    username: String,
    password: String,
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let config = SubsonicConfig { url, username, password, enabled };
    let path = config_path(&app).ok_or("Cannot resolve app data dir")?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json.as_bytes()).await.map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
pub async fn subsonic_get_config(
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicConfig, String> {
    Ok(state.config.lock().unwrap().clone())
}

#[tauri::command]
pub async fn subsonic_test_connection(
    url: String,
    username: String,
    password: String,
) -> Result<SubsonicUser, String> {
    let req_url = build_subsonic_url(&url, "ping", &username, &password, &[]);
    let resp = client()
        .get(&req_url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;
    let server_version = body.inner.data["version"].as_str().map(str::to_string);
    Ok(SubsonicUser { username, server_version })
}

#[tauri::command]
pub async fn subsonic_ping(
    state: tauri::State<'_, SubsonicState>,
) -> Result<bool, String> {
    let cfg = state.config.lock().unwrap().clone();
    if !cfg.enabled || cfg.url.is_empty() {
        return Ok(false);
    }
    let url = build_subsonic_url(&cfg.url, "ping", &cfg.username, &cfg.password, &[]);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    Ok(body.inner.status == "ok")
}

#[tauri::command]
pub async fn subsonic_get_indexes(
    state: tauri::State<'_, SubsonicState>,
) -> Result<Vec<SubsonicArtist>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(&cfg.url, "getArtists", &cfg.username, &cfg.password, &[]);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let mut artists = Vec::new();
    if let Some(indexes) = body.inner.data["artists"]["index"].as_array() {
        for idx in indexes {
            if let Some(arr) = idx["artist"].as_array() {
                for a in arr {
                    artists.push(SubsonicArtist {
                        id: a["id"].as_str().unwrap_or("").to_string(),
                        name: a["name"].as_str().unwrap_or("").to_string(),
                        album_count: a["albumCount"].as_u64().map(|n| n as u32),
                        cover_art: a["coverArt"].as_str().map(str::to_string),
                    });
                }
            }
        }
    }
    Ok(artists)
}

#[tauri::command]
pub async fn subsonic_search(
    query: String,
    song_count: Option<u32>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicSearchResult, String> {
    let cfg = state.config.lock().unwrap().clone();
    let count = song_count.unwrap_or(30).to_string();
    let url = build_subsonic_url(
        &cfg.url,
        "search3",
        &cfg.username,
        &cfg.password,
        &[
            ("query", query.as_str()),
            ("songCount", count.as_str()),
            ("artistCount", "10"),
            ("albumCount", "10"),
        ],
    );
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let mut result = SubsonicSearchResult::default();
    if let Some(songs) = body.inner.data["searchResult3"]["song"].as_array() {
        result.songs = songs.iter().map(parse_song).collect();
    }
    if let Some(artists) = body.inner.data["searchResult3"]["artist"].as_array() {
        result.artists = artists
            .iter()
            .map(|a| SubsonicArtist {
                id: a["id"].as_str().unwrap_or("").to_string(),
                name: a["name"].as_str().unwrap_or("").to_string(),
                album_count: a["albumCount"].as_u64().map(|n| n as u32),
                cover_art: a["coverArt"].as_str().map(str::to_string),
            })
            .collect();
    }
    Ok(result)
}

#[tauri::command]
pub async fn subsonic_get_album(
    id: String,
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicAlbum, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(
        &cfg.url,
        "getAlbum",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str())],
    );
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let alb = &body.inner.data["album"];
    let songs = alb["song"]
        .as_array()
        .map(|arr| arr.iter().map(parse_song).collect())
        .unwrap_or_default();
    Ok(SubsonicAlbum {
        id: alb["id"].as_str().unwrap_or("").to_string(),
        name: alb["name"].as_str().unwrap_or("").to_string(),
        artist: alb["artist"].as_str().map(str::to_string),
        cover_art: alb["coverArt"].as_str().map(str::to_string),
        songs,
    })
}

#[tauri::command]
pub async fn subsonic_get_playlists(
    state: tauri::State<'_, SubsonicState>,
) -> Result<Vec<SubsonicPlaylist>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(&cfg.url, "getPlaylists", &cfg.username, &cfg.password, &[]);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let playlists = body.inner.data["playlists"]["playlist"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|p| SubsonicPlaylist {
                    id: p["id"].as_str().unwrap_or("").to_string(),
                    name: p["name"].as_str().unwrap_or("").to_string(),
                    song_count: p["songCount"].as_u64().map(|n| n as u32),
                    cover_art: p["coverArt"].as_str().map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(playlists)
}

#[tauri::command]
pub async fn subsonic_get_playlist(
    id: String,
    state: tauri::State<'_, SubsonicState>,
) -> Result<Vec<SubsonicSong>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(
        &cfg.url,
        "getPlaylist",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str())],
    );
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let songs = body.inner.data["playlist"]["entry"]
        .as_array()
        .map(|arr| arr.iter().map(parse_song).collect())
        .unwrap_or_default();
    Ok(songs)
}

/// Returns a stream URL with auth baked in — pass directly to HTML5 audio src.
#[tauri::command]
pub fn subsonic_get_stream_url(
    id: String,
    state: tauri::State<'_, SubsonicState>,
) -> Result<String, String> {
    let cfg = state.config.lock().unwrap().clone();
    if !cfg.enabled || cfg.url.is_empty() {
        return Err("Subsonic not configured or disabled".into());
    }
    Ok(build_subsonic_url(
        &cfg.url,
        "stream",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str())],
    ))
}

/// Returns a cover art URL with auth baked in.
#[tauri::command]
pub fn subsonic_get_cover_url(
    id: String,
    size: Option<u32>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<String, String> {
    let cfg = state.config.lock().unwrap().clone();
    if cfg.url.is_empty() {
        return Err("Subsonic not configured".into());
    }
    let size_str = size.map(|s| s.to_string());
    let mut extra = vec![("id", id.as_str())];
    if let Some(ref s) = size_str {
        extra.push(("size", s.as_str()));
    }
    Ok(build_subsonic_url(
        &cfg.url,
        "getCoverArt",
        &cfg.username,
        &cfg.password,
        &extra,
    ))
}

/// Log a play event (scrobble). Silently no-ops if Subsonic is disabled.
#[tauri::command]
pub async fn subsonic_scrobble(
    id: String,
    submission: bool,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    if !cfg.enabled || cfg.url.is_empty() {
        return Ok(());
    }
    let sub_str = submission.to_string();
    let url = build_subsonic_url(
        &cfg.url,
        "scrobble",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str()), ("submission", sub_str.as_str())],
    );
    let resp = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)
}
