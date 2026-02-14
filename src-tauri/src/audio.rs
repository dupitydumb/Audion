// =============================================================================
// LINUX NATIVE AUDIO BACKEND
// =============================================================================
// This module provides native audio playback for Linux using rodio.
//
// WHY THIS EXISTS:
// WebKitGTK (the WebView engine on Linux) has known issues with the asset://
// protocol for media playback. Instead of trying to work around WebView bugs,
// we bypass it entirely by playing audio directly through the system's audio
// stack via rodio.
//
// DESIGN DECISIONS:
// - Uses system default output device (no DAC selection, no bit-perfect)
// - Simple play/pause/stop/seek interface
// - Runs on a dedicated thread to avoid blocking the main thread
// - State is managed via Arc<Mutex<>> for thread-safe access from Tauri commands
//
// This module is ONLY compiled on Linux. Windows and macOS continue to use
// the HTML5 Audio element in the WebView, which works fine there.
// =============================================================================

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};

// =============================================================================
// PLAYER STATE
// =============================================================================
// We track the current playback state so the frontend can query it.
// This is simpler than QBZ's approach - we don't need sample rate tracking
// or device switching, just basic playback control.
// =============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct PlaybackState {
    /// Whether audio is currently playing
    pub is_playing: bool,
    /// Current position in seconds
    pub position: f64,
    /// Total duration in seconds (0 if unknown)
    pub duration: f64,
    /// Volume level (0.0 to 1.0)
    pub volume: f32,
    /// Path of the currently loaded track (empty if none)
    pub current_path: String,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            is_playing: false,
            position: 0.0,
            duration: 0.0,
            volume: 1.0,
            current_path: String::new(),
        }
    }
}

// =============================================================================
// AUDIO PLAYER
// =============================================================================
// The main player struct holds the rodio sink and stream handles.
// We keep the OutputStream alive because dropping it stops all audio.
// =============================================================================

pub struct AudioPlayer {
    /// The output stream - MUST be kept alive or audio stops
    _stream: OutputStream,
    /// Handle to the stream for creating sinks
    stream_handle: OutputStreamHandle,
    /// The sink controls playback (play, pause, volume, etc.)
    sink: Sink,
    /// Current playback state
    state: PlaybackState,
    /// Duration of the current track (stored separately for seeking calculations)
    track_duration: Option<Duration>,
    /// Timestamp when playback started/resumed (for position tracking)
    playback_started_at: Option<Instant>,
    /// Position when playback was paused (to resume tracking correctly)
    position_at_pause: f64,
}

