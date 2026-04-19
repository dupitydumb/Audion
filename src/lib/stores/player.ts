// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import { wsStore } from './websocket';
import type { Track } from '$lib/api/tauri';
import { getAudioSrc, getAlbumArtSrc, getTrackCoverSrc, convertFileSrc } from '$lib/api/tauri';
import { invoke } from '@tauri-apps/api/core';
import { addToast } from '$lib/stores/toast';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { tracks as libraryTracks, getFullTrack, getAlbumCoverFromTracks, updateTrackCover, getTrackByIdSync } from '$lib/stores/library';
import { fetchTrackCover } from '$lib/services/cover-fetcher';
import { appSettings } from '$lib/stores/settings';
import { equalizer, EQ_FREQUENCIES } from '$lib/stores/equalizer';
import { pluginStore } from '$lib/stores/plugin-store';
import { recordTrackPlay } from '$lib/stores/activity';
import { submitListenbrainzListen } from '$lib/api/tauri';
import { activeRemoteDevice } from '$lib/stores/websocket';

// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// We use a native Rust backend (rodio) for all audio playback.
// This provides consistent performance and high-quality audio processing
// (including EQ) across all supported platforms.
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
    shouldUseNativeAudio,
    type NativePlaybackState
} from '$lib/services/native-audio';

// Interval for polling native playback state
let nativeStatePoller: ReturnType<typeof setInterval> | null = null;

// HTML5 Audio element for streaming (initialized lazily)
let html5Audio: HTMLAudioElement | null = null;

// dash.js player instance for Hi-Res DASH/MPD streaming
let dashPlayer: any | null = null;

// Track which backend is currently active ('native', 'html5', 'remote', or 'none')
export type ActiveBackend = 'native' | 'html5' | 'remote' | 'none';
export const activeBackend = writable<ActiveBackend>('none');

// Track if we should use native audio based on platform/settings
let nativeAudioUsed = false;

type AudioPathKind = 'local' | 'stream' | 'blob' | 'custom-scheme';

function classifyAudioPath(path: string): AudioPathKind {
    if (path.startsWith('blob:')) return 'blob';
    if (path.startsWith('http://') || path.startsWith('https://')) return 'stream';
    if (path.startsWith('file://') || path.startsWith('asset://') || path.startsWith('tauri://')) return 'local';
    if (path.includes('://')) return 'custom-scheme';
    return 'local'; // absolute/relative filesystem path
}

// Lazily load dash.js and create a player instance
async function getDashPlayer(): Promise<any> {
    if (typeof window === 'undefined') throw new Error('No window');

    // Load dash.js from CDN if not already loaded
    if (!(window as any).dashjs) {
        await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.all.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load dash.js'));
            document.head.appendChild(script);
        });
    }

    return (window as any).dashjs;
}

async function playWithDash(blobUrl: string, audioElement: HTMLAudioElement): Promise<void> {

    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }

    const mpdText = await fetch(blobUrl).then(r => r.text());
    URL.revokeObjectURL(blobUrl);

    const bytes = new TextEncoder().encode(mpdText);
    const binary = Array.from(bytes).reduce((acc, byte) => acc + String.fromCharCode(byte), '');
    const dataUrl = 'data:application/dash+xml;base64,' + btoa(binary);

    const dashjs = await getDashPlayer();
    dashPlayer = dashjs.MediaPlayer().create();
    dashPlayer.initialize(audioElement, dataUrl, true);

    dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
        console.error('[Player] dash.js error:', e);
        addToast(`Hi-Res playback error: ${e.error?.message || 'Unknown error'}`, 'error');
    });
}


function getHtml5Audio(): HTMLAudioElement {
    if (!html5Audio && typeof window !== 'undefined') {
        html5Audio = new Audio();
        setupHtml5AudioListeners(html5Audio);
    }
    return html5Audio!;
}

function setupHtml5AudioListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('timeupdate', () => {
        if (get(activeBackend) === 'html5') {
            currentTime.set(audio.currentTime);
        }
    });

    audio.addEventListener('durationchange', () => {
        if (get(activeBackend) === 'html5') {
            if (audio.duration && !isNaN(audio.duration)) {
                duration.set(audio.duration);
            }
        }
    });

    audio.addEventListener('play', () => {
        if (get(activeBackend) === 'html5') {
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
        }
    });

    audio.addEventListener('pause', () => {
        if (get(activeBackend) === 'html5') {
            isPlaying.set(false);
            updateMediaSessionPlaybackState('paused');
        }
    });

    audio.addEventListener('ended', () => {
        if (get(activeBackend) === 'html5') {
            handleTrackEnd();
        }
    });

    audio.addEventListener('error', (e) => {
        if (get(activeBackend) === 'html5') {
            console.error('[Player] HTML5 audio error:', audio.error);
            addToast(`Streaming playback failed: ${audio.error?.message || 'Unknown error'}`, 'error');
        }
    });
}

/**
 * Detect if a track needs HTML5 streaming or native local playback
 */
export function isStreaming(track: Track): boolean {
    // 1. Explicitly local sources (by type or path)
    if (track.source_type === 'local' || track.local_src) return false;

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

// =============================================================================
// PLAYLIST URL RESOLUTION
// =============================================================================
// Many radio stations provide playlist files (.m3u, .m3u8, .pls) that contain
// the actual stream URL. HTML5 <audio> cannot parse these formats directly,
// so we fetch them and extract the real stream URL before playback.
// =============================================================================

/** Known playlist file extensions that need resolution */
const PLAYLIST_EXTENSIONS = ['.m3u', '.m3u8', '.pls'];

/**
 * Check if a URL points to a playlist file that needs resolution.
 * Strips query strings and fragments before checking the extension.
 */
function isPlaylistUrl(url: string): boolean {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return PLAYLIST_EXTENSIONS.some(ext => pathname.endsWith(ext));
    } catch {
        // Fallback for malformed URLs: check the raw string
        const lower = url.toLowerCase().split('?')[0].split('#')[0];
        return PLAYLIST_EXTENSIONS.some(ext => lower.endsWith(ext));
    }
}

