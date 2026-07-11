// All writable/derived store declarations, shared types, and pure helpers.
// No side-effects. Import this from every sub-module.
import { writable, derived, get } from 'svelte/store';
import type { Track } from '$lib/api/tauri';
import { EventEmitter, type PluginEvents } from '$lib/plugins/event-emitter';
import { equalizer } from '$lib/stores/equalizer';
import { appSettings } from '$lib/stores/settings';
import { addToast } from '$lib/stores/toast';
import { nativeAudioSetEq, nativeAudioSetReplayGainEnabled, nativeAudioSetCrossfadeSeconds } from '$lib/services/native-audio';
import { toNativeBands } from '$lib/stores/equalizer';

// Track which backend is currently active
export type ActiveBackend = 'native' | 'html5' | 'remote' | 'none';
export const activeBackend = writable<ActiveBackend>('none');

// Playback Context Tracking
export interface PlaybackContext {
    type: 'playlist' | 'album' | 'artist';
    playlistId?: number;
    albumId?: number;
    artistName?: string;
    displayName?: string;
}

export const playbackContext = writable<PlaybackContext | null>(null);

export const currentPlaylistId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'playlist' ? $ctx.playlistId ?? null : null)
);

export const currentAlbumId = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'album' ? $ctx.albumId ?? null : null)
);

export const currentArtistName = derived(
    playbackContext,
    ($ctx) => ($ctx?.type === 'artist' ? $ctx.artistName ?? null : null)
);

// Current track
export const currentTrack = writable<Track | null>(null);
export const currentTrackId = derived(currentTrack, ($t) => $t?.id ?? null);

// Playing state
export const isPlaying = writable(false);

// Queue
export const queue = writable<Track[]>([]);
export const queueIndex = writable(0);
export const userQueueCount = writable(0);

// Shuffled queue
export const shuffledIndices = writable<number[]>([]);
export const shuffledIndex = writable<number>(0);

// Volume (0-1) - this is the SLIDER value (linear)
export const volume = writable(0.7);

export function sliderToAudioVolume(sliderValue: number): number {
    return Math.pow(sliderValue, 2);
}

export function audioVolumeToSlider(audioVolume: number): number {
    return Math.sqrt(audioVolume);
}

// Current time and duration
export const currentTime = writable(0);
export const duration = writable(0);

// Shuffle and repeat
export const shuffle = writable(false);
export const repeat = writable<'none' | 'one' | 'all'>('none');

// Plugin event emitter (global singleton for plugin system)
export const pluginEvents = new EventEmitter<PluginEvents>();

// Note: html5-audio.ts has its own copy of classifyAudioPath for internal use.
// This copy exists solely for the custom-scheme check in playTrack.
export type AudioPathKind = 'local' | 'stream' | 'blob' | 'custom-scheme';

export function classifyAudioPath(path: string): AudioPathKind {
    if (path.startsWith('blob:')) return 'blob';
    if (path.startsWith('http://') || path.startsWith('https://')) return 'stream';
    if (path.startsWith('file://') || path.startsWith('asset://') || path.startsWith('tauri://')) return 'local';
    if (path.includes('://')) return 'custom-scheme';
    return 'local'; // absolute/relative filesystem path
}

/**
 * Detect if a track needs HTML5 streaming or native local playback
 */
export function isStreaming(track: Track): boolean {
    // 1. Explicitly local sources (by type or path)
    if (track.source_type === 'local' || track.source_type === 'server' || track.local_src) return false;

    if (track.path) {
        // Tauri local protocols are always local
        if (track.path.startsWith('file://') || track.path.startsWith('asset://') || track.path.startsWith('tauri://')) {
            return false;
        }
        // Explicitly streaming protocols
        if (track.path.startsWith('http://') || track.path.startsWith('https://')) {
            return true;
        }
    }

    // 3. Known external source types (Tidal, etc.)
    if (track.source_type && track.source_type !== 'local') return true;

    // 4. Default to local for anything else (safer for absolute paths)
    return false;
}

// Playback session tracking (module-level, shared with playback.ts via this module)
export let currentSessionId = 0;
export let playStartTime: number = 0;

// Increment session ID. Returns the new value.
export function nextSessionId(): number {
    return ++currentSessionId;
}

// Native fallback tracking
export let nativeAudioUsed = false;
export function setNativeAudioUsed(val: boolean): void { nativeAudioUsed = val; }

export let _nativeErrorCount = 0;
export const NATIVE_ERROR_FALLBACK_THRESHOLD = 3;
export function incrementNativeErrorCount(): number { return ++_nativeErrorCount; }
export function resetNativeErrorCount(): void { _nativeErrorCount = 0; }

// EQ subscription — debounced, forwards to native backend
let _eqApplyTimer: ReturnType<typeof setTimeout> | null = null;
let _latestEqState: any = null;
equalizer.subscribe((state) => {
    _latestEqState = state;

    if (_eqApplyTimer) clearTimeout(_eqApplyTimer);
    _eqApplyTimer = setTimeout(async () => {
        _eqApplyTimer = null;

        // re-check backend at fire time as it may have changed during the debounce window
        if (get(activeBackend) !== 'native') return;

        try {
            const state = _latestEqState;
            await nativeAudioSetEq({
                enabled: state.enabled,
                bands: toNativeBands(state.bands),
                preamp_db: state.preampDb,
            });
        } catch (err) {
            console.error('[EQ] Failed to apply settings:', err);
            addToast('Failed to apply equalizer settings', 'error');
        }
    }, 200);
});

// Sync replayGain + crossfade to native when settings change
appSettings.subscribe((settings) => {
    if (get(activeBackend) === 'native') {
        nativeAudioSetReplayGainEnabled(settings.replayGainEnabled).catch(console.error);
        nativeAudioSetCrossfadeSeconds(settings.crossfadeSeconds).catch(console.error);
    }
});
