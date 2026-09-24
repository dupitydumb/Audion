//! Subsonic API integration
//!
//! Credentials stored in {app_data_dir}/subsonic_config.json (never SQLite or localStorage).
//! Auth: token = md5(password + salt), salt is random per request, per Subsonic spec.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
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
/// Pass `json = true` for JSON endpoints, `false` for binary endpoints (stream, getCoverArt).
fn build_subsonic_url_inner(
    base: &str,
    endpoint: &str,
    username: &str,
    password: &str,
    extra: &[(&str, &str)],
    json: bool,
) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let salt = format!("{:x}{:x}", dur.as_millis(), dur.subsec_nanos());
    let token = format!("{:x}", md5::compute(format!("{}{}", password, salt).as_bytes()));

    let base = base.trim_end_matches('/');
    let rest_base = if base.ends_with("/rest") {
        base
    } else {
        // ponytail: small alloc only on non-"/rest" base URLs (rare in practice)
        &format!("{}/rest", base)
    };

    // Pre-size: fixed params + optional f=json + extras, ~40 chars per param avg
    let fixed = 6 + usize::from(json); // u + t + s + v + c + (f)
    let mut query = String::with_capacity((fixed + extra.len()) * 40);

    macro_rules! push_pair {
        ($k:expr, $v:expr) => {{
            if !query.is_empty() { query.push('&'); }
            query.push_str($k);
            query.push('=');
            query.push_str(&urlencoding::encode($v));
        }};
    }

    push_pair!("u", username);
    push_pair!("t", &token);
    push_pair!("s", &salt);
    push_pair!("v", SUBSONIC_API_VERSION);
    push_pair!("c", SUBSONIC_CLIENT);
    if json { push_pair!("f", "json"); }
    for (k, v) in extra { push_pair!(k, v); }

    format!("{}/{}.view?{}", rest_base, endpoint, query)
}

#[inline]
fn build_subsonic_url(
    base: &str, endpoint: &str, username: &str, password: &str, extra: &[(&str, &str)],
) -> String {
    build_subsonic_url_inner(base, endpoint, username, password, extra, true)
}

