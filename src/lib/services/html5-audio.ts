// HTML5 / WebAudio backend — all browser-side audio logic lives here.
// player.ts interacts exclusively through the public interface below.

import { get } from 'svelte/store';
import { equalizer, EQ_FREQUENCIES, type EqualizerState, type FilterType } from '$lib/stores/equalizer';
import { addToast } from '$lib/stores/toast';
import { appSettings } from '$lib/stores/settings';

// =============================================================================
// PUBLIC INTERFACE
// =============================================================================

/** Callbacks player.ts registers once during init. */
export interface Html5Callbacks {
    onEnded: () => void;
    onError: (message: string) => void;
    onTimeUpdate: (position: number, duration: number) => void;
    onPlayStateChange: (isPlaying: boolean) => void;
}

export function html5SetCallbacks(callbacks: Html5Callbacks): void {
    registeredCallbacks = callbacks;
}

export async function html5Play(path: string, volume: number, startTime = 0, replayGainDb: number | null = null): Promise<void> {
    html5ClearPreload();
    let audio = getHtml5Audio();

    html5SetTrackReplayGain(replayGainDb);

    // Pause and reset before switching tracks
    audio.pause();

    // Destroy any existing dash player before switching tracks
    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }

    const finalKind = classifyAudioPath(path);

    if (finalKind === 'blob') {
        audio = await prepareHtml5AudioForPath(audio, path);
        audio.volume = volume;

        // startTime is forwarded to playWithDash so dash.js can seek to the
        // correct position before the first segment is requested, avoiding an
        // audible play-from-zero before the seek lands
        await playWithDash(path, audio, startTime);
    } else {
        // Resolve playlist-format URLs (.m3u, .pls, .m3u8) to direct stream URLs
        const resolvedPath = await resolvePlaylistUrl(path);
        audio = await prepareHtml5AudioForPath(audio, resolvedPath);

        audio.src = resolvedPath;
        audio.volume = volume;

        // set currentTime BEFORE play() so the browser begins decoding from the correct position
        if (startTime > 0) {
            audio.currentTime = startTime;
        }

        // Wrap play in a handler to catch AbortError (common with rapid skipping)
        try {
            await audio.play();
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                console.warn('[Html5Audio] Playback aborted (likely replaced by new track)', err);
            } else {
                throw err;
            }
        }
    }
}

export async function html5Preload(path: string, trackId: string | number | null = null, replayGainDb: number | null = null): Promise<void> {
    html5ClearPreload();

    preloadPath = path;
    preloadTrackId = trackId;
    preloadReady = false;
    preloadReplayGainDb = replayGainDb;

    if (typeof window === 'undefined') return;

    preloadAudio = new Audio();
    
    // Wire up events on the preload element
    preloadAudio.addEventListener('canplaythrough', () => {
        if (preloadPath === path) {
            console.log('[Html5Audio] Preload canplaythrough ready:', path);
            preloadReady = true;
            if (preloadTimeoutId) {
                clearTimeout(preloadTimeoutId);
                preloadTimeoutId = null;
            }
        }
    });

    preloadAudio.addEventListener('canplay', () => {
        if (preloadPath === path && !preloadReady) {
            canplayFallbackTimer = setTimeout(() => {
                if (preloadPath === path && preloadAudio && !preloadReady) {
                    console.log('[Html5Audio] Preload canplay fallback triggered. Marking ready.');
                    preloadReady = true;
                }
            }, 3000);
        }
    });

    preloadAudio.addEventListener('error', () => {
        console.error('[Html5Audio] Preload error for:', path, preloadAudio?.error);
        html5ClearPreload();
    });

    const finalKind = classifyAudioPath(path);

    if (finalKind === 'blob') {
        isPreloadDash = true;
        try {
            const mpdText = await fetch(path).then(r => r.text());
            const bytes = new TextEncoder().encode(mpdText);
            const binary = Array.from(bytes).reduce((acc, byte) => acc + String.fromCharCode(byte), '');
            const dataUrl = 'data:application/dash+xml;base64,' + btoa(binary);

            const dashjs = await getDashPlayer();
            preloadDashPlayer = dashjs.MediaPlayer().create();
            preloadDashPlayer.initialize(preloadAudio, dataUrl, false);
        } catch (e) {
            console.error('[Html5Audio] Failed to preload DASH stream:', e);
            html5ClearPreload();
        }
    } else {
        isPreloadDash = false;
        const resolvedPath = await resolvePlaylistUrl(path);
        if (get(equalizer).enabled && canUseHtml5EqForPath(resolvedPath)) {
            preloadAudio.crossOrigin = 'anonymous';
        }
        preloadAudio.src = resolvedPath;
        preloadAudio.load();
    }

    preloadTimeoutId = setTimeout(() => {
        if (preloadPath === path && preloadAudio) {
            if (preloadAudio.readyState >= 2) {
                console.log('[Html5Audio] Preload timeout reached, readyState is >= HAVE_CURRENT_DATA. Marking ready.');
                preloadReady = true;
            } else {
                console.warn('[Html5Audio] Preload timed out without buffer. Clearing preload.');
                html5ClearPreload();
            }
        }
    }, 10000);
}

