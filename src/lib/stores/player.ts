// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import { wsStore } from './websocket';
import type { Track } from '$lib/api/tauri';
import {
    getAudioSrc,
    getAlbumArtSrc,
    getTrackCoverSrc,
    convertFileSrc,
    listen,
    initWindowsThumbar,
    updateWindowsThumbarState,
    audioResolvePath,
    audioGetStreamUrl
} from '$lib/api/tauri';
import { invoke } from '@tauri-apps/api/core';
import { addToast } from '$lib/stores/toast';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { tracks as libraryTracks, getFullTrack, getAlbumCoverFromTracks, updateTrackCover, getTrackByIdSync } from '$lib/stores/library';
import { fetchTrackCover } from '$lib/services/cover-fetcher';
import { appSettings } from '$lib/stores/settings';
import { equalizer, type EqualizerState } from '$lib/stores/equalizer';
import { pluginStore } from '$lib/stores/plugin-store';
import { recordTrackPlay } from '$lib/stores/activity';
import { submitListenbrainzListen } from '$lib/api/tauri';
import { activeRemoteDevice } from '$lib/stores/websocket';

// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
import {
    nativeAudioPlay,
    nativeAudioPreload,
    nativeAudioPause,
    nativeAudioResume,
    nativeAudioStop,
    nativeAudioSetVolume,
    nativeAudioSeek,
    nativeAudioGetState,
    nativeAudioSetRepeatOne,
    nativeAudioPollEvent,
    type AudioEventType,
    nativeAudioSetEq,
    nativeAudioSetReplayGainEnabled,
    nativeAudioSetOutputDevice,
    shouldUseNativeAudio,
    type NativePlaybackState
} from '$lib/services/native-audio';

// =============================================================================
// HTML5 AUDIO BACKEND
// =============================================================================
import {
    html5SetCallbacks,
    html5Play,
    html5Pause,
    html5Resume,
    html5Stop,
    html5Seek,
    html5SetVolume,
    html5GetState,
    html5Cleanup,
} from '$lib/services/html5-audio';

// Interval for polling native playback state
let nativeStatePoller: ReturnType<typeof setInterval> | null = null;

// Track which backend is currently active ('native', 'html5', 'remote', or 'none')
export type ActiveBackend = 'native' | 'html5' | 'remote' | 'none';
export const activeBackend = writable<ActiveBackend>('none');

// Track if we should use native audio based on platform/settings
let nativeAudioUsed = false;

// Note: html5-audio.ts has its own copy of classifyAudioPath for internal use.
// This copy exists solely for the custom-scheme check in playTrack.
// If the classification logic ever changes, update both.
type AudioPathKind = 'local' | 'stream' | 'blob' | 'custom-scheme';

function classifyAudioPath(path: string): AudioPathKind {
    if (path.startsWith('blob:')) return 'blob';
    if (path.startsWith('http://') || path.startsWith('https://')) return 'stream';
    if (path.startsWith('file://') || path.startsWith('asset://') || path.startsWith('tauri://')) return 'local';
    if (path.includes('://')) return 'custom-scheme';
    return 'local'; // absolute/relative filesystem path
}

/**
 * Detect if a track needs HTML5 streaming or native local playback
 */
export function isStreaming(track: Track): boolean {
    // 1. Explicitly local sources (by type or path)
    if (track.source_type === 'local' || track.source_type === 'server' || track.local_src) return false;

    if (track.path) {
        // Tauri local protocols are always local
        if (track.path.startsWith('file://') || track.path.startsWith('asset://') || track.path.startsWith('tauri://')) {
            return false;
        }
        // Explicitly streaming protocols
        if (track.path.startsWith('http://') || track.path.startsWith('https://')) {
            return true;
        }
    }

    // 3. Known external source types (Tidal, etc.)
    if (track.source_type && track.source_type !== 'local') return true;

    // 4. Default to local for anything else (safer for absolute paths)
    return false;
}

// Plugin event emitter (global singleton for plugin system)
export const pluginEvents = new EventEmitter<PluginEvents>();

// Playback Context Tracking
export interface PlaybackContext {
    type: 'playlist' | 'album' | 'artist';
    playlistId?: number;
    albumId?: number;
    artistName?: string;
    displayName?: string;
}

export const playbackContext = writable<PlaybackContext | null>(null);

export const currentPlaylistId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'playlist' ? $ctx.playlistId ?? null : null)
);

export const currentAlbumId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'album' ? $ctx.albumId ?? null : null)
);

export const currentArtistName = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'artist' ? $ctx.artistName ?? null : null)
);

// Current track
export const currentTrack = writable<Track | null>(null);
export const currentTrackId = derived(currentTrack, ($t) => $t?.id ?? null);

// Playing state
export const isPlaying = writable(false);

// Queue
export const queue = writable<Track[]>([]);
export const queueIndex = writable(0);
export const userQueueCount = writable(0);

// Volume (0-1) - this is the SLIDER value (linear)
export const volume = writable(0.7);

export function sliderToAudioVolume(sliderValue: number): number {
    return Math.pow(sliderValue, 2);
}

export function audioVolumeToSlider(audioVolume: number): number {
    return Math.sqrt(audioVolume);
}

// Playback session tracking
let currentSessionId = 0;
let playStartTime: number = 0;

// Current time and duration
export const currentTime = writable(0);
export const duration = writable(0);

