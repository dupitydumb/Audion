// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// Architecture:
//
//   SymphoniaSource      — decodes FLAC/MP3/AAC/OGG/WAV via symphonia directly.
//                          Supports instant seek via format.seek + decoder.reset.
//                          Seek requests arrive via a crossbeam channel, checked
//                          at ~10ms frame boundaries. Volume applied per-sample
//                          from a shared AtomicU32. Zero locks in the hot path.
//
//   rodio raw queue      — queue::<f32>(true) used directly, no Sink.
//                          queue_input.clear() instantly wipes pending sources
//                          (plain Vec::clear under a short-lived mutex, called
//                          only from the command thread — never from audio thread).
//                          queue_output.current is a plain Box<dyn Source> owned
//                          exclusively by the audio thread. No lock to read it.
//
//   PausableQueue        — wraps queue_output. Emits silence when paused.
//                          Driven by AtomicBool — zero locks in the hot path.
//
//   EqSource             — wraps PausableQueue. 10-band biquad EQ applied to
//                          everything. Real-time updates via crossbeam channel,
//                          checked at ~10ms frame boundaries.
//
// Pipeline:
//   SymphoniaSource → RubatoResampler (if src_rate ≠ device_rate) → raw queue → PausableQueue → EqSource → device
//
// Track switching (zero locks, zero blocking):
//   1. queue_input.clear()          — wipes all pending sources instantly
//   2. seek_tx.send(Duration::MAX)  — sentinel tells current source to stop
//                                     within ~10ms (next frame boundary)
//   3. queue_input.append_with_signal(new_source) — queued immediately
//
// Seek flow (zero locks):
//   AudioEngine::seek() → seek_tx.send(Duration)
//   SymphoniaSource::next() checks seek_rx at frame boundary → format.seek()
//
// Repeat-one (zero frontend involvement):
//   SetRepeatOne(true) → repeat_one_rx → SymphoniaSource.repeat_one = true
//   At EOF: seek(Duration::ZERO) instead of returning None.
//   TrackFinished never fires. Frontend nextTrack() is never called.
//   loop_tx fires on each loop → AudioEngine resets TrackInfo → snapshot()
//   returns correct position. StateChanged event also pushed for immediate UI sync.
//   IMPORTANT: nextTrack() has no repeat-one handling — the backend owns looping.
//   Clicking next sends Duration::MAX sentinel, killing the source, bypassing
//   the loop. The preloaded next track then plays gaplessly as normal.
//
// Event system (backend → frontend, zero polling overhead):
//   SymphoniaSource pushes AudioEvent::StateChanged via event_tx on:
//     - seek executed (confirmed position after keyframe alignment)
//     - repeat-one loop (position 0)
//   Events flow: event_tx → event_rx (drained in command thread) → VecDeque
//   Frontend polls nativeAudioPollEvent() every 50ms — same queue as
//   TrackFinished / TrackAdvanced. No extra infrastructure.
//
// Command architecture:
//   Tauri commands → crossbeam channel → audio thread (owns AudioEngine).
//   PlaybackState snapshotted into Arc<Mutex<>> every 100ms for UI reads.
//   AudioEvents pushed into Arc<Mutex<VecDeque>> for UI poller.
//
//
//  RubatoResampler :     — high quality sinc resampler (rubato SincFixedIn).
//                          Only instantiated when the source sample rate differs
//                          from the device rate. Bypassed
//                          entirely when rates match (zero overhead).
//                          Device rate queried once via cpal at engine init,
//                          stored in AudioEngine::device_sample_rate.
// =============================================================================

use std::f32::consts::PI;
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crossbeam::channel::{unbounded, Receiver, Sender};
use rodio::queue::queue;
use rodio::{OutputStream, Source};
use serde::{Deserialize, Serialize};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

// =============================================================================
// EQ TYPES  (serialisable — matches equalizer.ts / native-audio.ts)
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EqBand {
    pub frequency: f32,
    pub gain: f32, // dB, -12..+12
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands: Vec<EqBand>,
}

impl Default for EqSettings {
    fn default() -> Self {
        let freqs = [
            31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
        ];
        Self {
            enabled: false,
            bands: freqs
                .iter()
                .map(|&f| EqBand {
                    frequency: f,
                    gain: 0.0,
                })
                .collect(),
        }
    }
}

// =============================================================================
// DSP: BIQUAD PEAKING FILTER
// =============================================================================

const EQ_Q: f32 = 1.41;

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
    fn new_peaking(freq: f32, gain_db: f32, sample_rate: u32) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate as f32;
        let alpha = w0.sin() / (2.0 * EQ_Q);
        let cos = w0.cos();

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos;
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

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

