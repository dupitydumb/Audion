use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering, AtomicU32};
use std::time::{Duration, Instant};
use std::num::NonZero;
use std::str::FromStr;
use cpal::DeviceId;
use crossbeam::channel::{unbounded, Receiver, Sender};

use super::dsp::{EqSettings, LIMITER_ENABLED_DEFAULT};
use super::mod_types::{AudioEvent, DeviceList, AudioDeviceInfo};
use super::sources::{ClockAdvancingSource, EqSource, LimiterSource};

// gated dual source pipeline
// (gated.rs/dual_track.rs/decision.rs/gated_worker.rs/directive.rs) is the only playback path
use super::gated::{SharedClock, UNSCHEDULED};
use super::decision::{DecisionThread, TrackSlot};
use super::gated_worker::{spawn_gated_open_worker, GatedOpenTask, GatedOpenResult};

/// state kept between dispatching a mid-crossfade device-switch resume's two concurrent gated opens
/// (the outgoing, fading-out track and the incoming, fading-in track) and both actually completing
/// see AudioEngine::set_output_device's case B
/// worker.rs's gated_open_result_rx arm matches incoming results against these generations
/// before falling through to the normal current_generation/gated_preload_generation check,
/// and schedules each with a reconstructed fade envelope
pub struct PendingFadeResume {
    pub out_generation: Option<u64>,
    pub in_generation: Option<u64>,
    /// how far into the crossfade envelope playback already was at the moment of capture
    /// and the envelope's total length
    /// both as 'Duration' (sample rate independent)
    /// so they can be re-expressed in frames against whatever sample rate the new device actually uses
    pub fade_elapsed: Duration,
    pub fade_total: Duration,
}


// =============================================================================
// TrackInfo => position tracking across seeks and pauses
// =============================================================================

pub struct TrackInfo {
    pub path: String,
    pub duration: Option<Duration>,
    // wall-clock of last resume / seek
    pub started: Instant,
    // playback position at last resume / seek
    pub offset: Duration,
}

impl TrackInfo {
    pub fn position_secs(&self) -> f64 {
        let elapsed = self.offset + self.started.elapsed();
        match self.duration {
            Some(d) => elapsed.as_secs_f64().min(d.as_secs_f64()),
            None => elapsed.as_secs_f64(),
        }
    }
}

// =============================================================================
// AudioEngine => owns the pipeline, lives entirely on the audio thread
// =============================================================================

pub struct AudioEngine {
    pub paused_flag: Arc<AtomicBool>,
    pub volume_atomic: Arc<AtomicU32>,
    pub volume: f32,
    pub eq_tx: Sender<EqSettings>,
    pub eq_settings: EqSettings,
    pub event_tx: Sender<AudioEvent>,
    pub device_sample_rate: NonZero<u32>,
    pub device_channels: NonZero<u16>,
    pub replay_gain_enabled: Arc<AtomicBool>,
    pub limiter_enabled: Arc<AtomicBool>,
    pub repeat_one: bool,
    pub current_info: Option<TrackInfo>,
    pub generation_counter: u64,
    pub current_generation: u64,

    pub play_abort: Arc<AtomicBool>,
    pub preload_abort: Arc<AtomicBool>,

    pub pending_seek: Option<Duration>,
    pub pending_seek_fraction: Option<f64>,
    pub pending_paused: bool,
    pub pending_track_advanced: bool,

    // dual source gated pipeline
    // gated_mixer is the input side (.add() gated sources onto it)
    // its output is wrapped in EqSource/LimiterSource and registered directly with _stream
    // in AudioEngine::new, so there's no separate output field to hold here afterward
    pub gated_clock: Arc<SharedClock>,
    pub gated_mixer: rodio::mixer::Mixer,
    pub decision: DecisionThread,
    pub gated_worker_tx: Sender<GatedOpenTask>,
    /// generation of the in-flight (or most recently completed) preload() dispatched through the gated pipeline
    /// worker.rs's gated_open_result_rx arm matches results against this to tell a preload
    /// result apart from a play() result, the same way it matches play() results against current_generation
    pub gated_preload_generation: u64,
    /// the most recently promoted-away "outgoing" track kept alive
    /// (instead of dropped, which is what directive::poll_completed_transition still does for its own callers)
    /// so a device switch mid-crossfade can find it and reconstruct its still-fading-out envelope on the new device
    /// see PendingFadeResume/set_output_device
    /// 'none' most of the time
    /// a crossfade's audible fade window is seconds long, but nothing here actively expires this once written
    /// so a switch long after the fade actually finished just finds a stale slot
    /// set_output_device checks fade_out_at/fade_out_frames against the clock itself
    /// to tell "still fading" apart from "long done"
    pub fading_out: Option<TrackSlot>,
    pub pending_fade_resume: Option<PendingFadeResume>,
    /// the clock frame at which pause() was last called, so resume() can measure exactly
    /// how many frames the shared clock advanced while paused and compensate
    /// (see GatedTrackHandle::shift_forward)
    /// 'none' when not currently paused
    pub paused_at: Option<u64>,

    pub _stream: rodio::MixerDeviceSink,
}