// Shuffle and repeat
export const shuffle = writable(false);
export const repeat = writable<'none' | 'one' | 'all'>('none');

// Subscribe to EQ changes — native half only.
// The HTML5 half is handled inside html5-audio.ts via its own subscription.
let _eqApplyTimer: ReturnType<typeof setTimeout> | null = null;
let _latestEqState: any = null;
equalizer.subscribe((state) => {
    _latestEqState = state;

    // Only attempt to apply when native backend is active
    if (get(activeBackend) !== 'native') return;

    // Debounce rapid updates (200ms)
    if (_eqApplyTimer) clearTimeout(_eqApplyTimer);
    _eqApplyTimer = setTimeout(async () => {
        try {
            await nativeAudioSetEq(_latestEqState);
        } catch (err) {
            console.error('[EQ] Failed to apply settings:', err);
        } finally {
            _eqApplyTimer = null;
        }
    }, 200);
});

// =============================================================================
// BACKEND INITIALIZATION
// =============================================================================
export async function initAudioBackend(): Promise<void> {
    console.log('[Player] Initializing audio backend');

    // Wire up HTML5 backend callbacks
    html5SetCallbacks({
        onEnded: () => handleTrackEnd(),
        onError: (message) => addToast(`Streaming playback failed: ${message}`, 'error'),
        onTimeUpdate: (position, dur) => {
            // durationchange pushes here immediately when browser parses duration,
            // ahead of the next poller tick.
            if (dur > 0 && !isNaN(dur)) duration.set(dur);
        },
        onPlayStateChange: (playing) => {
            if (get(activeBackend) === 'html5') {
                isPlaying.set(playing);
                updateMediaSessionPlaybackState(playing ? 'playing' : 'paused');
            }
        },
    });

    // Check if we should use native audio
    nativeAudioUsed = await shouldUseNativeAudio();
    console.log(`[Player] Native audio preferred: ${nativeAudioUsed}`);

    // Start/stop poller based on playback state and notify remote devices
    isPlaying.subscribe((playing) => {
        updateWindowsThumbarState(playing).catch(() => { });
        broadcastState(true);
        if (playing) {
            startStatePoller();
        } else {
            stopStatePoller();
        }
    });

    // Also force broadcast when the actual track changes regardless of play state
    currentTrack.subscribe(() => {
        broadcastState(true);
    });

    // Subscribe to volume changes to keep backends in sync
    volume.subscribe((val) => {
        const audioVol = sliderToAudioVolume(val);

        // Update HTML5 backend
        html5SetVolume(audioVol);

        // Update Native backend
        if (nativeAudioUsed) {
            nativeAudioSetVolume(audioVol).catch(err => {
                console.warn('[Player] Failed to set native volume:', err);
            });
        }
    });

    // Force sync initial volume to native backend
    if (nativeAudioUsed) {
        nativeAudioSetVolume(sliderToAudioVolume(get(volume))).catch(err => {
            console.warn('[Player] Failed to set initial native volume:', err);
        });
    }

    if (nativeAudioUsed) {
        try {
            const state = equalizer.getState();
            nativeAudioSetRepeatOne(get(repeat) === 'one').catch(console.error);
            await nativeAudioSetEq(state);
            nativeAudioSetReplayGainEnabled(get(appSettings).replayGainEnabled).catch(console.error);
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

    activeBackend.subscribe(b => {
        if (b === 'remote') {
            stopStatePoller();
        }
    });

    await initWindowsThumbarIntegration();
}

function handleRemotePlayerState(payload: any) {
    const isLocalPlaying = get(isPlaying) && get(activeBackend) !== 'remote';

    if (!isLocalPlaying && payload.isPlaying && payload.deviceId) {
        if (get(activeBackend) !== 'remote') {
            activeBackend.set('remote');
            activeRemoteDevice.set(payload.deviceId);
            console.log(`[Player] Auto-switched to remote session for device: ${payload.deviceId}`);
        }
    }

    if (get(activeBackend) === 'remote' && get(activeRemoteDevice) === payload.deviceId) {
        if (payload.track) {
            const remoteTrack = payload.track;
            const currentObj = get(currentTrack);
            const remoteTrackId = Number(remoteTrack.id);

            if (!currentObj || Number(currentObj.id) !== remoteTrackId) {
                let localTrack: any = getTrackByIdSync(remoteTrackId);

                if (!localTrack) {
                    const $library = get(libraryTracks);
                    localTrack = $library.find(t =>
                        t.title === remoteTrack.title &&
                        t.artist === remoteTrack.artist
                    );
                }

                currentTrack.set({
                    ...remoteTrack,
                    ...(localTrack || {}),
                    id: remoteTrackId,
                    track_cover: localTrack ? getTrackCoverSrc(localTrack) : remoteTrack.coverUrl,
                } as any);
            }
        } else {
            if (get(currentTrack) !== null) currentTrack.set(null);
        }

        if (get(isPlaying) !== payload.isPlaying) isPlaying.set(payload.isPlaying);

        const currentT = get(currentTime);
        if (Math.abs(currentT - payload.currentTime) > 0.25 || payload.isPlaying === false) {
            currentTime.set(payload.currentTime);
        }

        if (get(duration) !== payload.duration) duration.set(payload.duration);

        if (payload.volume !== undefined && get(volume) !== payload.volume) volume.set(payload.volume);
        if (payload.shuffle !== undefined && get(shuffle) !== payload.shuffle) shuffle.set(payload.shuffle);
        if (payload.repeat !== undefined && get(repeat) !== payload.repeat) repeat.set(payload.repeat);
    }
}

// Poll the native backend for state changes (only while playing)
const POLL_INTERVAL_MS = 50;

function startStatePoller(): void {
    if (nativeStatePoller) return;

    nativeStatePoller = setInterval(async () => {
        try {
            const track = get(currentTrack);
            if (!track) return;

            if (get(activeBackend) === 'native') {
                const state = await nativeAudioGetState();

                currentTime.set(state.position);
                if (state.duration > 0) {
                    duration.set(state.duration);
                } else {
                    console.warn('[Poller] Native backend reported 0 duration for track at:', state.position);
                }

                const event = await nativeAudioPollEvent();

                if (event.type === 'TrackFinished') {
                    handleTrackEnd();
                } else if (event.type === 'TrackAdvanced') {
                    handleGaplessAdvance();
                } else if (event.type === 'StateChanged') {
                    currentTime.set(event.data.position);
                    if (event.data.position === 0) {
                        isPlaying.set(true);
                        updateMediaSessionPlaybackState('playing');
                    }
                }

                if (state.is_playing !== get(isPlaying)) {
                    if (state.is_playing === false && state.duration === 0 && state.position === 0) {
                        // Backend hasn't loaded track yet, don't trust this state
                    } else {
                        isPlaying.set(state.is_playing);
                        updateMediaSessionPlaybackState(state.is_playing ? 'playing' : 'paused');
                    }
                }

                pluginEvents.emit('timeUpdate', {
                    currentTime: state.position,
                    duration: state.duration
                });

            } else if (get(activeBackend) === 'html5') {
                const state = html5GetState();
                currentTime.set(state.position);
                if (state.duration > 0 && !isNaN(state.duration)) duration.set(state.duration);
                if (state.isPlaying !== get(isPlaying)) {
                    isPlaying.set(state.isPlaying);
                    updateMediaSessionPlaybackState(state.isPlaying ? 'playing' : 'paused');
                }
                pluginEvents.emit('timeUpdate', { currentTime: state.position, duration: state.duration });

            } else if (get(activeBackend) === 'remote') {
                // Remote: rely purely on WebSocket pushes, no local polling.
            }

            if (get(isPlaying)) {
                updateMediaSessionPosition();
            }

            broadcastState();

        } catch (e) {
            console.error('[Player] Poller error:', e);
        }
    }, POLL_INTERVAL_MS);
}

let lastBroadcast = 0;
function broadcastState(force = false) {
    if (get(activeBackend) === 'remote') return;

    const now = Date.now();
    if (!force && now - lastBroadcast < 2000) return;

    const track = get(currentTrack);
    const playing = get(isPlaying);
    const pos = get(currentTime);
    const dur = get(duration);

    if (track || lastBroadcast === 0) {
        wsStore.send('player_state', {
            track: track ? {
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                coverUrl: getTrackCoverSrc(track)
            } : null,
            isPlaying: playing,
            currentTime: pos,
            duration: dur,
            volume: get(volume),
            shuffle: get(shuffle),
            repeat: get(repeat)
        });
        lastBroadcast = now;
    }
}

function stopStatePoller(): void {
    if (nativeStatePoller) {
        clearInterval(nativeStatePoller);
        nativeStatePoller = null;
    }
}

export function cleanupPlayer(): void {
    console.log('[Player] Cleaning up player resources');
    stopStatePoller();
    nativeAudioStop().catch(console.error);

    // Cleanup HTML5 backend (audio element + dash + EQ graph)
    html5Cleanup();

    // Reset stores
    activeBackend.set('none');
    isPlaying.set(false);
    currentTrack.set(null);
    currentTime.set(0);
    duration.set(0);

    updateMediaSessionPlaybackState('none');
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.metadata = null; } catch (_) { /* ignore */ }
    }
}

