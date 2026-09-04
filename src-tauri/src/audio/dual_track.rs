//! wires real decode pipelines into GatedSource
//! reuses SymphoniaSource/RubatoResampler exactly as engine.rs's dispatch_open does
//! each track now gets exactly one GatedSource instance, silent until scheduled
//!
//! with gated sources there is no overlap buffer and no queue fallthrough to duplicate:
//! preloading a track just means constructing its GatedSource, registered on the mixer, silent, with an UNSCHEDULED target
//! starting it, whether via crossfade or an instant skip, is nothing more than the decision thread writing a real target frame into the same source that's already there =>
//! there is only ever one instance of this track's audio, played exactly once

use std::num::NonZero;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam::channel::Sender;
use rodio::Source;

use super::gated::{GatedSource, SharedClock, UNSCHEDULED};
use super::mod_types::{AudioEvent, ReadySource};
use super::resampler::RubatoResampler;
use super::symphonia::SymphoniaSource;

/// everything needed to control a track after its GatedSource has been handed to the mixer
/// the mixer owns the GatedSource itself (via .add(), which consumes it)
/// this handle is what the decision thread and transport commands (pause/seek) hold onto instead
pub struct GatedTrackHandle {
    pub path: String,
    pub generation: u64,
    pub duration: Option<Duration>,
    /// replay-gain adjustment this track was opened with
    /// kept so a discarded preload can be re-dispatched with the same value on a device switch
    /// (see replay_gain_db below)
    replay_gain_db: Option<f32>,
    /// write a real frame number here to schedule playback start 
    /// (crossfade timing, instant skip => same primitive either way), starts at UNSCHEDULED
    pub target_frame: Arc<AtomicU64>,
    pub paused: Arc<AtomicBool>,
    /// fade envelope handles
    /// same 'Arc's the GatedSource this handle controls was built with 
    /// (see GatedSource::fade_handles)
    /// '0'/UNSCHEDULED by default, meaning no fade
    /// schedule_at/schedule_now (hard cut) leave them untouched, 
    /// schedule_fade_in_at/schedule_fade_out are the only writers
    fade_in_frames: Arc<AtomicU64>,
    fade_out_at: Arc<AtomicU64>,
    fade_out_frames: Arc<AtomicU64>,
    /// forwarded into SymphoniaSource
    /// send a duration here to seek
    /// kept even though this track is silent/unscheduled,
    /// since the whole point of preloading ahead of time is that transport commands (seek included) can still reach it before it's actually audible
    pub seek_tx: Sender<Duration>,
    pub repeat_one_tx: Sender<bool>,
}

impl GatedTrackHandle {
    /// needed by engine.rs::set_output_device to re-dispatch a discarded preload against the rebuilt engine with the same replay-gain adjustment it was originally opened with
    /// preload()'s caller normally sources this from library metadata, which isn't available from inside a device switch, so it has to come from the discarded handle instead
    pub fn replay_gain_db(&self) -> Option<f32> {
        self.replay_gain_db
    }
}

/// opens 'path' and returns a GatedSource<ReadySource> ready to .add() onto a rodio::mixer::Mixer, plus a GatedTrackHandle for controlling it afterward
///
/// straight reuse of the decode logic in engine.rs::dispatch_open (open, seek if requested, resample if the device rate differs) with no overlap-buffer branch at all
#[allow(clippy::too_many_arguments)]
pub fn open_gated_track(
    path: &str,
    replay_gain_db: Option<f32>,
    generation: u64,
    volume: Arc<std::sync::atomic::AtomicU32>,
    replay_gain_enabled: Arc<AtomicBool>,
    device_sample_rate: NonZero<u32>,
    device_channels: NonZero<u16>,
    initial_seek: Option<Duration>,
    event_tx: Sender<AudioEvent>,
    clock: Arc<SharedClock>,
) -> Result<(GatedSource<ReadySource>, GatedTrackHandle), String> {
    let (seek_tx, seek_rx) = crossbeam::channel::unbounded::<Duration>();
    let (repeat_one_tx, repeat_one_rx) = crossbeam::channel::unbounded::<bool>();

    let mut src = SymphoniaSource::open(
        path,
        replay_gain_db,
        seek_rx,
        repeat_one_rx,
        event_tx,
        generation,
        volume,
        replay_gain_enabled,
        device_channels,
    )?;

    if let Some(pos) = initial_seek {
        src.seek(pos);
    }

    let duration = src.duration;
    let needs_resample = src.sample_rate() != device_sample_rate;

    let ready = if needs_resample {
        RubatoResampler::new(src, device_sample_rate).map(ReadySource::Resampled)?
    } else {
        ReadySource::Raw(src)
    };

    let target_frame = Arc::new(AtomicU64::new(UNSCHEDULED));
    let paused = Arc::new(AtomicBool::new(false));

    let gated = GatedSource::new(ready, clock, Arc::clone(&target_frame))
        .with_pause(Arc::clone(&paused));
    let (fade_in_frames, fade_out_at, fade_out_frames) = gated.fade_handles();

    let handle = GatedTrackHandle {
        path: path.to_string(),
        generation,
        duration,
        replay_gain_db,
        target_frame,
        paused,
        fade_in_frames,
        fade_out_at,
        fade_out_frames,
        seek_tx,
        repeat_one_tx,
    };

    Ok((gated, handle))
}

