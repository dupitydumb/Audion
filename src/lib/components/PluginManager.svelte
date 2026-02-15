<script lang="ts">
  import { onMount } from "svelte";
  import {
    pluginStore,
    curatedPlugins,
    communityPlugins,
    type PluginInfo,
  } from "$lib/stores/plugin-store";
  import type { MarketplacePlugin } from "$lib/plugins/marketplace";
  import {
    PLUGIN_PERMISSIONS,
    getPermissionDescription,
  } from "$lib/plugins/schema";
  import { addToast } from "$lib/stores/toast";

  // Local state
  let newCommunityUrl = "";
  let showPermissionModal = false;
  let selectedPlugin: MarketplacePlugin | null = null;
  let pendingPermissions: string[] = [];
  let searchQuery = "";
  let activeTab: "curated" | "community" | "installed" = "curated";

  onMount(async () => {
    await pluginStore.init();
    await pluginStore.refreshMarketplace();
  });

  function handleSearch() {
    pluginStore.setSearchQuery(searchQuery);
  }

  function normalizeGitHubUrl(url: string): string {
    // Remove trailing slashes
    let normalized = url.trim().replace(/\/+$/, '');
    
    // Remove .git suffix
    normalized = normalized.replace(/\.git$/, '');
    
    // Convert blob/main/plugin.json URLs to repo URLs
    normalized = normalized.replace(/\/blob\/[^/]+\/.*$/, '');
    
    // Convert to standard github.com format (in case of www or other variations)
    normalized = normalized.replace(/^https?:\/\/(www\.)?github\.com\//, 'https://github.com/');
    
    return normalized;
  }

  function handleAddCommunityUrl() {
    const trimmedUrl = newCommunityUrl.trim();
    
    if (!trimmedUrl) return;

    // Normalize both the new URL and existing URLs for comparison
    const normalizedNew = normalizeGitHubUrl(trimmedUrl);
    const existingNormalized = $pluginStore.communityUrls.map(url => normalizeGitHubUrl(url));

    // Check for duplicate
    if (existingNormalized.includes(normalizedNew)) {
      addToast("This plugin repository has already been added", 'error');
      return;
    }

    // Check if already installed
    if ($pluginStore.installed.some(p => normalizeGitHubUrl(p.manifest.repo || '') === normalizedNew)) {
      addToast("This plugin is already installed", 'warning');
      return;
    }

    pluginStore.addCommunityUrl(trimmedUrl); // Store original URL as entered
    newCommunityUrl = "";
    pluginStore.refreshMarketplace();
  }

  function handleRemoveCommunityUrl(url: string) {
    pluginStore.removeCommunityUrl(url);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleAddCommunityUrl();
    }
  }

  async function handleInstallClick(plugin: MarketplacePlugin) {
    // Combine regular permissions and cross-plugin access
    const hasPermissions = plugin.manifest.permissions.length > 0;
    const hasCrossPluginAccess = plugin.manifest.cross_plugin_access && plugin.manifest.cross_plugin_access.length > 0;

    if (hasPermissions || hasCrossPluginAccess) {
      selectedPlugin = plugin;
      pendingPermissions = plugin.manifest.permissions;
      showPermissionModal = true;
    } else {
      await pluginStore.installPlugin(plugin);
    }
  }

  async function handleConfirmInstall() {
    if (selectedPlugin) {
      const success = await pluginStore.installPlugin(selectedPlugin);
      if (success && pendingPermissions.length > 0) {
        await pluginStore.grantPermissions(
          selectedPlugin.manifest.name,
          pendingPermissions,
        );
      }
      closePermissionModal();
    }
  }

  function closePermissionModal() {
    showPermissionModal = false;
    selectedPlugin = null;
    pendingPermissions = [];
  }

  async function handleUninstall(name: string) {
    if (confirm(`Are you sure you want to uninstall "${name}"?`)) {
      await pluginStore.uninstallPlugin(name);
    }
  }

  async function handleToggleEnabled(plugin: PluginInfo) {
    if (plugin.enabled) {
      await pluginStore.disablePlugin(plugin.name);
    } else {
      await pluginStore.enablePlugin(plugin.name);
    }
  }

  function isInstalled(name: string): boolean {
    return $pluginStore.installed.some((p) => p.name === name);
  }

  function getInstalledVersion(name: string): string | undefined {
    return $pluginStore.installed.find((p) => p.name === name)?.manifest
      .version;
  }
