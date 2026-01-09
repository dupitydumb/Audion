// Player store - manages audio playback state
import { writable, derived, get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import { getAudioSrc } from '$lib/api/tauri';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';

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
            const src = await getAudioSrc(track.path);
            audioElement.src = src;
            await audioElement.play();
        } catch (error) {
            console.error('Failed to play track:', error);
        }
    }
}

// Play a list of tracks starting at index
export function playTracks(tracks: Track[], startIndex: number = 0): void {
    queue.set(tracks);
    queueIndex.set(startIndex);
    userQueueCount.set(0); // Reset user queue when starting fresh

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
        audioElement.play().catch(console.error);
    } else {
        audioElement.pause();
    }
}

// Next track
export function nextTrack(): void {
    const q = get(queue);
    let idx = get(queueIndex);
    const rep = get(repeat);
    const shuf = get(shuffle);

    if (q.length === 0) return;

    if (rep === 'one') {
        // Repeat current track
        if (audioElement) {
            audioElement.currentTime = 0;
            audioElement.play().catch(console.error);
        }
        return;
    }

    if (shuf) {
        // Random next track
        idx = Math.floor(Math.random() * q.length);
    } else {
        // Sequential next
        idx = idx + 1;
    }

    if (idx >= q.length) {
        if (rep === 'all') {
            idx = 0;
        } else {
            // Stop at end
            isPlaying.set(false);
            return;
        }
    }

    queueIndex.set(idx);
    playTrack(q[idx]);

    // Decrement user queue count if we consumed a user-added track
    userQueueCount.update(c => Math.max(0, c - 1));
}

// Previous track
export function previousTrack(): void {
    const q = get(queue);
    let idx = get(queueIndex);

    if (q.length === 0) return;

    // If more than 3 seconds in, restart current track
    if (audioElement && audioElement.currentTime > 3) {
        audioElement.currentTime = 0;
        return;
    }

    idx = idx - 1;
    if (idx < 0) {
        idx = get(repeat) === 'all' ? q.length - 1 : 0;
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
    shuffle.update(s => !s);
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

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(insertPosition, 0, ...tracks);

        // Emit queueChange event for plugins
        pluginEvents.emit('queueChange', { queue: newQueue, index: currentIdx });

        return newQueue;
    });

    // Update user queue count
    userQueueCount.update(c => c + tracks.length);
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
}

// Clear upcoming queue (keep history)
export function clearUpcoming(): void {
    const currentIdx = get(queueIndex);
    queue.update(q => q.slice(0, currentIdx + 1));
    userQueueCount.set(0); // Clear user queue count
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
    }
}
