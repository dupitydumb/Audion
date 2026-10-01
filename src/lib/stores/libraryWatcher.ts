// lib/stores/libraryWatcher.ts
//
// subscribes to the backend's live filesystem watcher and startup reconciliation
//   - watch-batch-ready    -> ScanBatchEvent  (adds/updates)
//   - watch-tracks-deleted -> number[]        (track ids removed)
//
// deliberately not routed through the progressiveScan store
// the watcher has no session or "complete" event
import { writable } from 'svelte/store';
import { listen } from '$lib/api/tauri';
import type { ScanBatchEvent } from '$lib/api/tauri';
import { ingestWatcherBatch, removeTracksByIds, loadAlbumsAndArtists } from '$lib/stores/library';

/**
 * true whenever the backend watcher/reconciliation pass has recent activity in flight, for a small sidebar spinner
 * (see LibraryWatcherStatus.svelte)
 */
export const isWatcherActive = writable(false);

let unlistenBatch: (() => void) | null = null;
let unlistenDeleted: (() => void) | null = null;
let started = false;

// album/artist aggregation is reloaded wholesale
// cheap enough for the small, infrequent batches the watcher produces, and avoids a second merge algorithm
let albumsReloadTimer: ReturnType<typeof setTimeout> | null = null;
const ALBUMS_RELOAD_DEBOUNCE_MS = 500;

function scheduleAlbumsReload() {
    isWatcherActive.set(true);
    if (albumsReloadTimer) clearTimeout(albumsReloadTimer);
    albumsReloadTimer = setTimeout(() => {
        albumsReloadTimer = null;
        void loadAlbumsAndArtists().finally(() => {
            isWatcherActive.set(false);
        });
    }, ALBUMS_RELOAD_DEBOUNCE_MS);
}

/**
 * start listening for watcher-driven library changes
 * call once at app startup (after the initial loadLibrary)
 */
export async function startLibraryWatcherSync(): Promise<void> {
    if (started) return;
    started = true;

    try {
        unlistenBatch = await listen<ScanBatchEvent>('watch-batch-ready', (event) => {
            const { tracks: batchTracks, progress } = event.payload;
            if (batchTracks.length === 0) return;

            console.log(
                `[LibraryWatcher] Batch: ${batchTracks.length} tracks ` +
                `(${progress.tracks_added} added, ${progress.tracks_updated} updated)`
            );

            ingestWatcherBatch(event.payload);
            scheduleAlbumsReload();
        });

        unlistenDeleted = await listen<number[]>('watch-tracks-deleted', (event) => {
            const ids = event.payload;
            if (!ids || ids.length === 0) return;

            console.log(`[LibraryWatcher] ${ids.length} track(s) removed`);

            removeTracksByIds(ids);
            scheduleAlbumsReload();
        });
    } catch (error) {
        console.error('[LibraryWatcher] Failed to attach listeners:', error);
        started = false;
    }
}

/**
 * stop listening
 * not currently called anywhere
 */
export function stopLibraryWatcherSync(): void {
    if (unlistenBatch) { unlistenBatch(); unlistenBatch = null; }
    if (unlistenDeleted) { unlistenDeleted(); unlistenDeleted = null; }
    if (albumsReloadTimer) { clearTimeout(albumsReloadTimer); albumsReloadTimer = null; }
    isWatcherActive.set(false);
    started = false;
}