/**
 * Parse a .pls playlist file and return the first stream URL.
 * PLS format: INI-like with File1=<url>, File2=<url>, etc.
 */
function parsePlsPlaylist(text: string): string | null {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        const match = trimmed.match(/^File\d+\s*=\s*(.+)$/i);
        if (match && match[1].startsWith('http')) {
            return match[1].trim();
        }
    }
    return null;
}

/**
 * Parse an .m3u/.m3u8 playlist file and return the first stream URL.
 * If the file is a true HLS manifest (contains #EXT-X- directives),
 * returns null so the original URL is used as-is — browsers/WebViews
 * often handle HLS natively.
 */
function parseM3uPlaylist(text: string): string | null {
    const lines = text.split(/\r?\n/);

    // Detect true HLS manifests — these should be played directly
    const isHls = lines.some(l => l.trim().startsWith('#EXT-X-'));
    if (isHls) return null; // Let the browser handle HLS natively

    // Simple M3U: find the first http(s) URL line
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
            return trimmed;
        }
    }
    return null;
}

/**
 * Resolve a playlist URL to a direct stream URL.
 * If the URL isn't a playlist format or resolution fails, returns the
 * original URL unchanged so playback can still be attempted.
 */
async function resolvePlaylistUrl(url: string): Promise<string> {
    if (!isPlaylistUrl(url)) return url;

    console.log(`[Player] Resolving playlist URL: ${url}`);

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000), // 8s timeout for slow servers
        });

        if (!response.ok) {
            console.warn(`[Player] Playlist fetch failed (${response.status}), using original URL`);
            return url;
        }

        const text = await response.text();
        const lower = url.toLowerCase().split('?')[0].split('#')[0];
        let resolved: string | null = null;

        if (lower.endsWith('.pls')) {
            resolved = parsePlsPlaylist(text);
        } else {
            // .m3u or .m3u8
            resolved = parseM3uPlaylist(text);
        }

        if (resolved) {
            console.log(`[Player] Resolved playlist URL: ${url} → ${resolved}`);
            return resolved;
        }

        // Could be HLS or empty playlist — use original URL
        console.log(`[Player] Playlist did not yield a direct URL (may be HLS), using original`);
        return url;

    } catch (err) {
        console.warn(`[Player] Playlist resolution failed, using original URL:`, err);
        return url;
    }
}

// Plugin event emitter (global singleton for plugin system)
export const pluginEvents = new EventEmitter<PluginEvents>();

// Playback Context Tracking
// source from which tracks are being played.
export interface PlaybackContext {

    type: 'playlist' | 'album' | 'artist';

    /** For playlists: playlist ID */
    playlistId?: number;

    /** For albums: album ID */
    albumId?: number;

    /** For artists: artist name */
    artistName?: string;

    /** Display name for UI */
    displayName?: string;
}

/**
 * The current playback context - what source is playing
 */
export const playbackContext = writable<PlaybackContext | null>(null);

/**
 * Current playlist ID (if playing from a playlist)
 */
export const currentPlaylistId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'playlist' ? $ctx.playlistId ?? null : null)
);

/**
 * Current album ID (if playing from an album)
 */
export const currentAlbumId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'album' ? $ctx.albumId ?? null : null)
);

/**
 * Current artist name (if playing from an artist)
 */
export const currentArtistName = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'artist' ? $ctx.artistName ?? null : null)
);

// Current track
export const currentTrack = writable<Track | null>(null);

/**
 * Current track ID (if playing from a track)
 */
export const currentTrackId = derived(currentTrack, ($t) => $t?.id ?? null);

// Playing state
export const isPlaying = writable(false);

// Queue
export const queue = writable<Track[]>([]);
export const queueIndex = writable(0);
// Tracks the number of user-added tracks in the queue (Spotify-like behavior)
export const userQueueCount = writable(0);

// Volume (0-1) - this is the SLIDER value (linear)
// We use a logarithmic curve for actual audio output
export const volume = writable(0.7);

// Convert linear slider value (0-1) to logarithmic audio volume (0-1)
// Human hearing is logarithmic, so linear sliders feel wrong
// Using: audioVolume = sliderValue^2 (quadratic approximation of log curve)
// This makes the slider feel more natural
export function sliderToAudioVolume(sliderValue: number): number {
    // Quadratic curve: softer at low end, more range at high end
    // Alternative: Math.pow(sliderValue, 2.5) for steeper curve
    return Math.pow(sliderValue, 2);
}

// Convert audio volume back to slider value (for display if needed)
export function audioVolumeToSlider(audioVolume: number): number {
    return Math.sqrt(audioVolume);
}

// Playback session tracking
let currentSessionId = 0;

// Track play start time for accurate duration recording
let playStartTime: number = 0;

// Current time and duration
export const currentTime = writable(0);
export const duration = writable(0);

// Shuffle and repeat
export const shuffle = writable(false);
export const repeat = writable<'none' | 'one' | 'all'>('none');

