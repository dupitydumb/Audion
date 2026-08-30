use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use crossbeam::channel::{unbounded, Receiver, Sender};
use tauri::Emitter;

use super::dsp::EqSettings;
use super::mod_types::{AudioEvent, DeviceList};
use super::engine::{AudioEngine, TrackInfo};
// gated_open_result_rx (GatedOpenResult) is the only open-result channel selected on in the command loop below
use super::gated_worker::GatedOpenResult;
use super::decision::TrackSlot;
use super::directive;


pub enum AudioCommand {
    Play(String, Option<f32>),
    Preload(String, Option<f32>, u32),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    SetEq(EqSettings),
    SetRepeatOne(bool),
    SetReplayGainEnabled(bool),
    SetLimiterEnabled(bool),
    SetOutputDevice(Option<String>),
    SetCrossfadeSeconds(u32),
    TriggerCrossfade,
}

pub struct PlaybackStateSync {
    command_tx: Sender<AudioCommand>,
    pub device_list: Arc<Mutex<DeviceList>>,
}

impl PlaybackStateSync {
    /// player_event_tx receives a copy of every AudioEvent originally only meant for the fronted
    /// this is how player.rs's actor learns about TrackAdvanced/TrackFinished
    pub fn new(app_handle: tauri::AppHandle, player_event_tx: Sender<AudioEvent>) -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();
        let device_list = Arc::new(Mutex::new(DeviceList {
            devices: Vec::new(),
        }));

        let device_list_clone = Arc::clone(&device_list);

