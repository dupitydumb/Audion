// Equalizer store - manages audio EQ settings
import { writable, get } from 'svelte/store';
import type { EqBand as NativeEqBand } from '../services/native-audio';

export type FilterType =
    | 'peaking'
    | 'lowShelf'
    | 'highShelf'
    | 'lowPass'
    | 'highPass'
    | 'bandPass'
    | 'notch'
    | 'allPass';

export interface EqualizerBand {
    id: string;
    frequency: number;    // Hz, clamped to [MIN_FREQ, MAX_FREQ]
    gain: number;         // -12 to +12 dB; unused by lowPass/highPass/bandPass/notch/allPass
    q: number;            // 0.1 to 10.0
    filterType: FilterType;
    enabled: boolean;     // false => band is bypassed without losing settings
}

export interface EqualizerState {
    enabled: boolean;
    bands: EqualizerBand[];
    currentPreset: string | null;
    /** output trim applied after all bands (dB). range: -24..+6 dB */
    preampDb: number;
}

export interface EqualizerPreset {
    name: string;
    bands: Omit<EqualizerBand, 'id'>[];
    builtIn: boolean;
}

export const MIN_FREQ = 20;
export const MAX_FREQ = 20000;
export const MIN_GAIN = -12;
export const MAX_GAIN = 12;
export const MIN_Q = 0.1;
export const MAX_Q = 10;
export const MIN_PREAMP_DB = -24;
export const MAX_PREAMP_DB = 6;
export const MAX_BANDS = 16;
export const MIN_BANDS = 0;

// default 10band layout, the basis for built in presets
const DEFAULT_BAND_LAYOUT: Omit<EqualizerBand, 'id' | 'gain'>[] = [
    { frequency: 31, q: 0.707, filterType: 'lowShelf', enabled: true },
    { frequency: 62, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 125, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 250, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 500, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 1000, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 2000, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 4000, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 8000, q: 1.41, filterType: 'peaking', enabled: true },
    { frequency: 16000, q: 0.707, filterType: 'highShelf', enabled: true },
];

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `band_${Date.now().toString(36)}_${idCounter}`;
}

function makeBand(overrides: Partial<EqualizerBand> & { frequency: number }): EqualizerBand {
    return {
        id: nextId(),
        gain: 0,
        q: 1.41,
        filterType: 'peaking',
        enabled: true,
        ...overrides,
    };
}

function createDefaultBands(): EqualizerBand[] {
    return DEFAULT_BAND_LAYOUT.map((b) => makeBand({ ...b, gain: 0 }));
}

// gains for fixed 10-band presets, applied on top of DEFAULT_BAND_LAYOUT
const BUILTIN_PRESET_GAINS: { name: string; gains: number[] }[] = [
    { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Bass Boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
    { name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6] },
    { name: 'Bass & Treble', gains: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5] },
    { name: 'Vocal', gains: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2] },
    { name: 'Electronic', gains: [4, 3, 0, -2, -1, 0, 2, 3, 4, 4] },
    { name: 'Rock', gains: [4, 3, 2, 0, -1, 0, 2, 3, 4, 4] },
    { name: 'Jazz', gains: [3, 2, 0, 1, -1, -1, 0, 1, 2, 3] },
    { name: 'Classical', gains: [4, 3, 2, 1, 0, 0, 0, 1, 2, 3] },
    { name: 'Pop', gains: [-1, 0, 2, 4, 4, 3, 1, 0, 0, -1] },
];

export const BUILTIN_PRESETS: EqualizerPreset[] = BUILTIN_PRESET_GAINS.map(({ name, gains }) => ({
    name,
    builtIn: true,
    bands: DEFAULT_BAND_LAYOUT.map((b, i) => ({ ...b, gain: gains[i] ?? 0 })),
}));

/** @deprecated kept for any lingering references; prefer per band frequency + formatFreqLabel */
export const EQ_FREQUENCIES = DEFAULT_BAND_LAYOUT.map((b) => b.frequency);
/** @deprecated use BUILTIN_PRESETS */
export const EQ_PRESETS = BUILTIN_PRESETS;

/** format a frequency in Hz for compact band label display */
export function formatFreqLabel(freq: number): string {
    if (freq >= 1000) {
        const k = freq / 1000;
        return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
    }
    return `${Math.round(freq)}`;
}

const EQ_STORAGE_KEY = 'audion_equalizer';
const CUSTOM_PRESETS_KEY = 'audion_custom_eq_presets';

function clampFreq(f: number): number {
    return Math.max(MIN_FREQ, Math.min(MAX_FREQ, f));
}
function clampGain(g: number): number {
    return Math.max(MIN_GAIN, Math.min(MAX_GAIN, g));
}
function clampQ(q: number): number {
    return Math.max(MIN_Q, Math.min(MAX_Q, q));
}
function clampPreamp(db: number): number {
    return Math.max(MIN_PREAMP_DB, Math.min(MAX_PREAMP_DB, db));
}

