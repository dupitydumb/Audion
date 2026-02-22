// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// This module provides native audio playback using rodio.
// It uses a message-passing architecture to prevent UI freezes and mutex
// contention, particularly on macOS.
// =============================================================================

use std::f32::consts::PI;
use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex}; // Only for state snapshot, not for engine control
use std::time::{Duration, Instant};

use crossbeam::channel::{unbounded, Receiver, Sender};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::{Deserialize, Serialize};
use tauri::Manager;

// =============================================================================
// DSP: EQUALIZER FILTERS
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EqBand {
    pub frequency: f32,
    pub gain: f32, // in dB
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands: Vec<EqBand>,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bands: vec![
                EqBand {
                    frequency: 31.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 62.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 125.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 250.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 500.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 1000.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 2000.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 4000.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 8000.0,
                    gain: 0.0,
                },
                EqBand {
                    frequency: 16000.0,
                    gain: 0.0,
                },
            ],
        }
    }
}

/// A Biquad filter implementation for peaking EQ
#[derive(Clone)]
struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadFilter {
    fn new_peaking(freq: f32, gain_db: f32, sample_rate: u32, q: f32) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate as f32;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, sample: f32) -> f32 {
        let out = self.b0 * sample + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = sample;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }
}

/// A Source wrapper that applies a multi-band EQ
struct EqSource<S: Source<Item = f32>> {
    input: S,
    sample_rate: u32,
    channels: u16,
    filter_states: Vec<Vec<BiquadFilter>>,
    current_channel: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    fn new(input: S, settings: &EqSettings) -> Self {
        let sample_rate = input.sample_rate();
        let channels = input.channels();
        let q = 1.41;

        let mut base_filters = Vec::new();
        if settings.enabled {
            for band in &settings.bands {
                if band.gain != 0.0 {
                    base_filters.push(BiquadFilter::new_peaking(
                        band.frequency,
                        band.gain,
                        sample_rate,
                        q,
                    ));
                }
            }
        }

        let mut filter_states = Vec::new();
        for _ in 0..channels {
            filter_states.push(base_filters.clone());
        }

        Self {
            input,
            sample_rate,
            channels,
            filter_states,
            current_channel: 0,
        }
    }
}

impl<S: Source<Item = f32>> Iterator for EqSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<Self::Item> {
        let mut sample = self.input.next()?;
        let channel_filters = &mut self.filter_states[self.current_channel];
        for filter in channel_filters {
            sample = filter.process(sample);
        }
        self.current_channel = (self.current_channel + 1) % self.channels as usize;
        Some(sample)
    }
}

impl<S: Source<Item = f32>> Source for EqSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.input.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.channels
    }
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }
}

// =============================================================================
// PLAYER STATE
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackState {
    pub is_playing: bool,
    pub position: f64,
    pub duration: f64,
    pub volume: f32,
    pub current_path: String,
    pub eq_settings: EqSettings,
    pub is_initialized: bool,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            is_playing: false,
            position: 0.0,
            duration: 0.0,
            volume: 0.7,
            current_path: String::new(),
            eq_settings: EqSettings::default(),
            is_initialized: false,
        }
    }
}

// =============================================================================
// AUDIO COMMANDS
// =============================================================================

enum AudioCommand {
    Play(String),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f64),
    SetEq(EqSettings),
}

// =============================================================================
// INTERNAL AUDIO PLAYER (Managed by Audio Thread)
// =============================================================================

struct AudioPlayer {
    _stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Sink,
    track_duration: Option<Duration>,
    playback_started_at: Option<Instant>,
    position_at_pause: f64,
    current_path: String,
    volume: f32,
    eq_settings: EqSettings,
}

