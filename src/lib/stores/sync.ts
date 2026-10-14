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
import { refreshAll, clearLibrary } from '$lib/stores/library';
import { loadLikedTracks, likedTrackIds } from '$lib/stores/liked';
import { isOnline } from '$lib/stores/network';
import { loadActivityData, clearActivityData } from '$lib/stores/activity';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthState {
    is_logged_in: boolean;
    user_id: string | null;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
    is_supporter: boolean;
    /** Unix timestamp in milliseconds. null = no expiry (active subscription). */
    supporter_until: number | null;
    /** Unix timestamp in milliseconds. null = never had a trial (pre-feature users or paid). */
    trial_started_at: number | null;
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
    is_supporter: false,
    supporter_until: null,
    trial_started_at: null,
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
export const loginModalMode = writable<'oauth' | 'custom_server'>('oauth');

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

/** true when user is on a free trial (not a paid supporter) */
export const isOnTrial = derived(authState, ($auth) => {
    if (!$auth.trial_started_at || !$auth.is_supporter) return false;
    // They're a supporter — if supporterUntil matches the trial window, it's a trial
    const trialExpiry = $auth.trial_started_at + TRIAL_MS;
    return $auth.supporter_until !== null && Math.abs($auth.supporter_until - trialExpiry) < 60_000;
});

/** Days remaining in trial (0–7). -1 if not on trial. */
export const trialDaysLeft = derived(authState, ($auth) => {
    if (!$auth.trial_started_at) return -1;
    const trialExpiry = $auth.trial_started_at + TRIAL_MS;
    const msLeft = trialExpiry - Date.now();
    if (msLeft <= 0) return 0;
    return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
});

export interface CustomServerStatus {
    connected: boolean;
    url: string;
    user: string | null;
}

const defaultCustomServerStatus: CustomServerStatus = {
    connected: false,
    url: '',
    user: null,
};

export const customServerStatus = writable<CustomServerStatus>(defaultCustomServerStatus);

// Derived convenience stores
export const isLoggedIn = derived(authState, ($auth) => $auth.is_logged_in);
export const isSupporter = derived(authState, ($auth) => $auth.is_supporter);
export const isSyncing = derived(syncStatus, ($status) => $status.is_syncing);
export const userName = derived(authState, ($auth) => $auth.name || $auth.email || 'User');
export const userAvatar = derived(authState, ($auth) => $auth.avatar_url);

// ─── Event listeners ─────────────────────────────────────────────────────────

let unlistenAuth: UnlistenFn | null = null;
let unlistenSync: UnlistenFn | null = null;
let unlistenDeepLink: UnlistenFn | null = null;
let unlistenProgress: UnlistenFn | null = null;
let unsubSyncStatus: (() => void) | null = null;
let unsubIsOnline: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let activePollInterval: ReturnType<typeof setInterval> | null = null;
let activeSyncTimeout: ReturnType<typeof setTimeout> | null = null;

const CONSUMED_DEEP_LINKS_KEY = 'audion_consumed_deep_links';
const AUTH_LOGGED_OUT_KEY = 'audion_auth_logged_out';
let deepLinkConsumptionQueue: Promise<unknown> = Promise.resolve();

async function fingerprintDeepLink(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function isDeepLinkConsumed(url: string, markConsumed = false): Promise<boolean> {
    const fingerprint = await fingerprintDeepLink(url);
    // Serialize storage updates, including migration of previously stored URLs.
    const operation = deepLinkConsumptionQueue.then(async () => {
        try {
            const raw = sessionStorage.getItem(CONSUMED_DEEP_LINKS_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            const list: string[] = Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
            const fingerprints = await Promise.all(list.map(item =>
                /^[a-f0-9]{64}$/.test(item) ? item : fingerprintDeepLink(item)
            ));
            const consumed = fingerprints.includes(fingerprint);
            if (markConsumed && !consumed) fingerprints.push(fingerprint);
            if (JSON.stringify(fingerprints) !== raw) {
                sessionStorage.setItem(CONSUMED_DEEP_LINKS_KEY, JSON.stringify(fingerprints));
            }
            return consumed;
        } catch {
            return false;
        }
    });
    deepLinkConsumptionQueue = operation;
    return operation;
}

async function markDeepLinkConsumed(url: string): Promise<void> {
    await isDeepLinkConsumed(url, true);
}

function isAuthLoggedOut(): boolean {
    try {
        return sessionStorage.getItem(AUTH_LOGGED_OUT_KEY) === 'true';
    } catch {
        return false;
    }
}

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

        try {
            const serverStatus = await invoke<CustomServerStatus>('server_get_status');
            customServerStatus.set(serverStatus);
        } catch (err) {
            console.error('[Sync] Failed to fetch server status:', err);
        }
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
                } else if (url.includes('install-plugin')) {
                    await markDeepLinkConsumed(url);
                    try {
                        const parsed = new URL(url);
                        const repoUrl = parsed.searchParams.get('url') || parsed.searchParams.get('repo');
                        if (repoUrl) {
                            console.log('[Sync] Deep link plugin install request:', repoUrl);
                            const { confirm } = await import('./dialogs');
                            const confirmed = await confirm(
                                `Do you want to install the plugin from repository:\n\n${repoUrl}?`,
                                { title: 'Install Plugin', confirmLabel: 'Install', cancelLabel: 'Cancel' }
                            );
                            if (confirmed) {
                                const { pluginStore } = await import('./plugin-store');
                                await pluginStore.installPluginFromRepo(repoUrl);
                            }
                        }
                    } catch (err) {
                        console.error('[Sync] Failed to handle plugin install deep link:', err);
                    }
                } else if (url.includes('install-theme')) {
                    await markDeepLinkConsumed(url);
                    try {
                        const parsed = new URL(url);
                        const themeUrl = parsed.searchParams.get('url') || parsed.searchParams.get('theme');
                        if (themeUrl) {
                            console.log('[Sync] Deep link theme install request:', themeUrl);
                            if (!themeUrl.startsWith('https://')) throw new Error('Theme URL must use https://');
                            const res = await fetch(themeUrl);
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            const text = await res.text();
                            const raw = JSON.parse(text);
                            const { parseThemePackage, theme } = await import('./theme');
                            const pkg = parseThemePackage(raw);
                            const { confirm } = await import('./dialogs');
                            const confirmed = await confirm(
                                `Do you want to install and apply theme "${pkg.name ?? 'Custom Theme'}"?`,
                                { title: 'Install Theme', confirmLabel: 'Install & Apply', cancelLabel: 'Cancel' }
                            );
                            if (confirmed) {
                                theme.applyPackage(pkg);
                            }
                        }
                    } catch (err) {
                        console.error('[Sync] Failed to handle theme install deep link:', err);
                    }
                }
            }
        });
    } catch (error) {
        console.error('[Sync] Failed to set up deep link listener:', error);
    }

    // Also check if the app was cold-started via a deep link.
    // IMPORTANT:
    // 1. Rust setup() already handles cold-start audion:// auth callbacks into SQLite.
    // 2. getCurrent() persists indefinitely in Tauri's plugin memory across webview refreshes (F5).
    // 3. We must never replay an auth callback if it was already consumed or if the user logged out!
    try {
        const { getCurrent } = await import('@tauri-apps/plugin-deep-link');
        const currentUrls = await getCurrent();
        if (currentUrls && currentUrls.length > 0) {
            console.log('[Sync] Checking current deep link from plugin:', currentUrls);
            for (const url of currentUrls) {
                if (await isDeepLinkConsumed(url)) {
                    console.log('[Sync] Skipping already consumed deep link:', url);
                    continue;
                }

                if (url.startsWith('audion://auth/callback')) {
                    // If user logged out in this session, do not replay stale deep link tokens!
                    if (isAuthLoggedOut()) {
                        console.log('[Sync] Skipping getCurrent() auth deep link — user logged out during this session');
                        await markDeepLinkConsumed(url);
                        continue;
                    }

                    const currentAuth = await invoke<AuthState>('sync_get_auth_state');
                    if (!currentAuth.is_logged_in) {
                        await handleDeepLinkCallback(url);
                    } else {
                        await markDeepLinkConsumed(url);
                        console.log('[Sync] Skipping getCurrent() deep link — user already logged in');
                    }
                } else if (url.includes('install-plugin')) {
                    await markDeepLinkConsumed(url);
                    try {
                        const parsed = new URL(url);
                        const repoUrl = parsed.searchParams.get('url') || parsed.searchParams.get('repo');
                        if (repoUrl) {
                            console.log('[Sync] Cold-start plugin install request:', repoUrl);
                            const { confirm } = await import('./dialogs');
                            const confirmed = await confirm(
                                `Do you want to install the plugin from repository:\n\n${repoUrl}?`,
                                { title: 'Install Plugin', confirmLabel: 'Install', cancelLabel: 'Cancel' }
                            );
                            if (confirmed) {
                                const { pluginStore } = await import('./plugin-store');
                                await pluginStore.installPluginFromRepo(repoUrl);
                            }
                        }
                    } catch (err) {
                        console.error('[Sync] Failed to handle cold-start plugin install deep link:', err);
                    }
                } else if (url.includes('install-theme')) {
                    try {
                        const parsed = new URL(url);
                        const themeUrl = parsed.searchParams.get('url') || parsed.searchParams.get('theme');
                        if (themeUrl) {
                            console.log('[Sync] Cold-start theme install request:', themeUrl);
                            if (!themeUrl.startsWith('https://')) throw new Error('Theme URL must use https://');
                            const res = await fetch(themeUrl);
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            const text = await res.text();
                            const raw = JSON.parse(text);
                            const { parseThemePackage, theme } = await import('./theme');
                            const pkg = parseThemePackage(raw);
                            const { confirm } = await import('./dialogs');
                            const confirmed = await confirm(
                                `Do you want to install and apply theme "${pkg.name ?? 'Custom Theme'}"?`,
                                { title: 'Install Theme', confirmLabel: 'Install & Apply', cancelLabel: 'Cancel' }
                            );
                            if (confirmed) {
                                theme.applyPackage(pkg);
                            }
                        }
                    } catch (err) {
                        console.error('[Sync] Failed to handle cold-start theme install deep link:', err);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Sync] Failed to check current deep link:', error);
    }


    // ─── Automatic Sync Trigger ──────────────────────────────────────────
    // Watch for pending changes and online status. Trigger sync after a short delay.
    // Enforces a 12-hour cooldown between auto-syncs to reduce server load.
    // Also pauses sync when the app is in the background for > 5 minutes.
    let lastVisibleAt = Date.now();
    let isAppVisible = true;

    if (typeof document !== 'undefined') {
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
        }
        visibilityHandler = () => {
            isAppVisible = document.visibilityState === 'visible';
            if (isAppVisible) {
                lastVisibleAt = Date.now();
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
    }

    const isBackgroundPaused = () => {
        if (isAppVisible) return false;
        const backgroundDuration = Date.now() - lastVisibleAt;
        return backgroundDuration > 5 * 60 * 1000; // 5 minutes
    };

    // Automatic Sync Trigger constants
    const LAST_SYNC_KEY = 'audion_last_auto_sync_at';
    const AUTO_SYNC_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

    // Prevent initial sync on app open
    let isInitialCheck = true;

    if (unsubSyncStatus) unsubSyncStatus();
    unsubSyncStatus = syncStatus.subscribe(($status) => {
        // Skip the very first check to prevent sync on app open
        if (isInitialCheck) {
            isInitialCheck = false;
            console.log('[Sync] Initial check skipped (cooldown active)');
            return;
        }

        const now = Date.now();
        // Read current cooldown timestamp from storage (don't use stale closure variable)
        const currentLastSync = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
        const cooldownRemaining = currentLastSync + AUTO_SYNC_COOLDOWN_MS - now;

        const canSync =
            $status.pending_changes > 0 &&
            !$status.is_syncing &&
            get(isOnline) &&
            get(isLoggedIn) &&
            cooldownRemaining <= 0 &&
            !isBackgroundPaused();

        if (canSync) {
            if (activeSyncTimeout) clearTimeout(activeSyncTimeout);
            activeSyncTimeout = setTimeout(() => {
                activeSyncTimeout = null;
                triggerSync(false);
            }, 5000); // 5 second debounce for auto-sync
        } else if (activeSyncTimeout && ($status.is_syncing || $status.pending_changes === 0)) {
            clearTimeout(activeSyncTimeout);
            activeSyncTimeout = null;
        }
    });

    // Also trigger when coming back online, but still respect cooldown
    if (unsubIsOnline) unsubIsOnline();
    unsubIsOnline = isOnline.subscribe(($online) => {
        if ($online && !isInitialCheck) {
            const $status = get(syncStatus);
            const now = Date.now();
            const currentLastSync = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
            if ($status.pending_changes > 0 &&
                get(isLoggedIn) &&
                (now - currentLastSync >= AUTO_SYNC_COOLDOWN_MS) &&
                !isBackgroundPaused()) {
                triggerSync(false);
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
        if (isAuthLoggedOut() || await isDeepLinkConsumed(url)) return;

        const parsedUrl = new URL(url);
        const accessToken = parsedUrl.searchParams.get('access_token');
        const refreshToken = parsedUrl.searchParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
            console.error('[Sync] Deep link missing tokens');
            return;
        }

        await markDeepLinkConsumed(url);
        // Logout may have happened while fingerprinting the callback.
        if (isAuthLoggedOut()) return;

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
        // Even if the profile fetch failed, the tokens may have been stored.
        // Refresh auth state so the UI reflects whatever state Rust ended up in
        // and close the modal so the user isn't stuck.
        try {
            const auth = await invoke<AuthState>('sync_get_auth_state');
            authState.set(auth);
        } catch (_) {
            // ignore
        }
        showLoginModal.set(false);
    }
}

/**
 * Poll sync status until syncing is complete.
 * Updates the store on each poll so the UI reflects progress.
 */
function pollSyncStatus(intervalMs = 2000, maxAttempts = 60): void {
    if (activePollInterval) {
        clearInterval(activePollInterval);
        activePollInterval = null;
    }
    let attempts = 0;
    activePollInterval = setInterval(async () => {
        attempts++;
        try {
            const status = await invoke<SyncStatus>('sync_get_status');
            syncStatus.set(status);

            if (!status.is_syncing || attempts >= maxAttempts) {
                if (activePollInterval) {
                    clearInterval(activePollInterval);
                    activePollInterval = null;
                }
                if (attempts >= maxAttempts) {
                    console.warn('[Sync] Polling timed out after', maxAttempts, 'attempts');
                } else {
                    console.log('[Sync] Sync completed:', status);
                    reloadAfterSync();
                }
            }
        } catch (e) {
            console.error('[Sync] Failed to poll status:', e);
            if (activePollInterval) {
                clearInterval(activePollInterval);
                activePollInterval = null;
            }
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
        await Promise.all([refreshAll(), loadLikedTracks(), loadActivityData()]);
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
    if (unsubSyncStatus) {
        unsubSyncStatus();
        unsubSyncStatus = null;
    }
    if (unsubIsOnline) {
        unsubIsOnline();
        unsubIsOnline = null;
    }
    if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
    if (activePollInterval) {
        clearInterval(activePollInterval);
        activePollInterval = null;
    }
    if (activeSyncTimeout) {
        clearTimeout(activeSyncTimeout);
        activeSyncTimeout = null;
    }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Start the OAuth login flow — opens the system browser.
 */
export async function startLogin(provider: 'google' | 'github' = 'google'): Promise<void> {
    if (!isTauri()) return;

    try {
        sessionStorage.removeItem(AUTH_LOGGED_OUT_KEY);
    } catch {
        // ignore
    }

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

    // Invalidate active session deep links so webview refresh doesn't replay auth
    try {
        sessionStorage.setItem(AUTH_LOGGED_OUT_KEY, 'true');
        const { getCurrent } = await import('@tauri-apps/plugin-deep-link');
        const currentUrls = await getCurrent();
        if (currentUrls) {
            for (const u of currentUrls) {
                await markDeepLinkConsumed(u);
            }
        }
    } catch {
        // ignore
    }

    // Clear sync account data gracefully
    await clearLibrary();
    clearActivityData();
    likedTrackIds.set(new Set());

    try {
        await invoke('sync_logout');
    } catch (error) {
        console.error('[Sync] Failed to logout:', error);
        // Continue anyway — always clear frontend state regardless of backend errors
    }

    // Always reset frontend stores, even if the backend call failed
    authState.set(defaultAuthState);
    syncStatus.set(defaultSyncStatus);
    syncProgress.set(defaultSyncProgress);
    
    // Refresh local data after logout
    await Promise.all([refreshAll(), loadLikedTracks(), loadActivityData()]);
}

/**
 * Trigger a sync.
 * @param forced If true, ignores the 12-hour cooldown (manual trigger).
 */
export async function triggerSync(forced = true): Promise<void> {
    if (!isTauri()) return;

    const auth = get(authState);
    if (!auth.is_logged_in) return;

    const LAST_SYNC_KEY = 'audion_last_auto_sync_at';
    const lastSync = parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
    const now = Date.now();
    const AUTO_SYNC_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

    // Only proceed if forced (manual) or 12 hours passed
    if (!forced && (now - lastSync < AUTO_SYNC_COOLDOWN_MS)) {
        console.log('[Sync] Automatic sync skipped — cooldown active');
        return;
    }

    try {
        console.log(`[Sync] Starting ${forced ? 'manual' : 'scheduled'} sync...`);
        
        // Reset the cooldown timer immediately to prevent loops if this attempt fails
        localStorage.setItem(LAST_SYNC_KEY, now.toString());

        syncStatus.update((s) => ({ ...s, is_syncing: true }));
        syncProgress.set({ phase: 'sync', message: 'Starting sync...', current: 0, total: 0 });
        
        const status = await invoke<SyncStatus>('sync_trigger');
        console.log('[Sync] Sync completed locally:', status);
        
        syncStatus.set(status);
        syncProgress.set(defaultSyncProgress);
        await reloadAfterSync();
    } catch (error) {
        console.error('[Sync] Sync failed:', error);

        let errorMessage = String(error);

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
 * Test connection to a custom server with username and password.
 */
export async function testCustomServerConnection(url: string, username: string, password: string): Promise<void> {
    if (!isTauri()) return;
    await invoke('server_test_connection', { url, username, password });
}

/**
 * Connect to a custom server with username and password.
 */
export async function connectCustomServerPassword(url: string, username: string, password: string): Promise<void> {
    if (!isTauri()) return;
    
    try {
        sessionStorage.removeItem('audion_auth_logged_out');
    } catch {
        // ignore
    }

    // Clear old data gracefully before connecting to new server
    await clearLibrary();
    clearActivityData();
    likedTrackIds.set(new Set());
    
    await invoke('server_connect', { url, username, password });
    const status = await invoke<CustomServerStatus>('server_get_status');
    customServerStatus.set(status);
    await refreshAuthState();
    await Promise.all([refreshAll(), loadLikedTracks(), loadActivityData()]);
}

/**
 * Disconnect from the custom server.
 */
export async function disconnectCustomServer(): Promise<void> {
    if (!isTauri()) return;

    try {
        sessionStorage.setItem('audion_auth_logged_out', 'true');
    } catch {
        // ignore
    }

    // Clear custom server data before loading local data
    await clearLibrary();
    clearActivityData();
    likedTrackIds.set(new Set());

    await invoke('server_disconnect');
    customServerStatus.set(defaultCustomServerStatus);
    await refreshAuthState();
    await Promise.all([refreshAll(), loadLikedTracks(), loadActivityData()]);
}


