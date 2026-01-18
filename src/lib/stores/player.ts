// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import { getAudioSrc } from '$lib/api/tauri';
import { addToast } from '$lib/stores/toast';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { tracks as libraryTracks } from '$lib/stores/library';
import { appSettings } from '$lib/stores/settings';

// Plugin event emitter (global singleton for plugin system)
export const pluginEvents = new EventEmitter<PluginEvents>();

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

// High-frequency time update using requestAnimationFrame for smooth lyrics
function startTimeSync(): void {
    if (animationFrameId !== null) return;

    let lastEventTime = 0;
    const updateTime = () => {
        if (audioElement && !audioElement.paused) {
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
        } else {
            animationFrameId = null;
        }
    };
    animationFrameId = requestAnimationFrame(updateTime);
}

function stopTimeSync(): void {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

export function setAudioElement(element: HTMLAudioElement): void {
    audioElement = element;

    // Sync volume (convert linear slider to logarithmic audio volume)
    const sliderVol = get(volume);
    audioElement.volume = sliderToAudioVolume(sliderVol);

    // Set up event listeners
    audioElement.addEventListener('ended', handleTrackEnd);
    audioElement.addEventListener('timeupdate', () => {
        // Fallback update (less frequent, for when RAF isn't running)
        if (animationFrameId === null) {
            currentTime.set(audioElement?.currentTime ?? 0);
        }
    });
    audioElement.addEventListener('durationchange', () => {
        duration.set(audioElement?.duration ?? 0);
    });
    audioElement.addEventListener('play', () => {
        isPlaying.set(true);
        pluginEvents.emit('playStateChange', { isPlaying: true });
        startTimeSync();
    });
    audioElement.addEventListener('pause', () => {
        isPlaying.set(false);
        pluginEvents.emit('playStateChange', { isPlaying: false });
        stopTimeSync();
    });
}

// Play a specific track
export async function playTrack(track: Track): Promise<void> {
    const previousTrack = get(currentTrack);
    currentTrack.set(track);

    // Emit trackChange event for plugins
    pluginEvents.emit('trackChange', { track, previousTrack });

    if (audioElement) {
        try {
            let src: string;

            // Check for local cached version first
            if (track.local_src) {
                try {
                    src = await getAudioSrc(track.local_src);
                } catch (err) {
                    console.warn('Failed to play local cached file, falling back to stream', err);
                }
            }

            // If no local source or it failed, try standard resolution
            if (!src!) {
                // Check if this is an external streaming track
                if (track.source_type && track.source_type !== 'local') {
                    // External track - need to resolve stream URL via plugin
                    const { pluginStore } = await import('./plugin-store');
                    const runtime = pluginStore.getRuntime();

                    if (runtime && track.external_id) {
                        try {
                            // Resolve fresh stream URL
                            const streamUrl = await runtime.resolveStreamUrl(track.source_type, track.external_id);
                            if (streamUrl) {
                                src = streamUrl;
                            } else {
                                console.error('Failed to resolve stream URL for:', track.source_type, track.external_id);
                                addToast(`Unable to play "${track.title}": Stream URL not found`, 'error');
                                return;
                            }
                        } catch (err) {
                            console.error('Plugin resolution error:', err);
                            addToast(`Error playing "${track.title}": ${err instanceof Error ? err.message : 'Unknown plugin error'}`, 'error');
                            return;
                        }
                    } else if (track.path.startsWith('http://') || track.path.startsWith('https://')) {
                        // Fallback: path is already a URL
                        src = track.path;
                    } else {
                        console.error('Cannot play external track: no resolver available or path is not a URL');
                        addToast(`Cannot play "${track.title}": Missing stream information`, 'error');
                        return;
                    }
                } else {
                    // Local file - convert file path to asset URL
                    try {
                        src = await getAudioSrc(track.path);
                    } catch (err) {
                        console.error('File access error:', err);
                        addToast(`Cannot play "${track.title}": File not found or inaccessible`, 'error');
                        return;
                    }
                }
            }

            audioElement.src = src;
            try {
                await audioElement.play();
            } catch (err) {
                // Ignore AbortError - happens when play() is interrupted by new load
                if (err instanceof Error && err.name === 'AbortError') {
                    return;
                }
                // Handle "NotSupportedError" or similar playback errors
                console.error('Playback failed:', err);
                addToast(`Playback failed for "${track.title}": ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
            }
        } catch (error) {
            // Catch-all for unexpected errors in the setup phase
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
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
export function playTracks(tracks: Track[], startIndex: number = 0): void {
    queue.set(tracks);
    queueIndex.set(startIndex);
    userQueueCount.set(0); // Reset user queue when starting fresh

    // If shuffle is already on, regenerate shuffle order
    if (get(shuffle)) {
        const indices = tracks.map((_, i) => i);
        const shuffled = shuffleArray(indices);
        // Ensure the started track is played first? 
        // Or finding where it ended up?
        // Usually clicking a track implies "play this now". 
        // So we swap it to the current position (e.g. 0 if we start playing?)
        // Let's just shuffle and find the index.
        console.log('Regenerating shuffle in playTracks');
        shuffledIndices.set(shuffled);

        // Find where our start track went. 
        // BUT wait, playTracks usually implies playing THIS track. 
        // If we simply play shuffle, the user might be confused if we jump to random track.
        // If startIndex is provided, we play THAT track.
        // So we should just find where startIndex ended up in shuffled list.
        const newShuffledIdx = shuffled.indexOf(startIndex);
        shuffledIndex.set(newShuffledIdx !== -1 ? newShuffledIdx : 0);
    }

    // Emit queueChange event for plugins
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
