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

// Platform detection (set once on init)
export const isMobilePlatform = writable(false);

function loadLayoutOverride(): LayoutOverride {
    if (typeof window === 'undefined') return 'auto';
    try {
        const raw = localStorage.getItem(LAYOUT_OVERRIDE_STORAGE_KEY);
        if (raw === 'auto' || raw === 'mobile' || raw === 'desktop' || raw === 'hybrid') return raw;
    } catch {
        // ignore read failures
    }
    return 'auto';
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
        reset: () => set('auto'),
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
}

async function detectMobilePlatform() {
    try {
        // Check if we're on Android/iOS via Tauri
        const { type, arch } = await import('@tauri-apps/plugin-os');
        const osType = type();
        if (osType === 'android' || osType === 'ios') {
            isMobilePlatform.set(true);
        }
    } catch {
        // plugin-os not available, fall back to user agent
        if (typeof navigator !== 'undefined') {
            const ua = navigator.userAgent.toLowerCase();
            const isMobileUA = /android|iphone|ipad|ipod|mobile/i.test(ua);
            isMobilePlatform.set(isMobileUA);
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
