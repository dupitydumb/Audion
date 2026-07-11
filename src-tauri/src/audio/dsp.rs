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
            for band in &settings.bands {
                if !band.enabled {
                    continue;
                }
                let q = band.q.clamp(0.1, 10.0);
                let needs_gain = matches!(
                    band.filter_type,
                    FilterType::Peaking | FilterType::LowShelf | FilterType::HighShelf
                );
                if needs_gain && band.gain.abs() <= 0.01 {
                    continue;
                }
                let f = match band.filter_type {
                    FilterType::Peaking   => BiquadFilter::new_peaking(band.frequency, band.gain, q, self.sample_rate),
                    FilterType::LowShelf  => BiquadFilter::new_low_shelf(band.frequency, band.gain, q, self.sample_rate),
                    FilterType::HighShelf => BiquadFilter::new_high_shelf(band.frequency, band.gain, q, self.sample_rate),
                    FilterType::LowPass   => BiquadFilter::new_low_pass(band.frequency, q, self.sample_rate),
                    FilterType::HighPass  => BiquadFilter::new_high_pass(band.frequency, q, self.sample_rate),
                    FilterType::BandPass  => BiquadFilter::new_band_pass(band.frequency, q, self.sample_rate),
                    FilterType::Notch     => BiquadFilter::new_notch(band.frequency, q, self.sample_rate),
                    FilterType::AllPass   => BiquadFilter::new_all_pass(band.frequency, q, self.sample_rate),
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
