//! opus decoding
//!
//! symphonia has no built-in opus decoder
//! but the "ogg"/"mkv" container features are enough to demux opus packets out of .opus/.ogg files and Opus-in-WebM/Matroska
//! this module reuses symphonia as a packet-level demuxer and routes the raw Opus packet payloads to
//! opus_rs::OpusDecoder instead of symphonia::core::codecs::audio::AudioDecoder
//!
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::num::NonZero;

use crossbeam::channel::{Receiver, Sender};
use rodio::Source;

use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::formats::probe::Hint;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use opus_rs::multistream::{ChannelMappingTable, MultistreamDecoder};
use opus_rs::OpusDecoder;

use super::mod_types::AudioEvent;
use super::symphonia::resolve_replay_gain;

// opus always decodes internally at (up to) 48 khz regardless of the original encode rate (RFC 6716 2)
// we always request the max here and let the resampler match the device output rate
const OPUS_DECODE_RATE: u32 = 48_000;

// RFC 7845 5.1 => the ogg-opus identification header "OpusHead"
// symphonia's Ogg demuxer surfaces this as the track's codec extra_data
// (the raw first packet of the logical stream)
struct OpusHead {
    channels: u8,
    pre_skip: u16,
    // output_gain is a Q7.8 fixed-point dB value
    // stored as-is and applied as a linear multiplier at decode time
    output_gain_db: f32,
    // Some(table) for mapping_family != 0 (multistream/surround) tracks,
    // parsed straight out of the bytes that follow the fixed 19-byte prefix
    // None means single-stream mono/stereo
    channel_mapping: Option<ChannelMappingTable>,
}

impl OpusHead {
    /// parses RFC 7845 5.1's fixed 19-byte header prefix, plus (when present)
    /// the 5.1.1 channel mapping table that follows it for multistream/surround tracks
    /// returns a fallback (stereo, no pre-skip/gain, no mapping table) if the bytes are
    /// missing or too short to be a real OpusHead, so a malformed/absent header fails gracefully
    fn parse(extra_data: &[u8], fallback_channels: u8) -> Self {
        // layout: "OpusHead"(8) | version(1) | channels(1) | pre_skip(2 LE)
        //       | input_sample_rate(4 LE) | output_gain(2 LE, Q7.8) | mapping_family(1)
        //       | [stream_count(1) | coupled_count(1) | channel_mapping[channels] ] (mapping_family != 0 only)
        if extra_data.len() < 19 || &extra_data[0..8] != b"OpusHead" {
            tracing::warn!(
                "[AUDIO] OpusHead missing/malformed (got {} bytes) — using defaults",
                extra_data.len()
            );
            return Self {
                channels: fallback_channels,
                pre_skip: 0,
                output_gain_db: 0.0,
                channel_mapping: None,
            };
        }

        let channels = extra_data[9];
        let pre_skip = u16::from_le_bytes([extra_data[10], extra_data[11]]);
        let output_gain_raw = i16::from_le_bytes([extra_data[16], extra_data[17]]);
        let output_gain_db = output_gain_raw as f32 / 256.0;

        // ChannelMappingTable::parse returns None both for mapping_family == 0 and
        // for a table that's present-but-truncated, 
        // so a malformed extension also falls back gracefully
        let mapping_family = extra_data[18];
        let channel_mapping = ChannelMappingTable::parse(mapping_family, channels, &extra_data[19..]);
        if mapping_family != 0 && channel_mapping.is_none() {
            tracing::warn!(
                "[AUDIO] OpusHead declares mapping_family {} but channel mapping table is truncated — \
                 falling back to single-stream decode",
                mapping_family
            );
        }

        Self {
            channels,
            pre_skip,
            output_gain_db,
            channel_mapping,
        }
    }

    #[inline]
    fn output_gain_linear(&self) -> f32 {
        10.0f32.powf(self.output_gain_db / 20.0)
    }
}

/// either a plain single-stream decoder (mono/stereo)
/// or a multistream decoder (channel mapping family 1 surround, e.g. 5.1/7.1)
/// CELT/SILK never see more than 2 channels either way
/// the multistream branch just fans a packet out to several single-stream decoders and reassembles the result
enum AnyOpusDecoder {
    Single(OpusDecoder),
    Multi(MultistreamDecoder),
}