function sanitizeBand(raw: any): EqualizerBand | null {
    if (!raw || typeof raw.frequency !== 'number') return null;
    return makeBand({
        id: typeof raw.id === 'string' ? raw.id : undefined,
        frequency: clampFreq(raw.frequency),
        gain: clampGain(typeof raw.gain === 'number' ? raw.gain : 0),
        q: clampQ(typeof raw.q === 'number' ? raw.q : 1.41),
        filterType: raw.filterType ?? 'peaking',
        enabled: raw.enabled ?? true,
    });
}

// Default state
const defaultState: EqualizerState = {
    enabled: false,
    bands: createDefaultBands(),
    currentPreset: 'Flat',
    preampDb: 0,
};

// Load from localStorage
function loadState(): EqualizerState {
    if (typeof window === 'undefined') return defaultState;

    try {
        const stored = localStorage.getItem(EQ_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Ensure bands array has correct structure
            if (parsed.bands && Array.isArray(parsed.bands)) {
                const bands = parsed.bands
                    .map(sanitizeBand)
                    .filter((b: EqualizerBand | null): b is EqualizerBand => b !== null)
                    .slice(0, MAX_BANDS);
                return {
                    enabled: parsed.enabled ?? false,
                    bands: bands.length > 0 ? bands : createDefaultBands(),
                    currentPreset: parsed.currentPreset ?? null,
                    preampDb: clampPreamp(typeof parsed.preampDb === 'number' ? parsed.preampDb : 0),
                };
            }
        }
    } catch (error) {
        console.error('[Equalizer] Failed to load state:', error);
    }

    return defaultState;
}

// Save to localStorage
function saveState(state: EqualizerState): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[Equalizer] Failed to save state:', error);
    }
}

function loadCustomPresets(): EqualizerPreset[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.bands))
            .map((p) => ({
                name: p.name,
                builtIn: false,
                bands: p.bands
                    .map((b: any) => sanitizeBand(b))
                    .filter((b: EqualizerBand | null): b is EqualizerBand => b !== null)
                    .map(({ id, ...rest }: EqualizerBand) => rest),
            }));
    } catch (error) {
        console.error('[Equalizer] Failed to load custom presets:', error);
        return [];
    }
}

function saveCustomPresets(presets: EqualizerPreset[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
    } catch (error) {
        console.error('[Equalizer] Failed to save custom presets:', error);
    }
}

// convert store bands -> wire format expected by the backend
export function toNativeBands(bands: EqualizerBand[]): NativeEqBand[] {
    return bands.map(b => ({
        frequency: b.frequency,
        gain: b.gain,
        q: b.q,
        filter_type: b.filterType,
        enabled: b.enabled,
    }));
}

export const customEqPresets = writable<EqualizerPreset[]>(loadCustomPresets());

