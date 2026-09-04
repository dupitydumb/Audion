//! the natural-end case (no next track preloaded => plain TrackFinished emission) is untouched by this module:
//! that event already comes straight from SymphoniaSource's own event_tx (forwarded through open_gated_track, see dual_track.rs)

use super::decision::{DecisionThread, TrackSlot};
use super::mod_types::AudioEvent;

/// call after every tick() / trigger_manual() (or on its own short poll cadence)
///
/// checks has_fired before next_is_live rather than either alone:
/// has_fired alone would promote before the caller's own render path has necessarily produced anything from the new source
/// next_is_live alone can't distinguish "nothing decided yet" from "decided and reached" for a 'next' slot that's still UNSCHEDULED
///
/// returns the TrackAdvanced event exactly once, the poll where completion is first observed
/// promote_next_to_current clears 'next', so a later poll with nothing newly fired finds has_fired() == false again and returns 'None'
pub fn poll_completed_transition(dt: &mut DecisionThread) -> Option<AudioEvent> {
    if !dt.has_fired() || !dt.next_is_live() {
        return None;
    }

    // old 'current' (now finished playing) is handed back by promote_next_to_current for whoever owns mixer/source cleanup
    let _outgoing = dt.promote_next_to_current();

    let current = dt.current()?; // the promoted slot => was 'next' a moment ago
    Some(AudioEvent::TrackAdvanced {
        generation: current.handle.generation,
        new_path: current.handle.path.clone(),
        duration: current.handle.duration,
    })
}

/// identical completion condition and event to poll_completed_transition, but also hands back the outgoing slot promote_next_to_current discards, instead of dropping it
/// added for the mid-crossfade device-switch resume 
/// (AudioEngine::set_output_device's case B):
/// the outgoing track's GatedSource is still fading out in the mixer after promotion
/// the caller stores this in AudioEngine::fading_out
pub fn poll_completed_transition_with_outgoing(
    dt: &mut DecisionThread,
) -> Option<(AudioEvent, Option<TrackSlot>)> {
    if !dt.has_fired() || !dt.next_is_live() {
        return None;
    }

    let outgoing = dt.promote_next_to_current();

    let current = dt.current()?;
    let event = AudioEvent::TrackAdvanced {
        generation: current.handle.generation,
        new_path: current.handle.path.clone(),
        duration: current.handle.duration,
    };
    Some((event, outgoing))
}

/// what worker.rs's AudioEvent::TrackFinished handler should do once a track's own decode pipeline (SymphoniaSource, via open_gated_track) reports it ended naturally
/// i.e. no crossfade/skip fired for it before it ran out of audio
/// computed from what DecisionThread already exposes (next_slot().is_some) plus
/// whether a preload dispatch is still mid-flight 
/// (AudioEngine::gated_preload_generation), with
/// no side effects of its own
/// extracted specifically so this decision is unit-testable on its
/// own, independent of AudioEngine/the live command-loop thread (which needs a real cpal output device to construct at all)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NaturalEndAction {
    /// a next track is already fully decoded and registered on the mixer
    /// (decision.next_slot is Some)
    /// fire the gapless hand-off
    /// (trigger_manual if a crossfade/skip hasn't already fired for this transition, then poll_completed_transition) instead of letting the track just go silent
    /// only mechanism that ever hands off at all when crossfade_secs == 0, or when the current track is shorter than the configured crossfade window
    GaplessHandoff,
    /// nothing decoded yet, but a preload dispatch is still mid-flight
    /// (gated_preload_generation != 0)
    /// there's nothing to hand off to yet=>
    /// the caller should adopt that generation as current and defer the TrackAdvanced emission
    /// untill the corresponding gated_open_result_rx result actually arrives
    DeferToInFlightPreload,
    /// nothing preloaded and nothing in flight
    /// end of the queue
    /// (or whatever's next simply hasn't been preloaded)
    /// emit a plain TrackFinished
    PlainFinish,
}

pub fn decide_natural_end_action(next_slot_present: bool, preload_generation: u64) -> NaturalEndAction {
    if next_slot_present {
        NaturalEndAction::GaplessHandoff
    } else if preload_generation != 0 {
        NaturalEndAction::DeferToInFlightPreload
    } else {
        NaturalEndAction::PlainFinish
    }
}

