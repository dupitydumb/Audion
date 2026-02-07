// Tauri API bindings for Rlist

// Check if we're running in Tauri environment
export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Dynamic imports to avoid SSR issues
let invokeFunc: typeof import('@tauri-apps/api/core').invoke | null = null;
let openFunc: typeof import('@tauri-apps/plugin-dialog').open | null = null;
let convertFileSrcFunc: typeof import('@tauri-apps/api/core').convertFileSrc | null = null;
let listenFunc: typeof import('@tauri-apps/api/event').listen | null = null;

async function ensureTauriLoaded() {
    if (!isTauri()) {
        throw new Error('Not running in Tauri environment');
    }
    if (!invokeFunc) {
        const core = await import('@tauri-apps/api/core');
        invokeFunc = core.invoke;
        convertFileSrcFunc = core.convertFileSrc;
    }
    if (!openFunc) {
        const dialog = await import('@tauri-apps/plugin-dialog');
        openFunc = dialog.open;
    }
    if (!listenFunc) {
        const event = await import('@tauri-apps/api/event');
        listenFunc = event.listen;
    }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await ensureTauriLoaded();
    return invokeFunc!(cmd, args);
}

export function convertFileSrc(filePath: string): string {
    if (!convertFileSrcFunc) {
        throw new Error('Tauri not loaded');
    }
    return convertFileSrcFunc(filePath);
}

// Event listener helper — used by the progressive scan pipeline
// to receive scan-batch-ready and scan-complete events
export async function listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
    await ensureTauriLoaded();
    const unlisten = await listenFunc!(event, handler);
    return unlisten;
}

// Types
export interface Track {
    id: number;
    path: string;
    title: string | null;
    artist: string | null;
    album: string | null;
    track_number: number | null;
    duration: number | null;
    album_id: number | null;
    format: string | null;
    bitrate: number | null;
    cover_url?: string | null;  // For streaming services (Tidal, etc.)
    track_cover?: string | null; // old - Track's embedded cover (base64)
    track_cover_path?: string | null; // File path to cover image
    source_type?: string | null;  // 'local', 'tidal', 'url'
    external_id?: string | null;  // Source-specific ID
    local_src?: string | null; // Local file path for offline playback
}

export interface Album {
    id: number;
    name: string;
    artist: string | null;
    art_data: string | null; // old - base64 album art
    art_path?: string | null; // File path to album art
}

export interface Artist {
    name: string;
    track_count: number;
    album_count: number;
}

export interface Playlist {
    id: number;
    name: string;
    created_at: string | null;
}

export interface Library {
    tracks: Track[];
    albums: Album[];
    artists: Artist[];
}

export interface ScanResult {
    tracks_added: number;
    tracks_updated: number;
    tracks_deleted: number;
    errors: string[];
}

// Progressive scan types
export interface ScanProgress {
    current: number;
    total: number;
    current_batch: number;
    batch_size: number;
    estimated_time_remaining_ms: number;
    tracks_added: number;      
    tracks_updated: number;
}

export interface ScanBatchEvent {
    tracks: Track[];
    progress: ScanProgress;
}

export interface MigrationProgress {
    total: number;
    processed: number;
    tracks_migrated: number;
    albums_migrated: number;
    errors: string[];
}

export interface MergeCoverResult {
    covers_merged: number;
    space_saved_bytes: number;
    albums_processed: number;
    errors: string[];
}

// Library commands
export async function scanMusic(paths: string[]): Promise<ScanResult> {
    return await invoke('scan_music', { paths });
}

export async function addFolder(path: string): Promise<void> {
    return await invoke('add_folder', { path });
}

export async function rescanMusic(): Promise<ScanResult> {
    return await invoke('rescan_music');
}

export async function getLibrary(): Promise<Library> {
    return await invoke('get_library');
}

export async function getTracksPaginated(limit: number, offset: number): Promise<Track[]> {
    return await invoke('get_tracks_paginated', { limit, offset });
}

export async function getAlbumsPaginated(limit: number, offset: number): Promise<Album[]> {
    return await invoke<Album[]>("get_albums_paginated", { limit, offset });
}

export async function searchLibrary(query: string, limit: number, offset: number): Promise<Track[]> {
    return await invoke('search_library', { query, limit, offset });
}

export async function getTracksByAlbum(albumId: number): Promise<Track[]> {
    return await invoke('get_tracks_by_album', { albumId });
}

export async function getTracksByArtist(artist: string): Promise<Track[]> {
    return await invoke('get_tracks_by_artist', { artist });
}

export async function getAlbum(albumId: number): Promise<Album | null> {
    return await invoke('get_album', { albumId });
}

export async function getAlbumsByArtist(artist: string): Promise<Album[]> {
    return await invoke('get_albums_by_artist', { artist });
}

export interface ExternalTrackInput {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    cover_url?: string;
    source_type: string;  // e.g., 'tidal', 'url'
    external_id: string;  // Source-specific ID
    format?: string;
    bitrate?: number;
}

export async function addExternalTrack(track: ExternalTrackInput): Promise<number> {
    return await invoke('add_external_track', { track });
}

export async function deleteTrack(trackId: number): Promise<boolean> {
    return await invoke('delete_track', { trackId });
}

export async function deleteAlbum(albumId: number): Promise<boolean> {
    return await invoke('delete_album', { albumId });
}

export async function resetDatabase(): Promise<void> {
    return await invoke('reset_database');
}

// Cover Loading Commands