// Subscribe to EQ changes to update native backend
// Debounced subscription: batch rapid EQ changes and avoid thrashing
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

    // Check if we should use native audio
    nativeAudioUsed = await shouldUseNativeAudio();
    console.log(`[Player] Native audio preferred: ${nativeAudioUsed}`);

    // Start/stop poller based on playback state and notify remote devices
    isPlaying.subscribe((playing) => {
        // Force an immediate broadcast when play/pause state changes
        // so remote Connect Panels stay perfectly in sync
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
        if (html5Audio) {
            html5Audio.volume = audioVol;
        }

        // Update Native backend
        if (nativeAudioUsed) {
            nativeAudioSetVolume(audioVol).catch(err => {
                console.warn('[Player] Failed to set native volume:', err);
            });
        }
    });

    // Force sync initial volume to native backend so it matches
    // the frontend's logarithmic curve from the start, before any track plays.
    if (nativeAudioUsed) {
        nativeAudioSetVolume(sliderToAudioVolume(get(volume))).catch(err => {
            console.warn('[Player] Failed to set initial native volume:', err);
        });
    }

    // If native backend is available, apply current EQ state once to ensure
    // native side has the latest settings (prevents mismatch / thrash on first play)
    if (nativeAudioUsed) {
        try {
            // Use equalizer.getState() to get the current stored state
            const state = equalizer.getState();
            nativeAudioSetRepeatOne(get(repeat) === 'one').catch(console.error);
            await nativeAudioSetEq(state);
            console.log('[Player] Applied initial EQ settings to native backend');
        } catch (err) {
            console.warn('[Player] Failed to apply initial EQ settings:', err);
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

    // Sub due to initialization of active setting
    activeBackend.subscribe(b => {
        if (b === 'remote') {
            stopStatePoller(); // Ensure local poller is off
        }
    });
}

function handleRemotePlayerState(payload: any) {
    const isLocalPlaying = get(isPlaying) && get(activeBackend) !== 'remote';

    // Auto-switch to tracking the remote device if we are idle and it's playing
    if (!isLocalPlaying && payload.isPlaying && payload.deviceId) {
        if (get(activeBackend) !== 'remote') {
            activeBackend.set('remote');
            activeRemoteDevice.set(payload.deviceId);
            console.log(`[Player] Auto-switched to remote session for device: ${payload.deviceId}`);
        }
    }

    // If we are tracking THIS remote device, pipe the state into the local UI variables
    if (get(activeBackend) === 'remote' && get(activeRemoteDevice) === payload.deviceId) {
        if (payload.track) {
            const remoteTrack = payload.track;
            const currentObj = get(currentTrack);
            const remoteTrackId = Number(remoteTrack.id);

            if (!currentObj || Number(currentObj.id) !== remoteTrackId) {
                // Try to resolve track locally for better cover art (Fast O(1) lookup)
                let localTrack: any = getTrackByIdSync(remoteTrackId);

                // Falling back to O(N) search only if ID fails (rare in synced libraries)
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
                    id: remoteTrackId, // Ensure ID is a number
                    track_cover: localTrack ? getTrackCoverSrc(localTrack) : remoteTrack.coverUrl,
                } as any);
            }
        } else {
            if (get(currentTrack) !== null) currentTrack.set(null);
        }

        // Only update these if they changed to prevent spamming subscribers
        if (get(isPlaying) !== payload.isPlaying) isPlaying.set(payload.isPlaying);

        // Only update time if the difference is significant (>250ms or specifically requested)
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

                // Poll for audio events 
                const event = await nativeAudioPollEvent();

                if (event.type === 'TrackFinished') {
                    // Track ended naturally, nothing was preloaded.

                    handleTrackEnd();
                } else if (event.type === 'TrackAdvanced') {
                    // Gapless advance: audio backend already moved to the next track.
                    // We must NOT call nativeAudioPlay() — that would restart it.
                    // Just advance the UI queue index and update metadata.
                    handleGaplessAdvance();
                } else if (event.type === 'StateChanged') {
                    // Backend confirmed a seek or loop — update UI immediately
                    currentTime.set(event.data.position);
                    if (event.data.position === 0) {
                        // repeat-one loop — reset isPlaying to true in case UI lost sync
                        isPlaying.set(true);
                        updateMediaSessionPlaybackState('playing');
                    }
                }


                // Sync isPlaying state — ignore false when duration is 0 (track still loading)
                if (state.is_playing !== get(isPlaying)) {
                    if (state.is_playing === false && state.duration === 0 && state.position === 0) {
                        // Backend hasn't loaded track yet, don't trust this state
                    } else {
                        isPlaying.set(state.is_playing);
                    }
                }

                // Emit time update for plugins
                pluginEvents.emit('timeUpdate', {
                    currentTime: state.position,
                    duration: state.duration
                });
            } else if (get(activeBackend) === 'html5' && html5Audio) {
                const pos = html5Audio.currentTime;
                const dur = html5Audio.duration || 0;

                currentTime.set(pos);
                if (dur > 0 && !isNaN(dur)) {
                    duration.set(dur);
                }

                // Sync isPlaying state (HTML5 events should handle this, but poller is a good fallback)
                const playing = !html5Audio.paused && !html5Audio.ended;
                if (playing !== get(isPlaying)) {
                    // Do not sync HTML5 state if activeBackend changed
                    if (get(activeBackend) === 'html5') {
                        isPlaying.set(playing);
                    }
                }

                // Emit time update for plugins
                pluginEvents.emit('timeUpdate', {
                    currentTime: pos,
                    duration: dur
                });
            } else if (get(activeBackend) === 'remote') {
                // If remote, do NOT poll native audio. We rely purely on WebSocket pushes.
            }

            // Sync Media Session position if something is playing
            if (get(isPlaying)) {
                updateMediaSessionPosition();
            }

            // Broadcast state to WebSocket (throttled to ~2s)
            broadcastState();

        } catch (e) {
            console.error('[Player] Poller error:', e);
        }
    }, POLL_INTERVAL_MS);
}

