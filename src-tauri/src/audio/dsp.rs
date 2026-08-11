use std::f32::consts::PI;
use std::num::NonZero;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FilterType {
    Peaking,
    LowShelf,
    HighShelf,
    LowPass,
    HighPass,
    BandPass,
    Notch,
    AllPass,
}

fn default_filter_type() -> FilterType { FilterType::Peaking }
fn default_q() -> f32 { 1.41 }
fn default_enabled() -> bool { true }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EqBand {
    pub frequency: f32,
    pub gain: f32,
    #[serde(default = "default_q")]
    pub q: f32,
    #[serde(default = "default_filter_type")]
    pub filter_type: FilterType,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands: Vec<EqBand>,
    #[serde(default)]
    pub preamp_db: f32,
}

impl Default for EqSettings {
    fn default() -> Self {
        let bands = vec![
            EqBand { frequency: 31.0,    gain: 0.0, q: 0.707, filter_type: FilterType::LowShelf,  enabled: true },
            EqBand { frequency: 62.0,    gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 125.0,   gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 250.0,   gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 500.0,   gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 1000.0,  gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 2000.0,  gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 4000.0,  gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 8000.0,  gain: 0.0, q: 1.41,  filter_type: FilterType::Peaking,   enabled: true },
            EqBand { frequency: 16000.0, gain: 0.0, q: 0.707, filter_type: FilterType::HighShelf, enabled: true },
        ];
        Self { enabled: false, bands, preamp_db: 0.0 }
    }
}

/// upper bound on bands per EQ chain. a safety cap against unbounded input
pub const MAX_EQ_BANDS: usize = 24;

pub fn db_to_linear(db: f32) -> f32 {
    if !db.is_finite() {
        return 1.0;
    }
    let db = db.clamp(-24.0, 6.0);
    10.0f32.powf(db / 20.0)
}

#[derive(Clone)]
pub struct BiquadFilter {
    b0: f32, b1: f32, b2: f32, a1: f32, a2: f32,
    x1: f32, x2: f32, y1: f32, y2: f32,
}

