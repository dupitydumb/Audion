// Keyboard shortcuts store - defines all keyboard shortcut mappings and manages bindings
import { writable, get } from "svelte/store";
import { appSettings } from "$lib/stores/settings";


/**
 * how a key is matched in the keydown handler:
 *   => code: event.code  (e.g. "KeyF", "KeyS") layout-independent, use for letter keys
 *   => key:  event.key   (e.g. "ArrowRight", " ", "F11")  use for non-letter keys
 */
export type KeyMatchType = "code" | "key";

export interface ShortcutModifiers {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
}

export interface ShortcutDefinition {
    /** unique action identifier */
    action: string;
    /** human-readable description */
    description: string;
    /** category for grouping in the help/edit modal */
    category: "playback" | "volume" | "seeking" | "navigation" | "ui";
    /** whether this shortcut can be rebound by the user */
    rebindable: boolean;
}

export interface ShortcutBinding {
    action: string;
    /** the key value: event.code value (e.g. "KeyF") or event.key value (e.g. "ArrowRight") */
    key: string;
    /** whether to match against event.code or event.key */
    matchType: KeyMatchType;
    modifiers: ShortcutModifiers;
    /** human-readable display string shown in the UI */
    keyDisplay: string;
    /** if true, also register as an OS-level global shortcut via the Tauri plugin */
    isGlobal: boolean;
    /**
     * Tauri global-shortcut string
     * auto-derived when isGlobal is toggled on, but stored separately
     * because the Tauri format differs from our internal representation
     */
    globalString: string | null;
    /** set by the handler if Tauri failed to register the global shortcut */
    globalError?: string;
}


export const shortcutDefinitions: ShortcutDefinition[] = [
    // Playback
    { action: "togglePlay",      description: "Play / Pause",          category: "playback",   rebindable: true  },
    { action: "nextTrack",       description: "Next track",            category: "playback",   rebindable: true  },
    { action: "previousTrack",   description: "Previous track",        category: "playback",   rebindable: true  },
    { action: "toggleShuffle",   description: "Toggle shuffle",        category: "playback",   rebindable: true  },
    { action: "cycleRepeat",     description: "Cycle repeat mode",     category: "playback",   rebindable: true  },

    // Volume
    { action: "volumeUp",        description: "Volume up",             category: "volume",     rebindable: true  },
    { action: "volumeDown",      description: "Volume down",           category: "volume",     rebindable: true  },
    { action: "toggleMute",      description: "Mute / Unmute",         category: "volume",     rebindable: true  },

    // Seeking
    { action: "seekForward5",    description: "Skip forward 5s",       category: "seeking",    rebindable: true  },
    { action: "seekBackward5",   description: "Skip backward 5s",      category: "seeking",    rebindable: true  },
    { action: "seekForward30",   description: "Skip forward 30s",      category: "seeking",    rebindable: true  },
    { action: "seekBackward30",  description: "Skip backward 30s",     category: "seeking",    rebindable: true  },

    // Navigation
    { action: "goToTracks",      description: "Go to All Tracks",      category: "navigation", rebindable: true  },
    { action: "goToAlbums",      description: "Go to Albums",          category: "navigation", rebindable: true  },
    { action: "goToArtists",     description: "Go to Artists",         category: "navigation", rebindable: true  },
    { action: "goToPlaylists",   description: "Go to Playlists",       category: "navigation", rebindable: true  },
    { action: "goToPlugins",     description: "Go to Plugins",         category: "navigation", rebindable: true  },
    { action: "goToSettings",    description: "Go to Settings",        category: "navigation", rebindable: true  },
    { action: "focusSearch",     description: "Focus search",          category: "navigation", rebindable: true  },

    // UI => Escape and showHelp are fixed (not rebindable)
    { action: "toggleLyrics",    description: "Toggle lyrics panel",   category: "ui",         rebindable: true  },
    { action: "toggleQueue",     description: "Toggle queue panel",    category: "ui",         rebindable: true  },
    { action: "toggleFullscreen",description: "Toggle fullscreen",     category: "ui",         rebindable: true  },
    { action: "closeOrClear",    description: "Close panel / Clear search", category: "ui",   rebindable: false },
    { action: "showHelp",        description: "Show keyboard shortcuts", category: "ui",       rebindable: false },
];


/**
 * one action can have multiple bindings
 * each entry is independent . the handler fires the action if any binding matches
 */
