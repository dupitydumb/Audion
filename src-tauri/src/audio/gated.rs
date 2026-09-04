//! `GatedSource` generalizes the shape ("silent until told otherwise, then live")
//! into a per-source primitive driven by an absolute frame number instead of a boolean
//! => works for gapless preloading, crossfade, and instant skip through one mechanism

use std::f32::consts::FRAC_PI_2;
use std::num::NonZero;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;

// =============================================================================
// SharedClock => the only clock in the system
// =============================================================================

/// monotonically increasing frame counter, advanced only by the render callback by exactly the number of frames it just produced
/// no thread keeps its own relative countdown => nothing can drift out of sync
///
/// "frame" = one sample tick per channel (increments once per channels() interleaved samples pulled), matching existing position math on this engine
#[derive(Debug, Default)]
pub struct SharedClock {
    frames: AtomicU64,
}

impl SharedClock {
    /// starts at frame '0'
    /// test-only
    pub fn new() -> Arc<Self> {
        Arc::new(Self { frames: AtomicU64::new(0) })
    }

    /// like [`Self::new`], but starts at an arbitrary frame instead of '0'
    /// AudioEngine::new uses 1 << 40 (~265 days of headroom at 48khz)
    ///
    /// why: AudioEngine::seek derives target_frame as clock_now.saturating_sub(seek_position_frames),
    /// which only holds if clock_now is at least as large as the seek target
    /// a clock starting at 0 underflows on an early forward seek,
    /// saturating_sub clamps to '0', and 'target_frame' stays wrong for the rest of that track's playback
    pub fn starting_at(frames: u64) -> Arc<Self> {
        Arc::new(Self { frames: AtomicU64::new(frames) })
    }

    /// current frame count, cheap and wait-free
    #[inline]
    pub fn now(&self) -> u64 {
        self.frames.load(Ordering::Acquire)
    }

    /// advance the clock by 'frames' => called once per render pull, by one writer only
    #[inline]
    pub fn advance(&self, frames: u64) {
        self.frames.fetch_add(frames, Ordering::AcqRel);
    }
}

// =============================================================================
// GatedSource => silent until its target frame, then live, forever after
// =============================================================================

/// wraps an inner 'Source' and gates it against a shared clock:
/// silence until the clock reaches this source's target frame, then transparent passthrough
/// target is an AtomicU64 so the decision thread can rewrite it with no handshake
///
/// generalized per-source replacement for CrossfadeSource's active: Arc<AtomicBool>
/// same "silent => live" shape, keyed to an absolute frame number instead of a boolean flip
pub struct GatedSource<S: Source<Item = f32>> {
    inner: S,
    clock: Arc<SharedClock>,
    /// frame (per the shared clock) at which this source starts emitting real samples
    /// u64::MAX means "never" => default state until the decision thread writes a target
    target_frame: Arc<AtomicU64>,
    paused: Option<Arc<AtomicBool>>,
    /// tracks position within an interleaved frame while paused,
    /// mirroring PausableQueue's frame_pos
    /// needed so an unpause lands back on a channel-0 boundary
    frame_pos: usize,
    channels: NonZero<u16>,
    /// length, in frames, of an equal-power fade-in ramp starting at target_frame
    /// '0' means no ramp
    /// used for the first play() and gapless/instant-skip handoffs
    /// set together with target_frame by schedule_fade_in_at below
    fade_in_frames: Arc<AtomicU64>,
    /// frame at which this (already-live) source should start fading out toward silence
    /// UNSCHEDULED = never fades out => default for every source
    fade_out_at: Arc<AtomicU64>,
    /// length, in frames, of the fade-out ramp starting at fade_out_at
    /// only meaningful once fade_out_at != UNSCHEDULED
    fade_out_frames: Arc<AtomicU64>,
}

/// sentinel written into target_frame meaning "not scheduled => stay silent forever"
/// reused for fade_out_at with the same meaning ("never fades out")
pub const UNSCHEDULED: u64 = u64::MAX;

