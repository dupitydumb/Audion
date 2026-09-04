// =============================================================================
// player.rs => the single owner of "what track is current / what's next"
//
// does not own audio timing or mixing
// (engine.rs's job, see AudioEngine::maybe_auto_crossfade for the native crossfade trigger)
// does not own HTML5 playback mechanics
// (stays entirely in player.ts / html5-audio.ts, since only the frontend can actually touch an <audio> element)
//
// it own: the queue/repeat/shuffle arithmetic that decides which track comes next,
// and a generation counter that guards every "advance" decision against being stomped by a stale, late-arriving report from a transition the user has already skipped past
// player.ts is a thin translator on the other side of this:
// it sends PlayerCommand, it applies whatever PlayerDirective comes back to the existing stores, and it still emits the exact same pluginEvents / store updates
// =============================================================================

use crossbeam::channel::{unbounded, Receiver, Sender};
use serde::{Deserialize, Serialize};
use tauri::{State, Emitter};

use super::mod_types::AudioEvent;

// =============================================================================
// Wire types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackRef {
    pub id: i64,
    pub path: String,
    /// tag/metadata duration in seconds, if known
    /// last-resort fallback
    /// (e.g. before a track has actually started decoding)
    /// never used for crossfade timing
    pub duration_secs: Option<f64>,
    pub is_streaming: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdvanceReason {
    /// user explicitly pressed next/previous, or picked a track directly
    UserNext,
    UserPrevious,
    /// native engine auto-crossfaded into the preloaded next track
    NativeAutoAdvance,
    /// native engine reported the track ended with nothing crossfaded
    /// (gapless hand-off or a plain hard stop e.g. crossfade is off, or the preload never became ready in time)
    NativeNaturalEnd,
    /// user picked a specific track directly
    UserDirectSelect,
    /// player.ts reports the HTML5 <audio> element completed its own crossfade transition
    Html5AutoAdvance,
    /// player.ts reports the HTML5 <audio> element's 'ended' event fired with no crossfade
    Html5NaturalEnd,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum PlayerDirective {
    Advance {
        generation: u64,
        reason: AdvanceReason,
        track: TrackRef,
        queue_index: usize,
    },
    /// nothing left to advance to (end of queue, repeat off)
    /// player.ts decides what to do with this
    /// (stop, or hand off to autoplay-from-library, which needs DB access player.rs doesn't have)
    QueueExhausted { generation: u64 },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum PlayerCommand {
    /// called whenever the queue array, index, repeat mode, or shuffle order changes in JS
    /// reorders, add/remove, toggling shuffle/repeat, or the user picking a track directly
    /// this is the read-only mirror: JS still owns the actual array
    SyncQueue {
        tracks: Vec<TrackRef>,
        index: usize,
        repeat: RepeatMode,
        shuffle: bool,
        shuffled_indices: Vec<usize>,
        shuffled_index: usize,
    },
    /// user-initiated skip
    /// player.ts owns the "restart current track vs go back" position check for Previous
    /// by the time this arrives, that decision has already been made and this really does mean "move the queue index"
    Advance { direction: AdvanceDirection },
    /// user picked a specific track directly
    /// this just tells player.rs which queue slot is now current so future engine events resolve against the right generation/track
    SetCurrent { index: usize },
    /// player.ts reports that native playback of track_id has actually started
    /// (after nativeAudioPlay resolved) for the given directive generation,
    /// so player.rs can correlate future engine events with the right track
    NativeStarted { generation: u64, track_id: i64 },
    /// native engine auto-advanced (crossfade completed) or the track finished naturally
    NativeAdvanced,
    NativeFinished,
    /// HTML5 side equivalents, reported by player.ts since only it can observe them
    Html5CrossfadeCommitted,
    Html5Ended,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdvanceDirection {
    Next,
    Previous,
}

// =============================================================================
// Internal state => lives entirely on the player actor thread
// =============================================================================

struct PlayerState {
    tracks: Vec<TrackRef>,
    index: usize,
    repeat: RepeatMode,
    shuffle: bool,
    shuffled_indices: Vec<usize>,
    shuffled_index: usize,
    generation: u64,
    /// Track id that generation 'generation' refers to, once player.ts has acked it started
    /// only for debug logging
    /// the real staleness guard is the generation counter itself
    current_track_id: Option<i64>,
}

impl PlayerState {
    fn new() -> Self {
        Self {
            tracks: Vec::new(),
            index: 0,
            repeat: RepeatMode::Off,
            shuffle: false,
            shuffled_indices: Vec::new(),
            shuffled_index: 0,
            generation: 0,
            current_track_id: None,
        }
    }

    fn compute_next_index(&self, forward: bool) -> Option<usize> {
        if self.tracks.is_empty() {
            return None;
        }

        if self.shuffle {
            if self.shuffled_indices.is_empty() {
                return None;
            }
            let len = self.shuffled_indices.len() as i64;
            let mut pos = self.shuffled_index as i64 + if forward { 1 } else { -1 };
            if pos >= len {
                if self.repeat == RepeatMode::All {
                    pos = 0;
                } else {
                    return None;
                }
            } else if pos < 0 {
                if self.repeat == RepeatMode::All {
                    pos = len - 1;
                } else {
                    return None;
                }
            }
            self.shuffled_indices.get(pos as usize).copied()
        } else {
            let len = self.tracks.len() as i64;
            let mut idx = self.index as i64 + if forward { 1 } else { -1 };
            if idx >= len {
                if self.repeat == RepeatMode::All {
                    idx = 0;
                } else {
                    return None;
                }
            } else if idx < 0 {
                if self.repeat == RepeatMode::All {
                    idx = len - 1;
                } else {
                    return None;
                }
            }
            Some(idx as usize)
        }
    }

    fn advance(&mut self, forward: bool) -> Option<(usize, TrackRef)> {
        let next_idx = self.compute_next_index(forward)?;
        let track = self.tracks.get(next_idx)?.clone();

        if self.shuffle {
            let shuf_pos = self.shuffled_index as i64 + if forward { 1 } else { -1 };
            let len = self.shuffled_indices.len() as i64;
            self.shuffled_index = if shuf_pos >= len {
                0
            } else if shuf_pos < 0 {
                (len - 1).max(0) as usize
            } else {
                shuf_pos as usize
            };
        }
        self.index = next_idx;

        Some((next_idx, track))
    }
}

// =============================================================================
// Public handle => what lib.rs / Tauri commands talk to
// =============================================================================

pub struct PlayerStateSync {
    command_tx: Sender<PlayerCommand>,
}

impl PlayerStateSync {
    pub fn send(&self, cmd: PlayerCommand) -> Result<(), String> {
        self.command_tx.send(cmd).map_err(|e| e.to_string())
    }

    /// spawns the actor thread
    /// engine_events is the fan-out receiver fed by PlaybackStateSync's worker thread
    /// (see worker.rs's 'emit' closure)
    /// every AudioEvent the native engine produces also lands here,
    /// so this actor can react to TrackAdvanced/TrackFinished without touching engine internals directly
    pub fn new(app_handle: tauri::AppHandle, engine_events: Receiver<AudioEvent>) -> Self {
        let (command_tx, command_rx) = unbounded::<PlayerCommand>();

        std::thread::spawn(move || {
            let mut state = PlayerState::new();

            let emit_directive = |directive: &PlayerDirective| {
                if let Err(e) = app_handle.emit("player://event", directive) {
                    tracing::warn!("[PLAYER] Failed to emit directive: {}", e);
                }
            };

            let do_advance = |state: &mut PlayerState, forward: bool, reason: AdvanceReason| {
                match state.advance(forward) {
                    Some((idx, track)) => {
                        state.generation += 1;
                        state.current_track_id = Some(track.id);
                        emit_directive(&PlayerDirective::Advance {
                            generation: state.generation,
                            reason,
                            track,
                            queue_index: idx,
                        });
                    }
                    None => {
                        state.generation += 1;
                        state.current_track_id = None;
                        emit_directive(&PlayerDirective::QueueExhausted {
                            generation: state.generation,
                        });
                    }
                }
            };

            loop {
                crossbeam::select! {
                    recv(command_rx) -> msg => {
                        let cmd = match msg {
                            Ok(c) => c,
                            Err(_) => break, // sender dropped, app shutting down
                        };

                        match cmd {
                            PlayerCommand::SyncQueue { tracks, index, repeat, shuffle, shuffled_indices, shuffled_index } => {
                                state.tracks = tracks;
                                state.index = index.min(state.tracks.len().saturating_sub(1));
                                state.repeat = repeat;
                                state.shuffle = shuffle;
                                state.shuffled_indices = shuffled_indices;
                                state.shuffled_index = shuffled_index;
                            }

                            PlayerCommand::Advance { direction } => {
                                let (forward, reason) = match direction {
                                    AdvanceDirection::Next => (true, AdvanceReason::UserNext),
                                    AdvanceDirection::Previous => (false, AdvanceReason::UserPrevious),
                                };
                                do_advance(&mut state, forward, reason);
                            }

                            PlayerCommand::SetCurrent { index } => {
                                if let Some(track) = state.tracks.get(index).cloned() {
                                    state.index = index;
                                    if state.shuffle {
                                        if let Some(pos) = state.shuffled_indices.iter().position(|&i| i == index) {
                                            state.shuffled_index = pos;
                                        }
                                    }
                                    state.generation += 1;
                                    state.current_track_id = Some(track.id);
                                    emit_directive(&PlayerDirective::Advance {
                                        generation: state.generation,
                                        reason: AdvanceReason::UserDirectSelect,
                                        track,
                                        queue_index: index,
                                    });
                                }
                            }

                            PlayerCommand::NativeStarted { generation, track_id } => {
                                if generation != state.generation {
                                    tracing::debug!(
                                        "[PLAYER] Discarding stale NativeStarted (gen {} != current {})",
                                        generation, state.generation
                                    );
                                    continue;
                                }
                                state.current_track_id = Some(track_id);
                            }

                            PlayerCommand::NativeAdvanced => {
                                do_advance(&mut state, true, AdvanceReason::NativeAutoAdvance);
                            }

                            PlayerCommand::NativeFinished => {
                                // engine already loops repeat-one internally (see set_repeat_one)
                                // a natural-end report should only reach us here for repeat-off/repeat-all "advance forward" is the correct response
                                // repeat-one looping back to the same track is handled entirely inside the engine and never surfaces a TrackFinished at all
                                do_advance(&mut state, true, AdvanceReason::NativeNaturalEnd);
                            }

                            PlayerCommand::Html5CrossfadeCommitted => {
                                do_advance(&mut state, true, AdvanceReason::Html5AutoAdvance);
                            }

                            PlayerCommand::Html5Ended => {
                                do_advance(&mut state, true, AdvanceReason::Html5NaturalEnd);
                            }
                        }
                    }

                    recv(engine_events) -> msg => {
                        let evt = match msg {
                            Ok(e) => e,
                            Err(_) => continue, // audio thread not up yet / restarting
                        };
                        // only the two "a track transition definitely happened" events matter
                        // everything else (StateChanged, Error, DeviceListChanged) is still forwarded to the frontend via audio://event by the worker thread itself
                        // player.rs doesn't need to see those to make advance decisions, so it doesn't re-emit them
                        match evt {
                            AudioEvent::TrackAdvanced { .. } => {
                                // the engine already decided "when" 
                                // (sample-accurate, via maybe_auto_crossfade)
                                // player.rs only decides "what's next"
                                do_advance(&mut state, true, AdvanceReason::NativeAutoAdvance);
                            }
                            AudioEvent::TrackFinished { .. } => {
                                do_advance(&mut state, true, AdvanceReason::NativeNaturalEnd);
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Self { command_tx }
    }
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub fn player_sync_queue(
    tracks: Vec<TrackRef>,
    index: usize,
    repeat: RepeatMode,
    shuffle: bool,
    shuffled_indices: Vec<usize>,
    shuffled_index: usize,
    state: State<'_, PlayerStateSync>,
) -> Result<(), String> {
    state.send(PlayerCommand::SyncQueue { tracks, index, repeat, shuffle, shuffled_indices, shuffled_index })
}

#[tauri::command]
pub fn player_advance(direction: AdvanceDirection, state: State<'_, PlayerStateSync>) -> Result<(), String> {
    state.send(PlayerCommand::Advance { direction })
}

#[tauri::command]
pub fn player_set_current(index: usize, state: State<'_, PlayerStateSync>) -> Result<(), String> {
    state.send(PlayerCommand::SetCurrent { index })
}

#[tauri::command]
pub fn player_native_started(generation: u64, track_id: i64, state: State<'_, PlayerStateSync>) -> Result<(), String> {
    state.send(PlayerCommand::NativeStarted { generation, track_id })
}

#[tauri::command]
pub fn player_html5_crossfade_committed(state: State<'_, PlayerStateSync>) -> Result<(), String> {
    state.send(PlayerCommand::Html5CrossfadeCommitted)
}

#[tauri::command]
pub fn player_html5_ended(state: State<'_, PlayerStateSync>) -> Result<(), String> {
    state.send(PlayerCommand::Html5Ended)
}