// =============================================================================
// DSP: FILTER BANK  (per-channel biquad array)
// =============================================================================

struct FilterBank {
    filters: Vec<Vec<BiquadFilter>>,
    channels: usize,
    sample_rate: u32,
}

impl FilterBank {
    fn new(channels: usize, sample_rate: u32) -> Self {
        Self {
            filters: vec![vec![]; channels],
            channels,
            sample_rate,
        }
    }

    fn rebuild(&mut self, settings: &EqSettings) {
        self.filters = vec![vec![]; self.channels];
        if settings.enabled {
            for ch in 0..self.channels {
                for band in &settings.bands {
                    if band.gain.abs() > 0.01 {
                        self.filters[ch].push(BiquadFilter::new_peaking(
                            band.frequency,
                            band.gain,
                            self.sample_rate,
                        ));
                    }
                }
            }
        }
    }

    fn rebuild_for_rate(&mut self, channels: usize, sample_rate: u32, settings: &EqSettings) {
        self.channels = channels;
        self.sample_rate = sample_rate;
        self.rebuild(settings);
    }

    #[inline]
    fn process(&mut self, sample: f32, channel: usize) -> f32 {
        let mut s = sample;
        for f in &mut self.filters[channel] {
            s = f.process(s);
        }
        s
    }
}

// =============================================================================
// PausableQueue — wraps queue output, emits silence when paused
// =============================================================================

struct PausableQueue<S: Source<Item = f32>> {
    inner: S,
    paused: Arc<AtomicBool>,
}

impl<S: Source<Item = f32>> Iterator for PausableQueue<S> {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.paused.load(Ordering::Relaxed) {
            Some(0.0) // emit silence, inner source untouched
        } else {
            self.inner.next()
        }
    }
}

impl<S: Source<Item = f32>> Source for PausableQueue<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

// =============================================================================
// EqSource — wraps PausableQueue, applies EQ in the audio callback
// =============================================================================

struct EqSource<S: Source<Item = f32>> {
    inner: S,
    bank: FilterBank,
    eq_settings: EqSettings,
    eq_rx: Receiver<EqSettings>,
    channels: usize,
    sample_rate: u32,
    current_ch: usize,
    frame_count: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    fn new(inner: S, settings: &EqSettings, eq_rx: Receiver<EqSettings>) -> Self {
        let channels = inner.channels() as usize;
        let sample_rate = inner.sample_rate();
        let mut bank = FilterBank::new(channels, sample_rate);
        bank.rebuild(settings);
        Self {
            inner,
            bank,
            eq_settings: settings.clone(),
            eq_rx,
            channels,
            sample_rate,
            current_ch: 0,
            frame_count: 0,
        }
    }
}

impl<S: Source<Item = f32>> Iterator for EqSource<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        // Batch expensive ops at frame boundary (~10ms)
        if self.frame_count == 0 {
            // Drain EQ updates — only the last one matters.
            let mut latest: Option<EqSettings> = None;
            while let Ok(s) = self.eq_rx.try_recv() {
                latest = Some(s);
            }
            if let Some(s) = latest {
                self.eq_settings = s;
                self.bank.rebuild(&self.eq_settings);
            }

            // Detect sample-rate changes at frame boundary (less common).
            let new_rate = self.inner.sample_rate();
            if new_rate != self.sample_rate {
                self.sample_rate = new_rate;
                self.bank
                    .rebuild_for_rate(self.channels, new_rate, &self.eq_settings);
            }

            self.frame_count = (self.sample_rate as usize / 100).max(1) * self.channels;
        }
        self.frame_count -= 1;

        // Cheap: check channel count every sample to stay phase-correct.
        let ch_now = self.inner.channels() as usize;
        if ch_now != self.channels {
            self.channels = ch_now;
            self.current_ch = 0;
            self.bank
                .rebuild_for_rate(self.channels, self.sample_rate, &self.eq_settings);
        }

        let sample = self.inner.next()?;
        let ch = self.current_ch;
        self.current_ch = (self.current_ch + 1) % self.channels;
        Some(self.bank.process(sample, ch))
    }
}

impl<S: Source<Item = f32>> Source for EqSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(pos)
    }
}

// =============================================================================
// REPLAY GAIN
// =============================================================================