let lastBroadcast = 0;
function broadcastState(force = false) {
    // CRITICAL: Do not broadcast if this device is not the owner of the playback.
    // This prevents infinite state "echo" loops across devices.
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

// cleanup function for app unmount or hot reload
export function cleanupPlayer(): void {
    console.log('[Player] Cleaning up player resources');
    stopStatePoller();
    nativeAudioStop().catch(console.error);

    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }

    // Cleanup HTML5
    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }

    // Reset stores
    activeBackend.set('none');
    isPlaying.set(false);
    currentTrack.set(null);
    currentTime.set(0);
    duration.set(0);

    // Clear Media Session
    updateMediaSessionPlaybackState('none');
    if ('mediaSession' in navigator) {
        try { navigator.mediaSession.metadata = null; } catch (_) { /* ignore */ }
    }
}

export function shutdownPlayer(): void {
    cleanupPlayer();
}

// ── Media Session API (Now Playing notification / lock screen controls) ──
// Works in Android WebView, desktop browsers, and any environment that supports
// the Web MediaSession API. Provides notification shade artwork, lock screen
// controls, and hardware media button support.

let mediaSessionInitialized = false;

function initMediaSessionHandlers(): void {
    if (mediaSessionInitialized || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    ms.setActionHandler('play', () => togglePlay());
    ms.setActionHandler('pause', () => togglePlay());
    ms.setActionHandler('previoustrack', () => previousTrack());
    ms.setActionHandler('nexttrack', () => nextTrack());
    ms.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
            const dur = get(duration);
            if (dur > 0) {
                nativeAudioSeek(details.seekTime / dur).catch(console.error);
            }
        }
    });
    ms.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            nativeAudioSeek(Math.max(0, cur - offset) / dur).catch(console.error);
        }
    });
    ms.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = get(currentTime);
        const dur = get(duration);
        if (dur > 0) {
            nativeAudioSeek(Math.min(dur, cur + offset) / dur).catch(console.error);
        }
    });

    mediaSessionInitialized = true;
    console.log('[Player] MediaSession action handlers registered');
}