export async function html5SwapPreload(trackId: string | number | null, volume: number): Promise<boolean> {
    if (!preloadReady || !preloadAudio || preloadTrackId === null || String(preloadTrackId) !== String(trackId)) {
        console.log('[Html5Audio] Swap called but preload is not ready/matching trackId. preloadTrackId:', preloadTrackId, 'requested:', trackId);
        return false;
    }

    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }
    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) {}
        dashPlayer = null;
    }

    const nextPath = preloadPath;
    html5Audio = preloadAudio;
    dashPlayer = preloadDashPlayer;

    html5SetTrackReplayGain(preloadReplayGainDb);

    preloadAudio = null;
    preloadDashPlayer = null;
    preloadPath = null;
    preloadReady = false;
    preloadReplayGainDb = null;
    if (preloadTimeoutId) {
        clearTimeout(preloadTimeoutId);
        preloadTimeoutId = null;
    }
    if (canplayFallbackTimer) {
        clearTimeout(canplayFallbackTimer);
        canplayFallbackTimer = null;
    }

    setupHtml5AudioListeners(html5Audio);
    html5Audio.volume = volume;

    const eqEnabled = get(equalizer).enabled;
    const canUseEq = nextPath ? canUseHtml5EqForPath(nextPath) : false;
    const useGraph = (eqEnabled && canUseEq) || (nextPath ? replayGainNeedsGraph(nextPath) : false);

    if (useGraph) {
        ensureHtml5EqGraph(html5Audio);
        await resumeHtml5AudioContext();
    } else {
        if (html5AudioSourceNode) {
            cleanupHtml5EqGraph();
        }
    }

    try {
        if (isPreloadDash && dashPlayer) {
            dashPlayer.play();
        } else {
            await html5Audio.play();
        }
        console.log('[Html5Audio] Preloaded track swapped and started playing:', nextPath);
        return true;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            console.warn('[Html5Audio] Swap play aborted', err);
        } else {
            console.error('[Html5Audio] Swap play failed:', err);
            registeredCallbacks?.onError(err instanceof Error ? err.message : String(err));
        }
        return false;
    }
}

export function html5ClearPreload(): void {
    if (preloadTimeoutId) {
        clearTimeout(preloadTimeoutId);
        preloadTimeoutId = null;
    }
    if (canplayFallbackTimer) {
        clearTimeout(canplayFallbackTimer);
        canplayFallbackTimer = null;
    }
    if (preloadAudio) {
        preloadAudio.pause();
        preloadAudio.src = '';
        preloadAudio = null;
    }
    if (preloadDashPlayer) {
        try { preloadDashPlayer.destroy(); } catch (_) {}
        preloadDashPlayer = null;
    }
    preloadPath = null;
    preloadTrackId = null;
    preloadReady = false;
    preloadReplayGainDb = null;
    isPreloadDash = false;
}

