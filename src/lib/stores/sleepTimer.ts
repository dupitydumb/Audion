import { derived, get, writable } from 'svelte/store';
import { pause, isPlaying, setVolume, volume, currentTime, duration, currentTrack, registerSleepTimerHooks } from './player';
import { addToast } from './toast';

const STORAGE_KEY = 'audion_sleep_timer';
const TICK_INTERVAL_MS = 1000;

export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;

export type SleepTimerMode = 'duration' | 'end_of_track';

interface SleepTimerState {
    endsAt: number | null;
    lastDurationMinutes: number;
    mode: SleepTimerMode | null;
    fadeEnabled: boolean;
}

function getDefaultState(): SleepTimerState {
    return {
        endsAt: null,
        lastDurationMinutes: 30,
        mode: null,
        fadeEnabled: true,
    };
}

function loadState(): SleepTimerState {
    if (typeof window === 'undefined') return getDefaultState();

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return getDefaultState();

        const parsed = JSON.parse(raw) as Partial<SleepTimerState>;
        return {
            endsAt:
                typeof parsed.endsAt === 'number' && Number.isFinite(parsed.endsAt)
                    ? parsed.endsAt
                    : null,
            lastDurationMinutes:
                typeof parsed.lastDurationMinutes === 'number' &&
                Number.isFinite(parsed.lastDurationMinutes) &&
                parsed.lastDurationMinutes > 0
                    ? parsed.lastDurationMinutes
                    : 30,
            mode: parsed.mode === 'end_of_track' ? 'end_of_track' : (parsed.endsAt ? 'duration' : null),
            fadeEnabled: parsed.fadeEnabled !== false,
        };
    } catch (error) {
        console.error('[SleepTimer] Failed to load state:', error);
        return getDefaultState();
    }
}

function saveState(state: SleepTimerState): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('[SleepTimer] Failed to save state:', error);
    }
}

const initialState = loadState();
const endsAt = writable<number | null>(initialState.endsAt);
const lastDurationMinutes = writable<number>(initialState.lastDurationMinutes);
const mode = writable<SleepTimerMode | null>(initialState.mode);
const fadeEnabled = writable<boolean>(initialState.fadeEnabled);
const now = writable<number>(Date.now());

let tickHandle: ReturnType<typeof setInterval> | null = null;
let expiring = false;
let baseVolume: number | null = null;
let endOfTrackTargetId: number | string | null = null;

function persist(): void {
    saveState({
        endsAt: get(endsAt),
        lastDurationMinutes: get(lastDurationMinutes),
        mode: get(mode),
        fadeEnabled: get(fadeEnabled),
    });
}

function calcExponentialFade(progress: number): number {
    // progress in [0, 1] where 1 is full volume, 0 is silence
    // using factor = (e^(2.5 * p) - 1) / (e^2.5 - 1)
    const clamped = Math.max(0, Math.min(1, progress));
    const k = 2.5;
    return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
}

export async function expireTimer(): Promise<void> {
    if (expiring) return;

    expiring = true;
    const restoreVol = baseVolume;
    baseVolume = null;
    endOfTrackTargetId = null;

    stopSleepTimer(false);

    try {
        if (get(isPlaying)) {
            await pause();
            addToast('Sleep timer expired — playback paused', 'info');
        } else {
            addToast('Sleep timer expired', 'info');
        }
    } catch (error) {
        console.error('[SleepTimer] Failed to pause playback on expiry:', error);
    } finally {
        if (restoreVol !== null) {
            try {
                await setVolume(restoreVol);
            } catch (err) {
                console.error('[SleepTimer] Failed to restore volume after expiry:', err);
            }
        }
        expiring = false;
    }
}

function handleFade(remainingMs: number, fadeWindowMs: number) {
    if (!get(fadeEnabled) || fadeWindowMs <= 0) return;

    if (remainingMs <= fadeWindowMs) {
        if (baseVolume === null) {
            baseVolume = get(volume);
        }
        if (baseVolume !== null && baseVolume > 0) {
            const progress = remainingMs / fadeWindowMs;
            const factor = calcExponentialFade(progress);
            const targetVolume = Math.max(0, Math.min(1, baseVolume * factor));
            void setVolume(targetVolume);
        }
    }
}