// =============================================================================
// Tests => real decode pipeline via dual_track::open_gated_track
// driving DecisionThread + poll_completed_transition through simulated ticks
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decision::TrackSlot;
    use crate::audio::gated::{GatedSource, SharedClock};
    use crate::audio::mod_types::ReadySource;
    use std::io::Write;
    use std::num::NonZero;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn write_test_wav(value: f32, n_samples: u32, sample_rate: u32) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "audion_directive_test_{}_{}.wav",
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
        )
        .unwrap();
        let slot = TrackSlot::new(handle, sample_rate);
        (gated, slot)
    }

    #[test]
    fn returns_none_before_anything_fires() {
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

        assert!(
            poll_completed_transition(&mut dt).is_none(),
            "nothing fired yet — must not promote or emit"
        );
        assert!(dt.next_slot().is_some(), "next slot must be untouched");

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn manual_trigger_promotes_and_emits_track_advanced_with_the_new_current_fields() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate * 2, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        let b_generation = slot_b.handle.generation;
        let b_path = slot_b.handle.path.clone();
        let b_duration = slot_b.handle.duration;

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        dt.trigger_manual();

        let evt = poll_completed_transition(&mut dt).expect("must emit once the fire is live");
        match evt {
            AudioEvent::TrackAdvanced { generation, new_path, duration } => {
                assert_eq!(generation, b_generation);
                assert_eq!(new_path, b_path);
                assert_eq!(duration, b_duration);
            }
            other => panic!("expected TrackAdvanced, got a different AudioEvent variant: {:?}", other),
        }

        assert!(dt.next_slot().is_none(), "next slot must be consumed by the promotion");
        assert_eq!(
            dt.current().unwrap().handle.generation, b_generation,
            "current must now be what was previously next"
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn only_fires_once_per_transition_not_on_every_subsequent_poll() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate * 2, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        dt.trigger_manual();
        assert!(poll_completed_transition(&mut dt).is_some());

        // nothing new fired since => next is empty (promotion consumed it),
        // so the guard on has_fired/next_is_live must keep this from ever double-emitting for the same transition
        // even if the caller polls again before anything else happens
        assert!(
            poll_completed_transition(&mut dt).is_none(),
            "must not emit a second TrackAdvanced for the same transition"
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn tick_driven_auto_crossfade_also_flows_through_to_an_emitted_event() {
        let sample_rate = 44100u32;
        // 2s track, 1s crossfade window => mirrors decision.rs's own tick-firing test so this
        // stays a genuine end-to-end check (tick decides -> poll observes -> event emitted)
        let path_a = write_test_wav(0.5, sample_rate * 2, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        let b_generation = slot_b.handle.generation;

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 1);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // well outside the 1s window => must not fire or emit
        clock.advance(sample_rate as u64 / 2); // 0.5s in, 1.5s remaining
        dt.tick();
        assert!(poll_completed_transition(&mut dt).is_none());

        // cross into the window: duration 88200, position needs remaining <= 44100, i.e.
        // position >= 44100.
        clock.advance(sample_rate as u64 / 2); // now at 1.0s, remaining == 1.0s == window
        dt.tick();

        let evt = poll_completed_transition(&mut dt).expect("tick-fired transition must emit");
        match evt {
            AudioEvent::TrackAdvanced { generation, .. } => assert_eq!(generation, b_generation),
            other => panic!("expected TrackAdvanced, got: {:?}", other),
        }

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn two_consecutive_transitions_a_to_b_to_c_each_promote_and_emit_cleanly() {
        // the trigger-guard reset in promote_next_to_current (triggered = false) and
        // GaplessHandoff-style re-arming both matter across repeated transitions,
        // not just a single one
        // a real listening session is many tracks in a row, not one crossfade
        // this drives two manual transitions back to back (A => B, then B => C) through the exact
        // same load_next/trigger_manual/poll_completed_transition sequence worker.rs uses,
        // checks each hop promotes and emits independently with no leftover state from the last
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let path_c = write_test_wav(0.1, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);
        let (_gated_c, slot_c) = open_slot(&path_c, 3, sample_rate, &clock);
        let b_generation = slot_b.handle.generation;
        let c_generation = slot_c.handle.generation;

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        // hop 1: A => B
        assert!(dt.trigger_manual());
        let evt1 = poll_completed_transition(&mut dt).expect("first hop must emit");
        match evt1 {
            AudioEvent::TrackAdvanced { generation, .. } => assert_eq!(generation, b_generation),
            other => panic!("expected TrackAdvanced for hop 1, got: {:?}", other),
        }
        assert!(dt.next_slot().is_none(), "next must be empty right after promotion");
        assert!(!dt.has_fired(), "trigger guard must be re-armed for the new current (B)");

        // preload C behind B => mirrors the real sequence
        // (preload dispatched for whatever's next in queue right after an advance)
        dt.load_next(slot_c);

        // hop 2: B => C
        assert!(dt.trigger_manual());
        let evt2 = poll_completed_transition(&mut dt).expect("second hop must also emit");
        match evt2 {
            AudioEvent::TrackAdvanced { generation, .. } => assert_eq!(generation, c_generation),
            other => panic!("expected TrackAdvanced for hop 2, got: {:?}", other),
        }
        assert_eq!(dt.current().unwrap().handle.generation, c_generation);
        assert!(dt.next_slot().is_none());

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
        let _ = std::fs::remove_file(&path_c);
    }

    // =========================================================================================
    // decide_natural_end_action => decision logic for the TrackFinished handler's natural-end case
    // (see its doc comment above)
    // thoroughly tested via tests
    // =========================================================================================

    #[test]
    fn natural_end_action_gapless_handoff_when_next_is_preloaded() {
        assert_eq!(
            decide_natural_end_action(true, 0),
            NaturalEndAction::GaplessHandoff,
            "a preloaded next slot always wins, regardless of preload_generation"
        );
        assert_eq!(
            decide_natural_end_action(true, 42),
            NaturalEndAction::GaplessHandoff,
        );
    }

    #[test]
    fn natural_end_action_defers_to_an_in_flight_preload() {
        assert_eq!(
            decide_natural_end_action(false, 7),
            NaturalEndAction::DeferToInFlightPreload,
            "no next slot yet, but a non-zero preload generation means one is on the way"
        );
    }

    #[test]
    fn natural_end_action_plain_finish_when_nothing_is_pending() {
        assert_eq!(
            decide_natural_end_action(false, 0),
            NaturalEndAction::PlainFinish,
            "0 is the sentinel for 'no preload ever dispatched' (see gated_preload_generation's \
             own doc comment in engine.rs) — nothing preloaded and nothing in flight really is \
             the end of the line"
        );
    }

    #[test]
    fn natural_end_action_matches_a_real_decision_thread_with_nothing_preloaded() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let clock = SharedClock::new();
        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);

        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 5);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        // no load_next => mirrors "queue exhausted" or "preload hasn't been dispatched yet"

        assert_eq!(
            decide_natural_end_action(dt.next_slot().is_some(), 0),
            NaturalEndAction::PlainFinish
        );

        let _ = std::fs::remove_file(&path_a);
    }

    #[test]
    fn natural_end_action_matches_a_real_decision_thread_with_a_preloaded_next() {
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();
        let (_gated_a, slot_a) = open_slot(&path_a, 1, sample_rate, &clock);
        let (_gated_b, slot_b) = open_slot(&path_b, 2, sample_rate, &clock);

        // crossfade_secs = 0: tick() never fires
        // (see decision.rs's bail-out),
        // so by the time a natural TrackFinished arrives, has_fired is still false and next_slot is still Some
        // exactly the state the gapless handoff exists to catch
        let mut dt = DecisionThread::new(Arc::clone(&clock), sample_rate, 0);
        slot_a.handle.schedule_at(0);
        dt.load_current(slot_a);
        dt.load_next(slot_b);

        clock.advance(sample_rate as u64); // run past the current track's own natural end
        dt.tick();
        assert!(!dt.has_fired(), "crossfade_secs=0 must never auto-fire");

        assert_eq!(
            decide_natural_end_action(dt.next_slot().is_some(), 0),
            NaturalEndAction::GaplessHandoff
        );

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }
}