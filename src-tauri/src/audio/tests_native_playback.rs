//! real device playback tests
//! these do: they drive AudioEngine's actual public api (play/preload/set_crossfade_seconds/maybe_auto_crossfade) against a real cpal device with the shared clock advancing at real wall clock rate
//! and check that a crossfade genuinely overlaps rather than degrading into sequential/gapless playback
//! needs a real output device => fails loudly on headless/no audio device machines
//! which is itself a meaningful result

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::decision::TrackSlot;
use super::dsp::EqSettings;
use super::dual_track::open_gated_track;
use super::engine::AudioEngine;
use super::gated::UNSCHEDULED;
use super::gated_worker::GatedOpenResult;
use super::mod_types::AudioEvent;

/// writes a minimal 16 bit PCM mono WAV of constant amplitude samples
/// caller owns cleanup of the returned path
fn write_test_wav(seconds: u32, sample_rate: u32) -> std::path::PathBuf {
    let n_samples = seconds * sample_rate;
    let path = std::env::temp_dir().join(format!(
        "audion_native_playback_test_{}_{}.wav",
        std::process::id(),
        {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            COUNTER.fetch_add(1, Ordering::Relaxed)
        }
    ));

    let sample_i16: i16 = (0.4_f32 * i16::MAX as f32) as i16;
    let data_bytes = n_samples * 2; // 16-bit mono
    let byte_rate = sample_rate * 2;

    let mut f = std::fs::File::create(&path)
        .unwrap_or_else(|e| panic!("failed to create temp WAV at {:?}: {e}", path));
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
    f.write_all(b"WAVE").unwrap();
    f.write_all(b"fmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
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
    f.flush().unwrap();

    path
}

/// serializes the three real device tests in this file
/// each opens its own output device and relies on a real OS audio callback thread advancing SharedClock, independent of test thread scheduling
/// under cargo test's default parallelism, one thread can be starved for several real seconds by the others (observed: a 100ms sleep taking 4.9s to resume),
/// which is enough to blow through a polling window before any useful poll happens
/// serializing removes the contention instead of papering over it with looser margins
static DEVICE_TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn native_backend_actually_produces_audio() {
    let _guard = DEVICE_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    std::env::set_var("RUST_BACKTRACE", "full");

    let eq_settings = EqSettings::default();

    // open the real default output device
    let (mut engine, _event_rx, _gated_open_rx, device_list) =
        AudioEngine::new(&eq_settings, None).unwrap_or_else(|e| {
            panic!(
                "AudioEngine::new() failed to open a native output device — native playback is \
                 impossible on this machine. Underlying error: {e}\nBacktrace:\n{}",
                std::backtrace::Backtrace::force_capture()
            )
        });

    assert!(
        !device_list.devices.is_empty(),
        "AudioEngine::new() succeeded but reported zero output devices: {:?}",
        device_list.devices
    );

    let device_sample_rate = engine.device_sample_rate;
    let device_channels = engine.device_channels;

    // 4s is comfortably longer than the polling window below
    // so a stalled callback can't be masked by the track simply finishing
    let wav_path = write_test_wav(4, device_sample_rate.get());

    let (event_tx, event_rx_probe) = crossbeam::channel::unbounded::<AudioEvent>();
    let volume = Arc::new(AtomicU32::new(1.0f32.to_bits()));
    let replay_gain_enabled = Arc::new(AtomicBool::new(false));

    let (gated_source, handle) = open_gated_track(
        wav_path.to_str().expect("temp wav path must be valid UTF-8"),
        None,
        1, // generation => arbitrary, unused by this test
        volume,
        replay_gain_enabled,
        device_sample_rate,
        device_channels,
        None,
        event_tx,
        Arc::clone(&engine.gated_clock),
    )
    .unwrap_or_else(|e| {
        let _ = std::fs::remove_file(&wav_path);
        panic!(
            "open_gated_track() failed to open/decode our own freshly-written WAV at {:?}: {e}\n\
             Backtrace:\n{}",
            wav_path,
            std::backtrace::Backtrace::force_capture()
        )
    });

    assert!(
        handle.duration.is_some(),
        "decoded track reported no duration — decode pipeline likely didn't actually read the \
         file (path: {:?})",
        wav_path
    );

    // register on the real mixer wired to the real device stream, and start it
    engine.gated_mixer.add(gated_source);
    handle.schedule_now(&engine.gated_clock);

    // the shared clock only advances via the live render callback (see gated.rs: SharedClock::advance)
    // so any movement here is direct proof cpal is pulling frames
    let clock_start = engine.gated_clock.now();
    let wall_start = Instant::now();

    let poll_timeout = Duration::from_secs(3);
    let poll_interval = Duration::from_millis(25);
    let mut clock_after_wait = clock_start;

    while wall_start.elapsed() < poll_timeout {
        std::thread::sleep(poll_interval);
        clock_after_wait = engine.gated_clock.now();
        if clock_after_wait > clock_start {
            break;
        }
    }

    let elapsed = wall_start.elapsed();
    let frames_advanced = clock_after_wait.saturating_sub(clock_start);
    // generous slack (>=20%) for scheduling jitter and CI/VM clocks
    // the goal is to catch "never plays" or "plays at a tiny fraction of real time", not to pin exact timing
    let expected_frames = (elapsed.as_secs_f64() * device_sample_rate.get() as f64) as u64;
    let min_acceptable_frames = (expected_frames as f64 * 0.2) as u64;

    let mut pipeline_errors = Vec::new();
    while let Ok(evt) = event_rx_probe.try_recv() {
        if let AudioEvent::Error { message } = evt {
            pipeline_errors.push(message);
        }
    }

    let _ = std::fs::remove_file(&wav_path);

    assert!(
        frames_advanced > 0,
        "NATIVE PLAYBACK DID NOT PRODUCE ANY AUDIO.\n\
         gated_clock never advanced after {:?} of real wall-clock time, even though the track \
         was scheduled via handle.schedule_now() on the real device's gated_mixer.\n\
         \n\
         Diagnostics:\n\
         - device_sample_rate: {}\n\
         - device_channels: {}\n\
         - device_list: {:?}\n\
         - track path: {:?}\n\
         - track duration: {:?}\n\
         - clock_start: {}\n\
         - clock_after_wait: {}\n\
         - pipeline error events received: {:?}\n\
         \n\
         Backtrace:\n{}",
        elapsed,
        device_sample_rate.get(),
        device_channels.get(),
        device_list.devices,
        wav_path,
        handle.duration,
        clock_start,
        clock_after_wait,
        pipeline_errors,
        std::backtrace::Backtrace::force_capture(),
    );

    assert!(
        frames_advanced >= min_acceptable_frames,
        "NATIVE PLAYBACK IS RUNNING BUT FAR SLOWER THAN REAL TIME — likely underruns / a \
         starved render callback.\n\
         \n\
         Diagnostics:\n\
         - elapsed wall time: {:?}\n\
         - device_sample_rate: {}\n\
         - frames advanced: {}\n\
         - expected (real-time) frames: {}\n\
         - minimum acceptable (20% of real-time): {}\n\
         - pipeline error events received: {:?}\n\
         \n\
         Backtrace:\n{}",
        elapsed,
        device_sample_rate.get(),
        frames_advanced,
        expected_frames,
        min_acceptable_frames,
        pipeline_errors,
        std::backtrace::Backtrace::force_capture(),
    );
}

/// applies a GatedOpenResult the way worker.rs's gated_open_result_rx arm does:
/// register the source on the real mixer, then either schedule_now + decision.load_current (play)
/// or leave it UNSCHEDULED and decision.load_next (preload)
/// kept parallel to worker.rs's arm rather than calling into it directly
/// since that logic is inlined in a spawned thread closure with no standalone entry point
fn apply_gated_open_result(engine: &mut AudioEngine, result: GatedOpenResult, is_play: bool) {
    let (gated_source, handle) = result
        .result
        .unwrap_or_else(|e| panic!("gated open failed (gen {}): {e}", result.generation));

    engine.gated_mixer.add(gated_source);
    let slot = TrackSlot::new(handle, engine.device_sample_rate.get());

    if is_play {
        slot.handle.schedule_now(&engine.gated_clock);
        // duration is only known once the open completes => current_info was set with
        // duration: None by play() itself, so backfill it here (seek() depends on it
        let duration = slot.handle.duration;
        if let Some(ref mut info) = engine.current_info {
            info.duration = duration;
        }
        engine.decision.load_current(slot);
    } else {
        engine.decision.load_next(slot);
    }
}

/// blocks until a GatedOpenResult matching 'generation' arrives,
/// applying and discarding any stale/mismatched results along the way, exactly as worker.rs's generation matching arm does
fn wait_for_gated_result(
    engine: &mut AudioEngine,
    rx: &crossbeam::channel::Receiver<GatedOpenResult>,
    generation: u64,
    is_play: bool,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out waiting for gated open result (gen {generation}, is_play={is_play})"
        );
        let result = rx
            .recv_timeout(remaining)
            .unwrap_or_else(|e| panic!("gated_open_result_rx closed unexpectedly: {e}"));
        if result.generation == generation {
            apply_gated_open_result(engine, result, is_play);
            return;
        }
        // stale/superseded result from an earlier dispatch => worker.rs discards these too
    }
}

