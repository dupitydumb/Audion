// =============================================================================
// SMTC / os media controls (via souvlaki)
// =============================================================================
// design: this module is intentionally dumb
// player.ts is the main mastermind. it pushes metadata/playback
// state in here, and reads transport events back out via smtc://event
//
// flow:
//  player.ts invoke=> smtc_set_metadata / smtc_set_playback => souvlaki
//  souvlaki MediaControlEvent=> attach callback emit=> smtc://event => player.ts
//
// player.ts then routes incoming events into the same functions it
// already calls for keyboard shortcuts / media keys
// =============================================================================

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
    PlatformConfig, SeekDirection,
};
use serde::Serialize;

// =============================================================================
// STATE => lives on the main thread, holds the MediaControls handle
// =============================================================================

pub struct SmtcState {
    controls: Mutex<Option<MediaControls>>,
}

impl SmtcState {
    pub fn uninitialized() -> Self {
        Self {
            controls: Mutex::new(None),
        }
    }
}

// =============================================================================
// EVENTS => serialisable, sent to player.ts
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SmtcEvent {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Stop,
    SeekForward,
    SeekBackward,
    SeekByForward { secs: f64 },
    SeekByBackward { secs: f64 },
    SetPosition { secs: f64 },
    // MPRIS only: the desktop's volume slider for this player was moved
    // player.ts must apply this to actual playback and ack it back via
    // smtc_set_volume, or the slider goes out of sync with real volume
    SetVolume { level: f64 },
    // MPRIS/macOS: the desktop is asking the app to shut down
    // routed directly to TitleBar.svelte via "app://quit-requested"
}

fn map_event(evt: MediaControlEvent) -> Option<SmtcEvent> {
    match evt {
        MediaControlEvent::Play => Some(SmtcEvent::Play),
        MediaControlEvent::Pause => Some(SmtcEvent::Pause),
        MediaControlEvent::Toggle => Some(SmtcEvent::Toggle),
        MediaControlEvent::Next => Some(SmtcEvent::Next),
        MediaControlEvent::Previous => Some(SmtcEvent::Previous),
        MediaControlEvent::Stop => Some(SmtcEvent::Stop),
        MediaControlEvent::Seek(SeekDirection::Forward) => Some(SmtcEvent::SeekForward),
        MediaControlEvent::Seek(SeekDirection::Backward) => Some(SmtcEvent::SeekBackward),
        MediaControlEvent::SeekBy(SeekDirection::Forward, d) => {
            Some(SmtcEvent::SeekByForward { secs: d.as_secs_f64() })
        }
        MediaControlEvent::SeekBy(SeekDirection::Backward, d) => {
            Some(SmtcEvent::SeekByBackward { secs: d.as_secs_f64() })
        }
        MediaControlEvent::SetPosition(MediaPosition(d)) => {
            Some(SmtcEvent::SetPosition { secs: d.as_secs_f64() })
        }
        MediaControlEvent::SetVolume(level) => Some(SmtcEvent::SetVolume { level }),
        // Raise is intercepted directly in init()'s attach closure (focuses
        // the window) and never reaches here
        // OpenUri: no Audion equivalent
        // yet, silently ignored rather than emitted as noise
        // quit is handled in init not here
        _ => None,
    }
}

// =============================================================================
// INIT => call once, after the main window exists (needs HWND on Windows)
// =============================================================================

pub fn init(app_handle: AppHandle) -> Result<(), String> {
    let hwnd = get_hwnd(&app_handle)?;

    let config = PlatformConfig {
        display_name: "Audion",
        dbus_name: "audion",
        hwnd,
    };

    let mut controls = MediaControls::new(config).map_err(|e| format!("{:?}", e))?;

    let emit_handle = app_handle.clone();
    controls
        .attach(move |evt: MediaControlEvent| {
            // Raise (go to app on the SMTC thumbnail) is handled here not in player.ts
            if matches!(evt, MediaControlEvent::Raise) {
                if let Some(window) = emit_handle.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                return;
            }

            // Quit => emit directly to TitleBar.svelte
            // it is handled here not in map_event
            if matches!(evt, MediaControlEvent::Quit) {
                let _ = emit_handle.emit("app://quit-requested", ());
                return;
            }

            if let Some(smtc_evt) = map_event(evt) {
                if let Err(e) = emit_handle.emit("smtc://event", &smtc_evt) {
                    tracing::warn!("[SMTC] Failed to emit event: {}", e);
                }
            }
        })
        .map_err(|e| format!("{:?}", e))?;

    let state = app_handle.state::<SmtcState>();
    *state.controls.lock().map_err(|_| "SMTC lock poisoned".to_string())? = Some(controls);

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_hwnd(app_handle: &AppHandle) -> Result<Option<*mut std::ffi::c_void>, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let handle = window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;

    match handle.as_raw() {
        RawWindowHandle::Win32(h) => Ok(Some(h.hwnd.get() as *mut std::ffi::c_void)),
        _ => Err("Expected Win32 window handle".to_string()),
    }
}

#[cfg(not(target_os = "windows"))]
fn get_hwnd(_app_handle: &AppHandle) -> Result<Option<*mut std::ffi::c_void>, String> {
    Ok(None)
}

// =============================================================================
// COVER URL
// =============================================================================
// raw is the underlying source from player.ts: either a remote
// "http(s)" URL, or an absolute local filesystem path , never a webview asset://
// on Linux/macOS, the accepted form is unknown.full ladder of every
// plausible shape is tried, logging which one works so it can eventually
// be finalized to a single direct call like Windows was
// http URLs are unambiguous on all platforms and skip the ladder

