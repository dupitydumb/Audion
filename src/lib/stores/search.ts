// Search store - manages search query and results
import { writable, derived } from 'svelte/store';
import { tracks, albums, artists, playlists } from './library';
import type { Track, Album, Artist, Playlist } from '$lib/api/tauri';

// Search query store
export const searchQuery = writable('');

// tokenized search helpers
function tokenize(str: string): string[] {
    return str.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
    return tokens.every(token => haystack.includes(token));
}

// Search results derived from library
export const searchResults = derived(
    [searchQuery, tracks, albums, artists, playlists],
    ([$query, $tracks, $albums, $artists, $playlists]) => {
        const query = $query.toLowerCase().trim();

        if (!query) {
            return {
                tracks: [] as Track[],
                albums: [] as Album[],
                artists: [] as Artist[],
                playlists: [] as Playlist[],
                hasResults: false,
                query: ''
            };
        }

        const tokens = tokenize(query);

        const matchedTracks = $tracks.filter(track => {
            const haystack = [track.title, track.artist, track.album]
                .filter(Boolean).join(' ').toLowerCase();
            return matchesAllTokens(haystack, tokens);
        });

        const matchedAlbums = $albums.filter(album => {
            const haystack = [album.name, album.artist]
                .filter(Boolean).join(' ').toLowerCase();
            return matchesAllTokens(haystack, tokens);
        });

        const matchedArtists = $artists.filter(artist => {
            const haystack = artist.name.toLowerCase();
            return matchesAllTokens(haystack, tokens);
        });

        const matchedPlaylists = $playlists.filter(playlist => {
            const haystack = playlist.name.toLowerCase();
            return matchesAllTokens(haystack, tokens);
        });

        return {
            tracks: matchedTracks,
            albums: matchedAlbums,
            artists: matchedArtists,
            playlists: matchedPlaylists,
            hasResults: matchedTracks.length > 0 || matchedAlbums.length > 0 || matchedArtists.length > 0 || matchedPlaylists.length > 0,
            query
        };
    }
);

// Clear search
export function clearSearch(): void {
    searchQuery.set('');
}