export const defaultBindings: ShortcutBinding[] = [
    // Playback
    { action: "togglePlay",      key: "Space",      matchType: "code", modifiers: {},              keyDisplay: "Space",       isGlobal: false, globalString: null },
    { action: "nextTrack",       key: "ArrowRight", matchType: "key",  modifiers: {},              keyDisplay: "→",           isGlobal: false, globalString: null },
    { action: "previousTrack",   key: "ArrowLeft",  matchType: "key",  modifiers: {},              keyDisplay: "←",           isGlobal: false, globalString: null },
    { action: "toggleShuffle",   key: "KeyS",       matchType: "code", modifiers: {},              keyDisplay: "S",           isGlobal: false, globalString: null },
    { action: "cycleRepeat",     key: "KeyR",       matchType: "code", modifiers: {},              keyDisplay: "R",           isGlobal: false, globalString: null },

    // Volume
    { action: "volumeUp",        key: "ArrowUp",    matchType: "key",  modifiers: {},              keyDisplay: "↑",           isGlobal: false, globalString: null },
    { action: "volumeDown",      key: "ArrowDown",  matchType: "key",  modifiers: {},              keyDisplay: "↓",           isGlobal: false, globalString: null },
    { action: "toggleMute",      key: "KeyM",       matchType: "code", modifiers: {},              keyDisplay: "M",           isGlobal: false, globalString: null },

    // Seeking
    { action: "seekForward5",    key: "ArrowRight", matchType: "key",  modifiers: { shift: true }, keyDisplay: "Shift + →",   isGlobal: false, globalString: null },
    { action: "seekBackward5",   key: "ArrowLeft",  matchType: "key",  modifiers: { shift: true }, keyDisplay: "Shift + ←",   isGlobal: false, globalString: null },
    { action: "seekForward30",   key: "ArrowRight", matchType: "key",  modifiers: { ctrl: true },  keyDisplay: "Ctrl + →",    isGlobal: false, globalString: null },
    { action: "seekBackward30",  key: "ArrowLeft",  matchType: "key",  modifiers: { ctrl: true },  keyDisplay: "Ctrl + ←",    isGlobal: false, globalString: null },

    // Navigation
    { action: "goToTracks",      key: "Digit1",     matchType: "code", modifiers: {},              keyDisplay: "1",           isGlobal: false, globalString: null },
    { action: "goToAlbums",      key: "Digit2",     matchType: "code", modifiers: {},              keyDisplay: "2",           isGlobal: false, globalString: null },
    { action: "goToArtists",     key: "Digit3",     matchType: "code", modifiers: {},              keyDisplay: "3",           isGlobal: false, globalString: null },
    { action: "goToPlaylists",   key: "Digit4",     matchType: "code", modifiers: {},              keyDisplay: "4",           isGlobal: false, globalString: null },
    { action: "goToPlugins",     key: "Digit5",     matchType: "code", modifiers: {},              keyDisplay: "5",           isGlobal: false, globalString: null },
    { action: "goToSettings",    key: "Digit6",     matchType: "code", modifiers: {},              keyDisplay: "6",           isGlobal: false, globalString: null },
    { action: "focusSearch",     key: "KeyF",       matchType: "code", modifiers: { ctrl: true },  keyDisplay: "Ctrl + F",    isGlobal: false, globalString: null },
    { action: "focusSearch",     key: "Slash",      matchType: "code", modifiers: {},              keyDisplay: "/",           isGlobal: false, globalString: null },

    // UI
    { action: "toggleLyrics",    key: "KeyL",       matchType: "code", modifiers: {},              keyDisplay: "L",           isGlobal: false, globalString: null },
    { action: "toggleQueue",     key: "KeyQ",       matchType: "code", modifiers: {},              keyDisplay: "Q",           isGlobal: false, globalString: null },
    { action: "toggleFullscreen",key: "KeyF",       matchType: "code", modifiers: {},              keyDisplay: "F",           isGlobal: false, globalString: null },
    { action: "toggleFullscreen",key: "F11",        matchType: "key",  modifiers: {},              keyDisplay: "F11",         isGlobal: false, globalString: null },

    // Fixed (not rebindable => always present)
    { action: "closeOrClear",    key: "Escape",     matchType: "key",  modifiers: {},              keyDisplay: "Esc",         isGlobal: false, globalString: null },
    { action: "showHelp",        key: "Slash",      matchType: "code", modifiers: { shift: true }, keyDisplay: "?",           isGlobal: false, globalString: null },
];


