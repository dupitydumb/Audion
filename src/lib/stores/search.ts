// Search store - manages search query and results
import { writable } from 'svelte/store';
import { searchLibrary } from '$lib/api/tauri';
import type { Track, Album, Artist, Playlist } from '$lib/api/tauri';

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

let debounceTimer: ReturnType<typeof setTimeout>;

searchQuery.subscribe(query => {
    clearTimeout(debounceTimer);
    const q = query.trim();

    if (!q) {
        searchResults.set(emptyResults());
        return;
    }

    debounceTimer = setTimeout(async () => {
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
    }, 150);
});

// Clear search
export function clearSearch(): void {
    searchQuery.set('');
}

// ── Search History ──────────────────────────────────────────────────
const HISTORY_KEY = 'audion_search_history';
const MAX_HISTORY = 20;

export type HistoryEntry =
  | { type: 'query'; query: string; timestamp: number }
  | { type: 'track'; id: number; title: string; artist?: string; albumArt?: string; timestamp: number }
  | { type: 'album'; id: number; title: string; artist?: string; albumArt?: string; timestamp: number }
  | { type: 'playlist'; id: number; title: string; albumArt?: string; timestamp: number };

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

export type HistoryEntryInput =
  | { type: 'query'; query: string }
  | { type: 'track'; id: number; title: string; artist?: string; albumArt?: string }
  | { type: 'album'; id: number; title: string; artist?: string; albumArt?: string }
  | { type: 'playlist'; id: number; title: string; albumArt?: string };

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