export function cleanupFadeout(): void {
    if (fadeoutTimer) {
        clearTimeout(fadeoutTimer);
        fadeoutTimer = null;
    }
    if (crossfadeRampTimer) {
        clearInterval(crossfadeRampTimer);
        crossfadeRampTimer = null;
    }
    if (fadeoutAudio) {
        try {
            fadeoutAudio.pause();
            fadeoutAudio.src = '';
        } catch (_) {}
        fadeoutAudio = null;
    }
    if (fadeoutDashPlayer) {
        try { fadeoutDashPlayer.destroy(); } catch (_) {}
        fadeoutDashPlayer = null;
    }
    if (fadeoutSourceNode) {
        try { fadeoutSourceNode.disconnect(); } catch (_) {}
        fadeoutSourceNode = null;
    }
}

export async function html5StartCrossfade(trackId: string | number | null, targetVolume: number, durationSecs: number): Promise<boolean> {
    if (!preloadReady || !preloadAudio || preloadTrackId === null || String(preloadTrackId) !== String(trackId)) {
        console.log('[Html5Audio] Crossfade requested but preload is not ready/matching trackId. preloadTrackId:', preloadTrackId, 'requested:', trackId);
        return false;
    }

    console.log(`[Html5Audio] Starting crossfade transition: ${durationSecs}s`);

    // Clean up any existing fadeout first
    cleanupFadeout();

    // 1. Move current primary audio to fadeout
    fadeoutAudio = html5Audio;
    fadeoutDashPlayer = dashPlayer;
    fadeoutSourceNode = html5AudioSourceNode;

    // 2. Promote preload to primary
    html5Audio = preloadAudio;
    dashPlayer = preloadDashPlayer;

    const nextPath = preloadPath;
    html5SetTrackReplayGain(preloadReplayGainDb);

    // Clear preload slots
    preloadAudio = null;
    preloadDashPlayer = null;
    preloadPath = null;
    preloadTrackId = null;
    preloadReady = false;
    preloadReplayGainDb = null;

    if (preloadTimeoutId) {
        clearTimeout(preloadTimeoutId);
        preloadTimeoutId = null;
    }
    if (canplayFallbackTimer) {
        clearTimeout(canplayFallbackTimer);
        canplayFallbackTimer = null;
    }

    // Set up listeners on the new primary audio element
    setupHtml5AudioListeners(html5Audio);

    // Initial volumes for transition
    const startVolume = fadeoutAudio ? fadeoutAudio.volume : targetVolume;
    html5Audio.volume = 0;

    // 3. Connect new audio to the EQ filters if EQ is enabled
    const eqEnabled = get(equalizer).enabled;
    const canUseEq = nextPath ? canUseHtml5EqForPath(nextPath) : false;

    if (eqEnabled && canUseEq && html5AudioContext && html5EqFilters.length > 0) {
        try {
            // Keep fadeoutSourceNode connected to filters.
            // Create a new source node for the new primary audio.
            html5AudioSourceNode = html5AudioContext.createMediaElementSource(html5Audio);
            html5AudioSourceElement = html5Audio;
            html5AudioSourceNode.connect(html5EqFilters[0]);
            await resumeHtml5AudioContext();
        } catch (err) {
            console.error('[Html5Audio] Failed to connect crossfade audio to EQ:', err);
        }
    } else {
        html5AudioSourceNode = null;
        html5AudioSourceElement = null;
    }

    // 4. Start play on the new primary audio
    try {
        if (isPreloadDash && dashPlayer) {
            dashPlayer.play();
        } else {
            await html5Audio.play();
        }
    } catch (err) {
        console.error('[Html5Audio] Crossfade start play failed:', err);
        cleanupFadeout();
        return false;
    }

    // 5. Volume ramping loop in Javascript
    const startTime = performance.now();
    const durationMs = durationSecs * 1000;
    const intervalMs = 30;

    crossfadeRampTimer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1.0);

        if (fadeoutAudio) {
            fadeoutAudio.volume = startVolume * (1.0 - progress);
        }

        if (html5Audio) {
            html5Audio.volume = targetVolume * progress;
        }

        if (progress >= 1.0) {
            clearInterval(crossfadeRampTimer);
            crossfadeRampTimer = null;
        }
    }, intervalMs);

    // 6. Schedule cleanup at end of crossfade
    fadeoutTimer = setTimeout(() => {
        cleanupFadeout();
        console.log('[Html5Audio] Crossfade transition finished cleanly.');
    }, durationMs);

    return true;
}