/**
 * the active bindings. initialised from appSettings (persisted) or defaultBindings
 * KeyboardShortcuts.svelte reads this to drive its handler
 * KeyboardShortcutsHelp.svelte writes to it via the exported setters
 */
function createBindingsStore() {
    const saved = get(appSettings).keyboardBindings;
    // merge saved bindings onto defaults: saved takes precedence
    const initial = mergeWithDefaults(saved ?? null);

    const { subscribe, set, update } = writable<ShortcutBinding[]>(initial);

    return {
        subscribe,

        /**
         * replace the binding for a specific (action, old keyDisplay) pair
         * for actions with multiple bindings (focusSearch has two), the caller
         * identifies which one to replace by its current keyDisplay
         */
        updateBinding(action: string, oldKeyDisplay: string, newBinding: Partial<ShortcutBinding>) {
            update(bindings => {
                const idx = bindings.findIndex(
                    b => b.action === action && b.keyDisplay === oldKeyDisplay
                );
                if (idx === -1) return bindings;
                const merged = { ...bindings[idx], ...newBinding };

                // if the key itself changed and this binding was globally registered,
                // strip isGlobal/globalString . the old OS registration is now stale
                // syncGlobalShortcuts will unregister it; the user must re-enable global
                // for the new key. also clear any lingering error
                const keyChanged = newBinding.key !== undefined && newBinding.key !== bindings[idx].key;
                if (keyChanged && merged.isGlobal) {
                    merged.isGlobal     = false;
                    merged.globalString = null;
                    merged.globalError  = undefined;
                }

                const updated = bindings.map((b, i) => i === idx ? merged : b);
                persistBindings(updated);
                return updated;
            });
        },

        /** toggle isGlobal for a specific binding */
        setGlobal(action: string, keyDisplay: string, isGlobal: boolean, globalString: string | null) {
            update(bindings => {
                const updated = bindings.map(b =>
                    b.action === action && b.keyDisplay === keyDisplay
                        // clear globalError so a stale error badge doesn't persist
                        // after the user re-enables or disables the global toggle
                        ? { ...b, isGlobal, globalString, globalError: undefined }
                        : b
                );
                persistBindings(updated);
                return updated;
            });
        },

        /** reset all bindings to defaults */
        resetToDefaults() {
            persistBindings(defaultBindings);
            set([...defaultBindings]);
        },

        /** reset a single action's bindings to defaults */
        resetAction(action: string) {
            update(bindings => {
                const actionDefaults = defaultBindings.filter(b => b.action === action);
                const updated = [
                    ...bindings.filter(b => b.action !== action),
                    ...actionDefaults,
                ];
                persistBindings(updated);
                return updated;
            });
        },

        /**
         * called when a global shortcut registration fails (from KeyboardShortcuts.svelte)
         * or when a key is unsupported for global use (from the Help modal)
         * matched by action + keyDisplay so it works even when globalString is null
         */
        markGlobalError(action: string, keyDisplay: string, error: string) {
            update(bindings => {
                const updated = bindings.map(b =>
                    b.action === action && b.keyDisplay === keyDisplay
                        ? { ...b, isGlobal: false, globalString: null, globalError: error }
                        : b
                );
                persistBindings(updated);
                return updated;
            });
        },
    };
}

function persistBindings(bindings: ShortcutBinding[]) {
    appSettings.setKeyboardBindings(bindings);
}

/**
 * merge persisted bindings with defaults
 * - All default bindings are included as a baseline
 * for each action present in saved, the saved bindings replace the defaults
 * means new actions added in future versions will appear with defaults
 */
function mergeWithDefaults(saved: ShortcutBinding[] | null): ShortcutBinding[] {
    if (!saved || saved.length === 0) return [...defaultBindings];

    const savedActions = new Set(saved.map(b => b.action));
    const defaultsNotInSaved = defaultBindings.filter(b => !savedActions.has(b.action));
    return [...saved, ...defaultsNotInSaved];
}

export const shortcutBindings = createBindingsStore();


/**
 * find all actions that match a given keydown event
 * returns a list of action strings (may be multiple if somehow the same combo
 * is bound to more than one action . conflict detection should prevent this)
 */
export function matchBindings(
    e: KeyboardEvent,
    bindings: ShortcutBinding[]
): string[] {
    return bindings
        .filter(b => {
            const keyMatch =
                b.matchType === "code"
                    ? e.code === b.key
                    : e.key === b.key;

            if (!keyMatch) return false;

            const mod = b.modifiers;
            return (
                !!e.ctrlKey  === !!(mod.ctrl)  &&
                !!e.shiftKey === !!(mod.shift) &&
                !!e.altKey   === !!(mod.alt)
            );
        })
        .map(b => b.action);
}