impl AudioEngine {
    pub fn new(
        eq_settings: &EqSettings,
        preferred_device_id: Option<String>,
    ) -> Result<(Self, Receiver<AudioEvent>, Receiver<GatedOpenResult>, DeviceList), String> {
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

        let paused_flag = Arc::new(AtomicBool::new(false));
        let volume_atomic = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let replay_gain_enabled = Arc::new(AtomicBool::new(true));
        let limiter_enabled = Arc::new(AtomicBool::new(LIMITER_ENABLED_DEFAULT));

        let (eq_tx, eq_rx) = unbounded::<EqSettings>();
        let (event_tx, event_rx) = unbounded::<AudioEvent>();

        // dual-source gated pipeline, the only playback path
        // starting_at, not plain new() => see SharedClock::starting_at's docs: seek()'s
        // target_frame arithmetic needs headroom below the clock's current value, which a
        // freshly-constructed 0-start clock doesn't have yet
        let gated_clock = SharedClock::starting_at(1 << 40);
        let (gated_mixer, gated_mixer_output) = rodio::mixer::mixer(device_channels, device_sample_rate);
        // rodio's mixer() docs warn: "a mixer without any input source behaves like an
        // Empty source, and thus, just after appending to a player, the mixer is removed
        // from the player. Add a Zero source to prevent detaching the mixer from player."
        // gated_mixer starts out empty here, no track is registered until play()/the
        // gated-open worker adds one, so without this, gated_mixer_output.next() returns
        // None on the very first real render pull, and MixerSource::sum_current_sources()
        // (the outer stream.mixer() this gets wrapped into below) permanently drops the
        // whole limited_src chain from current_sources right then
        // every later .add() onto gated_mixer after that point is a no-op as far as real
        // playback is concerned: frames flow into a mixer whose output the device stream
        // stopped listening to before any track was ever scheduled
        // this silent Zero keeps gated_mixer_output non-empty forever, so it's never treated as exhausted
        gated_mixer.add(rodio::source::Zero::new(device_channels, device_sample_rate));
        let decision = DecisionThread::new(Arc::clone(&gated_clock), device_sample_rate.get(), 0);
        let (gated_worker_tx, gated_worker_rx) = spawn_gated_open_worker();

        // replaygain/volume are already applied per-track inside SymphoniaSource (see
        // dual_track.rs::open_gated_track); eq and the limiter are stream-wide, so they wrap
        // the gated mixer's combined output here, the same EqSource/LimiterSource chain the
        // old queue-based pipeline used to wrap, now applied to the sole surviving pipeline
        // instead of being duplicated (this closes the "no eq/limiter on the gated pipeline"
        // gap noted as a scoped, temporary omission in earlier sub-steps)
        // plan.md's shared clock is meant to be advanced by the render callback itself
        // the old wall-clock-based pipeline never had an equivalent to port forward (it
        // tracked position via started.elapsed()), so this wrapper is new
        // it sits here, right after the mixer and before eq/limiter, because this is the
        // one place every real interleaved sample from every gated track passes through
        // exactly once per pull
        let clocked_src = ClockAdvancingSource::new(gated_mixer_output, Arc::clone(&gated_clock));
        let eq_src = EqSource::new(clocked_src, eq_settings, eq_rx);
        let limited_src = LimiterSource::new(eq_src, Arc::clone(&limiter_enabled));
        stream.mixer().add(limited_src);

        Ok((
            Self {
                paused_flag,
                volume_atomic,
                volume: 0.7,
                eq_tx,
                eq_settings: eq_settings.clone(),
                event_tx,
                device_sample_rate,
                device_channels,
                replay_gain_enabled,
                limiter_enabled,
                repeat_one: false,
                current_info: None,
                generation_counter: 0,
                current_generation: 0,
                play_abort: Arc::new(AtomicBool::new(false)),
                preload_abort: Arc::new(AtomicBool::new(false)),
                pending_seek: None,
                pending_seek_fraction: None,
                pending_paused: false,
                pending_track_advanced: false,
                gated_clock,
                gated_mixer,
                decision,
                gated_worker_tx,
                gated_preload_generation: 0,
                fading_out: None,
                pending_fade_resume: None,
                paused_at: None,
                _stream: stream,
            },
            event_rx,
            gated_worker_rx,
            cached_device_list,
        ))
    }

    /// play()'s dispatch primitive
    /// sends a GatedOpenTask through gated_worker_tx for open_gated_track to process off the audio command thread
    /// superseding play()/preload() calls bump generation_counter and flip a fresh abort_flag,
    /// so a stale result arriving late is discarded by the caller (worker.rs's
    /// gated_open_result_rx arm) rather than acted on
    fn dispatch_gated_open(
        &mut self,
        path: &str,
        replay_gain_db: Option<f32>,
        abort_flag: Arc<AtomicBool>,
        initial_seek: Option<Duration>,
    ) -> u64 {
        self.generation_counter += 1;
        let generation = self.generation_counter;

        let _ = self.gated_worker_tx.send(GatedOpenTask {
            path: path.to_string(),
            replay_gain_db,
            generation,
            volume: Arc::clone(&self.volume_atomic),
            replay_gain_enabled: Arc::clone(&self.replay_gain_enabled),
            device_sample_rate: self.device_sample_rate,
            device_channels: self.device_channels,
            initial_seek,
            event_tx: self.event_tx.clone(),
            clock: Arc::clone(&self.gated_clock),
            abort: abort_flag,
        });

        generation
    }