export function shutdownPlayer(): void {
    cleanupPlayer();
}

// ── Media Session API ──

let mediaSessionInitialized = false;
let windowsThumbarInitialized = false;

async function initWindowsThumbarIntegration(): Promise<void> {
    if (windowsThumbarInitialized) return;

    try {
        const initialized = await initWindowsThumbar();
        if (!initialized) return;

        await listen<{ action?: string }>('windows://thumbar-action', ({ payload }) => {
            const action = payload?.action;
            if (!action) return;

            switch (action) {
                case 'previous':
                    void previousTrack();
                    break;
                case 'toggle_play_pause':
                    void togglePlay();
                    break;
                case 'next':
                    nextTrack();
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

function initMediaSessionHandlers(): void {
    if (mediaSessionInitialized || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        try {
            ms.setActionHandler(action, handler);
        } catch (err) {
            console.debug(`[MediaSession] Action not supported: ${action}`, err);
        }
    };

    setHandler('play', () => { void resume(); });
    setHandler('pause', () => { void pause(); });
    setHandler('stop', () => { void pause(); });
    setHandler('previoustrack', () => { void previousTrack(); });
    setHandler('nexttrack', () => { void nextTrack(); });
    setHandler('seekto', (details) => {
        if (details.seekTime != null) {
            const dur = get(duration);
            if (dur > 0) {
                if (get(activeBackend) === 'html5') {
                    html5Seek(details.seekTime / dur);
                } else {
                    nativeAudioSeek(details.seekTime / dur).catch(console.error);
                }
            }
        }
    });
    setHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            if (get(activeBackend) === 'html5') {
                html5Seek(Math.max(0, cur - offset) / dur);
            } else {
                nativeAudioSeek(Math.max(0, cur - offset) / dur).catch(console.error);
            }
        }
    });
    setHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            if (get(activeBackend) === 'html5') {
                html5Seek(Math.min(dur, cur + offset) / dur);
            } else {
                nativeAudioSeek(Math.min(dur, cur + offset) / dur).catch(console.error);
            }
        }
    });

    mediaSessionInitialized = true;
    console.log('[Player] MediaSession action handlers registered');
}

