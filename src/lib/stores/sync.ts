// Sync state store — manages account sync state for the UI
//
// Provides reactive stores for:
// - Auth state (logged in? user profile?)
// - Sync status (syncing? pending changes? last sync time?)
// - Login/logout actions
// - Sync trigger

import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '$lib/api/tauri';
import { refreshAll } from '$lib/stores/library';
import { loadLikedTracks } from '$lib/stores/liked';
import { isOnline } from '$lib/stores/network';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthState {
    is_logged_in: boolean;
    user_id: string | null;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
}

export interface SyncStatus {
    is_syncing: boolean;
    last_sync_at: string | null;
    pending_changes: number;
    last_error: string | null;
}

export interface SyncProgress {
    phase: string;
    message: string;
    current: number;
    total: number;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

const defaultAuthState: AuthState = {
    is_logged_in: false,
    user_id: null,
    email: null,
    name: null,
    avatar_url: null,
};

const defaultSyncStatus: SyncStatus = {
    is_syncing: false,
    last_sync_at: null,
    pending_changes: 0,
    last_error: null,
};

const defaultSyncProgress: SyncProgress = {
    phase: '',
    message: '',
    current: 0,
    total: 0,
};

export const authState = writable<AuthState>(defaultAuthState);
export const syncStatus = writable<SyncStatus>(defaultSyncStatus);
export const syncProgress = writable<SyncProgress>(defaultSyncProgress);
export const showLoginModal = writable<boolean>(false);
export const apiKey = writable<string>('');

// Derived convenience stores
export const isLoggedIn = derived(authState, ($auth) => $auth.is_logged_in);
export const isSyncing = derived(syncStatus, ($status) => $status.is_syncing);
export const userName = derived(authState, ($auth) => $auth.name || $auth.email || 'User');
export const userAvatar = derived(authState, ($auth) => $auth.avatar_url);

// ─── Event listeners ─────────────────────────────────────────────────────────

let unlistenAuth: UnlistenFn | null = null;
let unlistenSync: UnlistenFn | null = null;
let unlistenDeepLink: UnlistenFn | null = null;
let unlistenProgress: UnlistenFn | null = null;

/**
 * Initialize sync stores — call on app startup.
 * Fetches current auth state and sync status from the Rust backend.
 * Sets up event listeners for real-time updates + deep link handling.
 */
export async function initSync(): Promise<void> {
    if (!isTauri()) return;

    try {
        // Fetch initial state
        const auth = await invoke<AuthState>('sync_get_auth_state');
        authState.set(auth);

        const status = await invoke<SyncStatus>('sync_get_status');
        syncStatus.set(status);

        const key = await invoke<string | null>('sync_get_api_key');
        if (key) apiKey.set(key);
    } catch (error) {
        console.error('[Sync] Failed to initialize:', error);
        // If we can't read auth state (e.g. database was deleted), reset to logged-out
        authState.set(defaultAuthState);
        syncStatus.set(defaultSyncStatus);
    }

    // Listen for auth state changes (e.g., deep-link callback)
    try {
        unlistenAuth = await listen<AuthState>('sync://auth-state-changed', (event) => {
            console.log('[Sync] Auth state changed:', event.payload);
            authState.set(event.payload);
        });

        unlistenSync = await listen<SyncStatus>('sync://status-changed', (event) => {
            console.log('[Sync] Status changed:', event.payload);
            syncStatus.set(event.payload);
            // When sync finishes, reload all data from the now-updated local DB
            if (!event.payload.is_syncing) {
                syncProgress.set(defaultSyncProgress);
                reloadAfterSync();
            }
        });

        unlistenProgress = await listen<SyncProgress>('sync://progress', (event) => {
            console.log(`[Sync] Progress: [${event.payload.phase}] ${event.payload.message} (${event.payload.current}/${event.payload.total})`);
            syncProgress.set(event.payload);
        });
    } catch (error) {
        console.error('[Sync] Failed to set up event listeners:', error);
    }

    // ─── Deep link handling (frontend fallback) ──────────────────────────
    // On some platforms, the Rust-side deep link handler may not fire.
    // Use the official JS deep-link API as a belt-and-suspenders approach.
    try {
        const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');

        unlistenDeepLink = await onOpenUrl(async (urls: string[]) => {
            console.log('[Sync] Deep link received (JS):', urls);
            for (const url of urls) {
                if (url.startsWith('audion://auth/callback')) {
                    await handleDeepLinkCallback(url);
                }
            }
        });
    } catch (error) {
        console.error('[Sync] Failed to set up deep link listener:', error);
    }

    // Also check if the app was cold-started via a deep link
    try {
        const { getCurrent } = await import('@tauri-apps/plugin-deep-link');
        const currentUrls = await getCurrent();
        if (currentUrls && currentUrls.length > 0) {
            console.log('[Sync] App started with deep link:', currentUrls);
            for (const url of currentUrls) {
                if (url.startsWith('audion://auth/callback')) {
                    await handleDeepLinkCallback(url);
                }
            }
        }
    } catch (error) {
        console.error('[Sync] Failed to check current deep link:', error);
    }

    // ─── Automatic Sync Trigger ──────────────────────────────────────────
    // Watch for pending changes and online status. Trigger sync after a short delay.
    let syncTimeout: ReturnType<typeof setTimeout> | null = null;

    syncStatus.subscribe(($status) => {
        const canSync = $status.pending_changes > 0 && !$status.is_syncing && get(isOnline) && get(isLoggedIn);

        if (canSync) {
            if (syncTimeout) clearTimeout(syncTimeout);
            syncTimeout = setTimeout(() => {
                triggerSync();
            }, 2000); // 2 second debounce
        } else if (syncTimeout) {
            clearTimeout(syncTimeout);
            syncTimeout = null;
        }
    });

    // Also trigger when coming back online
    isOnline.subscribe(($online) => {
        if ($online) {
            const $status = get(syncStatus);
            if ($status.pending_changes > 0 && !$status.is_syncing && get(isLoggedIn)) {
                triggerSync();
            }
        }
    });
}

/**
 * Handle a deep link callback URL from the frontend side.
 * Extracts tokens and calls the backend to process them.
 */
async function handleDeepLinkCallback(url: string): Promise<void> {
    try {
        const parsedUrl = new URL(url);
        const accessToken = parsedUrl.searchParams.get('access_token');
        const refreshToken = parsedUrl.searchParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
            console.error('[Sync] Deep link missing tokens');
            return;
        }

        console.log('[Sync] Processing OAuth callback from deep link...');

        const auth = await invoke<AuthState>('sync_handle_auth_callback', {
            accessToken,
            refreshToken,
        });

        authState.set(auth);
        showLoginModal.set(false);

        // The backend spawns a full sync in the background.
        // Poll for completion so the UI updates when it finishes.
        pollSyncStatus();
    } catch (error) {
        console.error('[Sync] Failed to handle deep link callback:', error);
    }
}

