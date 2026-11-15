import { writable, get } from 'svelte/store';
import { tick } from 'svelte';
import { isTauri, isAndroid, getIsLinux } from '$lib/api/tauri';

export const isFullScreen = writable(false);
export const isMiniPlayer = writable(false);
export const isQueueVisible = writable(false);
export const isSettingsOpen = writable(false);
export const isStatsWrappedOpen = writable(false);

// Prevent overlapping PiP transitions that can cause inconsistent window state.
let miniPlayerTransitionInFlight = false;

// Store original window state for restoring after PIP mode
let originalWindowState: {
    width: number;
    height: number;
    x: number;
    y: number;
} | null = null;

// PIP mode dimensions - Island Mini-Player floating stage (miniplayer.md §2 & §10)
export type IslandWindowState = 'idle' | 'compact' | 'peek' | 'expanded' | 'hud';

export const ISLAND_WINDOW_WIDTH = 396;

export const ISLAND_WINDOW_SIZES: Record<IslandWindowState, { w: number; h: number }> = {
    idle: { w: ISLAND_WINDOW_WIDTH, h: 48 },
    compact: { w: ISLAND_WINDOW_WIDTH, h: 56 },
    peek: { w: ISLAND_WINDOW_WIDTH, h: 60 },
    expanded: { w: ISLAND_WINDOW_WIDTH, h: 180 },
    hud: { w: ISLAND_WINDOW_WIDTH, h: 60 },
};

export async function resizeIslandWindow(state: IslandWindowState): Promise<void> {
    if (!get(isMiniPlayer)) return;
    try {
        const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const target = ISLAND_WINDOW_SIZES[state] || ISLAND_WINDOW_SIZES.compact;
        const screenWidth = window.screen.availWidth;
        const pipX = Math.max(0, Math.round((screenWidth - ISLAND_WINDOW_WIDTH) / 2));
        const pipY = 0;

        // Keep horizontal width constant to avoid async IPC position desync glitches.
        // We only expand or collapse height downwards.
        await appWindow.setMinSize(new LogicalSize(100, 30));
        await appWindow.setSize(new LogicalSize(ISLAND_WINDOW_WIDTH, target.h));

        const currentPos = await appWindow.outerPosition();
        if (Math.abs(currentPos.x - pipX) > 4 || currentPos.y !== pipY) {
            await appWindow.setPosition(new LogicalPosition(pipX, pipY));
        }

        try {
            await appWindow.setShadow(false);
        } catch {}
    } catch (err) {
        console.warn('[Island] Failed to resize window for state', state, err);
    }
}

// shared choke point for every isFullScreen mutation
function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// true while a native View transition is animating the fullscreen open/close
// FullScreenPlayer reads this to skip its own Svelte fade for that same open/close
export const nativeTransitionActive = writable(false);

// true only for the duration of the app-boot logo morph (loading screen => sidebar
// see +page.svelte's app-boot-logo transition)
// sidebar reads this to gate its logo/text view-transition-name
// a view-transition-name left assigned after its own transition ends,
// gets swept into every later transition too
export const appBootTransitionActive = writable(true);

// shared choke point for native View Transitions api usage
// feature detected with a reduced motion and
// same document fallback to a plain synchronous mutation
// returns the ViewTransition (so callers can hook .finished)
// or null when no transition was started (unsupported browser / reduced motion)
//
// two safeguards :
// 1. startViewTransition can throw synchronously in some environments instead of the spec'd async rejection => wrap it so we still fall back to a plain mutation rather than leaving the app stuck
// 2. short watchdog timeout calls transition.skipTransition, so a misbehaving transition degrades to no animation instead of a freeze
const VIEW_TRANSITION_WATCHDOG_MS = 1000;

export function withViewTransition(mutate: () => void, label: string = 'unlabeled'): any {
    const doc = typeof document !== 'undefined' ? (document as any) : null;

    if (doc?.startViewTransition && !prefersReducedMotion() && !getIsLinux()) {
        const startedAt = performance.now();
        console.log(`[viewTransition:${label}] starting`);

        let transition: any;
        try {
            transition = doc.startViewTransition(() => {
                try {
                    mutate();
                } catch (e) {
                    // if mutate() throws here
                    // the browser sees a rejected update callback promise
                    // should abort the transition on its own. log it
                    console.error(`[viewTransition:${label}] mutate() threw:`, e);
                    throw e;
                }
                return tick();
            });
        } catch (e) {
            console.warn(`[viewTransition:${label}] startViewTransition threw synchronously, falling back to plain mutation:`, e);
            mutate();
            return null;
        }

        transition.ready
            ?.then(() => console.log(`[viewTransition:${label}] ready (snapshots captured) at +${(performance.now() - startedAt).toFixed(0)}ms`))
            .catch((e: unknown) => console.warn(`[viewTransition:${label}] ready rejected at +${(performance.now() - startedAt).toFixed(0)}ms:`, e));

        let skipped = false;
        const watchdog = setTimeout(() => {
            skipped = true;
            console.warn(`[viewTransition:${label}] watchdog firing after ${VIEW_TRANSITION_WATCHDOG_MS}ms - transition never resolved, forcing skipTransition()`);
            try {
                transition.skipTransition?.();
            } catch (e) {
                console.warn(`[viewTransition:${label}] failed to skip stuck view transition:`, e);
            }
        }, VIEW_TRANSITION_WATCHDOG_MS);

        transition.finished
            .then(() => console.log(`[viewTransition:${label}] finished at +${(performance.now() - startedAt).toFixed(0)}ms${skipped ? ' (was force-skipped by watchdog)' : ''}`))
            .catch((e: unknown) => console.warn(`[viewTransition:${label}] finished rejected at +${(performance.now() - startedAt).toFixed(0)}ms:`, e))
            .finally(() => clearTimeout(watchdog));

        return transition;
    }

    console.log(`[viewTransition:${label}] not supported or reduced-motion - plain mutation`);
    mutate();
    return null;
}

