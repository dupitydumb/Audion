use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering, AtomicU32};
use std::time::{Duration, Instant};
use std::num::NonZero;
use crossbeam::channel::{unbounded, Receiver, Sender};
use tauri::Emitter;

use super::dsp::EqSettings;
use super::mod_types::{AudioEvent, ReadySource, DeviceList};
use super::sources::CrossfadeState;
use super::engine::{AudioEngine, TrackInfo};


pub struct OpenTask {
    pub path: String,
    pub replay_gain_db: Option<f32>,
    pub generation: u64,
    pub seek_rx: Receiver<Duration>,
    pub repeat_one_rx: Receiver<bool>,
    pub seek_tx: Sender<Duration>,
    pub repeat_one_tx: Sender<bool>,
    pub event_tx: Sender<AudioEvent>,
    pub volume: Arc<AtomicU32>,
    pub replay_gain_enabled: Arc<AtomicBool>,
    pub device_sample_rate: NonZero<u32>,
    pub device_channels: NonZero<u16>,
    pub abort: Arc<AtomicBool>,
    pub initial_seek: Option<Duration>,
    pub crossfade_seconds: u32,
    pub is_preload: bool,
}

pub struct OpenResult {
    pub generation: u64,
    pub seek_tx: Sender<Duration>,
    pub repeat_one_tx: Sender<bool>,
    pub duration: Option<Duration>,
    pub source: Result<ReadySource, String>,
    pub preload_buffer: Option<Vec<f32>>,
}

pub enum AudioCommand {
    Play(String, Option<f32>),
    Preload(String, Option<f32>, u32),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    SetEq(EqSettings),
    SetRepeatOne(bool),
    SetReplayGainEnabled(bool),
    SetLimiterEnabled(bool),
    SetOutputDevice(Option<String>),
    SetCrossfadeSeconds(u32),
    TriggerCrossfade,
}

pub struct PlaybackStateSync {
    command_tx: Sender<AudioCommand>,
    pub device_list: Arc<Mutex<DeviceList>>,
}

impl PlaybackStateSync {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();
        let device_list = Arc::new(Mutex::new(DeviceList {
            devices: Vec::new(),
        }));

        let device_list_clone = Arc::clone(&device_list);

