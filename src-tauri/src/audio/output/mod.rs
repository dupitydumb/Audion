//! Audio output sinks.
//!
//! Shared mode is rodio's MixerDeviceSink over cpal. On Windows the exclusive
//! path is a raw WASAPI IAudioClient in AUDCLNT_SHAREMODE_EXCLUSIVE, because
//! cpal 0.17 only implements shared mode. On Linux the exclusive path is a
//! direct ALSA `hw:` PCM opened through cpal/rodio.

use serde::Serialize;

use super::mod_types::ExclusiveCapability;

pub mod shared;

#[cfg(target_os = "linux")]
pub mod alsa;

#[cfg(target_os = "windows")]
pub mod wasapi;

/// what the driver actually accepted, never what we asked for
#[derive(Debug, Clone, Serialize)]
pub struct NegotiatedFormat {
    pub sample_rate: u32,
    pub channels: u16,
    /// "f32le" | "s32le" | "s24le" | "s16le"
    pub sample_format: String,
}

/// owns whatever the engine's samples are rendered through
pub enum OutputSink {
    /// rodio/cpal output (shared mode, or ALSA hw device on Linux)
    Shared(rodio::MixerDeviceSink),
    /// Windows WASAPI exclusive client with its own render thread
    #[cfg(target_os = "windows")]
    Wasapi(wasapi::WasapiExclusiveSink),
    /// transient state while the engine is being rebuilt
    Closed,
}

/// what exclusive output is possible on this build
pub fn exclusive_capability() -> ExclusiveCapability {
    #[cfg(target_os = "windows")]
    {
        ExclusiveCapability {
            supported: true,
            backend: Some("wasapi-exclusive".to_string()),
            reason: None,
        }
    }
    #[cfg(target_os = "linux")]
    {
        ExclusiveCapability {
            supported: true,
            backend: Some("alsa-hw".to_string()),
            reason: Some("Select a hardware (hw:) ALSA output device".to_string()),
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        ExclusiveCapability {
            supported: false,
            backend: None,
            reason: Some("Exclusive output is not supported on this platform".to_string()),
        }
    }
}
