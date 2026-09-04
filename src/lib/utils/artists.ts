// display string helpers for the multi artists
// this does not resplit track.artist itself 
// (that splitting only happens once, in backend, so the db level artist grouping and the display string match)

import type { Track } from "$lib/api/tauri";

/** normalized separator used everywhere a multi artist string is displayed */
export const ARTIST_DISPLAY_SEPARATOR = " · ";

/**
 * render a track's artist(s) for display
 * falls back to the raw artist string if .artists is empty/undefined
 */
export function formatTrackArtists(track: Pick<Track, "artist" | "artists">): string {
    if (track.artists && track.artists.length > 0) {
        return track.artists.join(ARTIST_DISPLAY_SEPARATOR);
    }
    return track.artist ?? "";
}

/** from raw artists array directly */
export function formatArtists(artists: string[] | null | undefined): string {
    if (!artists || artists.length === 0) return "";
    return artists.join(ARTIST_DISPLAY_SEPARATOR);
}