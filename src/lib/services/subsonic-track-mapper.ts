import type { Track } from '$lib/api/tauri';
import type { SubsonicSong, SubsonicAlbumSummary } from '$lib/stores/subsonic';

// Subsonic IDs are arbitrary strings (numeric or UUID).
// Hash to a unique positive int in [2_000_000_000, 2_999_999_999] — well above
// any realistic local SQLite rowid. djb2 hash, always positive via >>> 0.
const SUBSONIC_ID_OFFSET = 2_000_000_000;
const SUBSONIC_ID_RANGE  =   999_999_999; // bucket size

export function subsonicSongId(songId: string): number {
    let h = 5381;
    for (let i = 0; i < songId.length; i++) {
        h = ((h << 5) + h + songId.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
    }
    return SUBSONIC_ID_OFFSET + (h % SUBSONIC_ID_RANGE);
}

/** Convert a SubsonicSong to a Track that the native player can play.
 *  streamUrl must be pre-resolved and passed in — do not call subsonicGetStreamUrl here
 *  (that is async; callers resolve it before building the queue). */
export function subsonicSongToTrack(song: SubsonicSong, streamUrl: string, coverUrl?: string | null): Track {
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
