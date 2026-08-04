// Backend initialization, cleanup, and ticker orchestration
import { get } from 'svelte/store';
import {
    activeBackend, isPlaying, currentTrack, currentTime, duration, volume,
    shuffle, repeat, queue, queueIndex,
    sliderToAudioVolume, pluginEvents,
} from './stores';
import { appSettings } from '$lib/stores/settings';
import { equalizer, toNativeBands } from '$lib/stores/equalizer';
import { addToast } from '$lib/stores/toast';
import { wsStore } from '$lib/stores/websocket';
import { activeRemoteDevice } from '$lib/stores/websocket';
import {
    shouldUseNativeAudio, nativeAudioStop, nativeAudioSetVolume,
    nativeAudioSetEq, nativeAudioSetRepeatOne, nativeAudioSetReplayGainEnabled,
    nativeAudioSetCrossfadeSeconds, nativeAudioSetOutputDevice,
    type AudioEventType,
} from '$lib/services/native-audio';
import {
    html5SetCallbacks, html5Stop, html5Cleanup, html5SetVolume,
} from '$lib/services/html5-audio';
import { listen } from '$lib/api/tauri';
import { updateWindowsThumbarState } from '$lib/api/tauri';
import type { Track } from '$lib/api/tauri';
import {
    _startReckoning, _stopReckoning, _correctReckoning,
    _startHtml5Ticker, _stopHtml5Ticker, registerPositionUpdateCallback,
} from './reckoning';
import {
    initWindowsThumbarIntegration, registerMediaSessionActions,
    updateMediaSessionPlaybackState, registerSmtcActions,
    initSmtcIntegration, cleanupSmtcIntegration, updateSmtcPlaybackState,
} from './media-session';
import {
    handleTrackEnd, handleGaplessAdvance, nextTrack, previousTrack,
    togglePlay, pause, resume, setPlayerNativeAudioUsed,
    getPlayerNativeAudioUsed, incrementPlayerNativeErrorCount,
    PLAYER_NATIVE_ERROR_FALLBACK_THRESHOLD,
} from './playback';
import { handleRemoteCommand, handleRemotePlayerState, transferPlayback } from './remote';
import { registerRemoteCallbacks } from './remote';
import { seek, setVolume, toggleShuffle } from './playback';
import { playTrack, playFromQueue } from './playback';
import { updateMediaSessionPosition } from './media-session';
import { getTrackByIdSync } from '$lib/stores/library';
import { isFullScreen, toggleFullScreen } from '$lib/stores/ui';
import { invoke } from '@tauri-apps/api/core'


// Wire up media-session action delegates
registerMediaSessionActions(
    () => void previousTrack(),
    () => void togglePlay(),
    () => nextTrack(),
);

// SMTC action delegates
registerSmtcActions({
    resume,
    pause,
    togglePlay,
    next: nextTrack,
    previous: previousTrack,
    seek,
    setVolume,
});

// Wire up remote command callbacks
registerRemoteCallbacks({
    resume,
    pause,
    next: nextTrack,
    previous: previousTrack,
    seek,
    setVolume,
    toggleShuffle,
    playTrack,
});

// Wire up position-update slot (used by both reckoning and html5 ticker)
registerPositionUpdateCallback(() => updateMediaSessionPosition());