async function updateMediaSessionMetadata(track: Track): Promise<void> {
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

function updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.playbackState = state;
    } catch (err) {
        // Ignore — some environments don't support playbackState setter
    }
}

function updateMediaSessionPosition(): void {
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

// Play a specific track
export async function playTrack(track: Track, skipLocalSrc = false, startTime = 0): Promise<void> {
    const previousTrackObj = get(currentTrack);
    const sessionId = ++currentSessionId;

    // Record play for the previous track (if any)
    if (previousTrackObj && playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(previousTrackObj.id, previousTrackObj.album_id ?? null, durationPlayed);
            const trackDuration = previousTrackObj.duration ?? 0;
            if (get(appSettings).listenBrainzEnabled && trackDuration > 0) {
                const threshold = Math.min(Math.floor(trackDuration / 2), 240);
                if (durationPlayed >= threshold) {
                    submitListenbrainzListen(
                        previousTrackObj.artist ?? 'Unknown Artist',
                        previousTrackObj.title ?? 'Unknown',
                        previousTrackObj.album,
                        previousTrackObj.duration,
                        false,
                    ).catch(e => console.warn('[ListenBrainz] Scrobble failed:', e));
                }
            }
        }
    }
    playStartTime = Date.now();

    if (get(appSettings).listenBrainzEnabled) {
        submitListenbrainzListen(
            track.artist ?? 'Unknown Artist',
            track.title ?? 'Unknown',
            track.album,
            track.duration,
            true,
        ).catch(e => console.warn('[ListenBrainz] Now-playing failed:', e));
    }

    const fullTrack = await getFullTrack(track.id, true);

    if (sessionId !== currentSessionId) return;

    const trackForPlugins = fullTrack || track;
    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack: previousTrackObj });

    console.log('[Player] Preparing MediaSession metadata for:', trackForPlugins.title);
    await updateMediaSessionMetadata(trackForPlugins);

    if (!track.track_cover_path && !track.cover_url) {
        fetchTrackCover(track).then(async (newCoverUrl) => {
            if (newCoverUrl) {
                console.log(`[Player] Auto-fetched cover for "${track.title}": ${newCoverUrl}`);

                try {
                    await invoke('update_track_cover_url', { trackId: track.id, coverUrl: newCoverUrl });
                } catch (e) {
                    console.error('[Player] Failed to persist fetched cover to database:', e);
                }

                updateTrackCover(track.id, newCoverUrl);

                const current = get(currentTrack);
                if (current && current.id === track.id) {
                    currentTrack.update(t => t ? { ...t, cover_url: newCoverUrl } : t);
                    updateMediaSessionMetadata({ ...track, cover_url: newCoverUrl }).catch(() => { });
                }
            }
        }).catch(err => {
            console.error('[Player] Failed to auto-fetch cover:', err);
        });
    }

    if (sessionId !== currentSessionId) {
        console.log('[Player] Session changed during metadata update, aborting playback');
        return;
    }

    try {
        let audioPath = track.local_src || track.path;

        // Resolve server tracks before checking/preparing backends
        if (track.source_type === 'server' && !track.local_src) {
            if (get(appSettings).streamServerTracks) {
                try {
                    audioPath = await audioGetStreamUrl(audioPath, track.id);
                } catch (err) {
                    console.error('[Player] Failed to get server stream URL:', err);
                    throw new Error(`Failed to get stream URL from server: ${err instanceof Error ? err.message : String(err)}`);
                }
            } else {
                if (nativeAudioUsed) {
                    try {
                        audioPath = await audioResolvePath(audioPath, track.id);
                        track.local_src = audioPath;
                    } catch (err) {
                        console.error('[Player] Failed to resolve server track path:', err);
                        throw new Error(`Failed to download/resolve track from server: ${err instanceof Error ? err.message : String(err)}`);
                    }
                } else {
                    try {
                        audioPath = await audioGetStreamUrl(audioPath, track.id);
                    } catch (err) {
                        console.error('[Player] Failed to get server stream URL:', err);
                        throw new Error(`Failed to get stream URL from server: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }
        }

        if (!audioPath && (track as any).stream_url) {
            audioPath = (track as any).stream_url;
        }

        if (!audioPath && track.external_id && (track.external_id.startsWith('http://') || track.external_id.startsWith('https://'))) {
            audioPath = track.external_id;
        }

        const streaming = isStreaming(track) || !!(track as any).stream_url || audioPath.startsWith('http://') || audioPath.startsWith('https://');

        if (streaming) {
            if (!audioPath) {
                throw new Error('No audio path or stream URL found for track');
            }

            await nativeAudioStop().catch(() => { });

            if (classifyAudioPath(audioPath) === 'custom-scheme') {
                const runtime = pluginStore.getRuntime();
                if (runtime) {
                    const sourceType = track.source_type;
                    const externalId = track.external_id;
                    if (sourceType && externalId) {
                        console.log(`[Player] Resolving custom scheme: ${audioPath}`);
                        const resolved = await runtime.resolveStreamUrl(sourceType, externalId, { track: trackForPlugins });
                        if (resolved) {
                            audioPath = resolved;
                        } else {
                            throw new Error(`Failed to resolve stream URL for ${sourceType}`);
                        }
                    }
                }
            }

            activeBackend.set('html5');
            await html5Play(audioPath, sliderToAudioVolume(get(volume)), startTime);
            console.log('[Player] HTML5 streaming started:', track.title);

        } else {
            if (!audioPath) {
                throw new Error('No local audio path found for track');
            }

            if (nativeAudioUsed) {
                html5Stop();

                await nativeAudioPlay(audioPath, track.id, (track as any).replay_gain_db ?? null);

                const vol = sliderToAudioVolume(get(volume));
                await nativeAudioSetVolume(vol);

                if (startTime > 0 && track.duration) {
                    await nativeAudioSeek(startTime / track.duration);
                }

                _schedulePreload();

                activeBackend.set('native');
                console.log('[Player] Native playback started:', track.title);
            } else {
                activeBackend.set('html5');
                await html5Play(convertFileSrc(audioPath), sliderToAudioVolume(get(volume)), startTime);
                console.log('[Player] Local playback started via HTML5:', track.title);
            }
        }

        currentTrack.set(trackForPlugins);
        currentTime.set(startTime);
        duration.set(track.duration || 0);
        isPlaying.set(true);

        updateMediaSessionPlaybackState('playing');
        updateMediaSessionPosition();

    } catch (err) {
        console.error('[Player] Playback failed:', err);
        addToast(`Playback failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
}


// Shuffled Queue State
export const shuffledIndices = writable<number[]>([]);
export const shuffledIndex = writable<number>(0);

function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function playTracks(
    tracks: Track[],
    startIndex: number = 0,
    context?: PlaybackContext
): void {
    const currentQueue = get(queue);

    let isSameQueue = false;

    if (tracks.length === currentQueue.length) {
        if (tracks.length === 0) {
            isSameQueue = true;
        } else {
            if (tracks[0].id === currentQueue[0].id &&
                tracks[tracks.length - 1].id === currentQueue[currentQueue.length - 1].id) {
                isSameQueue = tracks.every((t, i) => t.id === currentQueue[i].id);
            }
        }
    }

    if (!isSameQueue) {
        queue.set(tracks);
    }

    queueIndex.set(startIndex);
    userQueueCount.set(0);

    playbackContext.set(context ?? null);

    if (get(shuffle)) {
        const allIndices = tracks.map((_, i) => i);
        const otherIndices = allIndices.filter(i => i !== startIndex);
        const shuffledOthers = shuffleArray(otherIndices);
        const newShuffledIndices = [startIndex, ...shuffledOthers];

        console.log(`Regenerating shuffle with forced start: ${startIndex}`);
        shuffledIndices.set(newShuffledIndices);
        shuffledIndex.set(0);
    }

    pluginEvents.emit('queueChange', { queue: tracks, index: startIndex });

    if (tracks.length > 0 && startIndex < tracks.length) {
        playTrack(tracks[startIndex]);
    }
}

export async function togglePlay(): Promise<void> {
    if (get(isPlaying)) {
        await pause();
    } else {
        await resume();
    }
}

export async function pause(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'pause');
        }
        return;
    }

    try {
        if (get(activeBackend) === 'html5') {
            html5Pause();
        } else if (get(activeBackend) === 'native') {
            await nativeAudioPause();
        }
        isPlaying.set(false);
        updateMediaSessionPlaybackState('paused');
    } catch (err) {
        console.error('[Player] Pause failed:', err);
    }
}

export async function resume(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'resume');
        }
        return;
    }

    try {
        const track = get(currentTrack);
        if (!track) return;

        if (get(currentTime) >= get(duration) && get(duration) > 0) {
            await playTrack(track);
        } else if (get(activeBackend) === 'none') {
            await playTrack(track, false, get(currentTime));
        } else if (get(activeBackend) === 'html5') {
            await html5Resume();
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
        } else if (get(activeBackend) === 'native') {
            await nativeAudioResume();
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
        }
        updateMediaSessionPosition();
    } catch (err) {
        console.error('[Player] Resume failed:', err);
    }
}