impl<S: Source<Item = f32>> GatedSource<S> {
    /// 'target' is shared (Arc)
    /// so callers can hand a clone to the decision thread and keep writing new target frames after registration with the mixer
    pub fn new(inner: S, clock: Arc<SharedClock>, target: Arc<AtomicU64>) -> Self {
        let channels = inner.channels();
        Self {
            inner,
            clock,
            target_frame: target,
            paused: None,
            frame_pos: 0,
            channels,
            fade_in_frames: Arc::new(AtomicU64::new(0)),
            fade_out_at: Arc::new(AtomicU64::new(UNSCHEDULED)),
            fade_out_frames: Arc::new(AtomicU64::new(0)),
        }
    }

    /// convenience constructor when the caller doesn't need the target handle separately
    /// (tests, or a source scheduled once at construction)
    pub fn new_unscheduled(inner: S, clock: Arc<SharedClock>) -> (Self, Arc<AtomicU64>) {
        let target = Arc::new(AtomicU64::new(UNSCHEDULED));
        (Self::new(inner, clock, Arc::clone(&target)), target)
    }

    /// attach a shared pause flag, replacing PausableQueue
    /// pausing gates to silence without touching the decoder
    /// inner.next is never called while paused, so decode position is preserved exactly
    pub fn with_pause(mut self, paused: Arc<AtomicBool>) -> Self {
        self.paused = Some(paused);
        self
    }

    /// handles to this source's fade envelope,
    /// so a GatedTrackHandle built alongside it (see dual_track.rs) can rewrite them later
    pub fn fade_handles(&self) -> (Arc<AtomicU64>, Arc<AtomicU64>, Arc<AtomicU64>) {
        (
            Arc::clone(&self.fade_in_frames),
            Arc::clone(&self.fade_out_at),
            Arc::clone(&self.fade_out_frames),
        )
    }

    /// equal-power fade-in gain: 0 at ramp start, 1 once complete
    #[inline]
    fn fade_in_gain(now: u64, target: u64, fade_in_frames: u64) -> f32 {
        if fade_in_frames == 0 {
            return 1.0; // hard cut => no ramp requested
        }
        let since = now.saturating_sub(target);
        if since >= fade_in_frames {
            return 1.0; // ramp complete
        }
        let progress = since as f32 / fade_in_frames as f32;
        (progress * FRAC_PI_2).sin()
    }

    /// equal-power fade-out gain: 1 before ramp starts, 0 once complete
    /// the cos counterpart to fade_in_gain's sin
    /// together they sum to a constant-power crossfade (sin^2+cos^2=1)
    #[inline]
    fn fade_out_gain(now: u64, fade_out_at: u64, fade_out_frames: u64) -> f32 {
        if fade_out_at == UNSCHEDULED || now < fade_out_at {
            return 1.0; // not fading out (yet)
        }
        let fade_out_frames = fade_out_frames.max(1);
        let since = now - fade_out_at;
        if since >= fade_out_frames {
            return 0.0; // ramp complete => fully silent
        }
        let progress = since as f32 / fade_out_frames as f32;
        (progress * FRAC_PI_2).cos()
    }
}

impl<S: Source<Item = f32>> Iterator for GatedSource<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        // acquire, paired with set_paused's release store
        // needed , so observing is_paused == false here also guarantees this thread sees
        // resume()'s shift_forward() writes to target_frame/fade_out_at, not stale values
        let is_paused = self.paused.as_ref().is_some_and(|p| p.load(Ordering::Acquire));
        let ch = self.channels.get() as usize;

        // paused, or mid-frame catch-up after a pause landed off a channel-0 boundary:
        // emit silence, don't touch the clock/target comparison or the decoder
        // a paused source's inner never advances => resuming picks up exactly where it left off
        if is_paused || self.frame_pos != 0 {
            self.frame_pos = (self.frame_pos + 1) % ch;
            return Some(0.0);
        }

        let now = self.clock.now();
        let target = self.target_frame.load(Ordering::Acquire);

        if now < target {
            // not yet time => emit silence without touching the decoder at all
            // an unscheduled/not-yet-due source costs nothing but a comparison
            return Some(0.0);
        }

        // fully faded out (a crossfade against this source completed)
        // stay cheap-silent without touching the decoder
        let fade_out_at = self.fade_out_at.load(Ordering::Acquire);
        let fade_out_frames = self.fade_out_frames.load(Ordering::Acquire);
        if fade_out_at != UNSCHEDULED {
            let since = now.saturating_sub(fade_out_at);
            if since >= fade_out_frames.max(1) {
                return Some(0.0);
            }
        }

        let fade_in_frames = self.fade_in_frames.load(Ordering::Acquire);
        let gain = Self::fade_in_gain(now, target, fade_in_frames)
            * Self::fade_out_gain(now, fade_out_at, fade_out_frames);

        // reached (or past) the target => pull real audio
        // once inner is exhausted keep emitting silence rather than None: 
        // per rodio::mixer::MixerSource::next, a source returning None is dropped from the mixer entirely
        match self.inner.next() {
            Some(s) => Some(s * gain),
            None => Some(0.0),
        }
    }
}