        std::thread::spawn(move || {
            // retry a bounded number of times with fresh engine state
            const MAX_RESTARTS: u32 = 5;
            let mut restarts = 0u32;

            'restart: loop {
            let mut engine_opt: Option<AudioEngine> = None;
            let mut eq_settings = EqSettings::default();

            let mut event_rx: Receiver<AudioEvent> = crossbeam::channel::never();
            let mut open_result_rx: Receiver<OpenResult> = crossbeam::channel::never();

            let emit = |evt: AudioEvent| {
                use tauri::Emitter;
                if let Err(e) = app_handle.emit("audio://event", &evt) {
                    tracing::warn!("[AUDIO] Failed to emit event: {}", e);
                }
            };

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { loop {
                crossbeam::select! {
                    recv(rx) -> msg => {
                        let cmd = match msg {
                            Ok(c) => c,
                            Err(_) => break,
                        };

                        if engine_opt.is_none() {
                            let mut last_err = String::new();
                            for attempt in 0..8u32 {
                                match AudioEngine::new(&eq_settings, None) {
                                    Ok((e, evt_rx, open_rx, dl)) => {
                                        event_rx = evt_rx;
                                        open_result_rx = open_rx;
                                        engine_opt = Some(e);
                                        if let Ok(mut cached) = device_list_clone.lock() {
                                            *cached = dl;
                                        }
                                        last_err.clear();
                                        break;
                                    }
                                    Err(e) => {
                                        tracing::warn!("[AUDIO] Engine init attempt {} failed: {}", attempt + 1, e);
                                        last_err = e;
                                        std::thread::sleep(std::time::Duration::from_millis(250 * (1u64 << attempt.min(4))));
                                    }
                                }
                            }
                            if !last_err.is_empty() {
                                tracing::error!("[AUDIO] Engine init failed after retries: {}", last_err);
                                emit(AudioEvent::Error { message: last_err });
                                continue;
                            }
                        }

                        let engine = engine_opt.as_mut().unwrap();

                        match cmd {
                            AudioCommand::Play(path, rg) => {
                                engine.play(&path, rg);
                            }
                            AudioCommand::Preload(path, rg, crossfade_seconds) => {
                                if let Err(e) = engine.preload(&path, rg, crossfade_seconds) {
                                    tracing::warn!("[AUDIO] preload error: {}", e);
                                }
                            }
                            AudioCommand::Pause => engine.pause(),
                            AudioCommand::Resume => engine.resume(),
                            AudioCommand::Stop => engine.stop(),
                            AudioCommand::Seek(f) => {
                                if let Err(e) = engine.seek(f) {
                                    tracing::warn!("[AUDIO] seek error: {}", e);
                                }
                            }
                            AudioCommand::SetVolume(v) => engine.set_volume(v),
                            AudioCommand::SetEq(s) => {
                                eq_settings = s.clone();
                                engine.set_eq(&s);
                            }
                            AudioCommand::SetRepeatOne(v) => engine.set_repeat_one(v),
                            AudioCommand::SetReplayGainEnabled(v) => {
                                engine.set_replay_gain_enabled(v);
                            }
                            AudioCommand::SetLimiterEnabled(v) => {
                                engine.set_limiter_enabled(v);
                            }
                            AudioCommand::SetOutputDevice(name) => {
                                match engine.set_output_device(name, &mut event_rx, &mut open_result_rx) {
                                    Ok(new_device_list) => {
                                        if let Ok(mut cached) = device_list_clone.lock() {
                                            *cached = new_device_list.clone();
                                        }
                                        emit(AudioEvent::DeviceListChanged { devices: new_device_list });
                                    }
                                    Err(e) => {
                                        tracing::error!("[AUDIO] Device switch failed: {}", e);
                                        emit(AudioEvent::Error { message: e });
                                    }
                                }
                            }
                            AudioCommand::SetCrossfadeSeconds(secs) => {
                                engine.set_crossfade_seconds(secs);
                            }
                            AudioCommand::TriggerCrossfade => {
                                engine.trigger_crossfade();
                            }
                        }
                    }

                    recv(open_result_rx) -> msg => {
                        let result = match msg {
                            Ok(r) => r,
                            Err(_) => {
                                open_result_rx = crossbeam::channel::never();
                                continue;
                            }
                        };

                        let engine = match engine_opt.as_mut() {
                            Some(e) => e,
                            None => continue,
                        };

                        let is_play   = result.generation == engine.current_generation;
                        let is_preload = result.generation == engine.next_generation
                            && result.generation != engine.current_generation;

                        if !is_play && !is_preload {
                            tracing::debug!(
                                "[AUDIO] Discarding stale open result (gen {} — current {}, next {})",
                                result.generation, engine.current_generation, engine.next_generation
                            );
                            continue;
                        }

                        match result.source {
                            Err(e) => {
                                tracing::error!("[AUDIO] open error: {}", e);
                                emit(AudioEvent::Error { message: e });
                                if is_play {
                                    engine.current_info = None;
                                } else {
                                    engine.next_path = None;
                                    engine.next_duration = None;
                                }
                            }
                            Ok(source) => {
                                if is_play {
                                    engine.queue_input.clear();
                                    if let Some(ref tx) = engine.seek_tx {
                                        let _ = tx.send(Duration::MAX);
                                    }

                                    engine.append_ready_source(source);
                                    engine.seek_tx = Some(result.seek_tx);
                                    engine.repeat_one_tx = Some(result.repeat_one_tx);

                                    if let Some(pos) = engine.pending_seek.take() {
                                        if let Some(ref tx) = engine.seek_tx {
                                            let _ = tx.send(pos);
                                        }
                                        if let Some(ref mut info) = engine.current_info {
                                            info.offset = pos;
                                            info.started = Instant::now();
                                        }
                                    }

                                    if let Some(fraction) = engine.pending_seek_fraction.take() {
                                        if let Some(duration) = result.duration {
                                            let pos = Duration::from_secs_f64(
                                                duration.as_secs_f64() * fraction
                                            );
                                            if let Some(ref tx) = engine.seek_tx {
                                                let _ = tx.send(pos);
                                            }
                                            if let Some(ref mut info) = engine.current_info {
                                                info.offset = pos;
                                                info.started = Instant::now();
                                            }
                                        }
                                    }
                                    if engine.pending_paused {
                                        engine.pending_paused = false;
                                        engine.paused_flag.store(true, Ordering::Relaxed);
                                    }

                                    if let Some(ref mut info) = engine.current_info {
                                        info.duration = result.duration;
                                    }

                                    if engine.pending_track_advanced {
                                        engine.pending_track_advanced = false;
                                        if let Some(ref info) = engine.current_info {
                                            emit(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: info.path.clone(),
                                                duration: info.duration,
                                            });
                                        }
                                    }

                                    tracing::info!(
                                        "[AUDIO] Source ready and appended (gen {}), duration={:?}",
                                        result.generation, result.duration
                                    );
                                } else {
                                    engine.append_ready_source(source);
                                    engine.next_seek_tx = Some(result.seek_tx);
                                    engine.next_repeat_one_tx = Some(result.repeat_one_tx);
                                    engine.next_duration = Some(result.duration);
                                    engine.next_preload_buffer = result.preload_buffer;
                                    tracing::debug!(
                                        "[AUDIO] Preloaded source ready and appended (gen {})",
                                        result.generation
                                    );

                                    if engine.pending_crossfade_gen == Some(result.generation) {
                                        engine.pending_crossfade_gen = None;
                                        if let Some(buf) = engine.next_preload_buffer.take() {
                                            let total = buf.len();
                                            tracing::info!(
                                                "[AUDIO] Deferred crossfade: starting mix with {} samples ({:.1}s)",
                                                total,
                                                total as f64 / (engine.device_sample_rate.get() as f64 * engine.device_channels.get() as f64)
                                            );
                                            let path = engine.next_path.take().unwrap_or_default();
                                            let duration = engine.next_duration.take().flatten();
                                            *engine.cf_pending.lock().unwrap() = Some(CrossfadeState {
                                                buffer: buf,
                                                pos: 0,
                                                total_samples: total,
                                            });
                                            engine.cf_active.store(true, Ordering::Release);
                                            engine.seek_tx = engine.next_seek_tx.take();
                                            engine.repeat_one_tx = engine.next_repeat_one_tx.take();
                                            engine.current_generation = engine.next_generation;
                                            engine.current_info = Some(TrackInfo {
                                                path: path.clone(),
                                                duration,
                                                started: Instant::now(),
                                                offset: Duration::ZERO,
                                            });
                                            engine.next_seek_tx = None;
                                            engine.next_repeat_one_tx = None;
                                            engine.next_generation = 0;
                                            let _ = engine.event_tx.try_send(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: path,
                                                duration,
                                            });
                                        } else {
                                            tracing::warn!("[AUDIO] Deferred crossfade: preload_buffer still empty, using gapless handoff");
                                            engine.perform_gapless_handoff();
                                        }
                                    }
                                }
                            }
                        }
                    }

                    recv(event_rx) -> msg => {
                        match msg {
                            Ok(evt) => {
                                let engine = match engine_opt.as_mut() {
                                    Some(e) => e,
                                    None => { emit(evt); continue; }
                                };

                                match evt {
                                    AudioEvent::TrackFinished { generation } => {
                                        if generation != engine.current_generation {
                                            tracing::debug!(
                                                "[AUDIO] Discarding stale TrackFinished \
                                                 (gen {} != current {})",
                                                generation, engine.current_generation
                                            );
                                            continue;
                                        }
                                        if engine.next_path.is_some() && engine.next_seek_tx.is_some() {
                                            engine.seek_tx = engine.next_seek_tx.take();
                                            engine.repeat_one_tx = engine.next_repeat_one_tx.take();
                                            engine.current_generation = engine.next_generation;
                                            let duration = engine.next_duration.take().flatten();
                                            let path = engine.next_path.take().unwrap_or_default();
                                            engine.current_info = Some(TrackInfo {
                                                path: path.clone(),
                                                duration,
                                                started: Instant::now(),
                                                offset: Duration::ZERO,
                                            });
                                            emit(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: path,
                                                duration,
                                            });
                                        } else if engine.next_path.is_some() {
                                            tracing::debug!(
                                                "[AUDIO] TrackFinished but preload worker still in flight \
                                                 (gen {}), waiting for result",
                                                engine.next_generation
                                            );
                                            engine.current_generation = engine.next_generation;
                                            engine.seek_tx = None;
                                            engine.repeat_one_tx = None;
                                            let path = engine.next_path.take().unwrap_or_default();
                                            engine.current_info = Some(TrackInfo {
                                                path: path.clone(),
                                                duration: None,
                                                started: Instant::now(),
                                                offset: Duration::ZERO,
                                            });
                                            engine.next_duration = None;
                                            engine.pending_track_advanced = true;
                                        } else {
                                            engine.seek_tx = None;
                                            engine.repeat_one_tx = None;
                                            engine.current_info = None;
                                            emit(AudioEvent::TrackFinished { generation });
                                        }
                                    }

                                    AudioEvent::StateChanged { position } if position == 0.0 => {
                                        if let Some(ref mut info) = engine.current_info {
                                            info.offset = Duration::ZERO;
                                            info.started = Instant::now();
                                        }
                                        emit(AudioEvent::StateChanged { position });
                                    }

                                    other => emit(other),
                                }
                            }
                            Err(_) => {
                                event_rx = crossbeam::channel::never();
                            }
                        }
                    }
                }
            }})); // closes: loop, AssertUnwindSafe closure, catch_unwind

            match result {
                // rx disconnected (app shutting down) or an explicit break: exit for real.
                Ok(()) => break 'restart,
                Err(payload) => {
                    let msg = payload
                        .downcast_ref::<&str>()
                        .copied()
                        .or_else(|| payload.downcast_ref::<String>().map(|s| s.as_str()))
                        .unwrap_or("(non-string panic payload)");
                    tracing::error!("[AUDIO] Command thread panicked: {}", msg);

                    restarts += 1;
                    if restarts > MAX_RESTARTS {
                        tracing::error!(
                            "[AUDIO] Command thread panicked {} times, giving up",
                            restarts
                        );
                        if let Err(e) = app_handle.emit("audio://event", &AudioEvent::Error {
                            message: format!(
                                "Audio engine crashed repeatedly and could not recover: {}",
                                msg
                            ),
                        }) {
                            tracing::warn!("[AUDIO] Failed to emit panic error event: {}", e);
                        }
                        break 'restart;
                    }

                    if let Err(e) = app_handle.emit("audio://event", &AudioEvent::Error {
                        message: format!("Audio engine crashed, recovering: {}", msg),
                    }) {
                        tracing::warn!("[AUDIO] Failed to emit panic error event: {}", e);
                    }
                    // loop back around and rebuild engine_opt/event_rx from scratch
                }
            }
            } // restart loop
        });

        Self {
            command_tx: tx,
            device_list,
        }
    }

    pub fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.command_tx.send(cmd).map_err(|e| e.to_string())
    }
}
