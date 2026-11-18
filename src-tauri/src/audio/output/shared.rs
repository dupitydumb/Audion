//! Shared-mode cpal output, the default path on every platform.

use std::str::FromStr;

use cpal::DeviceId;

/// rank for fallback output devices, lower is tried first
/// 'None' means never try it
/// on Linux the ALSA "default" pcm often routes to dmix,
/// which fails with "unable to open slave" when PipeWire/PulseAudio owns the card and the ALSA bridge plugin isn't installed
pub fn fallback_rank(id: &str) -> Option<u8> {
    let l = id.to_lowercase();
    if l.contains("null") {
        None
    } else if l.contains("pipewire") {
        Some(0)
    } else if l.contains("pulse") {
        Some(1)
    } else if l.contains("sysdefault") {
        Some(2)
    } else if l.contains("default") {
        Some(3)
    } else if l.contains("plughw") {
        Some(5)
    } else if l.contains("hw:") {
        Some(6)
    } else {
        Some(4)
    }
}

/// opens an output stream on the first device that works: the requested device,
/// then the system default, then every other output device
/// only fails when none of them can be opened
pub fn open_output_stream(
    host: &cpal::Host,
    preferred_device_id: Option<&str>,
    all_devices: &[cpal::Device],
) -> Result<(rodio::MixerDeviceSink, cpal::SupportedStreamConfig, String), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let mut candidates: Vec<(String, cpal::Device)> = Vec::new();

    if let Some(id_str) = preferred_device_id {
        match DeviceId::from_str(id_str) {
            Ok(id) => match host.device_by_id(&id) {
                Some(d) => candidates.push((id_str.to_string(), d)),
                None => tracing::warn!("[AUDIO] Device id '{}' not found, using default", id_str),
            },
            Err(_) => tracing::warn!("[AUDIO] Invalid device id '{}', using default", id_str),
        }
    }

    if let Some(d) = host.default_output_device() {
        let label = d.id().map(|i| i.to_string()).unwrap_or_else(|_| "default".to_string());
        if !candidates.iter().any(|(l, _)| *l == label) {
            candidates.push((label, d));
        }
    }

    let mut rest: Vec<(u8, String, cpal::Device)> = all_devices
        .iter()
        .filter_map(|d| {
            let label = d.id().ok()?.to_string();
            let rank = fallback_rank(&label)?;
            Some((rank, label, d.clone()))
        })
        .collect();
    rest.sort_by_key(|(rank, _, _)| *rank);
    for (_, label, d) in rest {
        if !candidates.iter().any(|(l, _)| *l == label) {
            candidates.push((label, d));
        }
    }

    if candidates.is_empty() {
        return Err("No audio output device found".to_string());
    }

    let total = candidates.len();
    let mut errors: Vec<String> = Vec::new();
    for (label, device) in candidates {
        let config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("[AUDIO] '{}': failed to get output config: {}", label, e);
                errors.push(format!("{}: failed to get output config: {}", label, e));
                continue;
            }
        };
        let builder = match rodio::DeviceSinkBuilder::from_device(device) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("[AUDIO] '{}': failed to open audio output: {}", label, e);
                errors.push(format!("{}: failed to open audio output: {}", label, e));
                continue;
            }
        };
        match builder.with_supported_config(&config).open_stream() {
            Ok(stream) => {
                if !errors.is_empty() {
                    tracing::warn!(
                        "[AUDIO] Using fallback output device '{}' after {} failed attempt(s)",
                        label, errors.len()
                    );
                }
                return Ok((stream, config, label));
            }
            Err(e) => {
                tracing::warn!("[AUDIO] '{}': failed to open audio output: {}", label, e);
                errors.push(format!("{}: failed to open audio output: {}", label, e));
            }
        }
    }

    // keep the message short, toast has less space
    let first = errors.first().cloned().unwrap_or_default();
    Err(format!("No usable audio output device (tried {}). First error: {}", total, first))
}
