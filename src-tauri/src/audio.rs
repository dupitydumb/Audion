pub mod dsp;
pub mod mod_types;
pub mod sources;
pub mod symphonia;
pub mod opus;
pub mod resampler;
pub mod engine;
pub mod worker;
pub mod player;
pub mod gated;
pub mod dual_track;
pub mod gated_worker;
pub mod decision;
pub mod directive;

#[cfg(test)]
mod tests_native_playback;

// Re-export key types that lib.rs / other modules use
pub use dsp::{EqSettings};
pub use mod_types::{AudioDeviceInfo, DeviceList, AudioEvent};
pub use worker::PlaybackStateSync;
pub use player::PlayerStateSync;

// Tauri Commands + resolve_audio_path helper defined directly here
// so that Tauri's generate_handler! macro can resolve the cmd helpers properly.

use std::sync::Mutex;
use tauri::{State, Manager};
use crate::db::Database;
use crate::sync::SyncState;

use worker::AudioCommand;

async fn resolve_audio_path(
    path: &str,
    track_id: Option<i64>,
    db: &Database,
    sync_state: &SyncState,
) -> Result<String, String> {
    use rusqlite::OptionalExtension;

    let track_opt = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, path, source_type, local_src, format FROM tracks WHERE path = ?1",
            rusqlite::params![path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let is_server_track = if let Some((_, _, ref source_type, _, _)) = track_opt {
        source_type.as_deref() == Some("server")
    } else {
        path.starts_with("music/")
    };

    if !is_server_track {
        return Ok(path.to_string());
    }

    let (tid, track_path, local_src, format) = match track_opt {
        Some((db_id, db_path, _, db_local_src, db_format)) => {
            (Some(db_id), db_path, db_local_src, db_format)
        }
        None => {
            (None, path.to_string(), None, None)
        }
    };

    if let Some(ref local_path) = local_src {
        if std::path::Path::new(local_path).exists() {
            return Ok(local_path.clone());
        }
    }

    let app_handle = sync_state.app_handle.as_ref()
        .ok_or_else(|| "App handle not found in SyncState".to_string())?;
    
    let app_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    let cache_dir = app_dir.join("cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }

    let ext = std::path::Path::new(&track_path)
        .extension()
        .and_then(|s| s.to_str())
        .or(format.as_deref())
        .unwrap_or("mp3");

    let cache_id = match tid {
        Some(id) => id.to_string(),
        None => {
            if let Some(id) = track_id {
                id.to_string()
            } else {
                return Err("No track ID available to resolve server track".to_string());
            }
        }
    };

    let cache_path = cache_dir.join(format!("{}.{}", cache_id, ext));

    if !cache_path.exists() {
        tracing::info!("Downloading track {} from server to {:?}", cache_id, cache_path);
        
        let server_url = sync_state.server_url.lock().unwrap().clone();
        let token = crate::sync::auth::get_access_token(db)?
            .ok_or_else(|| "Not logged in to server".to_string())?;

        let server_track_id = match tid {
            Some(local_id) => {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                crate::db::queries::get_server_id(&conn, &format!("lib_{}", local_id), "library_track")
                    .map_err(|e| e.to_string())?
                    .or_else(|| {
                        crate::db::queries::get_server_id(&conn, &format!("liked_{}", local_id), "liked_track")
                            .ok()
                            .flatten()
                    })
                    .unwrap_or_else(|| local_id.to_string())
            }
            None => {
                if let Some(id) = track_id {
                    id.to_string()
                } else {
                    return Err("No track ID available to resolve server track".to_string());
                }
            }
        };

        let client = reqwest::Client::new();
        let stream_url = format!("{}/api/tracks/{}/stream", server_url, server_track_id);
        
        let mut resp = client.get(&stream_url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to server: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned error playing track ({}): {}", resp.status(), resp.status().canonical_reason().unwrap_or("Unknown")));
        }

        use tokio::io::AsyncWriteExt;
        let mut file: tokio::fs::File = tokio::fs::File::create(&cache_path).await
            .map_err(|e: std::io::Error| format!("Failed to create cache file: {}", e))?;

        while let Some(chunk) = resp.chunk().await.map_err(|e: reqwest::Error| e.to_string())? {
            file.write_all(&chunk).await.map_err(|e: std::io::Error| e.to_string())?;
        }
        file.flush().await.map_err(|e: std::io::Error| e.to_string())?;

        if let Some(local_id) = tid {
            let cache_path_str = cache_path.to_string_lossy().to_string();
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET local_src = ?1 WHERE id = ?2",
                rusqlite::params![cache_path_str, local_id],
            ).ok();
        }
    }

    Ok(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn audio_play(
    path: String,
    track_id: Option<i64>,
    replay_gain_db: Option<f32>,
    state: State<'_, PlaybackStateSync>,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    let resolved_path = resolve_audio_path(&path, track_id, &db, &sync_state).await?;
    state.send(AudioCommand::Play(resolved_path, replay_gain_db))
}

#[tauri::command]
pub async fn audio_preload(
    path: String,
    track_id: Option<i64>,
    replay_gain_db: Option<f32>,
    crossfade_seconds: u32,
    state: State<'_, PlaybackStateSync>,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    tracing::info!("[AUDIO] Preload requested: {} (crossfade: {}s)", path, crossfade_seconds);

    let resolved_path = resolve_audio_path(&path, track_id, &db, &sync_state).await?;
    state.send(AudioCommand::Preload(resolved_path, replay_gain_db, crossfade_seconds))
}

#[tauri::command]
pub fn audio_pause(state: State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Pause)
}

#[tauri::command]
pub fn audio_resume(state: State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Resume)
}

#[tauri::command]
pub fn audio_stop(state: State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Stop)
}