impl GatedTrackHandle {
    /// schedule this track to start at an absolute frame
    /// the one mechanism behind both automatic crossfade timing (a far target) and instant "skip to next" (the next frame the clock will produce)
    pub fn schedule_at(&self, frame: u64) {
        self.target_frame.store(frame, Ordering::Release);
    }

    /// convenience for "start right now"
    /// reads the shared clock and schedules at its current value
    /// note there's an inherent tiny race between reading clock.now here and the mixer's next render pull actually observing the new target
    /// in practice this is bounded by one render buffer
    pub fn schedule_now(&self, clock: &SharedClock) {
        self.schedule_at(clock.now());
    }

    /// schedule this (incoming/"next") track to start at 'frame', ramping up over 'fade_frames' with an equal power curve
    /// fade_frames == 0 degrades to the same hard cut schedule_at gives
    /// no separate zero-length-ramp branch needed downstream in GatedSource
    ///
    /// order matters: fade_in_frames is written before target_frame so a render pull can never observe "already live" with a stale/zero fade length
    /// (which would produce one frame of a hard-cut pop before the ramp value lands)
    /// release on this write happens before the release on 'target_frame' below from the perspective of any thread that later acquire-loads 'target_frame' and sees the new value
    pub fn schedule_fade_in_at(&self, frame: u64, fade_frames: u64) {
        self.fade_in_frames.store(fade_frames, Ordering::Release);
        self.schedule_at(frame);
    }

    /// schedule this (already-live/"current") track to start fading out to silence at 'frame', over 'fade_frames'
    /// mirrors schedule_fade_in_at's write ordering for the same reason
    pub fn schedule_fade_out(&self, frame: u64, fade_frames: u64) {
        self.fade_out_frames.store(fade_frames.max(1), Ordering::Release);
        self.fade_out_at.store(frame, Ordering::Release);
    }

    pub fn set_paused(&self, paused: bool) {
        // release, not relaxed
        // this flag also gates whether shift_forward's prior writes to target_frame/fade_out_at (see resume(): it always shifts before unmuting) are visible yet
        // relaxed only guarantees the store itself is atomic, it gives no guarantee that a reader observing paused == false also observes writes that preceded it on this thread
        // paired with the acquire load in GatedSource::next, this makes that guarantee real:
        // everything sequenced before this store becomes visible to anything sequenced after the read that observes it
        // before resume()'s shift_forward existed, target_frame was write once at track start and this pairing didn't matter =>
        // it does now, since we rewrite an already live gating value right before unmuting it
        self.paused.store(paused, Ordering::Release);
    }

    /// this track's own start frame
    /// its normal playback position is clock.now
    /// for an incoming crossfade track this is also the frame the fade-in began at,
    /// since it's the same schedule_fade_in_at write added for the mid-crossfade device-switch resume (set_output_device's case B),
    /// which needs to read these back after the fact
    pub fn target_frame(&self) -> u64 {
        self.target_frame.load(Ordering::Acquire)
    }

    /// frame this track was told to start fading out at, or UNSCHEDULED if it never was
    pub fn fade_out_at(&self) -> u64 {
        self.fade_out_at.load(Ordering::Acquire)
    }

    /// shifts every scheduled frame reference on this handle forward by 'frames'
    /// used by AudioEngine::resume to compensate for the shared clock advancing throughout a pause
    /// the clock has no concept of pause: it just counts render callback frames,
    /// and a paused GatedSource still emits (silent) frames that count
    /// see gated.rs's next() doc comment,
    /// so clock.now - target_frame drifts by exactly the pause duration if nothing compensates
    /// only touches fields that are actually scheduled (not UNSCHEDULED), so an unfired fade-out on a current track that isn't mid-crossfade is left alone
    pub fn shift_forward(&self, frames: u64) {
        let target = self.target_frame.load(Ordering::Acquire);
        if target != UNSCHEDULED {
            self.target_frame.store(target + frames, Ordering::Release);
        }
        let fade_out_at = self.fade_out_at.load(Ordering::Acquire);
        if fade_out_at != UNSCHEDULED {
            self.fade_out_at.store(fade_out_at + frames, Ordering::Release);
        }
    }

