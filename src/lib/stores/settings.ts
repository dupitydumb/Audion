// App settings store - manages app-wide settings
import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface AppSettings {
    downloadLocation: string | null;
    autoAddToLibrary: boolean;
    developerMode: boolean;
    showDiscord: boolean;
    startMode: 'normal' | 'maximized' | 'minimized';
    autoplay: boolean;
    audioBackend: 'auto' | 'native' | 'html5';
    listenBrainzEnabled: boolean;
    /** True when a token file exists – refreshed at startup, not persisted in localStorage */
    listenBrainzTokenSet: boolean;
    listenBrainzUsername: string;
}

const SETTINGS_STORAGE_KEY = 'audion_settings';

// Default settings
const defaultSettings: AppSettings = {
    downloadLocation: null,
    autoAddToLibrary: false,
    developerMode: false,
    showDiscord: true,
    startMode: 'normal',
    autoplay: false,
    audioBackend: 'auto',
    listenBrainzEnabled: false,
    listenBrainzTokenSet: false,
    listenBrainzUsername: '',
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

        setAutoplay(enabled: boolean) {
            update(state => {
                const newState = { ...state, autoplay: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setAudioBackend(backend: 'auto' | 'native' | 'html5') {
            update(state => {
                const newState = { ...state, audioBackend: backend };
                saveSettings(newState);
                return newState;
            });
        },

        toggleListenBrainz() {
            update(state => {
                const newState = { ...state, listenBrainzEnabled: !state.listenBrainzEnabled };
                saveSettings(newState);
                return newState;
            });
        },

        setListenBrainzTokenSet(set: boolean, username = '') {
            update(state => ({ ...state, listenBrainzTokenSet: set, listenBrainzUsername: username }));
        },

        async initialize() {
            const state = loadSettings();

            // Fetch backend-managed settings
            try {
                const startMode = await invoke('get_window_start_mode') as 'normal' | 'maximized' | 'minimized';
                state.startMode = startMode;
            } catch (error) {
                console.error('[Settings] Failed to fetch start mode:', error);
            }

            // Check whether a ListenBrainz token is stored
            try {
                const tokenSet = await invoke<boolean>('get_listenbrainz_token_set');
                state.listenBrainzTokenSet = tokenSet;
            } catch (error) {
                console.error('[Settings] Failed to check LB token:', error);
            }

            set(state);
        },

        async setStartMode(mode: 'normal' | 'maximized' | 'minimized') {
            try {
                await invoke('set_window_start_mode', { mode });
                update(state => ({ ...state, startMode: mode }));
            } catch (error) {
                console.error('[Settings] Failed to set start mode:', error);
            }
        },

        getDownloadLocation(): string | null {
            return get({ subscribe }).downloadLocation;
        },
    };
}

export const appSettings = createSettingsStore();