// =============================================================================
// QUEUE INDEX HELPERS
// =============================================================================

function _advanceQueueIndex(dry = false): number | null {
    const q = get(queue);
    const rep = get(repeat);
    const shuf = get(shuffle);
    const userCount = get(userQueueCount);
    const settings = get(appSettings);
    let idx = get(queueIndex);

    if (q.length === 0) return null;

    if (userCount > 0) {
        idx = idx + 1;
        if (!dry) userQueueCount.update(c => Math.max(0, c - 1));

    } else if (shuf) {
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex) + 1;

        if (shufIdx >= shufIndices.length) {
            if (rep === 'all') {
                shufIdx = 0;
            } else {
                return null;
            }
        }

        if (!dry) shuffledIndex.set(shufIdx);
        idx = shufIndices[shufIdx];
    } else {
        idx = idx + 1;

        if (idx >= q.length) {
            if (rep === 'all') {
                idx = 0;
            } else {
                return null;
            }
        }
    }

    return idx;
}

export function nextTrack(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'next');
        }
        return;
    }

    const q = get(queue);
    const settings = get(appSettings);

    if (q.length === 0) {
        if (settings.autoplay) playRandomFromLibrary();
        return;
    }

    const idx = _advanceQueueIndex();

    if (idx === null) {
        if (settings.autoplay) {
            playRandomFromLibrary();
        } else {
            isPlaying.set(false);
        }
        return;
    }

    queueIndex.set(idx);
    playTrack(q[idx]);
}

