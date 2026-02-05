// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import { getAudioSrc, getAlbumArtSrc } from '$lib/api/tauri';
import { addToast } from '$lib/stores/toast';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { tracks as libraryTracks, getFullTrack } from '$lib/stores/library';
import { appSettings } from '$lib/stores/settings';
import { equalizer, EQ_FREQUENCIES } from '$lib/stores/equalizer';

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

// Current time and duration
export const currentTime = writable(0);
export const duration = writable(0);

// Shuffle and repeat
export const shuffle = writable(false);
export const repeat = writable<'none' | 'one' | 'all'>('none');

// Audio element reference (set from PlayerBar component)
let audioElement: HTMLAudioElement | null = null;
let animationFrameId: number | null = null;

// Web Audio API for equalizer
let audioContext: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let eqFilters: BiquadFilterNode[] = [];
let eqConnected = false;

// Cleanup tracking for memory leak prevention
let cleanupListeners: (() => void) | null = null;
let unsubscribeGainChange: (() => void) | null = null;
let unsubscribeEnabledChange: (() => void) | null = null;
let unsubscribeEqEnabledInSetAudio: (() => void) | null = null;
let rafActive = false;
let currentSessionId = 0;

// Get the AudioContext (for potential visualizer use)
export function getAudioContext(): AudioContext | null {
    return audioContext;
}

// Initialize the equalizer filters
function initializeEqualizer(audio: HTMLAudioElement): void {
    if (eqConnected) return; // Already initialized

    try {
        // Create AudioContext on user interaction (browser requirement)
        if (!audioContext) {
            audioContext = new AudioContext();
        }

        // Create source node from audio element (can only be done once per element)
        if (!sourceNode) {
            sourceNode = audioContext.createMediaElementSource(audio);
        }

        // CRITICAL: First connect directly to destination to ensure audio plays
        // We'll disconnect and reconnect through filters after
        sourceNode.connect(audioContext.destination);

        // Create EQ filters (peaking filters for each band)
        eqFilters = EQ_FREQUENCIES.map((freq, index) => {
            const filter = audioContext!.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4; // Standard Q for 10-band EQ
            filter.gain.value = 0;
            return filter;
        });

        // Now disconnect direct connection and route through filters
        sourceNode.disconnect();

        // Connect the chain: source → filters → destination
        let currentNode: AudioNode = sourceNode;
        for (const filter of eqFilters) {
            currentNode.connect(filter);
            currentNode = filter;
        }
        currentNode.connect(audioContext.destination);

        // Set initial gains from equalizer state
        const state = equalizer.getState();
        if (state.enabled) {
            state.bands.forEach((band, i) => {
                if (eqFilters[i]) {
                    eqFilters[i].gain.value = band.gain;
                }
            });
        }

        // Clean up old listeners before registering new ones
        if (unsubscribeGainChange) unsubscribeGainChange();
        if (unsubscribeEnabledChange) unsubscribeEnabledChange();

        // Register callbacks for equalizer changes and store unsubscribe functions
        unsubscribeGainChange = equalizer.onGainChange((bandIndex, gain) => {
            if (eqFilters[bandIndex] && equalizer.getState().enabled) {
                eqFilters[bandIndex].gain.value = gain;
            }
        });

        unsubscribeEnabledChange = equalizer.onEnabledChange((enabled) => {
            const state = equalizer.getState();
            eqFilters.forEach((filter, i) => {
                filter.gain.value = enabled ? state.bands[i].gain : 0;
            });
        });

        eqConnected = true;
        console.log('[Player] Equalizer initialized successfully');
    } catch (error) {
        console.error('[Player] Failed to initialize equalizer:', error);
        // Fallback: ensure audio still plays by connecting source directly to destination
        if (sourceNode && audioContext) {
            try {
                sourceNode.connect(audioContext.destination);
                console.log('[Player] Fallback: audio connected directly to output');
            } catch (e) {
                console.error('[Player] Fallback connection failed:', e);
            }
        }
    }
}

// High-frequency time update with safeguard against orphaned RAF
function startTimeSync(): void {
    if (animationFrameId !== null) return;

    rafActive = true;
    let lastEventTime = 0;

    const updateTime = () => {
        // Check rafActive flag to prevent orphaned RAF loops
        if (!rafActive || !audioElement || audioElement.paused) {
            animationFrameId = null;
            rafActive = false;
            return;
        }

        const time = audioElement.currentTime;
        currentTime.set(time);

        // Emit timeUpdate event for plugins (throttled to 250ms)
        const now = Date.now();
        if (now - lastEventTime >= 250) {
            pluginEvents.emit('timeUpdate', {
                currentTime: time,
                duration: audioElement.duration
            });
            lastEventTime = now;
        }

        animationFrameId = requestAnimationFrame(updateTime);
    };
    animationFrameId = requestAnimationFrame(updateTime);
}

