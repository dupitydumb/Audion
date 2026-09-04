// =============================================================================
// NATIVE AUDIO SERVICE
// =============================================================================
// This service provides an abstraction layer for audio playback using
// a native backend implemented in Rust (rodio).
//
// WHY THIS EXISTS:
// Using a native backend provides better performance, consistent behavior
// across platforms, and avoids WebView-specific audio quirks.
//
// DESIGN DECISIONS:
// - Simple play/pause/stop/seek interface matching the existing player store
// - Position tracking is done via polling/events from the Rust backend
// - Volume is controlled through the Rust backend
// =============================================================================

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/api/tauri';

// Check if we're running on Linux
let isLinuxPlatform: boolean | null = null;

/**
 * Detect if we're running on Linux.
 * This is cached after first check for performance.
 */
export async function isLinux(): Promise<boolean> {
    if (isLinuxPlatform !== null) {
        return isLinuxPlatform;
    }

    if (!isTauri()) {
        isLinuxPlatform = false;
        return false;
    }

    try {
        // Use Tauri's os plugin to detect platform
        const { platform } = await import('@tauri-apps/plugin-os');
        const os = await platform();
        isLinuxPlatform = os === 'linux';
        console.log(`[AUDIO] Platform detected: ${os}, using ${isLinuxPlatform ? 'native' : 'HTML5'} audio`);
        return isLinuxPlatform;
    } catch (e) {
        // Fallback: check navigator.platform
        isLinuxPlatform = typeof navigator !== 'undefined' &&
            navigator.platform.toLowerCase().includes('linux');
        return isLinuxPlatform;
    }
}

export interface NativePlaybackState {
    is_playing: boolean;
    position: number;  // seconds
    duration: number;  // seconds
    volume: number;    // 0.0 to 1.0
    current_path: string;
}

export type FilterType =
    | 'peaking'
    | 'lowShelf'
    | 'highShelf'
    | 'lowPass'
    | 'highPass'
    | 'bandPass'
    | 'notch'
    | 'allPass';

export interface EqBand {
    frequency: number;
    gain: number;        // dB, -12..+12; unused by lowPass/highPass/bandPass/notch/allPass
    q: number;            // 0.1..10.0
    filter_type: FilterType;
    enabled: boolean;     // false =? band is bypassed without losing settings
}

export interface EqSettings {
    enabled: boolean;
    bands: EqBand[];
    /** output trim applied after all bands (dB). range: -24..+6 dB */
    preamp_db: number;
}

/**
 * migrate a persisted EqBand that may be missing q / filter_type / enabled fields
 * safe to call on already migrated bands
 */
export function migrateEqBand(band: Partial<EqBand>, index: number, total: number): EqBand {
    const isFirst = index === 0;
    const isLast = index === total - 1;
    return {
        frequency: band.frequency ?? 1000,
        gain: band.gain ?? 0,
        q: band.q ?? (isFirst || isLast ? 0.707 : 1.41),
        filter_type: band.filter_type ?? (isFirst ? 'lowShelf' : isLast ? 'highShelf' : 'peaking'),
        enabled: band.enabled ?? true,
    };
}

/**
 * Play an audio file using the native backend
 * @param path - Absolute path to the audio file
 * @param replayGainDb - Pre-scanned replay gain value from the database (dB).
 *                       Pass null to fall back to reading the tag from the file.
 *                       Once DB integration is complete, always pass track.replay_gain_db.
 */
export async function nativeAudioPlay(path: string, trackId: number | null = null, replayGainDb: number | null = null): Promise<void> {
    console.log('[AUDIO] Native play invoked, path:', path, 'trackId:', trackId);
    try {
        await invoke('audio_play', { path, trackId, replayGainDb });
        console.log('[AUDIO] audio_play invoke resolved');
    } catch (err) {
        console.error('[AUDIO] audio_play invoke rejected:', err);
        console.error('[AUDIO] audio_play error type:', typeof err);
        throw err;
    }
}

/**
 * Pause playback
 */
export async function nativeAudioPause(): Promise<void> {
    await invoke('audio_pause');
}

/**
 * Resume playback
 */
export async function nativeAudioResume(): Promise<void> {
    await invoke('audio_resume');
}

/**
 * Stop playback completely
 */
export async function nativeAudioStop(): Promise<void> {
    await invoke('audio_stop');
}

/**
 * Set volume (0.0 to 1.0)
 */
export async function nativeAudioSetVolume(volume: number): Promise<void> {
    await invoke('audio_set_volume', { volume });
}

/**
 * Seek to position (0.0 to 1.0 as fraction of duration)
 */
export async function nativeAudioSeek(position: number): Promise<void> {
    await invoke('audio_seek', { position });
}

/**
 * Enable or disable repeat-one mode.
 * When enabled, the backend loops the current track at EOF without firing TrackFinished.
 */
export async function nativeAudioSetRepeatOne(enabled: boolean): Promise<void> {
    await invoke('audio_set_repeat_one', { enabled });
}

// =============================================================================
// AUDIO EVENTS
// =============================================================================

