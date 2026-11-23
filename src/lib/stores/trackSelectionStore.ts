import { writable, get } from 'svelte/store';

export interface TrackSelectionState {
  selectedTrackIds: Set<number>;
  anchorIndex: number | null;
  focusedIndex: number | null;
}

function createTrackSelectionStore() {
  const { subscribe, set, update } = writable<TrackSelectionState>({
    selectedTrackIds: new Set<number>(),
    anchorIndex: null,
    focusedIndex: null,
  });

  return {
    subscribe,

    /**
     * Single click on a row: selects only this track, sets anchor and focus.
     */
    selectSingle(trackId: number, index: number) {
      set({
        selectedTrackIds: new Set([trackId]),
        anchorIndex: index,
        focusedIndex: index,
      });
    },

    /**
     * Ctrl / Cmd + click: toggles individual row selection without clearing others.
     */
    toggleTrack(trackId: number, index: number) {
      update((state) => {
        const newSet = new Set(state.selectedTrackIds);
        if (newSet.has(trackId)) {
          newSet.delete(trackId);
        } else {
          newSet.add(trackId);
        }
        return {
          ...state,
          selectedTrackIds: newSet,
          anchorIndex: index,
          focusedIndex: index,
        };
      });
    },

    /**
     * Shift + click: performs contiguous range selection from anchor row to target row.
     */
    selectRange(targetIndex: number, tracks: { id: number }[], extend = false) {
      update((state) => {
        const anchor = state.anchorIndex ?? targetIndex;
        const start = Math.max(0, Math.min(anchor, targetIndex));
        const end = Math.min(tracks.length - 1, Math.max(anchor, targetIndex));

        const rangeIds = tracks.slice(start, end + 1).map((t) => t.id);
        const newSet = extend
          ? new Set([...state.selectedTrackIds, ...rangeIds])
          : new Set(rangeIds);

        return {
          ...state,
          selectedTrackIds: newSet,
          anchorIndex: anchor,
          focusedIndex: targetIndex,
        };
      });
    },

    /**
     * Ctrl / Cmd + A: selects all currently loaded/displayed tracks.
     */
    selectAll(trackIds: number[]) {
      update((state) => ({
        ...state,
        selectedTrackIds: new Set(trackIds),
        anchorIndex: trackIds.length > 0 ? (state.anchorIndex ?? 0) : null,
        focusedIndex: trackIds.length > 0 ? (state.focusedIndex ?? 0) : null,
      }));
    },

    /**
     * Clear all selections.
     */
    clearSelections() {
      set({
        selectedTrackIds: new Set<number>(),
        anchorIndex: null,
        focusedIndex: null,
      });
    },

    /**
     * Resets anchorIndex to null (e.g. on sort order change so range selection does not use a stale index).
     */
    resetAnchor() {
      update((state) => ({
        ...state,
        anchorIndex: null,
      }));
    },

    /**
     * Handler called on sort change to reset anchorIndex.
     */
    onSortChange() {
      update((state) => ({
        ...state,
        anchorIndex: null,
      }));
    },

    /**
     * Set focused index without altering selection.
     */
    setFocusedIndex(index: number | null) {
      update((state) => ({
        ...state,
        focusedIndex: index,
      }));
    },

    /**
     * Check if a track is selected.
     */
    isSelected(trackId: number): boolean {
      return get({ subscribe }).selectedTrackIds.has(trackId);
    },

    /**
     * Get current state snapshot.
     */
    getState(): TrackSelectionState {
      return get({ subscribe });
    },
  };
}

export const trackSelectionStore = createTrackSelectionStore();
export default trackSelectionStore;