// Migrate all existing base64 covers to file-based storage
// This is a one-time thing that should be run after upgrading
export async function migrateCoversToFiles(): Promise<MigrationProgress> {
    return await invoke('migrate_covers_to_files');
}


// Get the file path for a single track's cover
// Returns null if no cover exists
export async function getTrackCoverPath(trackId: number): Promise<string | null> {
    return await invoke('get_track_cover_path', { trackId });
}

// Get cover paths for multiple tracks in a single batch operation
// Returns a map of trackId -> coverPath
export async function getBatchCoverPaths(trackIds: number[]): Promise<Record<number, string>> {
    return await invoke('get_batch_cover_paths', { trackIds });
}

// Get the file path for an album's art
// Returns null if no art exists
export async function getAlbumArtPath(albumId: number): Promise<string | null> {
    return await invoke('get_album_art_path', { albumId });
}

// Convert a file path to an asset URL for browser use
// (This is mostly handled on the frontend via convertFileSrc)
export async function getCoverAsAssetUrl(filePath: string): Promise<string> {
    return await invoke('get_cover_as_asset_url', { filePath });
}

// Preload covers for better performance
// Currently not used, but could implement backend caching in the future
export async function preloadCovers(trackIds: number[]): Promise<void> {
    return await invoke('preload_covers', { trackIds });
}

// Clean up orphaned cover files (covers without corresponding tracks/albums)
// Returns the number of files deleted
export async function cleanupOrphanedCoverFiles(): Promise<number> {
    return await invoke('cleanup_orphaned_cover_files');
}

// Clear all base64 cover data from the database after successful migration
// imp -Only run this after verifying all covers have been migrated
export async function clearBase64Covers(): Promise<number> {
    return await invoke('clear_base64_covers');
}

// Helper Functions for Cover Display
// Get the cover source URL for a track
// Handles both file paths and base64 data
// Priority: file path > base64 > null
export function getTrackCoverSrc(track: Track): string | null {
    // Priority 1: File path (new system)
    if (track.track_cover_path) {
        return convertFileSrc(track.track_cover_path);
    }

    // Priority 2: Base64 data - old
    if (track.track_cover) {
        return getAlbumArtSrc(track.track_cover, false);
    }

    // Priority 3: Cover URL (for streaming services)
    if (track.cover_url) {
        return track.cover_url;
    }

    return null;
}

// Get the album art source URL
// Handles both file paths and base64 data
// Priority: file path > base64 > null
export function getAlbumCoverSrc(album: Album): string | null {
    // Priority 1: File path (new system)
    if (album.art_path) {
        return convertFileSrc(album.art_path);
    }

    // Priority 2: Base64 data - old
    if (album.art_data) {
        return getAlbumArtSrc(album.art_data, false);
    }

    return null;
}

/**
 * Convert album art data or path to a displayable URL
 * @param artDataOrPath - Either base64 string or file path
 * @param isPath - Whether the input is a file path (true) or base64 (false)
 */
export function getAlbumArtSrc(artDataOrPath: string | null, isPath: boolean = false): string | null {
    if (!artDataOrPath) return null;

    // If it's a file path, convert to asset URL
    if (isPath) {
        return convertFileSrc(artDataOrPath);
    }

    // Otherwise treat as base64
    // Detect image type from base64 header
    if (artDataOrPath.startsWith('/9j/')) {
        return `data:image/jpeg;base64,${artDataOrPath}`;
    } else if (artDataOrPath.startsWith('iVBOR')) {
        return `data:image/png;base64,${artDataOrPath}`;
    }
    // Default to JPEG
    return `data:image/jpeg;base64,${artDataOrPath}`;
}

export async function mergeDuplicateCovers(): Promise<MergeCoverResult> {
    return await invoke('merge_duplicate_covers');
}


// Playlist commands

export async function createPlaylist(name: string): Promise<number> {
    return await invoke('create_playlist', { name });
}

export async function getPlaylists(): Promise<Playlist[]> {
    return await invoke('get_playlists');
}

export async function getPlaylistTracks(playlistId: number): Promise<Track[]> {
    return await invoke('get_playlist_tracks', { playlistId });
}

export async function addTrackToPlaylist(playlistId: number, trackId: number): Promise<void> {
    return await invoke('add_track_to_playlist', { playlistId, trackId });
}

export async function removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
    return await invoke('remove_track_from_playlist', { playlistId, trackId });
}

export async function deletePlaylist(playlistId: number): Promise<void> {
    return await invoke('delete_playlist', { playlistId });
}

export async function renamePlaylist(playlistId: number, newName: string): Promise<void> {
    return await invoke('rename_playlist', { playlistId, newName });
}

export async function reorderPlaylistTracks(playlistId: number, fromIndex: number, toIndex: number): Promise<void> {
    return await invoke('reorder_playlist_tracks', { playlistId, fromIndex, toIndex });
}


// File dialog

export async function selectMusicFolder(): Promise<string | null> {
    await ensureTauriLoaded();
    const selected = await openFunc!({
        directory: true,
        multiple: false,
        title: 'Select Music Folder',
    });
    return selected as string | null;
}

// Initialize player - load Tauri APIs
export async function initializePlayer(): Promise<void> {
    await ensureTauriLoaded();
}

// Convert local file path to asset URL for playback
export async function getAudioSrc(filePath: string): Promise<string> {
    await ensureTauriLoaded();
    return convertFileSrcFunc!(filePath);
}

// Format duration from seconds to MM:SS
export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function syncCoverPathsFromFiles(): Promise<MigrationProgress> {
    return await invoke('sync_cover_paths_from_files');
}