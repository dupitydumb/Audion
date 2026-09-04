// MediaSession API + Windows taskbar thumbar integration
import { get } from 'svelte/store';
import { currentTrack, currentTime, duration, isPlaying, activeBackend, volume } from './stores';
import { getTrackCoverSrc, convertFileSrc, listen, initWindowsThumbar, updateWindowsThumbarState } from '$lib/api/tauri';
import { getAlbumCoverFromTracks } from '$lib/stores/library';
import type { Track } from '$lib/api/tauri';
import { invoke } from '@tauri-apps/api/core';
import { activeRemoteDevice } from '$lib/stores/websocket';
import { throttledRemoteCommand } from './remote';
import {
    html5Seek,
} from '$lib/services/html5-audio';
import {
    nativeAudioSeek,
} from '$lib/services/native-audio';

// Forward declarations — filled by backend.ts after init
let _onPrevious: () => void = () => {};
let _onTogglePlay: () => void = () => {};
let _onNext: () => void = () => {};

export function registerMediaSessionActions(prev: () => void, toggle: () => void, next: () => void): void {
    _onPrevious = prev;
    _onTogglePlay = toggle;
    _onNext = next;
}

let _onSmtcResume: () => Promise<void> = async () => {};
let _onSmtcPause: () => Promise<void> = async () => {};
let _onSmtcTogglePlay: () => Promise<void> = async () => {};
let _onSmtcNext: () => void = () => {};
let _onSmtcPrevious: () => Promise<void> = async () => {};
let _onSmtcSeek: (fraction: number) => Promise<void> = async () => {};
let _onSmtcSetVolume: (level: number) => Promise<void> = async () => {};

export function registerSmtcActions(actions: {
    resume: () => Promise<void>;
    pause: () => Promise<void>;
    togglePlay: () => Promise<void>;
    next: () => void;
    previous: () => Promise<void>;
    seek: (fraction: number) => Promise<void>;
    setVolume: (level: number) => Promise<void>;
}): void {
    _onSmtcResume = actions.resume;
    _onSmtcPause = actions.pause;
    _onSmtcTogglePlay = actions.togglePlay;
    _onSmtcNext = actions.next;
    _onSmtcPrevious = actions.previous;
    _onSmtcSeek = actions.seek;
    _onSmtcSetVolume = actions.setVolume;
}

let mediaSessionInitialized = false;
let windowsThumbarInitialized = false;

export async function initWindowsThumbarIntegration(): Promise<void> {
    if (windowsThumbarInitialized) return;

    try {
        const initialized = await initWindowsThumbar();
        if (!initialized) return;

        await listen<{ action?: string }>('windows://thumbar-action', ({ payload }) => {
            const action = payload?.action;
            if (!action) return;

            switch (action) {
                case 'previous':
                    void _onPrevious();
                    break;
                case 'toggle_play_pause':
                    void _onTogglePlay();
                    break;
                case 'next':
                    _onNext();
                    break;
            }
        });

        windowsThumbarInitialized = true;
        await updateWindowsThumbarState(get(isPlaying));
        console.log('[Player] Windows taskbar thumbar initialized');
    } catch (err) {
        console.warn('[Player] Windows thumbar init failed:', err);
    }
}

export function initMediaSessionHandlers(): void {
    if (mediaSessionInitialized || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        try {
            ms.setActionHandler(action, handler);
        } catch (err) {
            console.debug(`[MediaSession] Action not supported: ${action}`, err);
        }
    };

    setHandler('play', () => { void _onTogglePlay(); });
    setHandler('pause', () => { void _onTogglePlay(); });
    setHandler('stop', () => { void _onTogglePlay(); });
    setHandler('previoustrack', () => { void _onPrevious(); });
    setHandler('nexttrack', () => { void _onNext(); });
    setHandler('seekto', (details) => {
        if (details.seekTime != null) {
            const dur = get(duration);
            if (dur > 0) {
                const fraction = details.seekTime / dur;
                const backend = get(activeBackend);
                if (backend === 'remote') {
                    const targetId = get(activeRemoteDevice);
                    if (targetId) throttledRemoteCommand(targetId, 'seek', { position: fraction }, 100);
                } else if (backend === 'html5') {
                    html5Seek(fraction);
                } else if (backend === 'native') {
                    nativeAudioSeek(fraction).catch(console.error);
                }
            }
        }
    });
    setHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            const fraction = Math.max(0, cur - offset) / dur;
            const backend = get(activeBackend);
            if (backend === 'remote') {
                const targetId = get(activeRemoteDevice);
                if (targetId) throttledRemoteCommand(targetId, 'seek', { position: fraction }, 100);
            } else if (backend === 'html5') {
                html5Seek(fraction);
            } else if (backend === 'native') {
                nativeAudioSeek(fraction).catch(console.error);
            }
        }
    });
    setHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            const fraction = Math.min(dur, cur + offset) / dur;
            const backend = get(activeBackend);
            if (backend === 'remote') {
                const targetId = get(activeRemoteDevice);
                if (targetId) throttledRemoteCommand(targetId, 'seek', { position: fraction }, 100);
            } else if (backend === 'html5') {
                html5Seek(fraction);
            } else if (backend === 'native') {
                nativeAudioSeek(fraction).catch(console.error);
            }
        }
    });

    mediaSessionInitialized = true;
    console.log('[Player] MediaSession action handlers registered');
}