async function updateMediaSessionMetadata(track: Track): Promise<void> {
    if (!('mediaSession' in navigator)) return;

    // Initialize handlers on first use (needs user gesture context)
    initMediaSessionHandlers();

    console.log('[MediaSession] Updating metadata for:', track.title);

    // Resolve artwork URL
    const artworkSources: MediaImage[] = [];

    // Specifically for MediaSession, we want to avoid asset:// URLs if possible
    // because Android's system notification usually can't resolve them.
    // AND we want to avoid large Base64 strings to avoid Binder limit crashes.
    let artUrl: string | null = null;

    if (track.track_cover && track.track_cover.startsWith('data:')) {
        try {
            console.log('[MediaSession] Saving Base64 artwork to temp file...');
            const tempPath = await invoke<string>('save_notification_image', { dataUri: track.track_cover });
            artUrl = convertFileSrc(tempPath);
            console.log('[MediaSession] Artwork saved to:', artUrl);
        } catch (e) {
            console.error('[MediaSession] Failed to save notification image:', e);
            // Fallback to Base64 if saving fails (might still crash if too big)
            artUrl = track.track_cover;
        }
    } else {
        artUrl = getTrackCoverSrc(track);
    }

    // Also try album cover as fallback if still no art
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
    let rate = 1;

    // Basic validity check
    if (!dur || !isFinite(dur) || isNaN(dur)) {
        // Only log if it's 0 after playback started (might be intentional for a moment)
        return;
    }

    try {
        // Ensure position is within bounds [0, duration]
        const safePos = Math.max(0, Math.min(pos, dur));

        navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: rate,
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
        if (durationPlayed > 5) { // Only record if played for more than 5 seconds
            recordTrackPlay(previousTrackObj.id, previousTrackObj.album_id ?? null, durationPlayed);
            // ListenBrainz: scrobble if >= 50 % of track duration or 4 minutes played
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

    // ListenBrainz: notify 'playing_now'
    if (get(appSettings).listenBrainzEnabled) {
        submitListenbrainzListen(
            track.artist ?? 'Unknown Artist',
            track.title ?? 'Unknown',
            track.album,
            track.duration,
            true,
        ).catch(e => console.warn('[ListenBrainz] Now-playing failed:', e));
    }

    // Get full track with base64 data URI for plugins
    const fullTrack = await getFullTrack(track.id, true);

    // Check session ID before proceeding after await
    if (sessionId !== currentSessionId) return;

    const trackForPlugins = fullTrack || track;
    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack: previousTrackObj });

    // Update Media Session early so the UI reflects the change immediately
    // even if the audio engine takes a moment to initialize or resolve streams.
    console.log('[Player] Preparing MediaSession metadata for:', trackForPlugins.title);
    await updateMediaSessionMetadata(trackForPlugins);

    // AUTO-FETCH COVER LOGIC
    // If the track is missing a cover, attempt to fetch it from an external source.
    // This runs asynchronously and does not block playback.
    if (!track.track_cover_path && !track.cover_url) {
        fetchTrackCover(track).then(async (newCoverUrl) => {
            if (newCoverUrl) {
                console.log(`[Player] Auto-fetched cover for "${track.title}": ${newCoverUrl}`);

                // 1. Persist to Backend Database
                try {
                    await invoke('update_track_cover_url', { trackId: track.id, coverUrl: newCoverUrl });
                } catch (e) {
                    console.error('[Player] Failed to persist fetched cover to database:', e);
                }

                // 2. Update reactive library store (metadata, cache, and main list)
                updateTrackCover(track.id, newCoverUrl);

                // 3. Update current player state if still playing the same track
                const current = get(currentTrack);
                if (current && current.id === track.id) {
                    currentTrack.update(t => t ? { ...t, cover_url: newCoverUrl } : t);

                    // 4. Update Media Session (system notification) immediately with new art
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

        // Fallback for plugins using stream_url
        if (!audioPath && (track as any).stream_url) {
            audioPath = (track as any).stream_url;
        }

        // Fallback for plugins using external_id as URL (common in radio plugins)
        if (!audioPath && track.external_id && (track.external_id.startsWith('http://') || track.external_id.startsWith('https://'))) {
            audioPath = track.external_id;
        }

        const streaming = isStreaming(track) || !!(track as any).stream_url;

        // Prep the backends
        if (streaming) {
            // Ensure we have a valid path
            if (!audioPath) {
                throw new Error('No audio path or stream URL found for track');
            }

            // Stop native audio
            await nativeAudioStop().catch(() => { });

            // Resolve custom schemes (like tidal://) to HTTP or blob URLs
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

            // Start HTML5
            const audio = getHtml5Audio();

            // Reset src to avoid overlap issues
            audio.pause();

            // Destroy any existing dash player before switching tracks
            if (dashPlayer) {
                try { dashPlayer.destroy(); } catch (_) { }
                dashPlayer = null;
            }

            const finalKind = classifyAudioPath(audioPath);

            if (finalKind === 'blob') {
                audio.volume = sliderToAudioVolume(get(volume));

                await playWithDash(audioPath, audio);
                console.log('[Player] dash.js DASH streaming started:', track.title);
            } else {
                // Resolve playlist-format URLs (.m3u, .pls, .m3u8) to direct stream URLs
                audioPath = await resolvePlaylistUrl(audioPath);

                audio.src = audioPath;
                audio.volume = sliderToAudioVolume(get(volume));

                // Wrap play in a handler to catch AbortError (common with rapid skipping)
                try {
                    await audio.play();
                } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') {
                        console.warn('[Player] Playback aborted (likely replaced by new track)', err);
                    } else {
                        throw err;
                    }
                }

                if (startTime > 0) {
                    audio.currentTime = startTime;
                }

                console.log('[Player] HTML5 streaming started:', track.title);
            }

            activeBackend.set('html5');
        } else {
            if (!audioPath) {
                throw new Error('No local audio path found for track');
            }

            if (nativeAudioUsed) {
                // Stop HTML5 audio
                if (html5Audio) {
                    html5Audio.pause();
                    html5Audio.src = '';
                }

                // Play via native backend
                await nativeAudioPlay(audioPath, (track as any).replay_gain_db ?? null);

                // Sync volume
                const vol = sliderToAudioVolume(get(volume));
                await nativeAudioSetVolume(vol);

                // Seek if starting from a specific position (for playback transfer)
                if (startTime > 0 && track.duration) {
                    await nativeAudioSeek(startTime / track.duration);
                }

                // Preload next track for gapless playback
                _schedulePreload();

                activeBackend.set('native');
                console.log('[Player] Native playback started:', track.title);
            } else {
                // Fallback to HTML5 via convertFileSrc if native is disabled (e.g. on macOS)
                const audio = getHtml5Audio();
                audio.pause();

                // Use convertFileSrc to get a URL that the browser can play
                audio.src = convertFileSrc(audioPath);
                audio.volume = sliderToAudioVolume(get(volume));

                await audio.play();
                if (startTime > 0) {
                    audio.currentTime = startTime;
                }
                activeBackend.set('html5');
                console.log('[Player] Local playback started via HTML5:', track.title);
            }
        }

        currentTrack.set(trackForPlugins);
        currentTime.set(startTime);
        duration.set(track.duration || 0);
        isPlaying.set(true);

        // Update Media Session state and position (metadata was updated earlier)
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

// Helper to shuffle array (Fisher-Yates)
function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Play a list of tracks starting at index
export function playTracks(
    tracks: Track[],
    startIndex: number = 0,
    context?: PlaybackContext
): void {
    const currentQueue = get(queue);

    // Check if the new tracks are effectively the same as the current queue
    // usage of JSON.stringify is a simple way to check deep equality for arrays of objects
    // optimization: check length and first/last ID first to avoid expensive stringify
    let isSameQueue = false;

    if (tracks.length === currentQueue.length) {
        if (tracks.length === 0) {
            isSameQueue = true;
        } else {
            // Check first and last ID match
            if (tracks[0].id === currentQueue[0].id &&
                tracks[tracks.length - 1].id === currentQueue[currentQueue.length - 1].id) {
                // If ends match, do a full check to be sure (or just trust it for performance?)
                // Let's do a quick ID check
                isSameQueue = tracks.every((t, i) => t.id === currentQueue[i].id);
            }
        }
    }

    // Update queue only if different (though setting it again might be harmless store-update-wise, 
    // we want to know if it CHANGED for shuffle logic)
    if (!isSameQueue) {
        queue.set(tracks);
    }

    queueIndex.set(startIndex);
    userQueueCount.set(0); // Reset user queue when starting fresh context

    // Set playback context
    playbackContext.set(context ?? null);

    // Shuffle Logic
    if (get(shuffle)) {
        // FORCE START Logic:
        // When user plays a track (even if it's in the same queue), we want that track to play NOW,
        // and we want ALL OTHER tracks to be in the "Next Up" queue (shuffled).
        // We do NOT want to preserve the old shuffle order because jumping to a track "late" in the 
        // shuffle order causes all previous tracks to be "skipped" into history.

        // 1. Get all indices
        const allIndices = tracks.map((_, i) => i);

        // 2. Remove startIndex (the track we want to play)
        const otherIndices = allIndices.filter(i => i !== startIndex);

        // 3. Shuffle the rest
        const shuffledOthers = shuffleArray(otherIndices);

        // 4. Construct new order: [startIndex, ...shuffledRest]
        const newShuffledIndices = [startIndex, ...shuffledOthers];

        console.log(`Regenerating shuffle with forced start: ${startIndex}`);
        shuffledIndices.set(newShuffledIndices);

        // 5. Set cursor to 0 (since our track is now at index 0)
        shuffledIndex.set(0);
    }

    // Emit queueChange event for plugins
    // If same queue, we might still want to emit if the logical "context" changed, 
    // but usually plugins care about the list content.
    // If we filtered or sorted the SAME list, isSameQueue might be false (order matters).
    // Our ID check strictly checks order. So sorting changes the queue.
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
            getHtml5Audio().pause();
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
            // App just opened, no audio loaded yet - start playback from saved position
            await playTrack(track, false, get(currentTime));
        } else if (get(activeBackend) === 'html5') {
            await getHtml5Audio().play();
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

/**
 * Advance queue index stores (shuffledIndex, userQueueCount) and return the
 * next absolute queue index. Returns null if playback should stop or hand off
 * to autoplay (caller must handle those cases).
 *
 * @param dry — if true, compute the next index without writing any stores.
 *              Used by _schedulePreload() to peek ahead.
 */
function _advanceQueueIndex(dry = false): number | null {
    const q = get(queue);
    const rep = get(repeat);
    const shuf = get(shuffle);
    const userCount = get(userQueueCount);
    const settings = get(appSettings);
    let idx = get(queueIndex);

    if (q.length === 0) return null;

    // Check if we have user-queued tracks to play first
    if (userCount > 0) {
        // Play next user-queued track sequentially (always sequential for user queue)
        // User queue tracks are inserted directly after current track in the main queue list.
        // So we just increment normal index.
        idx = idx + 1;
        if (!dry) userQueueCount.update(c => Math.max(0, c - 1));

    } else if (shuf) {
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex) + 1;

        if (shufIdx >= shufIndices.length) {
            if (rep === 'all') {
                shufIdx = 0;
            } else {
                // End of shuffle — caller decides autoplay/stop
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
                // End of queue — caller decides autoplay/stop
                return null;
            }
        }
    }

    return idx;
}

// Next track
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
        // End of queue/shuffle with no repeat
        if (settings.autoplay) {
            playRandomFromLibrary();
        } else {
            // Stop at end
            isPlaying.set(false);
        }
        return;
    }

    queueIndex.set(idx);
    playTrack(q[idx]);
}

// Play a random track from the library (for autoplay feature)
function playRandomFromLibrary(): void {
    const allTracks = get(libraryTracks);
    if (allTracks.length === 0) {
        isPlaying.set(false);
        return;
    }

    // Pick a random track, avoiding the current one if possible
    const current = get(currentTrack);
    let availableTracks = allTracks;

    if (current && allTracks.length > 1) {
        availableTracks = allTracks.filter(t => t.id !== current.id);
    }

    const randomIndex = Math.floor(Math.random() * availableTracks.length);
    const randomTrack = availableTracks[randomIndex];

    // Add to queue and play
    queue.update(q => [...q, randomTrack]);
    const newQueue = get(queue);
    queueIndex.set(newQueue.length - 1);

    playTrack(randomTrack);
}

// Previous track
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

    // If more than 3 seconds in, restart current track
    try {
        let pos = get(currentTime);

        if (pos > 3) {
            if (get(activeBackend) === 'html5') {
                getHtml5Audio().currentTime = 0;
            } else if (get(activeBackend) === 'native') {
                await nativeAudioSeek(0);
            }
            return;
        }
    } catch (err) {
        console.error('[Player] Restart track failed:', err);
    }

    if (shuf) {
        // Persistent Shuffle Previous
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

// Seek to position (0-1)
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
            const audio = getHtml5Audio();
            if (audio.duration) {
                audio.currentTime = position * audio.duration;
            }
        } else if (get(activeBackend) === 'native') {
            await nativeAudioSeek(position);
            // Update UI immediately — poller is stopped while paused
            if (!get(isPlaying)) {
                currentTime.set(position * get(duration));
            }
        }
        updateMediaSessionPosition();
    } catch (err) {
        console.error('[Player] Seek failed:', err);
    }
}

