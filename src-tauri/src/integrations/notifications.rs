// native os notifications, bypassing tauri-plugin-notification
// dumb module
//
// mac/linux go through notify_rust directly
// windows bypasses notify_rust too and calls tauri_winrt_notification directly
// since notify_rust's windows backend can not support hero image
//
// fires a tauri event when the user interacts with the notification
// the frontend decides what to do with it

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// one action button on the notification
/// action_id comes back as is in the notification-action event when clicked
#[derive(Debug, Clone, Deserialize)]
pub struct NotificationAction {
    pub action_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShowNotificationOptions {
    pub id: String,
    pub title: String,
    pub body: String,
    /// absolute path to an image file e.g. from save_notification_image
    /// windows: shown as a small circular/square icon image beside the text by default
    /// large hero banner if use_hero is true
    /// linux/mac: shown as the notification image (no separate placements there)
    pub image_path: Option<String>,
    /// windows only. false (default): small image next to the text
    /// true: large hero banner above the text
    #[serde(default)]
    pub use_hero: bool,
    /// windows only, and only when use_hero is false
    /// "square" (default) or "circle" => how the small image beside the text is cropped
    #[serde(default = "default_icon_crop")]
    pub icon_crop: String,
    #[serde(default)]
    pub actions: Vec<NotificationAction>,
}

fn default_icon_crop() -> String {
    "square".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationActionEvent {
    pub id: String,
    /// the clicked action's action_id
    /// "default" if the notification body itself was clicked
    /// "__closed" if it was dismissed/timed out
    ///
    /// windows quirk: notify_rust's windows backend can't tell a body click apart from a dismiss/timeout
    /// both report as "__closed" there
    /// linux and mac report "default" for a body click
    pub action: String,
}

#[cfg(target_os = "macos")]
fn ensure_mac_notification_authorized() {
    // UNUserNotificationCenter
    // (modern backend, enabled via the preview-macos-un feature)
    // requires the app to have requested and been granted authorization before it will deliver anything
    // only needs to happen once per app launch
    use std::sync::Once;
    static AUTH_ONCE: Once = Once::new();
    AUTH_ONCE.call_once(|| {
        if let Err(e) = notify_rust::request_auth_blocking() {
            tracing::warn!(
                "macOS notification authorization request failed (dev builds without a \
                 signed .app bundle may not have a valid bundle identifier for this): {e:?}"
            );
        }
    });
}

// tauri_winrt_notification builds the image src as a raw, unescaped 'file:///{path}' string (see its lib.rs)
// no percent encoding
// if the windows username contains a space, the resulting URI is malformed and windows silently drops just the image
//
// converting to the legacy short (8.3) path form 
// guarantees no spaces or unicode
#[cfg(target_os = "windows")]
fn to_short_path(path: &str) -> String {
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; 260];

    // 'wide' is null-terminated
    // buf is passed as a slice so its length is the buffer capacity => the call can't write past it
    let len = unsafe { GetShortPathNameW(windows::core::PCWSTR(wide.as_ptr()), Some(&mut buf)) };

    if len == 0 {
        tracing::warn!(
            "GetShortPathNameW failed for notification image path {path:?} ({:?}); \
             falling back to the original path, which may fail to render if it \
             contains spaces or unicode",
            windows::core::Error::from_win32()
        );
        return path.to_string();
    }
    if len as usize > buf.len() {
        // Buffer was too small on the first try; retry with the exact size
        buf = vec![0u16; len as usize];
        let len2 = unsafe { GetShortPathNameW(windows::core::PCWSTR(wide.as_ptr()), Some(&mut buf)) };
        if len2 == 0 || len2 as usize > buf.len() {
            tracing::warn!(
                "GetShortPathNameW retry failed for notification image path {path:?}; \
                 falling back to the original path"
            );
            return path.to_string();
        }
        return String::from_utf16_lossy(&buf[..len2 as usize]);
    }

    String::from_utf16_lossy(&buf[..len as usize])
}

/// validates the image exists and converts it to a short path
/// returns None (and logs why) if the image should be skipped
#[cfg(target_os = "windows")]
fn resolve_image_path(path: &str) -> Option<String> {
    if !std::path::Path::new(path).exists() {
        tracing::warn!(
            "Notification image path {path:?} does not exist on disk - skipping image"
        );
        return None;
    }
    let short = to_short_path(path);
    tracing::debug!("Notification image: {path:?} -> short path {short:?}");
    Some(short)
}

mod desktop_impl {
    use super::*;

