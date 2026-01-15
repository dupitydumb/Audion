use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowStartMode {
    Normal,
    Maximized,
    Minimized,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowConfig {
    pub start_mode: WindowStartMode,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            start_mode: WindowStartMode::Normal,
        }
    }
}

fn get_config_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("window.json"))
}

pub fn load_window_config(app_handle: &AppHandle) -> WindowConfig {
    if let Some(config_path) = get_config_path(app_handle) {
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
    }
    WindowConfig::default()
}

pub fn save_window_config(app_handle: &AppHandle, config: &WindowConfig) -> Result<(), String> {
    if let Some(config_path) = get_config_path(app_handle) {
        if let Some(parent) = config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(config_path, content).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Failed to resolve app data directory".to_string())
    }
}

#[tauri::command]
pub fn get_window_start_mode(app_handle: AppHandle) -> WindowStartMode {
    load_window_config(&app_handle).start_mode
}

#[tauri::command]
pub fn set_window_start_mode(app_handle: AppHandle, mode: WindowStartMode) -> Result<(), String> {
    let mut config = load_window_config(&app_handle);
    config.start_mode = mode;
    save_window_config(&app_handle, &config)
}
