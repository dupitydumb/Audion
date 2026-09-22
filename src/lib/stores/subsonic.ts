// Subsonic integration store
// Credentials stored in app-data JSON via Rust — never in localStorage or SQLite.

import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/api/tauri';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubsonicConfig {
    url: string;
    username: string;
    password: string;
    enabled: boolean;
}

export interface SubsonicUser {
    username: string;
    server_version: string | null;
}

export interface SubsonicArtist {
    id: string;
    name: string;
    album_count: number | null;
    cover_art: string | null;
}

export interface SubsonicSong {
    id: string;
    title: string;
    artist: string | null;
    album: string | null;
    duration: number | null;
    cover_art: string | null;
    track: number | null;
}

export interface SubsonicAlbum {
    id: string;
    name: string;
    artist: string | null;
    cover_art: string | null;
    songs: SubsonicSong[];
}

export interface SubsonicPlaylist {
    id: string;
    name: string;
    song_count: number | null;
    cover_art: string | null;
}

export interface SubsonicSearchResult {
    artists: SubsonicArtist[];
    songs: SubsonicSong[];
}

export interface SubsonicAlbumSummary {
    id: string;
    name: string;
    artist: string | null;
    artist_id: string | null;
    song_count: number | null;
    duration: number | null;
    cover_art: string | null;
    year: number | null;
}

export interface SubsonicArtistDetail {
    id: string;
    name: string;
    cover_art: string | null;
    album_count: number | null;
    albums: SubsonicAlbumSummary[];
}

export interface SubsonicStarred {
    songs: SubsonicSong[];
    albums: SubsonicAlbumSummary[];
    artists: SubsonicArtist[];
}

// ── Stores ────────────────────────────────────────────────────────────────────

const defaultConfig: SubsonicConfig = {
    url: '',
    username: '',
    password: '',
    enabled: false,
};

export const subsonicConfig = writable<SubsonicConfig>(defaultConfig);

/** true when Subsonic is enabled and a URL is configured */
export const subsonicConnected = derived(
    subsonicConfig,
    ($c) => $c.enabled && $c.url.length > 0,
);

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initSubsonic(): Promise<void> {
    if (!isTauri()) return;
    try {
        const config = await invoke<SubsonicConfig>('subsonic_get_config');
        subsonicConfig.set(config);
    } catch (err) {
        console.error('[Subsonic] Failed to load config:', err);
    }
}

// ── Config actions ────────────────────────────────────────────────────────────

export async function saveSubsonicConfig(
    url: string,
    username: string,
    password: string,
    enabled: boolean,
): Promise<void> {
    if (!isTauri()) return;
    await invoke('subsonic_save_config', { url, username, password, enabled });
    subsonicConfig.set({ url, username, password, enabled });
}

export async function testSubsonicConnection(
    url: string,
    username: string,
    password: string,
): Promise<SubsonicUser> {
    return invoke<SubsonicUser>('subsonic_test_connection', { url, username, password });
}

// ── Browse / search ───────────────────────────────────────────────────────────

export async function subsonicGetIndexes(): Promise<SubsonicArtist[]> {
    return invoke<SubsonicArtist[]>('subsonic_get_indexes');
}

export async function subsonicSearch(
    query: string,
    songCount?: number,
): Promise<SubsonicSearchResult> {
    return invoke<SubsonicSearchResult>('subsonic_search', {
        query,
        songCount: songCount ?? null,
    });
}

export async function subsonicGetAlbum(id: string): Promise<SubsonicAlbum> {
    return invoke<SubsonicAlbum>('subsonic_get_album', { id });
}

export async function subsonicGetPlaylists(): Promise<SubsonicPlaylist[]> {
    return invoke<SubsonicPlaylist[]>('subsonic_get_playlists');
}

export async function subsonicGetPlaylist(id: string): Promise<SubsonicSong[]> {
    return invoke<SubsonicSong[]>('subsonic_get_playlist', { id });
}

// ── Playback ──────────────────────────────────────────────────────────────────

export async function subsonicGetStreamUrl(id: string): Promise<string> {
    return invoke<string>('subsonic_get_stream_url', { id });
}

export async function subsonicGetCoverUrl(id: string, size?: number): Promise<string> {
    return invoke<string>('subsonic_get_cover_url', { id, size: size ?? null });
}

/** Scrobble a track play. Non-fatal — never throws, logs warning on failure. */
export async function subsonicScrobble(id: string, submission: boolean): Promise<void> {
    try {
        await invoke('subsonic_scrobble', { id, submission });
    } catch (err) {
        console.warn('[Subsonic] Scrobble failed (non-fatal):', err);
    }
}

// ── Additional browsing ───────────────────────────────────────────────────────

export async function subsonicGetArtist(id: string): Promise<SubsonicArtistDetail> {
    return invoke<SubsonicArtistDetail>('subsonic_get_artist', { id });
}

/** listType: newest | frequent | recent | starred | random | alphabeticalByName | alphabeticalByArtist | byGenre | byYear */
export async function subsonicGetAlbumList(
    listType: string,
    size?: number,
    offset?: number,
    genre?: string,
    fromYear?: number,
    toYear?: number,
): Promise<SubsonicAlbumSummary[]> {
    return invoke<SubsonicAlbumSummary[]>('subsonic_get_album_list', {
        listType,
        size: size ?? null,
        offset: offset ?? null,
        genre: genre ?? null,
        fromYear: fromYear ?? null,
        toYear: toYear ?? null,
    });
}

export async function subsonicGetRandomSongs(
    size?: number,
    genre?: string,
    fromYear?: number,
    toYear?: number,
): Promise<SubsonicSong[]> {
    return invoke<SubsonicSong[]>('subsonic_get_random_songs', {
        size: size ?? null,
        genre: genre ?? null,
        fromYear: fromYear ?? null,
        toYear: toYear ?? null,
    });
}

/** Pass one of songId, albumId, or artistId. */
export async function subsonicStar(
    songId?: string,
    albumId?: string,
    artistId?: string,
): Promise<void> {
    return invoke('subsonic_star', {
        songId: songId ?? null,
        albumId: albumId ?? null,
        artistId: artistId ?? null,
    });
}

export async function subsonicUnstar(
    songId?: string,
    albumId?: string,
    artistId?: string,
): Promise<void> {
    return invoke('subsonic_unstar', {
        songId: songId ?? null,
        albumId: albumId ?? null,
        artistId: artistId ?? null,
    });
}

export async function subsonicGetStarred(): Promise<SubsonicStarred> {
    return invoke<SubsonicStarred>('subsonic_get_starred');
}

export async function subsonicCreatePlaylist(
    name: string,
    songIds?: string[],
): Promise<SubsonicPlaylist> {
    return invoke<SubsonicPlaylist>('subsonic_create_playlist', {
        name,
        songIds: songIds ?? [],
    });
}

export async function subsonicUpdatePlaylist(
    playlistId: string,
    name?: string,
    songIdsToAdd?: string[],
    songIndexesToRemove?: number[],
): Promise<void> {
    return invoke('subsonic_update_playlist', {
        playlistId,
        name: name ?? null,
        songIdsToAdd: songIdsToAdd ?? [],
        songIndexesToRemove: songIndexesToRemove ?? [],
    });
}

export async function subsonicDeletePlaylist(id: string): Promise<void> {
    return invoke('subsonic_delete_playlist', { id });
}
