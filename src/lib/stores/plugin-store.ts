// Plugin state store
import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AudionPluginManifest } from '../plugins/schema';
import {
    fetchMarketplacePlugins,
    searchPlugins,
    filterByCategory,
    DEFAULT_REGISTRIES,
    type MarketplacePlugin,
    type CommunityRegistry,
} from '../plugins/marketplace';
import { PluginRuntime, setGlobalPermissionManager } from '../plugins/runtime';
import { pingPluginInstall, fetchPluginStats } from '../api/audion-api';

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

const REGISTRIES_KEY = 'audion_custom_registries';
function loadRegistries(): CommunityRegistry[] {
    try {
        const stored = localStorage.getItem(REGISTRIES_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {}
    return DEFAULT_REGISTRIES;
}
function saveRegistries(registries: CommunityRegistry[]) {
    try {
        localStorage.setItem(REGISTRIES_KEY, JSON.stringify(registries));
    } catch (err) {
        console.error('Failed to save registries:', err);
    }
}

// Types matching Rust backend
export interface PluginInfo {
    name: string;
    enabled: boolean;
    manifest: AudionPluginManifest;
    granted_permissions: string[];
    folder_name: string;
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
    registries: CommunityRegistry[];
    loading: boolean;
    error: string | null;
    searchQuery: string;
    categoryFilter: string;
    sortBy: 'stars' | 'downloads' | 'name' | 'updated';
    activeTab: 'curated' | 'community' | 'installed';
    pendingUpdates: PluginUpdateInfo[];
    failedPlugins: PluginError[];  // Track plugins that failed to load
    pluginDir: string | null;      // Path to plugins directory
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
    registries: loadRegistries(),
    loading: false,
    error: null,
    searchQuery: '',
    categoryFilter: 'all',
    sortBy: 'stars',
    activeTab: 'curated',
    pendingUpdates: [],
    failedPlugins: [],
    pluginDir: null
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
            const self = this;
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
                    loading: false,
                    pluginDir
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

                // Listen to plugin deep-link install requests
                const { listen } = await import('@tauri-apps/api/event');
                listen<string>('plugin://install-request', async (event) => {
                    const repoUrl = event.payload;
                    console.log('[PluginStore] Received deep link install request for:', repoUrl);

                    const { confirm } = await import('./dialogs');
                    const confirmed = await confirm(`Do you want to install the plugin from repository:\n\n${repoUrl}?`, {
                        title: 'Install Plugin',
                        confirmLabel: 'Install',
                        cancelLabel: 'Cancel'
                    });

                    if (confirmed) {
                        await self.installPluginFromRepo(repoUrl);
                    }
                });

                // Check if there was a pending plugin install from cold start
                try {
                    const pendingUrl = await invoke<string | null>('get_pending_plugin_install');
                    if (pendingUrl) {
                        console.log('[PluginStore] Found pending deep link install request on startup:', pendingUrl);
                        const { confirm } = await import('./dialogs');
                        const confirmed = await confirm(`Do you want to install the plugin from repository:\n\n${pendingUrl}?`, {
                            title: 'Install Plugin',
                            confirmLabel: 'Install',
                            cancelLabel: 'Cancel'
                        });

                        if (confirmed) {
                            await self.installPluginFromRepo(pendingUrl);
                        }
                    }
                } catch (err) {
                    console.error('[PluginStore] Failed to check for pending deep link install:', err);
                }
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
                // Clear cache to force latest fetch from GitHub / registries
                const { clearPluginCache } = await import('../plugins/marketplace');
                clearPluginCache();

                const currentState = get({ subscribe });
                // Fetch registry from all enabled endpoints and stats from VPS in parallel
                const [plugins, vpsStats] = await Promise.all([
                    fetchMarketplacePlugins(currentState.communityUrls, currentState.registries),
                    fetchPluginStats()
                ]);

                // Merge VPS stats into registry data
                const mergedPlugins = plugins.map(p => {
                    const stats = vpsStats.find(s => s.pluginName === p.manifest.name);
                    if (stats) {
                        // Use VPS count if it's higher (GitHub only tracks manual release downloads)
                        p.downloads = Math.max(p.downloads || 0, stats.installCount || 0);
                    }
                    return p;
                });

                update(s => ({ ...s, marketplace: mergedPlugins, loading: false }));
            } catch (err: any) {
                update(s => ({ ...s, error: err.message, loading: false }));
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

        // Add custom community registry
        addRegistry(name: string, url: string) {
            update(s => {
                const newRegistry: CommunityRegistry = {
                    id: `reg-${Date.now()}`,
                    name: name.trim() || 'Custom Registry',
                    url: url.trim(),
                    enabled: true,
                    isDefault: false
                };
                const registries = [...s.registries, newRegistry];
                saveRegistries(registries);
                return { ...s, registries };
            });
            this.refreshMarketplace();
        },

        // Remove custom registry
        removeRegistry(id: string) {
            update(s => {
                const registries = s.registries.filter(r => r.id !== id || r.isDefault);
                saveRegistries(registries);
                return { ...s, registries };
            });
            this.refreshMarketplace();
        },

        // Toggle registry active state
        toggleRegistry(id: string, enabled?: boolean) {
            update(s => {
                const registries = s.registries.map(r => {
                    if (r.id === id) {
                        return { ...r, enabled: enabled !== undefined ? enabled : !r.enabled };
                    }
                    return r;
                });
                saveRegistries(registries);
                return { ...s, registries };
            });
            this.refreshMarketplace();
        },

        // Install a plugin
        async installPlugin(plugin: MarketplacePlugin): Promise<boolean> {
            if (!plugin.repo) {
                setCriticalError('Plugin has no repository URL');
                return false;
            }

            update(s => ({ ...s, loading: true, error: null }));

            try {
                const expectedSha256 = (plugin.manifest as any)?.sha256 || (plugin.manifest as any)?.integrity || plugin.sha256 || null;
                const info = await invoke<PluginInfo>('install_plugin', {
                    repoUrl: plugin.repo,
                    pluginDir,
                    expectedSha256
                });

                update(s => ({
                    ...s,
                    installed: [...s.installed, info],
                    loading: false
                }));

                // Ping telemetry (fire and forget)
                pingPluginInstall(plugin.manifest.name);

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

        // Install a plugin directly from repository URL
        async installPluginFromRepo(repoUrl: string, expectedSha256?: string): Promise<boolean> {
            update(s => ({ ...s, loading: true, error: null }));

            try {
                const info = await invoke<PluginInfo>('install_plugin', {
                    repoUrl,
                    pluginDir,
                    expectedSha256: expectedSha256 || null
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
            } catch (err: any) {
                const errorMsg = `Failed to install plugin from repository`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return false;
            }
        },

        // Install a plugin from a local package (.ext, .audion-ext, .sflx, .js, .zip)
        async installPluginFromFile(filePath: string): Promise<PluginInfo | null> {
            update(s => ({ ...s, loading: true, error: null }));

            try {
                const info = await invoke<PluginInfo>('install_plugin_package', {
                    filePath,
                    pluginDir
                });

                update(s => ({
                    ...s,
                    installed: [...s.installed.filter(p => p.name !== info.name), info],
                    loading: false
                }));

                // Auto-enable newly installed plugin
                try {
                    await this.enablePlugin(info.name);
                    clearPluginFailure(info.name);
                } catch (err) {
                    recordPluginFailure(info.name, err);
                    console.error(`[PluginStore] Failed to auto-enable ${info.name}:`, err);
                }

                return info;
            } catch (err: any) {
                const errorMsg = `Failed to install plugin from file: ${err instanceof Error ? err.message : String(err)}`;
                console.error(`[PluginStore] ${errorMsg}:`, err);
                setCriticalError(errorMsg, err);
                return null;
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

        // Set sort by
        setSortBy(sort: 'stars' | 'downloads' | 'name' | 'updated') {
            update(s => ({ ...s, sortBy: sort }));
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

        // Apply sorting
        plugins = [...plugins].sort((a, b) => {
            if ($store.sortBy === 'stars') {
                return (b.stars || 0) - (a.stars || 0);
            } else if ($store.sortBy === 'downloads') {
                return (b.downloads || 0) - (a.downloads || 0);
            } else if ($store.sortBy === 'updated') {
                const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
                const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
                return dateB - dateA;
            } else {
                return a.manifest.name.localeCompare(b.manifest.name);
            }
        });

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
