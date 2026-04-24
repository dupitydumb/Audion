// Simple JSON state persistence for player settings
import { get } from 'svelte/store';
import {
    volume, currentTrack, queue, queueIndex, userQueueCount,
    shuffle, repeat, shuffledIndices, shuffledIndex,
    playbackContext, currentTime, duration, type PlaybackContext
} from './player';
import { lyricsVisible } from './lyrics';
import type { Track } from '$lib/api/tauri';

const STORAGE_KEY = 'rlist_player_state';

export interface PersistedState {
    volume: number;           // Slider value (0-1), linear
    lyricsVisible: boolean;
    queue: Track[];
    queueIndex: number;
    userQueueCount: number;
    shuffle: boolean;
    repeat: 'none' | 'one' | 'all';
    shuffledIndices: number[];
    shuffledIndex: number;
    playbackContext: PlaybackContext | null;
    currentTime: number;
    duration: number;
    lastTrack: {
        id: number;
        path: string;
        title: string | null;
        artist: string | null;
        album: string | null;
    } | null;
}

// Default state
const defaultState: PersistedState = {
    volume: 0.7,
    lyricsVisible: false,
    queue: [],
    queueIndex: 0,
    userQueueCount: 0,
    shuffle: false,
    repeat: 'none',
    shuffledIndices: [],
    shuffledIndex: 0,
    playbackContext: null,
    currentTime: 0,
    duration: 0,
    lastTrack: null
};

// Load state from localStorage
export function loadPersistedState(): PersistedState {
    if (typeof window === 'undefined') return defaultState;

    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...defaultState, ...parsed };
        }
    } catch (error) {
        console.error('[Persist] Failed to load state:', error);
    }

    return defaultState;
}

// Save current state to localStorage
export function savePersistedState(): void {
    if (typeof window === 'undefined') return;

    try {
        const track = get(currentTrack);
        const state: PersistedState = {
            volume: get(volume),
            lyricsVisible: get(lyricsVisible),
            queue: get(queue),
            queueIndex: get(queueIndex),
            userQueueCount: get(userQueueCount),
            shuffle: get(shuffle),
            repeat: get(repeat),
            shuffledIndices: get(shuffledIndices),
            shuffledIndex: get(shuffledIndex),
            playbackContext: get(playbackContext),
            currentTime: get(currentTime),
            duration: get(duration),
            lastTrack: track ? {
                id: track.id,
                path: track.path,
                title: track.title,
                artist: track.artist,
                album: track.album
            } : null
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Persist] Failed to save state:', error);
    }
}

// Initialize stores from persisted state
export function initializeFromPersistedState(): void {
    const state = loadPersistedState();

    console.log('[Persist] Restoring state:', state);

    volume.set(state.volume);
    lyricsVisible.set(state.lyricsVisible);

    // Restore queue and playback state
    if (state.queue && state.queue.length > 0) {
        queue.set(state.queue);
        queueIndex.set(state.queueIndex || 0);
        userQueueCount.set(state.userQueueCount || 0);

        // Restore shuffle state
        shuffle.set(state.shuffle);
        repeat.set(state.repeat);

        // Restore shuffle indices if shuffle is on (or even if off, for consistency)
        if (state.shuffledIndices && state.shuffledIndices.length > 0) {
            shuffledIndices.set(state.shuffledIndices);
            shuffledIndex.set(state.shuffledIndex || 0);
        }

        // Restore context
        if (state.playbackContext) {
            playbackContext.set(state.playbackContext);
        }

        // Restore current track based on queue and index
        // We do this to ensure the track object matches the one in queue
        // (though simple object equality might not matter, reference equality helps)
        let trackToRestore = state.lastTrack as Track | null;

        // If we have a valid queue index, use that track
        const idx = state.shuffle ?
            (state.shuffledIndices[state.shuffledIndex] ?? state.queueIndex) :
            state.queueIndex;

        // Actually, queueIndex is the canonical source of truth for "current track" in normal mode
        // In shuffle mode, shuffledIndices[shuffledIndex] -> queue index -> queue[index]
        // But player.ts updates queueIndex even in shuffle mode to match the playing track.
        // So queue[queueIndex] should be the current track.

        if (state.queue[state.queueIndex]) {
            trackToRestore = state.queue[state.queueIndex];
        }

        if (trackToRestore) {
            currentTrack.set(trackToRestore);
        }

        // Restore time
        if (state.currentTime > 0) {
            currentTime.set(state.currentTime);
        }

        // Restore duration
        if (state.duration > 0) {
            duration.set(state.duration);
        }
    }
}

// Auto-save on changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function scheduleStateSave(): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        savePersistedState();
        saveTimeout = null;
    }, 1000); // Debounce 1 second
}

// Subscribe to store changes for auto-save
export function setupAutoSave(): void {
    volume.subscribe(() => scheduleStateSave());
    lyricsVisible.subscribe(() => scheduleStateSave());
    // Trigger save on track change
    currentTrack.subscribe(() => scheduleStateSave());
    // Trigger save on shuffle/repeat toggle
    shuffle.subscribe(() => scheduleStateSave());
    repeat.subscribe(() => scheduleStateSave());
    // Trigger save on queue changes (might be frequent for big adds, but debounced)
    queue.subscribe(() => scheduleStateSave());

    // We do NOT subscribe to currentTime because it changes every ~16ms
    // Instead, we rely on the debounced save from other events, 
    // OR we should perhaps catch "pause" event? 
    // Capturing exact second when closing app is hard without "beforeunload"
    // But saving every time track changes or user pauses is good baseline.
    // If user just closes app while playing, we might lose last X seconds of progress.
    // We can add a periodic save if playing?

    // Optional: Periodic save while playing
    setInterval(() => {
        // Only save if playing (we can check simple flag or just save)
        // We can't easily check 'isPlaying' store here without importing it,
        // imports are fine.
        // But let's keep it simple. Schedule save every 10s?
        scheduleStateSave();
    }, 5000);
}
