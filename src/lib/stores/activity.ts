// Activity store - manages play history and activity data
import { writable, get } from 'svelte/store';
import { recordPlay, getTopTracks, getTopAlbums, getRecentlyPlayed, type Track, type TrackWithCount, type AlbumWithCount } from '$lib/api/tauri';

export const topTracks = writable<TrackWithCount[]>([]);
export const topAlbums = writable<AlbumWithCount[]>([]);
export const recentlyPlayed = writable<Track[]>([]);

// Record a play event for a track
export async function recordTrackPlay(trackId: number, albumId: number | null, durationPlayed: number): Promise<void> {
    // Only record for tracks with numeric IDs (library tracks)
    if (typeof trackId !== 'number') {
        return;
    }

    try {
        await recordPlay(trackId, albumId, durationPlayed);
    } catch (error) {
        console.error('[Activity] Failed to record play:', error);
    }
}

// Load activity data (top tracks, top albums, recently played)
export async function loadActivityData(): Promise<void> {
    try {
        const [topT, topA, recent] = await Promise.all([
            getTopTracks(50),
            getTopAlbums(20),
            getRecentlyPlayed(20),
        ]);
        topTracks.set(topT);
        topAlbums.set(topA);
        recentlyPlayed.set(recent);
    } catch (error) {
        console.error('[Activity] Failed to load activity data:', error);
    }
}

// Refresh just recently played (lightweight)
export async function refreshRecentlyPlayed(): Promise<void> {
    try {
        const recent = await getRecentlyPlayed(20);
        recentlyPlayed.set(recent);
    } catch (error) {
        console.error('[Activity] Failed to refresh recently played:', error);
    }
}
