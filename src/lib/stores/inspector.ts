import { writable, get } from "svelte/store";

export type InspectorTab = 'now_playing' | 'lyrics' | 'queue';

export const isInspectorOpen = writable<boolean>(false);
export const activeInspectorTab = writable<InspectorTab>('now_playing');

/**
 * Open the right inspector dock, optionally selecting a specific tab.
 */
export function openInspector(tab?: InspectorTab) {
    if (tab) {
        activeInspectorTab.set(tab);
    }
    isInspectorOpen.set(true);
}

/**
 * Close the right inspector dock.
 */
export function closeInspector() {
    isInspectorOpen.set(false);
}

/**
 * Toggle the inspector dock for a specific tab:
 * - If inspector is open and currently on this tab -> close inspector
 * - If inspector is closed -> open inspector and switch to this tab
 * - If inspector is open on another tab -> switch to this tab
 */
export function toggleInspectorTab(tab: InspectorTab) {
    const isOpen = get(isInspectorOpen);
    const currentTab = get(activeInspectorTab);

    if (isOpen && currentTab === tab) {
        closeInspector();
    } else {
        openInspector(tab);
    }
}
