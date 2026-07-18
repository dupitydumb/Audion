import { writable, get } from 'svelte/store';
import { tick } from 'svelte';
import { isTauri, isAndroid } from '$lib/api/tauri';

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

// PIP mode dimensions - floating card size
const PIP_WIDTH = 400;
const PIP_HEIGHT = 148;
const PIP_MARGIN = 16;

// shared choke point for every isFullScreen mutation
function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// true while a native View transition is animating the fullscreen open/close
// FullScreenPlayer reads this to skip its own Svelte fade for that same open/close
export const nativeTransitionActive = writable(false);

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

    if (doc?.startViewTransition && !prefersReducedMotion()) {
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

                // Disable resizing in PIP mode
                await appWindow.setResizable(false);

                // Remove minimum size constraint temporarily
                await appWindow.setMinSize(new LogicalSize(PIP_WIDTH, PIP_HEIGHT));

                // Calculate position for bottom-right corner
                // Get screen dimensions using window.screen (web API)
                const screenWidth = window.screen.availWidth;
                const screenHeight = window.screen.availHeight;
                const pipX = screenWidth - PIP_WIDTH - PIP_MARGIN;
                const pipY = screenHeight - PIP_HEIGHT - PIP_MARGIN;

                // ⚠️ Set store BEFORE resizing so that isMobile stays false
                // when the resize event fires and isMobileViewport turns true.
                isMiniPlayer.set(true);

                // Resize and reposition
                await appWindow.setSize(new LogicalSize(PIP_WIDTH, PIP_HEIGHT));
                await appWindow.setPosition(new LogicalPosition(pipX, pipY));
            } else {
                // Exiting PIP mode
                await appWindow.setAlwaysOnTop(false);

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