</script>

<div class="plugin-view">
  <header class="view-header">
    <h1>Plugin Marketplace</h1>
    <button
      class="btn-secondary"
      on:click={() => pluginStore.refreshMarketplace()}
      disabled={$pluginStore.loading}
      title="Force update from GitHub registry"
    >
      {#if $pluginStore.loading}
        <svg
          class="animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          width="16"
          height="16"
          style="display: inline-block; margin-right: 4px;"
        >
          <circle cx="12" cy="12" r="10" stroke-width="4" opacity="0.25" />
          <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke-width="4"
            stroke-linecap="round"
          />
        </svg>
        Refreshing...
      {:else}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          width="16"
          height="16"
          style="display: inline-block; margin-right: 4px;"
        >
          <path
            d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9"
          />
        </svg>
        Fetch Plugins
      {/if}
    </button>
  </header>

  {#if $pluginStore.error}
    <div class="error-banner">
      <span>{$pluginStore.error}</span>
      <button class="btn-secondary" on:click={() => pluginStore.clearError()}>
        Dismiss
      </button>
    </div>
  {/if}

  <div class="tabs">
    <button
      class="tab"
      class:active={activeTab === "curated"}
      on:click={() => (activeTab = "curated")}
    >
      Curated
    </button>
    <button
      class="tab"
      class:active={activeTab === "community"}
      on:click={() => (activeTab = "community")}
    >
      Community
    </button>
    <button
      class="tab"
      class:active={activeTab === "installed"}
      on:click={() => (activeTab = "installed")}
    >
      Installed ({$pluginStore.installed.length})
    </button>
  </div>

  {#if activeTab === "community"}
    <div class="create-form">
      <input
        type="text"
        placeholder="Enter GitHub repository URL or plugin.json URL..."
        bind:value={newCommunityUrl}
        on:keydown={handleKeyDown}
      />
      <button class="btn-primary" on:click={handleAddCommunityUrl}>
        Add
      </button>
    </div>
  {/if}

  <div class="plugin-content">
    {#if $pluginStore.loading}
      <div class="empty-state">
        <svg
          class="animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          width="48"
          height="48"
        >
          <circle cx="12" cy="12" r="10" stroke-width="2" opacity="0.25" />
          <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <h3>Loading plugins...</h3>
      </div>
    {:else if activeTab === "curated"}
      <div class="plugin-grid">
        {#each $curatedPlugins as plugin}
          <div class="plugin-card">
            <div class="plugin-icon">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="32"
                height="32"
              >
                <path
                  d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                />
              </svg>
            </div>
            <div class="plugin-info">
              <span class="plugin-name truncate">{plugin.manifest.name}</span>
              <span class="plugin-author truncate"
                >{plugin.manifest.author} · v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate"
                >{plugin.manifest.description || "No description"}</span
              >
              <div class="plugin-badges">
                <span class="badge">{plugin.manifest.type.toUpperCase()}</span>
                {#if plugin.manifest.category}
                  <span class="badge">{plugin.manifest.category}</span>
                {/if}
                {#if plugin.verified}
                  <span class="badge badge-verified">Verified</span>
                {/if}
              </div>
            </div>
            <div class="plugin-actions">
              {#if isInstalled(plugin.manifest.name)}
                <button class="btn-secondary" disabled> Installed </button>
              {:else}
                <button
                  class="btn-primary"
                  on:click={() => handleInstallClick(plugin)}
                >
                  Install
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path
                d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
              />
            </svg>
            <h3>No curated plugins available</h3>
            <p>Check back later for new plugins</p>
          </div>
        {/each}
      </div>
    {:else if activeTab === "community"}
      <div class="plugin-grid">
        {#each $communityPlugins as plugin}
          <div class="plugin-card">
            <button 
              class="remove-btn" 
              on:click={() => handleRemoveCommunityUrl(plugin.repo)}
              title="Remove from list"
              aria-label="Remove plugin"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="plugin-icon">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="32"
                height="32"
              >
                <path
                  d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                />
              </svg>
            </div>
            <div class="plugin-info">
              <span class="plugin-name truncate">{plugin.manifest.name}</span>
              <span class="plugin-author truncate"
                >{plugin.manifest.author} · v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate"
                >{plugin.manifest.description || "No description"}</span
              >
              <div class="plugin-badges">
                <span class="badge">{plugin.manifest.type.toUpperCase()}</span>
                {#if plugin.manifest.category}
                  <span class="badge">{plugin.manifest.category}</span>
                {/if}
              </div>
            </div>
            <div class="plugin-actions">
              {#if isInstalled(plugin.manifest.name)}
                <button class="btn-secondary" disabled> Installed </button>
              {:else}
                <button
                  class="btn-primary"
                  on:click={() => handleInstallClick(plugin)}
                >
                  Install
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              />
            </svg>
            <h3>No community plugins added</h3>
            <p>Add a plugin URL above to get started</p>
          </div>
        {/each}
      </div>
    {:else if activeTab === "installed"}
      <div class="plugin-grid">
        {#each $pluginStore.installed as plugin}
          <div class="plugin-card">
            <div class="plugin-icon">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="32"
                height="32"
              >
                <path
                  d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                />
              </svg>
            </div>
            <div class="plugin-info">
              <span class="plugin-name truncate">{plugin.name}</span>
              <span class="plugin-author truncate"
                >v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate"
                >{plugin.manifest.description || "No description"}</span
              >
              <div class="plugin-badges">
                <span class="badge">{plugin.manifest.type.toUpperCase()}</span>
                {#if plugin.enabled}
                  <span class="badge badge-active">Active</span>
                {/if}
              </div>
            </div>
            <div class="plugin-actions">
              <button
                class={plugin.enabled ? "btn-secondary" : "btn-primary"}
                on:click={() => handleToggleEnabled(plugin)}
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </button>
              <button
                class="btn-danger"
                on:click={() => handleUninstall(plugin.name)}
              >
                Uninstall
              </button>
              {#if plugin.manifest.repo}
                <button
                  class="btn-secondary"
                  on:click={async () => {
                    if (
                      confirm(
                        `Are you sure you want to reinstall "${plugin.name}"?`,
                      )
                    ) {
                      await pluginStore.reinstallPlugin(plugin.name);
                    }
                  }}
                >
                  Reinstall
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path
                d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
              />
            </svg>
            <h3>No plugins installed</h3>
            <p>Browse the marketplace to find plugins</p>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Permission Modal -->
{#if showPermissionModal && selectedPlugin}
  <div
    class="modal-overlay"
    on:click={closePermissionModal}
    role="dialog"
    aria-modal="true"
  >
    <div class="modal" on:click|stopPropagation role="document">
      <h2>Permission Review</h2>
      <p class="modal-desc">
        <strong>{selectedPlugin.manifest.name}</strong> requests the following permissions:
      </p>
      
      <!-- Regular Permissions -->
      {#if pendingPermissions.length > 0}
        <div class="permission-section">
          <h3 class="section-title">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
            </svg>
            System Permissions
          </h3>
          <div class="permission-list">
            {#each pendingPermissions as permission}
              <div class="permission-item">
                <span class="permission-name">{permission}</span>
                <span class="permission-desc"
                  >{getPermissionDescription(permission)}</span
                >
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Cross-Plugin Access Permissions -->
      {#if selectedPlugin.manifest.cross_plugin_access && selectedPlugin.manifest.cross_plugin_access.length > 0}
        <div class="permission-section">
          <h3 class="section-title">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Plugin Integration
          </h3>
          <div class="cross-plugin-list">
            {#each selectedPlugin.manifest.cross_plugin_access as access}
              <div class="cross-plugin-item">
                <div class="cross-plugin-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-width="2" stroke-linejoin="round"/>
                  </svg>
                  <span class="target-plugin">{access.plugin}</span>
                </div>
                <div class="method-list">
                  {#each access.methods as method}
                    <span class="method-badge">{method}</span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="modal-actions">
        <button class="btn-secondary" on:click={closePermissionModal}>
          Cancel
        </button>
        <button class="btn-primary" on:click={handleConfirmInstall}>
          Grant & Install
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .plugin-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: var(--spacing-md);
    overflow: hidden;
  }

  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-lg);
    flex-shrink: 0;
  }

  .view-header h1 {
    font-size: 2rem;
    font-weight: 700;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    color: #ef4444;
    margin-bottom: var(--spacing-md);
    flex-shrink: 0;
  }

  .tabs {
    display: flex;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-sm);
    flex-shrink: 0;
  }

  .tab {
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    transition: all var(--transition-fast);
  }

  .tab:hover {
    color: var(--text-primary);
    background-color: var(--bg-elevated);
  }

  .tab.active {
    color: var(--accent-primary);
    background-color: var(--bg-surface);
  }

  .create-form {
    display: flex;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-lg);
    padding: var(--spacing-md);
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .create-form input {
    flex: 1;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .create-form input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .create-form input::placeholder {
    color: var(--text-subdued);
  }

  .plugin-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: calc(var(--player-height) + var(--spacing-lg));
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
  }

  @media (max-width: 768px) {
    .plugin-content {
      padding-bottom: calc(var(--mobile-bottom-inset, 130px) + var(--spacing-xl));
    }
  }

  .plugin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--spacing-lg);
  }

  .plugin-card {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    transition: background-color var(--transition-normal);
    position: relative;
  }

  .plugin-card:hover {
    background-color: var(--bg-surface);
  }

  .plugin-card:hover .remove-btn {
    opacity: 1;
  }

  .remove-btn {
    position: absolute;
    top: var(--spacing-xs);
    right: var(--spacing-xs);
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background-color: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all var(--transition-fast);
    z-index: 10;
  }

  .remove-btn:hover {
    background-color: rgba(239, 68, 68, 0.2);
    transform: scale(1.1);
  }

  .plugin-icon {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-md);
    background: linear-gradient(
      135deg,
      var(--bg-highlight) 0%,
      var(--bg-surface) 100%
    );
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
  }

  .plugin-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    flex: 1;
  }

  .plugin-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .plugin-author {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .plugin-desc {
    font-size: 0.8125rem;
    color: var(--text-subdued);
    line-height: 1.4;
  }

  .plugin-badges {
    display: flex;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
    margin-top: var(--spacing-xs);
  }

  .badge {
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    background-color: var(--bg-surface);
    color: var(--text-secondary);
  }

  .badge-verified {
    background-color: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .badge-active {
    background-color: rgba(99, 102, 241, 0.15);
    color: var(--accent-primary);
  }

  .plugin-actions {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .btn-primary {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    border-radius: var(--radius-sm);
    font-weight: 500;
    font-size: 0.875rem;
    transition: opacity var(--transition-fast);
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-weight: 500;
    font-size: 0.875rem;
    transition: background-color var(--transition-fast);
  }

  .btn-secondary:hover {
    background-color: var(--bg-highlight);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-radius: var(--radius-sm);
    font-weight: 500;
    font-size: 0.875rem;
    transition: background-color var(--transition-fast);
  }

  .btn-danger:hover {
    background-color: rgba(239, 68, 68, 0.25);
  }

  .empty-state {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xl);
    color: var(--text-subdued);
    text-align: center;
    gap: var(--spacing-sm);
  }

  .empty-state h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: 0.875rem;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-lg);
    padding: var(--spacing-lg);
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    border: 1px solid var(--border-color);
  }

  .modal h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
  }

  .modal-desc {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: var(--spacing-lg);
  }

  .permission-section {
    margin-bottom: var(--spacing-lg);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--spacing-sm);
  }

  .permission-list {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm);
    max-height: 150px;
    overflow-y: auto;
  }

  .permission-item {
    padding: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .permission-item:last-child {
    border-bottom: none;
  }

  .permission-name {
    display: block;
    font-weight: 500;
    color: var(--accent-primary);
    font-size: 0.875rem;
  }

  .permission-desc {
    display: block;
    font-size: 0.75rem;
    color: var(--text-subdued);
    margin-top: 2px;
  }

  /* Cross-Plugin Permissions Styling */
  .cross-plugin-list {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .cross-plugin-item {
    background: linear-gradient(
      135deg,
      rgba(99, 102, 241, 0.05) 0%,
      rgba(139, 92, 246, 0.05) 100%
    );
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: var(--radius-sm);
    padding: var(--spacing-sm);
  }

  .cross-plugin-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);
  }

  .target-plugin {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--accent-primary);
  }

  .method-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    padding-left: 22px;
  }

  .method-badge {
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 500;
    background-color: rgba(99, 102, 241, 0.15);
    color: var(--accent-primary);
    font-family: monospace;
  }

  .modal-actions {
    display: flex;
    gap: var(--spacing-sm);
    justify-content: flex-end;
    margin-top: var(--spacing-lg);
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .plugin-grid {
      grid-template-columns: 1fr;
      gap: var(--spacing-md);
    }

    .remove-btn {
      opacity: 1;
    }
  }
</style>
