// native os notifications
// bypasses tauri-plugin-notification, which drops action buttons and images on desktop (see src-tauri/src/notifications.rs)
// calls into notify_rust directly via the show_native_notification command

import { invoke } from '@tauri-apps/api/core';
import { listen, isTauri } from '$lib/api/tauri';

export interface NativeNotificationAction {
    actionId: string;
    label: string;
}

export interface ShowNativeNotificationOptions {
    id: string;
    title: string;
    body: string;
    /** absolute path to an image file, e.g. from save_notification_image */
    imagePath?: string;
    /**
     * windows only , no effect on linux/mac
     * false (default): small image next to the text
     * true: large hero banner above the text
     */
    useHero?: boolean;
    /**
     * windows only, and only when useHero is false
     * square (default) or circle
     * how the small image beside the text is cropped
     */
    iconCrop?: 'square' | 'circle';
    actions?: NativeNotificationAction[];
}

interface NotificationActionEvent {
    id: string;
    /**
     * the clicked action's actionId
     * "default" if the notification body itself was clicked
     * or "__closed" if it was dismissed/timed out
     *
     * windows quirk: can't distinguish a body click from a dismiss/timeout =>
     * both come back as "__closed" there
     * linux and mac report "default" for a body click
     */
    action: string;
}

type ActionHandler = (action: string) => void;

const handlers = new Map<string, ActionHandler>();
let listenerInitialized = false;

async function ensureListener(): Promise<void> {
    if (listenerInitialized || !isTauri()) return;
    listenerInitialized = true;

    await listen<NotificationActionEvent>('notification-action', (event) => {
        const handler = handlers.get(event.payload.id);
        if (handler) {
            handler(event.payload.action);
            handlers.delete(event.payload.id);
        }
    });
}

/**
 * shows a native os notification with optional action buttons and an image
 * onAction fires once with the clicked action's id,
 * "default" if the notification body was clicked, or "__closed" if it was dismissed/timed out
 * (windows can't tell a body click apart from a dismiss => both are "__closed" there)
 */
export async function showNativeNotification(
    options: ShowNativeNotificationOptions,
    onAction?: ActionHandler
): Promise<void> {
    if (!isTauri()) return;

    await ensureListener();

    if (onAction) {
        handlers.set(options.id, onAction);
    }

    await invoke('show_native_notification', {
        options: {
            id: options.id,
            title: options.title,
            body: options.body,
            image_path: options.imagePath ?? null,
            use_hero: options.useHero ?? false,
            icon_crop: options.iconCrop ?? 'square',
            actions: (options.actions ?? []).map((a) => ({
                action_id: a.actionId,
                label: a.label,
            })),
        },
    });
}