impl BiquadFilter {
    pub fn new_peaking(freq: f32, gain_db: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let alpha = w0.sin() / (2.0 * q);
        let cos = w0.cos();
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos;
        let a2 = 1.0 - alpha / a;
        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    pub fn new_low_shelf(freq: f32, gain_db: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos = w0.cos();
        let alpha = w0.sin() / 2.0 * (1.0 / q).sqrt();
        let b0 =  a * ((a + 1.0) - (a - 1.0) * cos + 2.0 * alpha * a.sqrt());
        let b1 =  2.0 * a * ((a - 1.0) - (a + 1.0) * cos);
        let b2 =  a * ((a + 1.0) - (a - 1.0) * cos - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) + (a - 1.0) * cos + 2.0 * alpha * a.sqrt();
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos);
        let a2 =        (a + 1.0) + (a - 1.0) * cos - 2.0 * alpha * a.sqrt();
        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    pub fn new_high_shelf(freq: f32, gain_db: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate.get() as f32;
        let cos = w0.cos();
        let alpha = w0.sin() / 2.0 * (1.0 / q).sqrt();
        let b0 =  a * ((a + 1.0) + (a - 1.0) * cos + 2.0 * alpha * a.sqrt());
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
        let b2 =  a * ((a + 1.0) + (a - 1.0) * cos - 2.0 * alpha * a.sqrt());
        let a0 =       (a + 1.0) - (a - 1.0) * cos + 2.0 * alpha * a.sqrt();
        let a1 =  2.0 * ((a - 1.0) - (a + 1.0) * cos);
        let a2 =        (a + 1.0) - (a - 1.0) * cos - 2.0 * alpha * a.sqrt();
        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    pub fn new_low_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
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

    pub fn new_high_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
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

    pub fn new_band_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
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

    pub fn new_notch(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
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

    pub fn new_all_pass(freq: f32, q: f32, sample_rate: NonZero<u32>) -> Self {
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
            return Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0,
                        x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 };
        }
        Self {
            b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0,
            x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
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

pub struct FilterBank {
    filters: Vec<Vec<BiquadFilter>>,
    channels: usize,
    sample_rate: NonZero<u32>,
    preamp_linear: f32,
}

impl FilterBank {
    pub fn new(channels: usize, sample_rate: NonZero<u32>) -> Self {
        Self { filters: vec![vec![]; channels], channels, sample_rate, preamp_linear: 1.0 }
    }

    pub fn rebuild(&mut self, settings: &EqSettings) {
        self.filters = vec![vec![]; self.channels];
        self.preamp_linear = if settings.enabled {
            db_to_linear(settings.preamp_db)
        } else {
            1.0
        };

        if !settings.enabled {
            return;
        }
        for ch in 0..self.channels {
            for band in settings.bands.iter().take(MAX_EQ_BANDS) {
                if !band.enabled {
                    continue;
                }
                let q = band.q.clamp(0.1, 10.0);
                // clamp frequency below Nyquist
                let nyquist = self.sample_rate.get() as f32 / 2.0;
                let freq = band.frequency.clamp(20.0, nyquist * 0.998);
                let needs_gain = matches!(
                    band.filter_type,
                    FilterType::Peaking | FilterType::LowShelf | FilterType::HighShelf
                );
                if needs_gain && band.gain.abs() <= 0.01 {
                    continue;
                }
                let f = match band.filter_type {
                    FilterType::Peaking   => BiquadFilter::new_peaking(freq, band.gain, q, self.sample_rate),
                    FilterType::LowShelf  => BiquadFilter::new_low_shelf(freq, band.gain, q, self.sample_rate),
                    FilterType::HighShelf => BiquadFilter::new_high_shelf(freq, band.gain, q, self.sample_rate),
                    FilterType::LowPass   => BiquadFilter::new_low_pass(freq, q, self.sample_rate),
                    FilterType::HighPass  => BiquadFilter::new_high_pass(freq, q, self.sample_rate),
                    FilterType::BandPass  => BiquadFilter::new_band_pass(freq, q, self.sample_rate),
                    FilterType::Notch     => BiquadFilter::new_notch(freq, q, self.sample_rate),
                    FilterType::AllPass   => BiquadFilter::new_all_pass(freq, q, self.sample_rate),
                };
                self.filters[ch].push(f);
            }
        }
    }

    pub fn rebuild_for_rate(&mut self, channels: usize, sample_rate: NonZero<u32>, settings: &EqSettings) {
        self.channels = channels;
        self.sample_rate = sample_rate;
        self.rebuild(settings);
    }

    #[inline]
    pub fn process(&mut self, sample: f32, channel: usize) -> f32 {
        let mut s = sample;
        for f in &mut self.filters[channel] {
            s = f.process(s);
        }
        s * self.preamp_linear
    }
}

// =============================================================================
// LIMITER - lookahead peak limiter
// =============================================================================

// sits after both ReplayGain and EQ
// (see EqSource/LimiterSource in sources.rs)
// as it's the only place with cumulative result of everything
use std::collections::VecDeque;

// =============================================
// TUNABLES
// attack/release times shape how fast the limiter reacts
// ceiling is how close to full scale it lets samples get
// sustained passage damping controls how much a run of consecutive loud frames holds the gain down
// instead of letting it bounce back to unity between them
// =================================================

/// how close to full scale (1.0) samples are allowed to get
/// 0.98 is a standard real world practice
/// lower = safer/quieter, higher = louder/riskier
pub const LIMITER_CEILING: f32 = 0.98;

/// how many ms of lookahead the limiter gets before a loud frame has to be output
/// this is also how much latency it adds
/// (see 'Limiter::reconfigure')
/// shorter reacts faster but has less warning of an upcoming peak
/// longer smooths better but delays audio slightly more
pub const LIMITER_ATTACK_MS: f32 = 5.0;

/// how many ms the gain takes to ease back up to unity once the loud passage is over
/// longer = smoother/less pumping but audio stays quieter for longer after a loud section
///  shorter = snappier recovery
pub const LIMITER_RELEASE_MS: f32 = 50.0;

/// whether sustained passage release damping is on
/// (see 'sustained_release_ceiling' below)
/// turning this off makes the limiter purely reactive per frame
/// which can pump more on long loud passages
pub const LIMITER_ASC_ENABLED: bool = true;

/// 0.0-1.0: how strongly a run of consecutive over ceiling frames holds the release back from fully recovering to unity gain between them
/// 0.0 = no effect (same as ASC disabled)
/// 1.0 = release never goes past the average gain the sustained passage actually needs until it ends
/// 0.5 is a middle ground default
pub const LIMITER_ASC_STRENGTH: f32 = 0.5;

/// gain applied to samples on the way in, before peak detection
/// so, it changes what the limiter treats as loud in the first place
/// 1.0 = no change
pub const LIMITER_LEVEL_IN: f32 = 1.0;

/// gain applied to samples on the way out, after limiting/clipping is already done
/// a final trim that can't itself cause clipping the way LEVEL_IN can
/// 1.0 = no change
pub const LIMITER_LEVEL_OUT: f32 = 1.0;

/// when true, output is rescaled by 1/LIMITER_CEILING after clipping
/// so the loudest the limiter ever produces maps back up to full scale (1.0)
/// instead of sitting at CEILING forever
pub const LIMITER_AUTO_LEVEL: bool = true;

/// whether the limiter runs at all
/// when off, audio is passed through completely untouched
/// it's meant to be flipped live via LimiterSource's enabled flag (see sources.rs)
pub const LIMITER_ENABLED_DEFAULT: bool = true;

pub struct Limiter {
    channels: usize,
    limit: f32,
    attack_ms: f32,
    release_ms: f32,
    asc_enabled: bool,
    asc_strength: f32,
    level_in: f32,
    // precomputed once from level_out/auto_level/limit
    // see recompute_output_makeup below
    output_makeup: f32,
    lookahead_frames: usize,
    attack_step: f32,
    release_step: f32,
    delay: VecDeque<f32>,
    // sliding window minimum of required gain, via monotonic deque:
    // front is always the minimum required gain over the upcoming lookahead window
    window: VecDeque<(u64, f32)>,
    // separate from 'window' above
    // tracks every currently buffered frame that's over the ceiling
    // so we can average how much gain reduction a whole sustained passage needs
    asc_entries: VecDeque<(u64, f32)>,
    asc_sum: f32,
    frame_idx: u64,
    out_idx: u64,
    current_gain: f32,
}

impl Limiter {
    pub fn new(channels: usize, sample_rate: NonZero<u32>) -> Self {
        Self::with_params(
            channels,
            sample_rate,
            LIMITER_CEILING,
            LIMITER_ATTACK_MS,
            LIMITER_RELEASE_MS,
            LIMITER_ASC_ENABLED,
            LIMITER_ASC_STRENGTH,
            LIMITER_LEVEL_IN,
            LIMITER_LEVEL_OUT,
            LIMITER_AUTO_LEVEL,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_params(
        channels: usize,
        sample_rate: NonZero<u32>,
        limit: f32,
        attack_ms: f32,
        release_ms: f32,
        asc_enabled: bool,
        asc_strength: f32,
        level_in: f32,
        level_out: f32,
        auto_level: bool,
    ) -> Self {
        let mut s = Self {
            channels: channels.max(1),
            limit,
            attack_ms,
            release_ms,
            asc_enabled,
            asc_strength: asc_strength.clamp(0.0, 1.0),
            level_in,
            output_makeup: 1.0,
            lookahead_frames: 1,
            attack_step: 1.0,
            release_step: 1.0,
            delay: VecDeque::new(),
            window: VecDeque::new(),
            asc_entries: VecDeque::new(),
            asc_sum: 0.0,
            frame_idx: 0,
            out_idx: 0,
            current_gain: 1.0,
        };
        s.recompute_output_makeup(level_out, auto_level);
        s.reconfigure(channels, sample_rate);
        s
    }

    /// call when channels/sample_rate change mid stream
    /// (e.g. crossfading into a track with a different sample rate)
    /// resets the lookahead state
    pub fn reconfigure(&mut self, channels: usize, sample_rate: NonZero<u32>) {
        let sr = sample_rate.get() as f32;
        self.channels = channels.max(1);
        self.lookahead_frames = ((self.attack_ms / 1000.0) * sr).ceil().max(1.0) as usize;
        self.attack_step = 1.0 / ((self.attack_ms / 1000.0) * sr).max(1.0);
        self.release_step = 1.0 / ((self.release_ms / 1000.0) * sr).max(1.0);
        self.delay.clear();
        self.window.clear();
        self.asc_entries.clear();
        self.asc_sum = 0.0;
        self.frame_idx = 0;
        self.out_idx = 0;
        self.current_gain = 1.0;
    }

    /// output_makeup bundles level_out and auto_level's '1/limit' makeup gain into one multiplier
    /// applied once at the very end
    /// so the per sample hot path is a single multiply, not three
    fn recompute_output_makeup(&mut self, level_out: f32, auto_level: bool) {
        let makeup = if auto_level { 1.0 / self.limit } else { 1.0 };
        self.output_makeup = makeup * level_out;
    }

    /// during a sustained loud passage (several consecutive over ceiling frames still sitting in the lookahead window),
    /// caps how far release is allowed to climb back toward unity
    /// 0 = no cap
    /// 1 = never climb past the average gain the passage actually needs until it fully clears the window
    fn sustained_release_ceiling(&self) -> f32 {
        if !self.asc_enabled || self.asc_entries.is_empty() {
            return 1.0;
        }
        let avg_required_gain = self.asc_sum / self.asc_entries.len() as f32;
        1.0 - self.asc_strength * (1.0 - avg_required_gain)
    }

    fn slew_toward(&mut self, target_gain: f32) {
        // asymmetric ballistics:
        // clamp down fast (attack)
        // ease back up slow (release)
        // a transient that yanked the gain down shouldn't let it snap back up before the next transient, or we get audible pumping
        if target_gain < self.current_gain {
            self.current_gain = (self.current_gain - self.attack_step).max(target_gain);
        } else if target_gain > self.current_gain {
            let capped_target = target_gain.min(self.sustained_release_ceiling());
            self.current_gain = (self.current_gain + self.release_step).min(capped_target);
        }
    }

    fn evict_stale_window_entries(&mut self) {
        while let Some(&(idx, _)) = self.window.front() {
            if idx < self.out_idx {
                self.window.pop_front();
            } else {
                break;
            }
        }
        while let Some(&(idx, gain)) = self.asc_entries.front() {
            if idx < self.out_idx {
                self.asc_entries.pop_front();
                self.asc_sum -= gain;
            } else {
                break;
            }
        }
    }

    /// pushes one full frame
    /// (one sample per channel ; gain is linked across channels so stereo/multichannel image never shifts),
    /// writes the delayed+processed frame into 'out' if the lookahead buffer has samples ready
    /// yet returns false while still filling the initial lookahead window
    /// adds lookahead_frames of latency
    pub fn push_frame(&mut self, frame: &[f32], out: &mut [f32]) -> bool {
        // level_in is applied before peak detection
        // it changes what counts as "loud" here, not just the final volume
        let peak = frame.iter().fold(0.0f32, |m, &s| m.max((s * self.level_in).abs()));
        let required_gain = if peak > self.limit {
            (self.limit / peak).min(1.0)
        } else {
            1.0
        };

        while let Some(&(_, back_gain)) = self.window.back() {
            if back_gain >= required_gain {
                self.window.pop_back();
            } else {
                break;
            }
        }
        self.window.push_back((self.frame_idx, required_gain));

        if peak > self.limit {
            self.asc_entries.push_back((self.frame_idx, required_gain));
            self.asc_sum += required_gain;
        }

        self.delay.extend(frame.iter().map(|&s| s * self.level_in));
        self.frame_idx += 1;

        if self.delay.len() < self.lookahead_frames * self.channels {
            return false;
        }

        self.evict_stale_window_entries();
        let target_gain = self.window.front().map(|&(_, g)| g).unwrap_or(1.0);
        self.slew_toward(target_gain);

        for slot in out.iter_mut().take(self.channels) {
            let s = self.delay.pop_front().unwrap_or(0.0);
            // final hard clip is only a backstop here
            // output_makeup multiply (level_out + auto_level's 1/limit makeup gain) happens after the clip
            // so it can never itself be the thing that causes clipping
            *slot = (s * self.current_gain).clamp(-self.limit, self.limit) * self.output_makeup;
        }
        self.out_idx += 1;
        true
    }

    /// drains one remaining buffered frame at end of stream,
    /// once no more input frames are coming (so push_frame will never fill further)
    pub fn flush(&mut self, out: &mut [f32]) -> bool {
        if self.delay.len() < self.channels {
            return false;
        }
        self.evict_stale_window_entries();
        let target_gain = self.window.front().map(|&(_, g)| g).unwrap_or(1.0);
        self.slew_toward(target_gain);

        for slot in out.iter_mut().take(self.channels) {
            let s = self.delay.pop_front().unwrap_or(0.0);
            *slot = (s * self.current_gain).clamp(-self.limit, self.limit) * self.output_makeup;
        }
        self.out_idx += 1;
        true
    }
}