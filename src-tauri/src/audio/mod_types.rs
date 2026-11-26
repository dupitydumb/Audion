use std::num::NonZero;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use rodio::Source;

use super::symphonia::SymphoniaSource;
use super::opus::OpusSource;
use super::resampler::RubatoResampler;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTelemetry {
    pub path: Option<String>,
    pub codec: String,
    pub bit_depth: Option<u16>,
    pub sample_rate: u32,
    pub channels: u16,
    pub device_sample_rate: u32,
    pub device_channels: u16,
    pub resampler_active: bool,
    pub output_device: String,
    pub replay_gain_db: Option<f32>,
    pub limiter_enabled: bool,
    /// user preference, persisted setting echo only
    pub exclusive_requested: bool,
    /// verified: the negotiated stream is genuinely exclusive
    pub exclusive_active: bool,
    pub exclusive_supported: bool,
    pub exclusive_suspended: bool,
    pub exclusive_backend: Option<String>,
    pub exclusive_format: Option<String>,
    pub exclusive_error: Option<String>,
    pub shared_backend: Option<String>,
    pub shared_format: Option<String>,
    pub eq_enabled: bool,
    pub eq_active: bool,
    pub replay_gain_enabled: bool,
    pub skip_silence_enabled: bool,
    pub automix_enabled: bool,
    pub crossfade_seconds: u32,
    pub crossfade_active: bool,
    pub volume: f32,
}

impl Default for AudioTelemetry {
    fn default() -> Self {
        Self {
            path: None,
            codec: "None".to_string(),
            bit_depth: None,
            sample_rate: 44100,
            channels: 2,
            device_sample_rate: 44100,
            device_channels: 2,
            resampler_active: false,
            output_device: "Default".to_string(),
            replay_gain_db: None,
            limiter_enabled: true,
            exclusive_requested: false,
            exclusive_active: false,
            exclusive_supported: false,
            exclusive_suspended: false,
            exclusive_backend: None,
            exclusive_format: None,
            exclusive_error: None,
            shared_backend: None,
            shared_format: None,
            eq_enabled: false,
            eq_active: false,
            replay_gain_enabled: true,
            skip_silence_enabled: false,
            automix_enabled: false,
            crossfade_seconds: 0,
            crossfade_active: false,
            volume: 1.0,
        }
    }
}

/// verified exclusive state, returned by the exclusive commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExclusiveStatus {
    pub requested: bool,
    pub active: bool,
    pub supported: bool,
    pub suspended: bool,
    pub backend: Option<String>,
    pub sample_rate: u32,
    pub channels: u16,
    pub format: Option<String>,
    pub reason: Option<String>,
}

impl Default for ExclusiveStatus {
    fn default() -> Self {
        Self {
            requested: false,
            active: false,
            supported: false,
            suspended: false,
            backend: None,
            sample_rate: 44100,
            channels: 2,
            format: None,
            reason: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExclusiveCapability {
    pub supported: bool,
    pub backend: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub driver: Option<String>,
    pub device_type: String,
    pub interface_type: String,
    pub address: Option<String>,
    pub extended: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceList {
    pub devices: Vec<AudioDeviceInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum AudioEvent {
    TrackFinished { generation: u64 },
    TrackAdvanced { generation: u64, new_path: String, duration: Option<Duration> },
    StateChanged { position: f64 },
    DeviceListChanged { devices: DeviceList },
    ExclusiveStateChanged { status: ExclusiveStatus },
    Error { message: String },
}

/// the decoded but not yet resampled stage:
/// whichever codec path produced samples for this track, before RubatoResampler (if needed) sits on top
/// this is the seam that lets OpusSource (opus.rs, pure-rust opus-rs decode,
/// since Symphonia has no built-in Opus decoder) sit alongside SymphoniaSource
pub enum DecodedSource {
    Symphonia(SymphoniaSource),
    Opus(OpusSource),
}

impl DecodedSource {
    /// forwarded to whichever inner source is active
    /// kept here only for call sites that hold a 'DecodedSource' directly
    /// (before it's wrapped in ReadySource) and want an initial seek
    pub fn seek(&mut self, pos: Duration) {
        match self {
            Self::Symphonia(s) => s.seek(pos),
            Self::Opus(o) => o.seek(pos),
        }
    }

    pub fn duration(&self) -> Option<Duration> {
        match self {
            Self::Symphonia(s) => s.duration,
            Self::Opus(o) => o.duration,
        }
    }

    pub fn codec_name(&self) -> String {
        match self {
            Self::Symphonia(s) => s.codec_name.clone(),
            Self::Opus(_) => "Opus".to_string(),
        }
    }

    pub fn bits_per_sample(&self) -> Option<u16> {
        match self {
            Self::Symphonia(s) => s.bits_per_sample,
            Self::Opus(_) => Some(16),
        }
    }
}

impl Iterator for DecodedSource {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        match self {
            Self::Symphonia(s) => s.next(),
            Self::Opus(o) => o.next(),
        }
    }
}

impl Source for DecodedSource {
    fn current_span_len(&self) -> Option<usize> {
        match self {
            Self::Symphonia(s) => s.current_span_len(),
            Self::Opus(o) => o.current_span_len(),
        }
    }
    fn channels(&self) -> NonZero<u16> {
        match self {
            Self::Symphonia(s) => s.channels(),
            Self::Opus(o) => o.channels(),
        }
    }
    fn sample_rate(&self) -> NonZero<u32> {
        match self {
            Self::Symphonia(s) => s.sample_rate(),
            Self::Opus(o) => o.sample_rate(),
        }
    }
    fn total_duration(&self) -> Option<Duration> {
        match self {
            Self::Symphonia(s) => s.total_duration(),
            Self::Opus(o) => o.total_duration(),
        }
    }
}

// the gated dual source pipeline (dual_track.rs) has no overlap buffer to capture a replay prefix from
// sp every ReadySource in the pipeline is either 'Raw' or 'Resampled'
pub enum ReadySource {
    Raw(DecodedSource),
    Resampled(RubatoResampler),
}

impl Iterator for ReadySource {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        match self {
            Self::Raw(s) => s.next(),
            Self::Resampled(r) => r.next(),
        }
    }
}

impl Source for ReadySource {
    fn current_span_len(&self) -> Option<usize> {
        match self {
            Self::Raw(s) => s.current_span_len(),
            Self::Resampled(r) => r.current_span_len(),
        }
    }
    fn channels(&self) -> NonZero<u16> {
        match self {
            Self::Raw(s) => s.channels(),
            Self::Resampled(r) => r.channels(),
        }
    }
    fn sample_rate(&self) -> NonZero<u32> {
        match self {
            Self::Raw(s) => s.sample_rate(),
            Self::Resampled(r) => r.sample_rate(),
        }
    }
    fn total_duration(&self) -> Option<Duration> {
        match self {
            Self::Raw(s) => s.total_duration(),
            Self::Resampled(r) => r.total_duration(),
        }
    }
}
