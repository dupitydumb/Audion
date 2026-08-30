use std::num::NonZero;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use rodio::Source;

use super::symphonia::SymphoniaSource;
use super::resampler::RubatoResampler;

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
    Error { message: String },
}

// the gated dual source pipeline (dual_track.rs) has no overlap buffer to capture a replay prefix from
// sp every ReadySource in the pipeline is either 'Raw' or 'Resampled'
pub enum ReadySource {
    Raw(SymphoniaSource),
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