function playRandomFromLibrary(): void {
    const allTracks = get(libraryTracks);
    if (allTracks.length === 0) {
        isPlaying.set(false);
        return;
    }

    const current = get(currentTrack);
    let availableTracks = allTracks;

    if (current && allTracks.length > 1) {
        availableTracks = allTracks.filter(t => t.id !== current.id);
    }

    const randomIndex = Math.floor(Math.random() * availableTracks.length);
    const randomTrack = availableTracks[randomIndex];

    queue.update(q => [...q, randomTrack]);
    const newQueue = get(queue);
    queueIndex.set(newQueue.length - 1);

    playTrack(randomTrack);
}

export async function previousTrack(): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'previous');
        }
        return;
    }

    const q = get(queue);
    const shuf = get(shuffle);
    let idx = get(queueIndex);

    if (q.length === 0) return;

    try {
        let pos = get(currentTime);

        if (pos > 3) {
            if (get(activeBackend) === 'html5') {
                html5Seek(0); // ratio 0 = start of track; semantically correct despite the ratio API
            } else if (get(activeBackend) === 'native') {
                await nativeAudioSeek(0);
            }
            return;
        }
    } catch (err) {
        console.error('[Player] Restart track failed:', err);
    }

    if (shuf) {
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex);

        shufIdx = shufIdx - 1;
        if (shufIdx < 0) {
            shufIdx = get(repeat) === 'all' ? shufIndices.length - 1 : 0;
        }

        shuffledIndex.set(shufIdx);
        idx = shufIndices[shufIdx];
    } else {
        idx = idx - 1;
        if (idx < 0) {
            idx = get(repeat) === 'all' ? q.length - 1 : 0;
        }
    }

    queueIndex.set(idx);
    playTrack(q[idx]);
}

export async function seek(position: number): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            throttledRemoteCommand(targetId, 'seek', { position }, 100);
        }
        return;
    }

    try {
        if (get(activeBackend) === 'html5') {
            html5Seek(position);
        } else if (get(activeBackend) === 'native') {
            await nativeAudioSeek(position);
            if (!get(isPlaying)) {
                currentTime.set(position * get(duration));
            }
        }
        updateMediaSessionPosition();
    } catch (err) {
        console.error('[Player] Seek failed:', err);
    }
}

export async function setVolume(sliderValue: number): Promise<void> {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            throttledRemoteCommand(targetId, 'volume', { volume: sliderValue }, 100);
        }
        return;
    }

    volume.set(sliderValue);
    const vol = sliderToAudioVolume(sliderValue);

    try {
        html5SetVolume(vol);
        if (nativeAudioUsed) {
            await nativeAudioSetVolume(vol);
        }
    } catch (err) {
        console.error('[Player] Volume set failed:', err);
    }
}

export function toggleShuffle(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            sendRemoteCommand(targetId, 'shuffle', { shuffle: !get(shuffle) });
        }
        return;
    }

    shuffle.update(s => {
        const newState = !s;

        if (newState) {
            const q = get(queue);
            const currentIdx = get(queueIndex);
            const indices = q.map((_, i) => i);
            const shuffled = shuffleArray(indices);

            console.log('Regenerating shuffle in toggleShuffle');
            shuffledIndices.set(shuffled);

            const ptr = shuffled.indexOf(currentIdx);
            shuffledIndex.set(ptr !== -1 ? ptr : 0);
        }

        return newState;
    });
}

export function cycleRepeat(): void {
    if (get(activeBackend) === 'remote') {
        const targetId = get(activeRemoteDevice);
        if (targetId) {
            const r = get(repeat);
            const next = r === 'none' ? 'all' : r === 'all' ? 'one' : 'none';
            sendRemoteCommand(targetId, 'repeat', { repeat: next });
        }
        return;
    }

    repeat.update(r => {
        const next = r === 'none' ? 'all' : r === 'all' ? 'one' : 'none';
        if (get(activeBackend) === 'native') {
            nativeAudioSetRepeatOne(next === 'one').catch(console.error);
        }
        return next;
    });
}

function handleTrackEnd(): void {
    const track = get(currentTrack);
    if (track && playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(track.id, track.album_id ?? null, durationPlayed);
            const trackDuration = track.duration ?? 0;
            if (get(appSettings).listenBrainzEnabled && trackDuration > 0) {
                const threshold = Math.min(Math.floor(trackDuration / 2), 240);
                if (durationPlayed >= threshold) {
                    submitListenbrainzListen(
                        track.artist ?? 'Unknown Artist',
                        track.title ?? 'Unknown',
                        track.album,
                        track.duration,
                        false,
                    ).catch(e => console.warn('[ListenBrainz] Scrobble failed:', e));
                }
            }
        }
        playStartTime = 0;
    }

    if (get(repeat) === 'one' && track) {
        console.log('[Player] Repeat one: restarting current track');
        playTrack(track).catch(console.error);
        return;
    }

    nextTrack();
}