export async function updateMediaSessionMetadata(track: Track): Promise<void> {
    if (!('mediaSession' in navigator)) return;

    initMediaSessionHandlers();

    console.log('[MediaSession] Updating metadata for:', track.title);

    const artworkSources: MediaImage[] = [];
    let artUrl: string | null = null;

    if (track.track_cover && track.track_cover.startsWith('data:')) {
        try {
            console.log('[MediaSession] Saving Base64 artwork to temp file...');
            const tempPath = await invoke<string>('save_notification_image', { dataUri: track.track_cover });
            artUrl = convertFileSrc(tempPath);
            console.log('[MediaSession] Artwork saved to:', artUrl);
        } catch (e) {
            console.error('[MediaSession] Failed to save notification image:', e);
            artUrl = track.track_cover;
        }
    } else {
        artUrl = getTrackCoverSrc(track);
    }

    if (!artUrl && track.album_id) {
        artUrl = getAlbumCoverFromTracks(track.album_id);
    }

    if (artUrl) {
        console.log('[MediaSession] Setting artwork src:', artUrl.substring(0, 50) + '...');
        artworkSources.push(
            { src: artUrl, sizes: '512x512', type: 'image/jpeg' }
        );
    }

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album: track.album || '',
            artwork: artworkSources,
        });
        console.log('[MediaSession] Metadata set successfully');
    } catch (err) {
        console.warn('[Player] Failed to set MediaSession metadata:', err);
    }
}

export function updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.playbackState = state;
    } catch (err) {
        // Ignore — some environments don't support playbackState setter
    }
}

export function updateMediaSessionPosition(): void {
    if (!('mediaSession' in navigator)) return;

    let dur = get(duration);
    let pos = get(currentTime);

    if (!dur || !isFinite(dur) || isNaN(dur)) return;

    try {
        const safePos = Math.max(0, Math.min(pos, dur));
        navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: 1,
            position: safePos,
        });
    } catch (err) {
        console.error('[MediaSession] setPositionState failed:', err);
    }
}

// =============================================================================
// SMTC (Windows/Linux/macOS native os media controls, via souvlaki)
// so backend independent
// =============================================================================

let smtcInitialized = false;
let _unlistenSmtc: (() => void) | null = null;

// dispatches one smtc event payload to the registered action handlers
export function dispatchSmtcEvent(payload: { type: string; data?: any }): void {
    switch (payload.type) {
        case 'Play':
            void _onSmtcResume();
            break;
        case 'Pause':
            void _onSmtcPause();
            break;
        case 'Toggle':
            void _onSmtcTogglePlay();
            break;
        case 'Next':
            _onSmtcNext();
            break;
        case 'Previous':
            void _onSmtcPrevious();
            break;
        case 'Stop':
            void _onSmtcPause();
            break;
        case 'SeekForward':
            _smtcSeekRelative(10);
            break;
        case 'SeekBackward':
            _smtcSeekRelative(-10);
            break;
        case 'SeekByForward':
            _smtcSeekRelative(payload.data.secs);
            break;
        case 'SeekByBackward':
            _smtcSeekRelative(-payload.data.secs);
            break;
        case 'SetPosition': {
            const dur = get(duration);
            if (dur > 0) void _onSmtcSeek(payload.data.secs / dur);
            break;
        }
        case 'SetVolume':
            void _smtcApplyVolume(payload.data.level);
            break;
    }
}