fn resolve_replay_gain(
    pre_scanned_db: Option<f32>,
    format: &mut Box<dyn FormatReader>,
) -> Option<f32> {
    if let Some(db) = pre_scanned_db {
        return Some(db_to_linear(db));
    }

    let metadata = format.metadata();
    let tags_iter = metadata.current().map(|m| m.tags()).into_iter().flatten();

    let mut track_gain_db: Option<f32> = None;
    let mut album_gain_db: Option<f32> = None;
    let mut r128_gain: Option<f32> = None;

    for tag in tags_iter {
        match tag.std_key {
            Some(symphonia::core::meta::StandardTagKey::ReplayGainTrackGain) => {
                track_gain_db = parse_gain_tag(&tag.value);
            }
            Some(symphonia::core::meta::StandardTagKey::ReplayGainAlbumGain) => {
                album_gain_db = parse_gain_tag(&tag.value);
            }
            None if tag.key.eq_ignore_ascii_case("R128_TRACK_GAIN") => {
                if let symphonia::core::meta::Value::String(ref s) = tag.value {
                    if let Ok(raw) = s.trim().parse::<i32>() {
                        r128_gain = Some((raw as f32 / 256.0) + 5.0);
                    }
                }
            }
            _ => {}
        }
    }

    let db = track_gain_db.or(album_gain_db).or(r128_gain)?;
    Some(db_to_linear(db))
}

fn parse_gain_tag(value: &symphonia::core::meta::Value) -> Option<f32> {
    if let symphonia::core::meta::Value::String(ref s) = value {
        let cleaned = s
            .trim()
            .trim_end_matches(|c: char| c == 'B' || c == 'b')
            .trim_end_matches(|c: char| c == 'd' || c == 'D')
            .trim();
        cleaned.parse::<f32>().ok()
    } else {
        None
    }
}

#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

// =============================================================================
// SymphoniaSource — decodes audio, handles seek + stop via channel, volume via atomic
// =============================================================================
// Hot path: zero locks. Volume is an AtomicU32 (f32 bits), read with Relaxed ordering.
// Seek channel: crossbeam unbounded, try_recv at ~10ms frame boundaries.
// Stop sentinel: Duration::MAX sent via seek channel — sets done=true immediately.
// =============================================================================

struct SymphoniaSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    sample_buf: Option<SampleBuffer<f32>>,
    sample_pos: usize,
    channels: u16,
    sample_rate: u32,
    duration: Option<Duration>,
    replay_gain: Option<f32>,
    done: bool,
    seek_rx: Receiver<Duration>,
    volume: Arc<AtomicU32>, // shared with AudioEngine — f32 bits, Relaxed
    frame_count: usize,
    repeat_one_rx: Receiver<bool>,
    repeat_one: bool,
    event_tx: Sender<AudioEvent>,
    loop_tx: Sender<Instant>,
}

impl SymphoniaSource {
    fn open(
        path: &str,
        replay_gain_db: Option<f32>,
        seek_rx: Receiver<Duration>,
        repeat_one_rx: Receiver<bool>,
        event_tx: Sender<AudioEvent>,
        loop_tx: Sender<Instant>,
        volume: Arc<AtomicU32>,
    ) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;

        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = PathBuf::from(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions {
                    enable_gapless: true,
                    ..Default::default()
                },
                &MetadataOptions {
                    limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(0),
                    limit_visual_bytes: symphonia::core::meta::Limit::Maximum(0),
                },
            )
            .map_err(|e| format!("Failed to probe {}: {}", path, e))?;

        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| format!("No audio track found in {}", path))?;

        let track_id = track.id;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count() as u16)
            .unwrap_or(2);
        let duration = track.codec_params.n_frames.and_then(|f| {
            track
                .codec_params
                .sample_rate
                .map(|r| Duration::from_secs_f64(f as f64 / r as f64))
        });

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("Failed to create decoder for {}: {}", path, e))?;

        let replay_gain = resolve_replay_gain(replay_gain_db, &mut format);

        tracing::info!("[AUDIO] Track: {}Hz {}ch — {}", sample_rate, channels, path);
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
            seek_rx,
            volume,
            frame_count: 0,
            repeat_one_rx,
            repeat_one: false,
            event_tx,
            loop_tx,
        })
    }

    fn seek(&mut self, pos: Duration) {
        let time = Time {
            seconds: pos.as_secs(),
            frac: pos.subsec_nanos() as f64 / 1e9,
        };
        match self.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(self.track_id),
            },
        ) {
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
                Ok(p) => p,
                Err(SymphoniaError::IoError(_)) => return false,
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(_) => return false,
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let frames = decoded.capacity() as u64;
                    let buf = self
                        .sample_buf
                        .get_or_insert_with(|| SampleBuffer::<f32>::new(frames, spec));
                    buf.copy_interleaved_ref(decoded);
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

        // Frame boundary: check for seek/stop commands and drain EQ (~10ms).
        if self.frame_count == 0 {
            if let Ok(pos) = self.seek_rx.try_recv() {
                if pos == Duration::MAX {
                    // Sentinel — we've been replaced. Stop immediately.
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
            self.frame_count = (self.sample_rate as usize / 100) * self.channels as usize;
        }
        self.frame_count -= 1;

        loop {
            if let Some(ref buf) = self.sample_buf {
                if self.sample_pos < buf.samples().len() {
                    let s = buf.samples()[self.sample_pos];
                    self.sample_pos += 1;
                    // Apply replay gain then volume — both scalar multiplies, no locks.
                    let s = match self.replay_gain {
                        Some(gain) => (s * gain).clamp(-1.0, 1.0),
                        None => s,
                    };
                    let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
                    return Some(s * vol);
                }
            }
            if !self.refill() {
                if self.repeat_one {
                    self.seek(Duration::ZERO);
                    let _ = self.loop_tx.try_send(Instant::now());
                    let _ = self
                        .event_tx
                        .try_send(AudioEvent::StateChanged { position: 0.0 });
                    continue;
                }
                self.done = true;
                return None;
            }
        }
    }
}

impl Source for SymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        self.sample_buf
            .as_ref()
            .map(|b| b.samples().len().saturating_sub(self.sample_pos).max(1))
            .or(Some(441))
    }
    fn channels(&self) -> u16 {
        self.channels
    }
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }
}