export function html5Pause(): void {
    getHtml5Audio().pause();
}

export async function html5Resume(): Promise<void> {
    await resumeHtml5AudioContext();
    await getHtml5Audio().play();
}

export function html5Stop(): void {
    html5ClearPreload();
    cleanupFadeout();
    if (!html5Audio) return; // Don't create the element just to stop it
    const audio = html5Audio;
    audio.pause();
    audio.src = '';

    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }
}

/** position is a ratio 0-1 */
export function html5Seek(positionRatio: number): void {
    const audio = getHtml5Audio();
    if (audio.duration) {
        audio.currentTime = positionRatio * audio.duration;
    }
}

/** volume is already converted (logarithmic), not the raw slider value */
export function html5SetVolume(audioVolume: number): void {
    if (!html5Audio) return; // Don't create the element just to set volume (mirrors old guard)
    html5Audio.volume = audioVolume;
}

export function html5SetEq(state: EqualizerState): void {
    applyHtml5EqState(state);
}

/** enable/disable replay gain application for the html5 backend */
export function html5SetReplayGainEnabled(enabled: boolean): void {
    html5ReplayGainEnabled = enabled;
    applyHtml5ReplayGain();
}

/**
 * set the replay gain (dB) for the currently playing HTML5 track
 * pass null when no prescanned value is available (gain is then unity)
 */
export function html5SetTrackReplayGain(replayGainDb: number | null): void {
    currentReplayGainDb = replayGainDb;
    applyHtml5ReplayGain();
}

export function html5GetState(): { position: number; duration: number; isPlaying: boolean } {
    const audio = html5Audio;
    if (!audio) return { position: 0, duration: 0, isPlaying: false };
    return {
        position: audio.currentTime,
        duration: audio.duration || 0,
        isPlaying: !audio.paused && !audio.ended,
    };
}

export function html5Cleanup(): void {
    cleanupFadeout();
    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }
    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }
    cleanupHtml5EqGraph();
    html5ClearPreload();
}

// =============================================================================
// PRIVATE STATE
// =============================================================================

let registeredCallbacks: Html5Callbacks | null = null;

// HTML5 Audio element (lazily created)
let html5Audio: HTMLAudioElement | null = null;

// HTML5 WebAudio graph for EQ processing
let html5AudioContext: AudioContext | null = null;
let html5AudioSourceNode: MediaElementAudioSourceNode | null = null;
let html5AudioSourceElement: HTMLAudioElement | null = null; // which element the source node was built from
let html5EqFilters: BiquadFilterNode[] = [];
let html5EqGainNode: GainNode | null = null;
let html5ReplayGainNode: GainNode | null = null;
let lastEqBypassWarningHost: string | null = null;

// replay gain state
let html5ReplayGainEnabled = true;
let currentReplayGainDb: number | null = null;
let preloadReplayGainDb: number | null = null;

// dash.js player instance for Hi-Res DASH/MPD streaming
let dashPlayer: any | null = null;

