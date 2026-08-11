use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering, AtomicU32};
use std::time::{Duration, Instant};
use std::num::NonZero;
use std::str::FromStr;
use cpal::DeviceId;
use crossbeam::channel::{unbounded, Receiver, Sender};
use rodio::queue::queue;
use rodio::Source;

use super::dsp::{EqSettings, LIMITER_ENABLED_DEFAULT};
use super::mod_types::{AudioEvent, ReadySource, DeviceList, AudioDeviceInfo};
use super::sources::{PausableQueue, CrossfadeSource, CrossfadeState, EqSource, LimiterSource};
use super::worker::{OpenTask, OpenResult};
use super::symphonia::SymphoniaSource;
use super::resampler::RubatoResampler;


// =============================================================================
// TrackInfo — position tracking across seeks and pauses
// =============================================================================

pub struct TrackInfo {
    pub path: String,
    pub duration: Option<Duration>,
    pub started: Instant, // wall-clock of last resume / seek
    pub offset: Duration, // playback position at last resume / seek
}

impl TrackInfo {
    pub fn position_secs(&self) -> f64 {
        let elapsed = self.offset + self.started.elapsed();
        match self.duration {
            Some(d) => elapsed.as_secs_f64().min(d.as_secs_f64()),
            None => elapsed.as_secs_f64(),
        }
    }
}

// =============================================================================
// AudioEngine — owns the pipeline, lives entirely on the audio thread
// =============================================================================

pub struct AudioEngine {
    pub queue_input: Arc<rodio::queue::SourcesQueueInput>,
    pub paused_flag: Arc<AtomicBool>,
    pub volume_atomic: Arc<AtomicU32>,
    pub volume: f32,
    pub eq_tx: Sender<EqSettings>,
    pub eq_settings: EqSettings,
    pub event_tx: Sender<AudioEvent>,
    pub device_sample_rate: NonZero<u32>,
    pub device_channels: NonZero<u16>,
    pub replay_gain_enabled: Arc<AtomicBool>,
    pub limiter_enabled: Arc<AtomicBool>,
    pub seek_tx: Option<Sender<Duration>>,
    pub repeat_one_tx: Option<Sender<bool>>,
    pub repeat_one: bool,
    pub current_info: Option<TrackInfo>,
    pub generation_counter: u64,
    pub current_generation: u64,

    pub next_seek_tx: Option<Sender<Duration>>,
    pub next_repeat_one_tx: Option<Sender<bool>>,
    pub next_path: Option<String>,
    pub next_duration: Option<Option<Duration>>,
    pub next_generation: u64,

    pub cf_active: Arc<AtomicBool>,
    pub cf_pending: Arc<Mutex<Option<CrossfadeState>>>,
    pub crossfade_seconds: u32,
    pub next_preload_buffer: Option<Vec<f32>>,

    pub worker_tx: Sender<OpenTask>,
    pub play_abort: Arc<AtomicBool>,
    pub preload_abort: Arc<AtomicBool>,

    pub pending_seek: Option<Duration>,
    pub pending_seek_fraction: Option<f64>,
    pub pending_paused: bool,
    pub pending_track_advanced: bool,
    pub pending_crossfade_gen: Option<u64>,

    pub _stream: rodio::MixerDeviceSink,
}

