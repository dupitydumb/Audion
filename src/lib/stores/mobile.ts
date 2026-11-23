import { writable, derived, get } from 'svelte/store';
import { isMiniPlayer } from '$lib/stores/ui';

/**
 * Mobile detection and responsive state management.
 * layout is decided by real OS/platform detection (Tauri plugin-os / user agent),
 * not by window size
 * users can also force a layout via
 * Settings > Appearance, persisted across restarts
 */

const MOBILE_BREAKPOINT = 768;
const LAYOUT_OVERRIDE_STORAGE_KEY = 'audion:layout-override';

export type LayoutOverride = 'auto' | 'mobile' | 'desktop' | 'hybrid';

// Core state: is the viewport mobile-sized? Kept for informational/responsive
// use elsewhere in the UI but doesn't drive mobile/desktop layout
export const isMobileViewport = writable(false);

// Is the sidebar drawer open on mobile?
export const isMobileSidebarOpen = writable(false);

export function detectIsMobileSync(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

// Platform detection (initialized synchronously via UA, refined via Tauri plugin-os)
export const isMobilePlatform = writable(detectIsMobileSync());

function loadLayoutOverride(): LayoutOverride {
    if (typeof window === 'undefined') return 'desktop';
    try {
        const raw = localStorage.getItem(LAYOUT_OVERRIDE_STORAGE_KEY);
        if (raw === 'mobile' || raw === 'desktop' || raw === 'hybrid') return raw;
    } catch {
        // ignore read failures
    }
    // Default to desktop when opened on desktop, mobile when opened on mobile
    return detectIsMobileSync() ? 'mobile' : 'desktop';
}

function createLayoutOverrideStore() {
    const store = writable<LayoutOverride>(loadLayoutOverride());
    const { subscribe, set } = store;

    if (typeof window !== 'undefined') {
        subscribe((value) => {
            try {
                localStorage.setItem(LAYOUT_OVERRIDE_STORAGE_KEY, value);
            } catch {
                // ignore write failures
            }
        });
    }

    return {
        subscribe,
        set,
        reset: () => set(detectIsMobileSync() ? 'mobile' : 'desktop'),
    };
}

// user-configurable override: 'auto' (OS-detected), 'mobile', 'desktop', or
// 'hybrid' (mobile page layout + the desktop title bar)
// Settings > Appearance > Layout
export const layoutOverride = createLayoutOverrideStore();

// combined: layout is decided by the override when set, otherwise by real
// platform detection (never by window size)
// hybrid counts as mobile for page layout purposes => only the title bar
// (see useDesktopTitleBar below) diverges from a plain mobile override
// Exception: never switch to mobile layout while PIP mini player is active
// (Tauri resizes the window to ~360px for PIP, which is unrelated to layout mode).
export const isMobile = derived(
    [layoutOverride, isMobilePlatform, isMiniPlayer],
    ([$override, $platform, $pip]) => {
        if ($pip) return false;
        if ($override === 'mobile' || $override === 'hybrid') return true;
        if ($override === 'desktop') return false;
        return $platform;
    }
);

// title-bar-only decision: whether TitleBar.svelte should render its desktop chrome
// instead of the mobile bar (hamburger + collapsible search)
// desktop and hybrid both want the desktop bar; mobile wants the mobile bar
// auto follows real platform detection, same as isMobile
// pip forces the desktop bar too
export const useDesktopTitleBar = derived(
    [layoutOverride, isMobilePlatform, isMiniPlayer],
    ([$override, $platform, $pip]) => {
        if ($pip) return true;
        if ($override === 'desktop' || $override === 'hybrid') return true;
        if ($override === 'mobile') return false;
        return !$platform;
    }
);

// auto-close the mobile sidebar drawer whenever layout leaves mobile mode
// (platform change, override change, or PIP engaging)
isMobile.subscribe(($mobile) => {
    if (!$mobile) {
        isMobileSidebarOpen.set(false);
    }
});

// reflect the resolved layout on <html> as a class, so CSS (including
// @media blocks in component styles) can key off the same override-aware,
// OS-based decision instead of independently re-deriving "mobile" from
// window size
if (typeof document !== 'undefined') {
    isMobile.subscribe(($mobile) => {
        const root = document.documentElement;
        root.classList.toggle('layout-mobile', $mobile);
        root.classList.toggle('layout-desktop', !$mobile);
    });
}

export const DESKTOP_MIN_WIDTH = 800;
export const DESKTOP_MIN_HEIGHT = 500;
export const MOBILE_MIN_WIDTH = 320;
export const MOBILE_MIN_HEIGHT = 480;

export async function applyWindowSizeLimits(override: LayoutOverride) {
    if (typeof window === 'undefined') return;
    try {
        const { isTauri } = await import('$lib/api/tauri');
        if (!isTauri()) return;
        const { isMiniPlayer } = await import('$lib/stores/ui');
        if (get(isMiniPlayer)) return; // Never override PIP window limits

        const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();

        if (override === 'desktop') {
            await appWindow.setMinSize(new LogicalSize(DESKTOP_MIN_WIDTH, DESKTOP_MIN_HEIGHT));

            const size = await appWindow.innerSize();
            const factor = await appWindow.scaleFactor();
            const currentW = size.width / factor;
            const currentH = size.height / factor;

            if (currentW < DESKTOP_MIN_WIDTH || currentH < DESKTOP_MIN_HEIGHT) {
                await appWindow.setSize(new LogicalSize(
                    Math.max(currentW, DESKTOP_MIN_WIDTH),
                    Math.max(currentH, DESKTOP_MIN_HEIGHT)
                ));
            }
        } else {
            await appWindow.setMinSize(new LogicalSize(MOBILE_MIN_WIDTH, MOBILE_MIN_HEIGHT));
        }
    } catch {
        // Ignored outside Tauri / unsupported platforms
    }
}

// enforce desktop min-size when desktop override is active
layoutOverride.subscribe((val) => {
    void applyWindowSizeLimits(val);
});

let mediaQuery: MediaQueryList | null = null;

export function initMobileDetection() {
    // 1. Media query detection (informational only => does not drive layout)
    if (typeof window !== 'undefined') {
        mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
        isMobileViewport.set(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => {
            isMobileViewport.set(e.matches);
        };

        mediaQuery.addEventListener('change', handler);
    }

    // 2. Tauri platform detection
    detectMobilePlatform();

    // 3. Enforce window size limits for layout override
    void applyWindowSizeLimits(get(layoutOverride));
}

async function detectMobilePlatform() {
    let isMob = detectIsMobileSync();
    try {
        // Check if we're on Android/iOS via Tauri
        const { type } = await import('@tauri-apps/plugin-os');
        const osType = type();
        if (osType === 'android' || osType === 'ios') {
            isMob = true;
        } else {
            isMob = false;
        }
    } catch {
        // plugin-os not available, fall back to user agent
    }

    isMobilePlatform.set(isMob);

    // If no explicit user override was saved in localStorage, default to OS platform layout
    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(LAYOUT_OVERRIDE_STORAGE_KEY);
            if (!raw || raw === 'auto') {
                const targetLayout: LayoutOverride = isMob ? 'mobile' : 'desktop';
                layoutOverride.set(targetLayout);
            }
        } catch {
            // ignore localStorage failures
        }
    }
}

export function toggleMobileSidebar() {
    isMobileSidebarOpen.update(v => !v);
}

export function closeMobileSidebar() {
    isMobileSidebarOpen.set(false);
}

export function openMobileSidebar() {
    isMobileSidebarOpen.set(true);
}

// Mobile search state (for bottom nav Search tab)
export const mobileSearchOpen = writable(false);
