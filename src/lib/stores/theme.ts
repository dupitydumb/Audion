// Theme store - manages app theming and customization
import { writable, derived, get } from 'svelte/store';

export type ThemeMode = 'dark' | 'light' | 'system';

export type BackgroundType = 'none' | 'color' | 'gradient' | 'image' | 'video';

export interface BackgroundConfig {
    type: BackgroundType;
    /** hex for 'color', CSS gradient string for 'gradient', file path for 'image'/'video' */
    value: string;
    /** 0–1 opacity of the background layer */
    opacity: number;
    /** px blur applied to the bg layer */
    blur: number;
    /** background-attachment: fixed */
    fixed: boolean;
}

/** Per-token color overrides — null means use the mode default */
export interface CustomColors {
    bgBase: string | null;
    bgElevated: string | null;
    bgSurface: string | null;
    bgHighlight: string | null;
    textPrimary: string | null;
    textSecondary: string | null;
    textSubdued: string | null;
    borderColor: string | null;
    sidebarBg: string | null;
    playerBg: string | null;
}

export type PageTransition = 'none' | 'fade' | 'slide' | 'scale';
export type VisualizationMode = 'none' | 'bars' | 'wave' | 'blur-pulse';
export type TransitionSpeed = 'slow' | 'normal' | 'fast';

export interface AnimationConfig {
    /** Force-disable all animations (overrides everything) */
    reducedMotion: boolean;
    /** View-transition style when navigating between views */
    pageTransition: PageTransition;
    /** Audio visualizer in the player bar */
    playerVisualization: VisualizationMode;
    /** Card hover lift + scale */
    hoverScale: boolean;
    /** Accent pulse on the playing indicator */
    accentPulse: boolean;
    /** Global transition speed multiplier */
    transitionSpeed: TransitionSpeed;
}

export interface ThemeColors {
    accent: string;
    accentHover: string;
}

export interface ThemeState {
    mode: ThemeMode;
    accentColor: string;
    customAccentColors: string[];
    customColors: CustomColors;
    background: BackgroundConfig;
    animation: AnimationConfig;
    /** Allow custom JS in theme packages — only for locally loaded themes */
    allowCustomJs: boolean;
}

const defaultAnimation: AnimationConfig = {
    reducedMotion: false,
    pageTransition: 'fade',
    playerVisualization: 'bars',
    hoverScale: true,
    accentPulse: true,
    transitionSpeed: 'normal',
};

const defaultBackground: BackgroundConfig = {
    type: 'none',
    value: '',
    opacity: 1,
    blur: 0,
    fixed: false,
};

const defaultCustomColors: CustomColors = {
    bgBase: null,
    bgElevated: null,
    bgSurface: null,
    bgHighlight: null,
    textPrimary: null,
    textSecondary: null,
    textSubdued: null,
    borderColor: null,
    sidebarBg: null,
    playerBg: null,
};

// Preset accent colors
export const presetAccents = [
    { name: 'Green', color: '#1DB954' },
    { name: 'Blue', color: '#1E90FF' },
    { name: 'Purple', color: '#9B59B6' },
    { name: 'Pink', color: '#E91E63' },
    { name: 'Orange', color: '#FF6B35' },
    { name: 'Teal', color: '#00BCD4' },
    { name: 'Red', color: '#E74C3C' },
    { name: 'Yellow', color: '#F1C40F' },
];

const THEME_STORAGE_KEY = 'rlist_theme';

// Default theme state
const defaultTheme: ThemeState = {
    mode: 'dark',
    accentColor: '#1DB954',
    customAccentColors: [],
    customColors: defaultCustomColors,
    background: defaultBackground,
    animation: defaultAnimation,
    allowCustomJs: false,
};

// Load theme from localStorage
function loadTheme(): ThemeState {
    if (typeof window === 'undefined') return defaultTheme;

    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                ...defaultTheme,
                ...parsed,
                customColors: { ...defaultCustomColors, ...(parsed.customColors ?? {}) },
                background: { ...defaultBackground, ...(parsed.background ?? {}) },
                animation: { ...defaultAnimation, ...(parsed.animation ?? {}) },
            };
        }
    } catch (error) {
        console.error('[Theme] Failed to load:', error);
    }

    return defaultTheme;
}

// Save theme to localStorage
function saveTheme(state: ThemeState): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Theme] Failed to save:', error);
    }
}

