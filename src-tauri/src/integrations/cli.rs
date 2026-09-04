// cli playback control flags (--play, --next, etc.)
//
// works both when the app is already running (single instance forwards the arg here, smtc://event listener is live)
// and on cold start: the queue's current track is restored from persisted state independently of this module (see persist.ts / initializeFromPersistedState)
//
// reuse integrations::smtc's existing SmtcEvent +
// "smtc://event" channel
//
// as more flags get added (seek, volume, queue actions, etc.), add a new match arm in handle()
// flags that don't map to an existing SmtcEvent can emit their own "cli://<name>" event instead

use tauri::{AppHandle, Emitter, Manager};

use crate::integrations::smtc::SmtcEvent;

pub struct PendingCliAction(pub std::sync::Mutex<Option<SmtcEvent>>);

#[tauri::command]
pub fn get_pending_cli_action(state: tauri::State<'_, PendingCliAction>) -> Option<SmtcEvent> {
    let mut pending = state.0.lock().unwrap();
    pending.take()
}

/// handles one cli argument
/// returns true if it was a recognized flag
/// unrecognized arguments (file paths, unrelated flags) are left untouched
/// callers should try other handlers (deep links, file associations, etc.)
pub fn handle(app_handle: &AppHandle, arg: &str) -> bool {
    if let Some(event) = parse_playback_flag(arg) {
        tracing::info!("CLI flag {arg:?} -> {event:?}");
        // always stash it => covers the cold start race
        // emit still fires for the already running case where the listener is live
        if let Some(pending_state) = app_handle.try_state::<PendingCliAction>() {
            *pending_state.0.lock().unwrap() = Some(event.clone());
        }
        let _ = app_handle.emit("smtc://event", &event);
        return true;
    }

    false
}

fn parse_playback_flag(flag: &str) -> Option<SmtcEvent> {
    Some(match flag {
        "--play" => SmtcEvent::Play,
        "--pause" => SmtcEvent::Pause,
        "--toggle" | "--play-pause" => SmtcEvent::Toggle,
        "--next" => SmtcEvent::Next,
        "--previous" | "--prev" => SmtcEvent::Previous,
        "--stop" => SmtcEvent::Stop,
        _ => return None,
    })
}