/// crossfade must actually overlap two tracks, not just delay a sequential handoff
/// runs the real play()/preload()/set_crossfade_seconds()/maybe_auto_crossfade() sequence over real time against a real device,
/// and asserts the shared clock is observed to pass B's start frame while still before A's natural end
#[test]
fn native_crossfade_actually_overlaps_before_natural_end() {
    let _guard = DEVICE_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    std::env::set_var("RUST_BACKTRACE", "full");

    let eq_settings = EqSettings::default();
    let (mut engine, _event_rx, gated_open_rx, _device_list) =
        AudioEngine::new(&eq_settings, None).unwrap_or_else(|e| {
            panic!(
                "AudioEngine::new() failed to open a native output device: {e}\nBacktrace:\n{}",
                std::backtrace::Backtrace::force_capture()
            )
        });

    let sample_rate = engine.device_sample_rate.get();

    // 3s tracks, 1s crossfade => long enough that "fired at natural end" (bug) and "fired ~1s
    // early" (correct) are trivially distinguishable against wall clock jitter
    const CROSSFADE_SECS: u32 = 1;
    let path_a = write_test_wav(3, sample_rate);
    let path_b = write_test_wav(3, sample_rate);

    engine.set_crossfade_seconds(CROSSFADE_SECS);

    engine.play(path_a.to_str().unwrap(), None);
    let play_generation = engine.current_generation;
    wait_for_gated_result(&mut engine, &gated_open_rx, play_generation, true);

    engine
        .preload(path_b.to_str().unwrap(), None, CROSSFADE_SECS)
        .unwrap_or_else(|e| panic!("preload() failed: {e}"));
    let preload_generation = engine.gated_preload_generation;
    wait_for_gated_result(&mut engine, &gated_open_rx, preload_generation, false);

    let duration_frames_a = engine
        .decision
        .current()
        .and_then(|s| s.duration_frames)
        .unwrap_or_else(|| panic!("current track reported no decoded duration after loading"));
    let current_start_frame = engine
        .decision
        .current()
        .unwrap()
        .handle
        .target_frame
        .load(Ordering::Acquire);
    assert_ne!(
        current_start_frame, UNSCHEDULED,
        "current track never actually got scheduled by schedule_now()"
    );
    let natural_end_frame = current_start_frame + duration_frames_a;
    let crossfade_frames = CROSSFADE_SECS as u64 * sample_rate as u64;
    let expected_fire_frame = natural_end_frame.saturating_sub(crossfade_frames);

    // real time driven auto-crossfade, matching worker.rs's 100ms crossfade_tick arm
    let poll_interval = Duration::from_millis(100);
    let deadline = Instant::now() + Duration::from_secs(8); // 3s track + slack

    let mut fired_at_clock: Option<u64> = None;
    let mut saw_real_overlap = false;

    while Instant::now() < deadline {
        std::thread::sleep(poll_interval);
        engine.maybe_auto_crossfade();

        let now = engine.gated_clock.now();
        let next_target = engine
            .decision
            .next_slot()
            .map(|s| s.handle.target_frame.load(Ordering::Acquire));

        if fired_at_clock.is_none() {
            if let Some(t) = next_target {
                if t != UNSCHEDULED {
                    fired_at_clock = Some(t);
                }
            }
        }

        // the defining property of a real crossfade:
        // the clock passes B's start frame while still before A's natural end
        // sequential/gapless playback can never produce this
        if let Some(t) = next_target {
            if t != UNSCHEDULED && now >= t && now < natural_end_frame {
                saw_real_overlap = true;
                break;
            }
        }

        if now >= natural_end_frame + sample_rate as u64 {
            break; // A has been over for a full second => no overlap window left to catch
        }
    }

    let _ = std::fs::remove_file(&path_a);
    let _ = std::fs::remove_file(&path_b);

    assert!(
        fired_at_clock.is_some(),
        "NO CROSSFADE EVER FIRED over a real 3s track. Either the live crossfade_seconds value \
         never reached DecisionThread::tick(), or tick()'s real-time position math never \
         entered the crossfade window.\n\
         current_start_frame={current_start_frame}, natural_end_frame={natural_end_frame}, \
         crossfade_frames={crossfade_frames}"
    );

    let fired_at_clock = fired_at_clock.unwrap();
    assert!(
        fired_at_clock < natural_end_frame,
        "CROSSFADE FIRED AT OR AFTER A's NATURAL END — sequential/gapless playback, not a real \
         crossfade. B's target frame ({fired_at_clock}) should have been ~{crossfade_frames} \
         frames before A's natural end ({natural_end_frame}), around frame \
         {expected_fire_frame}."
    );

    assert!(
        saw_real_overlap,
        "B was scheduled before A's natural end (fired_at_clock={fired_at_clock} < \
         natural_end_frame={natural_end_frame}), but the clock was never observed between those \
         two frames during polling — the audible spans never actually overlapped. Likely a \
         missed poll window; rerun with RUST_BACKTRACE=full, and treat as a real bug if it \
         reproduces consistently."
    );
}

