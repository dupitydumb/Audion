import { writable } from 'svelte/store';

const STORAGE_KEY = 'audion_pinned_items_v1';

export type PinnedType = 'playlist' | 'album' | 'artist';

interface PinnedItems {
    playlists: number[];
    albums: number[];
    artists: string[];
}

function loadFromStorage(): PinnedItems {
    if (typeof window === 'undefined') return { playlists: [], albums: [], artists: [] };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { playlists: [], albums: [], artists: [] };
        return JSON.parse(raw) as PinnedItems;
    } catch (e) {
        console.error('[pinned] failed to load:', e);
        return { playlists: [], albums: [], artists: [] };
    }
}

function saveToStorage(state: PinnedItems) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('[pinned] failed to save:', e);
    }
}

const initial = loadFromStorage();
export const pinnedItems = writable<PinnedItems>(initial);

pinnedItems.subscribe((v) => saveToStorage(v));

export function pinItem(type: PinnedType, id: number | string) {
    pinnedItems.update((state) => {
        const key = type === 'playlist' ? 'playlists' : type === 'album' ? 'albums' : 'artists';
        // @ts-ignore - dynamic key access
        if (state[key].includes(id)) return state;
        return {
            ...state,
            // @ts-ignore
            [key]: [...state[key], id]
        };
    });
}

export function unpinItem(type: PinnedType, id: number | string) {
    pinnedItems.update((state) => {
        const key = type === 'playlist' ? 'playlists' : type === 'album' ? 'albums' : 'artists';
        return {
            ...state,
            // @ts-ignore
            [key]: state[key].filter((item: any) => item !== id)
        };
    });
}

export function isPinned(type: PinnedType, id: number | string, state: PinnedItems): boolean {
    const key = type === 'playlist' ? 'playlists' : type === 'album' ? 'albums' : 'artists';
    // @ts-ignore
    return state[key].includes(id);
}