/**
 * check if a new binding conflicts with any existing one (excluding the action
 * being edited, since updating your own binding is always fine)
 */
export function findConflict(
    candidate: Pick<ShortcutBinding, "key" | "matchType" | "modifiers">,
    excludeAction: string,
    bindings: ShortcutBinding[],
    /**
     * for actions with multiple bindings, pass the keyDisplay
     * of the slot currently being edited so that slot is excluded from the check
     */
    excludeKeyDisplay?: string,
): ShortcutBinding | null {
    // an empty key can never conflict . skip unbound slots on both sides
    if (!candidate.key) return null;

    return bindings.find(b => {
        if (!b.key) return false;
        // Exclude the exact slot being edited
        if (b.action === excludeAction && b.keyDisplay === excludeKeyDisplay) return false;
        // for single-binding actions, exclude all slots of the same action
        if (b.action === excludeAction && excludeKeyDisplay === undefined) return false;

        if (b.matchType !== candidate.matchType) return false;
        if (b.key !== candidate.key) return false;

        const bm = b.modifiers;
        const cm = candidate.modifiers;
        return (
            !!(bm.ctrl)  === !!(cm.ctrl)  &&
            !!(bm.shift) === !!(cm.shift) &&
            !!(bm.alt)   === !!(cm.alt)
        );
    }) ?? null;
}

/**
 * derive the Tauri global-shortcut string from a binding
 * format: ["Ctrl+"]["Shift+"]["Alt+"]Key
 * for key names: Tauri uses its own set . we map common ones
 * returns null if the key cannot be registered globally
 */
export function deriveGlobalString(binding: ShortcutBinding): string | null {
    // arrow keys and bare Space are not reliably supported as global shortcuts
    const unsupported = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Escape"]);
    const resolvedKey = binding.matchType === "key" ? binding.key : codeToGlobalKey(binding.key);

    if (!resolvedKey) return null;
    if (unsupported.has(resolvedKey)) return null;

    const parts: string[] = [];
    if (binding.modifiers.ctrl)  parts.push("Ctrl");
    if (binding.modifiers.shift) parts.push("Shift");
    if (binding.modifiers.alt)   parts.push("Alt");
    parts.push(resolvedKey);

    return parts.join("+");
}

/** map event.code values to Tauri global shortcut key names */
function codeToGlobalKey(code: string): string | null {
    if (code.startsWith("Key"))   return code.slice(3);          // KeyF -> F
    if (code.startsWith("Digit")) return code.slice(5);          // Digit1 -> 1
    if (code === "Slash")         return "/";
    if (code === "Space")         return "Space";
    if (code === "F11")           return "F11";
    return null;
}


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

/** Get bindings grouped by category, for display in the modal */
export function getBindingsByCategory(
    bindings: ShortcutBinding[]
): Record<string, Array<{ definition: ShortcutDefinition; binding: ShortcutBinding }>> {
    const result: Record<string, Array<{ definition: ShortcutDefinition; binding: ShortcutBinding }>> = {
        playback: [],
        volume: [],
        seeking: [],
        navigation: [],
        ui: []
    };

    for (const binding of bindings) {
        const def = shortcutDefinitions.find(d => d.action === binding.action);
        if (!def) continue;
        result[def.category].push({ definition: def, binding });
    }

    return result;
}

// Category display names
export const categoryNames: Record<string, string> = {
    playback: 'Playback',
    volume: 'Volume',
    seeking: 'Seeking',
    navigation: 'Navigation',
    ui: 'UI Toggles'
};

/**
 * build a human-readable display string from a captured keydown event
 * used in the rebind capture UI
 */
export function buildKeyDisplay(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey)  parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey)   parts.push("Alt");

    const keyLabel = keyEventToLabel(e);
    if (keyLabel) parts.push(keyLabel);

    return parts.join(" + ");
}

/** map a keydown event to a short display label for the key itself */
function keyEventToLabel(e: KeyboardEvent): string {
    const codeMap: Record<string, string> = {
        Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
        Escape: "Esc", Enter: "Enter", Backspace: "⌫", Delete: "Del",
        Tab: "Tab",
    };

    if (e.key in codeMap) return codeMap[e.key];
    if (e.key.startsWith("F") && e.key.length <= 3) return e.key; // F1-F12
    if (e.key.length === 1) return e.key.toUpperCase();

    return e.code; // fallback
}