// =============================================================================
// RubatoResampler — high quality sinc resampler wrapping SymphoniaSource
// =============================================================================

struct RubatoResampler {
    source: SymphoniaSource,
    resampler: SincFixedIn<f32>,
    input_buf: Vec<Vec<f32>>,     // [channels][frames]
    output_buf: Vec<Vec<f32>>,    // [channels][frames]
    output_interleaved: Vec<f32>, // flat interleaved output
    output_pos: usize,            // current position in output_interleaved
    channels: usize,
    dst_rate: u32,
    chunk_size: usize,
    done: bool,
}

impl RubatoResampler {
    fn new(source: SymphoniaSource, dst_rate: u32) -> Result<Self, String> {
        let src_rate = source.sample_rate();
        let channels = source.channels() as usize;
        let chunk_size = 1024; // frames per processing block

        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };

        let resampler = SincFixedIn::<f32>::new(
            dst_rate as f64 / src_rate as f64,
            2.0,
            params,
            chunk_size,
            channels,
        )
        .map_err(|e| format!("Failed to create resampler: {}", e))?;

        let input_buf = vec![vec![0.0f32; chunk_size]; channels];
        let output_buf = resampler.output_buffer_allocate(true);

        Ok(Self {
            source,
            resampler,
            input_buf,
            output_buf,
            output_interleaved: Vec::new(),
            output_pos: 0,
            channels,
            dst_rate,
            chunk_size,
            done: false,
        })
    }

    // Fill input_buf from source, returns number of frames read
    fn fill_input(&mut self) -> usize {
        for frame in 0..self.chunk_size {
            for ch in 0..self.channels {
                match self.source.next() {
                    Some(s) => self.input_buf[ch][frame] = s,
                    None => {
                        // Zero-pad the rest of this chunk
                        for pad_frame in frame..self.chunk_size {
                            for pad_ch in 0..self.channels {
                                self.input_buf[pad_ch][pad_frame] = 0.0;
                            }
                        }
                        return frame;
                    }
                }
            }
        }
        self.chunk_size
    }

    fn process_next_chunk(&mut self) -> bool {
        if self.done {
            return false;
        }

        let frames_read = self.fill_input();
        if frames_read == 0 {
            self.done = true;
            return false;
        }

        match self.resampler.process_into_buffer(
            &self.input_buf,
            &mut self.output_buf,
            None, // None = all channels active
        ) {
            Ok((_, out_frames)) => {
                self.output_interleaved.clear();
                self.output_interleaved.reserve(out_frames * self.channels);
                for frame in 0..out_frames {
                    for ch in 0..self.channels {
                        self.output_interleaved.push(self.output_buf[ch][frame]);
                    }
                }
                self.output_pos = 0;
            }
            Err(e) => {
                tracing::warn!("[AUDIO] Resampler error: {}", e);
                self.done = true;
                return false;
            }
        }

        if frames_read < self.chunk_size {
            self.done = true;
        }

        true
    }
}

impl Iterator for RubatoResampler {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if self.output_pos < self.output_interleaved.len() {
                let s = self.output_interleaved[self.output_pos];
                self.output_pos += 1;
                return Some(s);
            }
            if !self.process_next_chunk() {
                return None;
            }
        }
    }
}

