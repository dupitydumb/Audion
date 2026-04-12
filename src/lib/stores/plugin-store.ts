// Plugin state store
import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AudionPluginManifest } from '../plugins/schema';
import type { MarketplacePlugin } from '../plugins/marketplace';
import { fetchMarketplacePlugins, searchPlugins, filterByCategory } from '../plugins/marketplace';
import { PluginRuntime, setGlobalPermissionManager } from '../plugins/runtime';

const COMMUNITY_URLS_KEY = 'audion_community_plugin_urls';
function loadCommunityUrls(): string[] {
    try {
        const stored = localStorage.getItem(COMMUNITY_URLS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}
function saveCommunityUrls(urls: string[]) {
    try {
        localStorage.setItem(COMMUNITY_URLS_KEY, JSON.stringify(urls));
    } catch (err) {
        console.error('Failed to save community URLs:', err);
    }
}

// Types matching Rust backend
export interface PluginInfo {
    name: string;
    enabled: boolean;
    manifest: AudionPluginManifest;
    granted_permissions: string[];
}

export interface PluginUpdateInfo {
    name: string;
    current_version: string;
    new_version: string;
    repo_url: string;
}

export interface PluginStoreState {
    installed: PluginInfo[];
    marketplace: MarketplacePlugin[];
    communityUrls: string[];
    loading: boolean;
    error: string | null;
    searchQuery: string;
    categoryFilter: string;
    activeTab: 'curated' | 'community' | 'installed';
    pendingUpdates: PluginUpdateInfo[];
    failedPlugins: PluginError[];  // Track plugins that failed to load
}

export interface PluginError {
    name: string;
    error: string;
    timestamp: number;
}

// Initial state
const initialState: PluginStoreState = {
    installed: [],
    marketplace: [],
    communityUrls: loadCommunityUrls(),
    loading: false,
    error: null,
    searchQuery: '',
    categoryFilter: 'all',
    activeTab: 'curated',
    pendingUpdates: [],
    failedPlugins: []
};

// Create the store
function createPluginStore() {
    const { subscribe, set, update } = writable<PluginStoreState>(initialState);

    let pluginDir: string = '';
    let runtime: PluginRuntime | null = null;

    // Helper: Record a plugin loading failure
    const recordPluginFailure = (name: string, error: Error | unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[PluginStore] Failed to load ${name}:`, error);

        update(s => ({
            ...s,
            failedPlugins: [
                ...s.failedPlugins.filter(f => f.name !== name), // Remove old error for this plugin
                {
                    name,
                    error: errorMessage,
                    timestamp: Date.now()
                }
            ]
        }));
    };

    // Helper: Clear failure record for a plugin (on successful load)
    const clearPluginFailure = (name: string) => {
        update(s => ({
            ...s,
            failedPlugins: s.failedPlugins.filter(f => f.name !== name)
        }));
    };

    // Helper: Set critical error (stops user, displayed prominently)
    const setCriticalError = (message: string, error?: Error | unknown) => {
        const fullMessage = error instanceof Error
            ? `${message}: ${error.message}`
            : message;
        console.error('[PluginStore] Critical error:', fullMessage);
        update(s => ({ ...s, error: fullMessage, loading: false }));
    };

    return {
        subscribe,

        // Initialize the store
        async init() {
            if (runtime) {
                console.warn('[PluginStore] init() called more than once — ignoring');
                return;
            }
            update(s => ({ ...s, loading: true, error: null, failedPlugins: [] }));

            try {
                // Get plugin directory from backend
                pluginDir = await invoke<string>('get_plugin_dir');

                // Initialize runtime with plugin directory
                // NOTE: We pass the RAW filesystem path here, not convertFileSrc()
                // The backend needs the real path for file operations
                // convertFileSrc() is only used when loading plugin files in the browser
                runtime = new PluginRuntime({
                    pluginDir: pluginDir,  // Raw path for backend operations
                    onError: (name, err) => {
                        console.error(`[Plugin:${name}] Runtime error:`, err);
                        recordPluginFailure(name, err);
                    },
                    onLoad: (plugin) => {
                        console.log(`[PluginStore] Successfully loaded ${plugin.manifest.name}`);
                        clearPluginFailure(plugin.manifest.name);
                    }
                });

                setGlobalPermissionManager(runtime.permissionManager);

                // Load installed plugins from backend
                const installed = await invoke<PluginInfo[]>('list_plugins', { pluginDir });

                update(s => ({
                    ...s,
                    installed,
                    loading: false
                }));

                // Auto-load enabled plugins with individual try-catch
                for (const plugin of installed) {
                    if (plugin.enabled) {
                        try {
                            // Grant permissions before loading - use backend's granted_permissions
                            // Also grant manifest permissions as fallback (ensures new permissions are available)
                            const allPermissions = [
                                ...plugin.granted_permissions,
                                ...(plugin.manifest.permissions || [])
                            ];
                            const uniquePermissions = [...new Set(allPermissions)];
                            runtime.grantPermissions(plugin.name, uniquePermissions);

                            await runtime.loadPlugin(plugin.manifest);
                            runtime.enablePlugin(plugin.name);

                            // Successfully loaded - clear any previous failures
                            clearPluginFailure(plugin.name);
                        } catch (err) {
                            // Non-critical: one plugin failed, continue with others
                            recordPluginFailure(plugin.name, err);
                        }
                    }
                }

                // Check for plugin updates in background
                this.checkAndApplyUpdates();
            } catch (err) {
                // Critical error: couldn't initialize plugin system at all
                setCriticalError('Failed to initialize plugin system', err);
            }
        },

        // Check for updates and update store state (does not auto-apply)
        async checkAndApplyUpdates() {
            try {
                const updates = await invoke<PluginUpdateInfo[]>('check_plugin_updates', { pluginDir });

                if (updates.length > 0) {
                    console.log(`[PluginStore] Found ${updates.length} plugin update(s):`, updates);
                    update(s => ({ ...s, pendingUpdates: updates }));
                } else {
                    console.log('[PluginStore] All plugins are up to date');
                }
            } catch (err) {
                console.error('[PluginStore] Failed to check for updates:', err);
            }
        },

        // Apply all pending updates
        async applyPendingUpdates() {
            const state = get({ subscribe });
            const updates = state.pendingUpdates;

            if (updates.length === 0) return;

            update(s => ({ ...s, loading: true }));

            for (const updateInfo of updates) {
                try {
                    console.log(`[PluginStore] Updating ${updateInfo.name}...`);
                    await this.updatePlugin(updateInfo.name);
                } catch (err) {
                    console.error(`[PluginStore] Failed to update ${updateInfo.name}:`, err);
                }
            }

            update(s => ({ ...s, loading: false, pendingUpdates: [] }));
        },

        // Clear pending updates (skip for now)
        clearPendingUpdates() {
            update(s => ({ ...s, pendingUpdates: [] }));
        },


        // Check for available plugin updates
        async checkForUpdates(): Promise<PluginUpdateInfo[]> {
            try {
                return await invoke<PluginUpdateInfo[]>('check_plugin_updates', { pluginDir });
            } catch (err) {
                console.error('[PluginStore] Failed to check for updates:', err);
                return [];
            }
        },

        // Update a specific plugin
        async updatePlugin(name: string): Promise<boolean> {
            try {
                const updatedInfo = await invoke<PluginInfo>('update_plugin', { name, pluginDir });

                // Update store state
                update(s => ({
                    ...s,
                    installed: s.installed.map(p =>
                        p.name === name ? updatedInfo : p
                    )
                }));

                // Reload plugin in runtime if it was enabled
                if (updatedInfo.enabled && runtime) {
                    // Unload old version first
                    await runtime.unloadPlugin(name);

                    // IMPORTANT: Clear permission cache after update
                    runtime.permissionManager.clearCache(name);

                    // Grant permissions and reload
                    const allPermissions = [
                        ...updatedInfo.granted_permissions,
                        ...(updatedInfo.manifest.permissions || [])
                    ];
                    const uniquePermissions = [...new Set(allPermissions)];
                    runtime.grantPermissions(name, uniquePermissions);

                    try {
                        await runtime.loadPlugin(updatedInfo.manifest);
                        runtime.enablePlugin(name);
                        clearPluginFailure(name);
                    } catch (err) {
                        recordPluginFailure(name, err);
                        throw err; // Re-throw to be caught by outer catch
                    }
                }

                return true;
            } catch (err) {
                const errorMsg = `Failed to update plugin ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Refresh marketplace plugins
        async refreshMarketplace() {
            update(s => ({ ...s, loading: true, error: null }));

            try {
                const state = get({ subscribe });
                const marketplace = await fetchMarketplacePlugins(state.communityUrls);

                update(s => ({
                    ...s,
                    marketplace,
                    loading: false
                }));
            } catch (err) {
                const errorMsg = 'Failed to fetch marketplace';
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
            }
        },

        // Add community plugin URL
        addCommunityUrl(url: string) {
            update(s => {
                const newUrls = [...s.communityUrls, url];
                saveCommunityUrls(newUrls); // Persist to localStorage
                return { ...s, communityUrls: newUrls };
            });
        },

        // Remove community plugin URL
        removeCommunityUrl(url: string) {
            update(s => {
                const newUrls = s.communityUrls.filter(u => u !== url);
                saveCommunityUrls(newUrls); // Persist to localStorage
                return { ...s, communityUrls: newUrls };
            });
        },

        // Install a plugin
        async installPlugin(plugin: MarketplacePlugin): Promise<boolean> {
            if (!plugin.repo) {
                setCriticalError('Plugin has no repository URL');
                return false;
            }

            update(s => ({ ...s, loading: true, error: null }));

            try {
                const info = await invoke<PluginInfo>('install_plugin', {
                    repoUrl: plugin.repo,
                    pluginDir
                });

                update(s => ({
                    ...s,
                    installed: [...s.installed, info],
                    loading: false
                }));

                // Auto-enable the newly installed plugin
                try {
                    await this.enablePlugin(info.name);
                    clearPluginFailure(info.name);
                } catch (err) {
                    recordPluginFailure(info.name, err);
                    console.error(`[PluginStore] Failed to auto-enable ${info.name}:`, err);
                }

                return true;
            } catch (err) {
                const errorMsg = `Failed to install ${plugin.manifest.name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Uninstall a plugin
        async uninstallPlugin(name: string): Promise<boolean> {
            update(s => ({ ...s, loading: true, error: null }));

            try {
                // Clear permission cache before uninstalling
                if (runtime) {
                    runtime.permissionManager.clearCache(name);
                    // Also unload from runtime if loaded
                    if (runtime.getPlugin(name)) {
                        await runtime.unloadPlugin(name);
                    }
                }

                await invoke('uninstall_plugin', { name, pluginDir });

                update(s => ({
                    ...s,
                    installed: s.installed.filter(p => p.name !== name),
                    loading: false
                }));

                // Clear any failure records
                clearPluginFailure(name);

                return true;
            } catch (err) {
                const errorMsg = `Failed to uninstall ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Reinstall a plugin
        async reinstallPlugin(name: string): Promise<boolean> {
            const state = get({ subscribe });
            const plugin = state.installed.find(p => p.name === name);

            if (!plugin) {
                setCriticalError(`Plugin ${name} not found`);
                return false;
            }

            const repoUrl = plugin.manifest.repo;
            if (!repoUrl) {
                setCriticalError(`Plugin ${name} does not have a repository URL`);
                return false;
            }

            update(s => ({ ...s, loading: true, error: null }));

            try {
                // First uninstall
                console.log(`[PluginStore] Reinstalling ${name}: Uninstalling first...`);

                // Clear permission cache before uninstalling
                if (runtime) {
                    runtime.permissionManager.clearCache(name);
                    if (runtime.getPlugin(name)) {
                        await runtime.unloadPlugin(name);
                    }
                }

                await invoke('uninstall_plugin', { name, pluginDir });

                // Then install
                console.log(`[PluginStore] Reinstalling ${name}: Installing from ${repoUrl}...`);
                const info = await invoke<PluginInfo>('install_plugin', {
                    repoUrl,
                    pluginDir
                });

                update(s => ({
                    ...s,
                    installed: [...state.installed.filter(p => p.name !== name), info],
                    loading: false
                }));

                // Auto-enable
                try {
                    await this.enablePlugin(info.name);
                    clearPluginFailure(name);
                } catch (err) {
                    recordPluginFailure(name, err);
                    console.error(`[PluginStore] Failed to auto-enable ${info.name}:`, err);
                }

                return true;
            } catch (err) {
                const errorMsg = `Failed to reinstall ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);

                // Refresh list just in case we are in a weird state
                try {
                    const installed = await invoke<PluginInfo[]>('list_plugins', { pluginDir });
                    update(s => ({ ...s, installed }));
                } catch (e) { /* ignore */ }

                return false;
            }
        },

        // Enable a plugin
        async enablePlugin(name: string): Promise<boolean> {
            try {
                await invoke('enable_plugin', { name, pluginDir });

                // Load plugin via runtime
                const state = get({ subscribe });
                const plugin = state.installed.find(p => p.name === name);

                if (plugin && runtime) {
                    // Grant permissions and load - include manifest permissions as fallback
                    const allPermissions = [
                        ...plugin.granted_permissions,
                        ...(plugin.manifest.permissions || [])
                    ];
                    const uniquePermissions = [...new Set(allPermissions)];
                    runtime.grantPermissions(name, uniquePermissions);

                    // Check if already loaded in runtime
                    if (!runtime.getPlugin(name)) {
                        try {
                            await runtime.loadPlugin(plugin.manifest);
                            clearPluginFailure(name);
                        } catch (err) {
                            recordPluginFailure(name, err);
                            throw err; // Re-throw to be caught by outer catch
                        }
                    }
                    runtime.enablePlugin(name);
                }

                update(s => ({
                    ...s,
                    installed: s.installed.map(p =>
                        p.name === name ? { ...p, enabled: true } : p
                    )
                }));

                return true;
            } catch (err) {
                const errorMsg = `Failed to enable ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Disable a plugin
        async disablePlugin(name: string): Promise<boolean> {
            try {
                await invoke('disable_plugin', { name, pluginDir });

                // Disable in runtime
                if (runtime && runtime.getPlugin(name)) {
                    await runtime.unloadPlugin(name);
                }

                update(s => ({
                    ...s,
                    installed: s.installed.map(p =>
                        p.name === name ? { ...p, enabled: false } : p
                    )
                }));

                return true;
            } catch (err) {
                const errorMsg = `Failed to disable ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Grant permissions to a plugin
        async grantPermissions(name: string, permissions: string[]): Promise<boolean> {
            try {
                await invoke('grant_permissions', { name, pluginDir, permissions });

                update(s => ({
                    ...s,
                    installed: s.installed.map(p =>
                        p.name === name
                            ? { ...p, granted_permissions: [...new Set([...p.granted_permissions, ...permissions])] }
                            : p
                    )
                }));

                return true;
            } catch (err) {
                const errorMsg = `Failed to grant permissions to ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Revoke permissions from a plugin
        async revokePermissions(name: string, permissions: string[]): Promise<boolean> {
            try {
                await invoke('revoke_permissions', { name, pluginDir, permissions });

                update(s => ({
                    ...s,
                    installed: s.installed.map(p =>
                        p.name === name
                            ? { ...p, granted_permissions: p.granted_permissions.filter(perm => !permissions.includes(perm)) }
                            : p
                    )
                }));

                return true;
            } catch (err) {
                const errorMsg = `Failed to revoke permissions from ${name}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Set search query
        setSearchQuery(query: string) {
            update(s => ({ ...s, searchQuery: query }));
        },

        // Set category filter
        setCategoryFilter(category: string) {
            update(s => ({ ...s, categoryFilter: category }));
        },

        // Set active tab
        setActiveTab(tab: 'curated' | 'community' | 'installed') {
            update(s => ({ ...s, activeTab: tab }));
        },

        // Clear error
        clearError() {
            update(s => ({ ...s, error: null }));
        },

        // Check if a plugin is installed
        isInstalled(name: string): boolean {
            const state = get({ subscribe });
            return state.installed.some(p => p.name === name);
        },

        // Get plugin by name
        getInstalledPlugin(name: string): PluginInfo | undefined {
            const state = get({ subscribe });
            return state.installed.find(p => p.name === name);
        },

        // Get failed plugins
        getFailedPlugins(): PluginError[] {
            const state = get({ subscribe });
            return state.failedPlugins;
        },

        // Clear all failed plugin errors
        clearFailedPlugins() {
            update(s => ({ ...s, failedPlugins: [] }));
        },

        // Retry loading a failed plugin
        async retryFailedPlugin(name: string): Promise<boolean> {
            clearPluginFailure(name);
            return await this.enablePlugin(name);
        },

        // Get runtime for stream resolution
        getRuntime(): PluginRuntime | null {
            return runtime;
        }
    };
}

export const pluginStore = createPluginStore();

// Derived stores for filtered views
export const filteredMarketplace = derived(
    pluginStore,
    ($store) => {
        let plugins = $store.marketplace;

        // Apply search
        if ($store.searchQuery) {
            plugins = searchPlugins(plugins, $store.searchQuery);
        }

        // Apply category filter
        plugins = filterByCategory(plugins, $store.categoryFilter);

        return plugins;
    }
);

export const curatedPlugins = derived(
    filteredMarketplace,
    ($plugins) => $plugins.filter(p => p.curated)
);

export const communityPlugins = derived(
    filteredMarketplace,
    ($plugins) => $plugins.filter(p => !p.curated)
);

export const enabledPlugins = derived(
    pluginStore,
    ($store) => $store.installed.filter(p => p.enabled)
);
