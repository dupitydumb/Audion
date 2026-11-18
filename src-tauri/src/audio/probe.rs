use std::fs::File;
use std::num::NonZero;
use std::path::PathBuf;

use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::TrackType;
use symphonia::core::io::MediaSourceStream;

use super::symphonia::probe_with_fallback;

/// header-only audio format peek, no decoding
#[derive(Debug, Clone, Copy)]
pub struct TrackFormat {
    pub sample_rate: NonZero<u32>,
    pub channels: NonZero<u16>,
}

/// opus decode rate, matches OpusSource::OPUS_DECODE_RATE (48 kHz)
const OPUS_RATE: u32 = 48_000;

pub fn probe_audio_format(path: &str) -> Result<TrackFormat, String> {
    let ext = PathBuf::from(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());

    // opus-rs decodes at 48 kHz regardless of the file header
    if ext.as_deref() == Some("opus") {
        return Ok(TrackFormat {
            sample_rate: NonZero::new(OPUS_RATE).expect("48000 is nonzero"),
            channels: NonZero::new(2).expect("2 is nonzero"),
        });
    }

    let file = File::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = ext {
        hint.with_extension(&ext);
    }

    let format = probe_with_fallback(path, mss, &hint)
        .map_err(|e| format!("Failed to probe {}: {}", path, e))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| format!("No audio track found in {}", path))?;
    let params = match &track.codec_params {
        Some(symphonia::core::codecs::CodecParameters::Audio(p)) => p,
        _ => return Err(format!("No audio codec params in {}", path)),
    };

    let sample_rate = NonZero::new(params.sample_rate.unwrap_or(44100))
        .ok_or("Sample rate is 0")?;
    let channels = NonZero::new(
        params
            .channels
            .as_ref()
            .map(|c| c.count() as u16)
            .unwrap_or(2)
            .clamp(1, 8),
    )
    .ok_or("Channel count is 0")?;

    Ok(TrackFormat {
        sample_rate,
        channels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_missing_file_errors() {
        assert!(probe_audio_format("Z:/definitely/missing.flac").is_err());
    }

    #[test]
    fn opus_is_always_48k() {
        // opus short-circuits before opening the file
        let f = probe_audio_format("whatever.opus").unwrap();
        assert_eq!(f.sample_rate.get(), 48_000);
        assert_eq!(f.channels.get(), 2);
    }
}
