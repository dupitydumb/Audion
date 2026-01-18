// Download service for streaming tracks
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { appSettings } from '$lib/stores/settings';
import { pluginStore } from '$lib/stores/plugin-store';
import { addToast } from '$lib/stores/toast';
import { loadLibrary } from '$lib/stores/library';
import type { Track } from '$lib/api/tauri';

export interface DownloadProgress {
    current: number;
    total: number;
    currentTrack: Track;
    bytesCurrent?: number;
    bytesTotal?: number;
}

export interface DownloadResult {
    success: string[];
    failed: { track: Track; error: string }[];
}

/**
 * Check if a track can be downloaded (is a streaming track with an active resolver)
 */
export function canDownload(track: Track): boolean {
    // If it already has a local source, we treat it as already downloaded
    if (track.local_src) return false;

    // Local tracks are already on disk
    if (!track.source_type || track.source_type === 'local') {
        return false;
    }

    // Check if a stream resolver exists for this source type
    const runtime = pluginStore.getRuntime();
    if (!runtime) return false;

    return runtime.streamResolvers.has(track.source_type);
}

/**
 * Check if any tracks in the list can be downloaded
 */
export function hasDownloadableTracks(tracks: Track[]): boolean {
    return tracks.some(track => canDownload(track));
}

/**
 * Get the download location from settings
 */
export function getDownloadLocation(): string | null {
    return get(appSettings).downloadLocation;
}

/**
 * Check if download location is configured
 */
export function needsDownloadLocation(): boolean {
    return !getDownloadLocation();
}

/**
 * Generate a safe filename from track metadata
 */
function generateFilename(track: Track): string {
    const sanitize = (str: string | null | undefined): string => {
        if (!str) return 'Unknown';
        // Remove invalid filename characters
        return str.replace(/[<>:"/\\|?*]/g, '_').trim();
    };

    const artist = sanitize(track.artist);
    const title = sanitize(track.title);

    // Format: Artist - Title.extension
    // Use .m4a as default since most streaming services provide AAC
    return `${artist} - ${title}.m4a`;
}

/**
 * Download a single track
 */
export async function downloadTrack(track: Track): Promise<string> {
    const downloadLocation = getDownloadLocation();
    if (!downloadLocation) {
        throw new Error('No download location configured. Please set one in Settings.');
    }

    if (!canDownload(track)) {
        throw new Error('Track cannot be downloaded. It may be a local track or the streaming plugin is not active.');
    }

    const runtime = pluginStore.getRuntime();
    if (!runtime) {
        throw new Error('Plugin runtime not available.');
    }

    // Resolve the stream URL
    const streamUrl = await runtime.resolveStreamUrl(track.source_type!, track.external_id!);
    if (!streamUrl) {
        throw new Error(`Failed to resolve stream URL for "${track.title}"`);
    }

    const filename = generateFilename(track);
    const fullPath = `${downloadLocation}/${filename}`;

    // Set up progress listener
    // We'll use a unique ID for the event or filter by path if possible, 
    // but for now we'll listen to the global event and filter by path
    const unlisten = await listen<any>('download://progress', (event) => {
        if (event.payload.path === fullPath) {
            // Dispatch a custom event or update a store if we had one for individual track progress
            // For now, this is mainly for the batch downloader to pick up
        }
    });

    try {
        // Call Rust download command
        await invoke<string>('download_and_save_audio', {
            input: {
                url: streamUrl,
                path: fullPath,
                title: track.title || null,
                artist: track.artist || null,
                album: track.album || null,
                track_number: track.track_number || null,
                cover_url: track.cover_url || null
            }
        });

        // Update track with local source
        track.local_src = fullPath;

        // Persist local_src to database
        try {
            await invoke('update_local_src', {
                trackId: track.id,
                localSrc: fullPath
            });
        } catch (err) {
            console.error('Failed to persist local_src to database:', err);
            // Non-fatal error, but good to know
        }

        return fullPath;
    } finally {
        unlisten();
    }
}

/**
 * Download multiple tracks with progress callback
 */
export async function downloadTracks(
    tracks: Track[],
    onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
    const downloadableTracks = tracks.filter(t => canDownload(t));

    if (downloadableTracks.length === 0) {
        return { success: [], failed: [] };
    }

    const downloadLocation = getDownloadLocation();
    if (!downloadLocation) {
        throw new Error('No download location configured. Please set one in Settings.');
    }

    const result: DownloadResult = {
        success: [],
        failed: []
    };

    // Listen for progress events
    const unlisten = await listen<any>('download://progress', (event) => {
        const { current, total } = event.payload;
        // Find which track is currently being downloaded based on index or state
        // Since we download sequentially, we can use the loop context if we were inside it,
        // but the listener is outside.
        // However, we can pass the progress data up.
        // For smoother UI, we might want to sum up totals, but for now let's show per-track progress.
        // We'll handle the UI update in the loop.
    });

    try {
        for (let i = 0; i < downloadableTracks.length; i++) {
            const track = downloadableTracks[i];

            // Create a specific listener for this track's download
            const trackUnlisten = await listen<any>('download://progress', (event) => {
                // Check if the path matches (we'd need to know the path ahead of time)
                const filename = generateFilename(track);
                // Normalize paths for comparison if needed, but usually exact match works
                if (event.payload.path.includes(filename)) {
                    onProgress?.({
                        current: i + 1,
                        total: downloadableTracks.length,
                        currentTrack: track,
                        bytesCurrent: event.payload.current,
                        bytesTotal: event.payload.total
                    });
                }
            });

            onProgress?.({
                current: i + 1,
                total: downloadableTracks.length,
                currentTrack: track,
                bytesCurrent: 0,
                bytesTotal: 0
            });

            try {
                const savedPath = await downloadTrack(track);
                result.success.push(savedPath);
            } catch (error) {
                result.failed.push({
                    track,
                    error: error instanceof Error ? error.message : String(error)
                });
                console.error(`Failed to download "${track.title}":`, error);
            } finally {
                trackUnlisten();
            }
        }
    } finally {
        unlisten();
    }

    // Rescan library to pick up new files
    if (result.success.length > 0) {
        try {
            await invoke('scan_music', { paths: [downloadLocation] });
            await loadLibrary();
        } catch (e) {
            console.warn('[DownloadService] Auto-rescan failed:', e);
        }
    }

    return result;
}

/**
 * Show download result as toast notifications
 */
export function showDownloadResult(result: DownloadResult): void {
    if (result.success.length > 0) {
        addToast(
            `Downloaded ${result.success.length} track${result.success.length > 1 ? 's' : ''} successfully`,
            'success'
        );
    }

    if (result.failed.length > 0) {
        addToast(
            `Failed to download ${result.failed.length} track${result.failed.length > 1 ? 's' : ''}`,
            'error'
        );
    }
}
