use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use std::num::NonZero;
use crossbeam::channel::{Receiver, Sender};
use rodio::Source;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, RawValue, StandardTag};
use symphonia::core::formats::probe::Hint;

use super::mod_types::AudioEvent;

// =============================================================================
// REPLAY GAIN
// =============================================================================

pub(super) fn resolve_replay_gain(
    pre_scanned_db: Option<f32>,
    format: &mut Box<dyn FormatReader>,
) -> Option<f32> {
    if let Some(db) = pre_scanned_db {
        return Some(db_to_linear(db));
    }

    let metadata = format.metadata();
    let tags_iter = metadata.current()
        .map(|m| m.media.tags.as_slice())
        .unwrap_or_default()
        .iter();

    let mut track_gain_db: Option<f32> = None;
    let mut album_gain_db: Option<f32> = None;
    let mut r128_gain: Option<f32> = None;

    for tag in tags_iter {
        if let Some(ref std_tag) = tag.std {
            match std_tag {
                StandardTag::ReplayGainTrackGain(s) => {
                    track_gain_db = parse_gain_str(s);
                }
                StandardTag::ReplayGainAlbumGain(s) => {
                    album_gain_db = parse_gain_str(s);
                }
                _ => {}
            }
        } else if tag.raw.key.eq_ignore_ascii_case("R128_TRACK_GAIN") {
            if let RawValue::String(ref s) = tag.raw.value {
                if let Ok(raw) = s.trim().parse::<i32>() {
                    r128_gain = Some((raw as f32 / 256.0) + 5.0);
                }
            }
        }
    }

    let db = track_gain_db.or(album_gain_db).or(r128_gain)?;
    Some(db_to_linear(db))
}

fn parse_gain_str(s: &str) -> Option<f32> {
    let cleaned = s
        .trim()
        .trim_end_matches(|c: char| c == 'B' || c == 'b')
        .trim_end_matches(|c: char| c == 'd' || c == 'D')
        .trim();
    cleaned.parse::<f32>().ok()
}

#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

// =============================================================================
// channel_map => ITU-R BS.775 / SMPTE channel matrix for all src/dst pairs
// =============================================================================