    /// length, in frames, of the fade-out ramp starting at fade_out_at
    pub fn fade_out_frames(&self) -> u64 {
        self.fade_out_frames.load(Ordering::Acquire)
    }

    /// length, in frames, of the fade-in ramp starting at target_frame
    pub fn fade_in_frames(&self) -> u64 {
        self.fade_in_frames.load(Ordering::Acquire)
    }
}

// =============================================================================
// tests => real decode pipeline (SymphoniaSource) fed real wav bytes, wired through a real GatedSource, registered on a real rodio::mixer::Mixer
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// writes a minimal 16-bit pcm mono wav file containing 'n_samples' samples,
    /// each equal to 'value' (as i16 full-scale fraction), to a fresh temp path, returns the path
    fn write_test_wav(value: f32, n_samples: u32, sample_rate: u32) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "audion_gated_test_{}_{}.wav",
            std::process::id(),
            {
                use std::sync::atomic::{AtomicU64, Ordering};
                static COUNTER: AtomicU64 = AtomicU64::new(0);
                COUNTER.fetch_add(1, Ordering::Relaxed)
            }
        ));

        let sample_i16 = (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let data_bytes = (n_samples as u32) * 2; // 16-bit mono
        let byte_rate = sample_rate * 2;

        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
        f.write_all(b"WAVE").unwrap();
        f.write_all(b"fmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap(); // fmt chunk size
        f.write_all(&1u16.to_le_bytes()).unwrap(); // pcm
        f.write_all(&1u16.to_le_bytes()).unwrap(); // mono
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap(); // block align
        f.write_all(&16u16.to_le_bytes()).unwrap(); // bits per sample
        f.write_all(b"data").unwrap();
        f.write_all(&data_bytes.to_le_bytes()).unwrap();
        for _ in 0..n_samples {
            f.write_all(&sample_i16.to_le_bytes()).unwrap();
        }
        path
    }

    fn dummy_deps() -> (Arc<std::sync::atomic::AtomicU32>, Arc<AtomicBool>, Sender<AudioEvent>) {
        let volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits()));
        let replay_gain_enabled = Arc::new(AtomicBool::new(false));
        let (event_tx, _event_rx) = crossbeam::channel::unbounded::<AudioEvent>();
        (volume, replay_gain_enabled, event_tx)
    }

    #[test]
    fn opens_real_wav_and_stays_silent_until_scheduled() {
        let path = write_test_wav(0.5, 2000, 44100);
        let (volume, rg, event_tx) = dummy_deps();
        let clock = SharedClock::new();

        let (mut gated, handle) = open_gated_track(
            path.to_str().unwrap(),
            None,
            1,
            volume,
            rg,
            NonZero::new(44100).unwrap(), // matches file rate => no resample needed
            NonZero::new(1).unwrap(),
            None,
            event_tx,
            Arc::clone(&clock),
        ).expect("open_gated_track should succeed on a valid WAV");

        assert_eq!(handle.duration.is_some(), true);

        // default target is UNSCHEDULED => must be silent no matter how far the clock advances
        clock.advance(10_000);
        for _ in 0..50 {
            assert_eq!(gated.next(), Some(0.0));
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scheduled_real_track_produces_real_decoded_audio_at_target() {
        let path = write_test_wav(0.5, 2000, 44100);
        let (volume, rg, event_tx) = dummy_deps();
        let clock = SharedClock::new();

        let (mut gated, handle) = open_gated_track(
            path.to_str().unwrap(),
            None,
            1,
            volume,
            rg,
            NonZero::new(44100).unwrap(),
            NonZero::new(1).unwrap(),
            None,
            event_tx,
            Arc::clone(&clock),
        ).unwrap();

        // schedule to start immediately
        handle.schedule_at(0);

        // first pulled sample should be real decoded audio, not silence, and roughly match the 0.5 full-scale value we wrote
        // (allow decode/normalization slack rather than asserting bit-exact equality against a hand-picked i16 round trip)
        let first = gated.next().expect("gated source must yield Some");
        assert!(first.abs() > 0.05, "expected real non-silent decoded audio, got {}", first);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn two_real_gated_tracks_on_a_real_mixer_no_duplicate_playback() {
        // build two independent real tracks, schedule B to start substantially into A's playback (simulating a crossfade point), and confirm B's audio is heard exactly once
        // there is no separate queue fallthrough copy to duplicate it, because there is no queue in this design at all
        let path_a = write_test_wav(0.5, 20_000, 44100);
        let path_b = write_test_wav(0.25, 20_000, 44100);
        let clock = SharedClock::new();

        let (volume_a, rg_a, event_tx_a) = dummy_deps();
        let (gated_a, handle_a) = open_gated_track(
            path_a.to_str().unwrap(), None, 1, volume_a, rg_a,
            NonZero::new(44100).unwrap(), NonZero::new(1).unwrap(), None, event_tx_a,
            Arc::clone(&clock),
        ).unwrap();

        let (volume_b, rg_b, event_tx_b) = dummy_deps();
        let (gated_b, handle_b) = open_gated_track(
            path_b.to_str().unwrap(), None, 2, volume_b, rg_b,
            NonZero::new(44100).unwrap(), NonZero::new(1).unwrap(), None, event_tx_b,
            Arc::clone(&clock),
        ).unwrap();

        handle_a.schedule_at(0);
        handle_b.schedule_at(5_000); // B comes in 5000 frames into a => the "crossfade point"

        let (mixer_in, mut mixer_out) = rodio::mixer::mixer(
            NonZero::new(1).unwrap(),
            NonZero::new(44100).unwrap(),
        );
        mixer_in.add(gated_a);
        mixer_in.add(gated_b);

        // pull 5000 frames => only A should be audible (B still gated silent)
        // advance the clock ourselves each pull, exactly like the real render callback will in phase 3
        for _ in 0..5000 {
            let s = mixer_out.next().unwrap();
            assert!(s.abs() > 0.05, "A should be audible before B's target");
            clock.advance(1);
        }

        // from frame 5000 on, both are live and summed =>
        // total magnitude should reflect both tracks' contribution (0.5-ish + 0.25-ish in the same direction,
        // since both wavs are constant-positive), not just one of them
        let mixed = mixer_out.next().unwrap();
        clock.advance(1);
        assert!(mixed.abs() > 0.5, "expected sum of both tracks' amplitude, got {}", mixed);

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn repeat_one_tx_makes_the_track_loop_instead_of_finishing() {
        // the mechanism underneath the repeat-one fix in (engine.rs's maybe_auto_crossfade guard): GatedTrackHandle::repeat_one_tx forwards straight
        // into SymphoniaSource's own repeat_one flag, which (per symphonia.rs's next())
        // seeks back to 0 in place and keeps decoding from the same source instead of ever emitting TrackFinished
        // this is what makes repeat-one invisible to the gated pipeline at all
        // confirms that mechanism actually works before trusting engine.rs's guard on top of it
        let sample_rate = 1000u32;
        let path = write_test_wav(0.5, sample_rate, sample_rate); // exactly 1 second
        let (volume, rg, event_tx) = dummy_deps();
        let (event_tx_probe, event_rx_probe) = crossbeam::channel::unbounded::<AudioEvent>();
        let clock = SharedClock::new();

        let (mut gated, handle) = open_gated_track(
            path.to_str().unwrap(),
            None,
            1,
            volume,
            rg,
            NonZero::new(sample_rate).unwrap(),
            NonZero::new(1).unwrap(),
            None,
            event_tx_probe,
            Arc::clone(&clock),
        ).unwrap();
        let _ = event_tx; // unused half of dummy_deps' tuple, kept for symmetry with other tests

        handle.schedule_at(0);
        let _ = handle.repeat_one_tx.send(true);

        // pull well past the track's own 1000-sample length
        // under repeat-one this must produce real audio the whole way through
        // (never silence, never None) and must never report TrackFinished 
        // only StateChanged{position: 0.0} each time it wraps
        let mut non_silent_count = 0usize;
        for i in 0..2500u32 {
            let sample = gated.next().expect("repeat-one must never let the source end (None)");
            if sample.abs() > 0.05 {
                non_silent_count += 1;
            }
            clock.advance(1);
            let _ = i;
        }
        assert!(
            non_silent_count > 2000,
            "expected the overwhelming majority of 2500 pulled samples to be real decoded \
             audio across at least two loop iterations, got {} non-silent",
            non_silent_count
        );

        let mut saw_loop_reset = false;
        let mut saw_track_finished = false;
        while let Ok(evt) = event_rx_probe.try_recv() {
            match evt {
                AudioEvent::StateChanged { position } if position == 0.0 => saw_loop_reset = true,
                AudioEvent::TrackFinished { .. } => saw_track_finished = true,
                _ => {}
            }
        }
        assert!(saw_loop_reset, "expected at least one StateChanged{{position: 0.0}} from the internal loop-back seek");
        assert!(!saw_track_finished, "repeat-one must never emit TrackFinished — that's exactly what would let DecisionThread treat this as a natural end");

        let _ = std::fs::remove_file(&path);
    }
}