// Set volume (slider value 0-1, will be converted to logarithmic for audio)
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
        // Update HTML5 volume
        if (html5Audio) {
            html5Audio.volume = vol;
        }
        // Update native volume
        if (nativeAudioUsed) {
            await nativeAudioSetVolume(vol);
        }
    } catch (err) {
        console.error('[Player] Volume set failed:', err);
    }
}

// Toggle shuffle
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
            // Turn ON: Generate shuffled order
            const q = get(queue);
            const currentIdx = get(queueIndex);

            // Create indices array
            const indices = q.map((_, i) => i);
            const shuffled = shuffleArray(indices);

            // Set shuffled indices
            console.log('Regenerating shuffle in toggleShuffle');
            shuffledIndices.set(shuffled);

            // Find current track in shuffled list to maintain continuity
            const ptr = shuffled.indexOf(currentIdx);
            shuffledIndex.set(ptr !== -1 ? ptr : 0);
        } else {
            // Turn OFF: Just stop using shuffle
            // QueueIndex is already correct
        }

        return newState;
    });
}

// Cycle repeat mode
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

// Handle track end
function handleTrackEnd(): void {
    // Record play for the track that just ended
    const track = get(currentTrack);
    if (track && playStartTime > 0) {
        const durationPlayed = Math.floor((Date.now() - playStartTime) / 1000);
        if (durationPlayed > 5) {
            recordTrackPlay(track.id, track.album_id ?? null, durationPlayed);
            // ListenBrainz: scrobble if >= 50 % of duration or 4 minutes
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
        playStartTime = 0; // Reset so playTrack doesn't double-record
    }
    nextTrack();
}

// Handle gapless advance — audio backend already playing the next track.
function handleGaplessAdvance(): void {
    const q = get(queue);

    // Record play for the track that just ended
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
        // Nothing to advance to — treat as track finished
        handleTrackEnd();
        return;
    }

    queueIndex.set(idx);
    const nextTrackObj = q[idx];
    if (!nextTrackObj) return;

    _advanceUiToTrack(nextTrackObj);
}

