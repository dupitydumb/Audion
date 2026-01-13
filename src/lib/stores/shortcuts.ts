// Keyboard shortcuts store - defines all keyboard shortcut mappings
import { writable } from 'svelte/store';

export interface ShortcutDefinition {
    key: string;
    keyDisplay?: string;  // For display in help modal (e.g., "↑" for "ArrowUp")
    modifiers?: {
        ctrl?: boolean;
        shift?: boolean;
        alt?: boolean;
    };
    action: string;
    description: string;
    category: 'playback' | 'volume' | 'seeking' | 'navigation' | 'ui';
}

// All keyboard shortcuts definitions
export const shortcuts: ShortcutDefinition[] = [
    // Playback
    { key: ' ', keyDisplay: 'Space', action: 'togglePlay', description: 'Play / Pause', category: 'playback' },
    { key: 'ArrowRight', keyDisplay: '→', action: 'nextTrack', description: 'Next track', category: 'playback' },
    { key: 'ArrowLeft', keyDisplay: '←', action: 'previousTrack', description: 'Previous track', category: 'playback' },
    { key: 's', keyDisplay: 'S', action: 'toggleShuffle', description: 'Toggle shuffle', category: 'playback' },
    { key: 'r', keyDisplay: 'R', action: 'cycleRepeat', description: 'Cycle repeat mode', category: 'playback' },

    // Volume
    { key: 'ArrowUp', keyDisplay: '↑', action: 'volumeUp', description: 'Volume up', category: 'volume' },
    { key: 'ArrowDown', keyDisplay: '↓', action: 'volumeDown', description: 'Volume down', category: 'volume' },
    { key: 'm', keyDisplay: 'M', action: 'toggleMute', description: 'Mute / Unmute', category: 'volume' },

    // Seeking
    { key: 'ArrowRight', keyDisplay: 'Shift + →', modifiers: { shift: true }, action: 'seekForward5', description: 'Skip forward 5s', category: 'seeking' },
    { key: 'ArrowLeft', keyDisplay: 'Shift + ←', modifiers: { shift: true }, action: 'seekBackward5', description: 'Skip backward 5s', category: 'seeking' },
    { key: 'ArrowRight', keyDisplay: 'Ctrl + →', modifiers: { ctrl: true }, action: 'seekForward30', description: 'Skip forward 30s', category: 'seeking' },
    { key: 'ArrowLeft', keyDisplay: 'Ctrl + ←', modifiers: { ctrl: true }, action: 'seekBackward30', description: 'Skip backward 30s', category: 'seeking' },

    // Navigation
    { key: '1', keyDisplay: '1', action: 'goToTracks', description: 'Go to All Tracks', category: 'navigation' },
    { key: '2', keyDisplay: '2', action: 'goToAlbums', description: 'Go to Albums', category: 'navigation' },
    { key: '3', keyDisplay: '3', action: 'goToArtists', description: 'Go to Artists', category: 'navigation' },
    { key: '4', keyDisplay: '4', action: 'goToPlaylists', description: 'Go to Playlists', category: 'navigation' },
    { key: '5', keyDisplay: '5', action: 'goToPlugins', description: 'Go to Plugins', category: 'navigation' },
    { key: '6', keyDisplay: '6', action: 'goToSettings', description: 'Go to Settings', category: 'navigation' },
    { key: 'f', keyDisplay: 'Ctrl + F', modifiers: { ctrl: true }, action: 'focusSearch', description: 'Focus search', category: 'navigation' },
    { key: '/', keyDisplay: '/', action: 'focusSearch', description: 'Focus search', category: 'navigation' },
    { key: 'Escape', keyDisplay: 'Esc', action: 'closeOrClear', description: 'Close panel / Clear search', category: 'navigation' },

    // UI Toggles
    { key: 'l', keyDisplay: 'L', action: 'toggleLyrics', description: 'Toggle lyrics panel', category: 'ui' },
    { key: 'q', keyDisplay: 'Q', action: 'toggleQueue', description: 'Toggle queue panel', category: 'ui' },
    { key: 'f', keyDisplay: 'F', action: 'toggleFullscreen', description: 'Toggle fullscreen player', category: 'ui' },
    { key: 'F11', keyDisplay: 'F11', action: 'toggleFullscreen', description: 'Toggle fullscreen player', category: 'ui' },
    { key: '?', keyDisplay: '?', action: 'showHelp', description: 'Show keyboard shortcuts', category: 'ui' },
];

// Visibility state for shortcuts help modal
export const isShortcutsHelpVisible = writable(false);

export function toggleShortcutsHelp(): void {
    isShortcutsHelpVisible.update(v => !v);
}

export function showShortcutsHelp(): void {
    isShortcutsHelpVisible.set(true);
}

export function hideShortcutsHelp(): void {
    isShortcutsHelpVisible.set(false);
}

// Check if the event target is an input element (to skip shortcuts while typing)
export function isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;

    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return true;
    }

    // Check for contenteditable
    if (target.isContentEditable) return true;

    return false;
}

// Get shortcuts grouped by category
export function getShortcutsByCategory(): Record<string, ShortcutDefinition[]> {
    const categories: Record<string, ShortcutDefinition[]> = {
        playback: [],
        volume: [],
        seeking: [],
        navigation: [],
        ui: []
    };

    // Filter out duplicates for display purposes
    const seen = new Set<string>();
    for (const shortcut of shortcuts) {
        const key = `${shortcut.action}-${shortcut.keyDisplay}`;
        if (!seen.has(key)) {
            seen.add(key);
            categories[shortcut.category].push(shortcut);
        }
    }

    return categories;
}

// Category display names
export const categoryNames: Record<string, string> = {
    playback: 'Playback',
    volume: 'Volume',
    seeking: 'Seeking',
    navigation: 'Navigation',
    ui: 'UI Toggles'
};