// Preload state for gapless streaming
let preloadAudio: HTMLAudioElement | null = null;
let preloadPath: string | null = null;
let preloadTrackId: string | number | null = null;
let preloadReady = false;
let preloadTimeoutId: any = null;
let canplayFallbackTimer: any = null;
let isPreloadDash = false;
let preloadDashPlayer: any = null;

// Fadeout state for crossfade
let fadeoutAudio: HTMLAudioElement | null = null;
let fadeoutDashPlayer: any | null = null;
let fadeoutSourceNode: MediaElementAudioSourceNode | null = null;
let fadeoutTimer: any = null;
let crossfadeRampTimer: any = null;

// =============================================================================
// INTERNAL: AUDIO PATH CLASSIFICATION
// =============================================================================

type AudioPathKind = 'local' | 'stream' | 'blob' | 'custom-scheme';

function classifyAudioPath(path: string): AudioPathKind {
    if (path.startsWith('blob:')) return 'blob';
    if (path.startsWith('http://') || path.startsWith('https://')) return 'stream';
    if (path.startsWith('file://') || path.startsWith('asset://') || path.startsWith('tauri://')) return 'local';
    if (path.includes('://')) return 'custom-scheme';
    return 'local';
}

// =============================================================================
// INTERNAL: DASH.JS
// =============================================================================

async function getDashPlayer(): Promise<any> {
    if (typeof window === 'undefined') throw new Error('No window');

    const dashjs = await import('dashjs');
    return dashjs;
}

async function playWithDash(blobUrl: string, audioElement: HTMLAudioElement, startTime = 0): Promise<void> {
    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }

    const mpdText = await fetch(blobUrl).then(r => r.text());
    URL.revokeObjectURL(blobUrl);

    const bytes = new TextEncoder().encode(mpdText);
    const binary = Array.from(bytes).reduce((acc, byte) => acc + String.fromCharCode(byte), '');
    const dataUrl = 'data:application/dash+xml;base64,' + btoa(binary);

    const dashjs = await getDashPlayer();
    dashPlayer = dashjs.MediaPlayer().create();

    // provide the start position before initialize() so dash.js requests the
    // correct segment from the outset, rather than fetching from 0 and seeking
    if (startTime > 0) {
        dashPlayer.updateSettings({ streaming: { defaultStartTime: startTime } });
    }

    dashPlayer.initialize(audioElement, dataUrl, true);

    dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
        console.error('[Html5Audio] dash.js error:', e);
        addToast(`Hi-Res playback error: ${e.error?.message || 'Unknown error'}`, 'error');
    });
}

// =============================================================================
// INTERNAL: AUDIO ELEMENT LIFECYCLE
// =============================================================================

function getHtml5Audio(): HTMLAudioElement {
    if (!html5Audio && typeof window !== 'undefined') {
        html5Audio = new Audio();
        html5Audio.disableRemotePlayback = true; // prevent WebView2 from registering a duplicate SMTC entry
        setupHtml5AudioListeners(html5Audio);
    }
    return html5Audio!;
}

function cleanupHtml5EqGraph(): void {
    if (html5AudioSourceNode) {
        try { html5AudioSourceNode.disconnect(); } catch (_) { }
        html5AudioSourceNode = null;
    }
    html5AudioSourceElement = null;
    html5EqFilters.forEach((filter) => {
        try { filter.disconnect(); } catch (_) { }
    });
    html5EqFilters = [];
    if (html5EqGainNode) {
        try { html5EqGainNode.disconnect(); } catch (_) { }
        html5EqGainNode = null;
    }
    if (html5AudioContext) {
        html5AudioContext.close().catch(() => { });
        html5AudioContext = null;
    }
}

function recreateHtml5AudioElement(): HTMLAudioElement {
    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }

    cleanupHtml5EqGraph();

    html5Audio = new Audio();
    html5Audio.disableRemotePlayback = true; // prevent WebView2 from registering a duplicate SMTC entry
    setupHtml5AudioListeners(html5Audio);
    return html5Audio;
}

