// Liked tracks store - manages liked songs state
import { writable, derived, get } from 'svelte/store';
import { likeTrack, unlikeTrack, getLikedTrackIds } from '$lib/api/tauri';

// Set of liked track IDs for O(1) lookups
export const likedTrackIds = writable<Set<number>>(new Set());

// Derived count
export const likedCount = derived(likedTrackIds, ($ids) => $ids.size);

// Load all liked track IDs from backend (call on app init)
export async function loadLikedTracks(): Promise<void> {
    try {
        const ids = await getLikedTrackIds();
        likedTrackIds.set(new Set(ids));
    } catch (error) {
        console.error('[Liked] Failed to load liked tracks:', error);
    }
}

// Check if a track is liked (synchronous from store)
export function isLiked(trackId: number): boolean {
    return get(likedTrackIds).has(trackId);
}

// Toggle like/unlike a track
export async function toggleLike(trackId: number): Promise<void> {
    const currentIds = get(likedTrackIds);
    const wasLiked = currentIds.has(trackId);

    // Optimistic update
    const newIds = new Set(currentIds);
    if (wasLiked) {
        newIds.delete(trackId);
    } else {
        newIds.add(trackId);
    }
    likedTrackIds.set(newIds);

    try {
        if (wasLiked) {
            await unlikeTrack(trackId);
        } else {
            await likeTrack(trackId);
        }
    } catch (error) {
        console.error('[Liked] Failed to toggle like:', error);
        // Revert on error
        likedTrackIds.set(currentIds);
    }
}