fn channel_map(buf: &mut Vec<f32>, src_ch: u16, dst_ch: u16) {
    if src_ch == dst_ch { return; }

    const C3:  f32 = 0.7071; // −3 dB
    const C10: f32 = 0.3162; // −10 dB

    let src    = src_ch as usize;
    let dst    = dst_ch as usize;
    let frames = buf.len() / src;

    if src == 1 {
        buf.resize(frames * dst, 0.0);
        for i in (0..frames).rev() {
            let m = buf[i];
            for c in 0..dst { buf[i * dst + c] = m; }
        }
        return;
    }

    let old: Vec<f32> = buf.drain(..).collect();
    buf.reserve(frames * dst);

    #[inline(always)]
    fn s(x: f32) -> f32 { x.clamp(-1.0, 1.0) }

    for f in old.chunks_exact(src) {
        let (fl, fr) = (f[0], f[1]);
        let c = match src { 3 | 5..=8 => f[2], _ => 0.0 };
        let lfe = match src { 6..=8 => f[3], _ => 0.0 };
        let (ls, rs) = match src {
            4        => (f[2], f[3]),
            5        => (f[3], f[4]),
            6..=8    => (f[4], f[5]),
            _        => (0.0,  0.0),
        };
        let (lrs, rrs) = match src {
            7 => (f[6], f[6]),
            8 => (f[6], f[7]),
            _ => (0.0,  0.0),
        };

        let dl = fl + c*C3 + lfe*C10 + ls*C3 + lrs*C3;
        let dr = fr + c*C3 + lfe*C10 + rs*C3 + rrs*C3;
        let pc = (fl + fr) * C3;
        let dls = fl * C3;
        let drs = fr * C3;
        let dlrs = dls * C3;
        let drrs = drs * C3;

        match (src, dst) {
            (_, 1) => {
                buf.push(s(
                    fl * C3 + fr * C3
                    + c
                    + lfe * C10
                    + (ls  + rs ) * 0.5
                    + (lrs + rrs) * 0.5
                ));
            }
            (_, 2) => {
                buf.push(s(dl));
                buf.push(s(dr));
            }
            (4, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s((ls + rs) * 0.5));
            }
            (5, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c + (ls + rs) * C3 * 0.5));
            }
            (6, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c + lfe*C10 + (ls + rs) * C3 * 0.5));
            }
            (7, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c + lfe*C10 + (ls + rs) * C3 * 0.5 + lrs*C3));
            }
            (8, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c + lfe*C10 + (ls + rs) * C3 * 0.5 + (lrs + rrs) * C3 * 0.5));
            }
            (5, 4) => {
                buf.push(s(fl + c*C3));
                buf.push(s(fr + c*C3));
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (6, 4) => {
                buf.push(s(fl + c*C3 + lfe*C10));
                buf.push(s(fr + c*C3 + lfe*C10));
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (7, 4) => {
                buf.push(s(fl + c*C3 + lfe*C10));
                buf.push(s(fr + c*C3 + lfe*C10));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (8, 4) => {
                buf.push(s(fl + c*C3 + lfe*C10));
                buf.push(s(fr + c*C3 + lfe*C10));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (6, 5) => {
                buf.push(s(fl + lfe*C10));
                buf.push(s(fr + lfe*C10));
                buf.push(s(c));
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (7, 5) => {
                buf.push(s(fl + lfe*C10));
                buf.push(s(fr + lfe*C10));
                buf.push(s(c));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (8, 5) => {
                buf.push(s(fl + lfe*C10));
                buf.push(s(fr + lfe*C10));
                buf.push(s(c));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (7, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (8, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls + lrs*C3));
                buf.push(s(rs + rrs*C3));
            }
            (8, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s((lrs + rrs) * 0.5));
            }
            (2, 3) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
            }
            (2, 4) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (2, 5) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (2, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (2, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
                buf.push(s((dls + drs) * 0.5));
            }
            (2, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
                buf.push(s(dlrs));
                buf.push(s(drrs));
            }
            (3, 4) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (3, 5) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (3, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
            }
            (3, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
                buf.push(s((dls + drs) * 0.5));
            }
            (3, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(dls));
                buf.push(s(drs));
                buf.push(s(dlrs));
                buf.push(s(drrs));
            }
            (4, 5) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (4, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (4, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s((ls + rs) * 0.5 * C3));
            }
            (4, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(pc));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s(ls * C3));
                buf.push(s(rs * C3));
            }
            (5, 6) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
            }
            (5, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s((ls + rs) * 0.5 * C3));
            }
            (5, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(0.0);
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s(ls * C3));
                buf.push(s(rs * C3));
            }
            (6, 7) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s((ls + rs) * 0.5 * C3));
            }
            (6, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s(ls * C3));
                buf.push(s(rs * C3));
            }
            (7, 8) => {
                buf.push(s(fl));
                buf.push(s(fr));
                buf.push(s(c));
                buf.push(s(lfe));
                buf.push(s(ls));
                buf.push(s(rs));
                buf.push(s(lrs * C3));
                buf.push(s(rrs * C3));
            }
            _ => {
                tracing::debug!(
                    "[AUDIO] channel_map: unhandled {}ch→{}ch, using truncation/zero-pad",
                    src, dst
                );
                for ch in 0..dst {
                    buf.push(if ch < src { f[ch] } else { 0.0 });
                }
            }
        }
    }
}

// =============================================================================
// SymphoniaSource
// =============================================================================

