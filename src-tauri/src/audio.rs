// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// This module provides native audio playback using rodio.
// It supports basic playback controls, seeking, and a 10-band equalizer.
// =============================================================================

use std::f32::consts::PI;
use std::fs::File;
use std::io::BufReader;
use std::sync::Mutex;
use std::time::{Duration, Instant};

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
    filters: Vec<BiquadFilter>,
    sample_rate: u32,
    channels: u16,
    // We need separate filter states for each channel to avoid cross-talk
    filter_states: Vec<Vec<BiquadFilter>>,
    current_channel: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    fn new(input: S, settings: &EqSettings) -> Self {
        let sample_rate = input.sample_rate();
        let channels = input.channels();
        let q = 1.41; // Standard Q for 1-octave band

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
            filters: base_filters,
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

        // Apply filters for the current channel
        let channel_filters = &mut self.filter_states[self.current_channel];
        for filter in channel_filters {
            sample = filter.process(sample);
        }

        // Advance channel index
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
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            is_playing: false,
            position: 0.0,
            duration: 0.0,
            volume: 0.7, // 70% default
            current_path: String::new(),
            eq_settings: EqSettings::default(),
        }
    }
}

// =============================================================================
// AUDIO PLAYER
// =============================================================================

pub struct AudioPlayer {
    _stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Sink,
    state: PlaybackState,
    track_duration: Option<Duration>,
    playback_started_at: Option<Instant>,
    position_at_pause: f64,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| format!("Failed to open audio output: {}", e))?;

        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink,
            state: PlaybackState::default(),
            track_duration: None,
            playback_started_at: None,
            position_at_pause: 0.0,
        })
    }

    pub fn play_file(&mut self, path: &str) -> Result<(), String> {
        log::info!("[AUDIO] Loading file: {}", path);

        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        let file =
            File::open(path).map_err(|e| format!("Failed to open file '{}': {}", path, e))?;
        let reader = BufReader::new(file);

        let source = Decoder::new(reader)
            .map_err(|e| format!("Failed to decode audio '{}': {}", path, e))?;

        self.track_duration = source.total_duration();

        // Wrap source in EqSource
        let eq_source = EqSource::new(source.convert_samples(), &self.state.eq_settings);

        self.sink.set_volume(self.state.volume);
        self.sink.append(eq_source);
        self.sink.play();

        self.state.is_playing = true;
        self.state.position = 0.0;
        self.state.duration = self.track_duration.map(|d| d.as_secs_f64()).unwrap_or(0.0);
        self.state.current_path = path.to_string();

        self.playback_started_at = Some(Instant::now());
        self.position_at_pause = 0.0;

        log::info!(
            "[AUDIO] Playing: {} (duration: {:.1}s)",
            path,
            self.state.duration
        );
        Ok(())
    }

    pub fn pause(&mut self) {
        if let Some(started_at) = self.playback_started_at {
            self.position_at_pause += started_at.elapsed().as_secs_f64();
        }
        self.playback_started_at = None;
        self.sink.pause();
        self.state.is_playing = false;
    }

    pub fn resume(&mut self) {
        self.sink.play();
        self.state.is_playing = true;
        self.playback_started_at = Some(Instant::now());
    }

    pub fn stop(&mut self) {
        self.sink.stop();
        self.state.is_playing = false;
        self.state.position = 0.0;
        self.state.current_path = String::new();
        self.playback_started_at = None;
        self.position_at_pause = 0.0;
    }

    pub fn set_volume(&mut self, v: f32) {
        let v = v.clamp(0.0, 1.0);
        self.sink.set_volume(v);
        self.state.volume = v;
    }

    pub fn set_eq(&mut self, settings: EqSettings) -> Result<(), String> {
        self.state.eq_settings = settings;

        // If playing, we need to restart the track to apply new EQ settings
        // In a more advanced implementation, we would update filters in real-time
        // but rodio's Sink/Source pattern makes that complex without custom atomics.
        // For now, if a track is playing, we re-load it at current position.
        if !self.state.current_path.is_empty() {
            let current_pos = self.get_state().position;
            let duration = self.state.duration;
            if duration > 0.0 {
                self.seek(current_pos / duration)?;
            }
        }
        Ok(())
    }

    pub fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        if self.state.current_path.is_empty() {
            return Err("No track loaded".to_string());
        }

        let duration = self.track_duration.ok_or("Track duration unknown")?;
        let seek_to =
            Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        let path = self.state.current_path.clone();
        let was_playing = self.state.is_playing;

        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Failed to decode audio: {}", e))?;

        // Apply EQ to the new source
        let source = source.skip_duration(seek_to);
        let eq_source = EqSource::new(source.convert_samples(), &self.state.eq_settings);

        self.sink.set_volume(self.state.volume);
        self.sink.append(eq_source);

        self.position_at_pause = seek_to.as_secs_f64();
        if was_playing {
            self.sink.play();
            self.state.is_playing = true;
            self.playback_started_at = Some(Instant::now());
        } else {
            self.sink.pause();
            self.state.is_playing = false;
            self.playback_started_at = None;
        }

        self.state.position = seek_to.as_secs_f64();
        Ok(())
    }

    pub fn get_state(&self) -> PlaybackState {
        let mut state = self.state.clone();
        if let Some(started_at) = self.playback_started_at {
            state.position = self.position_at_pause + started_at.elapsed().as_secs_f64();
            if state.duration > 0.0 && state.position > state.duration {
                state.position = state.duration;
            }
        } else {
            state.position = self.position_at_pause;
        }
        if self.sink.empty() && state.is_playing {
            state.is_playing = false;
        }
        state
    }

    pub fn is_finished(&self) -> bool {
        self.sink.empty() && !self.state.current_path.is_empty()
    }
}

