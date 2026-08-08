// View store - manages current view/navigation state
import { writable, get, derived } from 'svelte/store';
import { appSettings } from './settings';

export type ViewType =
    | 'home'
    | 'tracks'
    | 'tracks-multiselect'
    | 'albums'
    | 'album-detail'
    | 'artists'
    | 'artist-detail'
    | 'playlists'
    | 'playlist-detail'
    | 'liked-songs'
    | 'plugins'
    | 'settings'
    | 'listenbrainz'
    | 'discover';

export interface ViewState {
    type: ViewType;
    id?: number;    // For album/playlist detail views
    name?: string;  // For artist detail views
    query?: string; // For discovery search
}

const MAX_HISTORY = 50;
const history: ViewState[] = [];
// Internal writable to trigger updates for the derived store
const historyUpdate = writable(0);

let currentIndex = -1;
let isNavigating = false;

const LAST_VIEW_STORAGE_KEY = 'audion_last_view_cache';

const KNOWN_VIEW_TYPES: ReadonlySet<ViewType> = new Set<ViewType>([
    'home',
    'tracks',
    'tracks-multiselect',
    'albums',
    'album-detail',
    'artists',
    'artist-detail',
    'playlists',
    'playlist-detail',
    'liked-songs',
    'plugins',
    'settings',
    'listenbrainz',
    'discover',
]);

function isValidViewState(value: unknown): value is ViewState {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' && KNOWN_VIEW_TYPES.has(type as ViewType);
}

/**
 * resolves the view to show on launch, synchronously, before any component mounts
 *
 * if startupPage is a fixed page use that
 * if startupPage is last-visited, read the cached last view
 * written to localStorage by the app://request-last-view handler
 * in +layout.svelte right before the app closes (see confirm_close in window.rs)
 * falls back to tracks if nothing usable is cached yet
 */
function getInitialView(): ViewState {
    if (typeof window === 'undefined') return { type: 'tracks' };

    const startupPage = get(appSettings).startupPage;

    if (startupPage && startupPage !== 'last-visited') {
        return { type: startupPage as ViewType };
    }

    if (startupPage === 'last-visited') {
        try {
            const raw = localStorage.getItem(LAST_VIEW_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as ViewState;
                if (isValidViewState(parsed)) return parsed;
            }
        } catch (error) {
            console.warn('[View] Failed to read cached last view:', error);
        }
    }

    return { type: 'tracks' };
}

export const currentView = writable<ViewState>(getInitialView());

/**
 * mirrors the given view into the synchronous localStorage cache
 * getInitialView reads on next launch
 * called from +layout.svelte's app://request-last-view handler, right before it calls
 * invoke('confirm_close') to let the app actually close
 */
export function cacheLastViewForNextLaunch(view: ViewState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(LAST_VIEW_STORAGE_KEY, JSON.stringify(view));
    } catch (error) {
        console.warn('[View] Failed to cache last view:', error);
    }
}

export const navigationHistory = derived(historyUpdate, () => ({
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < history.length - 1
}));

// Initialize history with the same view currentView actually starts on
history.push(get(currentView));
currentIndex = 0;

function notifyHistoryUpdate() {
    historyUpdate.set(Date.now());
}

// Subscribe to update history when view changes
currentView.subscribe(view => {
    if (isNavigating) return;

    // Remove forward history if we diverge
    if (currentIndex < history.length - 1) {
        history.splice(currentIndex + 1);
    }

    // Don't push duplicate consecutive views
    const current = history[currentIndex];
    if (current &&
        current.type === view.type &&
        current.id === view.id &&
        current.name === view.name) {
        return;
    }

    history.push(view);
    if (history.length > MAX_HISTORY) {
        history.shift();
    } else {
        currentIndex++;
    }
    notifyHistoryUpdate();
});

export function goBack(): void {
    if (currentIndex > 0) {
        currentIndex--;
        isNavigating = true;
        currentView.set(history[currentIndex]);
        isNavigating = false;
        notifyHistoryUpdate();
    }
}

export function goForward(): void {
    if (currentIndex < history.length - 1) {
        currentIndex++;
        isNavigating = true;
        currentView.set(history[currentIndex]);
        isNavigating = false;
        notifyHistoryUpdate();
    }
}

// Navigation helpers
export function navigateTo(type: ViewType, id?: number, name?: string): void {
    currentView.set({ type, id, name });
}

export function goToHome(): void {
    currentView.set({ type: 'home' });
}

export function goToTracks(): void {
    currentView.set({ type: 'tracks' });
}

export function goToAlbums(): void {
    currentView.set({ type: 'albums' });
}

export function goToAlbumDetail(albumId: number): void {
    currentView.set({ type: 'album-detail', id: albumId });
}

export function goToArtists(): void {
    currentView.set({ type: 'artists' });
}

export function goToArtistDetail(artistName: string): void {
    currentView.set({ type: 'artist-detail', name: artistName });
}

export function goToPlaylists(): void {
    currentView.set({ type: 'playlists' });
}

export function goToPlaylistDetail(playlistId: number, name: string): void {
    currentView.set({ type: 'playlist-detail', id: playlistId, name });
}

export function goToPlugins(): void {
    currentView.set({ type: 'plugins' });
}

export function goToSettings(): void {
    currentView.set({ type: 'settings' });
}

export function goToTracksMultiSelect(playlistId: number): void {
    currentView.set({ type: 'tracks-multiselect', id: playlistId });
}

export function goToLikedSongs(): void {
    currentView.set({ type: 'liked-songs' });
}

export function goToListenBrainz(): void {
    currentView.set({ type: 'listenbrainz' });
}

export function goToDiscover(query?: string): void {
    currentView.set({ type: 'discover', query });
}