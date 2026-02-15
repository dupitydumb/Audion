// Download service for streaming tracks
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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

interface DownloadTrackOptions {
    /**
     * If true, downloadTrack will set up its own progress listener.
     * If false, caller has already set up a listener.
     * Default: true
     */
    setupListener?: boolean;

    onProgress?: (bytesCurrent: number, bytesTotal: number) => void;
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
    const location = get(appSettings).downloadLocation;
    if (location) return location;

    // Detect mobile platform
    const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
        // Use the public Downloads directory for better compatibility
        return '/storage/emulated/0/Download'; // Android public Downloads directory
    }
    return null;
}

/**
 * Check if download location is configured
 */
export function needsDownloadLocation(): boolean {
    return !getDownloadLocation();
}

/**
 * Generate a safe filename from track metadata.
 * Uses .m4a as the requested extension — Rust will detect the actual container
 * type after download, rename the file on disk if needed, and return the corrected path.
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
 * Download a single track.
 *
 * Returns the final canonicalized path as confirmed by Rust, which may differ
 * in extension from the requested path(e.g. the stream is actually flac).
 * 
 * @param track - The track to download
 * @param options - download options including listener setup control
 */
export async function downloadTrack(
    track: Track,
    options: DownloadTrackOptions = {}
): Promise<string> {
    const { setupListener = true, onProgress } = options;

    // On Android, ensure we have storage permission before proceeding
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    if (isAndroid) {
        const { ensureStoragePermission } = await import('$lib/api/tauri');
        const granted = await ensureStoragePermission();
        if (!granted) {
            throw new Error('Storage permission is required to download files. Please grant permission in app settings.');
        }
    }

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

    // Use Tauri path API for cross-platform path handling
    const requestedPath = await join(downloadLocation, generateFilename(track));

    let unlisten: UnlistenFn | null = null;

    // Only set up listener if requested
    if (setupListener && onProgress) {
        // We match on the filename stem rather than full path to handle extension corrections
        const stem = generateFilename(track).replace(/\.[^.]+$/, '');
        unlisten = await listen<any>('download://progress', (event) => {
            if (event.payload.path.includes(stem)) {
                onProgress(event.payload.current, event.payload.total);
            }
        });
    }

    try {
        // Rust returns the final canonicalized path, which might be different
        // from the requested path if the file extension was corrected
        const actualPath = await invoke<string>('download_and_save_audio', {
            input: {
                url: streamUrl,
                path: requestedPath,
                title: track.title || null,
                artist: track.artist || null,
                album: track.album || null,
                track_number: track.track_number || null,
                cover_url: track.cover_url || null
            }
        });

        // Update the in-memory track to reflect its new local state
        track.local_src = actualPath;
        track.path = actualPath;
        track.source_type = 'local';

        // Persist to database using the actual final path
        try {
            await invoke('update_track_after_download', {
                trackId: track.id,
                localPath: actualPath
            });
        } catch (err) {
            console.error('Failed to update track in database:', err);
        }

        return actualPath;
    } finally {
        // Clean up listener if we created one
        if (unlisten) {
            unlisten();
        }
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

    for (let i = 0; i < downloadableTracks.length; i++) {
        const track = downloadableTracks[i];

        // We match on the filename stem 
        const stem = generateFilename(track).replace(/\.[^.]+$/, '');

        const trackUnlisten = await listen<any>('download://progress', (event) => {
            if (event.payload.path.includes(stem)) {
                onProgress?.({
                    current: i + 1,
                    total: downloadableTracks.length,
                    currentTrack: track,
                    bytesCurrent: event.payload.current,
                    bytesTotal: event.payload.total
                });
            }
        });

        // Emit an initial zero-progress event so the UI shows the track
        // immediately when its download begins
        onProgress?.({
            current: i + 1,
            total: downloadableTracks.length,
            currentTrack: track,
            bytesCurrent: 0,
            bytesTotal: 0
        });

        try {
            // Tell downloadTrack NOT to set up its own listener since we already have one
            // This prevents duplicate listeners and memory leaks
            const savedPath = await downloadTrack(track, { setupListener: false });
            result.success.push(savedPath);
        } catch (error) {
            result.failed.push({
                track,
                error: error instanceof Error ? error.message : String(error)
            });
            console.error(`Failed to download "${track.title}":`, error);
        } finally {
            // Always cleanup the listener, even on error
            trackUnlisten();
        }
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

    if (result.failed.length === 1) {
        const { track, error } = result.failed[0];
        let userMessage = error;
        if (/Failed to create (file|directory)/i.test(error)) {
            userMessage = 'Cannot create file or folder. Please check storage permissions and available space.';
        } else if (/permission/i.test(error)) {
            userMessage = 'Permission denied. Please grant storage access in app settings.';
        }
        addToast(
            `Failed to download "${track.title}". ${userMessage}`,
            'error'
        );
    } else if (result.failed.length > 1) {
        addToast(
            `Failed to download ${result.failed.length} tracks. See logs for details.`,
            'error'
        );
    }
}
