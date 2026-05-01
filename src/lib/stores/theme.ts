// Theme store - manages app theming and customization
import { writable, derived, get } from 'svelte/store';

export type ThemeMode = 'dark' | 'light' | 'system';

export interface ThemeColors {
    accent: string;
    accentHover: string;
}

export interface ThemeState {
    mode: ThemeMode;
    accentColor: string;
    customAccentColors: string[];
}

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
};

// Load theme from localStorage
function loadTheme(): ThemeState {
    if (typeof window === 'undefined') return defaultTheme;

    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
            return { ...defaultTheme, ...JSON.parse(stored) };
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
    // Start with default theme - actual theme is loaded in initialize() when browser is ready
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
                const newColors = [...state.customAccentColors, color].slice(-5); // Keep last 5
                const newState = { ...state, customAccentColors: newColors };
                saveTheme(newState);
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

// Apply theme to CSS variables
export function applyTheme(state: ThemeState): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const isDark = state.mode === 'dark' ||
        (state.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    // Apply accent colors
    root.style.setProperty('--accent-primary', state.accentColor);
    root.style.setProperty('--accent-primary-rgb', hexToRgb(state.accentColor));
    root.style.setProperty('--accent-hover', lightenColor(state.accentColor, 15));
    root.style.setProperty('--accent-subtle', state.accentColor + '20');

    if (isDark) {
        // Dark theme
        root.style.setProperty('--bg-base', '#121212');
        root.style.setProperty('--bg-elevated', '#181818');
        root.style.setProperty('--bg-surface', '#282828');
        root.style.setProperty('--bg-highlight', '#3e3e3e');
        root.style.setProperty('--bg-press', '#535353');
        root.style.setProperty('--text-primary', '#ffffff');
        root.style.setProperty('--text-secondary', '#b3b3b3');
        root.style.setProperty('--text-subdued', '#6a6a6a');
        root.style.setProperty('--border-color', '#404040');
    } else {
        // Light theme
        root.style.setProperty('--bg-base', '#f5f5f5');
        root.style.setProperty('--bg-elevated', '#ffffff');
        root.style.setProperty('--bg-surface', '#e8e8e8');
        root.style.setProperty('--bg-highlight', '#d4d4d4');
        root.style.setProperty('--bg-press', '#c0c0c0');
        root.style.setProperty('--text-primary', '#121212');
        root.style.setProperty('--text-secondary', '#535353');
        root.style.setProperty('--text-subdued', '#8a8a8a');
        root.style.setProperty('--border-color', '#d0d0d0');
    }

    // Add theme attribute to root for CSS selectors
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// Derived store for current theme mode
export const isDarkMode = derived(theme, $theme => {
    if ($theme.mode === 'system') {
        if (typeof window === 'undefined') return true;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return $theme.mode === 'dark';
});