impl Source for RubatoResampler {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        self.channels as u16
    }
    fn sample_rate(&self) -> u32 {
        self.dst_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

// =============================================================================
// TrackInfo — position tracking across seeks and pauses
// =============================================================================

struct TrackInfo {
    path: String,
    duration: Option<Duration>,
    started: Instant, // wall-clock of last resume / seek
    offset: Duration, // playback position at last resume / seek
}

impl TrackInfo {
    fn position_secs(&self) -> f64 {
        let elapsed = self.offset + self.started.elapsed();
        match self.duration {
            Some(d) => elapsed.as_secs_f64().min(d.as_secs_f64()),
            None => elapsed.as_secs_f64(),
        }
    }
}

// =============================================================================
// AudioEngine — owns the pipeline, lives entirely on the audio thread
// =============================================================================

struct AudioEngine {
    queue_input: Arc<rodio::queue::SourcesQueueInput<f32>>,
    paused_flag: Arc<AtomicBool>,
    volume_atomic: Arc<AtomicU32>,
    volume: f32,
    eq_tx: Sender<EqSettings>,
    event_tx: Sender<AudioEvent>,
    device_sample_rate: u32,

    seek_tx: Option<Sender<Duration>>,
    current_finish_rx: Option<crossbeam::channel::Receiver<()>>,
    repeat_one_tx: Option<Sender<bool>>,
    repeat_one: bool,
    loop_rx: Option<Receiver<Instant>>,
    current_info: Option<TrackInfo>,

    next_seek_tx: Option<Sender<Duration>>,
    next_finish_rx: Option<crossbeam::channel::Receiver<()>>,
    next_repeat_one_tx: Option<Sender<bool>>,
    next_loop_rx: Option<Receiver<Instant>>,
    next_path: Option<String>,
    next_duration: Option<Option<Duration>>,

    _stream: OutputStream,
}

impl AudioEngine {
    fn new(
        eq_settings: &EqSettings,
    ) -> Result<(Self, crossbeam::channel::Receiver<AudioEvent>), String> {
        use cpal::traits::{DeviceTrait, HostTrait};

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or("No default output device found")?;
        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get output config: {}", e))?;

        let device_sample_rate = config.sample_rate().0;
        tracing::info!("[AUDIO] Device sample rate: {} Hz", device_sample_rate);

        let (stream, stream_handle) = OutputStream::try_from_device_config(&device, config)
            .map_err(|e| format!("Failed to open audio output: {}", e))?;

        tracing::info!("[AUDIO] Device sample rate: {} Hz", device_sample_rate);

        let (queue_input, queue_output) = queue::<f32>(true);
        let paused_flag = Arc::new(AtomicBool::new(false));
        let volume_atomic = Arc::new(AtomicU32::new(1.0f32.to_bits()));

        let (eq_tx, eq_rx) = unbounded::<EqSettings>();
        let (event_tx, event_rx) = unbounded::<AudioEvent>();

        let pq = PausableQueue {
            inner: queue_output,
            paused: Arc::clone(&paused_flag),
        };
        let eq_src = EqSource::new(pq, eq_settings, eq_rx);

        stream_handle
            .play_raw(eq_src.convert_samples())
            .map_err(|e| format!("play_raw failed: {}", e))?;

        Ok((
            Self {
                queue_input,
                paused_flag,
                volume_atomic,
                volume: 0.7,
                eq_tx,
                event_tx,
                device_sample_rate,
                seek_tx: None,
                current_finish_rx: None,
                repeat_one_tx: None,
                repeat_one: false,
                loop_rx: None,
                current_info: None,
                next_seek_tx: None,
                next_finish_rx: None,
                next_repeat_one_tx: None,
                next_loop_rx: None,
                next_path: None,
                next_duration: None,
                _stream: stream,
            },
            event_rx,
        ))
    }

    // ── open_and_append ──────────────────────────────────────────────────────
    fn open_and_append(
        &mut self,
        path: &str,
        replay_gain_db: Option<f32>,
    ) -> Result<
        (
            crossbeam::channel::Receiver<()>,
            Sender<Duration>,
            Sender<bool>,
            Receiver<Instant>,
            Option<Duration>,
        ),
        String,
    > {
        let (seek_tx, seek_rx) = unbounded::<Duration>();
        let (repeat_one_tx, repeat_one_rx) = unbounded::<bool>();
        let (loop_tx, loop_rx) = unbounded::<Instant>();
        let _ = repeat_one_tx.send(self.repeat_one);

        let src = SymphoniaSource::open(
            path,
            replay_gain_db,
            seek_rx,
            repeat_one_rx,
            self.event_tx.clone(),
            loop_tx,
            Arc::clone(&self.volume_atomic),
        )?;
        let dur = src.duration;

        tracing::info!(
            "[AUDIO] Source format: sample_rate={}, channels={}, duration={:?}",
            src.sample_rate(),
            src.channels(),
            dur
        );
        tracing::info!(
            "[AUDIO] Device format: sample_rate={}, channels=2",
            self.device_sample_rate
        );

        let needs_resample = src.sample_rate() != self.device_sample_rate;
        tracing::info!("[AUDIO] Resampling needed: {}", needs_resample);

        let finish_rx = if needs_resample {
            let resampled = RubatoResampler::new(src, self.device_sample_rate)?;
            self.queue_input.append_with_signal(resampled)
        } else {
            self.queue_input.append_with_signal(src)
        };

        Ok((finish_rx, seek_tx, repeat_one_tx, loop_rx, dur))
    }

    // ── play ─────────────────────────────────────────────────────────────────
    fn play(&mut self, path: &str, replay_gain_db: Option<f32>) -> Result<(), String> {
        // Clear all pending sources from the queue instantly.
        self.queue_input.clear();

        // Send stop sentinel to the currently-playing source.
        // It will set done=true within ~10ms (next frame boundary) and yield None,
        // causing the queue to move on to the new source we're about to append.
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }

        self.seek_tx = None;
        self.current_finish_rx = None;
        self.repeat_one_tx = None;
        self.loop_rx = None;
        self.current_info = None;
        self.next_seek_tx = None;
        self.next_finish_rx = None;
        self.next_repeat_one_tx = None;
        self.next_loop_rx = None;
        self.next_path = None;
        self.next_duration = None;

        let (finish_rx, seek_tx, repeat_one_tx, loop_rx, duration) =
            self.open_and_append(path, replay_gain_db)?;
        self.seek_tx = Some(seek_tx);
        self.repeat_one_tx = Some(repeat_one_tx);
        self.loop_rx = Some(loop_rx);
        self.current_finish_rx = Some(finish_rx);
        self.current_info = Some(TrackInfo {
            path: path.to_string(),
            duration,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        self.paused_flag.store(false, Ordering::Relaxed);

        tracing::info!("[AUDIO] Playing: {}", path);
        Ok(())
    }

    // ── preload ───────────────────────────────────────────────────────────────
    fn preload(&mut self, path: &str, replay_gain_db: Option<f32>) -> Result<(), String> {
        if self.next_path.as_deref() == Some(path) {
            tracing::info!("[AUDIO] Preload skipped (same path): {}", path);
            return Ok(());
        }
        tracing::info!(
            "[AUDIO] Preloading: {} (replacing: {:?})",
            path,
            self.next_path
        );

        if self.next_finish_rx.is_some() {
            // Kill the stale preloaded source and remove it from the queue.
            // queue_input.clear() only removes pending sources — the currently
            // playing source on the audio thread side is not touched.
            if let Some(ref tx) = self.next_seek_tx {
                let _ = tx.send(Duration::MAX);
            }
            self.queue_input.clear();
            self.next_seek_tx = None;
            self.next_finish_rx = None;
            self.next_repeat_one_tx = None;
            self.next_loop_rx = None;
        }

        let (finish_rx, seek_tx, repeat_one_tx, loop_rx, duration) =
            self.open_and_append(path, replay_gain_db)?;
        self.next_finish_rx = Some(finish_rx);
        self.next_seek_tx = Some(seek_tx);
        self.next_repeat_one_tx = Some(repeat_one_tx);
        self.next_loop_rx = Some(loop_rx);
        self.next_path = Some(path.to_string());
        self.next_duration = Some(duration);
        tracing::debug!("[AUDIO] Preloaded: {}", path);
        Ok(())
    }

    // ── seek ─────────────────────────────────────────────────────────────────
    fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        let info = self.current_info.as_mut().ok_or("No track loaded")?;
        let duration = info.duration.ok_or("Track duration unknown")?;

        let pos =
            Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(pos);
        }

        info.offset = pos;
        info.started = Instant::now();
        Ok(())
    }

    // ── pause / resume / stop ─────────────────────────────────────────────────
    fn pause(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.offset = Duration::from_secs_f64(info.position_secs());
            info.started = Instant::now();
        }
        self.paused_flag.store(true, Ordering::Relaxed);
    }

    fn resume(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.started = Instant::now();
        }
        self.paused_flag.store(false, Ordering::Relaxed);
    }

    fn stop(&mut self) {
        self.queue_input.clear();
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        self.seek_tx = None;
        self.current_finish_rx = None;
        self.repeat_one_tx = None;
        self.loop_rx = None;
        self.current_info = None;
        self.next_seek_tx = None;
        self.next_finish_rx = None;
        self.next_repeat_one_tx = None;
        self.next_loop_rx = None;
        self.next_path = None;
        self.next_duration = None;
        self.paused_flag.store(false, Ordering::Relaxed);
        tracing::info!("[AUDIO] Stopped");
    }

    fn set_volume(&mut self, v: f32) {
        let clamped = v.clamp(0.0, 1.0);
        self.volume = clamped;
        self.volume_atomic
            .store(clamped.to_bits(), Ordering::Relaxed);
    }

    // ── EQ ───────────────────────────────────────────────────────────────────
    fn set_eq(&mut self, settings: &EqSettings) {
        let _ = self.eq_tx.send(settings.clone());
    }

    // ── repeat one ───────────────────────────────────────────────────────────
    fn set_repeat_one(&mut self, enabled: bool) {
        self.repeat_one = enabled;
        if let Some(ref tx) = self.repeat_one_tx {
            let _ = tx.send(enabled);
        }
    }

    // ── poll_event ────────────────────────────────────────────────────────────
    fn poll_event(&mut self) -> AudioEvent {
        // Drain loop notifications — reset TrackInfo so snapshot() returns correct position.
        if let Some(ref loop_rx) = self.loop_rx {
            let mut looped = false;
            while loop_rx.try_recv().is_ok() {
                looped = true;
            }
            if looped {
                if let Some(ref mut info) = self.current_info {
                    info.offset = Duration::ZERO;
                    info.started = Instant::now();
                }
            }
        }

        let Some(ref rx) = self.current_finish_rx else {
            return AudioEvent::Idle;
        };
        match rx.try_recv() {
            Err(_) => AudioEvent::Idle,
            Ok(_) => {
                if self.next_finish_rx.is_some() {
                    self.seek_tx = self.next_seek_tx.take();
                    self.repeat_one_tx = self.next_repeat_one_tx.take();
                    self.loop_rx = self.next_loop_rx.take();
                    self.current_finish_rx = self.next_finish_rx.take();
                    let duration = self.next_duration.take().flatten();
                    let path = self.next_path.take().unwrap_or_default();
                    self.current_info = Some(TrackInfo {
                        path: path.clone(),
                        duration,
                        started: Instant::now(),
                        offset: Duration::ZERO,
                    });
                    return AudioEvent::TrackAdvanced { new_path: path };
                }
                self.seek_tx = None;
                self.repeat_one_tx = None;
                self.current_finish_rx = None;
                self.current_info = None;
                AudioEvent::TrackFinished
            }
        }
    }

    // ── snapshot ──────────────────────────────────────────────────────────────
    fn snapshot(&self) -> PlaybackState {
        let paused = self.paused_flag.load(Ordering::Relaxed);
        let playing = self.current_info.is_some() && !paused;

        let (position, duration, current_path) = match &self.current_info {
            Some(info) => (
                info.position_secs(),
                info.duration.map(|d| d.as_secs_f64()).unwrap_or(0.0),
                info.path.clone(),
            ),
            None => (0.0, 0.0, String::new()),
        };

        PlaybackState {
            is_playing: playing,
            position,
            duration,
            volume: self.volume,
            current_path,
            is_initialized: true,
        }
    }
}