impl AudioEngine {
    pub fn new(
        eq_settings: &EqSettings,
        preferred_device_id: Option<String>,
    ) -> Result<(Self, Receiver<AudioEvent>, Receiver<OpenResult>, DeviceList), String> {    
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

        let cached_device_list = {
            let infos = all_devices.iter().filter_map(|d| {
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
            DeviceList { devices: infos }
        };

        let device = if let Some(ref id_str) = preferred_device_id {
            match DeviceId::from_str(id_str) {
                Ok(id) => {
                    match host.device_by_id(&id) {
                        Some(d) => d,
                        None => {
                            tracing::warn!("[AUDIO] Device id '{}' not found, using default", id_str);
                            host.default_output_device()
                                .ok_or("No default output device found")?
                        }
                    }
                }
                Err(_) => {
                    tracing::warn!("[AUDIO] Invalid device id '{}', using default", id_str);
                    host.default_output_device()
                        .ok_or("No default output device found")?
                }
            }
        } else {
            host.default_output_device()
                .ok_or("No default output device found")?
        };

        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get output config: {}", e))?;

        let stream = rodio::DeviceSinkBuilder::from_device(device)
            .map_err(|e| format!("Failed to open audio output: {}", e))?
            .with_supported_config(&config)
            .open_stream()
            .map_err(|e| format!("Failed to open audio output: {}", e))?;   

        let device_sample_rate = NonZero::new(config.sample_rate())
            .ok_or("Device reported sample rate of 0")?;
        let device_channels = NonZero::new(config.channels())
            .ok_or("Device reported channel count of 0")?;

        tracing::info!(
            "[AUDIO] Output stream opened ({}Hz {}ch)",
            device_sample_rate, device_channels
        );

        let (queue_input, queue_output) = queue(true);
        let paused_flag = Arc::new(AtomicBool::new(false));
        let volume_atomic = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let replay_gain_enabled = Arc::new(AtomicBool::new(true));
        let limiter_enabled = Arc::new(AtomicBool::new(LIMITER_ENABLED_DEFAULT));

        let (eq_tx, eq_rx) = unbounded::<EqSettings>();
        let (event_tx, event_rx) = unbounded::<AudioEvent>();

        let (worker_tx, worker_rx) = unbounded::<OpenTask>();
        let (open_result_tx, open_result_rx) = unbounded::<OpenResult>();
        {
            let open_result_tx = open_result_tx.clone();
            std::thread::spawn(move || {
                while let Ok(task) = worker_rx.recv() {
                    if task.abort.load(Ordering::Relaxed) {
                        continue;
                    }

                    let src = SymphoniaSource::open(
                        &task.path,
                        task.replay_gain_db,
                        task.seek_rx,
                        task.repeat_one_rx,
                        task.event_tx,
                        task.generation,
                        task.volume,
                        task.replay_gain_enabled,
                        task.device_channels,
                    );

                    let mut src = match src {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = open_result_tx.send(OpenResult {
                                generation: task.generation,
                                seek_tx: {
                                    let (tx, _) = unbounded::<Duration>();
                                    tx
                                },
                                repeat_one_tx: {
                                    let (tx, _) = unbounded::<bool>();
                                    tx
                                },
                                duration: None,
                                source: Err(e),
                                preload_buffer: None,
                            });
                            continue;
                        }
                    };

                    if let Some(pos) = task.initial_seek {
                        src.seek(pos);
                    }

                    if task.abort.load(Ordering::Relaxed) {
                        continue;
                    }

                    let src_rate = src.sample_rate();
                    let needs_resample = src_rate != task.device_sample_rate;
                    let duration = src.duration;

                    if task.abort.load(Ordering::Relaxed) {
                        continue;
                    }

                    let ready = if needs_resample {
                        RubatoResampler::new(src, task.device_sample_rate)
                            .map(ReadySource::Resampled)
                    } else {
                        Ok(ReadySource::Raw(src))
                    };

                    let (preload_buffer, ready) = if task.crossfade_seconds > 0 && task.is_preload {
                        match ready {
                            Err(e) => {
                                let _ = open_result_tx.send(OpenResult {
                                    generation: task.generation,
                                    seek_tx: task.seek_tx,
                                    repeat_one_tx: task.repeat_one_tx,
                                    duration,
                                    source: Err(e),
                                    preload_buffer: None,
                                });
                                continue;
                            }
                            Ok(mut ready_src) => {
                                let ch = ready_src.channels().get() as usize;
                                let samples_needed = (task.crossfade_seconds as u64
                                    * task.device_sample_rate.get() as u64) as usize
                                    * ch;
                                let mut buf = Vec::with_capacity(samples_needed);
                                for _ in 0..samples_needed {
                                    match ready_src.next() {
                                        Some(s) => buf.push(s),
                                        None => break,
                                    }
                                }

                                tracing::info!(
                                    "[AUDIO] Pre-decoded {} samples at device rate (crossfade seconds: {})",
                                    buf.len(),
                                    task.crossfade_seconds
                                );
                                let preload = if buf.is_empty() { None } else { Some(buf) };
                                (preload, Ok(ready_src))
                            }
                        }
                    } else {
                        (None, ready)
                    };

                    let _ = open_result_tx.send(OpenResult {
                        generation: task.generation,
                        seek_tx: task.seek_tx,
                        repeat_one_tx: task.repeat_one_tx,
                        duration,
                        source: ready,
                        preload_buffer,
                    });
                }
            });
        }

        let pq = PausableQueue {
            inner: queue_output,
            paused: Arc::clone(&paused_flag),
            frame_pos: 0,
        };
        let cf_active = Arc::new(AtomicBool::new(false));
        let cf_pending: Arc<Mutex<Option<CrossfadeState>>> = Arc::new(Mutex::new(None));
        let cf_src = CrossfadeSource::new(pq, Arc::clone(&cf_active), Arc::clone(&cf_pending));
        let eq_src = EqSource::new(cf_src, eq_settings, eq_rx);
        // final stage => sees the cumulative result of ReplayGain + volume + EQ
        let limited_src = LimiterSource::new(eq_src, Arc::clone(&limiter_enabled));

        stream.mixer().add(limited_src);

        Ok((
            Self {
                queue_input,
                paused_flag,
                volume_atomic,
                volume: 0.7,
                eq_tx,
                eq_settings: eq_settings.clone(),
                event_tx,
                device_sample_rate,
                device_channels,
                replay_gain_enabled,
                limiter_enabled,
                seek_tx: None,
                repeat_one_tx: None,
                repeat_one: false,
                current_info: None,
                generation_counter: 0,
                current_generation: 0,
                next_seek_tx: None,
                next_repeat_one_tx: None,
                next_path: None,
                next_duration: None,
                next_generation: 0,
                cf_active,
                cf_pending,
                crossfade_seconds: 0,
                next_preload_buffer: None,
                worker_tx,
                play_abort: Arc::new(AtomicBool::new(false)),
                preload_abort: Arc::new(AtomicBool::new(false)),
                pending_seek: None,
                pending_seek_fraction: None,
                pending_paused: false,
                pending_track_advanced: false,
                pending_crossfade_gen: None,
                _stream: stream,
            },
            event_rx,
            open_result_rx,
            cached_device_list,
        ))
    }

    fn dispatch_open(
        &mut self,
        path: &str,
        replay_gain_db: Option<f32>,
        abort_flag: Arc<AtomicBool>,
        initial_seek: Option<Duration>,
        is_preload: bool,
        crossfade_seconds: u32,
    ) -> u64 {
        self.generation_counter += 1;
        let generation = self.generation_counter;

        let (seek_tx, seek_rx) = unbounded::<Duration>();
        let (repeat_one_tx, repeat_one_rx) = unbounded::<bool>();
        let _ = repeat_one_tx.send(self.repeat_one);

        let _ = self.worker_tx.send(OpenTask {
            path: path.to_string(),
            replay_gain_db,
            generation,
            seek_rx,
            repeat_one_rx,
            event_tx: self.event_tx.clone(),
            volume: Arc::clone(&self.volume_atomic),
            replay_gain_enabled: Arc::clone(&self.replay_gain_enabled),
            device_sample_rate: self.device_sample_rate,
            device_channels: self.device_channels,
            abort: abort_flag,
            seek_tx,
            repeat_one_tx,
            initial_seek,
            crossfade_seconds,
            is_preload,
        });

        generation
    }

    pub fn append_ready_source(&mut self, source: ReadySource) {
        match source {
            ReadySource::Raw(src) => self.queue_input.append(src),
            ReadySource::Resampled(r) => self.queue_input.append(r),
        }
    }

    pub fn play(&mut self, path: &str, replay_gain_db: Option<f32>) {
        self.clear_crossfade();
        self.queue_input.clear();

        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }

        self.seek_tx = None;
        self.repeat_one_tx = None;
        self.next_seek_tx = None;
        self.next_repeat_one_tx = None;
        self.next_path = None;
        self.next_duration = None;
        self.next_generation = 0;

        self.current_info = Some(TrackInfo {
            path: path.to_string(),
            duration: None,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        self.paused_flag.store(false, Ordering::Relaxed);
        self.pending_track_advanced = false;
        self.pending_seek = None;
        self.pending_seek_fraction = None;
        self.pending_paused = false;

        self.play_abort.store(true, Ordering::Relaxed);
        self.preload_abort.store(true, Ordering::Relaxed);
        let new_play_abort = Arc::new(AtomicBool::new(false));
        self.play_abort = Arc::clone(&new_play_abort);

        let generation = self.dispatch_open(path, replay_gain_db, new_play_abort, None, false, 0);
        self.current_generation = generation;

        tracing::info!("[AUDIO] Play dispatched (gen {}): {}", generation, path);
    }

    pub fn preload(&mut self, path: &str, replay_gain_db: Option<f32>, crossfade_seconds: u32) -> Result<(), String> {
        if self.next_path.as_deref() == Some(path) {
            tracing::info!("[AUDIO] Preload skipped (same path): {}", path);
            return Ok(());
        }
        tracing::info!(
            "[AUDIO] Preloading: {} (replacing: {:?})",
            path,
            self.next_path
        );

        if self.next_seek_tx.is_some() {
            if let Some(ref tx) = self.next_seek_tx {
                let _ = tx.send(Duration::MAX);
            }
            self.queue_input.clear();
            self.next_seek_tx = None;
            self.next_repeat_one_tx = None;
        }

        self.preload_abort.store(true, Ordering::Relaxed);
        let new_preload_abort = Arc::new(AtomicBool::new(false));
        self.preload_abort = Arc::clone(&new_preload_abort);

        self.next_path = Some(path.to_string());
        self.next_duration = None;
        let generation = self.dispatch_open(path, replay_gain_db, new_preload_abort, None, true, crossfade_seconds);
        self.next_generation = generation;
        tracing::debug!("[AUDIO] Preload dispatched (gen {}): {}", generation, path);
        Ok(())
    }

    pub fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        self.clear_crossfade();
        let info = self.current_info.as_mut().ok_or("No track loaded")?;

        if self.seek_tx.is_none() {
            self.pending_seek_fraction = Some(position_fraction.clamp(0.0, 1.0));
            return Ok(());
        }

        let duration = info.duration.ok_or("Track duration unknown")?;
        let pos = Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(pos);
        }

        info.offset = pos;
        info.started = Instant::now();
        Ok(())
    }

