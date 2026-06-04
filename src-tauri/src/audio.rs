// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// Architecture:
//
//   SymphoniaSource      — decodes FLAC/MP3/AAC/ALAC/OGG/WAV via symphonia directly.
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
//   3. queue_input.append(new_source) — queued immediately
//
// Seek flow (zero locks):
//   AudioEngine::seek() → seek_tx.send(Duration)
//   SymphoniaSource::next() checks seek_rx at frame boundary → format.seek()
//
// Repeat-one (zero frontend involvement):
//   SetRepeatOne(true) → repeat_one_rx → SymphoniaSource.repeat_one = true
//   At EOF: seek(Duration::ZERO) instead of returning None.
//   TrackFinished never fires. Frontend nextTrack() is never called.
//   StateChanged { position: 0.0 } emitted on loop => command loop resets TrackInfo.
//   IMPORTANT: nextTrack() has no repeat-one handling — the backend owns looping.
//   Clicking next sends Duration::MAX sentinel, killing the source, bypassing
//   the loop. The preloaded next track then plays gaplessly as normal.
//
// Event system (backend → frontend, fully event-driven, zero polling):
//   SymphoniaSource pushes AudioEvent directly onto event_tx on:
//     - seek executed (StateChanged with confirmed position)
//     - repeat-one loop (StateChanged { position: 0.0 } , doubles as loop signal)
//     - track EOF (TrackFinished { generation } => stamped with source generation)
//   command loop selects on both command_rx and event_rx simultaneously
//   TrackFinished with a stale generation is silently discarded => prevents
//   wrong-song bug under rapid skipping on fast hardware
//   TrackAdvanced promotion happens in the event arm with zero polling delay
//   No VecDeque, no Mutex, no poll_event, no recv_timeout
//
// Command architecture:
//   Tauri commands → crossbeam channel → audio thread (owns AudioEngine).
//   frontend dead-reckons position locally between events
// Arc<Mutex<>> remains for the device list (on-demand
//   reads from audio_get_device_info; eliminated when device changes push via events)
//
//
//  RubatoResampler :     — high quality FFT resampler
//                          Only instantiated when the source sample rate differs
//                          from the device rate. Bypassed entirely when rates match (zero overhead).
//                          A fresh instance is built per track during preload on the command thread,
//                          so construction cost never blocks the audio thread or causes gaps.
//                          Device rate queried once via cpal at engine init,
//                          stored in AudioEngine::device_sample_rate.
// =============================================================================

use std::f32::consts::PI;
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::num::NonZero;
use tauri::Emitter;

use crossbeam::channel::{unbounded, Receiver, Sender};
use rodio::queue::queue;
use rodio::{Source};
use std::str::FromStr;
use cpal::DeviceId;
use serde::{Deserialize, Serialize};

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, RawValue, StandardTag};
use symphonia::core::formats::probe::Hint;

use rubato::{Fft, FixedSync, Indexing, Resampler};
use rubato::audioadapter_buffers::direct::SequentialSliceOfVecs;

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
// DEVICE LIST  (serialisable , returned by audio_list_output_devices)
// =============================================================================

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
    fn new_peaking(freq: f32, gain_db: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let alpha = w0.sin() / (2.0 * EQ_Q);
        let cos = w0.cos();

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos;
        let a2 = 1.0 - alpha / a;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_low_shelf(freq: f32, gain_db: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos = w0.cos();
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).sqrt();

        let b0 =  a * ((a + 1.0) - (a - 1.0) * cos + 2.0 * alpha * a.sqrt());
        let b1 =  2.0 * a * ((a - 1.0) - (a + 1.0) * cos);
        let b2 =  a * ((a + 1.0) - (a - 1.0) * cos - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) + (a - 1.0) * cos + 2.0 * alpha * a.sqrt();
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos);
        let a2 =        (a + 1.0) + (a - 1.0) * cos - 2.0 * alpha * a.sqrt();

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_high_shelf(freq: f32, gain_db: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos = w0.cos();
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).sqrt();

        let b0 =  a * ((a + 1.0) + (a - 1.0) * cos + 2.0 * alpha * a.sqrt());
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
        let b2 =  a * ((a + 1.0) + (a - 1.0) * cos - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) - (a - 1.0) * cos + 2.0 * alpha * a.sqrt();
        let a1 =  2.0 * ((a - 1.0) - (a + 1.0) * cos);
        let a2 =        (a + 1.0) - (a - 1.0) * cos - 2.0 * alpha * a.sqrt();

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_low_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let w0    = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos   = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 - cos) / 2.0;
        let b1 =  1.0 - cos;
        let b2 = (1.0 - cos) / 2.0;
        let a0 =  1.0 + alpha;
        let a1 = -2.0 * cos;
        let a2 =  1.0 - alpha;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_high_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let w0    = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos   = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 =  (1.0 + cos) / 2.0;
        let b1 = -(1.0 + cos);
        let b2 =  (1.0 + cos) / 2.0;
        let a0 =   1.0 + alpha;
        let a1 =  -2.0 * cos;
        let a2 =   1.0 - alpha;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    /// BandPass (constant skirt gain, peak gain = Q).
    fn new_band_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let w0    = 2.0 * PI * freq / sample_rate.get() as f32;
        let alpha = w0.sin() / (2.0 * q);

        let b0 =  w0.sin() / 2.0;
        let b1 =  0.0;
        let b2 = -w0.sin() / 2.0;
        let a0 =  1.0 + alpha;
        let a1 = -2.0 * w0.cos();
        let a2 =  1.0 - alpha;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_notch(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let w0    = 2.0 * PI * freq / sample_rate.get() as f32;
        let alpha = w0.sin() / (2.0 * q);
        let cos   = w0.cos();

        let b0 =  1.0;
        let b1 = -2.0 * cos;
        let b2 =  1.0;
        let a0 =  1.0 + alpha;
        let a1 = -2.0 * cos;
        let a2 =  1.0 - alpha;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn new_all_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let w0    = 2.0 * PI * freq / sample_rate.get() as f32;
        let alpha = w0.sin() / (2.0 * q);
        let cos   = w0.cos();

        let b0 =  1.0 - alpha;
        let b1 = -2.0 * cos;
        let b2 =  1.0 + alpha;
        let a0 =  1.0 + alpha;
        let a1 = -2.0 * cos;
        let a2 =  1.0 - alpha;

        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn from_coeffs(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        if a0.abs() < 1e-10 {
            // return identity filter (pass-through) rather than NaN
            return Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0,
                        x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 };
        }
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
    sample_rate: NonZero<u32>,
}