// =============================================================================
// AUDIO EVENTS
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum AudioEvent {
    Idle,
    TrackFinished,
    TrackAdvanced { new_path: String },
    StateChanged { position: f64 },
}

// =============================================================================
// PLAYBACK STATE
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct PlaybackState {
    pub is_playing: bool,
    pub position: f64,
    pub duration: f64,
    pub volume: f32,
    pub current_path: String,
    pub is_initialized: bool,
}

// =============================================================================
// AUDIO COMMANDS
// =============================================================================

enum AudioCommand {
    Play(String, Option<f32>),
    Preload(String, Option<f32>),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    SetEq(EqSettings),
    SetRepeatOne(bool),
}

// =============================================================================
// PlaybackStateSync — global handle, lives on the main thread
// =============================================================================

pub struct PlaybackStateSync {
    command_tx: Sender<AudioCommand>,
    shared_state: Arc<Mutex<PlaybackState>>,
    event_queue: Arc<Mutex<std::collections::VecDeque<AudioEvent>>>,
}

impl PlaybackStateSync {
    pub fn new() -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();
        let shared_state = Arc::new(Mutex::new(PlaybackState {
            is_playing: false,
            position: 0.0,
            duration: 0.0,
            volume: 0.7,
            current_path: String::new(),
            is_initialized: false,
        }));
        let event_queue = Arc::new(Mutex::new(std::collections::VecDeque::<AudioEvent>::new()));

