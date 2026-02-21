// Library store - manages music library state
import { writable, derived, get } from 'svelte/store';
import type { Track, Album, Artist, Playlist, ScanBatchEvent } from '$lib/api/tauri';
import { getLibrary, getPlaylists, getAlbumCoverSrc, getAlbumArtSrc, getTracksPaginated, getAlbumsPaginated, searchLibrary, convertFileSrc } from '$lib/api/tauri';

// BLOB URL CONVERSION
/**
 * Convert base64 data URI to Blob URL for better performance and shorter URLs
 */
function convertBase64ToBlobUrl(base64: string): string {
    // If it's already a URL or not base64, return as-is
    if (!base64 || base64.startsWith('http') || base64.startsWith('blob:')) {
        return base64;
    }

    // If it's not a data URI, assume it needs the header
    let dataUri = base64;
    if (!base64.startsWith('data:image')) {
        // Detect image type from base64 header
        if (base64.startsWith('/9j/')) {
            dataUri = `data:image/jpeg;base64,${base64}`;
        } else if (base64.startsWith('iVBOR')) {
            dataUri = `data:image/png;base64,${base64}`;
        } else {
            dataUri = `data:image/jpeg;base64,${base64}`;
        }
    }

    try {
        const [header, data] = dataUri.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const binary = atob(data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([array], { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        // Track the blob URL for cleanup
        createdBlobUrls.add(blobUrl);

        return blobUrl;
    } catch (e) {
        console.error('[Library] Failed to convert base64 to blob URL:', e);
        return base64; // Fallback to original
    }
}

// Track created blob URLs for cleanup
const createdBlobUrls = new Set<string>();

/**
 * Revoke a blob URL and remove from tracking
 */
function revokeBlobUrl(url: string | null | undefined): void {
    if (!url || !url.startsWith('blob:')) return;

    try {
        URL.revokeObjectURL(url);
        createdBlobUrls.delete(url);
    } catch (e) {
        // blob URL may already be revoked, ignore error
    }
}

// CONFIGURATION
const CACHE_CONFIG = {
    MAX_METADATA_CACHE: 100000,   // Increased for metadata
    MAX_ALBUM_ART_CACHE: 1000,    // Increased for better ux 
    TRACK_BATCH_SIZE: 1000,       // Paginated fetch size
    ENABLE_SMART_LOADING: true,
    MAX_TRACK_COVER_CACHE: 2000,  // Added limit
};

// LRU CACHE
class LRUCache<K, V> {
    private cache = new Map<K, { value: V; timestamp: number }>();
    private maxSize: number;
    private onEvict?: (key: K, value: V) => void;

    constructor(maxSize: number, options?: { onEvict?: (key: K, value: V) => void }) {
        this.maxSize = maxSize;
        this.onEvict = options?.onEvict;
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        entry.timestamp = Date.now();
        return entry.value;
    }

    set(key: K, value: V): void {
        // Evict old value if replacing existing key
        if (this.cache.has(key)) {
            const old = this.cache.get(key);
            if (old && this.onEvict) {
                this.onEvict(key, old.value);
            }
        }

        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictOldest();
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    delete(key: K): boolean {
        const entry = this.cache.get(key);
        if (entry && this.onEvict) {
            this.onEvict(key, entry.value);
        }
        return this.cache.delete(key);
    }

    clear(): void {
        // Call onEvict for all entries before clearing
        if (this.onEvict) {
            this.cache.forEach((entry, key) => {
                this.onEvict!(key, entry.value);
            });
        }
        this.cache.clear();
    }

    private evictOldest(): void {
        let oldestKey: K | null = null;
        let oldestTime = Date.now();

        this.cache.forEach((entry, key) => {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        });

        if (oldestKey !== null) {
            const entry = this.cache.get(oldestKey);
            if (entry && this.onEvict) {
                this.onEvict(oldestKey, entry.value);
            }
            this.cache.delete(oldestKey);
        }
    }

    get size(): number {
        return this.cache.size;
    }
}

// LIGHTWEIGHT DATA STRUCTURES
/**
 * Lightweight track metadata (without heavy base64 album art)
 * Uses Omit to automatically derive from Track, ensuring type safety
 */
type TrackMetadata = Omit<Track, 'track_cover'>;

// same for albums
type AlbumMetadata = Omit<Album, 'art_data'> & {
    has_art: boolean; // Additional field to track if art exists
};

// INTERNAL STORAGE
// Metadata caches (lightweight)
const trackMetadataCache = new LRUCache<number, TrackMetadata>(CACHE_CONFIG.MAX_METADATA_CACHE);
const albumMetadataCache = new LRUCache<number, AlbumMetadata>(CACHE_CONFIG.MAX_METADATA_CACHE);

// Album art cache (separate, heavy data)
const albumArtCache = new LRUCache<number, string>(CACHE_CONFIG.MAX_ALBUM_ART_CACHE, {
    onEvict: (albumId, url) => {
        revokeBlobUrl(url);
    }
});

// Track cover cache (for tracks with embedded covers)
const trackCoverCache = new LRUCache<number, string>(CACHE_CONFIG.MAX_TRACK_COVER_CACHE, {
    onEvict: (trackId, url) => {
        revokeBlobUrl(url);
    }
});

// Full object cache (for recently accessed items)
const fullTrackCache = new LRUCache<number, Track>(1000);
const fullAlbumCache = new LRUCache<number, Album>(200);

// Track ID to Album ID mapping (for album cover lookups)
const trackToAlbumMap = new Map<number, number>();

// Album ID to Track IDs mapping (for finding tracks in an album)
const albumToTracksMap = new Map<number, number[]>();

// SVELTE STORES
// Main stores (now contain ALL items but as lightweight metadata)
export const tracks = writable<Track[]>([]);

// Album store
export const albums = writable<Album[]>([]);

// Artist store
export const artists = writable<Artist[]>([]);

// Playlist store
export const playlists = writable<Playlist[]>([]);

// Loading state
export const isLoading = writable(false);

// Error state
export const lastError = writable<string | null>(null);

// Counts (derived from metadata cache, not array length)
let totalTrackCount = 0;
let totalAlbumCount = 0;
let totalArtistCount = 0;

export const trackCount = writable(0);
export const albumCount = writable(0);
export const artistCount = writable(0);

// HELPER FUNCTIONS
/**
 * Strip heavy data from track (remove base64 album art)
 */
function stripTrackHeavyData(track: Track): TrackMetadata {
    const { track_cover, ...metadata } = track;
    return metadata;
}

/**
 * Strip heavy data from album
 */
function stripAlbumHeavyData(album: Album): AlbumMetadata {
    const { art_data, ...metadata } = album;
    return {
        ...metadata,
        has_art: !!art_data,
    };
}

/**
 * Reconstruct track from metadata + cached heavy data
 */
function reconstructTrack(metadata: TrackMetadata): Track {
    const track_cover = trackCoverCache.get(metadata.id) || null;

    return {
        ...metadata,
        track_cover,
    } as Track;
}

/**
 * Reconstruct album from metadata + cached art
 */
function reconstructAlbum(metadata: AlbumMetadata): Album {
    const art_data = albumArtCache.get(metadata.id) || null;

    return {
        ...metadata,
        art_data,
    } as Album;
}

// ingestTracks — caches metadata, populates maps
// returns lightweight Track[] to push into the store.
// Called by loadLibrary (initial batch), loadMoreTracks (pagination),
// and can be called by the progressive scan too.
function ingestTracks(incoming: Track[]): Track[] {
    const lightweight: Track[] = [];

    incoming.forEach(track => {
        // Cache metadata
        const metadata = stripTrackHeavyData(track);
        trackMetadataCache.set(track.id, metadata);

        // Revoke old blob URL before caching new one
        const existingUrl = trackCoverCache.get(track.id);
        if (existingUrl && existingUrl.startsWith('blob:')) {
            revokeBlobUrl(existingUrl);
        }

        // Priority 1: Use filesystem path (fastest, no JS overhead)
        if (track.track_cover_path) {
            const url = convertFileSrc(track.track_cover_path);
            trackCoverCache.set(track.id, url);
        }
        // Priority 2: Use base64 (fallback, expensive)
        else if (track.track_cover) {
            const blobUrl = convertBase64ToBlobUrl(track.track_cover);
            trackCoverCache.set(track.id, blobUrl);
        }

        // Build bidirectional album ↔ track mapping
        if (track.album_id) {
            trackToAlbumMap.set(track.id, track.album_id);

            if (!albumToTracksMap.has(track.album_id)) {
                albumToTracksMap.set(track.album_id, []);
            }
            albumToTracksMap.get(track.album_id)!.push(track.id);
        }

        // Lightweight copy for the store 
        lightweight.push({
            ...metadata,
            track_cover: null,
        } as Track);
    });

    return lightweight;
}


/**
 * Add a single track to the library (handles metadata caching and store update)
 */
export function addTrackToLibrary(track: Track): void {
    const [lightweight] = ingestTracks([track]);

    // Update store
    tracks.update(current => {
        // Find if track already exists (by ID)
        const index = current.findIndex(t => t.id === track.id);
        if (index >= 0) {
            const updated = [...current];
            updated[index] = lightweight;
            return updated;
        }
        // Prepend new tracks to the top so they are visible immediately
        return [lightweight, ...current];
    });

    // Update count if it was new
    trackCount.update(n => n + 1);
}


// ingestAlbums — caches album metadata and album art separately
// Returns lightweight Album[] for the store
function ingestAlbums(incoming: Album[]): Album[] {
    const lightweight: Album[] = [];

    incoming.forEach(album => {
        const metadata = stripAlbumHeavyData(album);
        albumMetadataCache.set(album.id, metadata);

        // Revoke old blob URL before caching new one
        const existingUrl = albumArtCache.get(album.id);
        if (existingUrl && existingUrl.startsWith('blob:')) {
            revokeBlobUrl(existingUrl);
        }

        if (album.art_path) {
            const url = convertFileSrc(album.art_path);
            albumArtCache.set(album.id, url);
        } else if (album.art_data) {
            const blobUrl = convertBase64ToBlobUrl(album.art_data);
            albumArtCache.set(album.id, blobUrl);
        }

        lightweight.push({
            ...metadata,
            art_data: null,
        } as Album);
    });

    return lightweight;
}

// DATA ACCESS APIS (for components)
/**
 * Get full track with heavy data (for playback)
 * @param trackId - The track ID
 * @param preferBase64 - If true, converts blob URLs back to base64 data URIs (for plugins/exports)
 */
export async function getFullTrack(trackId: number, preferBase64: boolean = false): Promise<Track | null> {
    // Check full cache first (but only if not requesting base64)
    if (!preferBase64) {
        const cached = fullTrackCache.get(trackId);
        if (cached) return cached;
    }

    // Reconstruct from metadata + caches
    const metadata = trackMetadataCache.get(trackId);
    if (!metadata) return null;

    let track = reconstructTrack(metadata);

    // Convert blob URL to base64 data URI if requested
    if (preferBase64 && track.track_cover && track.track_cover.startsWith('blob:')) {
        try {
            const response = await fetch(track.track_cover);
            const blob = await response.blob();
            const dataUri = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            track = { ...track, track_cover: dataUri };
        } catch (error) {
            console.error('[Library] Failed to convert blob URL to data URI:', error);
            // Keep the blob URL as fallback
        }
    }

    // Only cache if not base64 version (to avoid caching duplicates)
    if (!preferBase64) {
        fullTrackCache.set(trackId, track);
    }

    return track;
}

/**
 * Get full album with art data
 */
export function getFullAlbum(albumId: number): Album | null {
    // Check full cache first
    const cached = fullAlbumCache.get(albumId);
    if (cached) return cached;

    // Reconstruct from metadata + art cache
    const metadata = albumMetadataCache.get(albumId);
    if (!metadata) return null;

    const album = reconstructAlbum(metadata);
    fullAlbumCache.set(albumId, album);
    return album;
}

/**
 * Get track cover art (for TrackList)
 */
export function getTrackCover(trackId: number): string | null {
    return trackCoverCache.get(trackId) || null;
}

/**
 * Get album art (for AlbumGrid)
 */
export function getAlbumArt(albumId: number): string | null {
    return albumArtCache.get(albumId) || null;
}

/**
 * Get album cover for a track (follows priority: track_cover → cover_url → album art)
 */
export function getTrackAlbumCover(trackId: number): string | null {
    const metadata = trackMetadataCache.get(trackId);
    if (!metadata) return null;

    // Priority 1: Track's embedded cover
    const trackCover = trackCoverCache.get(trackId);
    if (trackCover) return trackCover;

    // Priority 2: External cover URL
    if (metadata.cover_url) return metadata.cover_url;

    // Priority 3: Album art
    if (metadata.album_id) {
        const albumArt = albumArtCache.get(metadata.album_id);
        if (albumArt) return albumArt;
    }

    return null;
}

// Priority: album art cache → album metadata art_path → first track cover
export function getAlbumCoverFromTracks(albumId: number): string | null {
    // Priority 1: albumArtCache (now populated by ingestAlbums)
    const cachedArt = albumArtCache.get(albumId);
    if (cachedArt) return cachedArt;

    // Priority 2: track cover fallback for mid-scan state
    const trackIds = albumToTracksMap.get(albumId);
    if (!trackIds || trackIds.length === 0) return null;

    // Find first track with cover
    for (const trackId of trackIds) {
        const cover = getTrackAlbumCover(trackId);
        if (cover) return cover;
    }

    return null;
}

/**
 * Batch get tracks (for player queue, etc.)
 * @param trackIds - Array of track IDs
 * @param preferBase64 - If true, returns tracks with base64 data URIs instead of blob URLs
 */
export async function getFullTracks(trackIds: number[], preferBase64: boolean = false): Promise<Track[]> {
    const tracks = await Promise.all(
        trackIds.map(id => getFullTrack(id, preferBase64))
    );
    return tracks.filter((t): t is Track => t !== null);
}

// LOADING FUNCTIONS
/**
 * Load library: artists in full, first paginated batch of tracks and albums.
 * Additional items arrive via loadMoreTracks() and loadMoreAlbums().
 */
export async function loadLibrary(): Promise<void> {
    isLoading.set(true);
    lastError.set(null);

    try {
        console.time('[Library] IPC load initial');

        // Parallel: library metadata, first track batch, first album batch
        const [library, initialTracks, initialAlbums] = await Promise.all([
            getLibrary(),
            getTracksPaginated(CACHE_CONFIG.TRACK_BATCH_SIZE, 0),
            getAlbumsPaginated(CACHE_CONFIG.TRACK_BATCH_SIZE, 0)  // Paginated albums
        ]);

        console.timeEnd('[Library] IPC load initial');

        // counts
        // library.tracks.length is the TOTAL track count
        // library.albums.length is the TOTAL album count
        totalTrackCount = library.tracks.length;
        totalAlbumCount = library.albums.length;  //this is the total, not loaded count
        totalArtistCount = library.artists.length;

        trackCount.set(totalTrackCount);
        albumCount.set(totalAlbumCount);
        artistCount.set(totalArtistCount);

        // tracks (first batch) 
        const lightTracks = ingestTracks(initialTracks);

        // albums (first batch) 
        const lightAlbums = ingestAlbums(initialAlbums);

        // commit to stores 
        albums.set(lightAlbums);
        artists.set(library.artists);
        tracks.set(lightTracks);

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError.set(message);
        console.error('[Library] Failed to load library:', error);
    } finally {
        isLoading.set(false);
    }
}

/**
 * Load next paginated batch of tracks and append to the store.
 * Returns true if new tracks were appended, false if already at the end.
 */
export async function loadMoreTracks(): Promise<boolean> {
    if (get(isLoading)) return false;

    const currentTracks = get(tracks);
    const offset = currentTracks.length;

    // If we've already loaded everything, don't bother
    if (offset >= get(trackCount) && get(trackCount) > 0) return false;

    isLoading.set(true);
    try {
        const newTracks = await getTracksPaginated(CACHE_CONFIG.TRACK_BATCH_SIZE, offset);
        if (newTracks.length === 0) return false;

        // Same ingestion path as loadLibrary -caches + maps stay consistent
        const lightTracks = ingestTracks(newTracks);
        tracks.update(current => [...current, ...lightTracks]);
        return true;
    } catch (error) {
        console.error('[Library] Failed to load more tracks:', error);
        return false;
    } finally {
        isLoading.set(false);
    }
}

/**
 * Load next paginated batch of albums and append to the store.
 * Returns true if new albums were appended, false if already at the end.
 */
export async function loadMoreAlbums(): Promise<boolean> {
    if (get(isLoading)) return false;

    const currentAlbums = get(albums);
    const offset = currentAlbums.length;

    // Already have everything
    if (offset >= get(albumCount) && get(albumCount) > 0) return false;

    isLoading.set(true);
    try {
        const newAlbums = await getAlbumsPaginated(CACHE_CONFIG.TRACK_BATCH_SIZE, offset);
        if (newAlbums.length === 0) return false;

        // Same ingestion path as loadLibrary -caches + maps
        const lightAlbums = ingestAlbums(newAlbums);
        albums.update(current => [...current, ...lightAlbums]);
        return true;
    } catch (error) {
        console.error('[Library] Failed to load more albums:', error);
        return false;
    } finally {
        isLoading.set(false);
    }
}

/**
 * Search library using backend FTS5.
 * Replaces the tracks store with search results (does not affect pagination state).
 */
export async function searchInLibrary(query: string): Promise<void> {
    if (!query || query.trim().length < 2) {
        // Cleared. reload the normal paginated view
        loadLibrary();
        return;
    }

    isLoading.set(true);
    try {
        const results = await searchLibrary(query, 100, 0);
        // Search results go through the same ingestion
        const lightResults = ingestTracks(results);
        tracks.set(lightResults);
        // trackCount intentionally not updated. pagination logic uses it for
        // "have we loaded everything?" checks which don't apply during search.
    } catch (error) {
        console.error('[Library] Search failed:', error);
    } finally {
        isLoading.set(false);
    }
}

/**
 * Ingest a progressive scan batch
 * Appends the new tracks to the store 
 */
export function ingestScanBatch(event: ScanBatchEvent): void {
    const lightTracks = ingestTracks(event.tracks);
    tracks.update(current => [...current, ...lightTracks]);

    // Update the running total so the UI can show progress
    trackCount.set(event.progress.total);
}

/**
 * Load only albums and artists (tracks already populated).
 */
export async function loadAlbumsAndArtists(): Promise<void> {
    try {
        const library = await getLibrary();

        // Use ingestAlbums to cache album art
        const lightAlbums = ingestAlbums(library.albums);

        albums.set(lightAlbums);
        albumCount.set(library.albums.length);

        artists.set(library.artists);
        artistCount.set(library.artists.length);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError.set(message);
        console.error('[Library] Failed to load albums/artists:', error);
    }
}

// PLAYLISTS
export async function loadPlaylists(): Promise<void> {
    try {
        const playlistList = await getPlaylists();
        playlists.set(playlistList);
    } catch (error) {
        console.error('Failed to load playlists:', error);
    }
}

// REFRESH & CLEAR
export async function refreshAll(): Promise<void> {
    await Promise.all([loadLibrary(), loadPlaylists()]);
}

// Clear library data (for cache clearing)
export async function clearLibrary(): Promise<void> {
    tracks.set([]);
    albums.set([]);
    artists.set([]);
    playlists.set([]);
    lastError.set(null);

    // Revoke all blob URLs before clearing caches
    createdBlobUrls.forEach(url => {
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            // already revoked, ignore
        }
    });
    createdBlobUrls.clear();

    // Clear all caches (will trigger onEvict callbacks which also revoke)
    trackMetadataCache.clear();
    albumMetadataCache.clear();
    albumArtCache.clear();  // Triggers revokeBlobUrl via onEvict
    trackCoverCache.clear(); // Triggers revokeBlobUrl via onEvict
    fullTrackCache.clear();
    fullAlbumCache.clear();
    trackToAlbumMap.clear();
    albumToTracksMap.clear();

    totalTrackCount = 0;
    totalAlbumCount = 0;
    totalArtistCount = 0;

    trackCount.set(0);
    albumCount.set(0);
    artistCount.set(0);
}

// Add periodic blob URL cleanup
let cleanupInterval: number | undefined;

/**
 * Start periodic cleanup of unused blob URLs (runs every 5 minutes)
 */
export function startBlobUrlCleanup(): void {
    if (typeof window === 'undefined') return;

    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    cleanupInterval = window.setInterval(() => {
        const before = createdBlobUrls.size;

        // Clean up any orphaned blob URLs (not in either cache)
        const activeBlobUrls = new Set<string>();

        // Collect active blob URLs from caches
        console.log(`[Library] Blob URL cleanup check: ${before} tracked URLs`);
    }, 5 * 60 * 1000); // Every 5 minutes
}

/**
 * Stop periodic cleanup
 */
export function stopBlobUrlCleanup(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
    }
}

// CACHE STATS
export function getCacheStats() {
    return {
        metadata: {
            tracks: trackMetadataCache.size,
            albums: albumMetadataCache.size,
        },
        heavyData: {
            albumArt: albumArtCache.size,
            trackCovers: trackCoverCache.size,
        },
        fullObjects: {
            tracks: fullTrackCache.size,
            albums: fullAlbumCache.size,
        },
        mappings: {
            trackToAlbum: trackToAlbumMap.size,
            albumToTracks: albumToTracksMap.size,
        },
        blobUrls: {
            tracked: createdBlobUrls.size,
        },
        totals: {
            tracks: totalTrackCount,
            albums: totalAlbumCount,
            artists: totalArtistCount,
        },
    };
}