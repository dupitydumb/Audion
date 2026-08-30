//! owns every reason a GatedTrackHandle's target frame ever changes
//! split three ways in engine.rs: maybe_auto_crossfade's 100ms tick flips cf_active,
//! trigger_crossfade handles the manual/deferred preload path,
//! set_crossfade_seconds stashes a number the tick re-reads
//! here all three collapse into one primitive
//! => writing an absolute target frame into a GatedTrackHandle
//!
//! 1) automatic crossfade => tick computes frames of current track left,
//!    once within the crossfade window, calls the same fire_next_now a manual skip would
//! 2) manual skip / instant next => calls fire_next_now directly, ignoring position
//!    just a different caller of the same function
//! 3) live crossfade_seconds edits => stored in a shared AtomicU32, next tick() reads it
//!
//! player.rs's directive layer is fed from promote_next_to_current, not trigger_crossfade

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::dual_track::GatedTrackHandle;
use super::gated::{SharedClock, UNSCHEDULED};

/// a loaded track plus everything the decision thread needs to reason about its timing
pub struct TrackSlot {
    pub handle: GatedTrackHandle,
    /// real decoded duration in frames (not tag metadata)
    /// computed once at load time from handle.duration (sourced from SymphoniaSource's decode)
    /// same as what engine.rs's TrackInfo.duration relies on
    pub duration_frames: Option<u64>,
}

impl TrackSlot {
    pub fn new(handle: GatedTrackHandle, sample_rate: u32) -> Self {
        let duration_frames = handle
            .duration
            .map(|d| (d.as_secs_f64() * sample_rate as f64) as u64);
        Self { handle, duration_frames }
    }

    /// frames into this track's own playback
    /// 'none' if it hasn't started yet
    /// (still UNSCHEDULED, or target frame still in the future relative to clock_now)
    fn position_frames(&self, clock_now: u64) -> Option<u64> {
        let start = self.handle.target_frame.load(Ordering::Acquire);
        if start == UNSCHEDULED || start > clock_now {
            None
        } else {
            Some(clock_now - start)
        }
    }
}

pub struct DecisionThread {
    clock: Arc<SharedClock>,
    sample_rate: u32,
    /// shared so a live settings ui (or a tauri command handler) can write this directly
    /// without needing a &mut DecisionThread
    /// picked up on the very next tick()
    crossfade_seconds: Arc<AtomicU32>,
    current: Option<TrackSlot>,
    next: Option<TrackSlot>,
    /// mirrors engine.rs's crossfade_triggered => fires once per "current" track
    /// so a slow tick, clock rounding, or a tick() right after trigger_manual can't double-fire
    triggered: bool,
}

impl DecisionThread {
    pub fn new(clock: Arc<SharedClock>, sample_rate: u32, crossfade_seconds: u32) -> Self {
        Self {
            clock,
            sample_rate,
            crossfade_seconds: Arc::new(AtomicU32::new(crossfade_seconds)),
            current: None,
            next: None,
            triggered: false,
        }
    }

    /// shared handle for live settings changes
    /// writes straight to this atomic, no roundtrip through the decision thread's owner
    pub fn crossfade_seconds_handle(&self) -> Arc<AtomicU32> {
        Arc::clone(&self.crossfade_seconds)
    }

    pub fn set_crossfade_seconds(&self, secs: u32) {
        self.crossfade_seconds.store(secs, Ordering::Release);
    }

    /// replaces the currently playing slot
    /// resets the fire-once guard
    /// new current track => the "next" transition out of it needs to be able to fire too
    pub fn load_current(&mut self, slot: TrackSlot) {
        self.current = Some(slot);
        self.triggered = false;
    }

    /// registers the preloaded next track
    /// its GatedSource should already be .add()ed to the mixer, silent (UNSCHEDULED), by whoever called open_gated_track
    /// this just gives the decision thread something to schedule later
    pub fn load_next(&mut self, slot: TrackSlot) {
        self.next = Some(slot);
    }

    pub fn current(&self) -> Option<&TrackSlot> { self.current.as_ref() }
    pub fn next_slot(&self) -> Option<&TrackSlot> { self.next.as_ref() }

    /// true once a crossfade/skip has actually been fired for the current track
    /// (its replacement's target has been written)
    pub fn has_fired(&self) -> bool { self.triggered }