/// regression test: a single seek() mid-playback must not silently disable auto-crossfade for the rest of the track
/// position_frames() is clock_now - target_frame,
/// correct only if target_frame reflects where the decoder actually is => seek() must rewrite it, not just jump the decoder
/// runs the same real play()/preload()/set_crossfade_seconds()/ maybe_auto_crossfade() sequence as the sibling test above, with one engine.seek() inserted shortly after playback starts
#[test]
fn native_crossfade_still_fires_after_a_seek() {
    let _guard = DEVICE_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    std::env::set_var("RUST_BACKTRACE", "full");

    let eq_settings = EqSettings::default();
    let (mut engine, _event_rx, gated_open_rx, _device_list) =
        AudioEngine::new(&eq_settings, None).unwrap_or_else(|e| {
            panic!(
                "AudioEngine::new() failed to open a native output device: {e}\nBacktrace:\n{}",
                std::backtrace::Backtrace::force_capture()
            )
        });

    let sample_rate = engine.device_sample_rate.get();

    // 15s track, seek to 50% (7.5s) => leaves ~7.5s of real time after the seek for a 1s crossfade window
    // generous enough to absorb the scheduler jitter DEVICE_TEST_LOCK's doc
    // comment describes
    // (other unrelated tests in the same run can still contend for CPU even with this file's own three tests serialized against each other)
    const CROSSFADE_SECS: u32 = 1;
    let path_a = write_test_wav(15, sample_rate);
    let path_b = write_test_wav(3, sample_rate);

    engine.set_crossfade_seconds(CROSSFADE_SECS);

    engine.play(path_a.to_str().unwrap(), None);
    let play_generation = engine.current_generation;
    wait_for_gated_result(&mut engine, &gated_open_rx, play_generation, true);

    engine
        .preload(path_b.to_str().unwrap(), None, CROSSFADE_SECS)
        .unwrap_or_else(|e| panic!("preload() failed: {e}"));
    let preload_generation = engine.gated_preload_generation;
    wait_for_gated_result(&mut engine, &gated_open_rx, preload_generation, false);

    let duration_frames_a = engine
        .decision
        .current()
        .and_then(|s| s.duration_frames)
        .unwrap_or_else(|| panic!("current track reported no decoded duration after loading"));

    // let it play for real for a moment, like a listener would before touching seek
    std::thread::sleep(Duration::from_millis(500));

    // seek to the 50% mark (~7.5s in)
    engine
        .seek(0.5)
        .unwrap_or_else(|e| panic!("seek() failed: {e}"));

    let current_target_after_seek = engine
        .decision
        .current()
        .unwrap()
        .handle
        .target_frame
        .load(Ordering::Acquire);
    assert_ne!(
        current_target_after_seek, UNSCHEDULED,
        "seek() left target_frame UNSCHEDULED — it should always rewrite it to a concrete frame"
    );

    let crossfade_frames_debug = CROSSFADE_SECS as u64 * sample_rate as u64;
    // invariant seek() must hold: clock_now - target_frame == the seeked-to position
    // checked with a generous (3s) tolerance rather than a tight one, since even these few intervening statements aren't immune to the scheduler jitter noted above
    // the bug this guards against is off by the full seek distance (multiple seconds), not by a jitter-sized amount
    let clock_now_right_after_seek = engine.gated_clock.now();
    let seeked_position_frames = (0.5 * duration_frames_a as f64).round() as u64;
    let reported_position = clock_now_right_after_seek.saturating_sub(current_target_after_seek);
    let position_error = reported_position.abs_diff(seeked_position_frames);
    assert!(
        position_error < sample_rate as u64 * 3,
        "target_frame wasn't rewritten to match the seek: expected ~{seeked_position_frames} \
         frames (50% of a {duration_frames_a}-frame track), got {reported_position} \
         (target_frame={current_target_after_seek}, clock_now={clock_now_right_after_seek}). \
         engine::seek() must rewrite target_frame to \
         clock_now.saturating_sub(seek_position_frames)."
    );

    // target is already clock_now_at_seek - seeked_position_frames (asserted above),
    // so position_frames(now) already reads seeked_position_frames right after the seek and grows from there
    // the track's natural end in clock terms is target + duration_frames_a 
    // not target + remaining, which double-subtracts the seek offset
    let natural_end_frame = current_target_after_seek + duration_frames_a;

    // same real-time polling loop as the sibling test, now after a seek
    let poll_interval = Duration::from_millis(100);
    let deadline = Instant::now() + Duration::from_secs(20); // ~7.5s remaining + generous slack

    let mut fired_at_clock: Option<u64> = None;
    let mut saw_real_overlap = false;
    let mut iterations = 0u32;
    let mut last_now = clock_now_right_after_seek;
    let mut last_next_target: Option<u64> = None;
    let mut last_current_target: Option<u64> = None;

    while Instant::now() < deadline {
        std::thread::sleep(poll_interval);
        engine.maybe_auto_crossfade();
        iterations += 1;

        let now = engine.gated_clock.now();
        let next_target = engine
            .decision
            .next_slot()
            .map(|s| s.handle.target_frame.load(Ordering::Acquire));
        let current_target = engine
            .decision
            .current()
            .map(|s| s.handle.target_frame.load(Ordering::Acquire));
        last_now = now;
        last_next_target = next_target;
        last_current_target = current_target;

        if fired_at_clock.is_none() {
            if let Some(t) = next_target {
                if t != UNSCHEDULED {
                    fired_at_clock = Some(t);
                }
            }
        }

        if let Some(t) = next_target {
            if t != UNSCHEDULED && now >= t && now < natural_end_frame {
                saw_real_overlap = true;
                break;
            }
        }

        if now >= natural_end_frame + sample_rate as u64 * 5 {
            break;
        }
    }

    let _ = std::fs::remove_file(&path_a);
    let _ = std::fs::remove_file(&path_b);

    assert!(
        fired_at_clock.is_some(),
        "NO CROSSFADE FIRED AFTER A SEEK. target_frame itself was already confirmed correct \
         right after the seek, so the cause is in what happens afterward, over real time. \
         Diagnostic snapshot from the last of {iterations} poll iterations (100ms apart):\n\
         \x20 last clock.now()          = {last_now}\n\
         \x20 current.target_frame      = {last_current_target:?}\n\
         \x20 next.target_frame         = {last_next_target:?} (UNSCHEDULED = {UNSCHEDULED})\n\
         \x20 natural_end_frame         = {natural_end_frame}\n\
         \x20 crossfade_frames          = {crossfade_frames_debug}\n\
         \x20 duration_frames_a         = {duration_frames_a}\n\
         \x20 seeked_position_frames    = {seeked_position_frames}\n\
         If next.target_frame is still UNSCHEDULED with clock.now() already past \
         natural_end_frame, tick() never fired even though remaining should have entered the \
         crossfade window — check duration_frames/crossfade_seconds after a seek. If \
         current.target_frame no longer matches the seek assertion above, something between the \
         seek and this loop rewrote it again."
    );
    let fired_at_clock = fired_at_clock.unwrap();
    assert!(
        fired_at_clock < natural_end_frame,
        "crossfade fired at or after the post-seek natural end (fired_at_clock={fired_at_clock}, \
         natural_end_frame={natural_end_frame}) — sequential playback again, just delayed."
    );
    assert!(
        saw_real_overlap,
        "crossfade was scheduled before the post-seek natural end but no overlap window was \
         observed — see the sibling test's identical assertion for what this usually means."
    );
}