impl FilterBank {
    fn new(channels: usize, sample_rate: NonZero<u32>) -> Self {
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

    fn rebuild_for_rate(&mut self, channels: usize, sample_rate: NonZero<u32>, settings: &EqSettings) {
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
//
// frame_pos tracks how many samples into the current interleaved frame we are
// (0 = start of a new frame, i.e. aligned on channel 0)
//
// On pause: frame_pos increments normally with every silence sample
// On resume: if frame_pos != 0 we are mid-frame so keep emitting silence until we reach the next frame boundary, then resume real audio
// so the total silence run is always a multiple of channels, so
// EqSource::current_ch never drifts out of phase
// =============================================================================

struct PausableQueue<S: Source<Item = f32>> {
    inner: S,
    paused: Arc<AtomicBool>,
    frame_pos: usize, // position within the current interleaved frame
    // channels is not cached at construction because rodio's Empty source
    // (which backs an idle queue) returns channels() == 1 regardless of what
    // will actually play
    // so read it lazily only during pause silence loop and the at-most (channels-1) padding samples on resume
}

impl<S: Source<Item = f32>> Iterator for PausableQueue<S> {
    type Item = f32;
    #[inline]
    fn next(&mut self) -> Option<f32> {
        let is_paused = self.paused.load(Ordering::Relaxed);

        if is_paused {
            let channels = self.inner.channels().get() as usize;
            self.frame_pos = (self.frame_pos + 1) % channels;
            return Some(0.0);
        }

        // Just unpaused but mid-frame — pad with silence until we're back on
        // channel 0. Runs at most (channels - 1) times per resume event.
        // Reading channels() here is safe: a real source is now in the queue.
        if self.frame_pos != 0 {
            let channels = self.inner.channels().get() as usize;
            self.frame_pos = (self.frame_pos + 1) % channels;
            return Some(0.0);
        }

        self.inner.next()
    }
}

impl<S: Source<Item = f32>> Source for PausableQueue<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }
    fn channels(&self) -> NonZero<u16> {
        self.inner.channels()
    }
    fn sample_rate(&self) -> NonZero<u32> {
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
    sample_rate: NonZero<u32>,
    current_ch: usize,
    frame_count: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    fn new(inner: S, settings: &EqSettings, eq_rx: Receiver<EqSettings>) -> Self {
        let channels = inner.channels().get() as usize;
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

            self.frame_count = (self.sample_rate.get() as usize / 100).max(1) * self.channels;
        }
        self.frame_count -= 1;

        // Cheap: check channel count every sample to stay phase-correct.
        let ch_now = self.inner.channels().get() as usize;
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
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }
    fn channels(&self) -> NonZero<u16> {
        self.inner.channels()
    }
    fn sample_rate(&self) -> NonZero<u32> {
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
// channel_map => re-interleave a decoded audio buffer to a target channel count
// =============================================================================
// called from SymphoniaSource::refill whenever the file's channel count differs from the device channel count advertised to rodio
//
// mapping rules:
//   mono -> any    : duplicate the single sample into all N channels
//   fewer -> more  : copy the available channels, fill the rest with silence
//                   (stereo->7.1: front L/R populated, centre/LFE/surround silent;
//                    the driver and receiver handle spatial expansion from there)
//   more -> fewer  : keep only the first dst_ch channels (simple truncation)
//                   good enough for stereo output from a surround source
fn channel_map(buf: &mut Vec<f32>, src_ch: u16, dst_ch: u16) {
    if src_ch == dst_ch {
        return;
    }
    let src = src_ch as usize;
    let dst = dst_ch as usize;
    let frames = buf.len() / src;

    if src == 1 {
        // mono -> any: duplicate in-place back-to-front (no allocation after first call)
        buf.resize(frames * dst, 0.0);
        for i in (0..frames).rev() {
            let s = buf[i];
            for c in 0..dst {
                buf[i * dst + c] = s;
            }
        }
    } else if dst > src {
        // upmix: front channels filled, remainder silent
        let old: Vec<f32> = buf.drain(..).collect();
        buf.reserve(frames * dst);
        for frame in old.chunks_exact(src) {
            for c in 0..dst {
                buf.push(if c < src { frame[c] } else { 0.0 });
            }
        }
    } else {
        // downmix: keep first dst_ch channels per frame
        let old: Vec<f32> = buf.drain(..).collect();
        buf.reserve(frames * dst);
        for frame in old.chunks_exact(src) {
            buf.extend_from_slice(&frame[..dst]);
        }
    }
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
    decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    track_id: u32,
    sample_buf: Option<Vec<f32>>,
    sample_pos: usize,
    channels: NonZero<u16>,
    sample_rate: NonZero<u32>,
    duration: Option<Duration>,
    replay_gain: Option<f32>,
    replay_gain_enabled: Arc<AtomicBool>,
    done: bool,
    seek_rx: Receiver<Duration>,
    volume: Arc<AtomicU32>,
    frame_count: usize,
    repeat_one_rx: Receiver<bool>,
    repeat_one: bool,
    event_tx: Sender<AudioEvent>,
    // stamped onto TrackFinished/TrackAdvanced so the command loop can discard signals from sources that were superseded before their finish event arrived
    generation: u64,
    // True when the container has non-audio streams
    use_coarse_seek: bool,
}

impl SymphoniaSource {
    fn open(
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

        let mut format = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
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
        // always advertise the device channel count to rodio's mixer
        // refill() will channel_map the decoded buffer to match
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

        // detect non-audio streams. some third party tools embed album art as a timed MJPEG video stream rather than a static metadata blob
        // this causes SeekMode::Accurate to scan through large video packets, freezing for seconds
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

    fn seek(&mut self, pos: Duration) {
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

                    // channel mapping: expand/contract buffer to match the advertised device channel count
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
            self.frame_count = (self.sample_rate.get() as usize / 100) * self.channels.get() as usize;
        }
        self.frame_count -= 1;

        loop {
            if let Some(ref buf) = self.sample_buf {
                if self.sample_pos < buf.len() {
                    let s = buf[self.sample_pos];
                    self.sample_pos += 1;
                    // Apply replay gain (if present and enabled) then volume — both scalar multiplies, no locks.
                    let s = if self.replay_gain_enabled.load(Ordering::Relaxed) {
                        match self.replay_gain {
                            Some(gain) => (s * gain).clamp(-1.0, 1.0),
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
                    // StateChanged { position: 0.0 } tells the command loop to reset TrackInfo
                    let _ = self
                        .event_tx
                        .try_send(AudioEvent::StateChanged { position: 0.0 });
                    continue;
                }
                self.done = true;
                // emit finish directly. command loop receives it instantly via select!
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

// =============================================================================
// RubatoResampler FFT resampler wrapping AudioSource
// =============================================================================

struct RubatoResampler {
    source:             SymphoniaSource,
    resampler:          Fft<f32>,
    input_buf:          Vec<Vec<f32>>, // [channels][frames]
    output_buf:         Vec<Vec<f32>>, // [channels][frames]
    output_interleaved: Vec<f32>,      // flat interleaved, capacity = output_frames_max * channels
    output_pos:         usize,
    chunk_size:         usize,         // stable for Fft/FixedSync::Both
    channels:           usize,
    dst_rate:           NonZero<u32>,
    done:               bool,
}

impl RubatoResampler {
    fn new(source: SymphoniaSource, dst_rate: NonZero<u32>) -> Result<Self, String> {
        let src_rate = source.sample_rate();
        let channels = source.channels().get() as usize;

        // Fft with FixedSync::Both: rubato picks exact chunk sizes for the ratio
        // (e.g. multiples of 147/160 for 44100→48000), eliminating internal buffering.
        // The hint of 1024 is rounded to the nearest legal value automatically.
        let resampler = Fft::<f32>::new(
            src_rate.get() as usize,  // sample_rate_input
            dst_rate.get() as usize,  // sample_rate_output
            1024,               // chunk_size hint (rounded to nearest legal value for the ratio)
            1,                  // sub_chunks (1 = no subdivision)
            channels,           // nbr_channels
            FixedSync::Both,
        )
        .map_err(|e| format!("Failed to create resampler: {}", e))?;

        let chunk_size        = resampler.input_frames_next(); // stable for FixedSync::Both
        let output_frames_max = resampler.output_frames_max();

        Ok(Self {
            source,
            resampler,
            input_buf:          vec![vec![0.0f32; chunk_size]; channels],
            output_buf:         vec![vec![0.0f32; output_frames_max]; channels],
            output_interleaved: Vec::with_capacity(output_frames_max * channels),
            output_pos:         0,
            chunk_size,
            channels,
            dst_rate,
            done:               false,
        })
    }

    // Fill input_buf from source, returns number of frames read.
    // De-interleaves L,R,L,R,... into input_buf[ch][frame] layout for rubato.
    // When the source ends mid-frame (ch > 0), the partial frame is completed
    // with zeros from `ch` onwards before zero-padding remaining frames, so
    // rubato always receives channel-aligned input and the returned frame count is correct.
    fn fill_input(&mut self) -> usize {
        for frame in 0..self.chunk_size {
            for ch in 0..self.channels {
                match self.source.next() {
                    Some(s) => self.input_buf[ch][frame] = s,
                    None => {
                        for pad_ch in ch..self.channels {
                            self.input_buf[pad_ch][frame] = 0.0;
                        }
                        for pad_frame in (frame + 1)..self.chunk_size {
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

        let is_last = frames_read < self.chunk_size;

        // Zero output buffer before each call so stale data from the previous
        // chunk can never bleed into the output on a short write.
        for ch in &mut self.output_buf {
            ch.fill(0.0);
        }

        let output_frames_max = self.resampler.output_frames_max();
        let input_adapter = SequentialSliceOfVecs::new(
            &self.input_buf, self.channels, self.chunk_size,
        ).map_err(|e| format!("Input adapter error: {}", e));
        let output_adapter = SequentialSliceOfVecs::new_mut(
            &mut self.output_buf, self.channels, output_frames_max,
        ).map_err(|e| format!("Output adapter error: {}", e));

        let result = match (input_adapter, output_adapter) {
            (Ok(inp), Ok(mut out)) => {
                let indexing = if is_last {
                    Some(Indexing {
                        input_offset: 0,
                        output_offset: 0,
                        active_channels_mask: None,
                        partial_len: Some(frames_read),
                    })
                } else {
                    None
                };
                self.resampler.process_into_buffer(&inp, &mut out, indexing.as_ref())
            }
            (Err(e), _) | (_, Err(e)) => {
                tracing::warn!("[AUDIO] Resampler adapter error: {}", e);
                self.done = true;
                return false;
            }
        };

        match result {
            Ok((_, out_frames)) => {
                self.output_interleaved.clear();
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
    fn current_span_len(&self) -> Option<usize> {
        let remaining = self.output_interleaved.len().saturating_sub(self.output_pos);
        if remaining > 0 { Some(remaining) } else { None }
    }
    fn channels(&self) -> NonZero<u16> {
        NonZero::new(self.channels as u16).unwrap()
    }
    fn sample_rate(&self) -> NonZero<u32> {
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
    queue_input: Arc<rodio::queue::SourcesQueueInput>,
    paused_flag: Arc<AtomicBool>,
    volume_atomic: Arc<AtomicU32>,
    volume: f32,
    eq_tx: Sender<EqSettings>,
    eq_settings: EqSettings,
    event_tx: Sender<AudioEvent>,
    device_sample_rate: NonZero<u32>,
    device_channels: NonZero<u16>,
    replay_gain_enabled: Arc<AtomicBool>,
    seek_tx: Option<Sender<Duration>>,
    repeat_one_tx: Option<Sender<bool>>,
    repeat_one: bool,
    current_info: Option<TrackInfo>,
    // generation counter . incremented on every open_and_append call
    // stamped into each source so finish events can be matched to the correct track
    generation_counter: u64,
    current_generation: u64,

    next_seek_tx: Option<Sender<Duration>>,
    next_repeat_one_tx: Option<Sender<bool>>,
    next_path: Option<String>,
    next_duration: Option<Option<Duration>>,
    next_generation: u64,

    // worker thread for off-thread open_and_append
    // single persistent thread receives OpenTask, does all blocking I/O and FFT construction, then sends back an OpenResult
    // two separate abort flags with asymmetric cancellation rules:
    //   play_abort   . set by a new Play command; cancels any in-flight Play or Preload
    //   preload_abort . set by a new Preload command; cancels only in-flight Preload tasks
    // this ensures a Preload dispatched right after a Play never aborts the Play task
    worker_tx: Sender<OpenTask>,
    play_abort: Arc<AtomicBool>,
    preload_abort: Arc<AtomicBool>,

    // set during device switch: absolute position to seek to once the worker result arrives
    pending_seek: Option<Duration>,
    // set when seek() is called before the worker has finished opening the source
    // stored as a fraction since duration isn't known yet; converted in open_result arm
    pending_seek_fraction: Option<f64>,
    // set during device switch: whether to re-pause once the worker result arrives
    pending_paused: bool,
    // set when TrackFinished fires while the preload worker is still in flight
    // open_result arm emits TrackAdvanced once the source is actually ready
    pending_track_advanced: bool,

    _stream: rodio::MixerDeviceSink,
}

impl AudioEngine {
    fn new(
        eq_settings: &EqSettings,
        preferred_device_id: Option<String>,
    ) -> Result<(Self, crossbeam::channel::Receiver<AudioEvent>, crossbeam::channel::Receiver<OpenResult>, DeviceList), String> {    
        use cpal::traits::{DeviceTrait, HostTrait};

        let host = cpal::default_host();

        // reuse the results for both device selection and building the cached DeviceList
        let all_devices: Vec<_> = host
            .output_devices()
            .map_err(|e| format!("Failed to enumerate devices: {}", e))?
            .collect();

        let default_device_id = host
            .default_output_device()
            .and_then(|d| d.id().ok())
            .map(|id| id.to_string());

        let cached_device_list = {
            let infos = all_devices.iter().filter_map(|d| {
                let id = d.id().ok()?.to_string();
                let desc = d.description().ok()?;
                let is_default = Some(&id) == default_device_id.as_ref();
                Some(AudioDeviceInfo {
                    id,
                    name: desc.name().to_string(),
                    manufacturer: desc.manufacturer().map(|s| s.to_string()),
                    driver: desc.driver().map(|s| s.to_string()),
                    device_type: desc.device_type().to_string(),
                    interface_type: desc.interface_type().to_string(),
                    address: desc.address().map(|s| s.to_string()),
                    extended: desc.extended().to_vec(),
                    is_default,
                })
            }).collect();
            DeviceList { devices: infos }
        };

        let device = if let Some(ref id_str) = preferred_device_id {
            match DeviceId::from_str(id_str) {
                Ok(id) => {
                    match host.device_by_id(&id) {
                        Some(d) => d,
                        None => {
                            tracing::warn!("[AUDIO] Device id '{}' not found, using default", id_str);
                            host.default_output_device()
                                .ok_or("No default output device found")?
                        }
                    }
                }
                Err(_) => {
                    tracing::warn!("[AUDIO] Invalid device id '{}', using default", id_str);
                    host.default_output_device()
                        .ok_or("No default output device found")?
                }
            }
        } else {
            host.default_output_device()
                .ok_or("No default output device found")?
        };

        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get output config: {}", e))?;

            let stream = rodio::DeviceSinkBuilder::from_device(device)
            .map_err(|e| format!("Failed to open audio output: {}", e))?
            .with_supported_config(&config)
            .open_stream()
            .map_err(|e| format!("Failed to open audio output: {}", e))?;   

        let device_sample_rate = NonZero::new(config.sample_rate())
            .ok_or("Device reported sample rate of 0")?;
        let device_channels = NonZero::new(config.channels())
            .ok_or("Device reported channel count of 0")?;

        tracing::info!(
            "[AUDIO] Output stream opened ({}Hz {}ch)",
            device_sample_rate, device_channels
        );

        let (queue_input, queue_output) = queue(true);
        let paused_flag = Arc::new(AtomicBool::new(false));
        let volume_atomic = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let replay_gain_enabled = Arc::new(AtomicBool::new(true));

        let (eq_tx, eq_rx) = unbounded::<EqSettings>();
        let (event_tx, event_rx) = unbounded::<AudioEvent>();

        // ── worker thread ────────────────────────────────────────────────────
        // receives OpenTask messages, does all blocking I/O + FFT construction off the command thread, sends back OpenResult
        // one persistent thread; abort flag lets it exit early when superseded
        let (worker_tx, worker_rx) = unbounded::<OpenTask>();
        let (open_result_tx, open_result_rx) = unbounded::<OpenResult>();
        {
            let open_result_tx = open_result_tx.clone();
            std::thread::spawn(move || {
                while let Ok(task) = worker_rx.recv() {
                    // Abort flag set by command thread when a newer command supersedes us.
                    if task.abort.load(Ordering::Relaxed) {
                        continue;
                    }

                    // ── blocking I/O ─────────────────────────────────────────
                    let src = SymphoniaSource::open(
                        &task.path,
                        task.replay_gain_db,
                        task.seek_rx,
                        task.repeat_one_rx,
                        task.event_tx,
                        task.generation,
                        task.volume,
                        task.replay_gain_enabled,
                        task.device_channels,
                    );

                    let src = match src {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = open_result_tx.send(OpenResult {
                                generation: task.generation,
                                seek_tx: {
                                    // seek_tx is already created by the command thread and passed via task
                                    // but on error we have nothing useful to send; create a dummy disconnected one
                                    let (tx, _) = unbounded::<Duration>();
                                    tx
                                },
                                repeat_one_tx: {
                                    let (tx, _) = unbounded::<bool>();
                                    tx
                                },
                                duration: None,
                                source: Err(e),
                            });
                            continue;
                        }
                    };

                    // checkpoint: abort before the expensive FFT construction
                    if task.abort.load(Ordering::Relaxed) {
                        continue;
                    }

                    // ── FFT resampler (expensive) ─────────────────────────────
                    let duration = src.duration;
                    let needs_resample = src.sample_rate() != task.device_sample_rate;

                    let ready = if needs_resample {
                        RubatoResampler::new(src, task.device_sample_rate)
                            .map(ReadySource::Resampled)
                    } else {
                        Ok(ReadySource::Raw(src))
                    };

                    let _ = open_result_tx.send(OpenResult {
                        generation: task.generation,
                        seek_tx: task.seek_tx,
                        repeat_one_tx: task.repeat_one_tx,
                        duration,
                        source: ready,
                    });
                }
            });
        }

        let pq = PausableQueue {
            inner: queue_output,
            paused: Arc::clone(&paused_flag),
            frame_pos: 0,
        };
        let eq_src = EqSource::new(pq, eq_settings, eq_rx);

        stream.mixer().add(eq_src);

        Ok((
            Self {
                queue_input,
                paused_flag,
                volume_atomic,
                volume: 0.7,
                eq_tx,
                eq_settings: eq_settings.clone(),
                event_tx,
                device_sample_rate,
                device_channels,
                replay_gain_enabled,
                seek_tx: None,
                repeat_one_tx: None,
                repeat_one: false,
                current_info: None,
                generation_counter: 0,
                current_generation: 0,
                next_seek_tx: None,
                next_repeat_one_tx: None,
                next_path: None,
                next_duration: None,
                next_generation: 0,
                worker_tx,
                play_abort: Arc::new(AtomicBool::new(false)),
                preload_abort: Arc::new(AtomicBool::new(false)),
                pending_seek: None,
                pending_seek_fraction: None,
                pending_paused: false,
                pending_track_advanced: false,
                _stream: stream,
            },
            event_rx,
            open_result_rx,
            cached_device_list,
        ))
    }

    // ── dispatch_open ──────────────────────────────────────────────────────
    // sends an OpenTask to the worker thread and returns immediately
    // worker does all blocking I/O + FFT construction off the command thread
    // command thread receives the OpenResult via the open_result_rx arm in select!
    fn dispatch_open(&mut self, path: &str, replay_gain_db: Option<f32>, abort_flag: Arc<AtomicBool>) -> u64 {
        self.generation_counter += 1;
        let generation = self.generation_counter;

        let (seek_tx, seek_rx) = unbounded::<Duration>();
        let (repeat_one_tx, repeat_one_rx) = unbounded::<bool>();
        let _ = repeat_one_tx.send(self.repeat_one);

        let _ = self.worker_tx.send(OpenTask {
            path: path.to_string(),
            replay_gain_db,
            generation,
            seek_rx,
            repeat_one_rx,
            event_tx: self.event_tx.clone(),
            volume: Arc::clone(&self.volume_atomic),
            replay_gain_enabled: Arc::clone(&self.replay_gain_enabled),
            device_sample_rate: self.device_sample_rate,
            device_channels: self.device_channels,
            abort: abort_flag,
            seek_tx,
            repeat_one_tx,
        });

        generation
    }

    // ── append_ready_source ───────────────────────────────────────────────────
    // called from the select! open_result arm when a worker result arrives
    // appends the built source to the queue
    fn append_ready_source(&mut self, source: ReadySource) {
        match source {
            ReadySource::Raw(src) => self.queue_input.append(src),
            ReadySource::Resampled(r) => self.queue_input.append(r),
        }
    }

    // ── play ─────────────────────────────────────────────────────────────────
    // dispatches the open to the worker and returns immediately
    // when the worker result arrives (select! open_result arm), the source is appended and engine state is updated
    fn play(&mut self, path: &str, replay_gain_db: Option<f32>) {
        // Clear all pending sources from the queue instantly.
        self.queue_input.clear();

        // Send stop sentinel to the currently-playing source and the preloaded one
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }

        self.seek_tx = None;
        self.repeat_one_tx = None;
        self.next_seek_tx = None;
        self.next_repeat_one_tx = None;
        self.next_path = None;
        self.next_duration = None;
        self.next_generation = 0; // prevent stale preload results from matching after play()

        // mark current_info with the pending path so the UI can update immediately,
        // duration unknown until the worker result arrives
        self.current_info = Some(TrackInfo {
            path: path.to_string(),
            duration: None,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        self.paused_flag.store(false, Ordering::Relaxed);
        // clear any pending flags from a previous in-flight preload
        // they belong to a different track transition and must not fire for this one
        self.pending_track_advanced = false;
        self.pending_seek = None;
        self.pending_seek_fraction = None;
        self.pending_paused = false;

        // cancel any in-flight Play AND Preload cuz a new explicit Play overrides everything
        // must happen before dispatch_open so the worker sees the flag before checking it
        self.play_abort.store(true, Ordering::Relaxed);
        self.preload_abort.store(true, Ordering::Relaxed);
        let new_play_abort = Arc::new(AtomicBool::new(false));
        self.play_abort = Arc::clone(&new_play_abort);

        let generation = self.dispatch_open(path, replay_gain_db, new_play_abort);
        self.current_generation = generation;

        tracing::info!("[AUDIO] Play dispatched (gen {}): {}", generation, path);
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

        if self.next_seek_tx.is_some() {
            // Kill the stale preloaded source and remove it from the queue.
            if let Some(ref tx) = self.next_seek_tx {
                let _ = tx.send(Duration::MAX);
            }
            self.queue_input.clear();
            self.next_seek_tx = None;
            self.next_repeat_one_tx = None;
        }

        // Cancel ONLY any in-flight Preload , never an in-flight Play
        // a Preload dispatched right after Play must not abort the Play task that is already running in the worker
        self.preload_abort.store(true, Ordering::Relaxed);
        let new_preload_abort = Arc::new(AtomicBool::new(false));
        self.preload_abort = Arc::clone(&new_preload_abort);

        // preload still dispatches to the worker
        // result arrives via open_result_rx and is handled in select!
        // we tag it with a negative sentinel by storing the path now so the result arm knows this was a preload, not a play
        self.next_path = Some(path.to_string());
        self.next_duration = None;
        let generation = self.dispatch_open(path, replay_gain_db, new_preload_abort);
        self.next_generation = generation;
        tracing::debug!("[AUDIO] Preload dispatched (gen {}): {}", generation, path);
        Ok(())
    }

    // ── seek ─────────────────────────────────────────────────────────────────
    fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        let info = self.current_info.as_mut().ok_or("No track loaded")?;

        // worker hasn't finished yet means no seek_tx and no duration
        // store the fraction and apply it in the open_result arm once the source is built and duration is known
        if self.seek_tx.is_none() {
            self.pending_seek_fraction = Some(position_fraction.clamp(0.0, 1.0));
            return Ok(());
        }

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
        self.repeat_one_tx = None;
        self.current_info = None;
        self.next_seek_tx = None;
        self.next_repeat_one_tx = None;
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
        self.eq_settings = settings.clone();
        let _ = self.eq_tx.send(settings.clone());
    }

    // replay gain enable/disable
    fn set_replay_gain_enabled(&mut self, enabled: bool) {
        self.replay_gain_enabled
            .store(enabled, Ordering::Relaxed);
        tracing::info!("[AUDIO] Replay gain enabled: {}", enabled);
    }

    // output device switch
    fn set_output_device(
        &mut self,
        device_name: Option<String>,
        event_rx_slot: &mut crossbeam::channel::Receiver<AudioEvent>,
        open_result_rx_slot: &mut crossbeam::channel::Receiver<OpenResult>,
    ) -> Result<DeviceList, String> {
        // snapshot current playback state before tearing down
        let snapshot = self.current_info.as_ref().map(|info| {
            (info.path.clone(), Duration::from_secs_f64(info.position_secs()))
        });
        let was_paused = self.paused_flag.load(Ordering::Relaxed);
        let volume = self.volume;
        let repeat_one = self.repeat_one;
        let replay_gain_enabled = self.replay_gain_enabled.load(Ordering::Relaxed);
        let eq_settings = self.eq_settings.clone();

        // clear all pending/preloaded sources
        self.queue_input.clear();
        if let Some(ref tx) = self.seek_tx {
            let _ = tx.send(Duration::MAX);
        }
        if let Some(ref tx) = self.next_seek_tx {
            let _ = tx.send(Duration::MAX);
        }

        // build new engine on the selected device, carrying all current settings
        let (mut new_engine, new_event_rx, new_open_result_rx, new_device_list) =
            AudioEngine::new(&eq_settings, device_name.clone())?;

        // transfer all live settings to the new engine
        new_engine.set_volume(volume);
        new_engine.replay_gain_enabled.store(replay_gain_enabled, Ordering::Relaxed);
        new_engine.repeat_one = repeat_one;

        // resume track at the snapshotted position if one was playing
        // play() is now non-blocking
        // seek and pause are applied when worker result arrives via pending_seek / pending_paused
        if let Some((path, position)) = snapshot {
            new_engine.pending_seek = Some(position);
            new_engine.pending_paused = was_paused;
            new_engine.play(&path, None);
        }

        // swap channel slots so the command loop uses the new engine's channels
        *event_rx_slot = new_event_rx;
        *open_result_rx_slot = new_open_result_rx;

        if let Some(ref path) = self.next_path {
            tracing::warn!("[AUDIO] Device switch: discarding preloaded track: {}", path);
        }

        // replace self so that the old _stream is dropped here, killing the old pipeline
        *self = new_engine;

        tracing::info!("[AUDIO] Output device switched successfully");
        Ok(new_device_list)
    }

    // ── repeat one ───────────────────────────────────────────────────────────
    fn set_repeat_one(&mut self, enabled: bool) {
        self.repeat_one = enabled;
        if let Some(ref tx) = self.repeat_one_tx {
            let _ = tx.send(enabled);
        }
    }

}

// =============================================================================
// AUDIO EVENTS  (backend -> frontend via app_handle.emit)
// =============================================================================
// all variants are pushed immediately when the condition occurs
// frontend registers listen('audio://event', handler) once on init
// =============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum AudioEvent {
    TrackFinished { generation: u64 },
    TrackAdvanced { generation: u64, new_path: String, duration: Option<Duration> },
    StateChanged { position: f64 },
    DeviceListChanged { devices: DeviceList },
    Error { message: String },
}

// =============================================================================
// WORKER TYPES  (open_and_append offloaded to a single persistent worker thread)
// =============================================================================

// task sent to worker thread
struct OpenTask {
    path: String,
    replay_gain_db: Option<f32>,
    generation: u64,
    seek_rx: crossbeam::channel::Receiver<Duration>,
    repeat_one_rx: crossbeam::channel::Receiver<bool>,
    // tx halves are passed through so the worker can include them in OpenResult without the command thread needing to track them separately
    seek_tx: Sender<Duration>,
    repeat_one_tx: Sender<bool>,
    event_tx: Sender<AudioEvent>,
    volume: Arc<AtomicU32>,
    replay_gain_enabled: Arc<AtomicBool>,
    device_sample_rate: NonZero<u32>,
    device_channels: NonZero<u16>,
    abort: Arc<AtomicBool>,
}

// fully built source ready to be appended to the queue, returned by the worker
enum ReadySource {
    Raw(SymphoniaSource),
    Resampled(RubatoResampler),
}

// Result sent back from the worker to the command thread
struct OpenResult {
    generation: u64,
    seek_tx: Sender<Duration>,
    repeat_one_tx: Sender<bool>,
    duration: Option<Duration>,
    source: Result<ReadySource, String>,
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
    SetReplayGainEnabled(bool),
    SetOutputDevice(Option<String>),
}

// =============================================================================
// PlaybackStateSync — global handle, lives on the main thread
// =============================================================================

pub struct PlaybackStateSync {
    command_tx: Sender<AudioCommand>,
    pub device_list: Arc<Mutex<DeviceList>>,
}

impl PlaybackStateSync {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();
        let device_list = Arc::new(Mutex::new(DeviceList {
            devices: Vec::new(),
        }));

        let device_list_clone = Arc::clone(&device_list);

        std::thread::spawn(move || {
            let mut engine_opt: Option<AudioEngine> = None;
            let mut eq_settings = EqSettings::default();

            // before the engine is initialised there are no event/open-result channels yet
            // permanently disconnected receivers act as silent placeholders:
            // crossbeam::select! will never fire on a disconnected receiver
            let (_dead_tx, dead_rx) = crossbeam::channel::bounded::<AudioEvent>(0);
            drop(_dead_tx);
            let mut event_rx: crossbeam::channel::Receiver<AudioEvent> = dead_rx;

            let (_dead_open_tx, dead_open_rx) = crossbeam::channel::bounded::<OpenResult>(0);
            drop(_dead_open_tx);
            let mut open_result_rx: crossbeam::channel::Receiver<OpenResult> = dead_open_rx;

            // emit a backend event to the frontend
            // errors here are non-fatal as the window may be closing
            let emit = |evt: AudioEvent| {
                if let Err(e) = app_handle.emit("audio://event", &evt) {
                    tracing::warn!("[AUDIO] Failed to emit event: {}", e);
                }
            };

            loop {
                // block until a command, an audio-thread event, or a worker result arrives
                crossbeam::select! {
                    recv(rx) -> msg => {
                        let cmd = match msg {
                            Ok(c) => c,
                            Err(_) => break, // command channel disconnected
                        };

                        // lazy engine init, only on the first command
                        if engine_opt.is_none() {
                            match AudioEngine::new(&eq_settings, None) {
                                Ok((e, evt_rx, open_rx, dl)) => {
                                    event_rx = evt_rx;
                                    open_result_rx = open_rx;
                                    engine_opt = Some(e);
                                    if let Ok(mut cached) = device_list_clone.lock() {
                                        *cached = dl;
                                    }
                                }
                                Err(e) => {
                                    tracing::error!("[AUDIO] Engine init failed: {}", e);
                                    emit(AudioEvent::Error { message: e });
                                    continue;
                                }
                            }
                        }

                        let engine = engine_opt.as_mut().unwrap();

                        match cmd {
                            AudioCommand::Play(path, rg) => {
                                // non-blocking: dispatches to worker, returns immediately
                                engine.play(&path, rg);
                            }
                            AudioCommand::Preload(path, rg) => {
                                if let Err(e) = engine.preload(&path, rg) {
                                    tracing::warn!("[AUDIO] preload error: {}", e);
                                }
                            }
                            AudioCommand::Pause => engine.pause(),
                            AudioCommand::Resume => engine.resume(),
                            AudioCommand::Stop => engine.stop(),
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
                            AudioCommand::SetReplayGainEnabled(v) => {
                                engine.set_replay_gain_enabled(v);
                            }
                            AudioCommand::SetOutputDevice(name) => {
                                match engine.set_output_device(name, &mut event_rx, &mut open_result_rx) {
                                    Ok(new_device_list) => {
                                        if let Ok(mut cached) = device_list_clone.lock() {
                                            *cached = new_device_list.clone();
                                        }
                                        emit(AudioEvent::DeviceListChanged { devices: new_device_list });
                                    }
                                    Err(e) => {
                                        tracing::error!("[AUDIO] Device switch failed: {}", e);
                                        emit(AudioEvent::Error { message: e });
                                    }
                                }
                            }
                        }
                    }

                    // ── worker result arm ─────────────────────────────────────────────
                    // worker has finished opening + building the source (or failed)
                    // discard stale results (superseded Play commands); apply current ones
                    recv(open_result_rx) -> msg => {
                        let result = match msg {
                            Ok(r) => r,
                            Err(_) => {
                                // channel disconnected (engine dropped/replaced)
                                let (_dead_tx, dead_rx) = crossbeam::channel::bounded::<OpenResult>(0);
                                drop(_dead_tx);
                                open_result_rx = dead_rx;
                                continue;
                            }
                        };

                        let engine = match engine_opt.as_mut() {
                            Some(e) => e,
                            None => continue,
                        };

                        // Check if this is a Play result or a Preload result
                        // Play results match current_generation
                        // Preload results match next_generation
                        let is_play   = result.generation == engine.current_generation;
                        let is_preload = result.generation == engine.next_generation
                            && result.generation != engine.current_generation;

                        if !is_play && !is_preload {
                            tracing::debug!(
                                "[AUDIO] Discarding stale open result (gen {} — current {}, next {})",
                                result.generation, engine.current_generation, engine.next_generation
                            );
                            continue;
                        }

                        match result.source {
                            Err(e) => {
                                tracing::error!("[AUDIO] open error: {}", e);
                                emit(AudioEvent::Error { message: e });
                                if is_play {
                                    engine.current_info = None;
                                } else {
                                    engine.next_path = None;
                                    engine.next_duration = None;
                                }
                            }
                            Ok(source) => {
                                if is_play {
                                    // clear queue and kill any currently-playing source
                                    // play() already did this but for safety
                                    engine.queue_input.clear();
                                    if let Some(ref tx) = engine.seek_tx {
                                        let _ = tx.send(Duration::MAX);
                                    }

                                    engine.append_ready_source(source);
                                    engine.seek_tx = Some(result.seek_tx);
                                    engine.repeat_one_tx = Some(result.repeat_one_tx);

                                    // apply pending seek/pause from device switch if set
                                    if let Some(pos) = engine.pending_seek.take() {
                                        if let Some(ref tx) = engine.seek_tx {
                                            let _ = tx.send(pos);
                                        }
                                        if let Some(ref mut info) = engine.current_info {
                                            info.offset = pos;
                                            info.started = Instant::now();
                                        }
                                    }

                                    // apply pending seek from a seek() call that arrived before the worker finished
                                    // convert fraction to duration now that we have the real duration
                                    if let Some(fraction) = engine.pending_seek_fraction.take() {
                                        if let Some(duration) = result.duration {
                                            let pos = Duration::from_secs_f64(
                                                duration.as_secs_f64() * fraction
                                            );
                                            if let Some(ref tx) = engine.seek_tx {
                                                let _ = tx.send(pos);
                                            }
                                            if let Some(ref mut info) = engine.current_info {
                                                info.offset = pos;
                                                info.started = Instant::now();
                                            }
                                        }
                                    }
                                    if engine.pending_paused {
                                        engine.pending_paused = false;
                                        engine.paused_flag.store(true, Ordering::Relaxed);
                                    }

                                    // update duration now that the worker has probed it
                                    if let Some(ref mut info) = engine.current_info {
                                        info.duration = result.duration;
                                    }

                                    // if TrackFinished fired while this source was still being
                                    // built (in-flight preload case), emit TrackAdvanced now that we have the real duration and the source is appended
                                    if engine.pending_track_advanced {
                                        engine.pending_track_advanced = false;
                                        if let Some(ref info) = engine.current_info {
                                            emit(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: info.path.clone(),
                                                duration: info.duration,
                                            });
                                        }
                                    }

                                    tracing::info!(
                                        "[AUDIO] Source ready and appended (gen {}), duration={:?}",
                                        result.generation, result.duration
                                    );
                                } else {
                                    // preload result => append after the current source
                                    engine.append_ready_source(source);
                                    engine.next_seek_tx = Some(result.seek_tx);
                                    engine.next_repeat_one_tx = Some(result.repeat_one_tx);
                                    engine.next_duration = Some(result.duration);
                                    tracing::debug!(
                                        "[AUDIO] Preloaded source ready and appended (gen {})",
                                        result.generation
                                    );
                                }
                            }
                        }
                    }

                    recv(event_rx) -> msg => {
                        match msg {
                            Ok(evt) => {
                                let engine = match engine_opt.as_mut() {
                                    Some(e) => e,
                                    None => { emit(evt); continue; }
                                };

                                match evt {
                                    // ── track finished naturally ──────────────────────────────
                                    // only act if this signal belongs to the current generation
                                    // a stale finish from a source killed by Play() is discarded
                                    AudioEvent::TrackFinished { generation } => {
                                        if generation != engine.current_generation {
                                            tracing::debug!(
                                                "[AUDIO] Discarding stale TrackFinished \
                                                 (gen {} != current {})",
                                                generation, engine.current_generation
                                            );
                                            continue;
                                        }
                                        if engine.next_path.is_some() && engine.next_seek_tx.is_some() {
                                            // Gapless handoff => promote preloaded track
                                            // next_seek_tx.is_some confirms the worker has finished and the source is already appended to the queue
                                            engine.seek_tx = engine.next_seek_tx.take();
                                            engine.repeat_one_tx = engine.next_repeat_one_tx.take();
                                            engine.current_generation = engine.next_generation;
                                            let duration = engine.next_duration.take().flatten();
                                            let path = engine.next_path.take().unwrap_or_default();
                                            engine.current_info = Some(TrackInfo {
                                                path: path.clone(),
                                                duration,
                                                started: Instant::now(),
                                                offset: Duration::ZERO,
                                            });
                                            emit(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: path,
                                                duration,
                                            });
                                        } else if engine.next_path.is_some() {
                                            // preload was dispatched but the worker hasn't finished yet
                                            // open_result arm will do the handoff when it arrives
                                            // for now promote the generation so the result arm knows
                                            // this is now a play result, not a preload
                                            tracing::debug!(
                                                "[AUDIO] TrackFinished but preload worker still in flight \
                                                 (gen {}), waiting for result",
                                                engine.next_generation
                                            );
                                            engine.current_generation = engine.next_generation;
                                            engine.seek_tx = None;
                                            engine.repeat_one_tx = None;
                                            // update current_info to the preloaded path so the
                                            // open_result arm finds the right track when it arrives
                                            let path = engine.next_path.take().unwrap_or_default();
                                            engine.current_info = Some(TrackInfo {
                                                path: path.clone(),
                                                duration: None, // filled in by open_result arm
                                                started: Instant::now(),
                                                offset: Duration::ZERO,
                                            });
                                            engine.next_duration = None;
                                            // signal the open_result arm to emit TrackAdvanced
                                            // once the source is ready and duration is known
                                            engine.pending_track_advanced = true;
                                        } else {
                                            engine.seek_tx = None;
                                            engine.repeat_one_tx = None;
                                            engine.current_info = None;
                                            emit(AudioEvent::TrackFinished { generation });
                                        }
                                    }

                                    // repeat-one loop ───────────────────────────────────────
                                    // StateChanged { position: 0.0 } doubles as the loop signal
                                    // reset TrackInfo so position_secs reads from the new zero
                                    AudioEvent::StateChanged { position } if position == 0.0 => {
                                        if let Some(ref mut info) = engine.current_info {
                                            info.offset = Duration::ZERO;
                                            info.started = Instant::now();
                                        }
                                        emit(AudioEvent::StateChanged { position });
                                    }

                                    // all other events pass through
                                    other => emit(other),
                                }
                            }
                            Err(_) => {
                                // event channel disconnected (engine dropped)
                                let (_dead_tx, dead_rx) = crossbeam::channel::bounded::<AudioEvent>(0);
                                drop(_dead_tx);
                                event_rx = dead_rx;
                            }
                        }
                    }
                }
            }
        });

        Self {
            command_tx: tx,
            device_list,
        }
    }

    fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.command_tx.send(cmd).map_err(|e| e.to_string())
    }
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

use tauri::Manager;
use crate::db::Database;
use crate::sync::SyncState;

async fn resolve_audio_path(
    path: &str,
    track_id: Option<i64>,
    db: &Database,
    sync_state: &SyncState,
) -> Result<String, String> {
    use rusqlite::OptionalExtension;

    // 1. Look up track in local database
    let track_opt = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, path, source_type, local_src, format FROM tracks WHERE path = ?1",
            rusqlite::params![path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let is_server_track = if let Some((_, _, ref source_type, _, _)) = track_opt {
        source_type.as_deref() == Some("server")
    } else {
        path.starts_with("music/")
    };

    if !is_server_track {
        return Ok(path.to_string()); // Not a server track, pass through
    }

    let (tid, track_path, local_src, format) = match track_opt {
        Some((db_id, db_path, _, db_local_src, db_format)) => {
            (Some(db_id), db_path, db_local_src, db_format)
        }
        None => {
            (None, path.to_string(), None, None)
        }
    };

    // 2. Check if local_src is set and the file exists
    if let Some(ref local_path) = local_src {
        if std::path::Path::new(local_path).exists() {
            return Ok(local_path.clone());
        }
    }

    // 3. Resolve cache directory and filename
    let app_handle = sync_state.app_handle.as_ref()
        .ok_or_else(|| "App handle not found in SyncState".to_string())?;
    
    let app_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    let cache_dir = app_dir.join("cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }

    let ext = std::path::Path::new(&track_path)
        .extension()
        .and_then(|s| s.to_str())
        .or(format.as_deref())
        .unwrap_or("mp3");

    let cache_id = match tid {
        Some(id) => id.to_string(),
        None => {
            if let Some(id) = track_id {
                id.to_string()
            } else {
                return Err("No track ID available to resolve server track".to_string());
            }
        }
    };

    let cache_path = cache_dir.join(format!("{}.{}", cache_id, ext));

    // 4. Download file if missing from disk
    if !cache_path.exists() {
        tracing::info!("Downloading track {} from server to {:?}", cache_id, cache_path);
        
        let server_url = sync_state.server_url.lock().unwrap().clone();
        let token = crate::sync::auth::get_access_token(db)?
            .ok_or_else(|| "Not logged in to server".to_string())?;

        let server_track_id = match tid {
            Some(local_id) => {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                crate::db::queries::get_server_id(&conn, &format!("lib_{}", local_id), "library_track")
                    .map_err(|e| e.to_string())?
                    .or_else(|| {
                        crate::db::queries::get_server_id(&conn, &format!("liked_{}", local_id), "liked_track")
                            .ok()
                            .flatten()
                    })
                    .unwrap_or_else(|| local_id.to_string())
            }
            None => {
                if let Some(id) = track_id {
                    id.to_string()
                } else {
                    return Err("No track ID available to resolve server track".to_string());
                }
            }
        };

        let client = reqwest::Client::new();
        let stream_url = format!("{}/api/tracks/{}/stream", server_url, server_track_id);
        
        let mut resp = client.get(&stream_url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to server: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned error playing track ({}): {}", resp.status(), resp.status().canonical_reason().unwrap_or("Unknown")));
        }

        // Stream body to file
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&cache_path).await
            .map_err(|e| format!("Failed to create cache file: {}", e))?;

        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        file.flush().await.map_err(|e| e.to_string())?;

        // 5. Update local_src in database
        if let Some(local_id) = tid {
            let cache_path_str = cache_path.to_string_lossy().to_string();
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET local_src = ?1 WHERE id = ?2",
                rusqlite::params![cache_path_str, local_id],
            ).ok();
        }
    }

    Ok(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn audio_play(
    path: String,
    track_id: Option<i64>,
    replay_gain_db: Option<f32>,
    state: tauri::State<'_, PlaybackStateSync>,
    db: tauri::State<'_, Database>,
    sync_state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    let resolved_path = resolve_audio_path(&path, track_id, &db, &sync_state).await?;
    state.send(AudioCommand::Play(resolved_path, replay_gain_db))
}

#[tauri::command]
pub async fn audio_preload(
    path: String,
    track_id: Option<i64>,
    replay_gain_db: Option<f32>,
    state: tauri::State<'_, PlaybackStateSync>,
    db: tauri::State<'_, Database>,
    sync_state: tauri::State<'_, SyncState>,
) -> Result<(), String> {
    tracing::info!("[AUDIO] Preload requested: {}", path);
    let resolved_path = resolve_audio_path(&path, track_id, &db, &sync_state).await?;
    state.send(AudioCommand::Preload(resolved_path, replay_gain_db))
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
pub fn audio_set_replay_gain_enabled(
    enabled: bool,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetReplayGainEnabled(enabled))
}

#[tauri::command]
pub fn native_audio_available(_state: tauri::State<'_, PlaybackStateSync>) -> bool {
    true
}

#[tauri::command]
pub fn audio_list_output_devices() -> Result<DeviceList, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let all_devices: Vec<_> = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?
        .collect();
    let default_device_id = host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());
    let devices = all_devices.iter().filter_map(|d| {
        let id = d.id().ok()?.to_string();
        let desc = d.description().ok()?;
        let is_default = Some(&id) == default_device_id.as_ref();
        Some(AudioDeviceInfo {
            id,
            name: desc.name().to_string(),
            manufacturer: desc.manufacturer().map(|s| s.to_string()),
            driver: desc.driver().map(|s| s.to_string()),
            device_type: desc.device_type().to_string(),
            interface_type: desc.interface_type().to_string(),
            address: desc.address().map(|s| s.to_string()),
            extended: desc.extended().to_vec(),
            is_default,
        })
    }).collect();
    Ok(DeviceList { devices })
}

#[tauri::command]
pub fn audio_get_device_info(
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<DeviceList, String> {
    state
        .device_list
        .lock()
        .map(|dl| dl.clone())
        .map_err(|_| "Device list lock poisoned".into())
}

#[tauri::command]
pub fn audio_set_output_device(
    device_id: Option<String>,
    state: tauri::State<'_, PlaybackStateSync>,
) -> Result<(), String> {
    state.send(AudioCommand::SetOutputDevice(device_id))
}

#[tauri::command]
pub async fn audio_resolve_path(
    path: String,
    track_id: Option<i64>,
    db: tauri::State<'_, Database>,
    sync_state: tauri::State<'_, SyncState>,
) -> Result<String, String> {
    resolve_audio_path(&path, track_id, &db, &sync_state).await
}

#[tauri::command]
pub async fn audio_get_stream_url(
    path: String,
    track_id: Option<i64>,
    db: tauri::State<'_, Database>,
    sync_state: tauri::State<'_, SyncState>,
) -> Result<String, String> {
    use rusqlite::OptionalExtension;

    let track_opt = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, path, source_type FROM tracks WHERE path = ?1",
            rusqlite::params![path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let (tid, _) = match track_opt {
        Some((db_id, db_path, _)) => (Some(db_id), db_path),
        None => (None, path.to_string()),
    };

    let server_url = sync_state.server_url.lock().unwrap().clone();
    let token = crate::sync::auth::get_access_token(&db)?
        .ok_or_else(|| "Not logged in to server".to_string())?;

    let server_track_id = match tid {
        Some(local_id) => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            crate::db::queries::get_server_id(&conn, &format!("lib_{}", local_id), "library_track")
                .map_err(|e| e.to_string())?
                .or_else(|| {
                    crate::db::queries::get_server_id(&conn, &format!("liked_{}", local_id), "liked_track")
                        .ok()
                        .flatten()
                })
                .unwrap_or_else(|| local_id.to_string())
        }
        None => {
            if let Some(id) = track_id {
                id.to_string()
            } else {
                return Err("No track ID available".to_string());
            }
        }
    };

    Ok(format!("{}/api/tracks/{}/stream?token={}", server_url, server_track_id, token))
}