fn probe_with_fallback(
    path: &str,
    mss: MediaSourceStream<'static>,
    hint: &Hint,
) -> symphonia::core::errors::Result<Box<dyn FormatReader>> {
    use symphonia::core::errors::Error as SymphoniaError;

    match symphonia::default::get_probe().probe(
        hint,
        mss,
        FormatOptions::default(),
        MetadataOptions::default(),
    ) {
        Ok(fmt) => Ok(fmt),

        Err(SymphoniaError::Unsupported(_)) => {
            tracing::warn!(
                "[AUDIO] Probe depth exhausted for '{}', retrying with 16 MB limit",
                path
            );

            let file = File::open(path).map_err(|e| {
                SymphoniaError::IoError(std::io::Error::new(std::io::ErrorKind::NotFound, e))
            })?;
            let mss_retry = MediaSourceStream::new(Box::new(file), Default::default());

            let opts = ProbeOptions {
                max_probe_depth: 16 * 1024 * 1024,
                ..Default::default()
            };
            let mut probe = symphonia::core::formats::probe::Probe::new_with_options(&opts);
            symphonia::default::register_enabled_formats(&mut probe);

            probe.probe(hint, mss_retry, FormatOptions::default(), MetadataOptions::default())
        }

        Err(e) => Err(e),
    }
}

use symphonia::core::formats::probe::ProbeOptions;

pub struct SymphoniaSource {
    pub format: Box<dyn FormatReader>,
    pub decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    pub track_id: u32,
    pub sample_buf: Option<Vec<f32>>,
    pub sample_pos: usize,
    pub channels: NonZero<u16>,
    pub sample_rate: NonZero<u32>,
    pub duration: Option<Duration>,
    pub replay_gain: Option<f32>,
    pub replay_gain_enabled: Arc<AtomicBool>,
    pub done: bool,
    pub seek_rx: Receiver<Duration>,
    pub volume: Arc<AtomicU32>,
    pub frame_count: usize,
    pub repeat_one_rx: Receiver<bool>,
    pub repeat_one: bool,
    pub event_tx: Sender<AudioEvent>,
    pub generation: u64,
    pub use_coarse_seek: bool,
}

impl SymphoniaSource {
    pub fn open(
        path: &str,
        replay_gain_db: Option<f32>,
        seek_rx: Receiver<Duration>,
        repeat_one_rx: Receiver<bool>,
        event_tx: Sender<AudioEvent>,
        generation: u64,
        volume: Arc<AtomicU32>,
        replay_gain_enabled: Arc<AtomicBool>,
        device_channels: NonZero<u16>,
    ) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;

        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = PathBuf::from(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let mut format = probe_with_fallback(path, mss, &hint)
            .map_err(|e| format!("Failed to probe {}: {}", path, e))?;
        let track = format.default_track(symphonia::core::formats::TrackType::Audio)
        .ok_or_else(|| format!("No audio track found in {}", path))?;
        let audio_params = match &track.codec_params {
            Some(symphonia::core::codecs::CodecParameters::Audio(p)) => p,
            _ => return Err(format!("No audio codec params in {}", path)),
        };
        let track_id = track.id;
        let sample_rate = NonZero::new(audio_params.sample_rate.unwrap_or(44100))
            .ok_or("Sample rate is 0")?;
        let source_channels = audio_params.channels.as_ref().map(|c| c.count() as u16).unwrap_or(2);
        let channels = device_channels;
        let duration = track.time_base.and_then(|tb| {
            track.duration.and_then(|d| {
                let time = tb.calc_time(symphonia::core::units::Timestamp::from(d.get() as i64))?;
                Some(std::time::Duration::from_secs_f64(time.as_secs_f64()))
            })
        });
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(audio_params, &AudioDecoderOptions::default())
            .map_err(|e| format!("Failed to create decoder for {}: {}", path, e))?;

        let replay_gain = resolve_replay_gain(replay_gain_db, &mut format);

        let non_audio_tracks: Vec<_> = format.tracks()
            .iter()
            .filter(|t| !matches!(t.track_type(), Some(symphonia::core::formats::TrackType::Audio)))
            .collect();
        let use_coarse_seek = !non_audio_tracks.is_empty();

        if use_coarse_seek {
            tracing::warn!(
                "[AUDIO] '{}' has {} non-audio stream(s) — using coarse seek",
                path,
                non_audio_tracks.len()
            );
        }

        tracing::info!("[AUDIO] Track: {}Hz {}ch (device {}ch) — {}", sample_rate, source_channels, channels, path);
        Ok(Self {
            format,
            decoder,
            track_id,
            sample_buf: None,
            sample_pos: 0,
            channels,
            sample_rate,
            duration,
            done: false,
            replay_gain,
            replay_gain_enabled,
            seek_rx,
            volume,
            frame_count: 0,
            repeat_one_rx,
            repeat_one: false,
            event_tx,
            generation,
            use_coarse_seek,
        })
    }