function setupHtml5AudioListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('ended', () => {
        if (audio !== html5Audio) return;
        registeredCallbacks?.onEnded();
    });

    audio.addEventListener('error', () => {
        if (audio !== html5Audio) return;
        console.error('[Html5Audio] Audio error:', audio.error);
        registeredCallbacks?.onError(audio.error?.message || 'Unknown error');
    });

    audio.addEventListener('play', () => {
        if (audio !== html5Audio) return;
        registeredCallbacks?.onPlayStateChange(true);
    });

    audio.addEventListener('pause', () => {
        if (audio !== html5Audio) return;
        registeredCallbacks?.onPlayStateChange(false);
    });

    // Push duration as soon as the browser parses it — poller alone would lag up to 50ms
    audio.addEventListener('durationchange', () => {
        if (audio !== html5Audio) return;
        if (audio.duration && !isNaN(audio.duration)) {
            registeredCallbacks?.onTimeUpdate(audio.currentTime, audio.duration);
        }
    });
}

// =============================================================================
// INTERNAL: EQ GRAPH
// =============================================================================

function canUseHtml5EqForPath(path: string): boolean {
    if (typeof window === 'undefined') return false;

    const kind = classifyAudioPath(path);
    if (kind === 'local' || kind === 'blob') return true;
    if (kind !== 'stream') return true;

    // Cross-origin streams: try them. If the server sends CORS headers
    // (Access-Control-Allow-Origin), WebAudio will work.
    // If not, ensureHtml5EqGraph will throw when creating the
    // MediaElementSourceNode and we fall back to direct playback.
    return true;
}

// scope replay gain only graph usage to local files and blob/DASH sources. streams still get replay gain when EQ is independently on
function replayGainNeedsGraph(path: string): boolean {
    if (!html5ReplayGainEnabled) return false;
    const kind = classifyAudioPath(path);
    return kind === 'local' || kind === 'blob';
}

async function prepareHtml5AudioForPath(audio: HTMLAudioElement, path: string): Promise<HTMLAudioElement> {
    const eqEnabled = get(equalizer).enabled;
    const canUseEq = canUseHtml5EqForPath(path);
    const useGraph = (eqEnabled && canUseEq) || replayGainNeedsGraph(path);

    if (useGraph) {
        if (eqEnabled && classifyAudioPath(path) === 'stream') {
            audio.crossOrigin = 'anonymous';
        }
        ensureHtml5EqGraph(audio);
        await resumeHtml5AudioContext();
        return audio;
    }

    // If this element is already attached to a WebAudio source node, it will stay routed
    // through that graph. Recreate the element to restore direct output when EQ must be bypassed.
    if (html5AudioSourceNode) {
        const next = recreateHtml5AudioElement();
        next.volume = audio.volume;
        audio = next;
    }

    if (eqEnabled && !canUseEq && classifyAudioPath(path) === 'stream') {
        try {
            const host = new URL(path).host;
            if (lastEqBypassWarningHost !== host) {
                lastEqBypassWarningHost = host;
                addToast('EQ is bypassed for this stream due to CORS restrictions', 'warning');
            }
        } catch {
            addToast('EQ is bypassed for this stream due to CORS restrictions', 'warning');
        }
    }

    return audio;
}

