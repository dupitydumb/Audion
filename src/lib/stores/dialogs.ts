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

const initialConfirmState: ConfirmDialogState = {
    visible: false,
    message: '',
    title: 'Confirm Action',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
    resolve: null
};

export const confirmDialogStore = writable<ConfirmDialogState>(initialConfirmState);

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
            ...initialConfirmState,
            visible: false
        };
    });
}

export interface PromptOptions {
    title?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    initialValue?: string;
}

export interface PromptDialogState {
    visible: boolean;
    message: string;
    title: string;
    placeholder: string;
    confirmLabel: string;
    cancelLabel: string;
    value: string;
    resolve: ((value: string | null) => void) | null;
}

const initialPromptState: PromptDialogState = {
    visible: false,
    message: '',
    title: 'Enter Value',
    placeholder: '',
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
    value: '',
    resolve: null
};

export const promptDialogStore = writable<PromptDialogState>(initialPromptState);

export function prompt(message: string, options: PromptOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
        promptDialogStore.set({
            visible: true,
            message,
            title: options.title || 'Enter Value',
            placeholder: options.placeholder || '',
            confirmLabel: options.confirmLabel || 'OK',
            cancelLabel: options.cancelLabel || 'Cancel',
            value: options.initialValue || '',
            resolve
        });
    });
}

export function closePromptDialog(result: string | null) {
    promptDialogStore.update(state => {
        if (state.resolve) {
            state.resolve(result);
        }
        return {
            ...initialPromptState,
            visible: false
        };
    });
}
