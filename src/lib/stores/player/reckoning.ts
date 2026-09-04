// Dead-reckoning position engine (native backend) and HTML5 RAF ticker.
import { get } from 'svelte/store';
import { currentTime, duration, isPlaying, activeBackend, pluginEvents } from './stores';
import { appSettings } from '$lib/stores/settings';

// =============================================================================
// DEAD-RECKONING STATE (native backend only)
// position is computed locally between backend events using:
//   currentTime = _reckoningOffset + (now - _reckoningStartedAt) / 1000
// =============================================================================

let _reckoningOffset: number = 0;
let _reckoningStartedAt: number = 0;
let _reckoningActive: boolean = false;
let _reckoningRafId: number | null = null;

// Crossfade flags
// HTML5 backend owns the "already tried a crossfade for this track" guard locally
// see _html5Tick below
// native does not needs either flag: 
// AudioEngine::maybe_auto_crossfade decides timing itself from real decoded sample position, on its own periodic tick
export let _hasCrossfaded = false;
export function resetCrossfadeFlags(): void {
    _hasCrossfaded = false;
}
/**
 * the actual reset function => call this, never assign to the exported _hasCrossfaded
 */
export function resetHasCrossfaded(): void {
    _hasCrossfaded = false;
}

export function _startReckoning(offsetSecs: number): void {
    _reckoningOffset = offsetSecs;
    _reckoningStartedAt = performance.now();
    _reckoningActive = true;
    if (_reckoningRafId === null) {
        _reckoningRafId = requestAnimationFrame(_reckoningTick);
    }
}

export function _stopReckoning(snapshotSecs?: number): void {
    _reckoningActive = false;
    if (_reckoningRafId !== null) {
        cancelAnimationFrame(_reckoningRafId);
        _reckoningRafId = null;
    }
    if (snapshotSecs !== undefined) {
        _reckoningOffset = snapshotSecs;
        currentTime.set(snapshotSecs);
    }
}

export function _correctReckoning(confirmedSecs: number): void {
    // snap the baseline to the backend-confirmed position if the drift exceeds 1 second
    const estimated = _reckoningOffset + (performance.now() - _reckoningStartedAt) / 1000;
    const drift = Math.abs(estimated - confirmedSecs);
    _reckoningOffset = confirmedSecs;
    _reckoningStartedAt = performance.now();
    if (drift > 1.0) {
        currentTime.set(confirmedSecs);
    }
}

// Lazy import to avoid circular dep: reckoning.ts -> playback.ts -> reckoning.ts
// native does not have a crossfade-threshold callback
// see the note by _hasCrossfaded above
// HTML5 only

function _reckoningTick(): void {
    if (!_reckoningActive) {
        _reckoningRafId = null;
        return;
    }
    const elapsed = (performance.now() - _reckoningStartedAt) / 1000;
    const position = _reckoningOffset + elapsed;
    const dur = get(duration);

    // clamp to duration
    currentTime.set(dur > 0 ? Math.min(position, dur) : position);

    pluginEvents.emit('timeUpdate', { currentTime: position, duration: dur });

    if (get(isPlaying)) {
        _onPositionUpdate?.();
    }

    // the decision lives in AudioEngine::maybe_auto_crossfade
    // driven by real sample position on its own periodic tick
    // this loop is purely a position display for the native backend

    _reckoningRafId = requestAnimationFrame(_reckoningTick);
}

// =============================================================================
// HTML5 POSITION TICKER
// =============================================================================
import {
    html5GetState,
} from '$lib/services/html5-audio';

let _html5RafId: number | null = null;
let _onHtml5CrossfadeThreshold: (() => void) | null = null;
export function registerHtml5CrossfadeCallback(cb: () => void): void {
    _onHtml5CrossfadeThreshold = cb;
}

// Slot for media-session position update
let _onPositionUpdate: (() => void) | null = null;
export function registerPositionUpdateCallback(cb: () => void): void {
    _onPositionUpdate = cb;
}

export function _startHtml5Ticker(): void {
    if (_html5RafId !== null) return;
    _html5RafId = requestAnimationFrame(_html5Tick);
}

export function _stopHtml5Ticker(): void {
    if (_html5RafId !== null) {
        cancelAnimationFrame(_html5RafId);
        _html5RafId = null;
    }
}

function _html5Tick(): void {
    if (!get(isPlaying) || get(activeBackend) !== 'html5') {
        _html5RafId = null;
        return;
    }
    const state = html5GetState();
    currentTime.set(state.position);
    if (state.duration > 0 && !isNaN(state.duration)) duration.set(state.duration);
    pluginEvents.emit('timeUpdate', { currentTime: state.position, duration: state.duration });
    if (get(isPlaying)) _onPositionUpdate?.();

    // Check for early crossfade trigger
    const settings = get(appSettings);
    if (settings.crossfadeSeconds > 0 && state.duration > settings.crossfadeSeconds && !_hasCrossfaded) {
        const threshold = state.duration - settings.crossfadeSeconds;
        if (state.position >= threshold) {
            _hasCrossfaded = true;
            _onHtml5CrossfadeThreshold?.();
        }
    }

    _html5RafId = requestAnimationFrame(_html5Tick);
}