function stopTimeSync(): void {
    rafActive = false;
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// setAudioElement with proper cleanup
export function setAudioElement(element: HTMLAudioElement): void {
    // Clean up old element listeners if replacing
    if (audioElement && audioElement !== element && cleanupListeners) {
        console.log('[Player] Cleaning up old audio element listeners');
        cleanupListeners();
        cleanupListeners = null;
    }

    // Clean up old EQ enabled listener from previous setAudioElement call
    if (unsubscribeEqEnabledInSetAudio) {
        unsubscribeEqEnabledInSetAudio();
        unsubscribeEqEnabledInSetAudio = null;
    }

    audioElement = element;

    // Sync volume (convert linear slider to logarithmic audio volume)
    const sliderVol = get(volume);
    audioElement.volume = sliderToAudioVolume(sliderVol);

    // Store unsubscribe function for EQ enabled listener
    unsubscribeEqEnabledInSetAudio = equalizer.onEnabledChange((enabled) => {
        if (enabled && !eqConnected && audioElement) {
            initializeEqualizer(audioElement);
            // Resume audio context if suspended (browser autoplay policy)
            if (audioContext?.state === 'suspended') {
                audioContext.resume();
            }
        }
    });

    // Store initEQ listener reference for cleanup
    let initEqListener: (() => void) | null = null;

    // If EQ is already enabled on load, init it on first play
    if (equalizer.getState().enabled) {
        initEqListener = () => {
            initializeEqualizer(element);
            if (audioContext?.state === 'suspended') {
                audioContext.resume();
            }
            element.removeEventListener('play', initEqListener!);
            initEqListener = null;
        };
        element.addEventListener('play', initEqListener);
    }

    // cleanup function to remove initEQ listener
    const originalCleanup = cleanupListeners;
    cleanupListeners = () => {
        if (originalCleanup) originalCleanup();
        if (initEqListener) {
            element.removeEventListener('play', initEqListener);
            initEqListener = null;
        }
    };

    // Define event handlers as named functions for proper cleanup
    const handleEnded = () => handleTrackEnd();

    const handleTimeUpdate = () => {
        // Fallback update (less frequent, for when RAF isn't running)
        if (animationFrameId === null) {
            currentTime.set(audioElement?.currentTime ?? 0);
        }
    };

    const handleDurationChange = () => {
        duration.set(audioElement?.duration ?? 0);
    };

    const handleSeeked = (e: Event) => {
        const target = e.target as HTMLAudioElement;
        pluginEvents.emit('seeked', {
            currentTime: target.currentTime,
            duration: target.duration
        });
    };

    const handlePlay = () => {
        isPlaying.set(true);
        pluginEvents.emit('playStateChange', { isPlaying: true });
        startTimeSync();
    };

    const handlePause = () => {
        isPlaying.set(false);
        pluginEvents.emit('playStateChange', { isPlaying: false });
        stopTimeSync();
    };

    // Set up event listeners
    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('durationchange', handleDurationChange);
    audioElement.addEventListener('seeked', handleSeeked);
    audioElement.addEventListener('play', handlePlay);
    audioElement.addEventListener('pause', handlePause);

    // Store cleanup function for listeners
    cleanupListeners = () => {
        element.removeEventListener('ended', handleEnded);
        element.removeEventListener('timeupdate', handleTimeUpdate);
        element.removeEventListener('durationchange', handleDurationChange);
        element.removeEventListener('seeked', handleSeeked);
        element.removeEventListener('play', handlePlay);
        element.removeEventListener('pause', handlePause);
    };
}

// cleanup function for app unmount or hot reload
export function cleanupPlayer(): void {
    console.log('[Player] Cleaning up player resources');

    // 1. Stop RAF with fail-safe
    rafActive = false;
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // 2. Clean audio element
    if (audioElement) {
        // Stop playback
        audioElement.pause();

        // Clear source to free memory
        audioElement.src = '';
        audioElement.load(); // Important: triggers resource cleanup

        // Remove event listeners
        if (cleanupListeners) {
            cleanupListeners();
            cleanupListeners = null;
        }

        audioElement = null;
    }

    // 3. Clean equalizer listeners
    if (unsubscribeGainChange) {
        unsubscribeGainChange();
        unsubscribeGainChange = null;
    }
    if (unsubscribeEnabledChange) {
        unsubscribeEnabledChange();
        unsubscribeEnabledChange = null;
    }
    if (unsubscribeEqEnabledInSetAudio) {
        unsubscribeEqEnabledInSetAudio();
        unsubscribeEqEnabledInSetAudio = null;
    }

    // 4. Disconnect Web Audio nodes (but keep context for reuse)
    if (sourceNode) {
        try {
            sourceNode.disconnect();
        } catch (e) {
            // Already disconnected, ignore
        }
    }

    eqFilters.forEach(filter => {
        try {
            filter.disconnect();
        } catch (e) {
            // Already disconnected, ignore
        }
    });

    // 5. Suspend AudioContext (don't close - can be resumed)
    if (audioContext && audioContext.state !== 'closed') {
        if (audioContext.state === 'running') {
            audioContext.suspend().then(() => {
                console.log('[Player] AudioContext suspended');
            }).catch(err => {
                console.warn('[Player] AudioContext suspend error:', err);
            });
        }
    }

    // Reset connection state (but keep context for reuse)
    sourceNode = null;
    eqFilters = [];
    eqConnected = false;

    // 6. Clear plugin events (uses EventEmitter)
    pluginEvents.removeAllListeners();

    // 7. Reset stores to initial state
    isPlaying.set(false);
    currentTrack.set(null);
    currentTime.set(0);
    duration.set(0);

    console.log('[Player] Cleanup complete');
}

// Full shutdown (for app close, not just pause)
export function shutdownPlayer(): void {
    console.log('[Player] Shutting down player (full cleanup)');

    // First do regular cleanup
    cleanupPlayer();

    // Then close AudioContext permanently
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => {
            console.log('[Player] AudioContext closed');
        }).catch(err => {
            console.warn('[Player] AudioContext close error:', err);
        });
        audioContext = null;
    }
}

