import { derived, get, writable } from 'svelte/store';
import { pause, isPlaying } from './player';
import { addToast } from './toast';

const STORAGE_KEY = 'audion_sleep_timer';
const TICK_INTERVAL_MS = 1000;

export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;

interface SleepTimerState {
    endsAt: number | null;
    lastDurationMinutes: number;
}

function getDefaultState(): SleepTimerState {
    return {
        endsAt: null,
        lastDurationMinutes: 30,
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
const now = writable<number>(Date.now());

let tickHandle: ReturnType<typeof setInterval> | null = null;
let expiring = false;

function persist(): void {
    saveState({
        endsAt: get(endsAt),
        lastDurationMinutes: get(lastDurationMinutes),
    });
}

async function expireTimer(): Promise<void> {
    if (expiring) return;

    expiring = true;
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
        expiring = false;
    }
}

function startTicker(): void {
    if (tickHandle) return;

    tickHandle = setInterval(() => {
        const end = get(endsAt);
        if (!end) {
            stopTicker();
            return;
        }

        const current = Date.now();
        now.set(current);

        if (current >= end) {
            void expireTimer();
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

export const sleepTimerActive = derived(endsAt, ($endsAt) => $endsAt !== null);

export const sleepTimerRemainingMs = derived(
    [endsAt, now],
    ([$endsAt, $now]) => {
        if (!$endsAt) return 0;
        return Math.max(0, $endsAt - $now);
    }
);

export function startSleepTimer(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const normalizedMinutes = Math.round(minutes);
    const nextEndsAt = Date.now() + normalizedMinutes * 60_000;

    endsAt.set(nextEndsAt);
    lastDurationMinutes.set(normalizedMinutes);
    now.set(Date.now());
    startTicker();
    persist();
}

export function stopSleepTimer(showToast = true): void {
    const wasActive = get(endsAt) !== null;
    endsAt.set(null);
    now.set(Date.now());
    stopTicker();
    persist();

    if (showToast && wasActive) {
        addToast('Sleep timer cancelled', 'info');
    }
}

export function restartSleepTimerWithLastDuration(): void {
    startSleepTimer(get(lastDurationMinutes));
}

if (initialState.endsAt && initialState.endsAt > Date.now()) {
    startTicker();
} else if (initialState.endsAt && initialState.endsAt <= Date.now()) {
    endsAt.set(null);
    persist();
}