    pub fn play(&mut self, path: &str, replay_gain_db: Option<f32>) {
        // a play() supersedes anything mid-flight on the gated pipeline
        // there's no way to remove a source from rodio::mixer::Mixer once .add()ed
        // (see gated.rs/dual_track.rs module docs)
        // so any old current/next slots are re-gated to UNSCHEDULED and told to stop
        // decoding via the same Duration::MAX seek sentinel stop() uses
        let (old_current, old_next) = self.decision.clear();
        for slot in old_current.into_iter().chain(old_next) {
            let _ = slot.handle.seek_tx.send(Duration::MAX);
            slot.handle.target_frame.store(UNSCHEDULED, Ordering::Release);
        }

        self.current_info = Some(TrackInfo {
            path: path.to_string(),
            duration: None,
            started: Instant::now(),
            offset: Duration::ZERO,
        });
        self.paused_flag.store(false, Ordering::Relaxed);
        self.paused_at = None;
        self.pending_track_advanced = false;
        self.pending_seek = None;
        self.pending_seek_fraction = None;
        self.pending_paused = false;
        // 0 is never a real generation (generation_counter is pre-incremented before use)
        // so this can't accidentally match a genuinely in-flight preload result
        self.gated_preload_generation = 0;

        self.play_abort.store(true, Ordering::Relaxed);
        self.preload_abort.store(true, Ordering::Relaxed);
        let new_play_abort = Arc::new(AtomicBool::new(false));
        self.play_abort = Arc::clone(&new_play_abort);

        let generation = self.dispatch_gated_open(path, replay_gain_db, new_play_abort, None);
        self.current_generation = generation;

        tracing::info!("[AUDIO] Play dispatched via gated pipeline (gen {}): {}", generation, path);
    }

    pub fn preload(&mut self, path: &str, replay_gain_db: Option<f32>, _crossfade_seconds: u32) -> Result<(), String> {
        // _crossfade_seconds is taken but unused here
        // decision.next_slot() is the source of truth for "what's preloaded" now
        if self.decision.next_slot().map(|slot| slot.handle.path.as_str()) == Some(path) {
            tracing::info!("[AUDIO] Preload skipped (same path): {}", path);
            return Ok(());
        }
        tracing::info!(
            "[AUDIO] Preloading (gated pipeline): {} (replacing: {:?})",
            path,
            self.decision.next_slot().map(|slot| slot.handle.path.clone())
        );

        self.preload_abort.store(true, Ordering::Relaxed);
        let new_preload_abort = Arc::new(AtomicBool::new(false));
        self.preload_abort = Arc::clone(&new_preload_abort);

        let generation = self.dispatch_gated_open(path, replay_gain_db, new_preload_abort, None);
        self.gated_preload_generation = generation;
        tracing::debug!("[AUDIO] Gated preload dispatched (gen {}): {}", generation, path);
        Ok(())
    }

    /// ported straight to decision.current()'s own GatedTrackHandle::seek_tx
    /// mid-crossfade there's still only one "current" (the outgoing track), so next's
    /// handle is deliberately untouched here; seeking never applies to the incoming crossfade track
    ///
    /// also rewrites target_frame
    /// DecisionThread::position_frames() is just clock_now - target_frame, a shortcut
    /// that's only correct if the decoder has been playing continuously since target_frame
    /// a seek breaks that invariant the moment the decode head jumps: position_frames()
    /// would keep reporting wall-clock time elapsed since the track was scheduled,
    /// completely blind to where playback actually is now
    /// left unfixed, that desyncs tick()'s remaining = duration_frames - position from
    /// reality after any seek => on a forward seek specifically, position_frames()
    /// under-reports, so remaining never drops into the crossfade window before the
    /// decoder's own real TrackFinished fires, and the auto-crossfade silently never
    /// triggers for the rest of that track's playback
    /// re-deriving target_frame from the current clock and the new seek position restores
    /// the invariant: clock_now - target_frame == seek position again, exactly as if the
    /// track had been playing from that position all along
    pub fn seek(&mut self, position_fraction: f64) -> Result<(), String> {
        let info = self.current_info.as_mut().ok_or("No track loaded")?;

        let Some(current) = self.decision.current() else {
            self.pending_seek_fraction = Some(position_fraction.clamp(0.0, 1.0));
            return Ok(());
        };

        let duration = info.duration.ok_or("Track duration unknown")?;
        let pos = Duration::from_secs_f64(duration.as_secs_f64() * position_fraction.clamp(0.0, 1.0));

        let _ = current.handle.seek_tx.send(pos);

        let seek_frames = (pos.as_secs_f64() * self.device_sample_rate.get() as f64).round() as u64;
        let clock_now = self.gated_clock.now();
        current
            .handle
            .target_frame
            .store(clock_now.saturating_sub(seek_frames), Ordering::Release);

        // seek() just re-anchored target_frame to "clock_now - seek_frames"
        // i.e. exactly the position playback would be at if it resumed this instant
        // if we're currently paused, that anchor is now current as of clock_now, not as of
        // the original pause() call
        // left unrefreshed, resume()'s shift_forward(elapsed-since-original-pause) would add
        // the entire pre-seek pause duration on top of a target_frame that's already correct
        // as of this moment, double-counting it and leaving position/crossfade timing wrong
        // for the rest of the track
        // refreshing paused_at here makes resume() only ever compensate for time paused after
        // the most recent thing that re-anchored target_frame, whichever of pause()/seek() that was
        if self.paused_flag.load(Ordering::Relaxed) {
            self.paused_at = Some(clock_now);
        }

        info.offset = pos;
        info.started = Instant::now();
        Ok(())
    }

