// Multi-select store for adding tracks to playlists
import { writable, get } from 'svelte/store';

interface MultiSelectState {
    active: boolean;
    selectedTrackIds: Set<number>;
    targetPlaylistId: number | null;
}

function createMultiSelectStore() {
    const { subscribe, set, update } = writable<MultiSelectState>({
        active: false,
        selectedTrackIds: new Set(),
        targetPlaylistId: null,
    });

    return {
        subscribe,

        // Activate multi-select mode for a specific playlist
        activate(playlistId: number) {
            set({
                active: true,
                selectedTrackIds: new Set(),
                targetPlaylistId: playlistId,
            });
        },

        // Deactivate and clear
        deactivate() {
            set({
                active: false,
                selectedTrackIds: new Set(),
                targetPlaylistId: null,
            });
        },

        // Toggle a track's selection
        toggleTrack(trackId: number) {
            update(state => {
                const newSelected = new Set(state.selectedTrackIds);
                if (newSelected.has(trackId)) {
                    newSelected.delete(trackId);
                } else {
                    newSelected.add(trackId);
                }
                return { ...state, selectedTrackIds: newSelected };
            });
        },

        // Select all provided track IDs
        selectAll(trackIds: number[]) {
            update(state => ({
                ...state,
                selectedTrackIds: new Set(trackIds),
            }));
        },

        // Clear all selections
        clearSelections() {
            update(state => ({
                ...state,
                selectedTrackIds: new Set(),
            }));
        },

        // Get current state
        getState(): MultiSelectState {
            return get({ subscribe });
        },
    };
}

export const multiSelect = createMultiSelectStore();