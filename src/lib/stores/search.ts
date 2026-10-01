// Search store - manages search query and results
import { writable, derived, get } from 'svelte/store';
import { searchLibrary, listen } from '$lib/api/tauri';
import type { Track, Album, Artist, Playlist, ScanBatchEvent } from '$lib/api/tauri';
import {
    tracks as libraryTracks,
    albums as libraryAlbums,
    playlists as libraryPlaylists,
    getTrackAlbumCover,
    getAlbumCoverFromTracks,
} from './library';
import { playlistCovers, getPlaylistCoverSync } from './playlistCovers';

export interface SearchResults {
    tracks: Track[];
    albums: Album[];
    artists: Artist[];
    playlists: Playlist[];
    hasResults: boolean;
    query: string;
}

function emptyResults(): SearchResults {
    return {
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        hasResults: false,
        query: ''
    };
}

// search query store
export const searchQuery = writable('');

// search results store
export const searchResults = writable<SearchResults>(emptyResults());

// shared by both the query-typed debounce and the watcher-triggered re-run below
// only one search should ever be in flight/pending at a time
let debounceTimer: ReturnType<typeof setTimeout>;

async function runSearch(q: string): Promise<void> {
    try {
        const results = await searchLibrary(q, 100, 0);
        const playlists = results.playlists ?? [];
        searchResults.set({
            tracks: results.tracks,
            albums: results.albums,
            artists: results.artists,
            playlists: playlists,
            hasResults:
                results.tracks.length > 0 ||
                results.albums.length > 0 ||
                results.artists.length > 0 ||
                playlists.length > 0,
            query: q,
        });
    } catch (err) {
        console.error("[Search] searchLibrary failed:", err);
        // Show error state so user knows it's broken, not empty
        searchResults.set({
            tracks: [],
            albums: [],
            artists: [],
            playlists: [],
            hasResults: false,
            query: q,
        });
    }
}

searchQuery.subscribe(query => {
    clearTimeout(debounceTimer);
    const q = query.trim();

    if (!q) {
        searchResults.set(emptyResults());
        return;
    }

    debounceTimer = setTimeout(() => void runSearch(q), 150);
});

// live re-search on library changes =====================
// FTS5 is the source of truth for what matches a query
// a watcher batch that adds/edits/removes tracks after that won't be reflected until the query changes
// re-running the same query against FTS5 (cheap) fixes that

// listeners are started/stopped by SearchResults.svelte's onMount/onDestroy
// so this only does work while the search results view is actually on screen
const LIVE_RESEARCH_DEBOUNCE_MS = 500;
let liveResearchTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenBatchReady: (() => void) | null = null;
let unlistenTracksDeleted: (() => void) | null = null;
let liveSyncStarting: Promise<void> | null = null;

function scheduleLiveResearch(): void {
    // nothing to refresh if the user isn't actively searching
    const q = get(searchQuery).trim();
    if (!q) return;

    if (liveResearchTimer) clearTimeout(liveResearchTimer);
    liveResearchTimer = setTimeout(() => {
        liveResearchTimer = null;
        void runSearch(q);
    }, LIVE_RESEARCH_DEBOUNCE_MS);
}

/**
 * start listening for watcher-driven library changes 
 * so an open search stays live
 * call from SearchResults.svelte's onMount
 */
export async function startSearchLiveSync(): Promise<void> {
    if (unlistenBatchReady) return;
    if (liveSyncStarting) {
        await liveSyncStarting;
        return;
    }

    liveSyncStarting = (async () => {
        try {
            unlistenBatchReady = await listen<ScanBatchEvent>('watch-batch-ready', (event) => {
                if (event.payload.tracks.length === 0) return;
                scheduleLiveResearch();
            });

            unlistenTracksDeleted = await listen<number[]>('watch-tracks-deleted', (event) => {
                if (!event.payload || event.payload.length === 0) return;
                scheduleLiveResearch();
            });
        } catch (error) {
            console.error('[Search] Failed to attach live-sync listeners:', error);
            unlistenBatchReady?.();
            unlistenTracksDeleted?.();
            unlistenBatchReady = null;
            unlistenTracksDeleted = null;
        }
    })();

    try {
        await liveSyncStarting;
    } finally {
        liveSyncStarting = null;
    }
}

/**
 * stop listening for watcher-driven library changes
 * call from SearchResults.svelte's onDestroy
 * so live re-search doesn't keep running once the results view is no longer visible
 */
export function stopSearchLiveSync(): void {
    if (liveResearchTimer) {
        clearTimeout(liveResearchTimer);
        liveResearchTimer = null;
    }
    unlistenBatchReady?.();
    unlistenTracksDeleted?.();
    unlistenBatchReady = null;
    unlistenTracksDeleted = null;
}

// Clear search
export function clearSearch(): void {
    searchQuery.set('');
}


// ── Search History ──────────────────────────────────────────────────
const HISTORY_KEY = 'audion_search_history';
const MAX_HISTORY = 20;