function handleGaplessAdvance(): void {
    const q = get(queue);

    const prevTrack = get(currentTrack);
    if (prevTrack && playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(prevTrack.id, prevTrack.album_id ?? null, durationPlayed);
            const trackDuration = prevTrack.duration ?? 0;
            if (get(appSettings).listenBrainzEnabled && trackDuration > 0) {
                const threshold = Math.min(Math.floor(trackDuration / 2), 240);
                if (durationPlayed >= threshold) {
                    submitListenbrainzListen(
                        prevTrack.artist ?? 'Unknown Artist',
                        prevTrack.title ?? 'Unknown',
                        prevTrack.album,
                        prevTrack.duration,
                        false,
                    ).catch(e => console.warn('[ListenBrainz] Scrobble failed:', e));
                }
            }
        }
    }
    playStartTime = Date.now();

    const idx = _advanceQueueIndex();
    if (idx === null) {
        handleTrackEnd();
        return;
    }

    queueIndex.set(idx);
    const nextTrackObj = q[idx];
    if (!nextTrackObj) return;

    _advanceUiToTrack(nextTrackObj);
}

async function _advanceUiToTrack(track: Track): Promise<void> {
    const previousTrackObj = get(currentTrack);

    const fullTrack = await getFullTrack(track.id, true);
    const trackForPlugins = fullTrack || track;

    currentTrack.set(trackForPlugins);
    currentTime.set(0);
    duration.set(track.duration || 0);
    isPlaying.set(true);

    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack: previousTrackObj });
    pluginEvents.emit('queueChange', { queue: get(queue), index: get(queueIndex) });

    await updateMediaSessionMetadata(trackForPlugins);
    updateMediaSessionPlaybackState('playing');
    updateMediaSessionPosition();

    _schedulePreload();

    if (get(appSettings).listenBrainzEnabled) {
        submitListenbrainzListen(
            track.artist ?? 'Unknown Artist',
            track.title ?? 'Unknown',
            track.album,
            track.duration,
            true,
        ).catch(e => console.warn('[ListenBrainz] Now-playing failed:', e));
    }
}

// =============================================================================
// GAPLESS PRELOAD
// =============================================================================

function _schedulePreload(): void {
    if (get(activeBackend) !== 'native') return;

    const q = get(queue);
    const nextIdx = _advanceQueueIndex(true);

    if (nextIdx === null || nextIdx >= q.length) return;

    const nextTrackObj = q[nextIdx];
    if (!nextTrackObj || isStreaming(nextTrackObj)) return;

    const nextPath = nextTrackObj.local_src || nextTrackObj.path;
    if (!nextPath) return;

    nativeAudioPreload(nextPath, nextTrackObj.id, (nextTrackObj as any).replay_gain_db ?? null).catch(e => {
        console.warn('[Player] Preload failed (non-fatal):', e);
    });
}

// Progress as percentage (0-1)
export const progress = derived(
    [currentTime, duration],
    ([$currentTime, $duration]) => {
        if (!$duration || $duration === 0) return 0;
        return $currentTime / $duration;
    }
);

// Queue management functions

export function addToQueue(tracks: Track[]): void {
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);
    const insertPosition = currentIdx + 1 + userCount;
    const addedCount = tracks.length;

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(insertPosition, 0, ...tracks);
        pluginEvents.emit('queueChange', { queue: newQueue, index: currentIdx });
        return newQueue;
    });

    userQueueCount.update(c => c + addedCount);

    if (get(shuffle)) {
        console.log('Updating shuffle in addToQueue');
        shuffledIndices.update(indices => {
            const shifted = indices.map(i => i >= insertPosition ? i + addedCount : i);
            const newIndices = Array.from({ length: addedCount }, (_, i) => insertPosition + i);
            const shuffledNew = shuffleArray(newIndices);
            return [...shifted, ...shuffledNew];
        });
    }
}

export function removeFromQueue(index: number): void {
    const currentIdx = get(queueIndex);

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(index, 1);
        return newQueue;
    });

    if (index < currentIdx) {
        queueIndex.update(i => i - 1);
    }

    if (get(shuffle)) {
        shuffledIndices.update(indices => {
            return indices
                .filter(i => i !== index)
                .map(i => i > index ? i - 1 : i);
        });
    }

    if (get(shuffle)) {
        const actualCurrentQIdx = get(queueIndex);
        const sIndices = get(shuffledIndices);
        const ptr = sIndices.indexOf(actualCurrentQIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }
}