impl<S: Source<Item = f32>> Source for GatedSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        // gating changes when real samples start, not the span structure of the decode
        self.inner.current_span_len()
    }
    fn channels(&self) -> NonZero<u16> {
        self.channels
    }
    fn sample_rate(&self) -> NonZero<u32> {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        // a gated source not yet at its target still has a real inner duration
        // total_duration describes the content, not remaining silence before it starts
        self.inner.total_duration()
    }
}

// =============================================================================
// tests => synthetic sources only, no real decode
// verifies: silence before target, exact sample transition at target, transparent passthrough after, mixer summing, no built-in clipping protection
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// infinite/finite constant value source for testing,
    /// standing in for a real decode pipeline
    struct ConstSource {
        value: f32,
        channels: NonZero<u16>,
        sample_rate: NonZero<u32>,
        remaining: Option<usize>, // none = infinite
    }

    impl ConstSource {
        fn new(value: f32, channels: u16, sample_rate: u32, remaining: Option<usize>) -> Self {
            Self {
                value,
                channels: NonZero::new(channels).unwrap(),
                sample_rate: NonZero::new(sample_rate).unwrap(),
                remaining,
            }
        }
    }

    impl Iterator for ConstSource {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            match &mut self.remaining {
                None => Some(self.value),
                Some(0) => None,
                Some(n) => {
                    *n -= 1;
                    Some(self.value)
                }
            }
        }
    }

    impl Source for ConstSource {
        fn current_span_len(&self) -> Option<usize> { None }
        fn channels(&self) -> NonZero<u16> { self.channels }
        fn sample_rate(&self) -> NonZero<u32> { self.sample_rate }
        fn total_duration(&self) -> Option<Duration> { None }
    }

    #[test]
    fn silent_before_target() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, None);
        let target = Arc::new(AtomicU64::new(10));
        let mut gated = GatedSource::new(inner, Arc::clone(&clock), target);

        // clock hasn't moved => every pull before the target must be exact silence,
        // and must not consume any real samples from inner (verified indirectly: value is always 0.0,
        // never 1.0, across many pulls with the clock parked at 0)
        for _ in 0..20 {
            assert_eq!(gated.next(), Some(0.0));
        }
    }

    #[test]
    fn exact_sample_transition_at_target() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, None);
        let target = Arc::new(AtomicU64::new(5));
        let mut gated = GatedSource::new(inner, Arc::clone(&clock), target);

        // advance the clock to 4 (one frame short of target) => still silent
        clock.advance(4);
        assert_eq!(gated.next(), Some(0.0), "must still be silent at now=4, target=5");

        // advance to exactly 5
        // this pull must be the first real sample
        clock.advance(1);
        assert_eq!(gated.next(), Some(1.0), "must be live at now=5, target=5 (exact boundary)");

        // and stays live from here on regardless of further clock advances
        clock.advance(100);
        assert_eq!(gated.next(), Some(1.0));
    }

    #[test]
    fn transparent_passthrough_after_target() {
        let clock = SharedClock::new();
        // every post-target pull must reach inner.next, not just the first one
        let inner = ConstSource::new(0.5, 2, 44100, None);
        let target = Arc::new(AtomicU64::new(0)); // due immediately
        let mut gated = GatedSource::new(inner, Arc::clone(&clock), target);

        for _ in 0..50 {
            assert_eq!(gated.next(), Some(0.5));
        }
    }

    #[test]
    fn exhausted_inner_emits_silence_not_none() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, Some(3)); // exactly 3 real samples, then none
        let target = Arc::new(AtomicU64::new(0));
        let mut gated = GatedSource::new(inner, Arc::clone(&clock), target);

        for _ in 0..3 {
            assert_eq!(gated.next(), Some(1.0));
        }
        // inner is exhausted now=>
        // GatedSource must keep returning Some(0.0), never None,
        // or a registered-with-the-mixer source would be dropped 
        // (see MixerSource::next())
        for _ in 0..10 {
            assert_eq!(gated.next(), Some(0.0));
        }
    }

    #[test]
    fn unscheduled_default_stays_silent_indefinitely() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, None);
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        assert_eq!(target.load(Ordering::Acquire), UNSCHEDULED);

        clock.advance(1_000_000);
        for _ in 0..20 {
            assert_eq!(gated.next(), Some(0.0), "UNSCHEDULED must never become due");
        }

        // now schedule it explicitly (what the decision thread would do) and confirm it goes live
        // proves the sentinel isn't special-cased in a way that breaks real scheduling
        target.store(1_000_000, Ordering::Release);
        assert_eq!(gated.next(), Some(1.0));
    }

    #[test]
    fn pause_emits_silence_without_advancing_decode() {
        let clock = SharedClock::new();
        let total_real_samples = 10;
        let inner = ConstSource::new(1.0, 2, 48000, Some(total_real_samples)); // stereo
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        target.store(0, Ordering::Release); // due immediately
        let paused = Arc::new(AtomicBool::new(false));
        gated = gated.with_pause(Arc::clone(&paused));

        let mut consumed = 0;

        // pull one stereo frame (2 samples) while live
        assert_eq!(gated.next(), Some(1.0)); consumed += 1;
        assert_eq!(gated.next(), Some(1.0)); consumed += 1;

        // pause mid-stream
        // every pull must be silence, and decode position must not move, so unpausing later resumes exactly where it left off
        paused.store(true, Ordering::Relaxed);
        for _ in 0..20 {
            assert_eq!(gated.next(), Some(0.0));
        }

        // unpause => must resume live audio immediately
        // (frame_pos was 0 when paused, i.e. paused exactly on a channel-0 boundary, so no realignment silence is owed)
        // drain exactly the remaining real samples, counting as we go
        paused.store(false, Ordering::Relaxed);
        while consumed < total_real_samples {
            assert_eq!(gated.next(), Some(1.0), "expected real audio, {} of {} consumed", consumed, total_real_samples);
            consumed += 1;
        }

        // now (and only now) inner is truly exhausted
        assert_eq!(gated.next(), Some(0.0), "inner exhausted after exactly {} real samples", total_real_samples);
        // pause must not resurrect exhausted audio either
        for _ in 0..5 {
            assert_eq!(gated.next(), Some(0.0));
        }
    }

    #[test]
    fn unpause_realigns_to_channel_zero_boundary() {
        // regression guard for: pausing/unpausing at an arbitrary point must never let stereo samples land on the wrong channel
        // simulate a mid-frame pause by pausing after an odd number of pulls on a stereo source,
        // and confirm the resume logic burns the remainder of that frame as silence rather than resuming immediately out of alignment
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 2, 48000, None); // stereo, infinite
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        target.store(0, Ordering::Release);
        let paused = Arc::new(AtomicBool::new(false));
        gated = gated.with_pause(Arc::clone(&paused));

        assert_eq!(gated.next(), Some(1.0)); // channel 0 of frame 1 => frame_pos would be 0 here

        // pausing here is a clean boundary
        // (frame_pos == 0 after 1 sample only if channels==1
        // for channels==2 only channel 0 has been consumed, so frame_pos tracking inside the struct is still 0
        // because it's only touched on the paused/silence path, not on live pulls)
        // purpose is documentation: live pulls never touch frame_pos,
        // only the silence path does
        paused.store(true, Ordering::Relaxed);
        assert_eq!(gated.next(), Some(0.0));
        paused.store(false, Ordering::Relaxed);
        // frame_pos was left at 1 (odd) by the single paused pull above
        // resume must burn exactly one more silent sample to land back on channel 0 before going live again
        assert_eq!(gated.next(), Some(0.0), "must finish the frame silently before going live");
        assert_eq!(gated.next(), Some(1.0), "now aligned, live audio resumes");
    }


    #[test]
    fn mixer_sums_two_gated_sources_and_does_not_clip() {
        // stand up a real rodio::mixer::Mixer with two gated dummy sources, confirm summed output, and confirm there is no built-in clipping protection
        let clock = SharedClock::new();
        let (mixer_in, mut mixer_out) = rodio::mixer::mixer(
            NonZero::new(1).unwrap(),
            NonZero::new(48000).unwrap(),
        );

        // both sources full-scale and due immediately
        // this is the clipping scenario LimiterSource will need to handle
        let a = ConstSource::new(1.0, 1, 48000, Some(4));
        let b = ConstSource::new(1.0, 1, 48000, Some(4));
        let (gated_a, target_a) = GatedSource::new_unscheduled(a, Arc::clone(&clock));
        let (gated_b, target_b) = GatedSource::new_unscheduled(b, Arc::clone(&clock));
        target_a.store(0, Ordering::Release);
        target_b.store(0, Ordering::Release);

        mixer_in.add(gated_a);
        mixer_in.add(gated_b);

        // MixerSource enqueues pending sources on the first pull where sample_count == 0
        // (channels=1 here, so every pull qualifies)
        let first = mixer_out.next();
        assert_eq!(first, Some(2.0), "two full-scale 1.0 sources must sum to 2.0, unclipped");

        // confirm it's not a fluke of the first sample
        // every remaining real sample from both sources should also sum to 2.0
        for _ in 0..3 {
            assert_eq!(mixer_out.next(), Some(2.0));
        }

        // once both inner ConstSources exhaust (after 4 real samples each),
        // GatedSource keeps emitting Some(0.0)
        // per the invariant tested above
        // so the mixer keeps summing silence + silence = 0.0 forever,
        // and the sources are never dropped from the mixer's current_sources, since they never return None
        for _ in 0..5 {
            assert_eq!(mixer_out.next(), Some(0.0));
        }
    }

    // =========================================================================================
    // fade envelope tests:
    // equal-power crossfade curve
    // a fade_frames of 0 still gives the original hard-cut behavior (no regression for gapless/instant skip)
    // =========================================================================================

    fn assert_close(actual: f32, expected: f32, tolerance: f32, msg: &str) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{msg}: expected ~{expected}, got {actual} (tolerance {tolerance})"
        );
    }

    #[test]
    fn fade_in_ramps_from_zero_to_full_with_the_equal_power_sine_curve() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, None); // full-scale, infinite
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        let (fade_in_frames, _fade_out_at, _fade_out_frames) = gated.fade_handles();

        let ramp_len = 100u64;
        fade_in_frames.store(ramp_len, Ordering::Release);
        target.store(0, Ordering::Release); // due immediately, ramp starts at frame 0

        // sample 0: right at the target
        // sin(0) == 0, so the very first sample of a crossfade must be silent, not an audible pop straight to full volume
        assert_close(gated.next().unwrap(), 0.0, 1e-4, "gain at ramp start");
        clock.advance(1);

        // advance to the ramp's midpoint (progress == 0.5) — sin(pi/4) ≈ 0.7071,
        // the equal-power curve's signature midpoint value
        for _ in 0..(ramp_len / 2 - 1) {
            gated.next();
            clock.advance(1);
        }
        assert_close(
            gated.next().unwrap(),
            std::f32::consts::FRAC_1_SQRT_2,
            0.02,
            "gain at ramp midpoint must follow sin(progress * PI/2), not a linear fade",
        );
        clock.advance(1);

        // advance past the ramp entirely => gain must settle at exactly 1.0 (full volume)
        // and stay there, not overshoot or oscillate
        for _ in 0..(ramp_len / 2) {
            gated.next();
            clock.advance(1);
        }
        for _ in 0..20 {
            assert_close(gated.next().unwrap(), 1.0, 1e-4, "gain after ramp completes");
            clock.advance(1);
        }
    }

    #[test]
    fn fade_out_ramps_from_full_to_zero_with_the_equal_power_cosine_curve() {
        let clock = SharedClock::new();
        let inner = ConstSource::new(1.0, 1, 48000, None);
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        let (_fade_in_frames, fade_out_at, fade_out_frames) = gated.fade_handles();

        target.store(0, Ordering::Release); // already live, no fade-in
        let ramp_len = 100u64;
        fade_out_frames.store(ramp_len, Ordering::Release);
        fade_out_at.store(50, Ordering::Release); // fade-out starts 50 frames from now

        // before fade_out_at: full volume, completely unaffected by the pending fade-out
        for _ in 0..50 {
            assert_close(gated.next().unwrap(), 1.0, 1e-4, "gain before fade-out starts");
            clock.advance(1);
        }

        // right at fade_out_at: cos(0) == 1 => the fade-out's own first sample is still full volume,
        // the ramp down begins on the samples after this one, not before it
        assert_close(gated.next().unwrap(), 1.0, 1e-4, "gain at fade-out start");
        clock.advance(1);

        for _ in 0..(ramp_len / 2 - 1) {
            gated.next();
            clock.advance(1);
        }
        assert_close(
            gated.next().unwrap(),
            std::f32::consts::FRAC_1_SQRT_2,
            0.02,
            "gain at fade-out midpoint must follow cos(progress * PI/2)",
        );
        clock.advance(1);

        for _ in 0..(ramp_len / 2) {
            gated.next();
            clock.advance(1);
        }
        // once complete: silent forever
        // longer even worth distinguishing from "never pull inner again" in this test
        for _ in 0..20 {
            assert_close(gated.next().unwrap(), 0.0, 1e-4, "gain after fade-out completes");
            clock.advance(1);
        }
    }

    #[test]
    fn zero_length_fade_is_a_hard_cut_not_a_divide_by_zero() {
        // fade_in_frames == 0 (the default, and what schedule_at()/schedule_now() leave it at)
        // must reproduce the original hard-gate behavior exactly
        // guard for the very first play() and for gapless/instant-skip, neither of which should ever hear a ramp
        let clock = SharedClock::new();
        let inner = ConstSource::new(0.5, 1, 48000, None);
        let (mut gated, target) = GatedSource::new_unscheduled(inner, Arc::clone(&clock));
        target.store(0, Ordering::Release);
        // fade_in_frames left at its default (0) => no ramp requested
        for _ in 0..20 {
            assert_close(gated.next().unwrap(), 0.5, 1e-6, "hard cut must be instant full gain");
            clock.advance(1);
        }
    }

    #[test]
    fn two_real_time_crossfading_sources_sum_to_roughly_constant_power_not_double_volume() {
        // two full-scale sources overlapping via a fade-out/fade-in pair, summed on a real rodio::mixer::Mixer, must not sum to ~2.0 (both at full volume) anywhere in the crossfade window
        // equal-power crossfades don't hold the sum exactly constant at every instant (sin+cos != a flat 1.0 except at the endpoints),
        // but they must stay bounded well under a straight sum of two full-scale signals throughout the whole window
        let clock = SharedClock::new();
        let (mixer_in, mut mixer_out) = rodio::mixer::mixer(
            NonZero::new(1).unwrap(),
            NonZero::new(48000).unwrap(),
        );

        let a = ConstSource::new(1.0, 1, 48000, None);
        let b = ConstSource::new(1.0, 1, 48000, None);
        let (gated_a, target_a) = GatedSource::new_unscheduled(a, Arc::clone(&clock));
        let (gated_b, target_b) = GatedSource::new_unscheduled(b, Arc::clone(&clock));

        let ramp_len = 200u64;
        // A is already playing and about to fade out; B is scheduled to fade in over the same window
        // exactly what DecisionThread::fire_next_now now does for a real crossfade
        target_a.store(0, Ordering::Release);
        let (_a_fade_in, a_fade_out_at, a_fade_out_frames) = gated_a.fade_handles();
        a_fade_out_frames.store(ramp_len, Ordering::Release);
        a_fade_out_at.store(0, Ordering::Release);

        let (b_fade_in_frames, _b_fade_out_at, _b_fade_out_frames) = gated_b.fade_handles();
        b_fade_in_frames.store(ramp_len, Ordering::Release);
        target_b.store(0, Ordering::Release);

        mixer_in.add(gated_a);
        mixer_in.add(gated_b);

        let mut max_seen: f32 = 0.0;
        for _ in 0..(ramp_len as usize) {
            let s = mixer_out.next().unwrap();
            max_seen = max_seen.max(s.abs());
            clock.advance(1);
        }

        assert!(
            max_seen < 1.9,
            "two crossfading full-scale sources peaked at {max_seen} across the ramp — expected \
             an equal-power curve to stay well under a straight sum of 2.0 (the pre-fix, \
             both-at-full-volume behavior). If this fires, DecisionThread::fire_next_now is no \
             longer applying a fade — check schedule_fade_in_at/schedule_fade_out are actually \
             being called instead of schedule_at."
        );
    }
}