// track/album/playlist entries only keep the id
// title/artist/cover are resolved live from library.ts's stores (see resolvedSearchHistory below)
export type HistoryEntry =
  | { type: 'query'; query: string; timestamp: number }
  | { type: 'track'; id: number; timestamp: number }
  | { type: 'album'; id: number; timestamp: number }
  | { type: 'playlist'; id: number; timestamp: number };

function loadHistory(): HistoryEntry[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
        return [];
    }
}

function saveHistory(entries: HistoryEntry[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {}
}

export const searchHistory = writable<HistoryEntry[]>(loadHistory());

// display-ready shape for the dropdown(resolved live below, never persisted)
export interface ResolvedHistoryEntry {
    index: number;
    type: HistoryEntry['type'];
    timestamp: number;
    id?: number;
    query?: string; // only for type 'query'
    label: string;
    subLabel?: string;
    /** individual artist names for subLabel(see ArtistLinks.svelte) */
    subLabelArtists?: string[];
    art?: string | null;
}

// playlist fallback avatar ===============================
// playlists without a custom/remote cover get a deterministic initials avatar
// (same algorithm SearchResults.svelte/PlaylistDetail.svelte etc. generate at render time)
function initialsFromName(name: string): string {
    if (!name) return 'PL';
    const parts = name.trim().split(/\s+/);
    const picked = parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '');
    return picked.join('') || name.slice(0, 2).toUpperCase();
}

function hashToColor(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 30% 30%)`;
}

function generatePlaylistCover(name: string, size = 512): string {
    const initials = initialsFromName(name);
    const bg = hashToColor(name || 'playlist');
    const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
        `<rect width='100%' height='100%' fill='${bg}'/>` +
        `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Inter, system-ui, sans-serif' font-size='${Math.floor(size / 3)}' fill='white' font-weight='700'>${initials}</text>` +
        `</svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// re-derives display data (title/artist/cover) from library.ts's own stores
export const resolvedSearchHistory = derived(
    [searchHistory, libraryTracks, libraryAlbums, libraryPlaylists, playlistCovers],
    ([$history, $tracks, $albums, $playlists, $playlistCovers]): ResolvedHistoryEntry[] => {
        if ($history.length === 0) return [];

        // O(1) lookup per entry
        const trackMap = new Map($tracks.map(t => [t.id, t]));
        const albumMap = new Map($albums.map(a => [a.id, a]));
        const playlistMap = new Map($playlists.map(p => [p.id, p]));

        return $history.map((entry, index): ResolvedHistoryEntry => {
            if (entry.type === 'query') {
                return { index, type: 'query', timestamp: entry.timestamp, query: entry.query, label: entry.query };
            }

            if (entry.type === 'track') {
                const track = trackMap.get(entry.id);
                return {
                    index, type: 'track', timestamp: entry.timestamp, id: entry.id,
                    label: track?.title || '',
                    subLabel: track?.artist || undefined,
                    subLabelArtists: track?.artists,
                    art: track ? getTrackAlbumCover(entry.id) : null,
                };
            }

            if (entry.type === 'album') {
                const album = albumMap.get(entry.id);
                return {
                    index, type: 'album', timestamp: entry.timestamp, id: entry.id,
                    label: album?.name || '',
                    subLabel: album?.artist || undefined,
                    subLabelArtists: album?.artists,
                    art: album ? getAlbumCoverFromTracks(entry.id) : null,
                };
            }

            // playlist => custom cover > remote cover_url > generated avatar
            const playlist = playlistMap.get(entry.id);
            return {
                index, type: 'playlist', timestamp: entry.timestamp, id: entry.id,
                label: playlist?.name || '',
                art: playlist
                    ? (getPlaylistCoverSync($playlistCovers, entry.id) ?? playlist.cover_url ?? generatePlaylistCover(playlist.name))
                    : null,
            };
        });
    }
);

export type HistoryEntryInput =
  | { type: 'query'; query: string }
  | { type: 'track'; id: number }
  | { type: 'album'; id: number }
  | { type: 'playlist'; id: number };

function isSameEntry(a: HistoryEntry, b: HistoryEntryInput): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'query' && b.type === 'query') return a.query === b.query;
    if ((a.type === 'track' || a.type === 'album' || a.type === 'playlist') &&
        (b.type === 'track' || b.type === 'album' || b.type === 'playlist')) return a.id === b.id;
    return false;
}

export function addQueryToHistory(query: string): void {
    const q = query.trim();
    if (!q) return;
    searchHistory.update(entries => {
        const filtered = entries.filter(e => !isSameEntry(e, { type: 'query', query: q }));
        const next = [{ type: 'query' as const, query: q, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
    });
}

export function addItemToHistory(entry: HistoryEntryInput): void {
    searchHistory.update(entries => {
        const filtered = entries.filter(e => !isSameEntry(e, entry));
        const next = [{ ...entry, timestamp: Date.now() } as HistoryEntry, ...filtered].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
    });
}

export function removeHistoryItem(index: number): void {
    searchHistory.update(entries => {
        const next = entries.filter((_, i) => i !== index);
        saveHistory(next);
        return next;
    });
}

export function clearHistory(): void {
    searchHistory.set([]);
    if (typeof window !== 'undefined') {
        try { localStorage.removeItem(HISTORY_KEY); } catch {}
    }
}
