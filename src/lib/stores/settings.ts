// App settings store - manages app-wide settings
import { writable, get } from 'svelte/store';

export interface AppSettings {
    downloadLocation: string | null;
    autoAddToLibrary: boolean;
    developerMode: boolean;
    showDiscord: boolean;
}

const SETTINGS_STORAGE_KEY = 'audion_settings';

// Default settings
const defaultSettings: AppSettings = {
    downloadLocation: null,
    autoAddToLibrary: false,
    developerMode: false,
    showDiscord: true,
};

// Load settings from localStorage
function loadSettings(): AppSettings {
    if (typeof window === 'undefined') return defaultSettings;

    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
            return { ...defaultSettings, ...JSON.parse(stored) };
        }
    } catch (error) {
        console.error('[Settings] Failed to load:', error);
    }

    return defaultSettings;
}

// Save settings to localStorage
function saveSettings(state: AppSettings): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Settings] Failed to save:', error);
    }
}

// Create settings store
function createSettingsStore() {
    const { subscribe, set, update } = writable<AppSettings>(loadSettings());

    return {
        subscribe,

        setDownloadLocation(path: string | null) {
            update(state => {
                const newState = { ...state, downloadLocation: path };
                saveSettings(newState);
                return newState;
            });
        },

        setAutoAddToLibrary(enabled: boolean) {
            update(state => {
                const newState = { ...state, autoAddToLibrary: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setDeveloperMode(enabled: boolean) {
            update(state => {
                const newState = { ...state, developerMode: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setShowDiscord(enabled: boolean) {
            update(state => {
                const newState = { ...state, showDiscord: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        getDownloadLocation(): string | null {
            return get({ subscribe }).downloadLocation;
        },

        initialize() {
            const state = loadSettings();
            set(state);
        }
    };
}

export const appSettings = createSettingsStore();
