// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import { getAudioSrc, getAlbumArtSrc, getTrackCoverSrc } from '$lib/api/tauri';
import { addToast } from '$lib/stores/toast';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { tracks as libraryTracks, getFullTrack, getAlbumCoverFromTracks } from '$lib/stores/library';
import { appSettings } from '$lib/stores/settings';
import { equalizer, EQ_FREQUENCIES } from '$lib/stores/equalizer';
import { pluginStore } from '$lib/stores/plugin-store';

// =============================================================================
// NATIVE AUDIO BACKEND
// =============================================================================
// We use a native Rust backend (rodio) for all audio playback.
// This provides consistent performance and high-quality audio processing
// (including EQ) across all supported platforms.
// =============================================================================
import {
    nativeAudioPlay,
    nativeAudioPause,
    nativeAudioResume,
    nativeAudioStop,
    nativeAudioSetVolume,
    nativeAudioSeek,
    nativeAudioGetState,
    nativeAudioIsFinished,
    nativeAudioSetEq,
    type NativePlaybackState
} from '$lib/services/native-audio';

// Interval for polling native playback state
let nativeStatePoller: ReturnType<typeof setInterval> | null = null;

// HTML5 Audio element for streaming (initialized lazily)
let html5Audio: HTMLAudioElement | null = null;

function getHtml5Audio(): HTMLAudioElement {
    if (!html5Audio && typeof window !== 'undefined') {
        html5Audio = new Audio();
        setupHtml5AudioListeners(html5Audio);
    }
    return html5Audio!;
}

