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
