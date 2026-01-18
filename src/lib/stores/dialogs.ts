import { writable } from 'svelte/store';

export interface ConfirmOptions {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

export interface ConfirmDialogState {
    visible: boolean;
    message: string;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    danger: boolean;
    resolve: ((value: boolean) => void) | null;
}

const initialState: ConfirmDialogState = {
    visible: false,
    message: '',
    title: 'Confirm Action',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
    resolve: null
};

export const confirmDialogStore = writable<ConfirmDialogState>(initialState);

export function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
        confirmDialogStore.set({
            visible: true,
            message,
            title: options.title || 'Confirm Action',
            confirmLabel: options.confirmLabel || 'Confirm',
            cancelLabel: options.cancelLabel || 'Cancel',
            danger: options.danger || false,
            resolve
        });
    });
}

export function closeConfirmDialog(result: boolean) {
    confirmDialogStore.update(state => {
        if (state.resolve) {
            state.resolve(result);
        }
        return {
            ...initialState,
            visible: false
        };
    });
}