// Play a specific track
export async function playTrack(track: Track): Promise<void> {
    const previousTrack = get(currentTrack);
    const sessionId = ++currentSessionId;

    currentTrack.set(track);

    // Get full track with base64 data URI for plugins
    const fullTrack = await getFullTrack(track.id, true);

    // Check session ID before proceeding after await
    if (sessionId !== currentSessionId) return;

    const trackForPlugins = fullTrack || track;
    pluginEvents.emit('trackChange', { track: trackForPlugins, previousTrack });

    if (audioElement) {
        try {
            let src: string | undefined;

            // Check for local cached version first
            if (track.local_src) {
                try {
                    src = await getAudioSrc(track.local_src);
                } catch (err) {
                    console.warn('Failed to play local cached file, falling back to stream', err);
                }
            }

            if (sessionId !== currentSessionId) return;

            // If no local source or it failed, try standard resolution
            if (!src!) {
                if (track.source_type && track.source_type !== 'local') {
                    const { pluginStore } = await import('./plugin-store');
                    const runtime = pluginStore.getRuntime();

                    if (sessionId !== currentSessionId) return;

                    if (runtime && track.external_id) {
                        try {
                            const streamUrl = await runtime.resolveStreamUrl(track.source_type, track.external_id);

                            if (sessionId !== currentSessionId) return;

                            if (streamUrl) {
                                src = streamUrl;
                            } else {
                                console.error('Failed to resolve stream URL');
                                addToast(`Unable to play "${track.title}": Stream URL not found`, 'error');
                                return;
                            }
                        } catch (err) {
                            console.error('Plugin resolution error:', err);
                            addToast(`Error playing "${track.title}": ${err instanceof Error ? err.message : 'Unknown plugin error'}`, 'error');
                            return;
                        }
                    } else if (track.path.startsWith('http://') || track.path.startsWith('https://')) {
                        src = track.path;
                    }
                } else {
                    try {
                        src = await getAudioSrc(track.path);
                    } catch (err) {
                        console.error('File access error:', err);
                        addToast(`Cannot play "${track.title}": File not found or inaccessible`, 'error');
                        return;
                    }
                }
            }

            if (sessionId !== currentSessionId) return;

            if (!src) {
                console.error('Final src resolution failed');
                return;
            }

            audioElement.src = src;
            try {
                await audioElement.play();
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;
                console.error('Playback failed:', err);
                addToast(`Playback failed for "${track.title}": ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;
            console.error('Failed to init track:', error);
            addToast(`Failed to play "${track.title}": Unexpected error`, 'error');
        }
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

// Play/Pause toggle
export function togglePlay(): void {
    if (!audioElement) return;

    if (audioElement.paused) {
        audioElement.play().catch(error => {
            if (error instanceof Error && error.name === 'AbortError') return;
            console.error(error);
        });
    } else {
        audioElement.pause();
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
        if (audioElement) {
            audioElement.currentTime = 0;
            audioElement.play().catch(console.error);
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
export function previousTrack(): void {
    const q = get(queue);
    const shuf = get(shuffle);
    let idx = get(queueIndex);

    if (q.length === 0) return;

    // If more than 3 seconds in, restart current track
    if (audioElement && audioElement.currentTime > 3) {
        audioElement.currentTime = 0;
        return;
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
export function seek(position: number): void {
    if (!audioElement) return;
    const dur = audioElement.duration;
    if (dur && isFinite(dur)) {
        audioElement.currentTime = position * dur;
    }
}

// Set volume (slider value 0-1, will be converted to logarithmic for audio)
export function setVolume(sliderValue: number): void {
    volume.set(sliderValue);
    if (audioElement) {
        // Apply logarithmic curve for natural-feeling volume
        audioElement.volume = sliderToAudioVolume(sliderValue);
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
