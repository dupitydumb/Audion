//! Linux exclusive output: a direct ALSA `hw:` PCM, no dmix, no plug layer.
//!
//! cpal enumerates raw ALSA PCM ids, so `hw:CARD=X,DEV=Y` reaches the hardware
//! directly. `default`, `pipewire`, `pulse`, `sysdefault` and `plughw:` route
//! through a plugin that converts or mixes, so they are refused.

use cpal::traits::{DeviceTrait, HostTrait};

use super::NegotiatedFormat;

/// strips a cpal host prefix and maps a playable device id to a raw `hw:` PCM
/// `plughw:CARD=X,DEV=0` -> `hw:CARD=X,DEV=0`
/// `hw:CARD=X,DEV=0` -> unchanged
/// anything that goes through a conversion plugin -> `None`
pub fn to_hw_pcm_id(device_id: &str) -> Option<String> {
    let pcm = match device_id.split_once(':') {
        Some((host, rest)) if host.eq_ignore_ascii_case("alsa") => rest,
        _ => device_id,
    };
    let lower = pcm.to_ascii_lowercase();
    if lower.starts_with("hw:") {
        Some(pcm.to_string())
    } else if lower.starts_with("plughw:") {
        Some(format!("hw:{}", &pcm["plughw:".len()..]))
    } else if lower == "default"
        || lower.starts_with("pipewire")
        || lower.starts_with("pulse")
        || lower.starts_with("sysdefault")
        || lower.starts_with("null")
    {
        None
    } else {
        // a bare card name like "hw" or an unknown alias: not provably direct
        None
    }
}

/// narrows the device's advertised configs to exactly the requested rate and
/// channel count, preferring float then wider integer formats
fn pick_exact_config(
    device: &cpal::Device,
    sample_rate: u32,
    channels: u16,
) -> Result<cpal::SupportedStreamConfig, String> {
    let configs = device
        .supported_output_configs()
        .map_err(|e| format!("Failed to query output configs: {}", e))?;

    let mut best: Option<(u8, cpal::SupportedStreamConfig)> = None;
    for range in configs {
        if range.channels() != channels {
            continue;
        }
        if sample_rate < range.min_sample_rate() || sample_rate > range.max_sample_rate() {
            continue;
        }
        let rank = match range.sample_format() {
            cpal::SampleFormat::F32 => 0,
            cpal::SampleFormat::I32 => 1,
            cpal::SampleFormat::I16 => 2,
            cpal::SampleFormat::U8 => 9,
            _ => 5,
        };
        let Some(cfg) = range.try_with_sample_rate(sample_rate) else {
            continue;
        };
        if best.as_ref().is_none_or(|(r, _)| rank < *r) {
            best = Some((rank, cfg));
        }
    }

    best.map(|(_, cfg)| cfg).ok_or_else(|| {
        format!(
            "Device does not support {} Hz / {} ch natively",
            sample_rate, channels
        )
    })
}

/// opens the device's raw hardware PCM at exactly the requested format
pub fn open_exclusive(
    host: &cpal::Host,
    device_id: &str,
    sample_rate: u32,
    channels: u16,
) -> Result<(rodio::MixerDeviceSink, NegotiatedFormat), String> {
    use std::str::FromStr;

    let device = cpal::DeviceId::from_str(device_id)
        .ok()
        .and_then(|id| host.device_by_id(&id))
        .ok_or_else(|| format!("Output device '{}' not found", device_id))?;

    let cfg = pick_exact_config(&device, sample_rate, channels)?;

    let builder = rodio::DeviceSinkBuilder::from_device(device)
        .map_err(|e| format!("Failed to open '{}': {}", device_id, e))?;
    let sink = builder
        .with_config(&cpal::StreamConfig {
            channels,
            sample_rate,
            buffer_size: cpal::BufferSize::Default,
        })
        .with_sample_format(cfg.sample_format())
        .open_stream()
        .map_err(|e| format!("Exclusive open of '{}' failed: {}", device_id, e))?;

    let negotiated = NegotiatedFormat {
        sample_rate,
        channels,
        sample_format: format!("{:?}", cfg.sample_format()).to_ascii_lowercase(),
    };
    Ok((sink, negotiated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hw_ids_are_preserved() {
        assert_eq!(
            to_hw_pcm_id("alsa:hw:CARD=USB,DEV=0").as_deref(),
            Some("hw:CARD=USB,DEV=0")
        );
        assert_eq!(to_hw_pcm_id("hw:0,0").as_deref(), Some("hw:0,0"));
    }

    #[test]
    fn plug_ids_are_downgraded_to_hw() {
        assert_eq!(
            to_hw_pcm_id("alsa:plughw:CARD=PCH,DEV=1").as_deref(),
            Some("hw:CARD=PCH,DEV=1")
        );
    }

    #[test]
    fn converting_ids_are_refused() {
        for id in ["alsa:default", "alsa:pipewire", "alsa:pulse", "sysdefault:CARD=PCH", "alsa:null"] {
            assert_eq!(to_hw_pcm_id(id), None, "{} must be refused", id);
        }
    }
}
