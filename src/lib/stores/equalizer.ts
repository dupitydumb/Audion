// Equalizer store - manages audio EQ settings
import { writable, get } from 'svelte/store';

export interface EqualizerBand {
    frequency: number;
    label: string;
    gain: number; // -12 to +12 dB
}

export interface EqualizerState {
    enabled: boolean;
    bands: EqualizerBand[];
    currentPreset: string | null;
}

export interface EqualizerPreset {
    name: string;
    gains: number[]; // Gains for each band in order
}

// Standard 10-band equalizer frequencies
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

// Preset definitions
export const EQ_PRESETS: EqualizerPreset[] = [
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

const EQ_STORAGE_KEY = 'audion_equalizer';

// Create default bands
function createDefaultBands(): EqualizerBand[] {
    return EQ_FREQUENCIES.map((freq, i) => ({
        frequency: freq,
        label: EQ_LABELS[i],
        gain: 0
    }));
}

// Default state
const defaultState: EqualizerState = {
    enabled: false,
    bands: createDefaultBands(),
    currentPreset: 'Flat'
};

// Load from localStorage
function loadState(): EqualizerState {
    if (typeof window === 'undefined') return defaultState;

    try {
        const stored = localStorage.getItem(EQ_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Ensure bands array has correct structure
            if (parsed.bands && Array.isArray(parsed.bands) && parsed.bands.length === 10) {
                return {
                    enabled: parsed.enabled ?? false,
                    bands: parsed.bands.map((b: any, i: number) => ({
                        frequency: EQ_FREQUENCIES[i],
                        label: EQ_LABELS[i],
                        gain: typeof b.gain === 'number' ? Math.max(-12, Math.min(12, b.gain)) : 0
                    })),
                    currentPreset: parsed.currentPreset ?? null
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

// Create the equalizer store
function createEqualizerStore() {
    const { subscribe, set, update } = writable<EqualizerState>(loadState());

    // Internal callbacks for when filters need updating
    let gainChangeCallbacks: Set<(bandIndex: number, gain: number) => void> = new Set();
    let enabledChangeCallbacks: Set<(enabled: boolean) => void> = new Set();

    return {
        subscribe,

        // Register callbacks for audio system integration - returns unsubscribe function
        onGainChange(callback: (bandIndex: number, gain: number) => void): () => void {
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
            if (bandIndex < 0 || bandIndex >= 10) return;

            // Clamp gain to valid range
            gain = Math.max(-12, Math.min(12, gain));

            update(state => {
                const bands = [...state.bands];
                bands[bandIndex] = { ...bands[bandIndex], gain };

                const newState = {
                    ...state,
                    bands,
                    currentPreset: null // Custom settings
                };
                saveState(newState);

                // Notify audio system
                if (state.enabled) {
                    gainChangeCallbacks.forEach(cb => cb(bandIndex, gain));
                }

                return newState;
            });
        },

        // Apply a preset
        applyPreset(presetName: string) {
            const preset = EQ_PRESETS.find(p => p.name === presetName);
            if (!preset) return;

            update(state => {
                const bands = state.bands.map((band, i) => ({
                    ...band,
                    gain: preset.gains[i]
                }));

                const newState = {
                    ...state,
                    bands,
                    currentPreset: presetName
                };
                saveState(newState);

                // Notify audio system for all bands
                if (state.enabled) {
                    bands.forEach((band, i) => {
                        gainChangeCallbacks.forEach(cb => cb(i, band.gain));
                    });
                }

                return newState;
            });
        },

        // Reset to flat
        reset() {
            this.applyPreset('Flat');
        },

        // Get current state (for initialization)
        getState(): EqualizerState {
            return get({ subscribe });
        }
    };
}

export const equalizer = createEqualizerStore();
