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

export interface EqBand {
    frequency: number;
    gain: number;
}

export interface EqSettings {
    enabled: boolean;
    bands: EqBand[];
}

/**
 * Play an audio file using the native backend
 * @param path - Absolute path to the audio file
 */
export async function nativeAudioPlay(path: string): Promise<void> {
    console.log('[AUDIO] Native play:', path);
    await invoke('audio_play', { path });
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
 * Get current playback state
 */
export async function nativeAudioGetState(): Promise<NativePlaybackState> {
    return await invoke('audio_get_state');
}

/**
 * Check if the current track has finished playing
 */
export async function nativeAudioIsFinished(): Promise<boolean> {
    return await invoke('audio_is_finished');
}

/**
 * Apply equalizer settings
 */
export async function nativeAudioSetEq(settings: EqSettings): Promise<void> {
    await invoke('audio_set_eq', { settings });
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

    // Auto mode: use native on Linux, HTML5 elsewhere
    const onLinux = await isLinux();
    console.log(`[AUDIO] Auto mode: ${onLinux ? 'native (Linux)' : 'html5'}`);
    return onLinux;
}
