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
        const results = await searchLibrary(q, 100, 0);
        searchResults.set({
            tracks: results.tracks,
            albums: results.albums,
            artists: results.artists,
            playlists: results.playlists,
            hasResults:
                results.tracks.length > 0 ||
                results.albums.length > 0 ||
                results.artists.length > 0 ||
                results.playlists.length > 0,
            query: q,
        });
    }, 150);
});

// Clear search
export function clearSearch(): void {
    searchQuery.set('');
}
