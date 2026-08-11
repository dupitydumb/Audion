use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use std::num::NonZero;
use std::f32::consts::PI;
use crossbeam::channel::Receiver;
use rodio::Source;

use super::dsp::{EqSettings, FilterBank, Limiter};

// =============================================================================
// PausableQueue — wraps queue output, emits silence when paused
// =============================================================================

pub struct PausableQueue<S: Source<Item = f32>> {
    pub inner: S,
    pub paused: Arc<AtomicBool>,
    pub frame_pos: usize,
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
// CrossfadeState — owned crossfade buffer, lives exclusively on the audio thread
// =============================================================================

pub struct CrossfadeState {
    pub buffer: Vec<f32>,
    pub pos: usize,
    pub total_samples: usize,
}

// =============================================================================
// CrossfadeSource — wraps inner Source, mixes with crossfade buffer when active
// =============================================================================

pub struct CrossfadeSource<S: Source<Item = f32>> {
    pub inner: S,
    pub active: Arc<AtomicBool>,
    pub pending: Arc<Mutex<Option<CrossfadeState>>>,
    pub local: Option<CrossfadeState>,
}

impl<S: Source<Item = f32>> CrossfadeSource<S> {
    pub fn new(
        inner: S,
        active: Arc<AtomicBool>,
        pending: Arc<Mutex<Option<CrossfadeState>>>,
    ) -> Self {
        Self { inner, active, pending, local: None }
    }
}

impl<S: Source<Item = f32>> Iterator for CrossfadeSource<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;

        if !self.active.load(Ordering::Acquire) {
            return Some(sample);
        }

        if self.local.is_none() {
            self.local = self.pending.lock().unwrap().take();
        }

        if let Some(ref mut cf) = self.local {
            if cf.pos < cf.total_samples {
                let progress = cf.pos as f32 / cf.total_samples as f32;
                let fade_out = (progress * PI * 0.5).cos();
                let fade_in  = (progress * PI * 0.5).sin();
                let next_sample = cf.buffer[cf.pos];
                cf.pos += 1;
                return Some((sample * fade_out + next_sample * fade_in).clamp(-1.0, 1.0));
            }
            self.local = None;
            self.active.store(false, Ordering::Relaxed);
        }

        Some(sample)
    }
}

