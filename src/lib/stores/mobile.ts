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

export type LayoutOverride = 'auto' | 'mobile' | 'desktop';

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
        if (raw === 'auto' || raw === 'mobile' || raw === 'desktop') return raw;
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

// user-configurable override: 'auto' (OS-detected), 'mobile', or 'desktop'
// Settings > Appearance > Layout
export const layoutOverride = createLayoutOverrideStore();

// combined: layout is decided by the override when set, otherwise by real
// platform detection (never by window size)
// Exception: never switch to mobile layout while PIP mini player is active
// (Tauri resizes the window to ~360px for PIP, which is unrelated to layout mode).
export const isMobile = derived(
    [layoutOverride, isMobilePlatform, isMiniPlayer],
    ([$override, $platform, $pip]) => {
        if ($pip) return false;
        if ($override === 'mobile') return true;
        if ($override === 'desktop') return false;
        return $platform;
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