function startTicker(): void {
    if (tickHandle) return;

    tickHandle = setInterval(() => {
        const currentMode = get(mode);
        if (!currentMode) {
            stopTicker();
            return;
        }

        const currentTimeMs = Date.now();
        now.set(currentTimeMs);

        if (currentMode === 'duration') {
            const end = get(endsAt);
            if (!end) {
                stopTicker();
                return;
            }

            const remaining = Math.max(0, end - currentTimeMs);
            const totalDurationMs = get(lastDurationMinutes) * 60_000;
            const fadeWindowMs = Math.min(60_000, totalDurationMs * 0.2);

            handleFade(remaining, fadeWindowMs);

            if (currentTimeMs >= end) {
                void expireTimer();
            }
        } else if (currentMode === 'end_of_track') {
            const cur = get(currentTime);
            const dur = get(duration);
            const track = get(currentTrack);

            if (!track || !get(isPlaying)) {
                // If nothing is playing or track disappeared
                return;
            }

            if (endOfTrackTargetId !== null && track.id !== endOfTrackTargetId) {
                // Track already shifted to next one => expire now
                void expireTimer();
                return;
            }

            const remainingSec = Math.max(0, dur - cur);
            const remainingMs = remainingSec * 1000;
            const fadeWindowMs = Math.min(15_000, (dur * 1000) * 0.2);

            handleFade(remainingMs, fadeWindowMs);

            if (dur > 0 && remainingSec <= 0.6) {
                void expireTimer();
            }
        }
    }, TICK_INTERVAL_MS);
}

function stopTicker(): void {
    if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
    }
}

export const sleepTimerEndsAt = {
    subscribe: endsAt.subscribe,
};

export const sleepTimerLastDurationMinutes = {
    subscribe: lastDurationMinutes.subscribe,
};

export const sleepTimerMode = {
    subscribe: mode.subscribe,
};

export const sleepTimerFadeEnabled = {
    subscribe: fadeEnabled.subscribe,
};

export const sleepTimerActive = derived(mode, ($mode) => $mode !== null);

export const sleepTimerRemainingMs = derived(
    [endsAt, mode, now, currentTime, duration],
    ([$endsAt, $mode, $now, $currentTime, $duration]) => {
        if (!$mode) return 0;
        if ($mode === 'duration') {
            if (!$endsAt) return 0;
            return Math.max(0, $endsAt - $now);
        }
        if ($mode === 'end_of_track') {
            const remSec = Math.max(0, ($duration || 0) - ($currentTime || 0));
            return Math.round(remSec * 1000);
        }
        return 0;
    }
);

export function toggleSleepTimerFade(enabled?: boolean): void {
    fadeEnabled.update((v) => (enabled !== undefined ? enabled : !v));
    persist();
}

export function startSleepTimer(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    if (baseVolume !== null) {
        void setVolume(baseVolume);
        baseVolume = null;
    }

    const normalizedMinutes = Math.round(minutes);
    const nextEndsAt = Date.now() + normalizedMinutes * 60_000;

    endsAt.set(nextEndsAt);
    lastDurationMinutes.set(normalizedMinutes);
    mode.set('duration');
    endOfTrackTargetId = null;
    now.set(Date.now());
    startTicker();
    persist();
}

export function startSleepTimerEndOfTrack(): void {
    if (baseVolume !== null) {
        void setVolume(baseVolume);
        baseVolume = null;
    }

    const track = get(currentTrack);
    endOfTrackTargetId = track ? track.id : null;
    endsAt.set(null);
    mode.set('end_of_track');
    now.set(Date.now());
    startTicker();
    persist();
    addToast('Sleep timer set: finish current track', 'info');
}

export function stopSleepTimer(showToast = true): void {
    const wasActive = get(mode) !== null;

    if (baseVolume !== null) {
        const restore = baseVolume;
        baseVolume = null;
        void setVolume(restore);
    }

    endsAt.set(null);
    mode.set(null);
    endOfTrackTargetId = null;
    now.set(Date.now());
    stopTicker();
    persist();

    if (showToast && wasActive) {
        addToast('Sleep timer cancelled', 'info');
    }
}

export function shouldHaltForSleepTimer(): boolean {
    return get(mode) === 'end_of_track' || (get(mode) === 'duration' && (get(endsAt) ?? 0) <= Date.now());
}

export function restartSleepTimerWithLastDuration(): void {
    startSleepTimer(get(lastDurationMinutes));
}

// Wire up hooks into playback engine
registerSleepTimerHooks(shouldHaltForSleepTimer, expireTimer);
if (initialState.mode === 'duration' && initialState.endsAt && initialState.endsAt > Date.now()) {
    startTicker();
} else if (initialState.mode === 'duration' && initialState.endsAt && initialState.endsAt <= Date.now()) {
    endsAt.set(null);
    mode.set(null);
    persist();
} else if (initialState.mode === 'end_of_track') {
    // If browser refreshed during end_of_track, bind to current track once loaded
    mode.set('end_of_track');
    startTicker();
}