export async function initSmtcIntegration(): Promise<void> {
    if (smtcInitialized) return;

    try {
        _unlistenSmtc = await listen<{ type: string; data?: any }>('smtc://event', ({ payload }) => {
            dispatchSmtcEvent(payload);
        });
        smtcInitialized = true;
        console.log('[Player] SMTC integration initialized');
    } catch (err) {
        console.warn('[Player] SMTC init failed:', err);
    }
}

export function cleanupSmtcIntegration(): void {
    updateSmtcPlaybackState('none');
    _unlistenSmtc?.();
    _unlistenSmtc = null;
    smtcInitialized = false;
}

function _smtcSeekRelative(deltaSecs: number): void {
    const dur = get(duration);
    if (dur <= 0) return;
    const targetSecs = Math.max(0, Math.min(dur, get(currentTime) + deltaSecs));
    void _onSmtcSeek(targetSecs / dur);
}

// MPRIS only: the desktop's own volume slider for this player was moved
// ack back to souvlaki
// (smtc_set_volume)
// refer to SmtcEvent::SetVolume doc comment in smtc.rs for why the ack matters
async function _smtcApplyVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, level));
    await _onSmtcSetVolume(clamped); // updates the volume store the ui slider reads from
    try {
        await invoke('smtc_set_volume', { level: clamped });
    } catch (err) {
        console.debug('[SMTC] set_volume ack failed:', err);
    }
}

export async function updateSmtcMetadata(track: Track, direction?: 'next' | 'previous'): Promise<void> {
    // raw source only => never a webview asset:// URL here. smtc.rs does the
    // platform specific file:// / percent-encoding conversion on its side
    const rawCover = track.track_cover_path || track.cover_url || null;
    try {
        await invoke('smtc_set_metadata', {
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album: track.album || null,
            durationSecs: get(duration) || null,
            coverUrl: rawCover,
            direction: direction ?? null,
        });
    } catch (err) {
        console.error('[SMTC] set_metadata failed:', err);
    }
    // keep tray now playing labels in sync
    invoke('tray_update_playback', {
        isPlaying: get(isPlaying),
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
    }).catch(() => { });
}

// WINDOWS ONLY. windows taskbar icon progress overlay. value is 0-1 fraction played;
// is_paused swaps the green fill for the yellowish paused color
function _pushTaskbarProgress(): void {
    const dur = get(duration);
    const cur = get(currentTime);
    const value = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    invoke('windows_set_taskbar_progress', { value, isPaused: !get(isPlaying) }).catch(() => { });
}

let _taskbarProgressInterval: ReturnType<typeof setInterval> | null = null;

function _startTaskbarProgressInterval(): void {
    if (_taskbarProgressInterval !== null) return;
    _taskbarProgressInterval = setInterval(_pushTaskbarProgress, 1000);
}

function _stopTaskbarProgressInterval(): void {
    if (_taskbarProgressInterval !== null) {
        clearInterval(_taskbarProgressInterval);
        _taskbarProgressInterval = null;
    }
}

export function updateSmtcPlaybackState(
    state: 'playing' | 'paused' | 'none',
    options?: {
        shuffle?: boolean;
        repeatMode?: 'off' | 'all' | 'one';
        seekDirection?: 'forward' | 'backward';
    },
): void {
    invoke('smtc_set_playback', {
        status: state === 'none' ? 'stopped' : state,
        positionSecs: get(currentTime),
        seekDirection: options?.seekDirection ?? null,
        shuffle: options?.shuffle ?? null,
        repeatMode: options?.repeatMode ?? null,
    }).catch(() => { /* no-op if SMTC unavailable, e.g. init failed on this platform */ });
    // keep tray play/pause label in sync
    // title/artist are set by updateSmtcMetadata
    invoke('tray_update_playback', {
        isPlaying: state === 'playing',
        title: null,
        artist: null,
    }).catch(() => { });

    // taskbar icon progress overlay
    if (state === 'none') {
        _stopTaskbarProgressInterval();
        invoke('windows_clear_taskbar_progress', {}).catch(() => { });
    } else {
        _pushTaskbarProgress();
        _startTaskbarProgressInterval();
    }
}