// Update all UI state for a track without touching the audio backend.
async function _advanceUiToTrack(track: Track): Promise<void> {
    const previousTrackObj = get(currentTrack);

    // Full track for plugins / cover art
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

    // Schedule preload of the NEXT-next track to keep gapless chain alive
    _schedulePreload();

    // ListenBrainz now-playing
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
// After playTrack() starts a local file on the native backend, we immediately
// tell the backend to open and buffer the NEXT track in the queue.
// The backend appends it to its internal rodio queue so the transition is
// seamless — no gap between tracks.
//
// We call this every time a new track starts. The backend ignores duplicate
// preloads for the same path.
// =============================================================================

function _schedulePreload(): void {
    if (get(activeBackend) !== 'native') return;

    const q = get(queue);
    const nextIdx = _advanceQueueIndex(true); // dry run — no store writes

    if (nextIdx === null || nextIdx >= q.length) return;

    const nextTrackObj = q[nextIdx];
    if (!nextTrackObj || isStreaming(nextTrackObj)) return;

    const nextPath = nextTrackObj.local_src || nextTrackObj.path;
    if (!nextPath) return;

    nativeAudioPreload(nextPath, (nextTrackObj as any).replay_gain_db ?? null).catch(e => {
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

// Add tracks to queue (Spotify-like: after current track + previously user-added tracks)
export function addToQueue(tracks: Track[]): void {
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);
    // Insert position: after current track + user-added tracks
    const insertPosition = currentIdx + 1 + userCount;
    const addedCount = tracks.length;

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(insertPosition, 0, ...tracks);

        // Emit queueChange event for plugins
        pluginEvents.emit('queueChange', { queue: newQueue, index: currentIdx });

        return newQueue;
    });

    // Update user queue count
    userQueueCount.update(c => c + addedCount);

    // Update shuffled indices to reflect the shift in queue
    if (get(shuffle)) {
        console.log('Updating shuffle in addToQueue');
        shuffledIndices.update(indices => {
            // 1. Shift existing indices that are after insertion point
            const shifted = indices.map(i => i >= insertPosition ? i + addedCount : i);

            // 2. Add new indices (we append them to the end of shuffled list to not disrupt current flow)
            // The new tracks are at [insertPosition, insertPosition + addedCount - 1]
            const newIndices = Array.from({ length: addedCount }, (_, i) => insertPosition + i);

            // We could shuffle 'newIndices' before appending if we want them random
            // But let's keep them together for now or shuffle them
            // Let's shuffle the new batch so they are random relative to each other at least
            const shuffledNew = shuffleArray(newIndices);

            return [...shifted, ...shuffledNew];
        });
    }
}

// Remove track from queue by index
export function removeFromQueue(index: number): void {
    const currentIdx = get(queueIndex);

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(index, 1);
        return newQueue;
    });

    // Adjust current index if needed
    if (index < currentIdx) {
        queueIndex.update(i => i - 1);
    }

    // Update shuffle indices
    if (get(shuffle)) {
        shuffledIndices.update(indices => {
            // Remove the deleted index and shift others
            return indices
                .filter(i => i !== index)
                .map(i => i > index ? i - 1 : i);
        });

        // Handle shuffledIndex pointer if strictly necessary (e.g. if we removed the current shuffled track)
        // But usually queueIndex update handles the 'current track' logic.
        // If we removed the track we were PLAYING, we might need to find where we are now.
        // But the player usually keeps playing the same audio element until explicitly changed.

        // Sync shuffledIndex to where currentIdx is now
        const newCurrentIdx = index < currentIdx ? currentIdx - 1 : currentIdx;
        // If we removed the current track (index === currentIdx), then we are now pointing to the next one (which shifted down)
        // but queueIndex might still be pointing to the same slot number (if it wasn't last).

        // Safest is to just re-find currentIdx in shuffled list?
        // But wait, if we are playing, we want to stay consistent.
        // Let's rely on 'nextTrack' logic to use the pointers.
        // But we should ensure shuffledIndex points to the correct shuffled slot that corresponds to queueIndex.
        // However, updating the list (filter/map) preserved relative order of remaining items.
        // So the pointer `shuffledIndex` (which is an index into shuffledIndices array) should mostly be fine,
        // UNLESS we removed an item *before* the current shuffled position in the SHUFFLED list.

        // Actually, shuffledIndex is "index in the shuffled array".
        // If we removed an item that was at shuffledIndices[0] and we are at shuffledIndices[5],
        // then our pointer is now off by 1?
        // YES. We need to know WHICH item in shuffledIndices was removed.
        const ptr = get(shuffledIndex);
        const indices = get(shuffledIndices); // This is the OLD list (before update runs technically, but inside update we return new)
        // Wait, 'update' callback gets the old value.
        // We can't easily sync the separate store 'shuffledIndex' inside 'shuffledIndices.update'.
        // We should do it outside.
    }

    // Fix shuffledIndex pointer
    if (get(shuffle)) {
        // We need to find where the current track is now in the shuffled list
        // The current track index in queue might have changed (handled above).
        const actualCurrentQIdx = get(queueIndex);
        const sIndices = get(shuffledIndices);
        const ptr = sIndices.indexOf(actualCurrentQIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }
}