impl AnyOpusDecoder {
    fn new(
        rate: i32,
        channels: u8,
        mapping: Option<&ChannelMappingTable>,
    ) -> Result<Self, String> {
        match mapping {
            Some(table) => MultistreamDecoder::new(rate, table.clone())
                .map(AnyOpusDecoder::Multi)
                .map_err(|e| format!("Failed to create multistream Opus decoder: {}", e)),
            None => OpusDecoder::new(rate, channels as usize)
                .map(AnyOpusDecoder::Single)
                .map_err(|e| format!("Failed to create Opus decoder: {:?}", e)),
        }
    }

    #[inline]
    fn decode(
        &mut self,
        packet: &[u8],
        frame_size: usize,
        out: &mut [f32],
    ) -> Result<usize, String> {
        match self {
            AnyOpusDecoder::Single(d) => {
                d.decode(packet, frame_size, out).map_err(|e| format!("{:?}", e))
            }
            AnyOpusDecoder::Multi(d) => {
                d.decode(packet, frame_size, out).map_err(|e| format!("{:?}", e))
            }
        }
    }
}

fn probe_opus(
    path: &str,
    mss: MediaSourceStream<'static>,
    hint: &Hint,
) -> symphonia::core::errors::Result<Box<dyn FormatReader>> {
    symphonia::default::get_probe()
        .probe(hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| {
            tracing::warn!("[AUDIO] Opus probe failed for '{}': {}", path, e);
            e
        })
}

pub struct OpusSource {
    pub format: Box<dyn FormatReader>,
    pub decoder: AnyOpusDecoder,
    /// retained so seek() and the ResetRequired path in refill() can rebuild the decoder with identical parameters
    channel_mapping: Option<ChannelMappingTable>,
    pub track_id: u32,
    pub pre_skip: u16,
    /// counts down from pre_skip at the very start of the stream, and
    /// again after any seek back to a position inside the skip window
    /// mirrors what libopus/opusdec do, since the pre-skip samples are encoder priming, not real audio
    pre_skip_remaining: u16,
    pub output_gain: f32,
    pub sample_buf: Vec<f32>,
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
}

impl OpusSource {
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

        let mut format =
            probe_opus(path, mss, &hint).map_err(|e| format!("Failed to probe {}: {}", path, e))?;

        let track = format
            .default_track(symphonia::core::formats::TrackType::Audio)
            .ok_or_else(|| format!("No audio track found in {}", path))?;

        let audio_params = match &track.codec_params {
            Some(symphonia::core::codecs::CodecParameters::Audio(p)) => p,
            _ => return Err(format!("No audio codec params in {}", path)),
        };

        let track_id = track.id;

        let extra_data: &[u8] = audio_params
            .extra_data
            .as_deref()
            .unwrap_or(&[]);

        let fallback_channels = audio_params
            .channels
            .as_ref()
            .map(|c| c.count() as u8)
            .unwrap_or(2);

        let head = OpusHead::parse(extra_data, fallback_channels);

        // plain mono/stereo (mapping_family == 0,
        // or a truncated mapping table that OpusHead::parse already fell back from)
        // goes through the single-stream OpusDecoder
        // mapping_family 1 (5.1/7.1-style surround) routes through MultistreamDecoder instead
        // see opus_rs::multistream
        // either way CELT/SILK itself only ever decodes 1 or 2 channels per elementary stream
        let decoder = AnyOpusDecoder::new(
            OPUS_DECODE_RATE as i32,
            head.channels,
            head.channel_mapping.as_ref(),
        )
        .map_err(|e| format!("{} for {}", e, path))?;

        let duration = track.time_base.and_then(|tb| {
            track.duration.and_then(|d| {
                let time = tb.calc_time(symphonia::core::units::Timestamp::from(d.get() as i64))?;
                Some(std::time::Duration::from_secs_f64(time.as_secs_f64()))
            })
        });

        // opus files carry ReplayGain similar to other Ogg-tagged format
        // (vorbis comments, plus R128_TRACK_GAIN which Opus conventionally uses)
        // reuse symphonia.rs's tag-scan fallback so a track without a pre-resolved replay_gain_db still gets scanned
        let replay_gain = resolve_replay_gain(replay_gain_db, &mut format);

        match &head.channel_mapping {
            Some(table) => tracing::info!(
                "[AUDIO] Opus track: {}Hz decode, {}ch multistream (family 1, {} streams, {} coupled, \
                 pre_skip={}, device {}ch) — {}",
                OPUS_DECODE_RATE,
                head.channels,
                table.stream_count,
                table.coupled_count,
                head.pre_skip,
                device_channels,
                path
            ),
            None => tracing::info!(
                "[AUDIO] Opus track: {}Hz decode, {}ch (pre_skip={}, device {}ch) — {}",
                OPUS_DECODE_RATE,
                head.channels,
                head.pre_skip,
                device_channels,
                path
            ),
        }