        std::thread::spawn(move || {
            // retry a bounded number of times with fresh engine state
            const MAX_RESTARTS: u32 = 5;
            let mut restarts = 0u32;

            'restart: loop {
            let mut engine_opt: Option<AudioEngine> = None;
            let mut eq_settings = EqSettings::default();

            let mut event_rx: Receiver<AudioEvent> = crossbeam::channel::never();
            // carries both play()- and preload()-generation results from the gated pipeline
            // the is_play / is_preload cases
            let mut gated_open_result_rx: Receiver<GatedOpenResult> = crossbeam::channel::never();

            let emit = |evt: AudioEvent| {
                use tauri::Emitter;
                let _ = player_event_tx.send(evt.clone());
                if let Err(e) = app_handle.emit("audio://event", &evt) {
                    tracing::warn!("[AUDIO] Failed to emit event: {}", e);
                }
            };

            // polls DecisionThread for a completed crossfade/skip transition
            // and if one is found, reconciles AudioEngine's own current_generation/current_info
            // with the newly promoted "current" slot before emitting the TrackAdvanced event
            // directive::poll_completed_transition only owns the DecisionThread-internal
            // promotion + event construction
            // AudioEngine's own bookkeeping (used by seek(),
            // the gated_open_result_rx generation matching arms, etc.) has to be kept in sync here
            // at the one call site all three trigger paths (tick, manual, natural end gapless handoff) funnel through
            let poll_and_apply = |engine: &mut AudioEngine, emit: &dyn Fn(AudioEvent)| {
                // _with_outgoing variant (see directive.rs)
                // so the promoted away outgoing slot gets kept in engine.fading_out
                // instead of dropped
                // a mid-crossfade device switch (set_output_device's case B) needs it to still be there
                if let Some((evt, outgoing)) =
                    directive::poll_completed_transition_with_outgoing(&mut engine.decision)
                {
                    if let AudioEvent::TrackAdvanced { generation, ref new_path, duration } = evt {
                        engine.current_generation = generation;
                        engine.current_info = Some(TrackInfo {
                            path: new_path.clone(),
                            duration,
                            started: Instant::now(),
                            offset: Duration::ZERO,
                        });
                    }
                    engine.fading_out = outgoing;
                    emit(evt);
                }
            };

            // drives AudioEngine::maybe_auto_crossfade
            // 100ms is cheap enough to run unconditionally even when nothing is playing
            let crossfade_tick = crossbeam::channel::tick(std::time::Duration::from_millis(100));

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { loop {
                crossbeam::select! {
                    recv(crossfade_tick) -> _ => {
                        if let Some(engine) = engine_opt.as_mut() {
                            engine.maybe_auto_crossfade();
                            // the tick may just have caused DecisionThread to fire an auto-crossfade
                            // poll once to see if that fire has ALSO become live on the shared clock
                            // has_fired() alone isn't enough (see directive.rs's doc comment)
                            // if so, promote next=>current and emit TrackAdvanced
                            poll_and_apply(engine, &emit);
                        }
                    }

                    recv(rx) -> msg => {
                        let cmd = match msg {
                            Ok(c) => c,
                            Err(_) => break,
                        };

                        if engine_opt.is_none() {
                            let mut last_err = String::new();
                            for attempt in 0..8u32 {
                                match AudioEngine::new(&eq_settings, None) {
                                    Ok((e, evt_rx, gated_open_rx, dl)) => {
                                        event_rx = evt_rx;
                                        gated_open_result_rx = gated_open_rx;
                                        engine_opt = Some(e);
                                        if let Ok(mut cached) = device_list_clone.lock() {
                                            *cached = dl;
                                        }
                                        last_err.clear();
                                        break;
                                    }
                                    Err(e) => {
                                        tracing::warn!("[AUDIO] Engine init attempt {} failed: {}", attempt + 1, e);
                                        last_err = e;
                                        std::thread::sleep(std::time::Duration::from_millis(250 * (1u64 << attempt.min(4))));
                                    }
                                }
                            }
                            if !last_err.is_empty() {
                                tracing::error!("[AUDIO] Engine init failed after retries: {}", last_err);
                                emit(AudioEvent::Error { message: last_err });
                                continue;
                            }
                        }

                        let engine = engine_opt.as_mut().unwrap();

                        match cmd {
                            AudioCommand::Play(path, rg) => {
                                engine.play(&path, rg);
                            }
                            AudioCommand::Preload(path, rg, crossfade_seconds) => {
                                if let Err(e) = engine.preload(&path, rg, crossfade_seconds) {
                                    tracing::warn!("[AUDIO] preload error: {}", e);
                                }
                            }
                            AudioCommand::Pause => engine.pause(),
                            AudioCommand::Resume => engine.resume(),
                            AudioCommand::Stop => engine.stop(),
                            AudioCommand::Seek(f) => {
                                if let Err(e) = engine.seek(f) {
                                    tracing::warn!("[AUDIO] seek error: {}", e);
                                }
                            }
                            AudioCommand::SetVolume(v) => engine.set_volume(v),
                            AudioCommand::SetEq(s) => {
                                eq_settings = s.clone();
                                engine.set_eq(&s);
                            }
                            AudioCommand::SetRepeatOne(v) => engine.set_repeat_one(v),
                            AudioCommand::SetReplayGainEnabled(v) => {
                                engine.set_replay_gain_enabled(v);
                            }
                            AudioCommand::SetLimiterEnabled(v) => {
                                engine.set_limiter_enabled(v);
                            }
                            AudioCommand::SetOutputDevice(name) => {
                                tracing::info!("[AUDIO] SetOutputDevice command received: {:?}", name);
                                match engine.set_output_device(name, &mut event_rx, &mut gated_open_result_rx) {
                                    Ok(new_device_list) => {
                                        if let Ok(mut cached) = device_list_clone.lock() {
                                            *cached = new_device_list.clone();
                                        }
                                        tracing::info!(
                                            "[AUDIO] SetOutputDevice succeeded — current_generation={}, \
                                             gated_preload_generation={}, pending_fade_resume={}, \
                                             current_info_present={}",
                                            engine.current_generation, engine.gated_preload_generation,
                                            engine.pending_fade_resume.is_some(), engine.current_info.is_some(),
                                        );
                                        emit(AudioEvent::DeviceListChanged { devices: new_device_list });
                                    }
                                    Err(e) => {
                                        tracing::error!("[AUDIO] Device switch failed: {}", e);
                                        emit(AudioEvent::Error { message: e });
                                    }
                                }
                            }
                            AudioCommand::SetCrossfadeSeconds(secs) => {
                                engine.set_crossfade_seconds(secs);
                            }
                            AudioCommand::TriggerCrossfade => {
                                engine.trigger_crossfade();
                                // same reasoning as the crossfade_tick arm above
                                // a manual trigger_manual() fire needs the same live-check-then-promote-
                                // then-emit step
                                poll_and_apply(engine, &emit);
                            }
                        }
                    }

                    // results from the gated pipeline's play()/preload() dispatch
                    // there's no queue/seek_tx/repeat_one_tx bookkeeping to do
                    // beyond what's on GatedTrackHandle itself
                    // registering the source on gated_mixer, and scheduling it now (play) or leaving it UNSCHEDULED (preload), is the entire hand-off
                    recv(gated_open_result_rx) -> msg => {
                        let result = match msg {
                            Ok(r) => r,
                            Err(_) => {
                                gated_open_result_rx = crossbeam::channel::never();
                                continue;
                            }
                        };

                        let engine = match engine_opt.as_mut() {
                            Some(e) => e,
                            None => continue,
                        };

                        // mid-crossfade device switch resume (set_output_device's case B):
                        // checked before is_play/is_preload below because in_generation is
                        // also current_generation
                        // (so the incoming track's own decision.rs bookkeeping still works everywhere else)
                        // which would otherwise make the plain is_play arm hard schedule it via schedule_now
                        // instead of the fade-in ramp reconstructed here
                        if let Some(pfr) = engine.pending_fade_resume.as_ref() {
                            tracing::info!(
                                "[AUDIO] gated_open_result gen={} — pending_fade_resume out_gen={:?} in_gen={:?}",
                                result.generation, pfr.out_generation, pfr.in_generation
                            );
                        }
                        if let Some(pfr) = engine.pending_fade_resume.as_mut() {
                            let matched = if pfr.out_generation == Some(result.generation) {
                                Some(false)
                            } else if pfr.in_generation == Some(result.generation) {
                                Some(true)
                            } else {
                                None
                            };

                            if let Some(is_incoming) = matched {
                                let sample_rate = engine.device_sample_rate.get() as f64;
                                let fade_elapsed_frames =
                                    (pfr.fade_elapsed.as_secs_f64() * sample_rate) as u64;
                                let fade_total_frames =
                                    (pfr.fade_total.as_secs_f64() * sample_rate).max(1.0) as u64;

                                if is_incoming {
                                    pfr.in_generation = None;
                                } else {
                                    pfr.out_generation = None;
                                }
                                let resume_done = engine.pending_fade_resume.as_ref()
                                    .is_some_and(|p| p.out_generation.is_none() && p.in_generation.is_none());
                                if resume_done {
                                    engine.pending_fade_resume = None;
                                }

                                match result.result {
                                    Err(e) => {
                                        tracing::error!(
                                            "[AUDIO] gated open error (fade-resume {}): {}",
                                            if is_incoming { "incoming" } else { "outgoing" }, e
                                        );
                                        if is_incoming {
                                            emit(AudioEvent::Error { message: e });
                                            engine.current_info = None;
                                        }
                                    }
                                    Ok((gated_source, handle)) => {
                                        engine.gated_mixer.add(gated_source);
                                        let now = engine.gated_clock.now();
                                        let start = now.saturating_sub(fade_elapsed_frames);

                                        tracing::info!(
                                            "[AUDIO] fade-resume {} Ok: path='{}' now={} fade_elapsed_frames={} \
                                             fade_total_frames={} computed_start={}",
                                            if is_incoming { "incoming" } else { "outgoing" },
                                            handle.path, now, fade_elapsed_frames, fade_total_frames, start,
                                        );

                                        if is_incoming {
                                            handle.schedule_fade_in_at(start, fade_total_frames);

                                            let duration = handle.duration;
                                            if let Some(ref mut info) = engine.current_info {
                                                info.duration = duration;
                                            }

                                            let slot = TrackSlot::new(handle, engine.device_sample_rate.get());
                                            if engine.pending_paused {
                                                engine.pending_paused = false;
                                                slot.handle.set_paused(true);
                                                engine.paused_flag.store(true, Ordering::Relaxed);
                                                engine.paused_at = Some(engine.gated_clock.now());
                                            }
                                            engine.decision.load_current(slot);
                                            tracing::info!(
                                                "[AUDIO] fade-resume incoming: decision.load_current done — \
                                                 decision.current().is_some()={}",
                                                engine.decision.current().is_some()
                                            );
                                        } else {
                                            handle.schedule_at(start);
                                            handle.schedule_fade_out(start, fade_total_frames);
                                            engine.fading_out =
                                                Some(TrackSlot::new(handle, engine.device_sample_rate.get()));
                                        }

                                        tracing::info!(
                                            "[AUDIO] Device switch: {} crossfade track resumed (gen {})",
                                            if is_incoming { "incoming" } else { "outgoing" },
                                            result.generation
                                        );
                                    }
                                }
                                continue;
                            }
                        }

                        let is_play = result.generation == engine.current_generation;
                        let is_preload = result.generation == engine.gated_preload_generation
                            && result.generation != engine.current_generation;

                        if !is_play && !is_preload {
                            tracing::info!(
                                "[AUDIO] Discarding stale gated open result (gen {} — current {}, preload {}, \
                                 pending_fade_resume={})",
                                result.generation, engine.current_generation, engine.gated_preload_generation,
                                engine.pending_fade_resume.is_some(),
                            );
                            continue;
                        }

                        match result.result {
                            Err(e) => {
                                tracing::error!("[AUDIO] gated open error: {}", e);
                                emit(AudioEvent::Error { message: e });
                                if is_play {
                                    engine.current_info = None;
                                }
                                // is_preload: nothing was registered on decision/gated_mixer for this generation
                                // so there's nothing to unwind beyond the error event above
                                // decision.next_slot simply stays whatever it was before this preload was attempted
                            }
                            Ok((gated_source, handle)) => {
                                engine.gated_mixer.add(gated_source);
                                tracing::info!(
                                    "[AUDIO] gated_open_result gen={} Ok — is_play={} is_preload={} path='{}'",
                                    result.generation, is_play, is_preload, handle.path,
                                );

                                if is_play {
                                    // nothing preceded this track through the gated pipeline yet
                                    // so a freshly opened current track just starts playing immediately
                                    // the same primitive schedule_now exists for
                                    handle.schedule_now(&engine.gated_clock);

                                    let duration = handle.duration;
                                    if let Some(ref mut info) = engine.current_info {
                                        info.duration = duration;
                                    }

                                    if engine.pending_track_advanced {
                                        engine.pending_track_advanced = false;
                                        if let Some(ref info) = engine.current_info {
                                            emit(AudioEvent::TrackAdvanced {
                                                generation: engine.current_generation,
                                                new_path: info.path.clone(),
                                                duration: info.duration,
                                            });
                                        }
                                    }

                                    let slot = TrackSlot::new(handle, engine.device_sample_rate.get());

                                    // implement pending_paused
                                    // (set by set_output_device's device-switch snapshot restore,
                                    // or by the natural end deferred preload path below)
                                    // paused_flag is kept in sync too
                                    // since it's what set_output_device itself reads back as
                                    // was_paused on a subsequent switch
                                    if engine.pending_paused {
                                        engine.pending_paused = false;
                                        slot.handle.set_paused(true);
                                        engine.paused_flag.store(true, Ordering::Relaxed);
                                        engine.paused_at = Some(engine.gated_clock.now());
                                    }

                                    engine.decision.load_current(slot);

                                    tracing::info!(
                                        "[AUDIO] Gated source ready and scheduled (gen {}), duration={:?}",
                                        result.generation, duration
                                    );
                                } else {
                                    // is_preload: registered on the mixer above, but left UNSCHEDULED 
                                    // (schedule_now not called)
                                    // silent until decision.trigger_manual()/tick() writes a real target frame into it
                                    // decision.next_slot is the state to check if something is preloaded
                                    let duration = handle.duration;
                                    let slot = TrackSlot::new(handle, engine.device_sample_rate.get());
                                    engine.decision.load_next(slot);

                                    // defensive :
                                    // trigger_manual()/tick() both already bail when next.is_none()
                                    // so nothing can have fired without a next slot already present before this load_next call
                                    // included anyway for polling after every state changing DecisionThread call
                                    // not just the two that are currently known to matter
                                    // so a future change to that bail out logic doesn't reopen a missed emission gap here
                                    poll_and_apply(engine, &emit);

                                    tracing::debug!(
                                        "[AUDIO] Gated preload ready and registered (gen {}), duration={:?}",
                                        result.generation, duration
                                    );
                                }
                            }
                        }
                    }

                    recv(event_rx) -> msg => {
                        match msg {
                            Ok(evt) => {
                                let engine = match engine_opt.as_mut() {
                                    Some(e) => e,
                                    None => { emit(evt); continue; }
                                };

                                match evt {
                                    AudioEvent::TrackFinished { generation } => {
                                        if generation != engine.current_generation {
                                            tracing::debug!(
                                                "[AUDIO] Discarding stale TrackFinished \
                                                 (gen {} != current {})",
                                                generation, engine.current_generation
                                            );
                                            continue;
                                        }

                                        match directive::decide_natural_end_action(
                                            engine.decision.next_slot().is_some(),
                                            engine.gated_preload_generation,
                                        ) {
                                            directive::NaturalEndAction::GaplessHandoff => {
                                                // gapless hand-off into the already decoded, preloaded next track
                                                // if a crossfade/skip had already fired for this transition
                                                // has_fired is already true and trigger_manualbelow is skipped
                                                // poll_and_apply just observes the already fired state
                                                if !engine.decision.has_fired() {
                                                    engine.decision.trigger_manual();
                                                }
                                                poll_and_apply(engine, &emit);
                                            }
                                            directive::NaturalEndAction::DeferToInFlightPreload => {
                                                // a preload is in flight but hasn't finished decoding yet
                                                // nothing to gaplessly hand off to right now
                                                // adopt its generation as "current"
                                                // so the gated_open_result_rx arm's is_play branch recognizes the eventual result as this pending transition 
                                                // and defer the TrackAdvanced emission
                                                // until that result actually arrives
                                                tracing::debug!(
                                                    "[AUDIO] TrackFinished but preload worker still in flight \
                                                     (gen {}), waiting for result",
                                                    engine.gated_preload_generation
                                                );
                                                engine.current_generation = engine.gated_preload_generation;
                                                engine.current_info = None;
                                                engine.pending_track_advanced = true;
                                            }
                                            directive::NaturalEndAction::PlainFinish => {
                                                engine.current_info = None;
                                                emit(AudioEvent::TrackFinished { generation });
                                            }
                                        }
                                    }

                                    AudioEvent::StateChanged { position } if position == 0.0 => {
                                        if let Some(ref mut info) = engine.current_info {
                                            info.offset = Duration::ZERO;
                                            info.started = Instant::now();
                                        }
                                        emit(AudioEvent::StateChanged { position });
                                    }

                                    other => emit(other),
                                }
                            }
                            Err(_) => {
                                event_rx = crossbeam::channel::never();
                            }
                        }
                    }
                }
            }})); // closes: loop, AssertUnwindSafe closure, catch_unwind

