import { writable } from 'svelte/store';

/** True while any file drag is in progress over the app window. */
export const isDragging = writable(false);

/** Internal counter to handle nested dragenter/dragleave pairs. */
export const dragCounter = writable(0);

/**
 * True when the file(s) being dragged are lyrics files (.lrc, .ttml, .xml, .srt).
 * Only reliable on the Tauri path where filenames are available on dragenter.
 * Reset to false on drop or cancel.
 */
export const isDraggingLyrics = writable(false);