/**
 * Poll sync status until syncing is complete.
 * Updates the store on each poll so the UI reflects progress.
 */
function pollSyncStatus(intervalMs = 2000, maxAttempts = 60): void {
    let attempts = 0;
    const poll = setInterval(async () => {
        attempts++;
        try {
            const status = await invoke<SyncStatus>('sync_get_status');
            syncStatus.set(status);

            if (!status.is_syncing || attempts >= maxAttempts) {
                clearInterval(poll);
                if (attempts >= maxAttempts) {
                    console.warn('[Sync] Polling timed out after', maxAttempts, 'attempts');
                } else {
                    console.log('[Sync] Sync completed:', status);
                    reloadAfterSync();
                }
            }
        } catch (e) {
            console.error('[Sync] Failed to poll status:', e);
            clearInterval(poll);
        }
    }, intervalMs);
}

/**
 * Reload library, playlists, and liked tracks from the local DB after sync.
 * Called when a background sync finishes so the UI reflects imported data.
 */
async function reloadAfterSync(): Promise<void> {
    try {
        console.log('[Sync] Reloading data after sync...');
        await Promise.all([refreshAll(), loadLikedTracks()]);
        console.log('[Sync] Data reload complete');
    } catch (error) {
        console.error('[Sync] Failed to reload data after sync:', error);
    }
}

/**
 * Clean up event listeners — call on app unmount.
 */
export function destroySync(): void {
    if (unlistenAuth) {
        unlistenAuth();
        unlistenAuth = null;
    }
    if (unlistenSync) {
        unlistenSync();
        unlistenSync = null;
    }
    if (unlistenDeepLink) {
        unlistenDeepLink();
        unlistenDeepLink = null;
    }
    if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
    }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Start the OAuth login flow — opens the system browser.
 */
