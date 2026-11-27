import { writable } from 'svelte/store';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
    id: number;
    type: ToastType;
    message: string;
    duration: number;
    count?: number;
}

const MAX_TOASTS = 3;

function createToastStore() {
    const { subscribe, update } = writable<Toast[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let counter = 0;

    function clearTimer(id: number) {
        const timer = timers.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.delete(id);
        }
    }

    function scheduleDismiss(id: number, duration: number) {
        clearTimer(id);
        if (duration > 0) {
            timers.set(
                id,
                setTimeout(() => {
                    timers.delete(id);
                    update(toasts => toasts.filter(t => t.id !== id));
                }, duration),
            );
        }
    }

    return {
        subscribe,
        add: (message: string, type: ToastType = 'info', duration: number = 3000) => {
            let targetId: number | null = null;

            update(toasts => {
                const existing = toasts.find(t => t.type === type && t.message === message);
                if (existing) {
                    targetId = existing.id;
                    return toasts.map(t =>
                        t.id === existing.id
                            ? { ...t, duration, count: (t.count ?? 1) + 1 }
                            : t,
                    );
                }

                const id = ++counter;
                targetId = id;
                const next = [...toasts, { id, type, message, duration, count: 1 }];
                if (next.length > MAX_TOASTS) {
                    const evicted = next.slice(0, next.length - MAX_TOASTS);
                    evicted.forEach(t => clearTimer(t.id));
                    return next.slice(next.length - MAX_TOASTS);
                }
                return next;
            });

            if (targetId !== null) {
                scheduleDismiss(targetId, duration);
            }
        },
        remove: (id: number) => {
            clearTimer(id);
            update(toasts => toasts.filter(t => t.id !== id));
        }
    };
}

export const toasts = createToastStore();

export function addToast(message: string, type: ToastType = 'info', duration: number = 3000) {
    toasts.add(message, type, duration);
}
