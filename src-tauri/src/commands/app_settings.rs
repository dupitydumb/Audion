// shared settings file for backend config that must be read synchronously from backend (scanner, DB init/backfill)
//
// is meant to hold every such setting in ONE 

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// ordered artist name delimiter rules used by scanner::artist_parser
/// index 0 = highest priority
/// see that module's doc comment for exact details
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ArtistSplitRules {
    pub delimiters: Vec<String>,
}

impl Default for ArtistSplitRules {
    fn default() -> Self {
        Self {
            // matches scanner::artist_parser::DEFAULT_DELIMITERS
            delimiters: vec!["&".to_string(), " and ".to_string(), ",".to_string()],
        }
    }
}

/// re exported so frontend facing command signatures below can reference it as commands::app_settings::AlbumArtistMode
/// the type itself is in db::models
/// so db:: code (get_or_create_album, db::artists cache) can consult it without depending on the commands module
pub use crate::db::models::AlbumArtistMode;

/// top level settings file schema
/// add new sections here as #[serde(default)] fields so old settings files on disk deserialize fine after an upgrade
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub artist_split_rules: ArtistSplitRules,
    #[serde(default)]
    pub album_artist_mode: AlbumArtistMode,
}

fn get_config_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("app_settings.json"))
}

pub fn load_app_settings(app_handle: &AppHandle) -> AppSettings {
    if let Some(config_path) = get_config_path(app_handle) {
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(settings) = serde_json::from_str(&content) {
                    return settings;
                }
            }
        }
    }
    AppSettings::default()
}

pub fn save_app_settings(app_handle: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    if let Some(config_path) = get_config_path(app_handle) {
        if let Some(parent) = config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())
    } else {
        Err("Failed to resolve app data directory".to_string())
    }
}

// tauri commands =============================================================

#[tauri::command]
pub fn get_artist_split_rules(app_handle: AppHandle) -> ArtistSplitRules {
    load_app_settings(&app_handle).artist_split_rules
}

/// saves the new rules only
/// does not re derive existing track_artists / album_artists rows => those were split under the old rules
/// call resplit_all_artists (db::artists) afterward from the frontend so stale splits don't linger until the next full rescan
#[tauri::command]
pub fn set_artist_split_rules(app_handle: AppHandle, rules: ArtistSplitRules) -> Result<(), String> {
    let mut settings = load_app_settings(&app_handle);
    settings.artist_split_rules = rules.clone();
    save_app_settings(&app_handle, &settings)?;
    // refresh the process wide cache so scans/syncs started right after this call use the new rules without needing an app restart
    crate::scanner::artist_parser::set_active_delimiters(rules.delimiters);
    Ok(())
}

#[tauri::command]
pub fn get_album_artist_mode(app_handle: AppHandle) -> AlbumArtistMode {
    load_app_settings(&app_handle).album_artist_mode
}

#[tauri::command]
pub fn set_album_artist_mode(app_handle: AppHandle, mode: AlbumArtistMode) -> Result<(), String> {
    let mut settings = load_app_settings(&app_handle);
    settings.album_artist_mode = mode;
    save_app_settings(&app_handle, &settings)?;
    crate::db::artists::set_active_album_artist_mode(mode);
    Ok(())
}

/// re derive track_artists (and, if the album artist mode is tag based, album_artists)
/// for the whole library using whatever rules/mode are currently active
/// call this right after set_artist_split_rules or set_album_artist_mode
/// so existing rows don't linger stale until the next full rescan
///
/// NOTE: this only re splits already stored albums.artist / tracks.artist strings
/// it does not re decide which track's artist wins for first track mode, and does not re read album artist tags from disk for tag mode
/// that is decided at scan time in db::tracks::get_or_create_album
/// switching AlbumArtistMode fully for existing albums requires a rescan
#[tauri::command]
pub fn resplit_all_artists(db: tauri::State<'_, crate::db::Database>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let track_count =
        crate::db::artists::resplit_all_track_artists(&conn).map_err(|e| e.to_string())?;
    Ok(track_count)
}