export async function initAudioBackend(): Promise<void> {
    console.log('[Player] Initializing audio backend');

    // Wire up HTML5 backend callbacks
    html5SetCallbacks({
        onEnded: () => handleTrackEnd(),
        onError: (message) => addToast(`Streaming playback failed: ${message}`, 'error'),
        onTimeUpdate: (position, dur) => {
            if (dur > 0 && !isNaN(dur)) duration.set(dur);
        },
        onPlayStateChange: (playing) => {
            if (get(activeBackend) === 'html5') {
                isPlaying.set(playing);
                updateMediaSessionPlaybackState(playing ? 'playing' : 'paused');
                updateSmtcPlaybackState(playing ? 'playing' : 'paused');
            }
        },
    });

    // Check if we should use native audio
    const nativeUsed = await shouldUseNativeAudio();
    setPlayerNativeAudioUsed(nativeUsed);
    console.log(`[Player] Native audio preferred: ${nativeUsed}`);

    // Register the native audio event listener once
    if (nativeUsed) {
        listen<AudioEventType>('audio://event', ({ payload: event }) => {
            if (event.type === 'TrackFinished') {
                _stopReckoning(get(currentTime));
                handleTrackEnd();
            } else if (event.type === 'TrackAdvanced') {
                _startReckoning(0);
                handleGaplessAdvance();
            } else if (event.type === 'StateChanged') {
                _correctReckoning(event.data.position);
                if (event.data.position === 0) {
                    isPlaying.set(true);
                    updateMediaSessionPlaybackState('playing');
                    updateSmtcPlaybackState('playing');
                }
            } else if (event.type === 'DeviceListChanged') {
                console.log('[Player] Device list updated');
            } else if (event.type === 'Error') {
                console.error('[Player] Backend error event:', JSON.stringify(event));
                console.error('[Player] Backend error:', event.data.message);
                const errCount = incrementPlayerNativeErrorCount();
                _stopReckoning(get(currentTime));
                isPlaying.set(false);
                updateMediaSessionPlaybackState('paused');
                updateSmtcPlaybackState('paused');

                if (errCount >= PLAYER_NATIVE_ERROR_FALLBACK_THRESHOLD) {
                    setPlayerNativeAudioUsed(false);
                    activeBackend.set('none');
                    addToast('Native audio failed repeatedly — switched to HTML5 audio', 'warning');
                    console.warn('[Player] Native backend downgraded to HTML5 after repeated errors');
                } else {
                    activeBackend.set('none');
                    addToast(`Audio error: ${event.data.message}`, 'error');
                    const track = get(currentTrack);
                    if (track) {
                        console.warn('[Player] Native error on track, attempting skip to next');
                        nextTrack();
                    }
                }
            }
        }).catch(err => {
            console.error('[Player] Failed to register audio event listener:', err);
        });
    }

    // Sync tickers when play state or backend changes
    function _syncTickers(playing: boolean, backend: typeof activeBackend extends import('svelte/store').Writable<infer T> ? T : never): void {
        updateWindowsThumbarState(playing).catch(() => { });

        if (playing && backend === 'native') {
            _startReckoning(get(currentTime));
        } else {
            _stopReckoning();
        }

        if (playing && backend === 'html5') {
            _startHtml5Ticker();
        } else {
            _stopHtml5Ticker();
        }
    }

    isPlaying.subscribe((playing) => {
        _syncTickers(playing, get(activeBackend));
        pluginEvents.emit('playStateChange', { isPlaying: playing });
    });

    activeBackend.subscribe((backend) => {
        _syncTickers(get(isPlaying), backend);
    });

    // Subscribe to volume changes to keep backends in sync
    volume.subscribe((val) => {
        const audioVol = sliderToAudioVolume(val);

        html5SetVolume(audioVol);

        if (getPlayerNativeAudioUsed()) {
            nativeAudioSetVolume(audioVol).catch(err => {
                console.warn('[Player] Failed to set native volume:', err);
            });
        }
    });

    // Force sync initial volume to native backend
    if (nativeUsed) {
        nativeAudioSetVolume(sliderToAudioVolume(get(volume))).catch(err => {
            console.warn('[Player] Failed to set initial native volume:', err);
        });
    }

    if (nativeUsed) {
        try {
            const state = equalizer.getState();
            nativeAudioSetRepeatOne(get(repeat) === 'one').catch(console.error);
            await nativeAudioSetEq({
                enabled: state.enabled,
                bands: toNativeBands(state.bands),
                preamp_db: state.preampDb,
            });
            nativeAudioSetReplayGainEnabled(get(appSettings).replayGainEnabled).catch(console.error);
            nativeAudioSetCrossfadeSeconds(get(appSettings).crossfadeSeconds).catch(console.error);
            console.log('[Player] Applied initial EQ settings to native backend');
        } catch (err) {
            console.warn('[Player] Failed to apply initial EQ settings:', err);
        }

        const savedDevice = get(appSettings).outputDevice;
        if (savedDevice) {
            nativeAudioSetOutputDevice(savedDevice).catch(err =>
                console.warn('[Player] Failed to restore output device:', err)
            );
        }
    }

    // =============================================================================
    // TRAY TOGGLE SYNC
    // keep the tray shuffle/repeat checkmarks in sync with the store values
    // =============================================================================
    shuffle.subscribe((val) => {
        invoke('tray_update_toggles', { shuffle: val, repeat: get(repeat) }).catch(() => { });
    });
    repeat.subscribe((val) => {
        invoke('tray_update_toggles', { shuffle: get(shuffle), repeat: val }).catch(() => { });
    });

    // tray://toggle-shuffle / tray://toggle-repeat are emitted by the tray
    // on_menu_event when the user clicks the checkboxes. route them through
    // the same functions the keyboard shortcuts and remote commands already use,
    // so all state transitions happen in one place.
    listen<void>('tray://toggle-shuffle', () => {
        toggleShuffle();
    }).catch(() => { });

    listen<void>('tray://toggle-repeat', () => {
        // cycle none => all => one => none
        const current = get(repeat);
        const next = current === 'none' ? 'all' : current === 'all' ? 'one' : 'none';
        repeat.set(next);
        if (get(activeBackend) === 'native') {
            nativeAudioSetRepeatOne(next === 'one').catch(console.error);
        }
    }).catch(() => { });

    // emitted when the user clicks the track title in the tray menu
    // (lib.rs already focuses the window before emitting this)
    listen<void>('tray://open-fullscreen', () => {
        if (!get(isFullScreen)) {
            toggleFullScreen();
        }
    }).catch(() => { });

    // Subscribe to WebSocket messages
    wsStore.onMessage((type, payload) => {
        switch (type) {
            case 'transfer_playback':
                transferPlayback(payload);
                break;
            case 'remote_command':
                handleRemoteCommand(payload);
                break;
            case 'player_state':
                handleRemotePlayerState(payload);
                break;
        }
    });

    await initWindowsThumbarIntegration();
    await initSmtcIntegration();

    // queue and queueIndex stores are subscribed so the jump list updates when
    // the track changes or when tracks are added/removed from the queue
    let jumpListDisabledToastShown = false;
    const JUMP_LIST_DISABLED_MARKER = 'JUMPLIST_DISABLED_BY_SETTINGS';

    const handleJumpListError = (action: 'update' | 'clear', e: unknown) => {
        if (e === JUMP_LIST_DISABLED_MARKER) {
            // windows blocks jump list writes when the user
            // has "Show recently opened items in Jump Lists" turned off
            // surface it once per session
            if (!jumpListDisabledToastShown) {
                jumpListDisabledToastShown = true;
                addToast(
                    'Jump list is disabled in Windows settings. To enable "Next Up" in the taskbar, turn on Settings > Personalization > Start > "Show recently opened items in Jump Lists..."',
                    'info',
                    8000,
                );
            }
            return;
        }
        console.error(`[JumpList] ${action} failed:`, e);
    };

    const syncJumpList = () => {
        const $queue = get(queue);
        const currentIdx = get(queueIndex);
        const nextItems = $queue
            .slice(currentIdx + 1, currentIdx + 6)
            .map((t) => ({
                track_id: t.id,
                title: t.title ?? 'Unknown Title',
                artist: t.artist ?? null,
                path: t.path,
            }));
        if (nextItems.length > 0) {
            invoke('windows_update_jump_list', { tracks: nextItems })
                .then(() => console.log('[JumpList] Updated with', nextItems))
                .catch((e) => handleJumpListError('update', e));
        } else {
            invoke('windows_clear_jump_list')
                .then(() => console.log('[JumpList] Cleared'))
                .catch((e) => handleJumpListError('clear', e));
        }
    };
    queue.subscribe(syncJumpList);
    queueIndex.subscribe(syncJumpList);

    // listen for audion://play/<id> deep links routed from lib.rs (already running case)
    await listen<string>('app://play-track', ({ payload }) => {
        const trackId = Number(payload);
        if (!trackId || isNaN(trackId)) return;
        const track = getTrackByIdSync(trackId);
        if (!track) {
            console.warn('[Player] jump list play-track: id not found in library:', trackId);
            return;
        }
        // jump list entries are sourced from the current queue (see syncJumpList
        // below)
        // playFromQueue handles the index update, userQueueCount, and shuffle pointer sync
        const idxInQueue = get(queue).findIndex((t) => t.id === trackId);
        if (idxInQueue !== -1) {
            playFromQueue(idxInQueue);
        } else {
            // queue has changed since the jump list was built (or cleared)
            // fall back to just playing the track on its own
            void playTrack(track);
        }
    });

    // file opened via os file association
    // while the app is already running - lib.rs's handle_open_file emits this
    await listen<string>('app://open-file', ({ payload }) => {
        void openAssociatedFile(payload);
    });
    // cold-start case (app launched via jump list click) is handled in +page.svelte, coordinated with initializeFromPersistedState
}

/**
 * opens a file received via os file association
 * open_or_import_track_by_path checks the library for this exact path first and returns it as is if found
 * otherwise it reads the file's tags and adds it, then returns the new track
 */
export async function openAssociatedFile(path: string): Promise<void> {
    try {
        const track = await invoke<Track>('open_or_import_track_by_path', { path });
        await playTrack(track);
    } catch (error) {
        console.error('[Player] Failed to open associated file:', path, error);
    }
}

export function cleanupPlayer(): void {
    console.log('[Player] Cleaning up player resources');
    _stopReckoning();
    _stopHtml5Ticker();
    nativeAudioStop().catch(console.error);

    html5Cleanup();

    activeBackend.set('none');
    isPlaying.set(false);
    currentTrack.set(null);
    currentTime.set(0);
    duration.set(0);

    updateMediaSessionPlaybackState('none');
    cleanupSmtcIntegration();
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.metadata = null; } catch (_) { /* ignore */ }
    }
}

export function shutdownPlayer(): void {
    cleanupPlayer();
}