        let state_clone = Arc::clone(&shared_state);
        let events_clone = Arc::clone(&event_queue);

        std::thread::spawn(move || {
            let mut engine_opt: Option<AudioEngine> = None;
            let mut eq_settings = EqSettings::default();
            let mut event_rx_opt: Option<crossbeam::channel::Receiver<AudioEvent>> = None;

            loop {
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(cmd) => {
                        if engine_opt.is_none() {
                            match AudioEngine::new(&eq_settings) {
                                Ok((e, evt_rx)) => {
                                    event_rx_opt = Some(evt_rx);
                                    engine_opt = Some(e);
                                    if let Ok(mut s) = state_clone.lock() {
                                        s.is_initialized = true;
                                    }
                                }
                                Err(e) => {
                                    tracing::error!("[AUDIO] Engine init failed: {}", e);
                                    continue;
                                }
                            }
                        }

                        let engine = engine_opt.as_mut().unwrap();

                        match cmd {
                            AudioCommand::Play(path, rg) => {
                                if let Ok(mut q) = events_clone.lock() {
                                    q.clear();
                                }
                                if let Err(e) = engine.play(&path, rg) {
                                    tracing::error!("[AUDIO] play error: {}", e);
                                }
                            }
                            AudioCommand::Preload(path, rg) => {
                                if let Err(e) = engine.preload(&path, rg) {
                                    tracing::warn!("[AUDIO] preload error: {}", e);
                                }
                            }
                            AudioCommand::Pause => engine.pause(),
                            AudioCommand::Resume => engine.resume(),
                            AudioCommand::Stop => {
                                if let Ok(mut q) = events_clone.lock() {
                                    q.clear();
                                }
                                engine.stop();
                            }
                            AudioCommand::Seek(f) => {
                                if let Err(e) = engine.seek(f) {
                                    tracing::warn!("[AUDIO] seek error: {}", e);
                                }
                            }
                            AudioCommand::SetVolume(v) => engine.set_volume(v),
                            AudioCommand::SetEq(s) => {
                                eq_settings = s.clone();
                                engine.set_eq(&s);
                            }
                            AudioCommand::SetRepeatOne(v) => engine.set_repeat_one(v),
                        }
                    }
                    Err(crossbeam::channel::RecvTimeoutError::Disconnected) => break,
                    Err(crossbeam::channel::RecvTimeoutError::Timeout) => {}
                }

                // Drain backend-pushed events (seek confirmations, loops).
                if let Some(ref event_rx) = event_rx_opt {
                    while let Ok(evt) = event_rx.try_recv() {
                        if let Ok(mut q) = events_clone.lock() {
                            q.push_back(evt);
                        }
                    }
                }

                // Poll + snapshot every 100ms.
                if let Some(engine) = engine_opt.as_mut() {
                    let event = engine.poll_event();
                    if !matches!(event, AudioEvent::Idle) {
                        if let Ok(mut q) = events_clone.lock() {
                            q.push_back(event);
                        }
                    }
                    if let Ok(mut s) = state_clone.lock() {
                        *s = engine.snapshot();
                    }
                }
            }
        });

        Self {
            command_tx: tx,
            shared_state,
            event_queue,
        }
    }

    fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.command_tx.send(cmd).map_err(|e| e.to_string())
    }

    pub fn init_async(_app_handle: tauri::AppHandle) {}
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