function mutateFullScreen(mutate: () => void) {
    const transition = withViewTransition(mutate, 'fullscreen');
    if (transition) {
        nativeTransitionActive.set(true);
        transition.finished
            .catch(() => {})
            .finally(() => nativeTransitionActive.set(false));
    }
}

export function toggleFullScreen() {
    mutateFullScreen(() => isFullScreen.update(v => !v));
}

export function openFullScreen() {
    mutateFullScreen(() => isFullScreen.set(true));
}

export function closeFullScreen() {
    mutateFullScreen(() => isFullScreen.set(false));
}

export async function setMiniPlayer(enable: boolean) {
    const currentState = get(isMiniPlayer);

    // Don't do anything if state is already correct
    if (currentState === enable) return;

    // Ignore re-entrant calls while a previous transition is still running.
    if (miniPlayerTransitionInFlight) return;

    if (isTauri()) {
        // PiP is desktop-only , skip window manipulation on Android
        if (isAndroid()) {
            isMiniPlayer.set(enable);
            return;
        }

        try {
            miniPlayerTransitionInFlight = true;
            const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
            const appWindow = getCurrentWindow();

            if (enable) {
                // Entering PIP mode
                // Save current window state
                const size = await appWindow.innerSize();
                const position = await appWindow.outerPosition();
                originalWindowState = {
                    width: size.width,
                    height: size.height,
                    x: position.x,
                    y: position.y
                };

                // Set always on top
                await appWindow.setAlwaysOnTop(true);

                // Hide window decorations (title bar) for clean PIP look
                await appWindow.setDecorations(false);

                // Disable native window shadow to avoid any box shadow around the transparent stage
                try {
                    await appWindow.setShadow(false);
                } catch (e) {
                    console.warn('[PIP] Failed to disable window shadow:', e);
                }

                // Disable resizing in PIP mode
                await appWindow.setResizable(false);

                // Allow small dimensions for island states
                await appWindow.setMinSize(new LogicalSize(100, 30));

                // Calculate position for top-center compact island
                const initialWidth = ISLAND_WINDOW_SIZES.compact.w;
                const initialHeight = ISLAND_WINDOW_SIZES.compact.h;
                const screenWidth = window.screen.availWidth;
                const pipX = Math.max(0, Math.round((screenWidth - initialWidth) / 2));
                const pipY = 0;

                // ⚠️ Set store BEFORE resizing so isMobile's PIP guard (!$pip)
                // is already active when the resize happens.
                isMiniPlayer.set(true);

                // Resize and reposition
                await appWindow.setSize(new LogicalSize(initialWidth, initialHeight));
                await appWindow.setPosition(new LogicalPosition(pipX, pipY));
            } else {
                // Exiting PIP mode
                await appWindow.setAlwaysOnTop(false);

                // Re-enable window shadow
                try {
                    await appWindow.setShadow(true);
                } catch {}

                // Keep native decorations disabled.
                // The app uses a custom desktop title bar, and enabling native
                // decorations here causes duplicate title bars after exiting PiP.
                await appWindow.setDecorations(false);

                // Re-enable resizing
                await appWindow.setResizable(true);

                // Restore original window state
                if (originalWindowState) {
                    // Restore min size first
                    await appWindow.setMinSize(new LogicalSize(320, 480));
                    await appWindow.setSize(new LogicalSize(
                        originalWindowState.width,
                        originalWindowState.height
                    ));
                    await appWindow.setPosition(new LogicalPosition(
                        originalWindowState.x,
                        originalWindowState.y
                    ));
                    originalWindowState = null;
                } else {
                    // Fallback: restore to default size
                    await appWindow.setMinSize(new LogicalSize(320, 480));
                    await appWindow.setSize(new LogicalSize(1280, 800));
                }

                // Set store AFTER restoring size so the desktop layout
                // renders into the correctly-sized window.
                isMiniPlayer.set(false);
            }
        } catch (error) {
            console.error('Failed to toggle PIP mode:', error);
            // Roll back store on failure
            isMiniPlayer.set(currentState);
            return;
        } finally {
            miniPlayerTransitionInFlight = false;
        }
    } else {
        // Non-Tauri: just toggle the store
        isMiniPlayer.set(enable);
    }
}

export async function toggleMiniPlayer() {
    const currentState = get(isMiniPlayer);
    await setMiniPlayer(!currentState);
}

export function toggleQueue() {
    isQueueVisible.update(v => !v);
}

export function toggleSettings() {
    isSettingsOpen.update(v => !v);
}

export type ContextMenuItem =
    | {
        type?: 'item';
        label: string;
        action?: () => void;
        danger?: boolean;
        icon?: string;
        disabled?: boolean;
        submenu?: ContextMenuItem[];
      }
    | { type: 'separator' };

export interface ContextMenu {
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}

export const contextMenu = writable<ContextMenu>({
    visible: false,
    x: 0,
    y: 0,
    items: []
});

