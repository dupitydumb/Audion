import { writable } from 'svelte/store';

const initial = typeof navigator !== 'undefined' ? navigator.onLine : true;
const store = writable(initial);

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => store.set(true));
    window.addEventListener('offline', () => store.set(false));
}

export const isOnline = { subscribe: store.subscribe };