impl<S: Source<Item = f32>> Source for CrossfadeSource<S> {
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
// EqSource — wraps inner Source (now CrossfadeSource), applies EQ in the audio callback
// =============================================================================

pub struct EqSource<S: Source<Item = f32>> {
    pub inner: S,
    pub bank: FilterBank,
    pub eq_settings: EqSettings,
    pub eq_rx: Receiver<EqSettings>,
    pub channels: usize,
    pub sample_rate: NonZero<u32>,
    pub current_ch: usize,
    pub frame_count: usize,
}

impl<S: Source<Item = f32>> EqSource<S> {
    pub fn new(inner: S, settings: &EqSettings, eq_rx: Receiver<EqSettings>) -> Self {
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
        if self.frame_count == 0 {
            let mut latest: Option<EqSettings> = None;
            while let Ok(s) = self.eq_rx.try_recv() {
                latest = Some(s);
            }
            if let Some(s) = latest {
                self.eq_settings = s;
                self.bank.rebuild(&self.eq_settings);
            }

            let new_rate = self.inner.sample_rate();
            if new_rate != self.sample_rate {
                self.sample_rate = new_rate;
                self.bank
                    .rebuild_for_rate(self.channels, new_rate, &self.eq_settings);
            }

            self.frame_count = (self.sample_rate.get() as usize / 100).max(1) * self.channels;
        }
        self.frame_count -= 1;

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
// LimiterSource => final stage lookahead limiter, wraps EqSource
// =============================================================================
// see Limiter in dsp.rs for the gain scheduling algorithm
// this wrapper's job is just frame buffering: 
// limiter operates on one whole frame (all channels) at a time so its gain stays linked across channels
// but Source::next() hands us one interleaved sample at a time
// so we buffer a frame in, and drain a processed frame out, one sample per call either way

pub struct LimiterSource<S: Source<Item = f32>> {
    pub inner: S,
    limiter: Limiter,
    enabled: Arc<AtomicBool>,
    // current effective state
    // lags 'enabled' by however long it takes to drain whatever's still buffered in the limiter
    // so toggling doesn't click/drop audio
    bypassed: bool,
    channels: usize,
    sample_rate: NonZero<u32>,
    in_frame: Vec<f32>,
    in_fill: usize,
    out_frame: Vec<f32>,
    out_pos: usize,
    out_len: usize,
    inner_exhausted: bool,
}

impl<S: Source<Item = f32>> LimiterSource<S> {
    /// enabled is shared with whoever exposes the on/off toggle
    /// (see audio_set_limiter_enabled)
    /// LimiterSource just reacts to it
    pub fn new(inner: S, enabled: Arc<AtomicBool>) -> Self {
        let channels = inner.channels().get() as usize;
        let sample_rate = inner.sample_rate();
        let bypassed = !enabled.load(Ordering::Relaxed);
        Self {
            limiter: Limiter::new(channels, sample_rate),
            enabled,
            bypassed,
            inner,
            channels,
            sample_rate,
            in_frame: vec![0.0; channels],
            in_fill: 0,
            out_frame: vec![0.0; channels],
            out_pos: 0,
            out_len: 0,
            inner_exhausted: false,
        }
    }

    fn check_reconfigure(&mut self) {
        let ch_now = self.inner.channels().get() as usize;
        let rate_now = self.inner.sample_rate();
        if ch_now != self.channels || rate_now != self.sample_rate {
            self.channels = ch_now;
            self.sample_rate = rate_now;
            self.in_frame = vec![0.0; ch_now];
            self.out_frame = vec![0.0; ch_now];
            self.in_fill = 0;
            self.out_pos = 0;
            self.out_len = 0;
            self.limiter.reconfigure(ch_now, rate_now);
        }
    }
}

impl<S: Source<Item = f32>> Iterator for LimiterSource<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.out_pos < self.out_len {
            let s = self.out_frame[self.out_pos];
            self.out_pos += 1;
            return Some(s);
        }

        let want_enabled = self.enabled.load(Ordering::Relaxed);

        // already fully bypassed and staying that way => zero overhead
        if self.bypassed && !want_enabled {
            return self.inner.next();
        }

        // just got toggled off
        // the limiter may still have up to lookahead_frames of audio sitting in its delay line
        // drain that through normally first
        if !want_enabled && !self.bypassed {
            self.check_reconfigure();
            let mut out = std::mem::take(&mut self.out_frame);
            let drained = self.limiter.flush(&mut out);
            self.out_frame = out;
            if drained {
                self.out_pos = 1;
                self.out_len = self.channels;
                return Some(self.out_frame[0]);
            }
            self.bypassed = true;
            return self.inner.next();
        }

        // just got toggled back on
        // reset the limiter's lookahead state
        if want_enabled && self.bypassed {
            self.limiter.reconfigure(self.channels, self.sample_rate);
            self.bypassed = false;
        }

        self.check_reconfigure();

        while !self.inner_exhausted {
            match self.inner.next() {
                Some(sample) => {
                    self.in_frame[self.in_fill] = sample;
                    self.in_fill += 1;
                    if self.in_fill == self.channels {
                        self.in_fill = 0;
                        let mut out = std::mem::take(&mut self.out_frame);
                        let ready = self.limiter.push_frame(&self.in_frame, &mut out);
                        self.out_frame = out;
                        if ready {
                            self.out_pos = 1;
                            self.out_len = self.channels;
                            return Some(self.out_frame[0]);
                        }
                        // still filling the lookahead window => keep pulling
                    }
                }
                None => {
                    self.inner_exhausted = true;
                }
            }
        }

        // inner is done => drain whatever the limiter still has buffered
        let mut out = std::mem::take(&mut self.out_frame);
        let drained = self.limiter.flush(&mut out);
        self.out_frame = out;
        if drained {
            self.out_pos = 1;
            self.out_len = self.channels;
            Some(self.out_frame[0])
        } else {
            None
        }
    }
}

impl<S: Source<Item = f32>> Source for LimiterSource<S> {
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