    /// true once the fired next track transition has actually become audible
    /// the shared clock (advanced only by the render callback) has reached the target frame fire_next_now wrote
    /// not the same instant when the fire and next render pull don't land in the same tick
    /// which is why callers check this separately from has_fired before promoting and emitting TrackAdvanced
    pub fn next_is_live(&self) -> bool {
        match self.next.as_ref() {
            Some(slot) => slot.position_frames(self.clock.now()).is_some(),
            None => false,
        }
    }

    /// promotes the preloaded next track to current
    /// call this once the fired transition has actually completed
    /// detect via the gated source's own state, or simply "a fire happened and enough time has passed"
    /// returns the outgoing slot so the caller can do cleanup / event emission for the old current
    pub fn promote_next_to_current(&mut self) -> Option<TrackSlot> {
        let outgoing = self.current.take();
        self.current = self.next.take();
        self.triggered = false;
        outgoing
    }

    /// full reset for stop() => takes both slots out and re-arms the trigger guard,
    /// leaving DecisionThread in the same empty state new() produces
    /// returns both slots (current, next) so the caller can silence their still-mixer-registered GatedSources
    /// there is no way to remove a source from rodio::mixer::Mixer once added,
    /// see dual_track.rs/gated.rs, so stop() re-gates them to UNSCHEDULED
    /// and tells their decode pipelines to stop instead of actually detaching them
    pub fn clear(&mut self) -> (Option<TrackSlot>, Option<TrackSlot>) {
        let current = self.current.take();
        let next = self.next.take();
        self.triggered = false;
        (current, next)
    }

    /// the one mechanism behind both automatic crossfade timing and instant skip
    /// writes "start right now" into the next slot's target frame
    /// returns 'false' if there's nothing preloaded to fire into yet
    ///
    /// also the one mechanism behind the actual crossfade sound, not just its timing
    /// crossfade_seconds > 0 => incoming track scheduled with an equal-power fade-in ramp (GatedSource::fade_in_gain)
    /// and if something is currently playing, that outgoing track simultaneously fades out over the same window (GatedSource::fade_out_gain)
    /// crossfade_seconds == 0 (gapless / instant skip) keeps the hard-cut behavior exactly => no ramp
    fn fire_next_now(&mut self) -> bool {
        let Some(next) = self.next.as_ref() else { return false; };
        let now = self.clock.now();
        let crossfade_secs = self.crossfade_seconds.load(Ordering::Acquire);
        let fade_frames = crossfade_secs as u64 * self.sample_rate as u64;

        if fade_frames == 0 {
            next.handle.schedule_at(now);
        } else {
            next.handle.schedule_fade_in_at(now, fade_frames);
            if let Some(current) = self.current.as_ref() {
                current.handle.schedule_fade_out(now, fade_frames);
            }
        }
        true
    }

    /// manual "skip to next" / user-triggered crossfade
    /// fires immediately regardless of how far into the current track playback actually is
    /// same primitive tick() uses for automatic timing, just called directly instead of gated on a remaining-duration check
    /// also means a manual "crossfade now" gets the same equal-power fade tick()'s automatic firing does
    /// (see fire_next_now's doc) => both go through the identical primitive
    pub fn trigger_manual(&mut self) -> bool {
        if self.next.is_none() {
            // nothing preloaded yet, same "buffer not ready" case engine.rs handles
            // via pending_crossfade_gen
            return false;
        }
        self.triggered = true;
        self.fire_next_now()
    }

    /// called on a periodic tick, repurposing engine.rs's old 100ms maybe_auto_crossfade cadence
    /// (see module docs: same cadence, but writes a target frame instead of flipping cf_active)
    /// decides, from real frame-accurate position on the shared clock, not a wall-clock
    /// 'instant' estimate, whether it's time to start crossfading into the preloaded next track
    pub fn tick(&mut self) {
        let crossfade_secs = self.crossfade_seconds.load(Ordering::Acquire);
        if crossfade_secs == 0 { return; }
        // already fired for this current track
        if self.triggered { return; }
        // nothing preloaded to crossfade into yet
        if self.next.is_none() { return; }

        let Some(current) = self.current.as_ref() else { return; };
        // no real decoded duration yet
        let Some(duration_frames) = current.duration_frames else { return; };

        let crossfade_frames = crossfade_secs as u64 * self.sample_rate as u64;
        if duration_frames <= crossfade_frames {
            // track shorter than the configured crossfade, nothing sensible to do
            // bail-out
            return;
        }

        let now = self.clock.now();
        // hasn't started yet
        let Some(position) = current.position_frames(now) else { return; };

        if position >= duration_frames {
            // already past its own end somehow, don't double-fire on a stale tick
            return;
        }
        let remaining = duration_frames - position;

        if remaining <= crossfade_frames {
            self.triggered = true;
            self.fire_next_now();
        }
    }
}

