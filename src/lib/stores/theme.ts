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
                    // don't overwrite current mode if package has no mode
                    mode: pkg.mode ?? state.mode,
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

// ── Theme package format ──────────────────────────────────────────────────────

export const AUDIOTHEME_VERSION = 1;

export interface AudioThemePackage {
    /** Format version — bump when fields change incompatibly */
    version: number;
    name: string;
    author?: string;
    description?: string;
    accentColor: string;
    mode?: ThemeMode;
    customColors: CustomColors;
    /** background.value is always '' for image/video (paths are machine-local) */
    background: BackgroundConfig;
    animation: AnimationConfig;
}

/** Allowed values for enum fields — used during validation */
const VALID_BG_TYPES: BackgroundType[] = ['none', 'color', 'gradient', 'image', 'video'];
const VALID_MODES: ThemeMode[] = ['dark', 'light', 'system'];
const VALID_TRANSITIONS: PageTransition[] = ['none', 'fade', 'slide', 'scale'];
const VALID_VIZ: VisualizationMode[] = ['none', 'bars', 'wave', 'blur-pulse'];
const VALID_SPEEDS: TransitionSpeed[] = ['slow', 'normal', 'fast'];

function isHex(s: unknown): s is string {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s);
}

/** Parse and validate a raw JSON object as AudioThemePackage.
 *  Returns the package or throws a descriptive error string. */
export function parseThemePackage(raw: unknown): AudioThemePackage {
    if (typeof raw !== 'object' || raw === null) throw 'Not a JSON object';
    const r = raw as Record<string, unknown>;

    if (r.version !== AUDIOTHEME_VERSION) throw `Unsupported version: ${r.version}`;
    if (typeof r.name !== 'string' || !r.name.trim()) throw 'Missing name';
    if (!isHex(r.accentColor)) throw 'Invalid accentColor';
    if (r.mode !== undefined && !VALID_MODES.includes(r.mode as ThemeMode)) throw 'Invalid mode';

    // customColors — all keys optional null or hex
    const cc: CustomColors = { ...defaultCustomColors };
    if (typeof r.customColors === 'object' && r.customColors !== null) {
        const src = r.customColors as Record<string, unknown>;
        for (const k of Object.keys(defaultCustomColors) as (keyof CustomColors)[]) {
            const v = src[k];
            if (v === null || v === undefined) { cc[k] = null; }
            else if (isHex(v)) { cc[k] = v; }
            else throw `Invalid customColors.${k}`;
        }
    }

    // background
    const bg: BackgroundConfig = { ...defaultBackground };
    if (typeof r.background === 'object' && r.background !== null) {
        const b = r.background as Record<string, unknown>;
        if (!VALID_BG_TYPES.includes(b.type as BackgroundType)) throw 'Invalid background.type';
        bg.type = b.type as BackgroundType;
        // strip paths — image/video value cannot travel cross-machine
        bg.value = (bg.type === 'image' || bg.type === 'video') ? '' : (typeof b.value === 'string' ? b.value : '');
        // if value is empty for image/video, downgrade to none
        if ((bg.type === 'image' || bg.type === 'video') && !bg.value) bg.type = 'none';
        bg.opacity = typeof b.opacity === 'number' ? Math.min(1, Math.max(0, b.opacity)) : 1;
        bg.blur = typeof b.blur === 'number' ? Math.min(40, Math.max(0, b.blur)) : 0;
        bg.fixed = typeof b.fixed === 'boolean' ? b.fixed : false;
    }

    // animation
    const anim: AnimationConfig = { ...defaultAnimation };
    if (typeof r.animation === 'object' && r.animation !== null) {
        const a = r.animation as Record<string, unknown>;
        anim.reducedMotion = typeof a.reducedMotion === 'boolean' ? a.reducedMotion : false;
        if (VALID_TRANSITIONS.includes(a.pageTransition as PageTransition)) anim.pageTransition = a.pageTransition as PageTransition;
        if (VALID_VIZ.includes(a.playerVisualization as VisualizationMode)) anim.playerVisualization = a.playerVisualization as VisualizationMode;
        anim.hoverScale = typeof a.hoverScale === 'boolean' ? a.hoverScale : true;
        anim.accentPulse = typeof a.accentPulse === 'boolean' ? a.accentPulse : true;
        if (VALID_SPEEDS.includes(a.transitionSpeed as TransitionSpeed)) anim.transitionSpeed = a.transitionSpeed as TransitionSpeed;
    }

    return {
        version: AUDIOTHEME_VERSION,
        name: (r.name as string).trim(),
        author: typeof r.author === 'string' ? r.author.trim() : undefined,
        description: typeof r.description === 'string' ? r.description.trim() : undefined,
        accentColor: r.accentColor as string,
        mode: r.mode as ThemeMode | undefined,
        customColors: cc,
        background: bg,
        animation: anim,
    };
}

/** Serialize current theme state to an AudioThemePackage object */
export function exportThemePackage(state: ThemeState, name: string, author?: string, description?: string): AudioThemePackage {
    const bg = { ...state.background };
    // strip machine-local paths
    if (bg.type === 'image' || bg.type === 'video') {
        bg.type = 'none';
        bg.value = '';
    }
    return {
        version: AUDIOTHEME_VERSION,
        name: name.trim() || 'My Theme',
        author: author?.trim() || undefined,
        description: description?.trim() || undefined,
        accentColor: state.accentColor,
        mode: state.mode,
        customColors: { ...state.customColors },
        background: bg,
        animation: { ...state.animation },
    };
}

// Normalize any hex to 6-char #RRGGBB (strips alpha if 8-char)
function hex6(hex: string): string {
    return '#' + hex.replace('#', '').slice(0, 6);
}

// Lighten a color for hover state
function lightenColor(hex: string, percent: number): string {
    const num = parseInt(hex6(hex).replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// Darken a color
function darkenColor(hex: string, percent: number): string {
    const num = parseInt(hex6(hex).replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// Pick white or black text based on accent luminance (WCAG relative luminance)
function accentTextColor(hex: string): string {
    const num = parseInt(hex6(hex).replace('#', ''), 16);
    const r = (num >> 16) / 255;
    const g = ((num >> 8) & 0xff) / 255;
    const b = (num & 0xff) / 255;
    const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return L > 0.179 ? '#000000' : '#ffffff';
}

// Convert hex to RGB string (r, g, b)
function hexToRgb(hex: string): string {
    const num = parseInt(hex6(hex).replace('#', ''), 16);
    const R = (num >> 16);
    const G = ((num >> 8) & 0x00FF);
    const B = (num & 0x0000FF);
    return `${R}, ${G}, ${B}`;
}

/** Dark-mode defaults for each custom color slot */
export const darkDefaults: Record<keyof CustomColors, string> = {
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
export const lightDefaults: Record<keyof CustomColors, string> = {
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
    root.style.setProperty('--text-on-accent', accentTextColor(state.accentColor));

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

    // background-attachment:fixed is broken on iOS WebKit — always use scroll there
    const isIos = typeof navigator !== 'undefined' &&
        /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const useFixed = bg.fixed && !isIos;

    layer.style.opacity = String(bg.opacity);
    layer.style.backdropFilter = bg.blur > 0 ? `blur(${bg.blur}px)` : '';
    layer.style.backgroundAttachment = useFixed ? 'fixed' : 'scroll';

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
            if (vid.src !== bg.value) {
                vid.src = bg.value;
                // iOS blocks autoplay attr — call play() explicitly after src set
                vid.load();
                vid.play().catch(() => {/* blocked by browser policy, ok */});
            }
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