// Create theme store
function createThemeStore() {
    const { subscribe, set, update } = writable<ThemeState>(defaultTheme);

    return {
        subscribe,

        setMode(mode: ThemeMode) {
            update(state => {
                const newState = { ...state, mode };
                saveTheme(newState);
                applyTheme(newState);
                return newState;
            });
        },

        setAccentColor(color: string) {
            update(state => {
                const newState = { ...state, accentColor: color };
                saveTheme(newState);
                applyTheme(newState);
                return newState;
            });
        },

        addCustomColor(color: string) {
            update(state => {
                if (state.customAccentColors.includes(color)) return state;
                const newColors = [...state.customAccentColors, color].slice(-5);
                const newState = { ...state, customAccentColors: newColors };
                saveTheme(newState);
                return newState;
            });
        },

        setCustomColor(key: keyof CustomColors, value: string | null) {
            update(state => {
                const newState = {
                    ...state,
                    customColors: { ...state.customColors, [key]: value },
                };
                saveTheme(newState);
                applyTheme(newState);
                return newState;
            });
        },

        setBackground(bg: Partial<BackgroundConfig>) {
            update(state => {
                const newState = {
                    ...state,
                    background: { ...state.background, ...bg },
                };
                saveTheme(newState);
                applyBackground(newState.background);
                return newState;
            });
        },

        setAnimation(cfg: Partial<AnimationConfig>) {
            update(state => {
                const newState = { ...state, animation: { ...state.animation, ...cfg } };
                saveTheme(newState);
                applyAnimationVars(newState.animation);
                return newState;
            });
        },

        setAllowCustomJs(allow: boolean) {
            update(state => {
                const newState = { ...state, allowCustomJs: allow };
                saveTheme(newState);
                return newState;
            });
        },

        resetColors() {
            update(state => {
                const newState = { ...state, customColors: defaultCustomColors };
                saveTheme(newState);
                applyTheme(newState);
                return newState;
            });
        },

        resetBackground() {
            update(state => {
                const newState = { ...state, background: defaultBackground };
                saveTheme(newState);
                applyBackground(newState.background);
                return newState;
            });
        },

        /** Apply a full theme package (from .audiotheme file) */
        applyPackage(pkg: Partial<ThemeState>) {
            update(state => {
                const newState: ThemeState = {
                    ...state,
                    ...pkg,
                    customColors: { ...defaultCustomColors, ...(pkg.customColors ?? {}) },
                    background: { ...defaultBackground, ...(pkg.background ?? {}) },
                    animation: { ...defaultAnimation, ...(pkg.animation ?? {}) },
                    // never let a package override allowCustomJs — user controls that
                    allowCustomJs: state.allowCustomJs,
                };
                saveTheme(newState);
                applyTheme(newState);
                return newState;
            });
        },

        initialize() {
            const state = loadTheme();
            set(state);
            applyTheme(state);
        }
    };
}

export const theme = createThemeStore();

// Lighten a color for hover state
function lightenColor(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// Darken a color
function darkenColor(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// Convert hex to RGB string (r, g, b)
function hexToRgb(hex: string): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const R = (num >> 16);
    const G = ((num >> 8) & 0x00FF);
    const B = (num & 0x0000FF);
    return `${R}, ${G}, ${B}`;
}

/** Dark-mode defaults for each custom color slot */
const darkDefaults: Record<keyof CustomColors, string> = {
    bgBase: '#121212',
    bgElevated: '#181818',
    bgSurface: '#282828',
    bgHighlight: '#3e3e3e',
    textPrimary: '#ffffff',
    textSecondary: '#b3b3b3',
    textSubdued: '#6a6a6a',
    borderColor: '#404040',
    sidebarBg: '#121212',
    playerBg: '#181818',
};

/** Light-mode defaults for each custom color slot */
const lightDefaults: Record<keyof CustomColors, string> = {
    bgBase: '#f5f5f5',
    bgElevated: '#ffffff',
    bgSurface: '#e8e8e8',
    bgHighlight: '#d4d4d4',
    textPrimary: '#121212',
    textSecondary: '#535353',
    textSubdued: '#8a8a8a',
    borderColor: '#d0d0d0',
    sidebarBg: '#f5f5f5',
    playerBg: '#ffffff',
};

// Apply theme to CSS variables
export function applyTheme(state: ThemeState): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const isDark = state.mode === 'dark' ||
        (state.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const modeDefaults = isDark ? darkDefaults : lightDefaults;
    const c = state.customColors;

    // Background tokens — go transparent when a bg layer is active so it shows through
    const hasBgLayer = state.background.type !== 'none';
    root.style.setProperty('--bg-base', hasBgLayer ? 'transparent' : (c.bgBase ?? modeDefaults.bgBase));
    root.style.setProperty('--bg-elevated', c.bgElevated ?? modeDefaults.bgElevated);
    root.style.setProperty('--bg-surface', c.bgSurface ?? modeDefaults.bgSurface);
    root.style.setProperty('--bg-highlight', c.bgHighlight ?? modeDefaults.bgHighlight);
    root.style.setProperty('--bg-press', isDark ? '#535353' : '#c0c0c0');

    // Sidebar / player slots (fall back to bg-elevated if not set)
    root.style.setProperty('--sidebar-bg', c.sidebarBg ?? (hasBgLayer ? 'transparent' : modeDefaults.sidebarBg));
    root.style.setProperty('--player-bg', c.playerBg ?? modeDefaults.playerBg);

    // Text tokens
    root.style.setProperty('--text-primary', c.textPrimary ?? modeDefaults.textPrimary);
    root.style.setProperty('--text-secondary', c.textSecondary ?? modeDefaults.textSecondary);
    root.style.setProperty('--text-subdued', c.textSubdued ?? modeDefaults.textSubdued);

    // Border
    root.style.setProperty('--border-color', c.borderColor ?? modeDefaults.borderColor);

    // Accent colors
    root.style.setProperty('--accent-primary', state.accentColor);
    root.style.setProperty('--accent-primary-rgb', hexToRgb(state.accentColor));
    root.style.setProperty('--accent-hover', lightenColor(state.accentColor, 15));
    root.style.setProperty('--accent-subtle', state.accentColor + '20');

    // Theme attribute for CSS selectors
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');

    // Apply background layer
    applyBackground(state.background);

    // Apply animation CSS vars
    applyAnimationVars(state.animation);
}

/** Speed multipliers for transition tokens */
const speedMultiplier: Record<TransitionSpeed, number> = {
    slow: 1.8,
    normal: 1,
    fast: 0.5,
};

export function applyAnimationVars(cfg: AnimationConfig): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    if (cfg.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.style.setProperty('--transition-fast', '0ms');
        root.style.setProperty('--transition-normal', '0ms');
        root.style.setProperty('--transition-slow', '0ms');
    } else {
        const m = speedMultiplier[cfg.transitionSpeed];
        root.style.setProperty('--transition-fast',   `${Math.round(150 * m)}ms var(--ease-in-out)`);
        root.style.setProperty('--transition-normal',  `${Math.round(250 * m)}ms var(--ease-in-out)`);
        root.style.setProperty('--transition-slow',    `${Math.round(400 * m)}ms var(--ease-out-expo)`);
    }

    // Hover scale toggle — components read this and conditionally apply transform
    root.style.setProperty('--hover-scale-enabled', cfg.hoverScale && !cfg.reducedMotion ? '1' : '0');
    // Accent pulse toggle
    root.style.setProperty('--accent-pulse-enabled', cfg.accentPulse && !cfg.reducedMotion ? '1' : '0');
    // Page transition type — read by onNavigate handler in +layout.svelte
    root.setAttribute('data-page-transition', cfg.reducedMotion ? 'none' : cfg.pageTransition);
}

