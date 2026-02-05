// View store - manages current view/navigation state
import { writable, get, derived } from 'svelte/store';

export type ViewType =
    | 'tracks'
    | 'tracks-multiselect'
    | 'albums'
    | 'album-detail'
    | 'artists'
    | 'artist-detail'
    | 'playlists'
    | 'playlist-detail'
    | 'plugins'
    | 'settings';

export interface ViewState {
    type: ViewType;
    id?: number;    // For album/playlist detail views
    name?: string;  // For artist detail views
}

const MAX_HISTORY = 50;
const history: ViewState[] = [];
// Internal writable to trigger updates for the derived store
const historyUpdate = writable(0);

let currentIndex = -1;
let isNavigating = false;

export const currentView = writable<ViewState>({ type: 'tracks' });

export const navigationHistory = derived(historyUpdate, () => ({
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < history.length - 1
}));

// Initialize history with default view
history.push({ type: 'tracks' });
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

export function goToPlaylistDetail(playlistId: number): void {
    currentView.set({ type: 'playlist-detail', id: playlistId });
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