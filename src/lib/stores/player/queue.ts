// Queue slot helpers and context predicates. No playback logic.
import { get } from 'svelte/store';
import { derived } from 'svelte/store';
import {
    queue, queueIndex, userQueueCount,
    shuffle, shuffledIndices, shuffledIndex,
    repeat, currentTime, duration,
    playbackContext, pluginEvents
} from './stores';
import type { Track } from '$lib/api/tauri';

// Progress as percentage (0-1)
export const progress = derived(
    [currentTime, duration],
    ([$currentTime, $duration]) => {
        if (!$duration || $duration === 0) return 0;
        return $currentTime / $duration;
    }
);

// ─── Shuffle helper ───────────────────────────────────────────────────────────
export function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ─── Queue index navigation ───────────────────────────────────────────────────

/**
 * Compute the next queue index without mutating stores (dry=true) or with mutation.
 * Returns null if there is no next track.
 */
export function _advanceQueueIndex(dry = false): number | null {
    const q = get(queue);
    const rep = get(repeat);
    const shuf = get(shuffle);
    const userCount = get(userQueueCount);
    let idx = get(queueIndex);

    if (q.length === 0) return null;

    if (userCount > 0) {
        idx = idx + 1;
        if (!dry) userQueueCount.update(c => Math.max(0, c - 1));

    } else if (shuf) {
        const shufIndices = get(shuffledIndices);
        let shufIdx = get(shuffledIndex) + 1;

        if (shufIdx >= shufIndices.length) {
            if (rep === 'all') {
                shufIdx = 0;
            } else {
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
                return null;
            }
        }
    }

    return idx;
}

// ─── Queue mutations ──────────────────────────────────────────────────────────

export function addToQueue(tracks: Track[]): void {
    const currentIdx = get(queueIndex);
    const userCount = get(userQueueCount);
    const insertPosition = currentIdx + 1 + userCount;
    const addedCount = tracks.length;

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(insertPosition, 0, ...tracks);
        pluginEvents.emit('queueChange', { queue: newQueue, index: currentIdx });
        return newQueue;
    });

    userQueueCount.update(c => c + addedCount);

    if (get(shuffle)) {
        console.log('Updating shuffle in addToQueue');
        shuffledIndices.update(indices => {
            const shifted = indices.map(i => i >= insertPosition ? i + addedCount : i);
            const newIndices = Array.from({ length: addedCount }, (_, i) => insertPosition + i);
            const shuffledNew = shuffleArray(newIndices);
            return [...shifted, ...shuffledNew];
        });
    }

    // notify playback module to
    // reschedule preload + resync player.rs's queue mirror
    // otherwise, rust's advance/crossfade decisions run off a stale queue
    // it never sees the track we just added
    _onReorderComplete?.();
}

export function removeFromQueue(index: number): void {
    const currentIdx = get(queueIndex);

    queue.update(q => {
        const newQueue = [...q];
        newQueue.splice(index, 1);
        return newQueue;
    });

    if (index < currentIdx) {
        queueIndex.update(i => i - 1);
    }

    if (get(shuffle)) {
        shuffledIndices.update(indices => {
            return indices
                .filter(i => i !== index)
                .map(i => i > index ? i - 1 : i);
        });
    }

    if (get(shuffle)) {
        const actualCurrentQIdx = get(queueIndex);
        const sIndices = get(shuffledIndices);
        const ptr = sIndices.indexOf(actualCurrentQIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }

    // notify playback module to
    // reschedule preload + resync player.rs's queue mirror
    _onReorderComplete?.();
}

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

    if (fromIndex === currentIdx) {
        queueIndex.set(toIndex);
    } else if (fromIndex < currentIdx && toIndex >= currentIdx) {
        queueIndex.update(i => i - 1);
    } else if (fromIndex > currentIdx && toIndex <= currentIdx) {
        queueIndex.update(i => i + 1);
    }

    if (isShuffle) {
        shuffledIndices.update(indices => {
            const fromPos = indices.indexOf(fromIndex);
            const toPos = indices.indexOf(toIndex);

            const remapped = indices.map(i => {
                if (i === fromIndex) return toIndex;
                if (fromIndex < toIndex) {
                    if (i > fromIndex && i <= toIndex) return i - 1;
                } else {
                    if (i >= toIndex && i < fromIndex) return i + 1;
                }
                return i;
            });

            if (fromPos !== -1 && toPos !== -1 && fromPos !== toPos) {
                const [moved] = remapped.splice(fromPos, 1);
                remapped.splice(toPos, 0, moved);
            }

            return remapped;
        });

        const currentQueueIdx = get(queueIndex);
        const ptr = get(shuffledIndices).indexOf(currentQueueIdx);
        if (ptr !== -1) {
            shuffledIndex.set(ptr);
        }
    }

    pluginEvents.emit('queueChange', { queue: get(queue), index: get(queueIndex) });

    // Notify playback module to reschedule preload
    _onReorderComplete?.();
}

let _onReorderComplete: (() => void) | null = null;
export function registerReorderCallback(cb: () => void): void {
    _onReorderComplete = cb;
}

export function clearUpcoming(): void {
    const currentIdx = get(queueIndex);
    queue.update(q => q.slice(0, currentIdx + 1));
    userQueueCount.set(0);

    if (get(shuffle)) {
        shuffledIndices.update(indices => indices.filter(i => i <= currentIdx));
        const ptr = get(shuffledIndices).indexOf(currentIdx);
        shuffledIndex.set(ptr !== -1 ? ptr : 0);
    }

    // notify playback module to
    // reschedule preload + resync player.rs's queue mirror
    _onReorderComplete?.();
}

// ─── Context predicates ───────────────────────────────────────────────────────

export function isPlaylistPlaying(playlistId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'playlist' && ctx.playlistId === playlistId;
}

export function isAlbumPlaying(albumId: number): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'album' && ctx.albumId === albumId;
}

export function isArtistPlaying(artistName: string): boolean {
    const ctx = get(playbackContext);
    return ctx?.type === 'artist' && ctx.artistName === artistName;
}
