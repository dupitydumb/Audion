use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri_plugin_autostart::ManagerExt;

/// managed app state. when true, the CloseRequested handler lets the window close
/// instead of prompting the frontend again
/// set right before we call window.close ourselves after persisting the last view
#[derive(Default)]
pub struct CloseConfirmed(pub AtomicBool);

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
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default)]
    pub minimize_to_tray: bool,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            start_mode: WindowStartMode::Normal,
            close_to_tray: false,
            minimize_to_tray: false,
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

#[tauri::command]
pub fn get_close_to_tray(app_handle: AppHandle) -> bool {
    load_window_config(&app_handle).close_to_tray
}

#[tauri::command]
pub fn set_close_to_tray(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = load_window_config(&app_handle);
    config.close_to_tray = enabled;
    save_window_config(&app_handle, &config)
}

#[tauri::command]
pub fn get_minimize_to_tray(app_handle: AppHandle) -> bool {
    load_window_config(&app_handle).minimize_to_tray
}

#[tauri::command]
pub fn set_minimize_to_tray(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = load_window_config(&app_handle);
    config.minimize_to_tray = enabled;
    save_window_config(&app_handle, &config)
}

// =============================================================================
// LAUNCH ON STARTUP (desktop only)
// =============================================================================
// backed by tauri-plugin-autostart, (registry
// key on windows, LaunchAgent plist on mac, .desktop file on linux)    =============================================================================

#[cfg(desktop)]
#[tauri::command]
pub fn get_autostart_enabled(app_handle: AppHandle) -> bool {
    app_handle.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(desktop)]
#[tauri::command]
pub fn set_autostart_enabled(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app_handle.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| e.to_string())
}

// =============================================================================
// CLOSE HANDSHAKE
// =============================================================================
// last-visited view is cached client-side only (see view.ts /
// localStorage)
// command exists purely so the frontend can perisist whatever it needs to persist and reply back to close for real
// see CloseRequested in lib.rs, which emits app://request-last-view and waits for this call
// with a timeout fallback in case the frontend never responds
// =============================================================================

#[tauri::command]
pub fn confirm_close(app_handle: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    confirm_close_and_close_window(&app_handle, &window)
}

/// shared by the command above and by timeout fallback in lib.rs
/// in case the frontend never responds
pub fn confirm_close_and_close_window(
    app_handle: &AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let confirmed = app_handle.state::<CloseConfirmed>();
    confirmed.0.store(true, Ordering::SeqCst);
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_island_window_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use std::ffi::c_void;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMNCRP_DISABLED, DWMWA_NCRENDERING_POLICY,
        };
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

        let handle = window
            .window_handle()
            .map_err(|e| format!("Failed to get raw window handle: {e}"))?;

        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = HWND(h.hwnd.get() as *mut c_void);

            unsafe {
                let policy = DWMNCRP_DISABLED.0;
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_NCRENDERING_POLICY,
                    &policy as *const _ as *const c_void,
                    std::mem::size_of_val(&policy) as u32,
                );
            }

            let scale_factor = window.scale_factor().unwrap_or(1.0);
            let px = (x as f64 * scale_factor).round() as i32;
            let py = (y as f64 * scale_factor).round() as i32;
            let pw = (width as f64 * scale_factor).round() as i32;
            let ph = (height as f64 * scale_factor).round() as i32;

            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    px,
                    py,
                    pw,
                    ph,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }
    Ok(())
}