// Reorder queue (move track from one position to another)
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

    // Adjust current index
    if (fromIndex === currentIdx) {
        queueIndex.set(toIndex);
    } else if (fromIndex < currentIdx && toIndex >= currentIdx) {
        queueIndex.update(i => i - 1);
    } else if (fromIndex > currentIdx && toIndex <= currentIdx) {
        queueIndex.update(i => i + 1);
    }

    // Update shuffle indices
    // This is tricky. An item moved from A to B.
    // Indices between A and B shifted.
    // The item at 'fromIndex' is now at 'toIndex'.
    if (isShuffle) {
        shuffledIndices.update(indices => {
            const fromPos = indices.indexOf(fromIndex);
            const toPos = indices.indexOf(toIndex);

            // First remap numeric queue indices so they still reference
            // the same tracks after the queue array reorder.
            const remapped = indices.map(i => {
                if (i === fromIndex) return toIndex;
                if (fromIndex < toIndex) {
                    // Moved down: items between from+1 and to shift up (-1)
                    if (i > fromIndex && i <= toIndex) return i - 1;
                } else {
                    // Moved up: items between to and from-1 shift down (+1)
                    if (i >= toIndex && i < fromIndex) return i + 1;
                }
                return i;
            });

            // Then reflect manual user intent in the visible shuffled order.
            if (fromPos !== -1 && toPos !== -1 && fromPos !== toPos) {
                const [moved] = remapped.splice(fromPos, 1);
                remapped.splice(toPos, 0, moved);
            }

            return remapped;
        });

        // Keep shuffled cursor aligned to the currently playing queue index.
        const currentQueueIdx = get(queueIndex);
        const ptr = get(shuffledIndices).indexOf(currentQueueIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }

    pluginEvents.emit('queueChange', { queue: get(queue), index: get(queueIndex) });
    _schedulePreload();
}

// Clear upcoming queue (keep history)
export function clearUpcoming(): void {
    const currentIdx = get(queueIndex);
    queue.update(q => q.slice(0, currentIdx + 1));
    userQueueCount.set(0); // Clear user queue count

    // Update shuffle: remove indices that are now out of bounds
    if (get(shuffle)) {
        shuffledIndices.update(indices => indices.filter(i => i <= currentIdx));
        // And reset/sync pointer
        const ptr = get(shuffledIndices).indexOf(currentIdx);
        shuffledIndex.set(ptr !== -1 ? ptr : 0);
    }
}

// Play from specific index in queue
export function playFromQueue(index: number): void {
    const q = get(queue);
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);

    if (index >= 0 && index < q.length) {
        // Calculate how many user-queued tracks are being skipped
        const userQueueEnd = currentIdx + 1 + userCount;
        if (index > currentIdx && index <= userQueueEnd) {
            // Skipping within user queue
            const skipped = index - currentIdx;
            userQueueCount.update(c => Math.max(0, c - skipped));
        } else if (index > userQueueEnd) {
            // Skipping past user queue entirely
            userQueueCount.set(0);
        }
        // If jumping backwards, keep user queue count as is

        queueIndex.set(index);
        playTrack(q[index]);

        // Sync shuffle pointer
        if (get(shuffle)) {
            const ptr = get(shuffledIndices).indexOf(index);
            if (ptr !== -1) {
                shuffledIndex.set(ptr);
            } else {
                // If not found in shuffle list (weird state), regenerate or append?
                // Should be there.
            }
        }
    }
}

/**
 * Helper to check if a specific playlist is currently playing
 */
export function isPlaylistPlaying(playlistId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'playlist' && ctx.playlistId === playlistId;
}

/**
 * Helper to check if a specific album is currently playing
 */
export function isAlbumPlaying(albumId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'album' && ctx.albumId === albumId;
}

/**
 * Helper to check if a specific artist is currently playing
 */
export function isArtistPlaying(artistName: string): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'artist' && ctx.artistName === artistName;
}

/**
 * Transfer playback from a remote device to this one.
 */
export async function transferPlayback(state: any) {
    if (!state || !state.track) return;

    console.log('[Player] Transferring playback to this device...', state.track.title);

    // 1. Stop remote playback (by sending a command to specific device)
    if (state.deviceId) {
        console.log('[Player] Pausing remote device:', state.deviceId);
        sendRemoteCommand(state.deviceId, 'pause');
    }

    // 2. Resolve the local track object if possible (Fast ID lookup first)
    const remoteTrack = state.track;
    let localTrack: any = getTrackByIdSync(Number(remoteTrack.id));

    if (!localTrack) {
        // Falling back to O(N) search
        const $library = get(libraryTracks);
        localTrack = $library.find(t =>
            t.title === remoteTrack.title &&
            t.artist === remoteTrack.artist
        );
    }

    if (localTrack) {
        // Use local cover for better reliability
        // We spread localTrack to have full metadata (album_id, path, etc.)
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
        // If not found in local library, we might need to "External Track" play (later feature)
        console.warn('[Player] Could not find local track for transfer:', state.track.title);
        addToast(`Cannot transfer: "${state.track.title}" not found in local library`, 'error');
    }
}

/**
 * Control a remote device.
 */
export function sendRemoteCommand(targetDeviceId: string, command: string, data?: any) {
    wsStore.send('remote_command', {
        targetDeviceId,
        command,
        data
    });
}

/**
 * Throttled version of sendRemoteCommand for high-frequency events like seeking or volume slides.
 */
let remoteThrottleTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function throttledRemoteCommand(targetDeviceId: string, command: string, data: any, delay: number) {
    const key = `${targetDeviceId}:${command}`;
    if (remoteThrottleTimers[key]) return;

    sendRemoteCommand(targetDeviceId, command, data);

    remoteThrottleTimers[key] = setTimeout(() => {
        delete remoteThrottleTimers[key];
    }, delay);
}

/**
 * Handle a remote command received via WebSocket.
 */
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
                // If local, use toggleShuffle to handle index regeneration
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
                    // Cycle until match? Or just set directly
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
