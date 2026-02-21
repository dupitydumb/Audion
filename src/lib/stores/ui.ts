import { writable, get } from 'svelte/store';
import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { isTauri } from '$lib/api/tauri';

export const isFullScreen = writable(false);
export const isMiniPlayer = writable(false);
export const isQueueVisible = writable(false);
export const isSettingsOpen = writable(false);
export const isStatsWrappedOpen = writable(false);

// Store original window state for restoring after PIP mode
let originalWindowState: {
    width: number;
    height: number;
    x: number;
    y: number;
} | null = null;

// PIP mode dimensions - compact size
const PIP_WIDTH = 360;
const PIP_HEIGHT = 80;
const PIP_MARGIN = 20;

export function toggleFullScreen() {
    isFullScreen.update(v => !v);
}

export async function setMiniPlayer(enable: boolean) {
    const currentState = get(isMiniPlayer);

    // Don't do anything if state is already correct
    if (currentState === enable) return;

    if (isTauri()) {
        try {
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

                // Resize and reposition
                await appWindow.setSize(new LogicalSize(PIP_WIDTH, PIP_HEIGHT));
                await appWindow.setPosition(new LogicalPosition(pipX, pipY));
            } else {
                // Exiting PIP mode
                await appWindow.setAlwaysOnTop(false);

                // Restore window decorations (title bar)
                await appWindow.setDecorations(true);

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
            }
        } catch (error) {
            console.error('Failed to toggle PIP mode:', error);
            // If window operations fail, don't update store
            return;
        }
    }

    // Update the store state
    isMiniPlayer.set(enable);
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

export interface ContextMenuItem {
    label: string;
    action?: () => void;
    danger?: boolean;
    disabled?: boolean;
    submenu?: ContextMenuItem[];
    type?: 'item' | 'separator';
}

export interface ContextMenu {
    visible: boolean;
    x: number;
    y: number;
    items: (ContextMenuItem | { type: 'separator' })[];
}

export const contextMenu = writable<ContextMenu>({
    visible: false,
    x: 0,
    y: 0,
    items: []
});

