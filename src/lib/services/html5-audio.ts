// HTML5 / WebAudio backend — all browser-side audio logic lives here.
// player.ts interacts exclusively through the public interface below.

import { get } from 'svelte/store';
import { equalizer, EQ_FREQUENCIES, type EqualizerState } from '$lib/stores/equalizer';
import { addToast } from '$lib/stores/toast';

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

export async function html5Play(path: string, volume: number, startTime = 0): Promise<void> {
    let audio = getHtml5Audio();

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

        await playWithDash(path, audio);
    } else {
        // Resolve playlist-format URLs (.m3u, .pls, .m3u8) to direct stream URLs
        const resolvedPath = await resolvePlaylistUrl(path);
        audio = await prepareHtml5AudioForPath(audio, resolvedPath);

        audio.src = resolvedPath;
        audio.volume = volume;

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

        if (startTime > 0) {
            audio.currentTime = startTime;
        }
    }
}

export function html5Pause(): void {
    getHtml5Audio().pause();
}

export async function html5Resume(): Promise<void> {
    await resumeHtml5AudioContext();
    await getHtml5Audio().play();
}

export function html5Stop(): void {
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
    if (html5Audio) {
        html5Audio.pause();
        html5Audio.src = '';
    }
    if (dashPlayer) {
        try { dashPlayer.destroy(); } catch (_) { }
        dashPlayer = null;
    }
    cleanupHtml5EqGraph();
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
let lastEqBypassWarningHost: string | null = null;

// dash.js player instance for Hi-Res DASH/MPD streaming
let dashPlayer: any | null = null;

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

    if (!(window as any).dashjs) {
        await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.all.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load dash.js'));
            document.head.appendChild(script);
        });
    }

    return (window as any).dashjs;
}

async function playWithDash(blobUrl: string, audioElement: HTMLAudioElement): Promise<void> {
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
    setupHtml5AudioListeners(html5Audio);
    return html5Audio;
}

function setupHtml5AudioListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('ended', () => {
        registeredCallbacks?.onEnded();
    });

    audio.addEventListener('error', () => {
        console.error('[Html5Audio] Audio error:', audio.error);
        registeredCallbacks?.onError(audio.error?.message || 'Unknown error');
    });

    audio.addEventListener('play', () => {
        registeredCallbacks?.onPlayStateChange(true);
    });

    audio.addEventListener('pause', () => {
        registeredCallbacks?.onPlayStateChange(false);
    });

    // Push duration as soon as the browser parses it — poller alone would lag up to 50ms
    audio.addEventListener('durationchange', () => {
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

    // Cross-origin streams often block WebAudio processing without CORS headers.
    try {
        const url = new URL(path);
        return url.origin === window.location.origin;
    } catch {
        return false;
    }
}

async function prepareHtml5AudioForPath(audio: HTMLAudioElement, path: string): Promise<HTMLAudioElement> {
    const eqEnabled = get(equalizer).enabled;
    const canUseEq = canUseHtml5EqForPath(path);

    if (eqEnabled && canUseEq) {
        if (classifyAudioPath(path) === 'stream') {
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

        if (html5EqFilters.length === 0) {
            html5EqFilters = EQ_FREQUENCIES.map((freq) => {
                const filter = ctx.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.41;
                filter.gain.value = 0;
                return filter;
            });
        }

        try { html5AudioSourceNode.disconnect(); } catch (_) { }
        html5EqFilters.forEach((filter) => {
            try { filter.disconnect(); } catch (_) { }
        });
        try { html5EqGainNode.disconnect(); } catch (_) { }

        html5AudioSourceNode.connect(html5EqFilters[0]);
        for (let i = 0; i < html5EqFilters.length - 1; i++) {
            html5EqFilters[i].connect(html5EqFilters[i + 1]);
        }
        html5EqFilters[html5EqFilters.length - 1].connect(html5EqGainNode);
        html5EqGainNode.connect(ctx.destination);

        applyHtml5EqState(get(equalizer));
    } catch (err) {
        console.error('[Html5Audio] Failed to initialize EQ graph:', err);
        html5AudioSourceNode = null;
        html5EqFilters = [];
        html5EqGainNode = null;
    }
}

function applyHtml5EqState(state: EqualizerState): void {
    if (!html5AudioContext || html5EqFilters.length === 0) return;

    const now = html5AudioContext.currentTime;
    for (let i = 0; i < html5EqFilters.length; i++) {
        const gain = state.enabled ? (state.bands[i]?.gain ?? 0) : 0;
        html5EqFilters[i].gain.cancelScheduledValues(now);
        html5EqFilters[i].gain.setTargetAtTime(gain, now, 0.01);
    }
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