// Create the equalizer store
function createEqualizerStore() {
    const { subscribe, update } = writable<EqualizerState>(loadState());
    const customPresets = customEqPresets;

    // Internal callbacks for when filters need updating
    let gainChangeCallbacks: Set<(bandIndex: number, band: EqualizerBand) => void> = new Set();
    let enabledChangeCallbacks: Set<(enabled: boolean) => void> = new Set();
    let structureChangeCallbacks: Set<() => void> = new Set();

    function notifyAll(state: EqualizerState) {
        if (state.enabled) {
            state.bands.forEach((band, i) => gainChangeCallbacks.forEach(cb => cb(i, band)));
        }
    }

    return {
        subscribe,
        customPresets: { subscribe: customPresets.subscribe },

        // Register callbacks for audio system integration - returns unsubscribe function
        onGainChange(callback: (bandIndex: number, band: EqualizerBand) => void): () => void {
            gainChangeCallbacks.add(callback);
            return () => {
                gainChangeCallbacks.delete(callback);
            };
        },

        onEnabledChange(callback: (enabled: boolean) => void): () => void {
            enabledChangeCallbacks.add(callback);
            return () => {
                enabledChangeCallbacks.delete(callback);
            };
        },
        /** fired on add/remove band, since that's a structural change rather than a param change */
        onStructureChange(callback: () => void): () => void {
            structureChangeCallbacks.add(callback);
            return () => { structureChangeCallbacks.delete(callback); };
        },

        // Toggle equalizer on/off
        setEnabled(enabled: boolean) {
            update(state => {
                const newState = { ...state, enabled };
                saveState(newState);
                enabledChangeCallbacks.forEach(cb => cb(enabled));
                return newState;
            });
        },

        // Set gain for a specific band
        setBandGain(bandIndex: number, gain: number) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], gain: clampGain(gain) };
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                if (state.enabled) {
                    gainChangeCallbacks.forEach(cb => cb(bandIndex, bands[bandIndex]));
                }
                return newState;
            });
        },

        // set Q for a specific band
        setBandQ(bandIndex: number, q: number) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], q: clampQ(q) };
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                if (state.enabled) gainChangeCallbacks.forEach(cb => cb(bandIndex, bands[bandIndex]));
                return newState;
            });
        },

        setBandFrequency(bandIndex: number, frequency: number) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], frequency: clampFreq(frequency) };
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                if (state.enabled) {
                    gainChangeCallbacks.forEach(cb => cb(bandIndex, bands[bandIndex]));
                }
                return newState;
            });
        },

        // set filter type for a specific band
        setBandFilterType(bandIndex: number, filterType: FilterType) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], filterType };
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                if (state.enabled) {
                    gainChangeCallbacks.forEach(cb => cb(bandIndex, bands[bandIndex]));
                }
                return newState;
            });
        },

        // enable or bypass a specific band without losing its settings
        setBandEnabled(bandIndex: number, enabled: boolean) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], enabled };
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                if (state.enabled) gainChangeCallbacks.forEach(cb => cb(bandIndex, bands[bandIndex]));
                return newState;
            });
        },

        /** add a new band at the given frequency (Hz). returns the new band's index, or -1 if at MAX_BANDS */
        addBand(frequency = 1000, filterType: FilterType = 'peaking'): number {
            let newIndex = -1;
            update(state => {
                if (state.bands.length >= MAX_BANDS) return state;
                const band = makeBand({ frequency: clampFreq(frequency), filterType });
                // keep bands sorted by frequency
                const bands = [...state.bands, band].sort((a, b) => a.frequency - b.frequency);
                newIndex = bands.findIndex(b => b.id === band.id);
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                structureChangeCallbacks.forEach(cb => cb());
                if (state.enabled) notifyAll(newState);
                return newState;
            });
            return newIndex;
        },

        removeBand(bandIndex: number) {
            update(state => {
                if (bandIndex < 0 || bandIndex >= state.bands.length) return state;
                const bands = state.bands.filter((_, i) => i !== bandIndex);
                const newState = { ...state, bands, currentPreset: null };
                saveState(newState);
                structureChangeCallbacks.forEach(cb => cb());
                if (state.enabled) notifyAll(newState);
                return newState;
            });
        },

        // set preamp trim (dB). range: -24..+6
        setPreampDb(preampDb: number) {
            update(state => {
                const newState = { ...state, preampDb: clampPreamp(preampDb) };
                saveState(newState);
                return newState;
            });
        },

        // Apply a preset
        applyPreset(name: string) {
            const preset = BUILTIN_PRESETS.find(p => p.name === name) ?? get(customPresets).find(p => p.name === name);
            if (!preset) return;

            update(state => {
                const bands = preset.bands.map(b => makeBand({ ...b }));
                const newState = { ...state, bands, currentPreset: name };
                saveState(newState);
                structureChangeCallbacks.forEach(cb => cb());
                if (state.enabled) notifyAll(newState);
                return newState;
            });
        },

        /** save the current band curve as a custom preset. overwrites an existing custom preset of the same name */
        saveCurrentAsPreset(name: string): void {
            const trimmed = name.trim();
            if (!trimmed) return;
            if (BUILTIN_PRESETS.some(p => p.name === trimmed)) {
                console.warn('[Equalizer] Cannot overwrite a built-in preset name:', trimmed);
                return;
            }
            const state = get({ subscribe });
            const newPreset: EqualizerPreset = {
                name: trimmed,
                builtIn: false,
                bands: state.bands.map(({ id, ...rest }) => rest),
            };
            customPresets.update(list => {
                const next = [...list.filter(p => p.name !== trimmed), newPreset];
                saveCustomPresets(next);
                return next;
            });
            update(state => {
                const newState = { ...state, currentPreset: trimmed };
                saveState(newState);
                return newState;
            });
        },

        deleteCustomPreset(name: string): void {
            customPresets.update(list => {
                const next = list.filter(p => p.name !== name);
                saveCustomPresets(next);
                return next;
            });
            update(state => state.currentPreset === name ? { ...state, currentPreset: null } : state);
        },

        // Reset to flat
        reset() {
            this.applyPreset('Flat');
        },

        // Get current state (for initialization)
        getState(): EqualizerState {
            return get({ subscribe });
        },

        getAllPresets(): EqualizerPreset[] {
            return [...BUILTIN_PRESETS, ...get(customPresets)];
        },
    };
}

export const equalizer = createEqualizerStore();
