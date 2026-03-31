import { writable, derived, get } from 'svelte/store';
import { isMiniPlayer } from '$lib/stores/ui';

/**
 * Mobile detection and responsive state management.
 * Uses both CSS media queries (via matchMedia) and Tauri platform detection.
 */

const MOBILE_BREAKPOINT = 768;

// Core state: is the viewport mobile-sized?
export const isMobileViewport = writable(false);

// Is the sidebar drawer open on mobile?
export const isMobileSidebarOpen = writable(false);

// Platform detection (set once on init)
export const isMobilePlatform = writable(false);

// Combined: treat as mobile if viewport is small OR platform is mobile.
// Exception: never switch to mobile layout while PIP mini player is active
// (Tauri resizes the window to ~360px for PIP, which would trigger the breakpoint).
export const isMobile = derived(
    [isMobileViewport, isMobilePlatform, isMiniPlayer],
    ([$viewport, $platform, $pip]) => !$pip && ($viewport || $platform)
);

let mediaQuery: MediaQueryList | null = null;

export function initMobileDetection() {
    // 1. Media query detection
    if (typeof window !== 'undefined') {
        mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
        isMobileViewport.set(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => {
            isMobileViewport.set(e.matches);
            // Auto-close sidebar when switching to desktop
            if (!e.matches) {
                isMobileSidebarOpen.set(false);
            }
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