// =============================================================================
// GLOBAL STATE
// =============================================================================

pub struct PlaybackStateSync {
    pub player: Mutex<Option<AudioPlayer>>,
}

// SAFETY: AudioPlayer is only accessed through the Mutex, which provides
// synchronization. The underlying rodio types are thread-safe when accessed
// this way.
unsafe impl Send for PlaybackStateSync {}
unsafe impl Sync for PlaybackStateSync {}

impl PlaybackStateSync {
    pub fn new() -> Self {
        Self {
            player: Mutex::new(None),
        }
    }

    pub fn init_async(app_handle: tauri::AppHandle) {
        std::thread::spawn(move || {
            let start = Instant::now();

            match AudioPlayer::new() {
                Ok(p) => {
                    log::info!(
                        "[AUDIO] Backend initialized in {:.1}s",
                        start.elapsed().as_secs_f64()
                    );
                    let state: tauri::State<'_, PlaybackStateSync> =
                        app_handle.state::<PlaybackStateSync>();
                    let sync = state.inner();
                    if let Ok(mut guard) = sync.player.lock() {
                        *guard = Some(p);
                    }
                }
                Err(e) => {
                    log::error!("[AUDIO] Failed to initialize audio: {}", e);
                }
            }
        });
    }
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

#[tauri::command]
pub fn audio_play(path: String, state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.play_file(&path)
}

#[tauri::command]
pub fn audio_pause(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.pause();
    Ok(())
}

#[tauri::command]
pub fn audio_resume(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.resume();
    Ok(())
}

#[tauri::command]
pub fn audio_stop(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.stop();
    Ok(())
}

#[tauri::command]
pub fn audio_set_volume(
    volume: f32,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.set_volume(volume);
    Ok(())
}

#[tauri::command]
pub fn audio_seek(position: f64, state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.seek(position)
}

#[tauri::command]
pub fn audio_get_state(
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<PlaybackState, String> {
    let guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_ref().ok_or("Audio backend not initialized")?;
    Ok(player.get_state())
}

#[tauri::command]
pub fn audio_is_finished(state: tauri::State<'_, PlaybackStateSync>) -> Result<bool, String> {
    let guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_ref().ok_or("Audio backend not initialized")?;
    Ok(player.is_finished())
}

#[tauri::command]
pub fn audio_set_eq(
    settings: EqSettings,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    let mut guard = state.inner().player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.set_eq(settings)
}

#[tauri::command]
pub fn native_audio_available(
    state: tauri::State<'_, PlaybackStateSync>,
) -> bool {
    state
        .inner()
        .player
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}
