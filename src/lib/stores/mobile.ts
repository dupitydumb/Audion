import { writable, derived, get } from 'svelte/store';
import { fly, scale } from 'svelte/transition';
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

export function appleSpring(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.exp(-8.5 * t) * Math.cos(7.5 * t);
}

export function modalSheetTransition(node: Element) {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return { duration: 0 };
    }
    if (get(isMobile)) {
        return fly(node, { y: 320, duration: 320, opacity: 1, easing: appleSpring });
    }
    return scale(node, { duration: 220, start: 0.95, easing: appleSpring });
}

// Core state: is the viewport mobile-sized? Kept for informational/responsive
// use elsewhere in the UI but doesn't drive mobile/desktop layout
export const isMobileViewport = writable(false);

const initialW = typeof window !== 'undefined' ? window.innerWidth : 0;
const initialH = typeof window !== 'undefined' ? window.innerHeight : 0;
const viewportSize = writable({ width: initialW, height: initialH });

export const isLandscape = derived(
    viewportSize,
    ({ width, height }) => width > height && width > 0
);

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
    if (typeof window === 'undefined') return 'auto';
    try {
        const raw = localStorage.getItem(LAYOUT_OVERRIDE_STORAGE_KEY);
        if (raw === 'auto' || raw === 'mobile' || raw === 'desktop' || raw === 'hybrid') {
            return raw;
        }
    } catch {
        // ignore read failures
    }
    return 'auto';
}

function createLayoutOverrideStore() {
    const store = writable<LayoutOverride>(loadLayoutOverride());
    const { subscribe, set } = store;

    function setAndPersist(value: LayoutOverride) {
        set(value);
        if (typeof window !== 'undefined') {
            try {
                if (value === 'auto') {
                    localStorage.removeItem(LAYOUT_OVERRIDE_STORAGE_KEY);
                } else {
                    localStorage.setItem(LAYOUT_OVERRIDE_STORAGE_KEY, value);
                }
            } catch {
                // ignore write failures
            }
        }
    }

    return {
        subscribe,
        set: setAndPersist,
        reset: () => setAndPersist('auto'),
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

export const isCompactLandscape = derived(
    [isMobile, isLandscape, viewportSize],
    ([$mobile, $landscape, { height }]) => $mobile && $landscape && height > 0 && height <= 540
);

export const isWideMobile = derived(
    [isMobile, isLandscape, viewportSize],
    ([$mobile, $landscape, { width, height }]) => $mobile && $landscape && width >= 768 && height > 540
);

export function detectIsTVSync(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return /tv|leanback|aft|bravia|shield|mibox|chromecast|android tv/i.test(ua);
}

export const isTVPlatform = writable(detectIsTVSync());

export const isTV = derived(
    [isTVPlatform, isMobile, isLandscape, viewportSize],
    ([$tvPlatform, $mobile, $landscape, { width, height }]) => {
        if ($tvPlatform) return true;
        if (!$mobile || !$landscape || width < 960 || height <= 540) return false;
        if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches) {
            return false;
        }
        return true;
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
    isLandscape.subscribe(($landscape) => {
        document.documentElement.classList.toggle('layout-landscape', $landscape);
    });
    isCompactLandscape.subscribe(($compact) => {
        document.documentElement.classList.toggle('layout-compact-landscape', $compact);
    });
    isWideMobile.subscribe(($wide) => {
        document.documentElement.classList.toggle('layout-wide-mobile', $wide);
    });
    isTV.subscribe(($tv) => {
        document.documentElement.classList.toggle('layout-tv', $tv);
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

        const effectiveDesktop =
            override === 'desktop' || (override === 'auto' && !get(isMobilePlatform));

        if (effectiveDesktop) {
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
        const updateViewport = () => {
            viewportSize.set({ width: window.innerWidth, height: window.innerHeight });
        };
        updateViewport();
        window.addEventListener('resize', updateViewport);

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
    void applyWindowSizeLimits(get(layoutOverride));
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

// Mobile search state (for top-bar / unified search)
export const mobileSearchOpen = writable(false);

export type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

/**
 * Register a hardware-back handler on a LIFO stack.
 * Most recently registered handlers execute first; returning `true` consumes the back event.
 * Returns an unregister function.
 */
export function registerBackHandler(handler: BackHandler): () => void {
    backHandlers.push(handler);
    return () => {
        const idx = backHandlers.lastIndexOf(handler);
        if (idx !== -1) {
            backHandlers.splice(idx, 1);
        }
    };
}

/**
 * Run registered back handlers in LIFO order.
 * Returns `true` if any handler consumed the back press.
 */
export function dispatchBackHandlers(): boolean {
    const snapshot = [...backHandlers];
    for (let i = snapshot.length - 1; i >= 0; i--) {
        const handler = snapshot[i];
        if (!backHandlers.includes(handler)) continue;
        try {
            if (handler()) {
                return true;
            }
        } catch (err) {
            console.error('[Mobile] Back handler threw:', err);
        }
    }
    return false;
}
