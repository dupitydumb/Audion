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

// fans out individual unlikeTrack call
// clears the store optimistically, then restores
// only the ids whose backend call actually failed
// returns the number of tracks that failed to unlike (0 = full success)
// Never rejects: a partial failure isn't a single error to throw, it's a
// per-track outcome the caller may want to report (e.g. a toast)
export async function unlikeAll(): Promise<number> {
    const currentIds = get(likedTrackIds);
    if (currentIds.size === 0) return 0;

    const idsToUnlike = Array.from(currentIds);

    // optimistic clear
    likedTrackIds.set(new Set());

    // chunk requests instead of firing hundreds/thousands of concurrent IPC
    // calls at once for a large liked-songs library
    const CHUNK_SIZE = 25;
    const results: PromiseSettledResult<unknown>[] = [];
    for (let i = 0; i < idsToUnlike.length; i += CHUNK_SIZE) {
        const chunk = idsToUnlike.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.allSettled(chunk.map((id) => unlikeTrack(id)));
        results.push(...chunkResults);
    }

    const failedIds = idsToUnlike.filter((_, i) => results[i].status === 'rejected');

    if (failedIds.length > 0) {
        console.error(
            `[Liked] Failed to unlike ${failedIds.length} of ${idsToUnlike.length} tracks:`,
            results
                .map((r, i) => (r.status === 'rejected' ? { id: idsToUnlike[i], reason: r.reason } : null))
                .filter(Boolean),
        );
        // restore only the ones that actually failed
        // preserving any likes added by other code while this was in flight
        likedTrackIds.update((ids) => {
            const restored = new Set(ids);
            for (const id of failedIds) restored.add(id);
            return restored;
        });
    }

    return failedIds.length;
}