impl AudioPlayer {
    /// Create a new audio player using the system default output device.
    /// Returns an error if no audio device is available.
    pub fn new() -> Result<Self, String> {
        // Get the default output device
        // This is intentionally simple - we don't enumerate devices or try to
        // select specific ones. System default is fine for Linux desktop use.
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

    /// Load and play an audio file from the given path.
    /// Stops any currently playing audio first.
    pub fn play_file(&mut self, path: &str) -> Result<(), String> {
        log::info!("[AUDIO] Loading file: {}", path);

        // Stop current playback and create a fresh sink
        // We create a new sink each time to ensure clean state
        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        // Open and decode the audio file
        let file = File::open(path)
            .map_err(|e| format!("Failed to open file '{}': {}", path, e))?;
        let reader = BufReader::new(file);

        let source = Decoder::new(reader)
            .map_err(|e| format!("Failed to decode audio '{}': {}", path, e))?;

        // Store duration if available (not all formats report it)
        self.track_duration = source.total_duration();

        // Apply current volume and start playback
        self.sink.set_volume(self.state.volume);
        self.sink.append(source);
        self.sink.play();

        // Update state
        self.state.is_playing = true;
        self.state.position = 0.0;
        self.state.duration = self.track_duration
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        self.state.current_path = path.to_string();

        // Start position tracking
        self.playback_started_at = Some(Instant::now());
        self.position_at_pause = 0.0;

        log::info!("[AUDIO] Playing: {} (duration: {:.1}s)", path, self.state.duration);
        Ok(())
    }

    /// Pause playback
    pub fn pause(&mut self) {
        // Store current position before pausing
        if let Some(started_at) = self.playback_started_at {
            self.position_at_pause = self.position_at_pause + started_at.elapsed().as_secs_f64();
        }
        self.playback_started_at = None;

        self.sink.pause();
        self.state.is_playing = false;
        log::debug!("[AUDIO] Paused at {:.1}s", self.position_at_pause);
    }

    /// Resume playback
    pub fn resume(&mut self) {
        self.sink.play();
        self.state.is_playing = true;
        // Resume position tracking from where we paused
        self.playback_started_at = Some(Instant::now());
        log::debug!("[AUDIO] Resumed from {:.1}s", self.position_at_pause);
    }

    /// Toggle between play and pause
    pub fn toggle_playback(&mut self) {
        if self.state.is_playing {
            self.pause();
        } else {
            self.resume();
        }
    }

    /// Stop playback completely
    pub fn stop(&mut self) {
        self.sink.stop();
        self.state.is_playing = false;
        self.state.position = 0.0;
        self.state.current_path = String::new();
        // Reset position tracking
        self.playback_started_at = None;
        self.position_at_pause = 0.0;
        log::debug!("[AUDIO] Stopped");
    }

    /// Set volume (0.0 to 1.0)
    pub fn set_volume(&mut self, volume: f32) {
        let volume = volume.clamp(0.0, 1.0);
        self.sink.set_volume(volume);
        self.state.volume = volume;
        log::debug!("[AUDIO] Volume set to {:.2}", volume);
    }

    /// Seek to a position (0.0 to 1.0, as a fraction of total duration)
    /// NOTE: rodio's Sink doesn't support seeking directly.
    /// We have to reload the file and skip to the position.
    pub fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        if self.state.current_path.is_empty() {
            return Err("No track loaded".to_string());
        }

        let duration = match self.track_duration {
            Some(d) => d,
            None => return Err("Track duration unknown, cannot seek".to_string()),
        };

        let seek_to = Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        log::debug!("[AUDIO] Seeking to {:.1}s", seek_to.as_secs_f64());

        // Reload the file and skip to the desired position
        let path = self.state.current_path.clone();
        let was_playing = self.state.is_playing;

        self.sink.stop();
        self.sink = Sink::try_new(&self.stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {}", e))?;

        let file = File::open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let reader = BufReader::new(file);

        let source = Decoder::new(reader)
            .map_err(|e| format!("Failed to decode audio: {}", e))?;

        // Skip to the seek position
        let source = source.skip_duration(seek_to);

        self.sink.set_volume(self.state.volume);
        self.sink.append(source);

        // Update position tracking
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

    /// Get current playback state with calculated position
    pub fn get_state(&self) -> PlaybackState {
        let mut state = self.state.clone();

        // Calculate current position from elapsed time
        if let Some(started_at) = self.playback_started_at {
            state.position = self.position_at_pause + started_at.elapsed().as_secs_f64();
            // Clamp to duration if known
            if state.duration > 0.0 && state.position > state.duration {
                state.position = state.duration;
            }
        } else {
            state.position = self.position_at_pause;
        }

        // Check if playback finished
        if self.sink.empty() && state.is_playing {
            state.is_playing = false;
        }
        state
    }

    /// Check if the current track has finished playing
    pub fn is_finished(&self) -> bool {
        self.sink.empty() && !self.state.current_path.is_empty()
    }
}

// =============================================================================
// GLOBAL PLAYER STATE
// =============================================================================
// We use a Mutex to hold the player instance, wrapped in a struct that
// implements Send + Sync for Tauri's state management.
// =============================================================================

pub struct LinuxAudioState {
    pub player: Mutex<Option<AudioPlayer>>,
}

// SAFETY: AudioPlayer is only accessed through the Mutex, which provides
// synchronization. The underlying rodio types are thread-safe when accessed
// this way.
unsafe impl Send for LinuxAudioState {}
unsafe impl Sync for LinuxAudioState {}

impl LinuxAudioState {
    pub fn new() -> Self {
        // Try to initialize the player, but don't fail if audio isn't available
        let player = match AudioPlayer::new() {
            Ok(p) => {
                log::info!("[AUDIO] Linux native audio backend initialized");
                Some(p)
            }
            Err(e) => {
                log::error!("[AUDIO] Failed to initialize audio backend: {}", e);
                None
            }
        };
        Self { player: Mutex::new(player) }
    }
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================
// These commands are exposed to the frontend via Tauri's invoke system.
// They are ONLY registered on Linux - Windows/Mac don't see these commands.
// =============================================================================

/// Play an audio file using the native backend
#[tauri::command]
pub fn linux_audio_play(path: String, state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.play_file(&path)
}

/// Pause playback
#[tauri::command]
pub fn linux_audio_pause(state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.pause();
    Ok(())
}

/// Resume playback
#[tauri::command]
pub fn linux_audio_resume(state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.resume();
    Ok(())
}

/// Stop playback
#[tauri::command]
pub fn linux_audio_stop(state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.stop();
    Ok(())
}

/// Set volume (0.0 to 1.0)
#[tauri::command]
pub fn linux_audio_set_volume(volume: f32, state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.set_volume(volume);
    Ok(())
}

/// Seek to position (0.0 to 1.0 as fraction of duration)
#[tauri::command]
pub fn linux_audio_seek(position: f64, state: tauri::State<'_, LinuxAudioState>) -> Result<(), String> {
    let mut guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_mut().ok_or("Audio backend not initialized")?;
    player.seek(position)
}

/// Get current playback state
#[tauri::command]
pub fn linux_audio_get_state(state: tauri::State<'_, LinuxAudioState>) -> Result<PlaybackState, String> {
    let guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_ref().ok_or("Audio backend not initialized")?;
    Ok(player.get_state())
}

/// Check if the current track has finished
#[tauri::command]
pub fn linux_audio_is_finished(state: tauri::State<'_, LinuxAudioState>) -> Result<bool, String> {
    let guard = state.player.lock().map_err(|_| "Lock poisoned")?;
    let player = guard.as_ref().ok_or("Audio backend not initialized")?;
    Ok(player.is_finished())
}

/// Check if native audio backend is available
/// This command always returns true when compiled with the audio module.
/// The frontend uses this to detect if it should use native audio.
#[tauri::command]
pub fn native_audio_available() -> bool {
    true
}