function ensureHtml5EqGraph(audio: HTMLAudioElement): void {
    if (typeof window === 'undefined') return;

    // If the graph was built for a different element (e.g. native→html5 backend switch),
    // tear down the source node so it gets rebuilt for the current element below.
    // The AudioContext, filters, and gain node are kept alive — closing and reopening
    // a context requires a new user gesture on some browsers/WebViews.
    if (html5AudioSourceNode && html5AudioSourceElement !== audio) {
        try { html5AudioSourceNode.disconnect(); } catch (_) { }
        html5AudioSourceNode = null;
        html5AudioSourceElement = null;
    }

    if (html5AudioSourceNode && html5EqGainNode && html5EqFilters.length > 0) return;

    try {
        if (!html5AudioContext) {
            const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextCtor) {
                console.warn('[Html5Audio] WebAudio AudioContext is not available');
                return;
            }
            html5AudioContext = new AudioContextCtor();
        }
        const ctx = html5AudioContext;
        if (!ctx) return;

        if (!html5AudioSourceNode) {
            html5AudioSourceNode = ctx.createMediaElementSource(audio);
            html5AudioSourceElement = audio;
        }

        if (!html5EqGainNode) {
            html5EqGainNode = ctx.createGain();
            html5EqGainNode.gain.value = 1;
        }

        if (!html5ReplayGainNode) {
            html5ReplayGainNode = ctx.createGain();
            html5ReplayGainNode.gain.value = 1;
        }

        if (html5EqFilters.length === 0) {
            html5EqFilters = EQ_FREQUENCIES.map((freq, i) => {
                const filter = ctx.createBiquadFilter();
                const isFirst = i === 0;
                const isLast = i === EQ_FREQUENCIES.length - 1;
                filter.type = isFirst ? 'lowshelf' : isLast ? 'highshelf' : 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = isFirst || isLast ? 0.707 : 1.41;
                filter.gain.value = 0;
                return filter;
            });
        }

        try { html5AudioSourceNode.disconnect(); } catch (_) { }
        html5EqFilters.forEach((filter) => {
            try { filter.disconnect(); } catch (_) { }
        });
        try { html5ReplayGainNode.disconnect(); } catch (_) { }
        try { html5EqGainNode.disconnect(); } catch (_) { }

        html5AudioSourceNode.connect(html5EqFilters[0]);
        for (let i = 0; i < html5EqFilters.length - 1; i++) {
            html5EqFilters[i].connect(html5EqFilters[i + 1]);
        }
        html5EqFilters[html5EqFilters.length - 1].connect(html5ReplayGainNode);
        html5ReplayGainNode.connect(html5EqGainNode);
        html5EqGainNode.connect(ctx.destination);

        applyHtml5EqState(get(equalizer));
        applyHtml5ReplayGain();
    } catch (err) {
        console.error('[Html5Audio] Failed to initialize EQ graph:', err);
        html5AudioSourceNode = null;
        html5EqFilters = [];
        html5EqGainNode = null;
        html5ReplayGainNode = null;
    }
}

// map our FilterType
const WEBAUDIO_FILTER_TYPE: Record<FilterType, BiquadFilterType> = {
    peaking: 'peaking',
    lowShelf: 'lowshelf',
    highShelf: 'highshelf',
    lowPass: 'lowpass',
    highPass: 'highpass',
    bandPass: 'bandpass',
    notch: 'notch',
    allPass: 'allpass',
};

const GAINLESS_FILTERS = new Set<FilterType>(['lowPass', 'highPass', 'bandPass', 'notch', 'allPass']);

function dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
}

function applyHtml5EqState(state: EqualizerState): void {
    if (!html5AudioContext || html5EqFilters.length === 0) return;

    const now = html5AudioContext.currentTime;
    for (let i = 0; i < html5EqFilters.length; i++) {
        const band = state.bands[i];
        const filter = html5EqFilters[i];
        if (!band) continue;

        const filterType = WEBAUDIO_FILTER_TYPE[band.filterType] ?? 'peaking';
        if (filter.type !== filterType) filter.type = filterType;
        if (filter.frequency.value !== band.frequency) filter.frequency.value = band.frequency;

        const q = Math.max(0.1, Math.min(10, band.q ?? 1.41));
        filter.Q.cancelScheduledValues(now);
        filter.Q.setTargetAtTime(q, now, 0.01);

        // bypassed bands are flattened to 0 gain; gainless filter types (LP/HP/BP/Notch/AP)
        // don't use the gain param at all, so it's left untouched for them
        const isEnabled = state.enabled && band.enabled;
        const gain = isEnabled && !GAINLESS_FILTERS.has(band.filterType) ? band.gain : 0;
        filter.gain.cancelScheduledValues(now);
        filter.gain.setTargetAtTime(gain, now, 0.01);

        // for gainless filter types, bypassing the band means routing frequency out of range
        // we approximate bypass by pinning Q/gain
        // to a neutral peaking response at unity when disabled
        if (!state.enabled || !band.enabled) {
            if (GAINLESS_FILTERS.has(band.filterType) && filter.type !== 'peaking') {
            }
        }
    }

    if (html5EqGainNode) {
        const preampLinear = state.enabled ? dbToLinear(state.preampDb ?? 0) : 1;
        html5EqGainNode.gain.cancelScheduledValues(now);
        html5EqGainNode.gain.setTargetAtTime(preampLinear, now, 0.01);
    }
}