        let output_gain = head.output_gain_linear();

        Ok(Self {
            format,
            decoder,
            channel_mapping: head.channel_mapping,
            track_id,
            pre_skip: head.pre_skip,
            pre_skip_remaining: head.pre_skip,
            output_gain,
            sample_buf: Vec::new(),
            sample_pos: 0,
            channels: NonZero::new(head.channels as u16).unwrap_or(device_channels),
            sample_rate: NonZero::new(OPUS_DECODE_RATE).expect("48000 is nonzero"),
            duration,
            replay_gain,
            replay_gain_enabled,
            done: false,
            seek_rx,
            volume,
            frame_count: 0,
            repeat_one_rx,
            repeat_one: false,
            event_tx,
            generation,
        })
    }

    pub fn seek(&mut self, pos: Duration) {
        let secs = pos.as_secs_f64();
        let Some(time) = symphonia::core::units::Time::try_from_secs_f64(secs) else {
            tracing::warn!("[AUDIO] opus seek: invalid position {:?}", pos);
            return;
        };
        match self.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(self.track_id),
            },
        ) {
            Ok(_) => {}
            Err(e) => tracing::warn!("[AUDIO] opus seek error: {}", e),
        }
        self.decoder = AnyOpusDecoder::new(
            OPUS_DECODE_RATE as i32,
            self.channels.get() as u8,
            self.channel_mapping.as_ref(),
        )
        .expect("Opus decoder rebuild after seek should never fail (same params as initial open)");
        self.sample_buf.clear();
        self.sample_pos = 0;
        self.done = false;
        // a seek doesn't land exactly on the pre-skip boundary in general,
        // and only the very start of the logical stream needs skipping =>
        // logical position zero is the opus stream start though
        // (repeat-one seeks here),
        // so re-arm pre_skip there or encoder priming samples leak through
        if pos == Duration::ZERO {
            self.pre_skip_remaining = self.pre_skip;
        }
    }

    fn refill(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => return false,
                Err(SymphoniaError::IoError(_)) => return false,
                Err(SymphoniaError::ResetRequired) => {
                    // mirrors symphonia.rs's refill():
                    // a new internal decoder state (e.g. a chained Ogg stream) 
                    // doesn't end the track, it just means the next packet needs a fresh decoder
                    // rebuild with the same params and keep pulling packets instead of surfacing this as track-end
                    self.decoder = AnyOpusDecoder::new(
                        OPUS_DECODE_RATE as i32,
                        self.channels.get() as u8,
                        self.channel_mapping.as_ref(),
                    )
                    .expect(
                        "Opus decoder rebuild after ResetRequired should never fail (same params as initial open)",
                    );
                    continue;
                }
                Err(_) => return false,
            };
            if packet.track_id != self.track_id {
                continue;
            }

            let packet_data: &[u8] = packet.data.as_ref();

            // frame-size upper bound per RFC 6716: at 48khz a single opus frame is at most 120ms => 5760 samples/channel
            // packets can carry up to 3 frames (VBR code 3),
            // so size generously and let opus-rs report the real per-channel decoded length
            //
            // frame_size here is the capacity in samples per channel
            // opus-rs's decode() will decode into 'output, not a total sample count 
            // 'output' itself must be sized frame_size * channels since it's interleaved
            let ch = self.channels.get() as usize;
            let frame_size = 5760 * 3;
            self.sample_buf.resize(frame_size * ch, 0.0);

            match self.decoder.decode(packet_data, frame_size, &mut self.sample_buf) {
                Ok(frames_decoded) => {
                    self.sample_buf.truncate(frames_decoded * ch);

                    if self.pre_skip_remaining > 0 {
                        let skip_frames =
                            (self.pre_skip_remaining as usize).min(frames_decoded);
                        self.pre_skip_remaining -= skip_frames as u16;
                        self.sample_buf.drain(0..skip_frames * ch);
                    }

                    self.sample_pos = 0;
                    if self.sample_buf.is_empty() {
                        // entire packet was pre-skip => keep pulling packets
                        continue;
                    }
                    return true;
                }
                Err(e) => {
                    tracing::debug!("[AUDIO] opus decode error, skipping packet: {}", e);
                    continue;
                }
            }
        }
    }
}

impl Iterator for OpusSource {
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
            if self.sample_pos < self.sample_buf.len() {
                let s = self.sample_buf[self.sample_pos];
                self.sample_pos += 1;
                let s = s * self.output_gain;
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

impl Source for OpusSource {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.sample_buf.len().saturating_sub(self.sample_pos).max(1))
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