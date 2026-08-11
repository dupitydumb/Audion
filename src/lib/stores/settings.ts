// App settings store - manages app-wide settings
import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { ShortcutBinding } from '$lib/stores/shortcuts';
import type { ViewType } from '$lib/stores/view';

/**
 * which page to show when the app starts
 * last visited restores whatever view was open when the app last closed
 * including detail views (album/artist/playlist) => the full ViewState
 * (type + id/name) is persisted separately to localStorage on app close
 * (see +layout.svelte onDestroy) and restored via navigateTo
 *
 * detail views (albumdetail, artistdetail, playlistdetail,
 * tracksmultiselect) are excluded from this type
 */
export type StartupPage = Exclude<
    ViewType,
    'album-detail' | 'artist-detail' | 'playlist-detail' | 'tracks-multiselect'
> | 'last-visited';

export interface AppSettings {
    downloadLocation: string | null;
    autoAddToLibrary: boolean;
    developerMode: boolean;
    showDiscord: boolean;
    startMode: 'normal' | 'maximized' | 'minimized';
    closeToTray: boolean;
    minimizeToTray: boolean;
    autoplay: boolean;
    audioBackend: 'auto' | 'native' | 'html5';
    listenBrainzEnabled: boolean;
    /** True when a token file exists – refreshed at startup, not persisted in localStorage */
    listenBrainzTokenSet: boolean;
    listenBrainzUsername: string;
    remoteControlEnabled: boolean;
    showResonate: boolean;
    replayGainEnabled: boolean;
    /** master safety limiter after ReplayGain/volume/EQ
     * native backend only
     * off means audio is passed through untouched, so RG/EQ boosts can clip */
    limiterEnabled: boolean;
    outputDevice: string | null;
    streamServerTracks: boolean;
    /** persisted keyboard shortcut bindings. null means use defaults. */
    keyboardBindings: ShortcutBinding[] | null;
    /** master toggle for keyboard shortcuts (including showHelp / Shift+/) */
    shortcutsEnabled: boolean;
    crossfadeSeconds: number;
    /** which page to show on app launch; see StartupPage for details */
    startupPage: StartupPage;
}

const SETTINGS_STORAGE_KEY = 'audion_settings';

// Default settings
const defaultSettings: AppSettings = {
    downloadLocation: null,
    autoAddToLibrary: false,
    developerMode: false,
    showDiscord: true,
    startMode: 'normal',
    closeToTray: false,
    minimizeToTray: false,
    autoplay: false,
    audioBackend: 'auto',
    listenBrainzEnabled: false,
    listenBrainzTokenSet: false,
    listenBrainzUsername: '',
    remoteControlEnabled: true,
    showResonate: true,
    replayGainEnabled: true,
    limiterEnabled: true,
    outputDevice: null,
    streamServerTracks: true,
    keyboardBindings: null,
    shortcutsEnabled: true,
    crossfadeSeconds: 0,
    startupPage: 'home',
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

        setShowResonate(enabled: boolean) {
            update(state => {
                const newState = { ...state, showResonate: enabled };
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

        setRemoteControlEnabled(enabled: boolean) {
            update(state => {
                const newState = { ...state, remoteControlEnabled: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setReplayGainEnabled(enabled: boolean) {
            update(state => {
                const newState = { ...state, replayGainEnabled: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setLimiterEnabled(enabled: boolean) {
            update(state => {
                const newState = { ...state, limiterEnabled: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setOutputDevice(device: string | null) {
            update(state => {
                const newState = { ...state, outputDevice: device };
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

        setStreamServerTracks(enabled: boolean) {
            update(state => {
                const newState = { ...state, streamServerTracks: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setKeyboardBindings(bindings: ShortcutBinding[] | null) {
            update(state => {
                const newState = { ...state, keyboardBindings: bindings };
                saveSettings(newState);
                return newState;
            });
        },

        setShortcutsEnabled(enabled: boolean) {
            update(state => {
                const newState = { ...state, shortcutsEnabled: enabled };
                saveSettings(newState);
                return newState;
            });
        },

        setCrossfadeSeconds(seconds: number) {
            update(state => {
                const newState = { ...state, crossfadeSeconds: seconds };
                saveSettings(newState);
                return newState;
            });
        },
        setStartupPage(page: StartupPage) {
            update(state => {
                const newState = { ...state, startupPage: page };
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

            // Fetch close-to-tray preference from backend
            try {
                const closeToTray = await invoke<boolean>('get_close_to_tray');
                state.closeToTray = closeToTray;
            } catch (error) {
                console.error('[Settings] Failed to fetch close-to-tray:', error);
            }

            // Fetch minimize-to-tray preference from backend
            try {
                const minimizeToTray = await invoke<boolean>('get_minimize_to_tray');
                state.minimizeToTray = minimizeToTray;
            } catch (error) {
                console.error('[Settings] Failed to fetch minimize-to-tray:', error);
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

        async setCloseToTray(enabled: boolean) {
            try {
                await invoke('set_close_to_tray', { enabled });
                update(state => ({ ...state, closeToTray: enabled }));
            } catch (error) {
                console.error('[Settings] Failed to set close-to-tray:', error);
            }
        },

        async setMinimizeToTray(enabled: boolean) {
            try {
                await invoke('set_minimize_to_tray', { enabled });
                update(state => ({ ...state, minimizeToTray: enabled }));
            } catch (error) {
                console.error('[Settings] Failed to set minimize-to-tray:', error);
            }
        },

        getDownloadLocation(): string | null {
            return get({ subscribe }).downloadLocation;
        },
    };
}

export const appSettings = createSettingsStore();