    /// pauses both gated slots, not just current
    /// mid-crossfade there can be two live sources summed by the mixer simultaneously
    /// (outgoing fading out, incoming fading in), and both must freeze together or the pause
    /// produces a lopsided mix instead of clean silence
    /// next's pause is harmless even when it hasn't started yet: a still-UNSCHEDULED
    /// GatedSource is already silent, and paused gating takes priority over the
    /// target-frame check either way (see gated.rs), so this never causes it to start early or skip ahead
    pub fn pause(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.offset = Duration::from_secs_f64(info.position_secs());
            info.started = Instant::now();
        }
        self.paused_flag.store(true, Ordering::Relaxed);
        self.paused_at = Some(self.gated_clock.now());

        if let Some(slot) = self.decision.current() {
            slot.handle.set_paused(true);
        }
        if let Some(slot) = self.decision.next_slot() {
            slot.handle.set_paused(true);
        }
    }

    /// mirrors pause(), resumes both slots together for the same mid-crossfade reason
    /// also compensates both slots' scheduled frames for however long the pause lasted
    /// (see paused_at/shift_forward()'s doc comments)
    /// without this, DecisionThread::tick()'s remaining = duration_frames -
    /// position_frames(clock.now()) would count the entire pause as if it had been played,
    /// since the shared clock keeps advancing throughout a pause regardless (a paused
    /// GatedSource still emits silent frames, see gated.rs)
    /// left unfixed, a long enough pause makes remaining fall inside the crossfade window
    /// purely from wall-clock time passing, firing an auto-crossfade into the next track
    /// while the user still has the current one paused
    pub fn resume(&mut self) {
        if let Some(ref mut info) = self.current_info {
            info.started = Instant::now();
        }
        self.paused_flag.store(false, Ordering::Relaxed);

        if let Some(paused_at) = self.paused_at.take() {
            let elapsed = self.gated_clock.now().saturating_sub(paused_at);
            if let Some(slot) = self.decision.current() {
                slot.handle.shift_forward(elapsed);
            }
            if let Some(slot) = self.decision.next_slot() {
                slot.handle.shift_forward(elapsed);
            }
        }

        if let Some(slot) = self.decision.current() {
            slot.handle.set_paused(false);
        }
        if let Some(slot) = self.decision.next_slot() {
            slot.handle.set_paused(false);
        }
    }

    /// stops both gated slots
    /// there is no API to remove a source from rodio::mixer::Mixer once .add()ed
    /// (see dual_track.rs/gated.rs module docs), so this
    /// (1) sends Duration::MAX down each handle's seek_tx, the same sentinel
    /// SymphoniaSource already treats as "stop decoding, return None forever"
    /// (see symphonia.rs's seek_rx.try_recv() handling), so CPU work actually stops
    /// (2) re-gates target_frame back to UNSCHEDULED as a defensive belt-and-suspenders measure
    pub fn stop(&mut self) {
        self.current_info = None;
        self.paused_flag.store(false, Ordering::Relaxed);
        self.paused_at = None;

        let (old_current, old_next) = self.decision.clear();
        for slot in old_current.into_iter().chain(old_next) {
            let _ = slot.handle.seek_tx.send(Duration::MAX);
            slot.handle.target_frame.store(UNSCHEDULED, Ordering::Release);
        }

        self.play_abort.store(true, Ordering::Relaxed);
        self.preload_abort.store(true, Ordering::Relaxed);
        self.play_abort = Arc::new(AtomicBool::new(false));
        self.preload_abort = Arc::new(AtomicBool::new(false));

        self.current_generation = u64::MAX;
        // 0 is never a real generation (generation_counter is pre-incremented before use)
        // so this can't accidentally match a genuinely in-flight preload result
        self.gated_preload_generation = 0;

        self.pending_track_advanced = false;
        self.pending_seek = None;
        self.pending_seek_fraction = None;
        self.pending_paused = false;

        tracing::info!("[AUDIO] Stopped");
    }

    pub fn set_volume(&mut self, v: f32) {
        let clamped = v.clamp(0.0, 1.0);
        self.volume = clamped;
        self.volume_atomic.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn set_eq(&mut self, settings: &EqSettings) {
        self.eq_settings = settings.clone();
        let _ = self.eq_tx.send(settings.clone());
    }

    pub fn set_replay_gain_enabled(&mut self, enabled: bool) {
        self.replay_gain_enabled.store(enabled, Ordering::Relaxed);
        tracing::info!("[AUDIO] Replay gain enabled: {}", enabled);
    }

    pub fn set_limiter_enabled(&mut self, enabled: bool) {
        self.limiter_enabled.store(enabled, Ordering::Relaxed);
        tracing::info!("[AUDIO] Limiter enabled: {}", enabled);
    }

    /// re-enters the gated pipeline (dispatch_gated_open + decision), the
    /// highest-blast-radius method since it rebuilds the whole engine, so it's landed last,
    /// after every other path (play/preload/skip/crossfade/seek/pause) was already proven
    /// against the gated pipeline individually
    /// position-snapshot/pending-paused semantics preserved: initial_seek is still
    /// threaded through to SymphoniaSource::seek() before the new decode is ever pulled
    /// (see dual_track.rs::open_gated_track), and pending_paused is still honored by
    /// worker.rs's gated_open_result_rx is_play arm
    pub fn set_output_device(
        &mut self,
        device_name: Option<String>,
        event_rx_slot: &mut Receiver<AudioEvent>,
        gated_open_result_rx_slot: &mut Receiver<GatedOpenResult>,
    ) -> Result<DeviceList, String> {
        let old_sample_rate = self.device_sample_rate.get() as f64;
        let old_now = self.gated_clock.now();

        tracing::info!(
            "[AUDIO] set_output_device: entry — old_sample_rate={}, old_now={}, fading_out={}, decision.current={}",
            old_sample_rate as u64, old_now,
            self.fading_out.is_some(),
            self.decision.current().is_some(),
        );
        if let Some(out_slot) = self.fading_out.as_ref() {
            let fade_out_at = out_slot.handle.fade_out_at();
            let fade_out_frames = out_slot.handle.fade_out_frames();
            tracing::info!(
                "[AUDIO] set_output_device: fading_out present — path='{}', fade_out_at={}, fade_out_frames={}, \
                 elapsed={} (UNSCHEDULED={})",
                out_slot.handle.path, fade_out_at, fade_out_frames,
                old_now.saturating_sub(fade_out_at), UNSCHEDULED,
            );
        }

        // case B: is fading_out still actually audible right now, not just a stale slot
        // from a crossfade that finished minutes ago
        // fade_out_at()/fade_out_frames() are the same atomics GatedSource::next()
        // itself reads every render pull, so this is exactly the condition that decides
        // whether the mixer is still summing two live sources
        // requires decision.current() too, that's the incoming half of the same crossfade,
        // promoted there the instant the fade fired (see directive.rs's doc comment on how
        // fast promotion follows firing); without it there's nothing to reconstruct the "in"
        // track from, so fall through to the normal single-track snapshot path below instead
        let mid_crossfade = self.fading_out.as_ref().and_then(|out_slot| {
            let fade_out_at = out_slot.handle.fade_out_at();
            let fade_out_frames = out_slot.handle.fade_out_frames();
            if fade_out_at == UNSCHEDULED {
                tracing::info!("[AUDIO] set_output_device: mid_crossfade = None (fade_out_at UNSCHEDULED)");
                return None;
            }
            let elapsed = old_now.saturating_sub(fade_out_at);
            if elapsed >= fade_out_frames {
                tracing::info!(
                    "[AUDIO] set_output_device: mid_crossfade = None (stale — elapsed={} >= fade_out_frames={})",
                    elapsed, fade_out_frames
                );
                return None;
            }
            let in_slot = match self.decision.current() {
                Some(s) => s,
                None => {
                    tracing::warn!("[AUDIO] set_output_device: mid_crossfade = None (fading_out present but decision.current() is None!)");
                    return None;
                }
            };
            let out_pos = old_now.saturating_sub(out_slot.handle.target_frame());
            let in_pos = old_now.saturating_sub(in_slot.handle.target_frame());
            tracing::info!(
                "[AUDIO] set_output_device: mid_crossfade = Some — out='{}' pos_frames={}, in='{}' pos_frames={}, \
                 fade_elapsed_frames={}, fade_total_frames={}",
                out_slot.handle.path, out_pos, in_slot.handle.path, in_pos, elapsed, fade_out_frames
            );
            Some((
                out_slot.handle.path.clone(),
                out_pos,
                in_slot.handle.path.clone(),
                in_pos,
                elapsed,
                fade_out_frames,
            ))
        });

        // case A: the normal single-track snapshot, skipped entirely when mid_crossfade
        // above already found something, since that branch reconstructs current_info
        // itself from the incoming track's own path/position instead
        let snapshot = if mid_crossfade.is_some() {
            None
        } else {
            self.current_info.as_ref().map(|info| {
                (info.path.clone(), Duration::from_secs_f64(info.position_secs()))
            })
        };
        let was_paused = self.paused_flag.load(Ordering::Relaxed);
        let volume = self.volume;
        let repeat_one = self.repeat_one;
        let replay_gain_enabled = self.replay_gain_enabled.load(Ordering::Relaxed);
        let limiter_enabled = self.limiter_enabled.load(Ordering::Relaxed);
        let eq_settings = self.eq_settings.clone();
        // AudioEngine::new() always constructs a fresh DecisionThread with crossfade_seconds
        // hardcoded to 0 (disabled), nothing about a device switch carries the live setting
        // over on its own, so without this a switch silently disables crossfade until
        // something else calls set_crossfade_seconds() again (e.g. nudging the settings
        // slider, which is exactly the workaround this bug produced)
        let crossfade_seconds = self.decision.crossfade_seconds_handle().load(Ordering::Acquire);

        // captured before decision.clear() below discards it, decision.next_slot() is the
        // only source of truth for "was something actually preloaded"
        // replay gain travels with it so the re-preload dispatched below on new_engine
        // doesn't silently drop the adjustment (engine.rs has no other record of it,
        // preload()'s normal caller sources it fresh from library metadata each time, which
        // isn't available from inside a device switch)
        // mid-crossfade this is naturally None, next_slot() was already consumed by the
        // promotion that populated fading_out/decision.current() in the first place, so
        // there's nothing dangling to re-preload here; that's handled below instead
        let discarded_preload = self.decision.next_slot()
            .map(|slot| (slot.handle.path.clone(), slot.handle.replay_gain_db()));

        // stop the old device's gated decode threads, this AudioEngine instance is about to
        // be replaced wholesale by *self = new_engine below regardless, but without this
        // their SymphoniaSource loops would keep decoding in the background indefinitely
        // (same Duration::MAX-sentinel mechanism stop() uses, see its own doc comment)
        // fading_out's decode thread is just as live as old_current/old_next's and needs
        // the same treatment => mid_crossfade above already read everything it needed off
        // the handle before this
        let (old_current, old_next) = self.decision.clear();
        for slot in old_current.into_iter().chain(old_next).chain(self.fading_out.take()) {
            let _ = slot.handle.seek_tx.send(Duration::MAX);
        }

        let (mut new_engine, new_event_rx, new_gated_open_result_rx, new_device_list) =
            AudioEngine::new(&eq_settings, device_name)?;

        tracing::info!(
            "[AUDIO] set_output_device: new engine built — new_sample_rate={}, old_sample_rate={}, \
             mid_crossfade_branch={}, snapshot_present={}, crossfade_seconds={}",
            new_engine.device_sample_rate.get(), old_sample_rate as u64,
            mid_crossfade.is_some(), snapshot.is_some(), crossfade_seconds,
        );

        new_engine.set_volume(volume);
        new_engine.replay_gain_enabled.store(replay_gain_enabled, Ordering::Relaxed);
        new_engine.limiter_enabled.store(limiter_enabled, Ordering::Relaxed);
        new_engine.repeat_one = repeat_one;
        new_engine.set_crossfade_seconds(crossfade_seconds);

        if let Some((out_path, out_pos_frames, in_path, in_pos_frames, fade_elapsed_frames, fade_total_frames)) = mid_crossfade {
            new_engine.pending_track_advanced = false;
            new_engine.pending_seek = None;
            new_engine.pending_seek_fraction = None;
            new_engine.pending_paused = false;
            new_engine.paused_flag.store(false, Ordering::Relaxed);

            // frame counts were read off the old clock/sample rate
            // re-express as 'Duration' (sample-rate-independent) so they're meaningful
            // against whatever the new device's device_sample_rate turns out to be
            let out_position = Duration::from_secs_f64(out_pos_frames as f64 / old_sample_rate);
            let in_position = Duration::from_secs_f64(in_pos_frames as f64 / old_sample_rate);
            let fade_elapsed = Duration::from_secs_f64(fade_elapsed_frames as f64 / old_sample_rate);
            let fade_total = Duration::from_secs_f64(fade_total_frames as f64 / old_sample_rate);

            new_engine.current_info = Some(TrackInfo {
                path: in_path.clone(),
                duration: None,
                started: Instant::now(),
                offset: in_position,
            });

            let abort = Arc::new(AtomicBool::new(false));
            new_engine.play_abort = Arc::clone(&abort);
            // deliberately a separate flag from play_abort
            // (see the identical fix in the snapshot branch below for why aliasing them is a real bug)
            // harmless here in practice since case b never calls preload() afterward, but
            // kept unshared for consistency
            new_engine.preload_abort = Arc::new(AtomicBool::new(false));

            // both opens dispatched concurrently
            // worker.rs's gated_open_result_rx arm matches each against pending_fade_resume
            // (checked before the normal is_play/is_preload logic, since in_gen below is
            // also current_generation and would otherwise be treated as a plain hard-cut resume)
            // and reconstructs each side's fade envelope independently as its own result
            // arrives, in whichever order that happens
            let out_gen = new_engine.dispatch_gated_open(&out_path, None, Arc::clone(&abort), Some(out_position));
            let in_gen = new_engine.dispatch_gated_open(&in_path, None, abort, Some(in_position));
            new_engine.current_generation = in_gen;
            new_engine.pending_paused = was_paused;
            new_engine.pending_fade_resume = Some(PendingFadeResume {
                out_generation: Some(out_gen),
                in_generation: Some(in_gen),
                fade_elapsed,
                fade_total,
            });

            tracing::info!(
                "[AUDIO] Device switch: resuming mid-crossfade — out '{}' @{:.3}s, in '{}' @{:.3}s, \
                 fade {:.2}s/{:.2}s (gens {}/{})",
                out_path, out_position.as_secs_f64(), in_path, in_position.as_secs_f64(),
                fade_elapsed.as_secs_f64(), fade_total.as_secs_f64(), out_gen, in_gen
            );
        } else if let Some((path, position)) = snapshot {
            new_engine.pending_track_advanced = false;
            new_engine.pending_seek = None;
            new_engine.pending_seek_fraction = None;
            new_engine.pending_paused = false;
            new_engine.paused_flag.store(false, Ordering::Relaxed);

            new_engine.current_info = Some(TrackInfo {
                path: path.clone(),
                duration: None,
                started: Instant::now(),
                offset: position,
            });

            let abort = Arc::new(AtomicBool::new(false));
            new_engine.play_abort = Arc::clone(&abort);
            // not the same Arc as play_abort, this was the actual bug (see the diagnostic
            // log trace: switching devices with something preloaded went silent, and
            // re-adjusting the crossfade slider afterward "fixed" it)
            // preload(), called a few lines below via the discarded_preload re-dispatch,
            // does self.preload_abort.store(true, ...) to cancel whatever previous preload
            // task it's superseding
            // when preload_abort and play_abort alias the same AtomicBool, that store also
            // silently aborts this resume dispatch's still-in-flight decode => the gated
            // worker never sends a result for it, decision.current() never gets populated,
            // and with it every downstream auto-crossfade tick has nothing to fire against
            // until something else (unrelated) forces a fresh play() with its own unshared abort flag
            new_engine.preload_abort = Arc::new(AtomicBool::new(false));

            // worker.rs's gated_open_result_rx is_play arm calls handle.schedule_now on a
            // matching-generation result, so this only makes current_generation match, so
            // that arm recognizes the result as "play"
            let generation = new_engine.dispatch_gated_open(&path, None, abort, Some(position));
            new_engine.current_generation = generation;
            new_engine.pending_paused = was_paused;

            tracing::info!(
                "[AUDIO] Device switch: resuming '{}' at {:.3}s via gated pipeline (gen {})",
                path, position.as_secs_f64(), generation
            );
        } else {
            tracing::warn!(
                "[AUDIO] set_output_device: neither mid_crossfade nor snapshot present — nothing \
                 to resume (was current_info None, i.e. nothing was playing before the switch?)"
            );
        }

        *event_rx_slot = new_event_rx;
        *gated_open_result_rx_slot = new_gated_open_result_rx;

        // re-dispatch the discarded preload against the new device
        // without this, the gated pipeline's 'next' slot stays empty for the rest of the (resumed) current track
        if let Some((path, replay_gain_db)) = discarded_preload {
            tracing::info!("[AUDIO] Device switch: re-preloading: {}", path);
            if let Err(e) = new_engine.preload(&path, replay_gain_db, 0) {
                tracing::warn!("[AUDIO] Device switch: re-preload failed for {}: {}", path, e);
            }
        }

        *self = new_engine;

        tracing::info!("[AUDIO] Output device switched successfully");
        Ok(new_device_list)
    }

    pub fn set_repeat_one(&mut self, enabled: bool) {
        self.repeat_one = enabled;
        if let Some(slot) = self.decision.current() {
            let _ = slot.handle.repeat_one_tx.send(enabled);
        }
    }

    /// now also forwards to decision's shared atomic
    /// maybe_auto_crossfade below reads only that (via DecisionThread::tick), so this write
    /// is what makes a live SetCrossfadeSeconds command take effect on the very next tick
    pub fn set_crossfade_seconds(&mut self, secs: u32) {
        self.decision.set_crossfade_seconds(secs);
        tracing::info!("[AUDIO] Crossfade set to {}s", secs);
    }

    /// manual "skip to next" / user-triggered crossfade, routed through the gated pipeline's DecisionThread
    /// this function's only job is: should the next track start playing right now
    /// promoting 'next' to 'current' and emitting TrackAdvanced is
    /// directive::poll_completed_transition's job, called from worker.rs right after this
    pub fn trigger_crossfade(&mut self) {
        if !self.decision.trigger_manual() {
            tracing::warn!(
                "[AUDIO] trigger_crossfade: nothing preloaded on the gated pipeline yet (preload gen {})",
                self.gated_preload_generation
            );
            return;
        }
        // trigger_manual just wrote a fresh target_frame/fade_out_at anchored to clock.now
        // if we're paused, that anchor is current as of right now, so resume() must only
        // compensate for pause time after this point, not the whole original pause
        // see seek()'s doc comment on why skipping this double-counts the pre-trigger pause duration
        if self.paused_flag.load(Ordering::Relaxed) {
            self.paused_at = Some(self.gated_clock.now());
        }
        tracing::info!("[AUDIO] Crossfade triggered via gated pipeline (decision.trigger_manual)");
    }

    /// called on the same periodic tick as before (worker.rs's 100ms crossfade_tick), but
    /// the decision of "is it time" lives entirely in DecisionThread::tick(), real
    /// frame-accurate position against the shared clock
    /// this function is now just the wire between the tick and that decision; see
    /// decision.rs's module docs for why the auto and manual paths are the same primitive underneath
    ///
    /// guards on repeat_one before ever calling decision.tick()
    /// DecisionThread has no notion of repeat-one at all, it only ever looks at current's
    /// decoded duration_frames vs. position, so with repeat-one on and any track preloaded
    /// as next (the frontend preloads the actual next queue track unconditionally,
    /// regardless of repeat mode, see _schedulePreload in playback.ts), tick() would fire
    /// an automatic crossfade away from the looping track once position entered the
    /// crossfade window, defeating repeat-one entirely
    /// repeat-one's own looping is handled independently and invisibly to this pipeline,
    /// entirely inside SymphoniaSource (seeks back to 0 in place, same decode source,
    /// never emits TrackFinished, see symphonia.rs), so the correct fix is simply: don't
    /// ask DecisionThread to consider crossfading at all while repeat-one is active
    /// a manual trigger_crossfade() (explicit user skip) is deliberately not guarded here,
    /// repeat-one shouldn't block a user-initiated "skip to next"
    pub fn maybe_auto_crossfade(&mut self) {
        if !should_attempt_auto_crossfade(self.repeat_one) {
            return;
        }
        // belt and suspenders alongside the shift_forward compensation in resume()
        // even if some path re-pauses without going through pause()/resume()
        // (e.g. a device switch's pending_paused restore),
        // a live pause must never let tick() see clock-time-elapsed as if it were audio-played
        if self.paused_flag.load(Ordering::Relaxed) {
            return;
        }
        self.decision.tick();
    }
}