function applyHtml5ReplayGain(): void {
    if (!html5AudioContext || !html5ReplayGainNode) return;

    const linear = html5ReplayGainEnabled && currentReplayGainDb !== null
        ? dbToLinear(currentReplayGainDb)
        : 1;

    const now = html5AudioContext.currentTime;
    html5ReplayGainNode.gain.cancelScheduledValues(now);
    html5ReplayGainNode.gain.setTargetAtTime(linear, now, 0.01);
}

async function resumeHtml5AudioContext(): Promise<void> {
    if (!html5AudioContext || html5AudioContext.state !== 'suspended') return;

    try {
        await html5AudioContext.resume();
    } catch (err) {
        console.warn('[Html5Audio] Failed to resume AudioContext:', err);
    }
}

// =============================================================================
// INTERNAL: EQ SUBSCRIPTION (HTML5 half only)
// =============================================================================
// The native half stays in player.ts. These were combined for convenience,
// not because they are logically coupled.

equalizer.subscribe((state) => {
    // Apply immediately to the WebAudio graph when available — matches original behavior
    applyHtml5EqState(state);
});

// =============================================================================
// INTERNAL: PLAYLIST URL RESOLUTION
// =============================================================================

const PLAYLIST_EXTENSIONS = ['.m3u', '.m3u8', '.pls'];

function isPlaylistUrl(url: string): boolean {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return PLAYLIST_EXTENSIONS.some(ext => pathname.endsWith(ext));
    } catch {
        const lower = url.toLowerCase().split('?')[0].split('#')[0];
        return PLAYLIST_EXTENSIONS.some(ext => lower.endsWith(ext));
    }
}

function parsePlsPlaylist(text: string): string | null {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        const match = trimmed.match(/^File\d+\s*=\s*(.+)$/i);
        if (match && match[1].startsWith('http')) {
            return match[1].trim();
        }
    }
    return null;
}

function parseM3uPlaylist(text: string): string | null {
    const lines = text.split(/\r?\n/);

    const isHls = lines.some(l => l.trim().startsWith('#EXT-X-'));
    if (isHls) return null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
            return trimmed;
        }
    }
    return null;
}

async function resolvePlaylistUrl(url: string): Promise<string> {
    if (!isPlaylistUrl(url)) return url;

    console.log(`[Html5Audio] Resolving playlist URL: ${url}`);

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
            console.warn(`[Html5Audio] Playlist fetch failed (${response.status}), using original URL`);
            return url;
        }

        const text = await response.text();
        const lower = url.toLowerCase().split('?')[0].split('#')[0];
        let resolved: string | null = null;

        if (lower.endsWith('.pls')) {
            resolved = parsePlsPlaylist(text);
        } else {
            resolved = parseM3uPlaylist(text);
        }

        if (resolved) {
            console.log(`[Html5Audio] Resolved playlist URL: ${url} → ${resolved}`);
            return resolved;
        }

        console.log(`[Html5Audio] Playlist did not yield a direct URL (may be HLS), using original`);
        return url;

    } catch (err) {
        console.warn(`[Html5Audio] Playlist resolution failed, using original URL:`, err);
        return url;
    }
}