export type AudioEventType =
    | { type: 'TrackFinished'; data: { generation: number } }
    | { type: 'TrackAdvanced'; data: { generation: number; new_path: string; duration: { secs: number; nanos: number } | null } }
    | { type: 'StateChanged'; data: { position: number } }
    | { type: 'DeviceListChanged'; data: { devices: DeviceList } }
    | { type: 'Error'; data: { message: string } };

/**
 * Preload the next track for gapless playback.
 * The backend will decode and buffer it so the transition is seamless.
 * @param replayGainDb — pass DB value if available, null otherwise.
 */
export async function nativeAudioPreload(path: string, trackId: number | null = null, replayGainDb: number | null = null, crossfadeSeconds: number = 0): Promise<void> {
    await invoke('audio_preload', { path, trackId, replayGainDb, crossfadeSeconds });
}

/**
 * Apply equalizer settings
 */
export async function nativeAudioSetEq(settings: EqSettings): Promise<void> {
    await invoke('audio_set_eq', { settings });
}

/**
 * enable or disable replay gain
 * when disabled, all tracks play at their original level regardless of
 * any stored or embedded replay gain values
 */
export async function nativeAudioSetReplayGainEnabled(enabled: boolean): Promise<void> {
    await invoke('audio_set_replay_gain_enabled', { enabled });
}

/**
 * enable or disable the safety limiter that sits after ReplayGain/volume/EQ
 * when disabled, audio is passed through completely untouched
 */
export async function nativeAudioSetLimiterEnabled(enabled: boolean): Promise<void> {
    await invoke('audio_set_limiter_enabled', { enabled });
}

export async function nativeAudioSetCrossfadeSeconds(seconds: number): Promise<void> {
    await invoke('audio_set_crossfade_seconds', { seconds });
}

export async function nativeAudioTriggerCrossfade(): Promise<void> {
    await invoke('audio_trigger_crossfade');
}

export interface AudioDeviceInfo {
    id: string;
    name: string;
    manufacturer: string | null;
    driver: string | null;
    device_type: string;
    interface_type: string;
    address: string | null;
    extended: string[];
    is_default: boolean;
}

export interface DeviceList {
    devices: AudioDeviceInfo[];
}

/**
 * list all available audio output devices
 * returns device names and the current system default as reported by the OS
 */
export async function nativeAudioListDevices(): Promise<DeviceList> {
    return await invoke('audio_list_output_devices');
}

/**
 * get the cached device list (no OS call)
 * use nativeAudioListDevices() when fresh re-enumeration is needed
 */
export async function nativeAudioGetDeviceInfo(): Promise<DeviceList> {
    return await invoke('audio_get_device_info');
}

/**
 * switch the audio output device
 * pass null to revert to the system default
 * the backend will rebuild the pipeline and resume playback on the new device
 */
export async function nativeAudioSetOutputDevice(deviceId: string | null): Promise<void> {
    await invoke('audio_set_output_device', { deviceId });
}

// =============================================================================
// HELPER: Check if native audio backend should be used
// =============================================================================

let nativeAudioAvailable: boolean | null = null;

/**
 * Check if native audio backend is available (compiled into the app).
 * This doesn't check user preference, just availability.
 */
export async function isNativeAudioAvailable(): Promise<boolean> {
    if (nativeAudioAvailable !== null) {
        return nativeAudioAvailable;
    }

    if (!isTauri()) {
        nativeAudioAvailable = false;
        return false;
    }

    try {
        const available = await invoke<boolean>('native_audio_available');
        nativeAudioAvailable = available;
        console.log(`[AUDIO] Native audio backend: ${available ? 'available' : 'not available'}`);
        return nativeAudioAvailable;
    } catch (e) {
        console.log('[AUDIO] Native audio backend not available');
        nativeAudioAvailable = false;
        return false;
    }
}

/**
 * Check if we should use the native audio backend.
 *
 * This considers:
 * 1. Whether native audio is available (compiled in)
 * 2. User preference from settings (auto/native/html5)
 * 3. Platform (Linux defaults to native in 'auto' mode)
 */
export async function shouldUseNativeAudio(): Promise<boolean> {
    const available = await isNativeAudioAvailable();
    if (!available) {
        return false;
    }

    // Check user preference from localStorage
    try {
        const stored = localStorage.getItem('audion_settings');
        if (stored) {
            const settings = JSON.parse(stored);
            const backend = settings.audioBackend || 'auto';

            if (backend === 'native') {
                console.log('[AUDIO] User preference: native');
                return true;
            }
            if (backend === 'html5') {
                console.log('[AUDIO] User preference: html5');
                return false;
            }
            // 'auto' falls through to platform detection
        }
    } catch (e) {
        // Ignore parse errors, use auto behavior
    }

    // Auto mode: use native on Linux and mobile platforms, HTML5 elsewhere
    try {
        const { platform } = await import('@tauri-apps/plugin-os');
        const os = await platform();
        const useNative = os === 'linux' || os === 'android' || os === 'ios';
        console.log(`[AUDIO] Auto mode: ${useNative ? `native (${os})` : 'html5'}`);
        return useNative;
    } catch {
        // Fallback to original Linux check
        const onLinux = await isLinux();
        console.log(`[AUDIO] Auto mode (fallback): ${onLinux ? 'native (Linux)' : 'html5'}`);
        return onLinux;
    }
}