/// Omits `f=json` — for binary endpoints (stream, getCoverArt) that return raw bytes.
#[inline]
fn build_subsonic_binary_url(
    base: &str, endpoint: &str, username: &str, password: &str, extra: &[(&str, &str)],
) -> String {
    build_subsonic_url_inner(base, endpoint, username, password, extra, false)
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

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build subsonic HTTP client")
    })
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicAlbumSummary {
    pub id: String,
    pub name: String,
    pub artist: Option<String>,
    pub artist_id: Option<String>,
    pub song_count: Option<u32>,
    pub duration: Option<u32>,
    pub cover_art: Option<String>,
    pub year: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubsonicArtistDetail {
    pub id: String,
    pub name: String,
    pub cover_art: Option<String>,
    pub album_count: Option<u32>,
    pub albums: Vec<SubsonicAlbumSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SubsonicStarred {
    pub songs: Vec<SubsonicSong>,
    pub albums: Vec<SubsonicAlbumSummary>,
    pub artists: Vec<SubsonicArtist>,
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
    Ok(build_subsonic_binary_url(
        &cfg.url,
        "stream",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str()), ("format", "mp3")],
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
    Ok(build_subsonic_binary_url(
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

// ── Additional browsing ───────────────────────────────────────────────────────

/// Get details + album list for a single artist (ID3 tag mode).
#[tauri::command]
pub async fn subsonic_get_artist(
    id: String,
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicArtistDetail, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(
        &cfg.url,
        "getArtist",
        &cfg.username,
        &cfg.password,
        &[("id", id.as_str())],
    );
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let a = &body.inner.data["artist"];
    let albums = a["album"].as_array().map(|arr| arr.iter().map(|alb| SubsonicAlbumSummary {
        id: alb["id"].as_str().unwrap_or("").to_string(),
        name: alb["name"].as_str().unwrap_or("").to_string(),
        artist: alb["artist"].as_str().map(str::to_string),
        artist_id: alb["artistId"].as_str().map(str::to_string),
        song_count: alb["songCount"].as_u64().map(|n| n as u32),
        duration: alb["duration"].as_u64().map(|n| n as u32),
        cover_art: alb["coverArt"].as_str().map(str::to_string),
        year: alb["year"].as_u64().map(|n| n as u32),
    }).collect()).unwrap_or_default();

    Ok(SubsonicArtistDetail {
        id: a["id"].as_str().unwrap_or("").to_string(),
        name: a["name"].as_str().unwrap_or("").to_string(),
        cover_art: a["coverArt"].as_str().map(str::to_string),
        album_count: a["albumCount"].as_u64().map(|n| n as u32),
        albums,
    })
}

/// Get a filtered list of albums (type = newest | frequent | recent | starred | random | alphabeticalByName | alphabeticalByArtist | byGenre | byYear).
#[tauri::command]
pub async fn subsonic_get_album_list(
    list_type: String,
    size: Option<u32>,
    offset: Option<u32>,
    genre: Option<String>,
    from_year: Option<u32>,
    to_year: Option<u32>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<Vec<SubsonicAlbumSummary>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let size_str = size.unwrap_or(20).to_string();
    let offset_str = offset.unwrap_or(0).to_string();
    let from_year_str = from_year.map(|y| y.to_string());
    let to_year_str = to_year.map(|y| y.to_string());

    let mut extra: Vec<(&str, &str)> = vec![
        ("type", list_type.as_str()),
        ("size", size_str.as_str()),
        ("offset", offset_str.as_str()),
    ];
    if let Some(ref g) = genre {
        extra.push(("genre", g.as_str()));
    }
    if let Some(ref fy) = from_year_str {
        extra.push(("fromYear", fy.as_str()));
    }
    if let Some(ref ty) = to_year_str {
        extra.push(("toYear", ty.as_str()));
    }

    let url = build_subsonic_url(&cfg.url, "getAlbumList2", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let albums = body.inner.data["albumList2"]["album"]
        .as_array()
        .map(|arr| arr.iter().map(|alb| SubsonicAlbumSummary {
            id: alb["id"].as_str().unwrap_or("").to_string(),
            name: alb["name"].as_str().unwrap_or("").to_string(),
            artist: alb["artist"].as_str().map(str::to_string),
            artist_id: alb["artistId"].as_str().map(str::to_string),
            song_count: alb["songCount"].as_u64().map(|n| n as u32),
            duration: alb["duration"].as_u64().map(|n| n as u32),
            cover_art: alb["coverArt"].as_str().map(str::to_string),
            year: alb["year"].as_u64().map(|n| n as u32),
        }).collect())
        .unwrap_or_default();
    Ok(albums)
}

/// Get random tracks. Optionally filter by genre, decade, or folder.
#[tauri::command]
pub async fn subsonic_get_random_songs(
    size: Option<u32>,
    genre: Option<String>,
    from_year: Option<u32>,
    to_year: Option<u32>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<Vec<SubsonicSong>, String> {
    let cfg = state.config.lock().unwrap().clone();
    let size_str = size.unwrap_or(50).to_string();
    let from_year_str = from_year.map(|y| y.to_string());
    let to_year_str = to_year.map(|y| y.to_string());

    let mut extra: Vec<(&str, &str)> = vec![("size", size_str.as_str())];
    if let Some(ref g) = genre {
        extra.push(("genre", g.as_str()));
    }
    if let Some(ref fy) = from_year_str {
        extra.push(("fromYear", fy.as_str()));
    }
    if let Some(ref ty) = to_year_str {
        extra.push(("toYear", ty.as_str()));
    }

    let url = build_subsonic_url(&cfg.url, "getRandomSongs", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let songs = body.inner.data["randomSongs"]["song"]
        .as_array()
        .map(|arr| arr.iter().map(parse_song).collect())
        .unwrap_or_default();
    Ok(songs)
}

/// Star an item (song, album, or artist). Pass one of song_id, album_id, or artist_id.
#[tauri::command]
pub async fn subsonic_star(
    song_id: Option<String>,
    album_id: Option<String>,
    artist_id: Option<String>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    let mut extra: Vec<(&str, &str)> = vec![];
    // borrow temporaries
    let sid = song_id.unwrap_or_default();
    let aid = album_id.unwrap_or_default();
    let arid = artist_id.unwrap_or_default();
    if !sid.is_empty() { extra.push(("id", sid.as_str())); }
    if !aid.is_empty() { extra.push(("albumId", aid.as_str())); }
    if !arid.is_empty() { extra.push(("artistId", arid.as_str())); }
    if extra.is_empty() {
        return Err("Must provide song_id, album_id, or artist_id".into());
    }
    let url = build_subsonic_url(&cfg.url, "star", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)
}

/// Remove star from an item.
#[tauri::command]
pub async fn subsonic_unstar(
    song_id: Option<String>,
    album_id: Option<String>,
    artist_id: Option<String>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    let mut extra: Vec<(&str, &str)> = vec![];
    let sid = song_id.unwrap_or_default();
    let aid = album_id.unwrap_or_default();
    let arid = artist_id.unwrap_or_default();
    if !sid.is_empty() { extra.push(("id", sid.as_str())); }
    if !aid.is_empty() { extra.push(("albumId", aid.as_str())); }
    if !arid.is_empty() { extra.push(("artistId", arid.as_str())); }
    if extra.is_empty() {
        return Err("Must provide song_id, album_id, or artist_id".into());
    }
    let url = build_subsonic_url(&cfg.url, "unstar", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)
}

/// Get all starred songs, albums, and artists.
#[tauri::command]
pub async fn subsonic_get_starred(
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicStarred, String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(&cfg.url, "getStarred2", &cfg.username, &cfg.password, &[]);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let starred = &body.inner.data["starred2"];
    Ok(SubsonicStarred {
        songs: starred["song"].as_array().map(|arr| arr.iter().map(parse_song).collect()).unwrap_or_default(),
        albums: starred["album"].as_array().map(|arr| arr.iter().map(|alb| SubsonicAlbumSummary {
            id: alb["id"].as_str().unwrap_or("").to_string(),
            name: alb["name"].as_str().unwrap_or("").to_string(),
            artist: alb["artist"].as_str().map(str::to_string),
            artist_id: alb["artistId"].as_str().map(str::to_string),
            song_count: alb["songCount"].as_u64().map(|n| n as u32),
            duration: alb["duration"].as_u64().map(|n| n as u32),
            cover_art: alb["coverArt"].as_str().map(str::to_string),
            year: alb["year"].as_u64().map(|n| n as u32),
        }).collect()).unwrap_or_default(),
        artists: starred["artist"].as_array().map(|arr| arr.iter().map(|a| SubsonicArtist {
            id: a["id"].as_str().unwrap_or("").to_string(),
            name: a["name"].as_str().unwrap_or("").to_string(),
            album_count: a["albumCount"].as_u64().map(|n| n as u32),
            cover_art: a["coverArt"].as_str().map(str::to_string),
        }).collect()).unwrap_or_default(),
    })
}

/// Create a new playlist. Pass song_ids to pre-populate it.
#[tauri::command]
pub async fn subsonic_create_playlist(
    name: String,
    song_ids: Vec<String>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<SubsonicPlaylist, String> {
    let cfg = state.config.lock().unwrap().clone();
    let mut extra: Vec<(&str, &str)> = vec![("name", name.as_str())];
    // Each song_id is a separate "songId" param — collect into a vec of owned strings first
    let owned: Vec<String> = song_ids.clone();
    for sid in &owned {
        extra.push(("songId", sid.as_str()));
    }
    let url = build_subsonic_url(&cfg.url, "createPlaylist", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)?;

    let p = &body.inner.data["playlist"];
    Ok(SubsonicPlaylist {
        id: p["id"].as_str().unwrap_or("").to_string(),
        name: p["name"].as_str().unwrap_or(&name).to_string(),
        song_count: p["songCount"].as_u64().map(|n| n as u32),
        cover_art: p["coverArt"].as_str().map(str::to_string),
    })
}

/// Update playlist metadata or track list. All params optional except playlist_id.
#[tauri::command]
pub async fn subsonic_update_playlist(
    playlist_id: String,
    name: Option<String>,
    song_ids_to_add: Vec<String>,
    song_indexes_to_remove: Vec<u32>,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    let mut extra: Vec<(&str, &str)> = vec![("playlistId", playlist_id.as_str())];
    let name_str = name.unwrap_or_default();
    if !name_str.is_empty() { extra.push(("name", name_str.as_str())); }
    for sid in &song_ids_to_add { extra.push(("songIdToAdd", sid.as_str())); }
    let index_strs: Vec<String> = song_indexes_to_remove.iter().map(|i| i.to_string()).collect();
    for idx in &index_strs { extra.push(("songIndexToRemove", idx.as_str())); }

    let url = build_subsonic_url(&cfg.url, "updatePlaylist", &cfg.username, &cfg.password, &extra);
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)
}

/// Delete a playlist.
#[tauri::command]
pub async fn subsonic_delete_playlist(
    id: String,
    state: tauri::State<'_, SubsonicState>,
) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    let url = build_subsonic_url(
        &cfg.url, "deletePlaylist", &cfg.username, &cfg.password, &[("id", id.as_str())],
    );
    let resp = client().get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
    let body: SubsonicResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    check_ok(&body.inner)
}
