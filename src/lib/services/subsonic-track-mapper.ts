import type { Track } from '$lib/api/tauri';
import type { SubsonicSong } from '$lib/stores/subsonic';

// Subsonic IDs are strings; map to unique positive ints via a high offset
// so they never collide with local SQLite rowids (which start at 1 and are small).
// 2_000_000_000 is well above any realistic local library size.
const SUBSONIC_ID_OFFSET = 2_000_000_000;

export function subsonicSongId(songId: string): number {
    const n = parseInt(songId, 10);
    return isNaN(n) ? SUBSONIC_ID_OFFSET : SUBSONIC_ID_OFFSET + n;
}

/** Convert a SubsonicSong to a Track the native player can play.
 *  Pass streamUrl pre-resolved — callers resolve before building the queue. */
export function subsonicSongToTrack(
    song: SubsonicSong,
    streamUrl: string,
    coverUrl?: string | null,
): Track {
    return {
        id: subsonicSongId(song.id),
        path: streamUrl,
        title: song.title,
        artist: song.artist ?? null,
        album: song.album ?? null,
        track_number: song.track ?? null,
        duration: song.duration ?? null,
        album_id: null,
        format: null,
        bitrate: null,
        cover_url: coverUrl ?? null,
        source_type: 'subsonic',
        external_id: song.id,
    };
}
