// cli playback control flags (--play, --next, etc.)
//
// only takes effect when the app is already running and has a live queue/session
// cold start is intentionally a no op since we don't have anything to do '--next' to
//
// reuse integrations::smtc's existing SmtcEvent +
// "smtc://event" channel
//
// as more flags get added (seek, volume, queue actions, etc.), add a new match arm in handle()
// flags that don't map to an existing SmtcEvent can emit their own "cli://<name>" event instead

use tauri::{AppHandle, Emitter};

use crate::integrations::smtc::SmtcEvent;

/// handles one cli argument
/// returns true if it was a recognized flag
/// unrecognized arguments (file paths, unrelated flags) are left untouched
/// callers should try other handlers (deep links, file associations, etc.)
pub fn handle(app_handle: &AppHandle, arg: &str) -> bool {
    if let Some(event) = parse_playback_flag(arg) {
        tracing::info!("CLI flag {arg:?} -> {event:?}");
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