    pub fn seek(&mut self, pos: Duration) {
        let secs = pos.as_secs_f64();
        let Some(time) = symphonia::core::units::Time::try_from_secs_f64(secs) else {
            tracing::warn!("[AUDIO] seek: invalid position {:?}", pos);
            return;
        };
        let seek_mode = if self.use_coarse_seek {
            tracing::debug!("[AUDIO] seek: using Coarse mode (non-audio streams present)");
            SeekMode::Coarse
        } else {
            SeekMode::Accurate
        };
        match self.format.seek(seek_mode, SeekTo::Time {
            time,
            track_id: Some(self.track_id),
        }) {
            Ok(_) => {}
            Err(e) => tracing::warn!("[AUDIO] seek error: {}", e),
        }
        self.decoder.reset();
        self.sample_buf = None;
        self.sample_pos = 0;
        self.done = false;
    }

    fn refill(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => return false,
                Err(SymphoniaError::IoError(_)) => return false,
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(_) => return false,
            };
            if packet.track_id != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let buf = self.sample_buf.get_or_insert_with(Vec::new);
                    buf.clear();
                    decoded.copy_to_vec_interleaved(buf);

                    let decoded_ch = decoded.spec().channels().count() as u16;
                    let dst_ch = self.channels.get();
                    if decoded_ch != dst_ch {
                        channel_map(buf, decoded_ch, dst_ch);
                    }

                    self.sample_pos = 0;
                    return true;
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(_) => return false,
            }
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.done {
            return None;
        }

        if self.frame_count == 0 {
            if let Ok(pos) = self.seek_rx.try_recv() {
                if pos == Duration::MAX {
                    self.done = true;
                    return None;
                }
                self.seek(pos);
                let secs = pos.as_secs_f64();
                let _ = self
                    .event_tx
                    .try_send(AudioEvent::StateChanged { position: secs });
            }
            while let Ok(v) = self.repeat_one_rx.try_recv() {
                self.repeat_one = v;
            }
            self.frame_count = (self.sample_rate.get() as usize / 100) * self.channels.get() as usize;
        }
        self.frame_count -= 1;

        loop {
            if let Some(ref buf) = self.sample_buf {
                if self.sample_pos < buf.len() {
                    let s = buf[self.sample_pos];
                    self.sample_pos += 1;
                    let s = if self.replay_gain_enabled.load(Ordering::Relaxed) {
                        match self.replay_gain {
                            Some(gain) => s * gain,
                            None => s,
                        }
                    } else {
                        s
                    };
                    let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
                    return Some(s * vol);
                }
            }
            if !self.refill() {
                if self.repeat_one {
                    self.seek(Duration::ZERO);
                    let _ = self
                        .event_tx
                        .try_send(AudioEvent::StateChanged { position: 0.0 });
                    continue;
                }
                self.done = true;
                let _ = self.event_tx.try_send(AudioEvent::TrackFinished {
                    generation: self.generation,
                });
                return None;
            }
        }
    }
}

impl Source for SymphoniaSource {
    fn current_span_len(&self) -> Option<usize> {
        self.sample_buf
            .as_ref()
            .map(|b| b.len().saturating_sub(self.sample_pos).max(1))
            .or(Some(441))
    }
    fn channels(&self) -> NonZero<u16> {
        self.channels
    }
    fn sample_rate(&self) -> NonZero<u32> {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }
}
