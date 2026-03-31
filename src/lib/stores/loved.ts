import { writable } from 'svelte/store';

export const isLoved = writable<boolean>(false);

export function toggleLove() {
    isLoved.update(v => !v);
}