impl AudioPlayer {
    fn new() -> Result<Self, String> {
        log::info!("[AUDIO] Initializing output stream (lazy)...");
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| format!("Failed to open audio output: {}", e))?;

        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink,
            track_duration: None,
            playback_started_at: None,
            position_at_pause: 0.0,
            current_path: String::new(),
            volume: 0.7,
            eq_settings: EqSettings::default(),
        })
    }

    fn play_file(&mut self, path: &str) -> Result<(), String> {
        log::info!("[AUDIO] Loading file on background thread: {}", path);
        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
        let reader = BufReader::new(file);
        let source = Decoder::new(reader).map_err(|e| format!("Failed to decode audio: {}", e))?;

        self.track_duration = source.total_duration();
        let eq_source = EqSource::new(source.convert_samples(), &self.eq_settings);

        self.sink.set_volume(self.volume);
        self.sink.append(eq_source);
        self.sink.play();

        self.current_path = path.to_string();
        self.playback_started_at = Some(Instant::now());
        self.position_at_pause = 0.0;

        Ok(())
    }

    fn pause(&mut self) {
        if let Some(started_at) = self.playback_started_at {
            self.position_at_pause += started_at.elapsed().as_secs_f64();
        }
        self.playback_started_at = None;
        self.sink.pause();
    }

    fn resume(&mut self) {
        self.sink.play();
        self.playback_started_at = Some(Instant::now());
    }

    fn stop(&mut self) {
        self.sink.stop();
        self.current_path = String::new();
        self.playback_started_at = None;
        self.position_at_pause = 0.0;
    }

    fn set_volume(&mut self, v: f32) {
        let v = v.clamp(0.0, 1.0);
        self.sink.set_volume(v);
        self.volume = v;
    }

    fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        if self.current_path.is_empty() {
            return Err("No track loaded".into());
        }
        let duration = self.track_duration.ok_or("Track duration unknown")?;
        let seek_to =
            Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        let was_playing = self.playback_started_at.is_some() || !self.sink.is_paused();
        let path = self.current_path.clone();

        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Failed to decode audio: {}", e))?;
        let eq_source = EqSource::new(
            source.skip_duration(seek_to).convert_samples(),
            &self.eq_settings,
        );

        self.sink.set_volume(self.volume);
        self.sink.append(eq_source);

        self.position_at_pause = seek_to.as_secs_f64();
        if was_playing {
            self.sink.play();
            self.playback_started_at = Some(Instant::now());
        } else {
            self.sink.pause();
            self.playback_started_at = None;
        }
        Ok(())
    }

    // Returns current position and is_playing status
    fn update_state(&mut self, state: &mut PlaybackState) {
        state.is_playing =
            self.playback_started_at.is_some() && !self.sink.is_paused() && !self.sink.empty();
        state.duration = self.track_duration.map(|d| d.as_secs_f64()).unwrap_or(0.0);
        state.current_path = self.current_path.clone();
        state.volume = self.volume;
        state.eq_settings = self.eq_settings.clone();

        if let Some(started_at) = self.playback_started_at {
            state.position = self.position_at_pause + started_at.elapsed().as_secs_f64();
            if state.duration > 0.0 && state.position > state.duration {
                state.position = state.duration;
            }
        } else {
            state.position = self.position_at_pause;
        }

        if self.sink.empty() && !self.current_path.is_empty() {
            state.is_playing = false;
        }
    }
}

// =============================================================================
// GLOBAL SYNC STATE
// =============================================================================

pub struct PlaybackStateSync {
    command_tx: Sender<AudioCommand>,
    shared_state: Arc<Mutex<PlaybackState>>, // Only for state snapshot
}