            match result {
                // rx disconnected (app shutting down) or an explicit break: exit for real.
                Ok(()) => break 'restart,
                Err(payload) => {
                    let msg = payload
                        .downcast_ref::<&str>()
                        .copied()
                        .or_else(|| payload.downcast_ref::<String>().map(|s| s.as_str()))
                        .unwrap_or("(non-string panic payload)");
                    tracing::error!("[AUDIO] Command thread panicked: {}", msg);

                    restarts += 1;
                    if restarts > MAX_RESTARTS {
                        tracing::error!(
                            "[AUDIO] Command thread panicked {} times, giving up",
                            restarts
                        );
                        if let Err(e) = app_handle.emit("audio://event", &AudioEvent::Error {
                            message: format!(
                                "Audio engine crashed repeatedly and could not recover: {}",
                                msg
                            ),
                        }) {
                            tracing::warn!("[AUDIO] Failed to emit panic error event: {}", e);
                        }
                        break 'restart;
                    }

                    if let Err(e) = app_handle.emit("audio://event", &AudioEvent::Error {
                        message: format!("Audio engine crashed, recovering: {}", msg),
                    }) {
                        tracing::warn!("[AUDIO] Failed to emit panic error event: {}", e);
                    }
                    // loop back around and rebuild engine_opt/event_rx from scratch
                }
            }
            } // restart loop
        });

        Self {
            command_tx: tx,
            device_list,
        }
    }

    pub fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.command_tx.send(cmd).map_err(|e| e.to_string())
    }
}