#[tauri::command]
pub fn audio_seek(position: f64, state: State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Seek(position))
}

#[tauri::command]
pub fn audio_set_volume(
    volume: f32,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetVolume(volume))
}

#[tauri::command]
pub fn audio_set_eq(
    settings: EqSettings,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetEq(settings))
}

#[tauri::command]
pub fn audio_set_repeat_one(
    enabled: bool,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetRepeatOne(enabled))
}

#[tauri::command]
pub fn audio_set_replay_gain_enabled(
    enabled: bool,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetReplayGainEnabled(enabled))
}

#[tauri::command]
pub fn audio_set_limiter_enabled(
    enabled: bool,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetLimiterEnabled(enabled))
}

#[tauri::command]
pub fn native_audio_available(_state: State<'_, PlaybackStateSync>) -> bool {
    true
}

#[tauri::command]
pub fn audio_set_crossfade_seconds(
    seconds: f64,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    let secs = seconds.max(0.0).round() as u32;
    state.send(AudioCommand::SetCrossfadeSeconds(secs))
}

#[tauri::command]
pub fn audio_trigger_crossfade(
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::TriggerCrossfade)
}

#[tauri::command]
pub fn audio_list_output_devices() -> Result<DeviceList, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let all_devices: Vec<_> = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?
        .collect();
    let default_device_id = host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());
    let devices = all_devices.iter().filter_map(|d| {
        let id = d.id().ok()?.to_string();
        let desc = d.description().ok()?;
        let is_default = Some(&id) == default_device_id.as_ref();
        Some(AudioDeviceInfo {
            id,
            name: desc.name().to_string(),
            manufacturer: desc.manufacturer().map(|s| s.to_string()),
            driver: desc.driver().map(|s| s.to_string()),
            device_type: desc.device_type().to_string(),
            interface_type: desc.interface_type().to_string(),
            address: desc.address().map(|s| s.to_string()),
            extended: desc.extended().to_vec(),
            is_default,
        })
    }).collect();
    Ok(DeviceList { devices })
}

#[tauri::command]
pub fn audio_get_device_info(
    state: State<'_, PlaybackStateSync>,
) -> Result<DeviceList, String> {
    state
        .device_list
        .lock()
        .map(|dl| dl.clone())
        .map_err(|_| "Device list lock poisoned".into())
}

#[tauri::command]
pub fn audio_set_output_device(
    device_id: Option<String>,
    state: State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetOutputDevice(device_id))
}

#[tauri::command]
pub async fn audio_resolve_path(
    path: String,
    track_id: Option<i64>,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<String, String> {
    resolve_audio_path(&path, track_id, &db, &sync_state).await
}

#[tauri::command]
pub async fn audio_get_stream_url(
    path: String,
    track_id: Option<i64>,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<String, String> {
    use rusqlite::OptionalExtension;

    let track_opt = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, path, source_type FROM tracks WHERE path = ?1",
            rusqlite::params![path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let (tid, _) = match track_opt {
        Some((db_id, db_path, _)) => (Some(db_id), db_path),
        None => (None, path.to_string()),
    };

    let server_url = sync_state.server_url.lock().unwrap().clone();
    let token = crate::sync::auth::get_access_token(&db)?
        .ok_or_else(|| "Not logged in to server".to_string())?;

    let server_track_id = match tid {
        Some(local_id) => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            crate::db::queries::get_server_id(&conn, &format!("lib_{}", local_id), "library_track")
                .map_err(|e| e.to_string())?
                .or_else(|| {
                    crate::db::queries::get_server_id(&conn, &format!("liked_{}", local_id), "liked_track")
                        .ok()
                        .flatten()
                })
                .unwrap_or_else(|| local_id.to_string())
        }
        None => {
            if let Some(id) = track_id {
                id.to_string()
            } else {
                return Err("No track ID available".to_string());
            }
        }
    };

    Ok(format!("{}/api/tracks/{}/stream?token={}", server_url, server_track_id, token))
}
