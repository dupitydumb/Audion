import { writable } from 'svelte/store';

const STORAGE_KEY = 'audion_custom_artwork_v1';

export type ArtworkType = 'track' | 'album' | 'artist';

type ArtworkMap = Record<string, string>; // type:id -> dataURL or URL

function loadFromStorage(): ArtworkMap {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as ArtworkMap;
    } catch (e) {
        console.error('[customArtwork] failed to load:', e);
        return {};
    }
}

function saveToStorage(map: ArtworkMap) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
        console.error('[customArtwork] failed to save:', e);
    }
}

const initial = loadFromStorage();
export const customArtworks = writable<ArtworkMap>(initial);

customArtworks.subscribe((v) => saveToStorage(v));

function getStoreKey(type: ArtworkType, id: number | string): string {
    return `${type}:${id}`;
}

export function setCustomArtwork(type: ArtworkType, id: number | string, value: string) {
    const key = getStoreKey(type, id);
    customArtworks.update((m) => ({ ...m, [key]: value }));
}

export function removeCustomArtwork(type: ArtworkType, id: number | string) {
    const key = getStoreKey(type, id);
    customArtworks.update((m) => {
        const copy = { ...m };
        delete copy[key];
        return copy;
    });
}

export function getCustomArtworkSync(map: ArtworkMap, type: ArtworkType, id: number | string): string | null {
    const key = getStoreKey(type, id);
    return map && map[key] ? map[key] : null;
}
