// Search store - manages search query and results
import { writable, derived } from 'svelte/store';
import { tracks, albums, artists, playlists } from './library';
import type { Track, Album, Artist, Playlist } from '$lib/api/tauri';

// Search query store
export const searchQuery = writable('');

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

        const matchedTracks = $tracks.filter(track =>
            track.title?.toLowerCase().includes(query) ||
            track.artist?.toLowerCase().includes(query) ||
            track.album?.toLowerCase().includes(query)
        );

        const matchedAlbums = $albums.filter(album =>
            album.name.toLowerCase().includes(query) ||
            album.album_artist?.toLowerCase().includes(query)
        );

        const matchedArtists = $artists.filter(artist =>
            artist.name.toLowerCase().includes(query)
        );

        const matchedPlaylists = $playlists.filter(playlist =>
            playlist.name.toLowerCase().includes(query)
        );

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