function setupHtml5AudioListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('timeupdate', () => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            currentTime.set(audio.currentTime);
        }
    });

    audio.addEventListener('durationchange', () => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            if (audio.duration && !isNaN(audio.duration)) {
                duration.set(audio.duration);
            }
        }
    });

    audio.addEventListener('play', () => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            isPlaying.set(true);
            updateMediaSessionPlaybackState('playing');
        }
    });

    audio.addEventListener('pause', () => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            isPlaying.set(false);
            updateMediaSessionPlaybackState('paused');
        }
    });

    audio.addEventListener('ended', () => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            handleTrackEnd();
        }
    });

    audio.addEventListener('error', (e) => {
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
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

// Current time and duration
export const currentTime = writable(0);
export const duration = writable(0);

// Shuffle and repeat
export const shuffle = writable(false);
export const repeat = writable<'none' | 'one' | 'all'>('none');

// Subscribe to EQ changes to update native backend
equalizer.subscribe((state) => {
    const track = get(currentTrack);
    // EQ only works on native backend for now
    if (track && !isStreaming(track)) {
        nativeAudioSetEq(state).catch(err => {
            console.error('[EQ] Failed to apply settings:', err);
        });
    }
});

// =============================================================================
// BACKEND INITIALIZATION
// =============================================================================
export async function initAudioBackend(): Promise<void> {
    console.log('[Player] Initializing native audio backend');
    startStatePoller();
}

// Poll the native backend for state changes
function startStatePoller(): void {
    if (nativeStatePoller) return;

    nativeStatePoller = setInterval(async () => {
        try {
            // If playing via HTML5, skip native polling
            const track = get(currentTrack);
            if (track && isStreaming(track)) return;

            const state = await nativeAudioGetState();

            currentTime.set(state.position);
            if (state.duration > 0) {
                duration.set(state.duration);
            }

            // Check if track finished
            if (state.is_playing === false && get(isPlaying)) {
                const finished = await nativeAudioIsFinished();
                if (finished) {
                    handleTrackEnd();
                }
            }

            // Sync isPlaying state
            if (state.is_playing !== get(isPlaying)) {
                isPlaying.set(state.is_playing);
            }

            // Emit time update for plugins
            pluginEvents.emit('timeUpdate', {
                currentTime: state.position,
                duration: state.duration
            });

        } catch (e) {
            // Ignore polling errors
        }
    }, 100);
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

    // Cleanup HTML5
    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }

    // Reset stores
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

function updateMediaSessionMetadata(track: Track): void {
    if (!('mediaSession' in navigator)) return;

    // Initialize handlers on first use (needs user gesture context)
    initMediaSessionHandlers();

    // Resolve artwork URL
    const artworkSources: MediaImage[] = [];
    const coverSrc = getTrackCoverSrc(track);

    // Also try album cover as fallback
    const albumCover = track.album_id ? getAlbumCoverFromTracks(track.album_id) : null;
    const artUrl = coverSrc || albumCover;

    if (artUrl) {
        // MediaSession accepts data: URIs, asset:// URIs, and http(s) URLs.
        // data: URIs and http(s) work directly. Tauri asset:// protocol URLs
        // are served by the WebView and work within its context.
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

    let dur = 0;
    let pos = 0;
    let rate = 1;

    dur = get(duration);
    pos = get(currentTime);
    rate = 1;

    if (!dur || !isFinite(dur)) return;

    try {
        navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: rate,
            position: Math.min(pos, dur),
        });
    } catch (err) {
        // Ignore — setPositionState not supported everywhere
    }
}

// Play a specific track
export async function playTrack(track: Track, skipLocalSrc = false, startTime = 0): Promise<void> {
    const previousTrack = get(currentTrack);
    const sessionId = ++currentSessionId;

    currentTrack.set(track);

    // Get full track with base64 data URI for plugins
    const fullTrack = await getFullTrack(track.id, true);

    // Check session ID before proceeding after await
    if (sessionId !== currentSessionId) return;

    const trackForPlugins = fullTrack || track;
    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack });

    try {
        let audioPath = track.local_src || track.path;
        const streaming = isStreaming(track);

        // Prep the backends
        if (streaming) {
            // Stop native audio
            await nativeAudioStop().catch(() => { });

            // Resolve custom schemes (like tidal://) to HTTP URLs
            if (audioPath.includes('://') && !audioPath.startsWith('http')) {
                const runtime = pluginStore.getRuntime();
                if (runtime) {
                    const sourceType = track.source_type;
                    const externalId = track.external_id;
                    if (sourceType && externalId) {
                        console.log(`[Player] Resolving custom scheme: ${audioPath}`);
                        const resolved = await runtime.resolveStreamUrl(sourceType, externalId);
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
            audio.src = audioPath;
            audio.volume = sliderToAudioVolume(get(volume));
            await audio.play();

            console.log('[Player] HTML5 streaming started:', track.title);
        } else {
            // Stop HTML5 audio
            if (html5Audio) {
                html5Audio.pause();
                html5Audio.src = '';
            }

            // Play via native backend
            await nativeAudioPlay(audioPath);

            // Sync volume
            const vol = sliderToAudioVolume(get(volume));
            await nativeAudioSetVolume(vol);

            console.log('[Player] Native playback started:', track.title);
        }

        currentTime.set(0);
        duration.set(track.duration || 0);
        isPlaying.set(true);

        // Update Media Session
        updateMediaSessionMetadata(track);
        updateMediaSessionPlaybackState('playing');

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
    try {
        const track = get(currentTrack);
        const streaming = track ? isStreaming(track) : false;

        if (get(isPlaying)) {
            if (streaming) {
                getHtml5Audio().pause();
            } else {
                await nativeAudioPause();
            }
            isPlaying.set(false);
            updateMediaSessionPlaybackState('paused');
        } else {
            if (track && (get(currentTime) === 0 || get(currentTime) >= get(duration))) {
                // Restart if at end
                await playTrack(track);
            } else if (streaming) {
                await getHtml5Audio().play();
                isPlaying.set(true);
                updateMediaSessionPlaybackState('playing');
            } else {
                await nativeAudioResume();
                isPlaying.set(true);
                updateMediaSessionPlaybackState('playing');
            }
        }
    } catch (err) {
        console.error('[Player] Toggle failed:', err);
    }
}

// Next track
export function nextTrack(): void {
    const q = get(queue);
    const rep = get(repeat);
    const shuf = get(shuffle);
    const userCount = get(userQueueCount);
    const settings = get(appSettings);

    // Standard indices
    let idx = get(queueIndex);

    if (q.length === 0) {
        // Queue is empty, try autoplay from library
        if (settings.autoplay) {
            playRandomFromLibrary();
        }
        return;
    }

    if (rep === 'one') {
        // Repeat current track
        const track = get(currentTrack);
        if (track && isStreaming(track)) {
            getHtml5Audio().currentTime = 0;
            getHtml5Audio().play();
        } else {
            nativeAudioSeek(0).catch(console.error);
        }
        return;
    }

    // Check if we have user-queued tracks to play first
    if (userCount > 0) {
        // Play next user-queued track sequentially (always sequential for user queue)
        // User queue tracks are inserted directly after current track in the main queue list.
        // So we just increment normal index.
        idx = idx + 1;

        // When playing priority tracks, we do NOT update shuffledIndex.
        // We want to resume the shuffle flow from where we left off after priority tracks are done.
    } else if (shuf) {
        // Persistent Shuffle Mode
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex);

        // Move to next in shuffled list
        shufIdx = shufIdx + 1;

        if (shufIdx >= shufIndices.length) {
            if (rep === 'all') {
                shufIdx = 0;
            } else if (settings.autoplay) {
                // Autoplay: pick random track from library
                playRandomFromLibrary();
                return;
            } else {
                isPlaying.set(false);
                return;
            }
        }

        shuffledIndex.set(shufIdx);
        idx = shufIndices[shufIdx];
    } else {
        // Sequential next
        idx = idx + 1;
    }

    if (!shuf && idx >= q.length) { // Check bounds for sequential
        if (rep === 'all') {
            idx = 0;
        } else if (settings.autoplay) {
            // Autoplay: pick random track from library
            playRandomFromLibrary();
            return;
        } else {
            // Stop at end
            isPlaying.set(false);
            return;
        }
    }

    queueIndex.set(idx);
    playTrack(q[idx]);

    // Decrement user queue count if we consumed a user-added track
    if (userCount > 0) {
        userQueueCount.update(c => Math.max(0, c - 1));
    }
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
    const q = get(queue);
    const shuf = get(shuffle);
    let idx = get(queueIndex);

    if (q.length === 0) return;

    // If more than 3 seconds in, restart current track
    try {
        const track = get(currentTrack);
        const streaming = track ? isStreaming(track) : false;
        let pos = 0;

        if (streaming) {
            pos = getHtml5Audio().currentTime;
        } else {
            const state = await nativeAudioGetState();
            pos = state.position;
        }

        if (pos > 3) {
            if (streaming) {
                getHtml5Audio().currentTime = 0;
            } else {
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
    const track = get(currentTrack);
    const streaming = track ? isStreaming(track) : false;

    try {
        if (streaming) {
            const audio = getHtml5Audio();
            if (audio.duration) {
                audio.currentTime = position * audio.duration;
            }
        } else {
            await nativeAudioSeek(position);
        }
    } catch (err) {
        console.error('[Player] Seek failed:', err);
    }
}

// Set volume (slider value 0-1, will be converted to logarithmic for audio)
export async function setVolume(sliderValue: number): Promise<void> {
    volume.set(sliderValue);
    const vol = sliderToAudioVolume(sliderValue);

    try {
        // Update HTML5 volume
        if (html5Audio) {
            html5Audio.volume = vol;
        }
        // Update native volume
        await nativeAudioSetVolume(vol);
    } catch (err) {
        console.error('[Player] Volume set failed:', err);
    }
}

// Toggle shuffle
export function toggleShuffle(): void {
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
    repeat.update(r => {
        if (r === 'none') return 'all';
        if (r === 'all') return 'one';
        return 'none';
    });
}

// Handle track end
function handleTrackEnd(): void {
    nextTrack();
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
    if (get(shuffle)) {
        shuffledIndices.update(indices => {
            return indices.map(i => {
                if (i === fromIndex) return toIndex;
                if (fromIndex < toIndex) {
                    // Moved down: items between from+1 and to shifted up (-1)
                    if (i > fromIndex && i <= toIndex) return i - 1;
                } else {
                    // Moved up: items between to and from-1 shifted down (+1)
                    if (i >= toIndex && i < fromIndex) return i + 1;
                }
                return i;
            });
        });
    }
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