/** Blob URL cache for image/video backgrounds (revoked on change) */
let _bgBlobUrl: string | null = null;

export function applyBackground(bg: BackgroundConfig): void {
    if (typeof document === 'undefined') return;

    const layer = document.getElementById('audion-bg-layer') as HTMLElement | null;
    if (!layer) return;

    // Revoke previous blob if we're changing away from it
    if (_bgBlobUrl && bg.type !== 'image' && bg.type !== 'video') {
        URL.revokeObjectURL(_bgBlobUrl);
        _bgBlobUrl = null;
    }

    layer.style.opacity = String(bg.opacity);
    layer.style.backdropFilter = bg.blur > 0 ? `blur(${bg.blur}px)` : '';
    layer.style.backgroundAttachment = bg.fixed ? 'fixed' : 'scroll';

    // Clear video if switching away
    const video = layer.querySelector('video');
    if (video && bg.type !== 'video') {
        video.src = '';
        video.style.display = 'none';
    }

    switch (bg.type) {
        case 'none':
            layer.style.background = 'none';
            layer.style.display = 'none';
            break;

        case 'color':
            layer.style.display = 'block';
            layer.style.background = bg.value;
            layer.style.backgroundSize = '';
            break;

        case 'gradient':
            layer.style.display = 'block';
            layer.style.background = bg.value;
            layer.style.backgroundSize = '';
            break;

        case 'image':
            layer.style.display = 'block';
            // value is either a blob: URL (already resolved) or a file path
            // file paths get resolved to blob URLs by the UI before calling setBackground
            layer.style.background = `url("${bg.value}") center/cover no-repeat`;
            layer.style.backgroundAttachment = bg.fixed ? 'fixed' : 'scroll';
            break;

        case 'video': {
            layer.style.display = 'block';
            layer.style.background = 'none';
            let vid = layer.querySelector('video') as HTMLVideoElement | null;
            if (!vid) {
                vid = document.createElement('video');
                vid.autoplay = true;
                vid.loop = true;
                vid.muted = true;
                vid.playsInline = true;
                vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
                layer.appendChild(vid);
            }
            vid.style.display = 'block';
            if (vid.src !== bg.value) vid.src = bg.value;
            break;
        }
    }
}

// Derived store for current theme mode
export const isDarkMode = derived(theme, $theme => {
    if ($theme.mode === 'system') {
        if (typeof window === 'undefined') return true;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return $theme.mode === 'dark';
});
