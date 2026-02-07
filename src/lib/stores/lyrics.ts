// Lyrics store - manages lyrics state and sync with player
import { writable, derived, get } from 'svelte/store';
import { currentTrack, currentTime } from './player';
import { lyricsManager, type LyricLine, type LyricsResult } from '$lib/lyrics';

// Lyrics panel visibility
export const lyricsVisible = writable(false);

// Current lyrics data
export const lyricsData = writable<LyricsResult | null>(null);

// Loading state
export const lyricsLoading = writable(false);

// Error state
export const lyricsError = writable<string | null>(null);

// Current active line index based on playback time
export const activeLine = derived(
    [lyricsData, currentTime],
    ([$lyrics, $time]) => {
        if (!$lyrics || $lyrics.lines.length === 0) return -1;

        // Find the line that's currently active
        let activeIdx = -1;
        for (let i = 0; i < $lyrics.lines.length; i++) {
            if ($lyrics.lines[i].time <= $time) {
                activeIdx = i;
            } else {
                break;
            }
        }
        return activeIdx;
    }
);

// Toggle lyrics panel
export function toggleLyrics(): void {
    lyricsVisible.update(v => !v);
}

// Track ID to prevent stale fetches
let currentFetchId = 0;

// Fetch lyrics for current track
export async function fetchLyricsForTrack(): Promise<void> {
    const track = get(currentTrack);

    if (!track) {
        lyricsData.set(null);
        return;
    }

    const fetchId = ++currentFetchId;

    lyricsLoading.set(true);
    lyricsError.set(null);

    try {
        // Try to load from local cache first (via Tauri)
        const cached = await loadLrcFromCache(track.path);
        if (cached && fetchId === currentFetchId) {
            const lines = lyricsManager.parseLRC(cached);
            lyricsData.set({
                lines,
                source: 'cache',
                hasWordSync: lines.some(l => l.words && l.words.length > 0),
                raw: cached
            });
            lyricsLoading.set(false);
            return;
        }

        // Fetch from APIs
        const result = await lyricsManager.fetchLyrics(
            track.title,
            track.artist,
            track.album,
            track.duration
        );

        // Check if this is still the current fetch
        if (fetchId !== currentFetchId) return;

        if (result) {
            lyricsData.set(result);
            // Save to local cache
            saveLrcToCache(track.path, result.raw);
        } else {
            lyricsData.set(null);
            lyricsError.set('No lyrics found');
        }
    } catch (error) {
        if (fetchId === currentFetchId) {
            lyricsError.set('Failed to fetch lyrics');
        }
    } finally {
        if (fetchId === currentFetchId) {
            lyricsLoading.set(false);
        }
    }
}

// Save LRC file alongside music file
async function saveLrcToCache(musicPath: string, lrcContent: string): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('save_lrc_file', { musicPath, lrcContent });
    } catch (error) {
    }
}

// Load LRC file from cache
async function loadLrcFromCache(musicPath: string): Promise<string | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const content = await invoke<string | null>('load_lrc_file', { musicPath });
        return content;
    } catch (error) {
        return null;
    }
}

// Subscribe to track changes
let unsubscribe: (() => void) | null = null;

export function initLyricsSync(): void {
    if (unsubscribe) return;

    unsubscribe = currentTrack.subscribe(track => {
        if (track) {
            fetchLyricsForTrack();
        } else {
            lyricsData.set(null);
            lyricsError.set(null);
        }
    });
}

export function destroyLyricsSync(): void {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
}

// Delete LRC file for a specific music file
async function deleteLrcFromCache(musicPath: string): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const deleted = await invoke<boolean>('delete_lrc_file', { musicPath });
        return deleted;
    } catch (error) {
        return false;
    }
}

// Lyrics store object for external access
export const lyricsStore = {
    clearLyrics(): void {
        lyricsData.set(null);
        lyricsError.set(null);
        lyricsLoading.set(false);
    },

    async clearCurrentTrackCache(): Promise<void> {
        const track = get(currentTrack);
        if (track) {
            await deleteLrcFromCache(track.path);
            lyricsData.set(null);
            lyricsError.set(null);
        }
    }
};

// ============================================================================
// Public API for external use (plugins, integrations, etc.)
// ============================================================================

/**
 * Get all lyrics for a specific music file
 * @param musicPath - Path to the music file
 * @returns Array of lyric lines with timing data, or null if no lyrics found
 */
export async function getLyrics(musicPath: string): Promise<LyricLine[] | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<LyricLine[] | null>('get_lyrics', { musicPath });
        return result;
    } catch (error) {
        console.error('Failed to get lyrics:', error);
        return null;
    }
}

/**
 * Get the current active lyric line for a specific music file at a given time
 * @param musicPath - Path to the music file
 * @param currentTime - Current playback time in seconds
 * @returns Current lyric line with index and timing data, or null if no active line
 */
export async function getCurrentLyric(
    musicPath: string,
    currentTime: number
): Promise<{ line: LyricLine; index: number } | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ index: number; time: number; text: string; words?: LyricLine['words'] } | null>(
            'get_current_lyric',
            { musicPath, currentTime }
        );

        if (!result) return null;

        return {
            index: result.index,
            line: {
                time: result.time,
                text: result.text,
                words: result.words
            }
        };
    } catch (error) {
        console.error('Failed to get current lyric:', error);
        return null;
    }
}

/**
 * Get all lyrics for the currently playing track
 * Convenience method that automatically uses the current track
 * @returns Array of lyric lines, or null if no track is playing or no lyrics found
 */
export async function getCurrentTrackLyrics(): Promise<LyricLine[] | null> {
    const track = get(currentTrack);
    if (!track) return null;

    return getLyrics(track.path);
}

/**
 * Get the active lyric line for the currently playing track
 * Convenience method that automatically uses current track and playback time
 * @returns Current lyric line with index, or null if no track is playing or no active line
 */
export async function getCurrentTrackActiveLyric(): Promise<{ line: LyricLine; index: number } | null> {
    const track = get(currentTrack);
    const time = get(currentTime);

    if (!track) return null;

    return getCurrentLyric(track.path, time);
}