impl PlaybackStateSync {
    pub fn new() -> Self {
        let (tx, rx) = unbounded();
        let shared_state = Arc::new(Mutex::new(PlaybackState::default()));

        // Spawn dedicated audio thread (engine is owned ONLY by this thread)
        let state_clone = Arc::clone(&shared_state);
        std::thread::spawn(move || {
            let mut player_opt: Option<AudioPlayer> = None;

            loop {
                // Wait for commands with a timeout so we can update position
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(cmd) => {
                        // Lazy initialization
                        if player_opt.is_none() {
                            match AudioPlayer::new() {
                                Ok(p) => {
                                    player_opt = Some(p);
                                    if let Ok(mut s) = state_clone.lock() {
                                        s.is_initialized = true;
                                    }
                                }
                                Err(e) => {
                                    log::error!("[AUDIO] Lazy init failed: {}", e);
                                    continue;
                                }
                            }
                        }

                        // All engine operations are performed ONLY on this thread
                        let player = player_opt.as_mut().unwrap();
                        match cmd {
                            AudioCommand::Play(path) => {
                                let _ = player.play_file(&path);
                            }
                            AudioCommand::Pause => player.pause(),
                            AudioCommand::Resume => player.resume(),
                            AudioCommand::Stop => player.stop(),
                            AudioCommand::SetVolume(v) => player.set_volume(v),
                            AudioCommand::Seek(f) => {
                                let _ = player.seek(f);
                            }
                            AudioCommand::SetEq(settings) => {
                                player.eq_settings = settings;
                                if !player.current_path.is_empty() {
                                    let current_pos = player.get_state_for_internal().position;
                                    let duration = player
                                        .track_duration
                                        .map(|d| d.as_secs_f64())
                                        .unwrap_or(0.0);
                                    if duration > 0.0 {
                                        let _ = player.seek(current_pos / duration);
                                    }
                                }
                            }
                        }
                    }
                    Err(crossbeam::channel::RecvTimeoutError::Disconnected) => break,
                    Err(crossbeam::channel::RecvTimeoutError::Timeout) => {}
                }

                // Update shared state snapshot for UI (never engine control)
                if let Some(player) = player_opt.as_mut() {
                    if let Ok(mut s) = state_clone.lock() {
                        player.update_state(&mut s);
                    }
                }
            }
        });

        Self {
            command_tx: tx,
            shared_state,
        }
    }

    // Helper for EQ refresh
    fn get_state_for_internal(&self) -> PlaybackState {
        self.shared_state.lock().unwrap().clone()
    }
}

// Internal version of get_state to avoid circular logic
impl AudioPlayer {
    fn get_state_for_internal(&self) -> PlaybackState {
        let mut s = PlaybackState::default();
        s.duration = self.track_duration.map(|d| d.as_secs_f64()).unwrap_or(0.0);
        if let Some(started_at) = self.playback_started_at {
            s.position = self.position_at_pause + started_at.elapsed().as_secs_f64();
        } else {
            s.position = self.position_at_pause;
        }
        s
    }
}

// Compatibility method deleted - we handle init in new() now
impl PlaybackStateSync {
    pub fn init_async(_app_handle: tauri::AppHandle) {
        // No-op: Initialization is now lazy and handled in the audio thread itself
    }
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

#[tauri::command]
pub fn audio_play(path: String, state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::Play(path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_pause(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::Pause)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_resume(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::Resume)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_stop(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::Stop)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_set_volume(
    volume: f32,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::SetVolume(volume))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_seek(position: f64, state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::Seek(position))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_get_state(
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<PlaybackState, String> {
    Ok(state
        .shared_state
        .lock()
        .map_err(|_| "Lock poisoned")?
        .clone())
}

#[tauri::command]
pub fn audio_is_finished(state: tauri::State<'_, PlaybackStateSync>) -> Result<bool, String> {
    let s = state.shared_state.lock().map_err(|_| "Lock poisoned")?;
    // A track is finished if it has a path but is NOT playing and position is at/near duration
    Ok(!s.is_playing && !s.current_path.is_empty() && s.position >= s.duration - 0.1)
}

#[tauri::command]
pub fn audio_set_eq(
    settings: EqSettings,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state
        .command_tx
        .send(AudioCommand::SetEq(settings))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn native_audio_available(state: tauri::State<'_, PlaybackStateSync>) -> bool {
    state
        .shared_state
        .lock()
        .map(|s| s.is_initialized)
        .unwrap_or(false)
}