/// pure decision extracted from maybe_auto_crossfade purely for testability
/// AudioEngine itself can't be constructed in a unit test without a real cpal output device,
/// so the one piece of actual logic in that function (the repeat-one guard) is isolated here
/// where it can be exercised directly
fn should_attempt_auto_crossfade(repeat_one: bool) -> bool {
    !repeat_one
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_crossfade_is_suppressed_while_repeat_one_is_active() {
        assert!(
            !should_attempt_auto_crossfade(true),
            "repeat-one must suppress the automatic tick — see maybe_auto_crossfade()'s own doc \
             comment for why (DecisionThread has no idea repeat-one exists)"
        );
    }

    #[test]
    fn auto_crossfade_proceeds_normally_when_repeat_one_is_off() {
        assert!(
            should_attempt_auto_crossfade(false),
            "the overwhelming majority case — repeat-one off must not block anything"
        );
    }

    #[test]
    fn position_secs_clamps_to_known_duration() {
        // TrackInfo::position_secs is read by seek()'s live-position math, pause()'s
        // offset-snapshot, and set_output_device()'s device-switch snapshot
        // a position that overshoots a known duration (e.g. wall-clock elapsed briefly
        // outracing the last reported decode duration right at a track's tail) would
        // corrupt all three, confirms the min() clamp actually holds
        let info = TrackInfo {
            path: "test.mp3".to_string(),
            duration: Some(Duration::from_secs(10)),
            // way past the track's own end
            started: Instant::now() - Duration::from_secs(50),
            offset: Duration::ZERO,
        };
        assert_eq!(
            info.position_secs(), 10.0,
            "position must never exceed the track's own known duration"
        );
    }

    #[test]
    fn position_secs_without_a_known_duration_is_unclamped() {
        // before a track's real decoded duration has arrived (early in play()/preload(),
        // duration: None until the gated_open_result_rx arm fills it in), position_secs has
        // nothing to clamp against and must just report elapsed time as-is rather than panicking
        let info = TrackInfo {
            path: "test.mp3".to_string(),
            duration: None,
            started: Instant::now() - Duration::from_millis(250),
            offset: Duration::from_secs(1),
        };
        let pos = info.position_secs();
        assert!(
            pos >= 1.2 && pos < 2.0,
            "expected roughly offset(1.0s) + elapsed(~0.25s) with no clamping, got {}",
            pos
        );
    }

    #[test]
    fn position_secs_includes_offset_from_a_prior_seek_or_resume() {
        // offset is what seek()/resume() snapshot into before resetting 'started'
        // confirms the two compose correctly
        // (this is the same formula pause()/seek() rely on to report a stable position
        // across multiple seeks within one play-through)
        let info = TrackInfo {
            path: "test.mp3".to_string(),
            duration: Some(Duration::from_secs(300)),
            started: Instant::now() - Duration::from_secs(3),
            offset: Duration::from_secs(30),
        };
        let pos = info.position_secs();
        assert!(
            pos >= 32.5 && pos < 34.0,
            "expected roughly offset(30s) + elapsed(~3s), got {}",
            pos
        );
    }
}