// =============================================================================
// tests => real decode pipeline via dual_track::open_gated_track
// driving DecisionThread through simulated ticks with an explicitly-advanced SharedClock, exactly like the real render callback will advance it
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::gated::GatedSource;
    use crate::audio::mod_types::{AudioEvent, ReadySource};
    use std::io::Write;
    use std::num::NonZero;
    use std::sync::atomic::AtomicBool;

    fn write_test_wav(value: f32, n_samples: u32, sample_rate: u32) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "audion_decision_test_{}_{}.wav",
            std::process::id(),
            {
                use std::sync::atomic::{AtomicU64, Ordering};
                static COUNTER: AtomicU64 = AtomicU64::new(0);
                COUNTER.fetch_add(1, Ordering::Relaxed)
            }
        ));
        let sample_i16 = (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let data_bytes = n_samples * 2;
        let byte_rate = sample_rate * 2;
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
        f.write_all(b"WAVE").unwrap();
        f.write_all(b"fmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_bytes.to_le_bytes()).unwrap();
        for _ in 0..n_samples {
            f.write_all(&sample_i16.to_le_bytes()).unwrap();
        }
        path
    }

    fn open_slot(
        path: &std::path::Path,
        generation: u64,
        sample_rate: u32,
        clock: &Arc<SharedClock>,
    ) -> (GatedSource<ReadySource>, TrackSlot) {
        let volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits()));
        let rg = Arc::new(AtomicBool::new(false));
        let (event_tx, _event_rx) = crossbeam::channel::unbounded::<AudioEvent>();
        let (gated, handle) = crate::audio::dual_track::open_gated_track(
            path.to_str().unwrap(),
            None,
            generation,
            volume,
            rg,
            NonZero::new(sample_rate).unwrap(),
            NonZero::new(1).unwrap(),
            None,
            event_tx,
            Arc::clone(clock),
        ).unwrap();
        let slot = TrackSlot::new(handle, sample_rate);
        (gated, slot)
    }

    #[test]
    fn tick_does_nothing_below_threshold_and_fires_within_window() {
        let sample_rate = 44100u32;
        // 1 second of audio at 44100 frames/sec, crossfade window = 300ms = 13230 frames
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 0 /* start disabled */);
        // current "a" starts playing at frame 0
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // crossfade disabled => ticking must never fire regardless of position
        // pretend a full second has passed
        clock.advance(sample_rate as u64);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "crossfade_seconds=0 must never fire"
        );

        // reset clock effect by using a fresh scenario instead of rewinding
        // (SharedClock only moves forward, matching the real render callback) => re-open both tracks
        let path_a2 = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b2 = write_test_wav(0.25, sample_rate, sample_rate);
        let clock2 = SharedClock::new();
        let (_gated_a2, slot_a2) = open_slot(&path_a2, 1, sample_rate, &clock2);
        let (_gated_b2, slot_b2) = open_slot(&path_b2, 2, sample_rate, &clock2);

        let mut dt2 = DecisionThread::new(Arc::clone(&clock2), sample_rate, 1 /* 1s window */);
        slot_a2.handle.schedule_at(0);
        dt2.load_current(slot_a2);
        dt2.load_next(slot_b2);

        // well before the 1-second-remaining threshold on a 1-second track: at frame 0,
        // remaining == full duration > crossfade window, so this must not fire
        dt2.tick();
        assert_eq!(
            dt2.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "must not fire before the crossfade window is reached"
        );

        // advance to exactly the crossfade boundary: duration=44100 frames, window=44100
        // frames (1s), so remaining <= window is true from frame 0 onward for this track
        // => use a longer track to get a clean "not yet, then yes" transition instead
        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
        let _ = std::fs::remove_file(&path_a2);
        let _ = std::fs::remove_file(&path_b2);
    }

    #[test]
    fn tick_fires_exactly_when_remaining_enters_the_crossfade_window() {
        let sample_rate = 44100u32;
        // 2 seconds of audio, crossfade window = 1 second (44100 frames)
        // remaining enters the window at position = duration - window = 44100 frames in
        let path_a = write_test_wav(0.5, sample_rate * 2, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        assert_eq!(slot_a.duration_frames, Some((sample_rate * 2) as u64));

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 1);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // advance to just short of the window (1 frame before threshold) => must not fire
        // position = 44098, remaining = 44102 > 44100
        clock.advance(sample_rate as u64 - 2);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "must not fire 1 tick before entering the window"
        );

        // advance the remaining 2 frames: position = 44100, remaining = 44100 == window
        // must fire now
        clock.advance(2);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            clock.now(),
            "must fire exactly at the threshold, scheduling next at the current clock frame"
        );
        assert!(dt.has_fired());

        // a further tick must not re-fire (schedule_at again) => the fire-once guard
        let target_after_first_fire = dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire);
        clock.advance(1000);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            target_after_first_fire,
            "must not re-fire / re-schedule once already triggered for this current track"
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn manual_trigger_fires_immediately_regardless_of_position() {
        let sample_rate = 44100u32;
        // 10s track
        let path_a = write_test_wav(0.5, sample_rate * 10, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // barely into the track => nowhere near the crossfade window (5s of a 10s track)
        clock.advance(1000);
        let fired = dt.trigger_manual();
        assert!(fired, "manual trigger must succeed when a next track is preloaded");
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            clock.now(),
            "manual trigger must schedule immediately, ignoring remaining-duration math entirely"
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn manual_trigger_without_a_preloaded_next_track_fails_cleanly() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let clock = SharedClock::new();
        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        // deliberately no load_next

        assert!(!dt.trigger_manual(), "must fail cleanly with nothing preloaded, not panic");
        assert!(!dt.has_fired());

        let _ = std::fs::remove_file(&path_a);
    }

    #[test]
    fn live_crossfade_seconds_change_is_picked_up_next_tick_no_handshake() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate * 2, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        // start disabled
        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 0);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // 1 second remaining on a 2-second track => would be within a 1s+ window
        clock.advance(sample_rate as u64);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "disabled crossfade must not fire even inside what would be the window"
        );

        // live-enable a 1s window => no restart, no re-registration, just write the atomic
        // (not 2s: path_a is a 2s track, and duration <= crossfade_frames is the deliberate
        // "track shorter than the window, nothing sensible to do" bail-out tested above in
        // tick_does_nothing_below_threshold_and_fires_within_window => a 2s window here would
        // hit that same bail and could never fire, regardless of position)
        dt.set_crossfade_seconds(1);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            clock.now(),
            "must fire on the very next tick once crossfade_seconds is live-enabled, no handshake needed"
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn promote_next_to_current_swaps_state_and_rearms_trigger_guard() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate * 2, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        let b_duration = slot_b.duration_frames;

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);
        dt.trigger_manual();
        assert!(dt.has_fired());

        let outgoing = dt.promote_next_to_current();
        assert!(outgoing.is_some(), "must hand back the old current slot for cleanup/events");
        assert!(dt.next_slot().is_none(), "next slot must be empty after promotion");
        assert_eq!(
            dt.current().unwrap().duration_frames, b_duration,
            "the promoted current slot must be what was previously 'next'"
        );
        assert!(!dt.has_fired(), "trigger guard must be re-armed for the new current track");

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn next_is_live_tracks_target_frame_reached_not_just_fired() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        assert!(!dt.next_is_live(), "nothing fired yet — must not report live");

        dt.trigger_manual();
        assert!(dt.has_fired());
        // fire_next_now writes target = clock.now: "start at the frame the clock is already at" =>
        // position_frames treats target == clock_now as reached (Some(0)),
        // not "still in the future", so this is live from the instant it fires,
        // before any further clock.advance() => correct,
        // since there's no meaningful "decided but not yet audible" gap in this design, as the target is never written ahead of the current frame
        assert!(
            dt.next_is_live(),
            "target == clock.now() at fire time must already count as reached"
        );

        // the clock only ever moves forward from here (render callback), so it stays live
        clock.advance(1);
        assert!(dt.next_is_live());

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn short_track_never_fires_even_deep_into_playback() {
        // duration_frames <= crossfade_frames is the deliberate "track shorter than the window, nothing sensible to do"
        // bail documented on tick() itself, not exercised by any other test here, all of which use a current track strictly longer than the window
        // a 1s track against a 2s crossfade window must never fire, no matter how far position advances (even past the track's own natural end)
        let sample_rate = 44100u32;
        // 1s track
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        assert_eq!(slot_a.duration_frames, Some(sample_rate as u64));

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 2 /* 2s window > 1s track */);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // position = 0: still shouldn't fire (bail is on duration vs window, not position)
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "must not fire at position 0 when the track is shorter than the window"
        );

        // advance well past the track's own natural end (2x its length) => still must not fire
        clock.advance(sample_rate as u64 * 2);
        dt.tick();
        assert_eq!(
            dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire),
            UNSCHEDULED,
            "must never fire for a track shorter than the configured crossfade window"
        );
        assert!(!dt.has_fired());

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn tick_with_nothing_preloaded_is_a_safe_no_op() {
        // next.is_none bail, covered indirectly by other tests never calling load_next
        // but not asserted on its own a bare tick() with only a current track loaded
        // (the normal state for most of a track's playback, before any preload has completed)
        // must never panic and must leave has_fired false
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate * 2, sample_rate);
        let clock = SharedClock::new();
        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 1);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        // deliberately no load_next

        // well past where a fire would happen if next existed
        clock.advance(sample_rate as u64 * 2);
        dt.tick();
        assert!(!dt.has_fired(), "must not fire, and must not panic, with nothing preloaded");
        assert!(dt.next_slot().is_none());

        let _ = std::fs::remove_file(&path_a);
    }

    #[test]
    fn tick_with_no_current_track_is_a_safe_no_op() {
        // current.as_ref bail, the gap between engine startup / stop() and the first play() actually landing a decoded source
        // tick() runs unconditionally on worker.rs's 100ms timer regardless of playback state, so this must be inert, not a panic
        let sample_rate = 44100u32;
        let clock = SharedClock::new();
        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 1);

        clock.advance(sample_rate as u64 * 5);
        // no current, no next => must be a complete no-op
        dt.tick();
        assert!(!dt.has_fired());
        assert!(dt.current().is_none());
        assert!(dt.next_slot().is_none());
    }

    #[test]
    fn repeated_manual_trigger_is_idempotent_not_a_second_fire() {
        // calling trigger_manual twice in a row
        // (e.g. a duplicate command, or a manual trigger racing the crossfade_tick arm)
        // must not double-schedule or otherwise misbehave
        // the second call re-writes the same target to "now again", which is a no-op in practice since the source is already live
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate * 10, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        assert!(dt.trigger_manual());
        let first_target = dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire);

        clock.advance(500);
        assert!(dt.trigger_manual(), "a second manual trigger before promotion must still report success");
        let second_target = dt.next_slot().unwrap().handle.target_frame.load(Ordering::Acquire);

        assert_eq!(
            second_target, clock.now(),
            "a repeated manual trigger re-schedules to the current clock frame, not the original one"
        );
        assert_ne!(
            first_target, second_target,
            "sanity: the clock actually advanced between the two triggers"
        );
        assert!(dt.next_slot().is_some(), "next slot must still be present — no double-promotion");

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn tick_never_fires_for_a_track_that_never_actually_started() {
        // position_frames() returns none when target_frame is UNSCHEDULED or still in the future
        // tick()'s let Some(position) = current.position_frames(now) else { return; } bail
        // simulates a current slot that was loaded but never actually scheduled. (shouldn't actually happen in practise)
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate * 2, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 1);
        // deliberately no slot_a.handle.schedule_at(0) => current stays UNSCHEDULED
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        clock.advance(sample_rate as u64 * 2);
        dt.tick();
        assert!(!dt.has_fired(), "an unscheduled current track has no meaningful position to tick from");

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }
}