export async function startLogin(provider: 'google' | 'github' = 'google'): Promise<void> {
    if (!isTauri()) return;

    try {
        const serverUrl = await invoke<string>('sync_get_server_url');
        const loginUrl = `${serverUrl}/auth/${provider}`;

        // Open in system browser using the opener plugin
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(loginUrl);

        // Close the login modal — the deep-link callback will handle the rest
        showLoginModal.set(false);
    } catch (error) {
        console.error('[Sync] Failed to start login:', error);
    }
}

/**
 * Log out — revoke tokens, clear state.
 */
export async function logout(): Promise<void> {
    if (!isTauri()) return;

    try {
        await invoke('sync_logout');
    } catch (error) {
        console.error('[Sync] Failed to logout:', error);
        // Continue anyway — always clear frontend state regardless of backend errors
        // (e.g. if the local database was deleted, the backend call will fail
        // but we still need to reset the UI to logged-out state)
    }

    // Always reset frontend stores, even if the backend call failed
    authState.set(defaultAuthState);
    syncStatus.set(defaultSyncStatus);
    syncProgress.set(defaultSyncProgress);
}

/**
 * Trigger a manual sync.
 */
export async function triggerSync(): Promise<void> {
    if (!isTauri()) return;

    const auth = get(authState);
    if (!auth.is_logged_in) return;

    try {
        console.log('[Sync] Triggering manual sync...');
        syncStatus.update((s) => ({ ...s, is_syncing: true }));
        syncProgress.set({ phase: 'sync', message: 'Starting sync...', current: 0, total: 0 });
        const status = await invoke<SyncStatus>('sync_trigger');
        console.log('[Sync] Manual sync completed:', status);
        syncStatus.set(status);
        syncProgress.set(defaultSyncProgress);
        await reloadAfterSync();
    } catch (error) {
        console.error('[Sync] Sync failed:', error);

        let errorMessage = String(error);
        if (errorMessage.includes('403') || errorMessage.includes('Invalid or missing API Key')) {
            errorMessage = 'Account sync is only available for supporters who donated to the project.';
        }

        syncStatus.update((s) => ({
            ...s,
            is_syncing: false,
            last_error: errorMessage,
        }));
        syncProgress.set(defaultSyncProgress);
    }
}

/**
 * Enqueue a sync change (called after local mutations).
 */
export async function enqueueChange(
    entityType: string,
    entityId: string,
    operation: string,
    payload?: Record<string, unknown>,
): Promise<void> {
    if (!isTauri()) return;

    try {
        await invoke('sync_enqueue_change', {
            entityType,
            entityId,
            operation,
            payload: payload ? JSON.stringify(payload) : null,
        });

        // Update pending count optimistically
        syncStatus.update((s) => ({
            ...s,
            pending_changes: s.pending_changes + 1,
        }));
    } catch (error) {
        // Don't throw — sync queue failures shouldn't break the app
        console.warn('[Sync] Failed to enqueue change:', error);
    }
}

/**
 * Delete the user's account (GDPR).
 */
export async function deleteAccount(): Promise<void> {
    if (!isTauri()) return;

    try {
        await invoke('sync_delete_account');
    } catch (error) {
        console.error('[Sync] Failed to delete account:', error);
        // Always reset frontend state even on failure
        authState.set(defaultAuthState);
        syncStatus.set(defaultSyncStatus);
        syncProgress.set(defaultSyncProgress);
        throw error;
    }

    // Reset frontend stores on success
    authState.set(defaultAuthState);
    syncStatus.set(defaultSyncStatus);
    syncProgress.set(defaultSyncProgress);
}

/**
 * Refresh auth state from backend (e.g., after returning from background).
 */
export async function refreshAuthState(): Promise<void> {
    if (!isTauri()) return;

    try {
        const auth = await invoke<AuthState>('sync_get_auth_state');
        authState.set(auth);
    } catch (error) {
        console.error('[Sync] Failed to refresh auth state:', error);
        // If we can't read auth state (e.g. database was deleted), reset to logged-out
        authState.set(defaultAuthState);
    }
}

/**
 * Update the stored API key.
 */
export async function setApiKey(key: string): Promise<void> {
    if (!isTauri()) return;

    try {
        await invoke('sync_set_api_key', { apiKey: key });
        apiKey.set(key);
    } catch (error) {
        console.error('[Sync] Failed to set API key:', error);
        throw error;
    }
}
