use serde::{Deserialize, Serialize};

use super::mod_types::AudioTelemetry;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainVerdict {
    BitPerfect,
    Lossless,
    Processed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainStageStatus {
    Untouched,
    Modified,
    Active,
    Bypassed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainDetail {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStage {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub status: ChainStageStatus,
    pub details: Vec<ChainDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudionChain {
    pub active: bool,
    pub backend: String,
    pub verdict: ChainVerdict,
    pub bit_perfect: bool,
    pub reasons: Vec<String>,
    pub stages: Vec<ChainStage>,
}

#[derive(Debug, Clone)]
pub struct ChainInput {
    pub has_track: bool,
    pub codec: String,
    pub source_sample_rate: u32,
    pub source_bit_depth: Option<u16>,
    pub source_channels: u16,
    pub output_device: String,
    pub output_host: String,
    pub output_sample_rate: u32,
    pub output_bit_depth: Option<u16>,
    pub output_format_label: Option<String>,
    pub output_channels: u16,
    pub exclusive_active: bool,
    pub exclusive_suspended: bool,
    pub exclusive_error: Option<String>,
    pub resampler_active: bool,
    pub eq_enabled: bool,
    pub eq_active: bool,
    pub replay_gain_enabled: bool,
    pub replay_gain_db: Option<f32>,
    pub limiter_enabled: bool,
    pub skip_silence_enabled: bool,
    pub automix_enabled: bool,
    pub crossfade_seconds: u32,
    pub crossfade_active: bool,
    pub volume: f32,
}

/// Returns `Some(true)` for known lossless codecs, `Some(false)` for known
/// lossy codecs, and `None` when the codec is unknown/unprobed.
pub fn classify_lossless(codec: &str) -> Option<bool> {
    let c = codec.trim().to_ascii_lowercase();
    if c.is_empty() || c == "none" || c == "unknown" {
        return None;
    }
    if c.contains("flac")
        || c.contains("alac")
        || c.contains("wav")
        || c.contains("pcm")
        || c.contains("aiff")
        || c.contains("wv")
        || c.contains("wavpack")
        || c.contains("ape")
        || c.contains("tta")
        || c.contains("dsd")
    {
        return Some(true);
    }
    if c.contains("mp3")
        || c.contains("aac")
        || c.contains("opus")
        || c.contains("vorbis")
        || c.contains("ogg")
        || c.contains("wma")
        || c.contains("ac3")
        || c.contains("eac3")
        || c.contains("m4a")
    {
        return Some(false);
    }
    None
}

pub fn parse_format_bit_depth(fmt: Option<&str>) -> Option<u16> {
    let f = fmt?.trim().to_ascii_lowercase();
    if f.contains("32") || f == "f32le" || f == "s32le" {
        Some(32)
    } else if f.contains("24") || f == "s24le" {
        Some(24)
    } else if f.contains("16") || f == "s16le" {
        Some(16)
    } else if f.contains("64") || f == "f64le" {
        Some(64)
    } else if f.contains("8") {
        Some(8)
    } else {
        None
    }
}

fn format_hz(hz: u32) -> String {
    if hz == 0 {
        return "Unknown".to_string();
    }
    if hz % 1000 == 0 {
        format!("{} kHz", hz / 1000)
    } else {
        format!("{:.1} kHz", hz as f64 / 1000.0)
    }
}

pub fn compute_verdict(input: &ChainInput) -> (ChainVerdict, bool, Vec<String>) {
    if !input.has_track {
        return (ChainVerdict::Processed, false, vec!["No track playing".to_string()]);
    }

    let mut reasons = Vec::new();
    let is_lossless = classify_lossless(&input.codec);

    match is_lossless {
        Some(true) => {}
        Some(false) => reasons.push(format!("Lossy source ({})", input.codec)),
        None => reasons.push("Source lossless status unknown".to_string()),
    }

    if input.resampler_active || input.source_sample_rate != input.output_sample_rate {
        reasons.push(format!(
            "Resampling {} -> {}",
            format_hz(input.source_sample_rate),
            format_hz(input.output_sample_rate)
        ));
    }

    match (input.source_bit_depth, input.output_bit_depth) {
        (Some(src), Some(dst)) => {
            if src > dst {
                reasons.push(format!("Bit-depth truncation ({}-bit -> {}-bit)", src, dst));
            }
        }
        _ => reasons.push("Bit depth unknown".to_string()),
    }

    if input.source_channels != input.output_channels {
        reasons.push(format!(
            "Channel mapping ({} ch -> {} ch)",
            input.source_channels, input.output_channels
        ));
    }

    if input.eq_active {
        reasons.push("Equalizer active".to_string());
    }

    let rg_active = input.replay_gain_enabled && input.replay_gain_db.is_some();
    if rg_active {
        if let Some(db) = input.replay_gain_db {
            reasons.push(format!("ReplayGain active ({:+.1} dB)", db));
        } else {
            reasons.push("ReplayGain active".to_string());
        }
    }

    if input.limiter_enabled {
        reasons.push("Limiter active".to_string());
    }

    if input.crossfade_active || input.crossfade_seconds > 0 {
        reasons.push("Crossfade enabled".to_string());
    }

    if input.skip_silence_enabled {
        reasons.push("Skip silence active".to_string());
    }

    if (input.volume - 1.0).abs() > 1e-3 {
        reasons.push(format!("Software volume scaling ({:.0}%)", input.volume * 100.0));
    }

    if !input.exclusive_active {
        if input.exclusive_suspended {
            reasons.push("Exclusive mode suspended (shared OS mixer active)".to_string());
        } else {
            reasons.push("Shared mode output (OS mixer active)".to_string());
        }
    }

    let bit_perfect = reasons.is_empty();
    let verdict = if bit_perfect {
        ChainVerdict::BitPerfect
    } else if is_lossless == Some(true)
        && !input.resampler_active
        && input.source_sample_rate == input.output_sample_rate
        && !input.eq_active
        && !rg_active
        && !input.limiter_enabled
        && !input.crossfade_active
        && !input.skip_silence_enabled
    {
        ChainVerdict::Lossless
    } else {
        ChainVerdict::Processed
    };

    (verdict, bit_perfect, reasons)
}

impl AudionChain {
    pub fn from_telemetry(t: &AudioTelemetry) -> Self {
        let has_track = t.path.is_some() && t.codec != "None";
        let output_fmt = if t.exclusive_active {
            t.exclusive_format.as_deref().or(t.shared_format.as_deref())
        } else {
            t.shared_format.as_deref()
        };
        let output_host = if t.exclusive_active {
            t.exclusive_backend
                .clone()
                .unwrap_or_else(|| "Exclusive".to_string())
        } else {
            t.shared_backend
                .clone()
                .unwrap_or_else(|| "Shared".to_string())
        };
        let output_bit_depth = parse_format_bit_depth(output_fmt);

        let input = ChainInput {
            has_track,
            codec: t.codec.clone(),
            source_sample_rate: t.sample_rate,
            source_bit_depth: t.bit_depth,
            source_channels: t.channels,
            output_device: t.output_device.clone(),
            output_host: output_host.clone(),
            output_sample_rate: t.device_sample_rate,
            output_bit_depth,
            output_format_label: output_fmt.map(|s| s.to_string()),
            output_channels: t.device_channels,
            exclusive_active: t.exclusive_active,
            exclusive_suspended: t.exclusive_suspended,
            exclusive_error: t.exclusive_error.clone(),
            resampler_active: t.resampler_active,
            eq_enabled: t.eq_enabled,
            eq_active: t.eq_active,
            replay_gain_enabled: t.replay_gain_enabled,
            replay_gain_db: t.replay_gain_db,
            limiter_enabled: t.limiter_enabled,
            skip_silence_enabled: t.skip_silence_enabled,
            automix_enabled: t.automix_enabled,
            crossfade_seconds: t.crossfade_seconds,
            crossfade_active: t.crossfade_active,
            volume: t.volume,
        };

        let (verdict, bit_perfect, reasons) = compute_verdict(&input);

        if !has_track {
            return Self {
                active: false,
                backend: "native".to_string(),
                verdict,
                bit_perfect,
                reasons,
                stages: Vec::new(),
            };
        }

        let is_lossless = classify_lossless(&t.codec);
        let src_bit_str = t
            .bit_depth
            .map(|b| format!("{}-bit", b))
            .unwrap_or_else(|| "Unknown".to_string());
        let lossless_str = match is_lossless {
            Some(true) => "Lossless",
            Some(false) => "Lossy",
            None => "Unknown",
        };

        let source_stage = ChainStage {
            id: "source".to_string(),
            title: "Source".to_string(),
            subtitle: format!(
                "{} • {} • {} • {} ch",
                t.codec.to_uppercase(),
                format_hz(t.sample_rate),
                src_bit_str,
                t.channels
            ),
            status: if is_lossless == Some(true) {
                ChainStageStatus::Untouched
            } else if is_lossless == Some(false) {
                ChainStageStatus::Modified
            } else {
                ChainStageStatus::Unknown
            },
            details: vec![
                ChainDetail {
                    label: "Codec".to_string(),
                    value: t.codec.to_uppercase(),
                },
                ChainDetail {
                    label: "Quality".to_string(),
                    value: lossless_str.to_string(),
                },
                ChainDetail {
                    label: "Sample Rate".to_string(),
                    value: format!("{} ({} Hz)", format_hz(t.sample_rate), t.sample_rate),
                },
                ChainDetail {
                    label: "Bit Depth".to_string(),
                    value: src_bit_str,
                },
                ChainDetail {
                    label: "Channels".to_string(),
                    value: format!("{} ch", t.channels),
                },
            ],
        };

        let decoder_name = if t.codec.eq_ignore_ascii_case("opus") {
            "libopus"
        } else {
            "Symphonia"
        };
        let decoder_stage = ChainStage {
            id: "decoder".to_string(),
            title: "Decoder".to_string(),
            subtitle: format!("{} • 32-bit float (f32)", decoder_name),
            status: ChainStageStatus::Untouched,
            details: vec![
                ChainDetail {
                    label: "Decoder".to_string(),
                    value: decoder_name.to_string(),
                },
                ChainDetail {
                    label: "Decoded Format".to_string(),
                    value: "32-bit IEEE Float".to_string(),
                },
            ],
        };

        let rg_applied = t.replay_gain_enabled && t.replay_gain_db.is_some();
        let any_dsp = t.resampler_active
            || t.eq_active
            || rg_applied
            || t.limiter_enabled
            || t.crossfade_active
            || t.skip_silence_enabled
            || t.automix_enabled;

        let mut proc_parts = Vec::new();
        if t.resampler_active {
            proc_parts.push(format!(
                "Rubato ({} -> {})",
                format_hz(t.sample_rate),
                format_hz(t.device_sample_rate)
            ));
        }
        if t.eq_active {
            proc_parts.push("EQ".to_string());
        }
        if rg_applied {
            if let Some(db) = t.replay_gain_db {
                proc_parts.push(format!("ReplayGain ({:+.1} dB)", db));
            }
        }
        if t.limiter_enabled {
            proc_parts.push("Limiter".to_string());
        }
        if t.crossfade_active {
            proc_parts.push("Crossfade".to_string());
        }
        let proc_subtitle = if proc_parts.is_empty() {
            "All DSP bypassed".to_string()
        } else {
            proc_parts.join(" • ")
        };

        let processing_stage = ChainStage {
            id: "processing".to_string(),
            title: "Processing".to_string(),
            subtitle: proc_subtitle,
            status: if any_dsp {
                ChainStageStatus::Modified
            } else {
                ChainStageStatus::Bypassed
            },
            details: vec![
                ChainDetail {
                    label: "Resampler".to_string(),
                    value: if t.resampler_active {
                        format!(
                            "Active ({} -> {})",
                            format_hz(t.sample_rate),
                            format_hz(t.device_sample_rate)
                        )
                    } else {
                        "Bypassed".to_string()
                    },
                },
                ChainDetail {
                    label: "Equalizer".to_string(),
                    value: if t.eq_active {
                        "Active".to_string()
                    } else if t.eq_enabled {
                        "Enabled (Flat)".to_string()
                    } else {
                        "Off".to_string()
                    },
                },
                ChainDetail {
                    label: "ReplayGain".to_string(),
                    value: if rg_applied {
                        format!("Active ({:+.1} dB)", t.replay_gain_db.unwrap_or(0.0))
                    } else if t.replay_gain_enabled {
                        "Enabled (No tag)".to_string()
                    } else {
                        "Off".to_string()
                    },
                },
                ChainDetail {
                    label: "Limiter".to_string(),
                    value: if t.limiter_enabled { "On" } else { "Off" }.to_string(),
                },
                ChainDetail {
                    label: "Crossfade".to_string(),
                    value: if t.crossfade_active {
                        format!("Active ({}s)", t.crossfade_seconds)
                    } else if t.crossfade_seconds > 0 {
                        format!("Armed ({}s)", t.crossfade_seconds)
                    } else {
                        "Off".to_string()
                    },
                },
            ],
        };

        let is_unity = (t.volume - 1.0).abs() <= 1e-3;
        let volume_stage = ChainStage {
            id: "volume".to_string(),
            title: "Volume Control".to_string(),
            subtitle: if is_unity {
                "Software • 100% (Unity Gain)".to_string()
            } else {
                format!("Software • {:.0}%", t.volume * 100.0)
            },
            status: if is_unity {
                ChainStageStatus::Untouched
            } else {
                ChainStageStatus::Modified
            },
            details: vec![
                ChainDetail {
                    label: "Mode".to_string(),
                    value: "Software (App-level)".to_string(),
                },
                ChainDetail {
                    label: "Gain".to_string(),
                    value: if is_unity {
                        "100% (Unity Gain)".to_string()
                    } else {
                        format!("{:.0}%", t.volume * 100.0)
                    },
                },
            ],
        };

        let out_bit_str = output_bit_depth
            .map(|b| format!("{}-bit", b))
            .unwrap_or_else(|| "Unknown".to_string());
        let output_stage = ChainStage {
            id: "output".to_string(),
            title: "Output".to_string(),
            subtitle: format!(
                "{} • {} • {} • {}",
                t.output_device,
                output_host,
                format_hz(t.device_sample_rate),
                out_bit_str
            ),
            status: if t.exclusive_active {
                ChainStageStatus::Untouched
            } else {
                ChainStageStatus::Modified
            },
            details: vec![
                ChainDetail {
                    label: "Device".to_string(),
                    value: t.output_device.clone(),
                },
                ChainDetail {
                    label: "Host API".to_string(),
                    value: output_host,
                },
                ChainDetail {
                    label: "Sample Rate".to_string(),
                    value: format!(
                        "{} ({} Hz)",
                        format_hz(t.device_sample_rate),
                        t.device_sample_rate
                    ),
                },
                ChainDetail {
                    label: "Format".to_string(),
                    value: output_fmt
                        .map(|f| format!("{} ({})", out_bit_str, f))
                        .unwrap_or(out_bit_str),
                },
                ChainDetail {
                    label: "Channels".to_string(),
                    value: format!("{} ch", t.device_channels),
                },
            ],
        };

        Self {
            active: true,
            backend: "native".to_string(),
            verdict,
            bit_perfect,
            reasons,
            stages: vec![
                source_stage,
                decoder_stage,
                processing_stage,
                volume_stage,
                output_stage,
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_exclusive_flac() -> ChainInput {
        ChainInput {
            has_track: true,
            codec: "flac".to_string(),
            source_sample_rate: 44100,
            source_bit_depth: Some(16),
            source_channels: 2,
            output_device: "Arturia MiniFuse 1".to_string(),
            output_host: "wasapi-exclusive".to_string(),
            output_sample_rate: 44100,
            output_bit_depth: Some(24),
            output_format_label: Some("s24le".to_string()),
            output_channels: 2,
            exclusive_active: true,
            exclusive_suspended: false,
            exclusive_error: None,
            resampler_active: false,
            eq_enabled: false,
            eq_active: false,
            replay_gain_enabled: false,
            replay_gain_db: None,
            limiter_enabled: false,
            skip_silence_enabled: false,
            automix_enabled: false,
            crossfade_seconds: 0,
            crossfade_active: false,
            volume: 1.0,
        }
    }

    #[test]
    fn verdict_is_bit_perfect_when_pure_exclusive() {
        let input = base_exclusive_flac();
        let (verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(bit_perfect);
        assert_eq!(verdict, ChainVerdict::BitPerfect);
        assert!(reasons.is_empty());
    }

    #[test]
    fn verdict_not_bit_perfect_when_resampling() {
        let mut input = base_exclusive_flac();
        input.source_sample_rate = 96000;
        input.output_sample_rate = 48000;
        input.resampler_active = true;
        let (verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(!bit_perfect);
        assert_eq!(verdict, ChainVerdict::Processed);
        assert!(reasons.iter().any(|r| r.contains("Resampling")));
    }

    #[test]
    fn verdict_not_bit_perfect_when_replay_gain_active() {
        let mut input = base_exclusive_flac();
        input.replay_gain_enabled = true;
        input.replay_gain_db = Some(-4.5);
        let (verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(!bit_perfect);
        assert_eq!(verdict, ChainVerdict::Processed);
        assert!(reasons.iter().any(|r| r.contains("ReplayGain")));
    }

    #[test]
    fn verdict_not_bit_perfect_in_shared_mode() {
        let mut input = base_exclusive_flac();
        input.exclusive_active = false;
        let (verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(!bit_perfect);
        assert_eq!(verdict, ChainVerdict::Lossless);
        assert!(reasons.iter().any(|r| r.contains("Shared mode")));
    }

    #[test]
    fn verdict_never_lossless_or_bit_perfect_for_lossy() {
        let mut input = base_exclusive_flac();
        input.codec = "mp3".to_string();
        let (verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(!bit_perfect);
        assert_eq!(verdict, ChainVerdict::Processed);
        assert!(reasons.iter().any(|r| r.contains("Lossy source")));
    }

    #[test]
    fn verdict_not_bit_perfect_when_bit_depth_truncated_or_volume_scaled() {
        let mut input = base_exclusive_flac();
        input.source_bit_depth = Some(24);
        input.output_bit_depth = Some(16);
        input.volume = 0.7;
        let (_verdict, bit_perfect, reasons) = compute_verdict(&input);
        assert!(!bit_perfect);
        assert!(reasons.iter().any(|r| r.contains("Bit-depth truncation")));
        assert!(reasons.iter().any(|r| r.contains("volume scaling")));
    }
}
