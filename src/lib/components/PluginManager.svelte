<script lang="ts">
  import { onMount } from "svelte";
  import { _ } from "svelte-i18n";
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
  import { confirm } from "$lib/stores/dialogs";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
  import Icon from "$lib/components/Icon.svelte";

  let pluginContentEl: HTMLDivElement;
  let scrollRestored = false;
  let currentScrollTop = 0;

  onDestroy(() => {
    saveScroll("plugins", currentScrollTop);
  });

  // Local state
  let newCommunityUrl = "";
  let showPermissionModal = false;
  let selectedPlugin: MarketplacePlugin | null = null;
  let pendingPermissions: string[] = [];
  let searchQuery = "";
  let activeTab: "curated" | "community" | "installed" = "curated";

  // Install State
  type InstallState = "idle" | "loading" | "success" | "error";
  let installState: InstallState = "idle";

  // Categories for filtering
  const categories = [
    { id: "all", key: "pluginManager.categoryAll" },
    { id: "audio", key: "pluginManager.categoryAudio" },
    { id: "ui", key: "pluginManager.categoryUi" },
    { id: "lyrics", key: "pluginManager.categoryLyrics" },
    { id: "library", key: "pluginManager.categoryLibrary" },
    { id: "utility", key: "pluginManager.categoryUtility" },
    { id: "appearance", key: "pluginManager.categoryAppearance" },
    { id: "social", key: "pluginManager.categorySocial" },
    { id: "sync", key: "pluginManager.categorySync" },
  ];

  let confettiParticles: {
    x: number;
    y: number;
    color: string;
    angle: number;
    speed: number;
  }[] = [];
  let installBtnEl: HTMLButtonElement;

  onMount(async () => {
    await pluginStore.refreshMarketplace();
    const saved = getScroll("plugins");
    if (saved > 0 && pluginContentEl) {
      pluginContentEl.scrollTop = saved;
    }
    scrollRestored = true;
  });

  async function openPluginsFolder() {
    try {
      const pluginDir = await invoke<string>("get_plugin_dir");
      if (pluginDir) {
        await revealItemInDir(pluginDir);
      }
    } catch (err) {
      console.error("Failed to open plugins folder:", err);
      addToast(`Failed to open folder: ${err}`, "error");
    }
  }

  function handleSearch() {
    pluginStore.setSearchQuery(searchQuery);
  }

  function normalizeGitHubUrl(url: string): string {
    // Remove trailing slashes
    let normalized = url.trim().replace(/\/+$/, "");

    // Remove .git suffix
    normalized = normalized.replace(/\.git$/, "");

    // Convert blob/main/plugin.json URLs to repo URLs
    normalized = normalized.replace(/\/blob\/[^/]+\/.*$/, "");

    // Convert to standard github.com format (in case of www or other variations)
    normalized = normalized.replace(
      /^https?:\/\/(www\.)?github\.com\//,
      "https://github.com/",
    );

    return normalized;
  }

  function handleAddCommunityUrl() {
    const trimmedUrl = newCommunityUrl.trim();

    if (!trimmedUrl) return;

    // Normalize both the new URL and existing URLs for comparison
    const normalizedNew = normalizeGitHubUrl(trimmedUrl);
    const existingNormalized = $pluginStore.communityUrls.map((url) =>
      normalizeGitHubUrl(url),
    );

    // Check for duplicate
    if (existingNormalized.includes(normalizedNew)) {
      addToast("This plugin repository has already been added", "error");
      return;
    }

    // Check if already installed
    if (
      $pluginStore.installed.some(
        (p) => normalizeGitHubUrl(p.manifest.repo || "") === normalizedNew,
      )
    ) {
      addToast("This plugin is already installed", "warning");
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
    const hasCrossPluginAccess =
      plugin.manifest.cross_plugin_access &&
      plugin.manifest.cross_plugin_access.length > 0;

    if (hasPermissions || hasCrossPluginAccess) {
      selectedPlugin = plugin;
      pendingPermissions = plugin.manifest.permissions;
      showPermissionModal = true;
    } else {
      await pluginStore.installPlugin(plugin);
    }
  }

  async function handleConfirmInstall() {
    if (installState !== "idle") return;
    installState = "loading";

    try {
      const success = await pluginStore.installPlugin(selectedPlugin!);
      if (success && pendingPermissions.length > 0) {
        await pluginStore.grantPermissions(
          selectedPlugin!.manifest.name,
          pendingPermissions,
        );
      }

      installState = "success";
      spawnConfetti();

      setTimeout(() => {
        if (pluginContentEl) saveScroll("plugins", currentScrollTop);
        closePermissionModal();
        installState = "idle";
      }, 1800);
    } catch (err) {
      installState = "error";
      setTimeout(() => {
        installState = "idle";
      }, 2500);
    }
  }

  function spawnConfetti() {
    if (!installBtnEl) return;
    const rect = installBtnEl.getBoundingClientRect();
    const colors = ["#1ed760", "#ff6b6b", "#ffd93d", "#6bceff", "#ff9f43"];
    confettiParticles = Array.from({ length: 22 }, (_, i) => ({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      color: colors[i % colors.length],
      angle: (i / 22) * 360,
      speed: 3 + Math.random() * 4,
    }));
    setTimeout(() => {
      confettiParticles = [];
    }, 1500);
  }

  function closePermissionModal() {
    showPermissionModal = false;
    selectedPlugin = null;
    pendingPermissions = [];
    installState = "idle";
    confettiParticles = [];
  }

  async function handleUninstall(name: string) {
    if (
      await confirm(`Are you sure you want to uninstall "${name}"?`, {
        title: "Uninstall Plugin",
        confirmLabel: "Uninstall",
        danger: true,
      })
    ) {
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

  function getIconUrl(plugin: MarketplacePlugin | PluginInfo): string | null {
    const manifest = plugin.manifest;

    // 1. Check if icon is already an absolute URL or data URL
    if (
      manifest.icon &&
      (manifest.icon.startsWith("http") || manifest.icon.startsWith("data:"))
    ) {
      return manifest.icon;
    }

    // 1.5 Handle inline SVG strings
    if (manifest.icon && manifest.icon.trim().startsWith("<svg")) {
      const base64 = btoa(unescape(encodeURIComponent(manifest.icon.trim())));
      return `data:image/svg+xml;base64,${base64}`;
    }

    // 2. Use icon_url if available (populated by marketplace for community plugins)
    if (manifest.icon_url) {
      return manifest.icon_url;
    }

    // 3. For installed plugins, try local path
    if ("folder_name" in plugin && $pluginStore.pluginDir) {
      if (manifest.icon && !manifest.icon.startsWith("http")) {
        // Construct local path: pluginDir/folder_name/icon
        const path = `${$pluginStore.pluginDir}/${plugin.folder_name}/${manifest.icon}`;
        return convertFileSrc(path);
      }
    }

    return null;
  }
</script>

<div class="plugin-view">
  <header class="view-header">
    <h1>{$_('pluginManager.title')}</h1>
    <div class="header-actions">
      <button
        class="btn-secondary"
        on:click={openPluginsFolder}
        title={$_('pluginManager.openFolderTitle')}
      >
        <Icon name="folder" size={16} />
        {$_('pluginManager.openFolder')}
      </button>

      <button
        class="btn-secondary"
        on:click={() => pluginStore.refreshMarketplace()}
        disabled={$pluginStore.loading}
        title="Force update from GitHub registry"
      >
        {#if $pluginStore.loading}
          <Icon name="loader" size={16} />
          {$_('pluginManager.refreshing')}
        {:else}
          <Icon name="globe" size={16} />
          {$_('pluginManager.fetchPlugins')}
        {/if}
      </button>

      {#if activeTab !== "installed"}
        <div class="sort-selector">
          <select
            value={$pluginStore.sortBy}
            on:change={(e) => pluginStore.setSortBy(e.currentTarget.value as any)}
          >
            <option value="stars">{$_('pluginManager.sortStars')}</option>
            <option value="downloads">{$_('pluginManager.sortDownloads')}</option>
            <option value="updated">{$_('pluginManager.sortUpdated')}</option>
            <option value="name">{$_('pluginManager.sortName')}</option>
          </select>
          <Icon name="chevron-down" size={14} className="select-icon" />
        </div>
      {/if}
    </div>
  </header>

  {#if $pluginStore.error}
    <div class="error-banner">
      <span>{$pluginStore.error}</span>
      <button class="btn-secondary" on:click={() => pluginStore.clearError()}>
        {$_('pluginManager.dismiss')}
      </button>
    </div>
  {/if}

  <div class="tabs">
    <button
      class="tab"
      class:active={activeTab === "curated"}
      on:click={() => (activeTab = "curated")}
    >
      {$_('pluginManager.curated')}
    </button>
    <button
      class="tab"
      class:active={activeTab === "community"}
      on:click={() => (activeTab = "community")}
    >
      {$_('pluginManager.community')}
    </button>
    <button
      class="tab"
      class:active={activeTab === "installed"}
      on:click={() => (activeTab = "installed")}
    >
      {$_('pluginManager.installedTab', { values: { count: $pluginStore.installed.length } })}
    </button>
  </div>

  {#if activeTab === "community"}
    <div class="create-form">
      <input
        type="text"
        placeholder={$_('pluginManager.enterUrl')}
        bind:value={newCommunityUrl}
        on:keydown={handleKeyDown}
      />
      <button class="btn-primary" on:click={handleAddCommunityUrl}>
        {$_('pluginManager.add')}
      </button>
    </div>
  {/if}

  {#if activeTab !== "installed"}
    <div class="category-filters">
      {#each categories as category}
        <button
          class="category-chip"
          class:active={$pluginStore.categoryFilter === category.id}
          on:click={() => pluginStore.setCategoryFilter(category.id)}
        >
          {$_(category.key)}
        </button>
      {/each}
    </div>
  {/if}

  <div
    class="plugin-content"
    bind:this={pluginContentEl}
    style="visibility: {scrollRestored || getScroll('plugins') === 0
      ? 'visible'
      : 'hidden'};"
    on:scroll={(e) => {
      currentScrollTop = (e.target as HTMLElement).scrollTop;
    }}
  >
    {#if $pluginStore.loading}
      <div class="empty-state">
        <Icon name="loader" size={48} />
        <h3>{$_('pluginManager.loading')}</h3>
      </div>
    {:else if activeTab === "curated"}
      <div class="plugin-grid">
        {#each $curatedPlugins as plugin}
          <div class="plugin-card">
            <div class="plugin-icon">
              {#if getIconUrl(plugin)}
                <img
                  src={getIconUrl(plugin)}
                  alt={plugin.manifest.name}
                  on:error={(e) => ((e.currentTarget as HTMLElement).style.display = "none")}
                />
              {/if}
              <Icon name="plugin" size={32} className="fallback-icon" />
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
                  <span class="badge badge-verified">{$_('pluginManager.verified')}</span>
                {/if}
              </div>
              <div class="plugin-stats">
                <div class="stat-item" title="Stars">
                  <Icon name="star" size={14} />
                  <span>{plugin.stars || 0}</span>
                </div>
                <div class="stat-item" title="Downloads">
                  <Icon name="download" size={14} />
                  <span>{plugin.downloads || 0}</span>
                </div>
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
            <Icon name="plugin" size={48} />
            <h3>{$_('pluginManager.noCurated')}</h3>
            <p>{$_('pluginManager.checkBackLater')}</p>
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
              <Icon name="x" size={16} />
            </button>
            <div class="plugin-icon">
              {#if getIconUrl(plugin)}
                <img
                  src={getIconUrl(plugin)}
                  alt={plugin.manifest.name}
                  on:error={(e) => ((e.currentTarget as HTMLElement).style.display = "none")}
                />
              {/if}
              <Icon name="plugin" size={32} className="fallback-icon" />
            </div>
            <div class="plugin-info">
              <span class="plugin-name truncate">{plugin.manifest.name}</span>
              <span class="plugin-author truncate"
                >{plugin.manifest.author} · v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate"
                >{plugin.manifest.description || $_('pluginManager.noDescription')}</span
              >
              <div class="plugin-badges">
                <span class="badge">{plugin.manifest.type.toUpperCase()}</span>
                {#if plugin.manifest.category}
                  <span class="badge">{plugin.manifest.category}</span>
                {/if}
              </div>
              <div class="plugin-stats">
                <div class="stat-item" title="Stars">
                  <Icon name="star" size={14} />
                  <span>{plugin.stars || 0}</span>
                </div>
                <div class="stat-item" title="Downloads">
                  <Icon name="download" size={14} />
                  <span>{plugin.downloads || 0}</span>
                </div>
              </div>
            </div>
            <div class="plugin-actions">
              {#if isInstalled(plugin.manifest.name)}
                <button class="btn-secondary" disabled> {$_('pluginManager.installedBtn')} </button>
              {:else}
                <button
                  class="btn-primary"
                  on:click={() => handleInstallClick(plugin)}
                >
                  {$_('pluginManager.installBtn')}
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <Icon name="plugin" size={48} />
            <h3>{$_('pluginManager.noCommunity')}</h3>
            <p>{$_('pluginManager.addUrlAbove')}</p>
          </div>
        {/each}
      </div>
    {:else if activeTab === "installed"}
      <div class="plugin-grid">
        {#each $pluginStore.installed as plugin}
          <div class="plugin-card">
            <div class="plugin-icon">
              {#if getIconUrl(plugin)}
                <img
                  src={getIconUrl(plugin)}
                  alt={plugin.name}
                  on:error={(e) => ((e.currentTarget as HTMLElement).style.display = "none")}
                />
              {/if}
              <Icon name="plugin" size={32} className="fallback-icon" />
            </div>
            <div class="plugin-info">
              <span class="plugin-name truncate">{plugin.name}</span>
              <span class="plugin-author truncate"
                >v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate"
                >{plugin.manifest.description || $_('pluginManager.noDescription')}</span
              >
              <div class="plugin-badges">
                <span class="badge">{plugin.manifest.type.toUpperCase()}</span>
                {#if plugin.enabled}
                  <span class="badge badge-active">{$_('pluginManager.active')}</span>
                {/if}
              </div>
            </div>
            <div class="plugin-actions">
              <button
                class={plugin.enabled ? "btn-secondary" : "btn-primary"}
                on:click={() => handleToggleEnabled(plugin)}
              >
                {plugin.enabled ? $_('pluginManager.disable') : $_('pluginManager.enable')}
              </button>
              <button
                class="btn-danger"
                on:click={() => handleUninstall(plugin.name)}
              >
                {$_('pluginManager.uninstall')}
              </button>
              {#if plugin.manifest.repo}
                <button
                  class="btn-secondary"
                  on:click={async () => {
                    if (
                      await confirm(
                        `Are you sure you want to reinstall "${plugin.name}"?`,
                        {
                          title: $_('pluginManager.reinstall'),
                          confirmLabel: $_('pluginManager.reinstall'),
                        },
                      )
                    ) {
                      await pluginStore.reinstallPlugin(plugin.name);
                    }
                  }}
                >
                  {$_('pluginManager.reinstall')}
                </button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <Icon name="plugin" size={48} />
            <h3>{$_('pluginManager.noInstalled')}</h3>
            <p>{$_('pluginManager.browseMarketplace')}</p>
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
      <h2>{$_('pluginManager.permissionReview')}</h2>
      <p class="modal-desc">
        <strong>{selectedPlugin.manifest.name}</strong> {$_('pluginManager.requestsPermissions')}
      </p>

      <!-- Regular Permissions -->
      {#if pendingPermissions.length > 0}
        <div class="permission-section">
          <h3 class="section-title">
            <Icon name="shield" size={16} />
            {$_('pluginManager.systemPermissions')}
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
            <Icon name="plus" size={16} />
            {$_('pluginManager.pluginIntegration')}
          </h3>
          <div class="cross-plugin-list">
            {#each selectedPlugin.manifest.cross_plugin_access as access}
              <div class="cross-plugin-item">
                <div class="cross-plugin-header">
                  <Icon name="zap" size={14} />
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
        <button
          class="btn-secondary"
          on:click={closePermissionModal}
          disabled={installState === "loading"}
        >
          {$_('pluginManager.cancel')}
        </button>
        <button
          class="btn-install"
          class:loading={installState === "loading"}
          class:success={installState === "success"}
          class:error={installState === "error"}
          on:click={handleConfirmInstall}
          disabled={installState !== "idle"}
          bind:this={installBtnEl}
        >
          {#if installState === "loading"}
            <Icon name="loader" size={18} />
            {$_('pluginManager.installing')}
          {:else if installState === "success"}
            <Icon name="check" size={18} />
            {$_('pluginManager.installedSuccess')}
          {:else if installState === "error"}
            <Icon name="x" size={18} />
            {$_('pluginManager.failed')}
          {:else}
            {$_('pluginManager.grantAndInstall')}
          {/if}
        </button>
      </div>

      <!-- Confetti particles (fixed position, outside modal flow) -->
      {#each confettiParticles as p, i}
        <div
          class="confetti-particle"
          style="
                  left: {p.x}px;
                  top: {p.y}px;
                  background: {p.color};
                  --angle: {p.angle}deg;
                  --speed: {p.speed};
                  animation-delay: {i * 0.03}s;
              "
        ></div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .plugin-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: calc(var(--safe-area-top) + var(--spacing-md)) var(--spacing-md)
      var(--spacing-md);
    overflow-x: hidden; /* Prevent horizontal overflow */
    box-sizing: border-box;
  }

  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-lg);
    flex-shrink: 0;
    gap: var(--spacing-md);
  }

  .view-header h1 {
    font-size: 1.5rem; /* Reduced from 2rem */
    font-weight: var(--font-weight-bold);
    margin: 0;
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
    margin-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-sm);
    flex-shrink: 0;
  }

  .tab {
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
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
    margin-bottom: var(--spacing-md);
    padding: var(--spacing-md);
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .category-filters {
    display: flex;
    gap: var(--spacing-xs);
    overflow-x: auto;
    padding-bottom: var(--spacing-md);
    margin-bottom: var(--spacing-md);
    scrollbar-width: none;
    flex-shrink: 0;
  }

  .category-filters::-webkit-scrollbar {
    display: none;
  }

  .category-chip {
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-full);
    background-color: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    transition: all var(--transition-fast);
    border: 1px solid transparent;
  }

  .category-chip:hover {
    background-color: var(--bg-highlight);
    color: var(--text-primary);
  }

  .category-chip.active {
    background-color: var(--accent-primary);
    color: var(--bg-base);
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

  :global(html.layout-mobile) .plugin-content {
    padding-bottom: calc(
      var(--mobile-bottom-inset, 130px) + var(--spacing-xl)
    );
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
    min-width: 0; /* CRITICAL: Allows flex children to truncate */
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
    overflow: hidden;
  }

  .plugin-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain; /* Shows entire icon without cropping */
    padding: var(--spacing-sm); /* Adds breathing room around the icon */
    box-sizing: border-box;
    border-radius: inherit;
  }

  .plugin-icon img + .fallback-icon {
    display: none;
  }

  .plugin-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    flex: 1;
    min-width: 0; /* CRITICAL: Allows children like .plugin-name to truncate */
  }

  .plugin-name {
    font-size: 0.9375rem;
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .plugin-author {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .plugin-desc {
    font-size: var(--font-size-sm);
    color: var(--text-subdued);
    line-height: 1.4;
  }

  .plugin-badges {
    display: flex;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .plugin-stats {
    display: flex;
    gap: var(--spacing-md);
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    color: var(--text-subdued);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
  }

  .stat-item svg {
    color: var(--text-subdued);
  }

  .stat-item[title="Stars"] svg {
    color: #ffd700;
  }

  .badge {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-full);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-semibold);
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
    margin-top: auto;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .btn-primary {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
    font-size: var(--font-size-base);
    transition: opacity var(--transition-fast);
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-highlight);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    height: 36px;
    box-sizing: border-box;
    transition: all var(--transition-fast);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--bg-surface);
    border-color: var(--text-subdued);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-install {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
    font-size: var(--font-size-base);
    transition:
      background-color 0.2s,
      transform 0.1s;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    min-width: 130px;
    justify-content: center;
  }

  .btn-install:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-install:disabled {
    cursor: not-allowed;
  }
  .btn-install.loading {
    opacity: 0.85;
  }
  .btn-install.success {
    background-color: #1ed760;
  }
  .btn-install.error {
    background-color: #ef4444;
  }

  .spin {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Checkmark draw animation */
  .check-path {
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: draw-check 0.5s ease forwards;
  }

  @keyframes draw-check {
    to {
      stroke-dashoffset: 0;
    }
  }

  /* Confetti */
  .confetti-particle {
    position: fixed;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-sm);
    pointer-events: none;
    z-index: 9999;
    animation: confetti-burst 1.2s ease-out forwards;
    transform-origin: center;
  }

  @keyframes confetti-burst {
    0% {
      transform: translate(0, 0) rotate(0deg) scale(1);
      opacity: 1;
    }
    100% {
      transform: translate(
          calc(cos(var(--angle)) * calc(var(--speed) * 30px)),
          calc(sin(var(--angle)) * calc(var(--speed) * 30px) - 80px)
        )
        rotate(720deg) scale(0);
      opacity: 0;
    }
  }


  .sort-selector {
    position: relative;
    display: flex;
    align-items: center;
  }

  .sort-selector select {
    appearance: none;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0 32px 0 var(--spacing-md);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    height: 36px;
    box-sizing: border-box;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .sort-selector select:hover {
    background-color: var(--bg-highlight);
    border-color: var(--accent-primary);
  }

  .sort-selector .select-icon {
    position: absolute;
    right: 12px;
    pointer-events: none;
    color: var(--text-subdued);
  }

  .btn-danger {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
    font-size: var(--font-size-base);
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
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: var(--font-size-base);
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

  .view-header h1 {
    font-size: 1.5rem;
    font-weight: var(--font-weight-bold);
    margin: 0;
  }

  .plugin-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: var(--spacing-md);
    overflow-x: hidden; /* Prevent horizontal overflow */
    box-sizing: border-box;
  }

  .permission-section {
    margin-bottom: var(--spacing-lg);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
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
    font-weight: var(--font-weight-medium);
    color: var(--accent-primary);
    font-size: var(--font-size-base);
  }

  .permission-desc {
    display: block;
    font-size: var(--font-size-xs);
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
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-base);
    color: var(--accent-primary);
  }

  .method-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    padding-left: 22px;
  }

  .method-badge {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-medium);
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
  :global(html.layout-mobile) .view-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-md);
  }

  :global(html.layout-mobile) .view-header h1 {
    font-size: 1.25rem;
  }

  :global(html.layout-mobile) .header-actions {
    width: 100%;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }

  :global(html.layout-mobile) .header-actions button,
  :global(html.layout-mobile) .sort-selector {
    flex: 1;
    min-width: 140px;
  }

  :global(html.layout-mobile) .sort-selector select {
    width: 100%;
  }

  :global(html.layout-mobile) .plugin-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }

  :global(html.layout-mobile) .remove-btn {
    opacity: 1;
  }

  :global(html.layout-mobile) .tabs {
    overflow-x: auto;
    padding-bottom: 4px;
    gap: var(--spacing-xs);
  }

  :global(html.layout-mobile) .tab {
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }

  :global(html.layout-mobile) .category-filters {
    padding-left: var(--spacing-sm);
    padding-right: var(--spacing-sm);
  }

  :global(html.layout-mobile) .category-chip {
    min-height: unset;
    min-width: unset;
    padding: 6px var(--spacing-sm);
    font-size: var(--font-size-xs);
  }
</style>
