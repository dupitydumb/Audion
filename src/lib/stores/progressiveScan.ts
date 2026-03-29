// lib/stores/progressiveScan.ts
import { writable, derived } from 'svelte/store';
import { listen } from '$lib/api/tauri';
import type { ScanProgress, ScanBatchEvent, ScanResult } from '$lib/api/tauri';
import {
    tracks,
    albums,
    artists,
    trackCount,
    albumCount,
    artistCount
} from '$lib/stores/library';

export type ScanMode = 'library' | 'folder';

interface ScanState {
    isScanning: boolean;
    mode: ScanMode;
    /** Only populated during folder imports */
    playlistId: number | null;
    progress: ScanProgress | null;
    startTime: number | null;
    errors: string[];
}

const INITIAL_STATE: ScanState = {
    isScanning: false,
    mode: 'library',
    playlistId: null,
    progress: null,
    startTime: null,
    errors: [],
};

function createProgressiveScanStore() {
    const { subscribe, set, update } = writable<ScanState>(INITIAL_STATE);

    // Cleanup functions
    let unlistenBatch: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    function cleanup() {
        if (unlistenBatch) { unlistenBatch(); unlistenBatch = null; }
        if (unlistenComplete) { unlistenComplete(); unlistenComplete = null; }
    }

    async function attachListeners(batchEvent: string, completeEvent: string) {
        const funcStart = performance.now();

        unlistenBatch = await listen<ScanBatchEvent>(batchEvent, (event) => {
            const batchHandlerStart = performance.now();
            const { tracks: batchTracks, progress } = event.payload;

            console.log(
                `[ProgressiveScan] Batch ${progress.current_batch}: ` +
                `${batchTracks.length} tracks ` +
                `(${progress.current}/${progress.total})`
            );

            const trackUpdateStart = performance.now();
            tracks.update(existing => [...existing, ...batchTracks]);

            trackCount.update(n => n + batchTracks.length);
            update(state => ({ ...state, progress }));

        });

        unlistenComplete = await listen<ScanResult>(completeEvent, (event) => {
            const result = event.payload;
            console.log('[ProgressiveScan] Complete!', result);

            update(state => ({
                ...state,
                isScanning: false,
                errors: result.errors,
            }));

            cleanup();
        });
    }

    return {
        subscribe,

        /**
         * Start a full library rescan.
         * Clears existing library data and streams batches via
         * 'scan-batch-ready' / 'scan-complete'.
         */
        async startScan(clearExisting: boolean = true) {
            const funcStart = performance.now();
            console.log('[ProgressiveScan] Starting library scan...');

            // Clear library if requested (for full rescan)
            if (clearExisting) {
                const clearStart = performance.now();
                console.log('[ProgressiveScan] Clearing existing library data');
                tracks.set([]);
                albums.set([]);
                artists.set([]);
                trackCount.set(0);
                albumCount.set(0);
                artistCount.set(0);
            }

            set({ ...INITIAL_STATE, isScanning: true, mode: 'library', startTime: Date.now() });

            try {
                await attachListeners('scan-batch-ready', 'scan-complete');
            } catch (error) {
                console.error('[ProgressiveScan] Failed to set up scan listeners:', error);
                update(state => ({
                    ...state,
                    isScanning: false,
                    errors: [`Failed to set up scan listeners: ${error}`],
                }));
            }
        },

        /**
         * Attach folder import listeners BEFORE the backend command is invoked.
         * Call this, then invoke beginFolderImport, then call startImport(id).
         */
        async prepareImport() {
            set({ ...INITIAL_STATE, isScanning: true, mode: 'folder', playlistId: null, startTime: Date.now() });
            try {
                await attachListeners('folder-import-batch-ready', 'folder-import-complete');
            } catch (error) {
                console.error('[ProgressiveScan] Failed to set up import listeners:', error);
                update(state => ({
                    ...state,
                    isScanning: false,
                    errors: [`Failed to set up import listeners: ${error}`],
                }));
                throw error; // re-throw so handleImportFolder's catch fires
            }
        },

        /**
         * Start a folder import for a specific playlist.
         * Appends to the existing library (no clear) and streams batches via
         * 'folder-import-batch-ready' / 'folder-import-complete'.
         */
        async startImport(playlistId: number) {
            console.log('[ProgressiveScan] Starting folder import, playlist:', playlistId);
            // listeners already attached by prepareImport. just update state
            update(state => ({ ...state, playlistId }));
        },

        /**
         * Reset scan state and remove all event listeners.
         */
        reset() {
            console.log('[ProgressiveScan] Resetting scan state');
            cleanup();
            set(INITIAL_STATE);
        },
    };
}

export const progressiveScan = createProgressiveScanStore();

// (for UI components

/**
 * Current scan progress
 */
export const scanProgress = derived(progressiveScan, $s => $s.progress);

/**
 * Scan completion percentage (0-100)
 */
export const scanPercentage = derived(progressiveScan, $s => {
    if (!$s.progress) return 0;
    return ($s.progress.current / $s.progress.total) * 100;
});

/**
 * Estimated time remaining
 */
export const estimatedTimeRemaining = derived(progressiveScan, $s => {
    if (!$s.progress) return null;
    const ms = $s.progress.estimated_time_remaining_ms;
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
});

/**
 * Is currently scanning
 */
export const isScanning = derived(progressiveScan, $s => $s.isScanning);

export const scanMode = derived(progressiveScan, $s => $s.mode);

/**
 * Elapsed time since scan started
 */
export const elapsedTime = derived(progressiveScan, $s => {
    if (!$s.startTime) return null;
    const seconds = Math.floor((Date.now() - $s.startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
});

/**
 * Number of tracks added during current scan
 */
export const tracksAdded = derived(progressiveScan, $s => $s.progress?.tracks_added ?? 0);
export const tracksUpdated = derived(progressiveScan, $s => $s.progress?.tracks_updated ?? 0);

/** The playlist being imported into, or null during library scans. */
export const importPlaylistId = derived(progressiveScan, $s => $s.playlistId);