    // windows: bypass notify_rust entirely and call tauri_winrt_notification directly
    // for access to hero images which notify_rust does not support
    #[cfg(target_os = "windows")]
    pub fn show(app: &AppHandle, opts: ShowNotificationOptions) -> Result<(), String> {
        use std::path::Path;
        use std::sync::mpsc::channel;
        use tauri_winrt_notification::{IconCrop, Toast};

        let app = app.clone();

        std::thread::spawn(move || {
            enum ToastResponse {
                Action(String),
                Default,
                Closed,
            }

            tracing::info!(
                "show_native_notification (windows): id={:?} title={:?} body={:?} \
                 image_path={:?} use_hero={} icon_crop={:?} actions={:?}",
                opts.id,
                opts.title,
                opts.body,
                opts.image_path,
                opts.use_hero,
                opts.icon_crop,
                opts.actions.iter().map(|a| &a.action_id).collect::<Vec<_>>()
            );

            let (tx, rx) = channel::<ToastResponse>();
            let tx_activated = tx.clone();
            let tx_dismissed = tx;

            // must match the AUMID
            // registered via SetCurrentProcessExplicitAppUserModelID in lib.rs
            let mut toast = Toast::new("com.audion.app")
                .title(&opts.title)
                .text1(&opts.body);

            match opts.image_path.as_deref().and_then(resolve_image_path) {
                Some(resolved) => {
                    let path = Path::new(&resolved);
                    toast = if opts.use_hero {
                        toast.hero(path, "")
                    } else {
                        let crop = if opts.icon_crop == "circle" {
                            IconCrop::Circular
                        } else {
                            IconCrop::Square
                        };
                        toast.icon(path, crop, "")
                    };
                }
                None => {
                    if opts.image_path.is_some() {
                        tracing::warn!(
                            "No usable image for notification {:?}; showing without one",
                            opts.id
                        );
                    }
                }
            }

            for action in &opts.actions {
                toast = toast.add_button(&action.label, &action.action_id);
            }

            let toast = toast
                .on_activated(move |action| {
                    let _ = tx_activated.send(match action {
                        Some(id) => ToastResponse::Action(id),
                        None => ToastResponse::Default,
                    });
                    Ok(())
                })
                .on_dismissed(move |_reason| {
                    let _ = tx_dismissed.send(ToastResponse::Closed);
                    Ok(())
                });

            if let Err(e) = toast.show() {
                tracing::error!(
                    "Failed to show native Windows toast for notification {:?}: {e:?}",
                    opts.id
                );
                return;
            }
            tracing::debug!("Toast shown for notification {:?}", opts.id);

            let action = match rx.recv() {
                Ok(ToastResponse::Action(id)) => id,
                Ok(ToastResponse::Default) => "default".to_string(),
                Ok(ToastResponse::Closed) | Err(_) => "__closed".to_string(),
            };
            tracing::debug!("Notification {:?} resolved with action {:?}", opts.id, action);

            let _ = app.emit(
                "notification-action",
                NotificationActionEvent { id: opts.id, action },
            );
        });

        Ok(())
    }

    // mac/linux: going through notify_rust
    #[cfg(not(target_os = "windows"))]
    pub fn show(app: &AppHandle, opts: ShowNotificationOptions) -> Result<(), String> {
        let app = app.clone();

        #[cfg(target_os = "macos")]
        ensure_mac_notification_authorized();

        // notify_rust's mac backend blocks on a response future to wait for the click/dismiss event
        // so this has to run off the command thread
        std::thread::spawn(move || {
            tracing::info!(
                "show_native_notification: id={:?} title={:?} body={:?} image_path={:?} actions={:?}",
                opts.id,
                opts.title,
                opts.body,
                opts.image_path,
                opts.actions.iter().map(|a| &a.action_id).collect::<Vec<_>>()
            );

            let mut notification = notify_rust::Notification::new();
            notification.summary(&opts.title).body(&opts.body);

            if let Some(path) = &opts.image_path {
                notification.image_path(path);
            }

            for action in &opts.actions {
                notification.action(&action.action_id, &action.label);
            }

            let handle = match notification.show() {
                Ok(handle) => {
                    tracing::debug!("Notification {:?} shown", opts.id);
                    handle
                }
                Err(e) => {
                    tracing::error!("Failed to show native notification {:?}: {e}", opts.id);
                    return;
                }
            };

            let id = opts.id.clone();
            handle.wait_for_action(move |action| {
                tracing::debug!("Notification {:?} resolved with action {:?}", id, action);
                let _ = app.emit(
                    "notification-action",
                    NotificationActionEvent {
                        id,
                        action: action.to_string(),
                    },
                );
            });
        });

        Ok(())
    }
}

#[tauri::command]
pub fn show_native_notification(
    app: AppHandle,
    options: ShowNotificationOptions,
) -> Result<(), String> {
    desktop_impl::show(&app, options)
}