fn percent_encode_path(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            segment
                .bytes()
                .map(|b| {
                    let is_unreserved = b.is_ascii_alphanumeric()
                        || matches!(b, b'-' | b'.' | b'_' | b'~' | b':');
                    if is_unreserved {
                        (b as char).to_string()
                    } else {
                        format!("%{:02X}", b)
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(target_os = "windows")]
fn set_metadata_with_cover(
    controls: &mut MediaControls,
    raw_cover: Option<&str>,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<Duration>,
) -> Result<(), String> {
    let cover = raw_cover.map(|raw| {
        if raw.starts_with("http://") || raw.starts_with("https://") {
            raw.to_string()
        } else {
            format!("file://{}", raw.replace('/', "\\"))
        }
    });
    controls
        .set_metadata(MediaMetadata {
            title: Some(title),
            artist,
            album,
            cover_url: cover.as_deref(),
            duration,
        })
        .map_err(|e| format!("{:?}", e))
}

#[cfg(not(target_os = "windows"))]
fn set_metadata_with_cover(
    controls: &mut MediaControls,
    raw_cover: Option<&str>,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<Duration>,
) -> Result<(), String> {
    let is_remote = raw_cover
        .map(|r| r.starts_with("http://") || r.starts_with("https://"))
        .unwrap_or(false);

    if raw_cover.is_none() || is_remote {
        return controls
            .set_metadata(MediaMetadata {
                title: Some(title),
                artist,
                album,
                cover_url: raw_cover,
                duration,
            })
            .map_err(|e| format!("{:?}", e));
    }

    let raw = raw_cover.unwrap();
    let fwd = raw.replace('\\', "/");
    let enc = percent_encode_path(&fwd);

    // once confirmed on Linux/macOS, finalize. TODO
    let candidates: &[(&str, String)] = &[
        ("3-slash fwd encoded", format!("file:///{}", enc)),
        ("3-slash fwd raw",     format!("file:///{}", fwd)),
        ("2-slash fwd encoded", format!("file://{}", enc)),
        ("2-slash fwd raw",     format!("file://{}", fwd)),
        ("bare fwd encoded",    enc.clone()),
        ("bare fwd raw",        fwd.clone()),
    ];

    for (label, candidate) in candidates {
        let result = controls.set_metadata(MediaMetadata {
            title: Some(title),
            artist,
            album,
            cover_url: Some(candidate.as_str()),
            duration,
        });
        match result {
            Ok(()) => {
                tracing::info!("[SMTC] cover_url candidate WORKED ({}): {:?}", label, candidate);
                return Ok(());
            }
            Err(e) => {
                tracing::warn!("[SMTC] cover_url candidate failed ({}): {:?} -> {:?}", label, candidate, e);
            }
        }
    }

    tracing::warn!("[SMTC] all cover_url candidates failed, setting metadata without cover");
    controls
        .set_metadata(MediaMetadata {
            title: Some(title),
            artist,
            album,
            cover_url: None,
            duration,
        })
        .map_err(|e| format!("{:?}", e))
}

// =============================================================================
// TAURI COMMANDS => called directly from player.ts
// =============================================================================

#[tauri::command]
pub fn smtc_set_metadata(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_secs: Option<f64>,
    cover_url: Option<String>, // raw path or http(s) URL . see set_metadata_with_cover
    state: tauri::State<'_, SmtcState>,
) -> Result<(), String> {
    let mut guard = state.controls.lock().map_err(|_| "SMTC lock poisoned".to_string())?;
    let controls = match guard.as_mut() {
        Some(c) => c,
        None => return Ok(()), // not initialized yet (e.g. SMTC unsupported/failed) => no-op
    };

    set_metadata_with_cover(
        controls,
        cover_url.as_deref(),
        title.as_str(),
        artist.as_deref(),
        album.as_deref(),
        duration_secs.map(Duration::from_secs_f64),
    )
}

#[tauri::command]
pub fn smtc_set_playback(
    status: String, // playing | paused | stopped
    position_secs: Option<f64>,
    state: tauri::State<'_, SmtcState>,
) -> Result<(), String> {
    let mut guard = state.controls.lock().map_err(|_| "SMTC lock poisoned".to_string())?;
    let controls = match guard.as_mut() {
        Some(c) => c,
        None => return Ok(()),
    };

    let progress = position_secs.map(|s| MediaPosition(Duration::from_secs_f64(s)));

    let playback = match status.as_str() {
        "playing" => MediaPlayback::Playing { progress },
        "paused" => MediaPlayback::Paused { progress },
        "stopped" => MediaPlayback::Stopped,
        other => return Err(format!("Unknown playback status: {}", other)),
    };

    controls.set_playback(playback).map_err(|e| format!("{:?}", e))
}

// MPRIS only ack: call this after applying the volume the os asked for
// (via a SetVolume MediaControlEvent). MediaControls::set_volume only
// exists in souvlaki's linux/MPRIS platform module. so the call must
// be cfg-gated
#[tauri::command]
pub fn smtc_set_volume(level: f64, state: tauri::State<'_, SmtcState>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let mut guard = state.controls.lock().map_err(|_| "SMTC lock poisoned".to_string())?;
        let controls = match guard.as_mut() {
            Some(c) => c,
            None => return Ok(()),
        };

        controls
            .set_volume(level.clamp(0.0, 1.0))
            .map_err(|e| format!("{:?}", e))?;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (level, &state); // no MPRIS volume property on Windows/macOS
    }

    Ok(())
}