    pub fn pause(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.offset = Duration::from_secs_f64(info.position_secs());
            info.started = Instant::now();
        }
        self.paused_flag.store(true, Ordering::Relaxed);
    }

    pub fn resume(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.started = Instant::now();
        }
        self.paused_flag.store(false, Ordering::Relaxed);
    }

    pub fn stop(&mut self) {
        self.clear_crossfade();
        self.queue_input.clear();
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        self.seek_tx = None;
        self.repeat_one_tx = None;
        self.current_info = None;
        self.next_seek_tx = None;
        self.next_repeat_one_tx = None;
        self.next_path = None;
        self.next_duration = None;
        self.paused_flag.store(false, Ordering::Relaxed);

        self.play_abort.store(true, Ordering::Relaxed);
        self.preload_abort.store(true, Ordering::Relaxed);
        self.play_abort = Arc::new(AtomicBool::new(false));
        self.preload_abort = Arc::new(AtomicBool::new(false));

        self.current_generation = u64::MAX;
        self.next_generation = u64::MAX;

        self.pending_track_advanced = false;
        self.pending_seek = None;
        self.pending_seek_fraction = None;
        self.pending_paused = false;

        tracing::info!("[AUDIO] Stopped");
    }

    pub fn set_volume(&mut self, v: f32) {
        let clamped = v.clamp(0.0, 1.0);
        self.volume = clamped;
        self.volume_atomic.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn set_eq(&mut self, settings: &EqSettings) {
        self.eq_settings = settings.clone();
        let _ = self.eq_tx.send(settings.clone());
    }

    pub fn set_replay_gain_enabled(&mut self, enabled: bool) {
        self.replay_gain_enabled.store(enabled, Ordering::Relaxed);
        tracing::info!("[AUDIO] Replay gain enabled: {}", enabled);
    }

    pub fn set_limiter_enabled(&mut self, enabled: bool) {
        self.limiter_enabled.store(enabled, Ordering::Relaxed);
        tracing::info!("[AUDIO] Limiter enabled: {}", enabled);
    }

    pub fn set_output_device(
        &mut self,
        device_name: Option<String>,
        event_rx_slot: &mut Receiver<AudioEvent>,
        open_result_rx_slot: &mut Receiver<OpenResult>,
    ) -> Result<DeviceList, String> {
        let snapshot = self.current_info.as_ref().map(|info| {
            (info.path.clone(), Duration::from_secs_f64(info.position_secs()))
        });
        let was_paused = self.paused_flag.load(Ordering::Relaxed);
        let volume = self.volume;
        let repeat_one = self.repeat_one;
        let replay_gain_enabled = self.replay_gain_enabled.load(Ordering::Relaxed);
        let limiter_enabled = self.limiter_enabled.load(Ordering::Relaxed);
        let eq_settings = self.eq_settings.clone();

        self.queue_input.clear();
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }

        let (mut new_engine, new_event_rx, new_open_result_rx, new_device_list) =
            AudioEngine::new(&eq_settings, device_name)?;

        new_engine.set_volume(volume);
        new_engine.replay_gain_enabled.store(replay_gain_enabled, Ordering::Relaxed);
        new_engine.limiter_enabled.store(limiter_enabled, Ordering::Relaxed);
        new_engine.repeat_one = repeat_one;

        if let Some((path, position)) = snapshot {
            new_engine.queue_input.clear();
            new_engine.seek_tx = None;
            new_engine.repeat_one_tx = None;
            new_engine.next_seek_tx = None;
            new_engine.next_repeat_one_tx = None;
            new_engine.next_path = None;
            new_engine.next_duration = None;
            new_engine.next_generation = 0;
            new_engine.pending_track_advanced = false;
            new_engine.pending_seek = None;
            new_engine.pending_seek_fraction = None;
            new_engine.pending_paused = false;
            new_engine.paused_flag.store(false, Ordering::Relaxed);

            new_engine.current_info = Some(TrackInfo {
                path: path.clone(),
                duration: None,
                started: Instant::now(),
                offset: position,
            });

            let abort = Arc::new(AtomicBool::new(false));
            new_engine.play_abort = Arc::clone(&abort);
            new_engine.preload_abort = Arc::clone(&abort);

            let generation = new_engine.dispatch_open(&path, None, abort, Some(position), false, 0);
            new_engine.current_generation = generation;
            new_engine.pending_paused = was_paused;

            tracing::info!(
                "[AUDIO] Device switch: resuming '{}' at {:.3}s (gen {})",
                path, position.as_secs_f64(), generation
            );
        }

        *event_rx_slot = new_event_rx;
        *open_result_rx_slot = new_open_result_rx;

        if let Some(ref path) = self.next_path {
            tracing::warn!("[AUDIO] Device switch: discarding preloaded track: {}", path);
        }

        *self = new_engine;

        tracing::info!("[AUDIO] Output device switched successfully");
        Ok(new_device_list)
    }

    pub fn set_repeat_one(&mut self, enabled: bool) {
        self.repeat_one = enabled;
        if let Some(ref tx) = self.repeat_one_tx {
            let _ = tx.send(enabled);
        }
    }

    pub fn set_crossfade_seconds(&mut self, secs: u32) {
        self.crossfade_seconds = secs;
        tracing::info!("[AUDIO] Crossfade set to {}s", secs);
    }

    pub fn trigger_crossfade(&mut self) {
        let preload_buf = match self.next_preload_buffer.take() {
            Some(buf) if !buf.is_empty() => buf,
            _ => {
                tracing::warn!("[AUDIO] trigger_crossfade: buffer not ready, waiting for preload result (gen {})", self.next_generation);
                self.pending_crossfade_gen = Some(self.next_generation);
                return;
            }
        };

        let total = preload_buf.len();

        tracing::info!(
            "[AUDIO] trigger_crossfade: starting crossfade mixing with {} samples ({:.1}s)",
            total,
            total as f64 / (self.device_sample_rate.get() as f64 * self.device_channels.get() as f64)
        );
        let path = self.next_path.take().unwrap_or_default();
        let duration = self.next_duration.take().flatten();

        *self.cf_pending.lock().unwrap() = Some(CrossfadeState {
            buffer: preload_buf,
            pos: 0,
            total_samples: total,
        });
        self.cf_active.store(true, Ordering::Release);

        self.seek_tx = self.next_seek_tx.take();
        self.repeat_one_tx = self.next_repeat_one_tx.take();
        self.current_generation = self.next_generation;
        self.current_info = Some(TrackInfo {
            path: path.clone(),
            duration,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        self.next_seek_tx = None;
        self.next_repeat_one_tx = None;
        self.next_duration = None;
        self.next_generation = 0;

        let _ = self.event_tx.try_send(AudioEvent::TrackAdvanced {
            generation: self.current_generation,
            new_path: path,
            duration,
        });

        tracing::info!(
            "[AUDIO] Crossfade triggered: {} samples ({:.1}s)",
            total,
            total as f64 / (self.device_sample_rate.get() as f64 * self.device_channels.get() as f64)
        );
    }

    pub fn perform_gapless_handoff(&mut self) {
        self.seek_tx = self.next_seek_tx.take();
        self.repeat_one_tx = self.next_repeat_one_tx.take();
        self.current_generation = self.next_generation;
        let duration = self.next_duration.take().flatten();
        let path = self.next_path.take().unwrap_or_default();
        self.current_info = Some(TrackInfo {
            path: path.clone(),
            duration,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        let _ = self.event_tx.try_send(AudioEvent::TrackAdvanced {
            generation: self.current_generation,
            new_path: path,
            duration,
        });
    }

    pub fn clear_crossfade(&mut self) {
        self.cf_active.store(false, Ordering::Relaxed);
        *self.cf_pending.lock().unwrap() = None;
        self.next_preload_buffer = None;
        self.pending_crossfade_gen = None;
    }
}
