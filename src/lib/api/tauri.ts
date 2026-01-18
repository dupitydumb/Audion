// Tauri API bindings for Rlist

// Check if we're running in Tauri environment
export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Dynamic imports to avoid SSR issues
let invokeFunc: typeof import('@tauri-apps/api/core').invoke | null = null;
let openFunc: typeof import('@tauri-apps/plugin-dialog').open | null = null;
let convertFileSrcFunc: typeof import('@tauri-apps/api/core').convertFileSrc | null = null;

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
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await ensureTauriLoaded();
    return invokeFunc!(cmd, args);
}

function convertFileSrc(filePath: string): string {
    if (!convertFileSrcFunc) {
        throw new Error('Tauri not loaded');
    }
    return convertFileSrcFunc(filePath);
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
    source_type?: string | null;  // 'local', 'tidal', 'url'
    external_id?: string | null;  // Source-specific ID
}

export interface Album {
    id: number;
    name: string;
    album_artist: string | null;  // Changed from 'artist' to 'album_artist'
    art_data: string | null;
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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get album art as data URL
export function getAlbumArtSrc(artData: string | null): string | null {
    if (!artData) return null;
    // Detect image type from base64 header
    if (artData.startsWith('/9j/')) {
        return `data:image/jpeg;base64,${artData}`;
    } else if (artData.startsWith('iVBOR')) {
        return `data:image/png;base64,${artData}`;
    }
    // Default to JPEG
    return `data:image/jpeg;base64,${artData}`;
}
