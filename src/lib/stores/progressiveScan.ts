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

interface ScanState {
    isScanning: boolean;
    progress: ScanProgress | null;
    startTime: number | null;
    errors: string[];
}

function createProgressiveScanStore() {
    const { subscribe, set, update } = writable<ScanState>({
        isScanning: false,
        progress: null,
        startTime: null,
        errors: [],
    });

    // Cleanup functions
    let unlistenBatch: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    return {
        subscribe,

        /**
         * Start progressive scan
         * Sets up event listeners for batch updates
         */
        async startScan(clearExisting: boolean = true) {
            const funcStart = performance.now();
            console.log('[ProgressiveScan] Starting progressive scan...');
            console.log(` [TIMING] startScan called at ${funcStart.toFixed(2)}ms`);

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
                console.log(` [TIMING] Library clear took ${(performance.now() - clearStart).toFixed(2)}ms`);
            }

            // Reset scan state
            const stateStart = performance.now();
            set({
                isScanning: true,
                progress: null,
                startTime: Date.now(),
                errors: [],
            });
            console.log(` [TIMING] State reset took ${(performance.now() - stateStart).toFixed(2)}ms`);

            // Listen for batch-ready events
            try {
                const listenStart = performance.now();
                console.log(` [TIMING] Setting up batch listener at ${listenStart.toFixed(2)}ms`);

                unlistenBatch = await listen<ScanBatchEvent>('scan-batch-ready', (event) => {
                    const batchHandlerStart = performance.now();
                    const { tracks: batchTracks, progress } = event.payload;

                    console.log(
                        `[ProgressiveScan] Batch ${progress.current_batch}: ` +
                        `${batchTracks.length} tracks ` +
                        `(${progress.current}/${progress.total})`
                    );
                    console.log(` [TIMING] Batch ${progress.current_batch} received at ${batchHandlerStart.toFixed(2)}ms (${(batchHandlerStart - funcStart).toFixed(2)}ms since startScan)`);

                    // Update library.tracks directly (append to existing)
                    const trackUpdateStart = performance.now();
                    tracks.update(existing => [...existing, ...batchTracks]);
                    console.log(` [TIMING] Track update took ${(performance.now() - trackUpdateStart).toFixed(2)}ms`);

                    // Update count
                    trackCount.update(n => n + batchTracks.length);

                    // Update progress
                    update(state => ({
                        ...state,
                        progress,
                    }));

                    console.log(` [TIMING] Batch ${progress.current_batch} handler total: ${(performance.now() - batchHandlerStart).toFixed(2)}ms`);
                });

                console.log(` [TIMING] Batch listener setup took ${(performance.now() - listenStart).toFixed(2)}ms`);

                // Listen for completion
                const completeListenStart = performance.now();
                console.log(` [TIMING] Setting up completion listener at ${completeListenStart.toFixed(2)}ms`);

                unlistenComplete = await listen<ScanResult>('scan-complete', (event) => {
                    const result = event.payload;

                    console.log('[ProgressiveScan] Scan complete!', result);

                    update(state => ({
                        ...state,
                        isScanning: false,
                        errors: result.errors,
                    }));

                    // Cleanup listeners
                    if (unlistenBatch) {
                        unlistenBatch();
                        unlistenBatch = null;
                    }
                    if (unlistenComplete) {
                        unlistenComplete();
                        unlistenComplete = null;
                    }
                });

            } catch (error) {
                console.error('[ProgressiveScan] Failed to set up event listeners:', error);

                update(state => ({
                    ...state,
                    isScanning: false,
                    errors: [`Failed to set up scan listeners: ${error}`],
                }));
            }
        },

        /**
         * Reset scan state and cleanup
         */
        reset() {
            console.log('[ProgressiveScan] Resetting scan state');

            if (unlistenBatch) {
                unlistenBatch();
                unlistenBatch = null;
            }
            if (unlistenComplete) {
                unlistenComplete();
                unlistenComplete = null;
            }

            set({
                isScanning: false,
                progress: null,
                startTime: null,
                errors: [],
            });
        },
    };
}

export const progressiveScan = createProgressiveScanStore();

// (for UI components

/**
 * Current scan progress
 */
export const scanProgress = derived(
    progressiveScan,
    $scan => $scan.progress
);

/**
 * Scan completion percentage (0-100)
 */
export const scanPercentage = derived(
    progressiveScan,
    $scan => {
        if (!$scan.progress) return 0;
        return ($scan.progress.current / $scan.progress.total) * 100;
    }
);

/**
 * Estimated time remaining
 */
export const estimatedTimeRemaining = derived(
    progressiveScan,
    $scan => {
        if (!$scan.progress) return null;
        const ms = $scan.progress.estimated_time_remaining_ms;
        const seconds = Math.ceil(ms / 1000);

        if (seconds < 60) {
            return `${seconds}s`;
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        if (minutes < 60) {
            return `${minutes}m ${remainingSeconds}s`;
        }

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
);

/**
 * Is currently scanning
 */
export const isScanning = derived(
    progressiveScan,
    $scan => $scan.isScanning
);

/**
 * Elapsed time since scan started
 */
export const elapsedTime = derived(
    progressiveScan,
    $scan => {
        if (!$scan.startTime) return null;
        const elapsed = Date.now() - $scan.startTime;
        const seconds = Math.floor(elapsed / 1000);

        if (seconds < 60) {
            return `${seconds}s`;
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }
);

/**
 * Number of tracks added during current scan
 */
export const tracksAdded = derived(
    progressiveScan,
    $scan => $scan.progress?.tracks_added ?? 0
);

/**
 * Number of tracks updated during current scan
 */
export const tracksUpdated = derived(
    progressiveScan,
    $scan => $scan.progress?.tracks_updated ?? 0
);