export function reorderQueue(fromIndex: number, toIndex: number): void {
    const currentIdx = get(queueIndex);
    const isShuffle = get(shuffle);

    if (fromIndex === toIndex) return;

    const queueBefore = get(queue);
    if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= queueBefore.length ||
        toIndex >= queueBefore.length
    ) {
        return;
    }

    queue.update(q => {
        const newQueue = [...q];
        const [removed] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, removed);
        return newQueue;
    });

    if (fromIndex === currentIdx) {
        queueIndex.set(toIndex);
    } else if (fromIndex < currentIdx && toIndex >= currentIdx) {
        queueIndex.update(i => i - 1);
    } else if (fromIndex > currentIdx && toIndex <= currentIdx) {
        queueIndex.update(i => i + 1);
    }

    if (isShuffle) {
        shuffledIndices.update(indices => {
            const fromPos = indices.indexOf(fromIndex);
            const toPos = indices.indexOf(toIndex);

            const remapped = indices.map(i => {
                if (i === fromIndex) return toIndex;
                if (fromIndex < toIndex) {
                    if (i > fromIndex && i <= toIndex) return i - 1;
                } else {
                    if (i >= toIndex && i < fromIndex) return i + 1;
                }
                return i;
            });

            if (fromPos !== -1 && toPos !== -1 && fromPos !== toPos) {
                const [moved] = remapped.splice(fromPos, 1);
                remapped.splice(toPos, 0, moved);
            }

            return remapped;
        });

        const currentQueueIdx = get(queueIndex);
        const ptr = get(shuffledIndices).indexOf(currentQueueIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }

    pluginEvents.emit('queueChange', { queue: get(queue), index: get(queueIndex) });
    _schedulePreload();
}

export function clearUpcoming(): void {
    const currentIdx = get(queueIndex);
    queue.update(q => q.slice(0, currentIdx + 1));
    userQueueCount.set(0);

    if (get(shuffle)) {
        shuffledIndices.update(indices => indices.filter(i => i <= currentIdx));
        const ptr = get(shuffledIndices).indexOf(currentIdx);
        shuffledIndex.set(ptr !== -1 ? ptr : 0);
    }
}

export function playFromQueue(index: number): void {
    const q = get(queue);
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);

    if (index >= 0 && index < q.length) {
        const userQueueEnd = currentIdx + 1 + userCount;
        if (index > currentIdx && index <= userQueueEnd) {
            const skipped = index - currentIdx;
            userQueueCount.update(c => Math.max(0, c - skipped));
        } else if (index > userQueueEnd) {
            userQueueCount.set(0);
        }

        queueIndex.set(index);
        playTrack(q[index]);

        if (get(shuffle)) {
            const ptr = get(shuffledIndices).indexOf(index);
            if (ptr !== -1) {
                shuffledIndex.set(ptr);
            }
        }
    }
}

export function isPlaylistPlaying(playlistId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'playlist' && ctx.playlistId === playlistId;
}

export function isAlbumPlaying(albumId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'album' && ctx.albumId === albumId;
}

export function isArtistPlaying(artistName: string): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'artist' && ctx.artistName === artistName;
}

export async function transferPlayback(state: any) {
    if (!state || !state.track) return;

    console.log('[Player] Transferring playback to this device...', state.track.title);

    if (state.deviceId) {
        console.log('[Player] Pausing remote device:', state.deviceId);
        sendRemoteCommand(state.deviceId, 'pause');
    }

    const remoteTrack = state.track;
    let localTrack: any = getTrackByIdSync(Number(remoteTrack.id));

    if (!localTrack) {
        const $library = get(libraryTracks);
        localTrack = $library.find(t =>
            t.title === remoteTrack.title &&
            t.artist === remoteTrack.artist
        );
    }

    if (localTrack) {
        const trackWithLocalCover = {
            ...state.track,
            ...localTrack,
            coverUrl: getTrackCoverSrc(localTrack)
        };

        await playTrack(localTrack, false, state.currentTime);
        if (!state.isPlaying) {
            await pause();
        }
    } else {
        console.warn('[Player] Could not find local track for transfer:', state.track.title);
        addToast(`Cannot transfer: "${state.track.title}" not found in local library`, 'error');
    }
}

export function sendRemoteCommand(targetDeviceId: string, command: string, data?: any) {
    wsStore.send('remote_command', {
        targetDeviceId,
        command,
        data
    });
}

let remoteThrottleTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function throttledRemoteCommand(targetDeviceId: string, command: string, data: any, delay: number) {
    const key = `${targetDeviceId}:${command}`;
    if (remoteThrottleTimers[key]) return;

    sendRemoteCommand(targetDeviceId, command, data);

    remoteThrottleTimers[key] = setTimeout(() => {
        delete remoteThrottleTimers[key];
    }, delay);
}

async function handleRemoteCommand(payload: any) {
    const { command, data } = payload;
    console.log('[Player] Received remote command:', command);

    switch (command) {
        case 'resume':
            await resume();
            break;
        case 'pause':
            await pause();
            break;
        case 'next':
            nextTrack();
            break;
        case 'previous':
            previousTrack();
            break;
        case 'seek':
            if (data?.position != null) {
                seek(data.position);
            }
            break;
        case 'volume':
            if (data?.volume != null) {
                setVolume(data.volume);
            }
            break;
        case 'shuffle':
            if (data?.shuffle != null) {
                if (get(activeBackend) !== 'remote') {
                    if (get(shuffle) !== data.shuffle) toggleShuffle();
                } else {
                    shuffle.set(data.shuffle);
                }
            }
            break;
        case 'repeat':
            if (data?.repeat != null) {
                if (get(activeBackend) !== 'remote') {
                    repeat.set(data.repeat);
                    if (get(activeBackend) === 'native') {
                        nativeAudioSetRepeatOne(data.repeat === 'one').catch(console.error);
                    }
                } else {
                    repeat.set(data.repeat);
                }
            }
            break;
    }
}