#[tauri::command]
pub fn audio_play(
    path: String,
    replay_gain_db: Option<f32>,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::Play(path, replay_gain_db))
}

#[tauri::command]
pub fn audio_preload(
    path: String,
    replay_gain_db: Option<f32>,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    tracing::info!("[AUDIO] Preload requested: {}", path);
    state.send(AudioCommand::Preload(path, replay_gain_db))
}

#[tauri::command]
pub fn audio_pause(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Pause)
}

#[tauri::command]
pub fn audio_resume(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Resume)
}

#[tauri::command]
pub fn audio_stop(state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Stop)
}

#[tauri::command]
pub fn audio_seek(position: f64, state: tauri::State<'_, PlaybackStateSync>) -> Result<(), String> {
    state.send(AudioCommand::Seek(position))
}

#[tauri::command]
pub fn audio_set_volume(
    volume: f32,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetVolume(volume))
}

#[tauri::command]
pub fn audio_get_state(
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<PlaybackState, String> {
    state
        .shared_state
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "State lock poisoned".into())
}

#[tauri::command]
pub fn audio_poll_event(state: tauri::State<'_, PlaybackStateSync>) -> Result<AudioEvent, String> {
    state
        .event_queue
        .lock()
        .map(|mut q| q.pop_front().unwrap_or(AudioEvent::Idle))
        .map_err(|_| "Event queue lock poisoned".into())
}

#[tauri::command]
pub fn audio_set_eq(
    settings: EqSettings,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetEq(settings))
}

#[tauri::command]
pub fn audio_set_repeat_one(
    enabled: bool,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetRepeatOne(enabled))
}

#[tauri::command]
pub fn native_audio_available(_state: tauri::State<'_, PlaybackStateSync>) -> bool {
    true
}
