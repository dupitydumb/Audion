<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
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
  import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
  import { isMobile, registerBackHandler, modalSheetTransition } from "$lib/stores/mobile";
  import Icon from "$lib/components/Icon.svelte";
  import { createSflxExtensionAdapter } from "$lib/plugins/sflx-adapter";
  import { globalProviders } from "$lib/plugins/providers";
  import { goToSettings } from "$lib/stores/view";
  import {
    CATEGORIES,
    getCategoryLabel,
    getDisplayCapabilities,
    getCapabilityLabel,
    getCapabilityIcon,
    type Translate,
  } from "$lib/plugins/categories";

  const tr: Translate = (key, fallback) => $_(key, { default: fallback });

  function openProviderSettings() {
    try {
      localStorage.setItem("audion_settings_open_tab", "extensions");
    } catch {}
    goToSettings();
  }

  let pluginContentEl: HTMLDivElement;
  let scrollRestored = false;
  let currentScrollTop = 0;
  let unregisterBackHandler: (() => void) | null = null;

  $: if (showPermissionModal) {
    if (!unregisterBackHandler) {
      unregisterBackHandler = registerBackHandler(() => {
        if (installState !== "loading") {
          closePermissionModal();
        }
        return true;
      });
    }
  } else if (unregisterBackHandler) {
    unregisterBackHandler();
    unregisterBackHandler = null;
  }

  onDestroy(() => {
    saveScroll("plugins", currentScrollTop);
    if (unregisterBackHandler) {
      unregisterBackHandler();
      unregisterBackHandler = null;
    }
  });

  // Local state
  let newCommunityUrl = "";
  let newRegistryName = "";
  let newRegistryUrl = "";
  let showPermissionModal = false;
  let selectedPlugin: MarketplacePlugin | null = null;
  let pendingPermissions: string[] = [];
  let searchQuery = "";
  let activeTab: "curated" | "community" | "registries" | "installed" = "curated";
  let sortBy: 'stars' | 'downloads' | 'name' | 'updated' = $pluginStore.sortBy;
  let sortOpen = false;

  function handleAddRegistry() {
    if (!newRegistryUrl.trim()) {
      addToast("Please provide a valid registry URL", "error");
      return;
    }
    pluginStore.addRegistry(newRegistryName.trim() || "Community Registry", newRegistryUrl.trim());
    addToast("Custom registry added", "success");
    newRegistryName = "";
    newRegistryUrl = "";
  }

  async function handleImportPackage() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Audion Plugins & Extensions (*.ext, *.audion-ext, *.sflx, *.js, *.zip)',
            extensions: ['ext', 'audion-ext', 'sflx', 'js', 'zip']
          },
          {
            name: 'All Files (*.*)',
            extensions: ['*']
          }
        ]
      });
      if (!selected || typeof selected !== 'string') return;

      // 1. Install as a permanent Audion plugin via backend
      const installedInfo = await pluginStore.installPluginFromFile(selected);
      if (installedInfo) {
        addToast(`Successfully installed plugin: ${installedInfo.name}`, 'success');
        activeTab = 'installed';
        return;
      }

      // 2. Fallback: in-memory adapter load if backend install wasn't successful
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(selected);
      const fileName = selected.split(/[\/\\]/).pop() || 'community-package';

      const adapter = createSflxExtensionAdapter(content, {
        id: fileName.replace(/\.(?:sflx|audion-ext|ext|js|zip)$/i, ''),
        name: fileName.replace(/\.(?:sflx|audion-ext|ext|js|zip)$/i, ''),
        version: '1.0.0'
      });

      let loadedAny = false;
      if (adapter.streamProvider) {
        globalProviders.registerStreamProvider(adapter.streamProvider, fileName);
        loadedAny = true;
      }
      if (adapter.metadataProvider) {
        globalProviders.registerMetadataProvider(adapter.metadataProvider, fileName);
        loadedAny = true;
      }
      if (adapter.lyricsProvider) {
        globalProviders.registerLyricsProvider(adapter.lyricsProvider, fileName);
        loadedAny = true;
      }

      if (loadedAny) {
        addToast(`Successfully loaded package: ${adapter.manifest.name}`, 'success');
      } else {
        addToast(`Plugin imported, but no providers or entry hooks were found`, 'warning');
      }
    } catch (err) {
      console.error('[PluginManager] Failed to import package:', err);
      addToast(`Failed to import package: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  function handleSortOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.sort-selector')) sortOpen = false;
  }

  function selectSort(val: typeof sortBy) {
    sortBy = val;
    pluginStore.setSortBy(val);
    sortOpen = false;
  }

  // Install State
  type InstallState = "idle" | "loading" | "success" | "error";
  let installState: InstallState = "idle";

  // Categories for filtering
  const categories = [
    { id: "all", key: "pluginManager.categoryAll", label: "All" },
    ...CATEGORIES.map((id) => ({
      id,
      key: `pluginManager.category${id[0].toUpperCase()}${id.slice(1)}`,
      label: getCategoryLabel(id),
    })),
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

  async function handleOpenRepo(url: string) {
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL:", err);
      window.open(url, "_blank");
    }
  }

  function getPluginRepoUrl(plugin: MarketplacePlugin | PluginInfo | null): string | null {
    if (!plugin) return null;
    const rawUrl =
      ('repo' in plugin && plugin.repo) ||
      plugin.manifest?.repo ||
      plugin.manifest?.homepage;
    if (!rawUrl) return null;

    const rawMatch = rawUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/);
    if (rawMatch) {
      return `https://github.com/${rawMatch[1]}/${rawMatch[2]}`;
    }

    return rawUrl;
  }

  function formatRepoDisplay(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('github.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          return `${parts[0]}/${parts[1]}`;
        }
        return 'GitHub';
      }
      return parsed.hostname;
    } catch {
      return url;
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
    selectedPlugin = plugin;
    pendingPermissions = plugin.manifest.permissions || [];
    showPermissionModal = true;
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

    // 4. For marketplace plugins with relative icon, resolve via manifest_url or repo
    if (manifest.icon && ("manifest_url" in plugin || "repo" in plugin)) {
      const mp = plugin as MarketplacePlugin;
      if (mp.manifest_url) {
        try {
          const baseUrl = mp.manifest_url.substring(0, mp.manifest_url.lastIndexOf("/") + 1);
          return new URL(manifest.icon, baseUrl).href;
        } catch {}
      }
      if (mp.repo) {
        const match =
          mp.repo.match(/github\.com\/([^/]+)\/([^/]+)/) ||
          mp.repo.match(/^([^/]+)\/([^/]+)$/);
        if (match) {
          const [, owner, repo] = match;
          const cleanRepo = repo.replace(/\.git$/, "").replace(/\/$/, "");
          const cleanIcon = manifest.icon.replace(/^\.?\//, "");
          return `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/${cleanIcon}`;
        }
      }
    }

    return null;
  }
</script>

<svelte:window on:mousedown={handleSortOutside} />

<div class="plugin-view">
  <header class="view-header">
    <h1>{$_('pluginManager.title')}</h1>
    <div class="header-actions">
      {#if !$isMobile}
        <button
          class="btn-secondary"
          on:click={openPluginsFolder}
          title={$_('pluginManager.openFolderTitle')}
        >
          <Icon name="folder" size={16} />
          {$_('pluginManager.openFolder')}
        </button>
      {/if}

      <button
        class="btn-secondary"
        on:click={handleImportPackage}
        title="Import .ext, .sflx or Audion plugin package"
      >
        <Icon name="file" size={16} />
        Import Plugin (.ext)
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

      <button
        class="btn-secondary providers-link"
        on:click={openProviderSettings}
        title="Configure stream, metadata and lyrics providers"
      >
        <Icon name="sliders" size={16} />
        Providers
      </button>

      {#if activeTab !== "installed" && activeTab !== "registries"}
        <div class="sort-selector">
          <button
            class="sort-btn"
            on:click={() => (sortOpen = !sortOpen)}
          >
            {#if sortBy === 'stars'}{$_('pluginManager.sortStars')}
            {:else if sortBy === 'downloads'}{$_('pluginManager.sortDownloads')}
            {:else if sortBy === 'updated'}{$_('pluginManager.sortUpdated')}
            {:else}{$_('pluginManager.sortName')}
            {/if}
            <Icon name="chevron-down" size={14} className="select-icon {sortOpen ? 'open' : ''}" />
          </button>
          {#if sortOpen}
            <div class="sort-dropdown">
              <button class="sort-option" class:active={sortBy === 'stars'} on:click={() => selectSort('stars')}>{$_('pluginManager.sortStars')}</button>
              <button class="sort-option" class:active={sortBy === 'downloads'} on:click={() => selectSort('downloads')}>{$_('pluginManager.sortDownloads')}</button>
              <button class="sort-option" class:active={sortBy === 'updated'} on:click={() => selectSort('updated')}>{$_('pluginManager.sortUpdated')}</button>
              <button class="sort-option" class:active={sortBy === 'name'} on:click={() => selectSort('name')}>{$_('pluginManager.sortName')}</button>
            </div>
          {/if}
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
      class:active={activeTab === "registries"}
      on:click={() => (activeTab = "registries")}
    >
      Registries ({$pluginStore.registries?.length || 1})
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

  {#if activeTab !== "installed" && activeTab !== "registries"}
    <div class="category-filters">
      {#each categories as category}
        <button
          class="category-chip"
          class:active={$pluginStore.categoryFilter === category.id}
          on:click={() => pluginStore.setCategoryFilter(category.id)}
        >
          {$_(category.key, { default: category.label })}
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
              <span class="plugin-name truncate" title={plugin.manifest.name}>{plugin.manifest.name}</span>
              <span class="plugin-author truncate"
                >{plugin.manifest.author} · v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate" title={plugin.manifest.description || $_('pluginManager.noDescription')}
                >{plugin.manifest.description || $_('pluginManager.noDescription')}</span
              >
              <div class="plugin-badges">
                {#if plugin.manifest.category}
                  <span class="badge" title={plugin.manifest.category}
                    >{getCategoryLabel(plugin.manifest.category, tr)}</span
                  >
                {/if}
                {#each getDisplayCapabilities(plugin.manifest) as cap}
                  <span class="badge badge-capability" title={cap}>
                    <Icon name={getCapabilityIcon(cap)} size={11} />
                    {getCapabilityLabel(cap, tr)}
                  </span>
                {/each}
                {#if plugin.verified}
                  <span class="badge badge-verified">{$_('pluginManager.verified')}</span>
                {/if}
                {#if getPluginRepoUrl(plugin)}
                  {@const cardRepoUrl = getPluginRepoUrl(plugin)}
                  {#if cardRepoUrl}
                    <button
                      class="card-repo-btn"
                      on:click|stopPropagation={() => handleOpenRepo(cardRepoUrl)}
                      title={cardRepoUrl}
                      aria-label="Open repository"
                    >
                      <Icon name="external-link" size={11} />
                      <span class="truncate">{formatRepoDisplay(cardRepoUrl)}</span>
                    </button>
                  {/if}
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
              <span class="plugin-name truncate" title={plugin.manifest.name}>{plugin.manifest.name}</span>
              <span class="plugin-author truncate"
                >{plugin.manifest.author} · v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate" title={plugin.manifest.description || $_('pluginManager.noDescription')}
                >{plugin.manifest.description || $_('pluginManager.noDescription')}</span
              >
              <div class="plugin-badges">
                {#if plugin.manifest.category}
                  <span class="badge" title={plugin.manifest.category}
                    >{getCategoryLabel(plugin.manifest.category, tr)}</span
                  >
                {/if}
                {#each getDisplayCapabilities(plugin.manifest) as cap}
                  <span class="badge badge-capability" title={cap}>
                    <Icon name={getCapabilityIcon(cap)} size={11} />
                    {getCapabilityLabel(cap, tr)}
                  </span>
                {/each}
                {#if getPluginRepoUrl(plugin)}
                  {@const cardRepoUrl = getPluginRepoUrl(plugin)}
                  {#if cardRepoUrl}
                    <button
                      class="card-repo-btn"
                      on:click|stopPropagation={() => handleOpenRepo(cardRepoUrl)}
                      title={cardRepoUrl}
                      aria-label="Open repository"
                    >
                      <Icon name="external-link" size={11} />
                      <span class="truncate">{formatRepoDisplay(cardRepoUrl)}</span>
                    </button>
                  {/if}
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
    {:else if activeTab === "registries"}
      <div class="registries-container">
        <div class="registry-add-card">
          <div class="registry-add-header">
            <h4>Add Community Registry</h4>
            <span class="registry-subtitle">Add custom repository catalogs (registry.json) with SHA-256 validation</span>
          </div>
          <div class="registry-form">
            <input
              type="text"
              placeholder="Registry Name (e.g. Community Registry)"
              bind:value={newRegistryName}
            />
            <input
              type="text"
              placeholder="https://example.com/registry.json"
              bind:value={newRegistryUrl}
              on:keydown={(e) => e.key === "Enter" && handleAddRegistry()}
            />
            <button class="btn-primary" on:click={handleAddRegistry}>
              Add Registry
            </button>
          </div>
        </div>

        <div class="registries-list">
          {#each ($pluginStore.registries || []) as reg (reg.id)}
            <div class="registry-card">
              <div class="registry-header">
                <div class="registry-title-row">
                  <span class="registry-name">{reg.name}</span>
                  {#if reg.isDefault}
                    <span class="badge badge-active">Official</span>
                  {:else}
                    <span class="badge badge-community">Community</span>
                  {/if}
                </div>
                <span class="registry-url truncate" title={reg.url}>{reg.url}</span>
              </div>
              <div class="registry-actions">
                <button
                  class="btn-secondary"
                  class:btn-active-status={reg.enabled}
                  on:click={() => pluginStore.toggleRegistry(reg.id)}
                >
                  {reg.enabled ? 'Active' : 'Disabled'}
                </button>
                {#if !reg.isDefault}
                  <button
                    class="btn-danger"
                    on:click={() => pluginStore.removeRegistry(reg.id)}
                  >
                    Remove
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
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
              <span class="plugin-name truncate" title={plugin.name}>{plugin.name}</span>
              <span class="plugin-author truncate"
                >v{plugin.manifest.version}</span
              >
              <span class="plugin-desc truncate" title={plugin.manifest.description || $_('pluginManager.noDescription')}
                >{plugin.manifest.description || $_('pluginManager.noDescription')}</span
              >
              <div class="plugin-badges">
                {#if plugin.manifest.category}
                  <span class="badge" title={plugin.manifest.category}
                    >{getCategoryLabel(plugin.manifest.category, tr)}</span
                  >
                {/if}
                {#each getDisplayCapabilities(plugin.manifest) as cap}
                  <span class="badge badge-capability" title={cap}>
                    <Icon name={getCapabilityIcon(cap)} size={11} />
                    {getCapabilityLabel(cap, tr)}
                  </span>
                {/each}
                {#if plugin.enabled}
                  <span class="badge badge-active">{$_('pluginManager.active')}</span>
                {/if}
                {#if getPluginRepoUrl(plugin)}
                  {@const cardRepoUrl = getPluginRepoUrl(plugin)}
                  {#if cardRepoUrl}
                    <button
                      class="card-repo-btn"
                      on:click|stopPropagation={() => handleOpenRepo(cardRepoUrl)}
                      title={cardRepoUrl}
                      aria-label="Open repository"
                    >
                      <Icon name="external-link" size={11} />
                      <span class="truncate">{formatRepoDisplay(cardRepoUrl)}</span>
                    </button>
                  {/if}
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
    transition:fade={{ duration: 160 }}
    role="dialog"
    aria-modal="true"
  >
    <div
      class="modal"
      on:click|stopPropagation
      transition:modalSheetTransition
      role="document"
    >
      <div class="modal-header">
        <h2>
          {pendingPermissions.length > 0 || (selectedPlugin.manifest.cross_plugin_access && selectedPlugin.manifest.cross_plugin_access.length > 0)
            ? $_('pluginManager.permissionReview')
            : $_('pluginManager.installPlugin')}
        </h2>
        <button
          class="modal-close-btn"
          on:click={closePermissionModal}
          disabled={installState === "loading"}
          aria-label="Close"
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <div class="modal-plugin-header">
        <div class="modal-plugin-icon">
          {#if getIconUrl(selectedPlugin)}
            <img
              src={getIconUrl(selectedPlugin)}
              alt={selectedPlugin.manifest.name}
              on:error={(e) => ((e.currentTarget as HTMLElement).style.display = "none")}
            />
          {/if}
          <Icon name="plugin" size={32} className="fallback-icon" />
        </div>
        <div class="modal-plugin-meta">
          <h3 class="modal-plugin-name">{selectedPlugin.manifest.name}</h3>
          <div class="modal-plugin-sub">
            <span class="modal-plugin-author">{selectedPlugin.manifest.author}</span>
            <span class="modal-dot">·</span>
            <span class="modal-plugin-version">v{selectedPlugin.manifest.version}</span>
          </div>
          <div class="plugin-badges">
            <span class="badge">{selectedPlugin.manifest.type.toUpperCase()}</span>
            {#if selectedPlugin.manifest.category}
              <span class="badge" title={selectedPlugin.manifest.category}
                >{getCategoryLabel(selectedPlugin.manifest.category, tr)}</span
              >
            {/if}
            {#each getDisplayCapabilities(selectedPlugin.manifest) as cap}
              <span class="badge badge-capability" title={cap}>
                <Icon name={getCapabilityIcon(cap)} size={11} />
                {getCapabilityLabel(cap, tr)}
              </span>
            {/each}
            {#if selectedPlugin.verified}
              <span class="badge badge-verified">{$_('pluginManager.verified')}</span>
            {/if}
          </div>
        </div>
      </div>

      {#if getPluginRepoUrl(selectedPlugin)}
        {@const repoUrl = getPluginRepoUrl(selectedPlugin)}
        {#if repoUrl}
          <div class="modal-repo-row">
            <span class="modal-repo-label">{$_('pluginManager.hostedAt')}:</span>
            <button
              class="modal-repo-link"
              on:click={() => handleOpenRepo(repoUrl)}
              title={repoUrl}
            >
              <Icon name="external-link" size={14} />
              <span class="truncate">{formatRepoDisplay(repoUrl)}</span>
            </button>
          </div>
        {/if}
      {/if}

      <div class="modal-desc-section">
        <h4 class="section-title">
          <Icon name="file-text" size={15} />
          {$_('pluginManager.about')}
        </h4>
        <div class="modal-full-desc">
          {selectedPlugin.manifest.description || $_('pluginManager.noDescription')}
        </div>
      </div>

      <!-- Regular Permissions -->
      {#if pendingPermissions.length > 0 || (selectedPlugin.manifest.cross_plugin_access && selectedPlugin.manifest.cross_plugin_access.length > 0)}
        <p class="modal-desc">
          <strong>{selectedPlugin.manifest.name}</strong> {$_('pluginManager.requestsPermissions')}
        </p>

        <!-- Regular Permissions -->
        {#if pendingPermissions.length > 0}
          <div class="permission-section">
            <h4 class="section-title">
              <Icon name="shield" size={15} />
              {$_('pluginManager.systemPermissions')}
            </h4>
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
            <h4 class="section-title">
              <Icon name="plus" size={15} />
              {$_('pluginManager.pluginIntegration')}
            </h4>
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
      {:else}
        <div class="modal-no-permissions">
          <Icon name="check-circle" size={16} />
          <span>{$_('pluginManager.noPermissionsRequired')}</span>
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
          {:else if pendingPermissions.length > 0}
            {$_('pluginManager.grantAndInstall')}
          {:else}
            {$_('pluginManager.installBtn')}
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
    padding: var(--spacing-lg) var(--spacing-xl);
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
    font-size: var(--font-size-3xl);
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
    color: var(--text-on-accent, #fff);
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
    padding-bottom: var(--spacing-lg);
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

  .card-repo-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-subdued);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.6875rem;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast), border-color var(--transition-fast), background-color var(--transition-fast);
    max-width: 150px;
  }

  .card-repo-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
    background-color: var(--bg-surface);
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-full);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    background-color: var(--bg-surface);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .badge-capability {
    background-color: rgba(99, 102, 241, 0.12);
    color: var(--accent-primary);
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
    flex-wrap: wrap;
  }

  .header-actions .btn-secondary {
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn-primary {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--accent-primary);
    color: var(--text-on-accent, #fff);
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
    color: var(--text-on-accent, #fff);
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

  .sort-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0 var(--spacing-md);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    height: 36px;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .sort-btn:hover {
    background-color: var(--bg-highlight);
    border-color: var(--accent-primary);
  }

  .sort-btn :global(.select-icon) {
    color: var(--text-subdued);
    transition: transform var(--transition-fast);
  }

  .sort-btn :global(.select-icon.open) {
    transform: rotate(180deg);
  }

  .sort-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 200;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    min-width: 100%;
    overflow: hidden;
  }

  .sort-option {
    display: block;
    width: 100%;
    padding: 8px var(--spacing-md);
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .sort-option:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .sort-option.active {
    color: var(--accent-primary);
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
    padding: calc(16px + var(--safe-area-top, 0px)) 16px calc(16px + var(--safe-area-bottom, 0px));
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 4000);
  }

  .modal {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-lg);
    padding: var(--spacing-lg);
    max-width: 520px;
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    border: 1px solid var(--border-color);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
  }

  .modal-header h2 {
    font-size: 1.25rem;
    font-weight: var(--font-weight-bold);
    margin: 0;
  }

  .modal-close-btn {
    background: none;
    border: none;
    color: var(--text-subdued);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition-fast), background-color var(--transition-fast);
  }

  .modal-close-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-surface);
  }

  .modal-plugin-header {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-md);
    padding: var(--spacing-md);
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    margin-bottom: var(--spacing-md);
  }

  .modal-plugin-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background-color: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
    border: 1px solid var(--border-color);
  }

  .modal-plugin-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 1;
  }

  .modal-plugin-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .modal-plugin-name {
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin: 0;
    word-break: break-word;
    line-height: 1.3;
  }

  .modal-plugin-sub {
    font-size: var(--font-size-sm);
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .modal-dot {
    opacity: 0.6;
  }

  .modal-repo-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
    font-size: var(--font-size-sm);
    color: var(--text-subdued);
    background-color: var(--bg-surface);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .modal-repo-label {
    font-weight: var(--font-weight-medium);
  }

  .modal-repo-link {
    background: none;
    border: none;
    color: var(--accent-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-sm);
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .modal-repo-link:hover {
    opacity: 0.85;
  }

  .modal-desc-section {
    margin-bottom: var(--spacing-md);
  }

  .modal-full-desc {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
  }

  .modal-no-permissions {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: rgba(30, 215, 96, 0.08);
    border: 1px solid rgba(30, 215, 96, 0.25);
    border-radius: var(--radius-md);
    color: #1ed760;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    margin-bottom: var(--spacing-md);
  }

  .view-header h1 {
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    margin: 0;
  }

  .plugin-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: var(--spacing-lg) var(--spacing-xl);
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

  .modal-desc {
    margin: 0 0 var(--spacing-md);
    font-size: var(--font-size-base);
    line-height: var(--line-height-normal);
    color: var(--text-secondary);
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
  :global(html.layout-mobile) .plugin-view {
    padding: var(--spacing-md);
  }

  :global(html.layout-mobile) .view-header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  :global(html.layout-mobile) .view-header h1 {
    font-size: var(--font-size-xl);
  }

  :global(html.layout-mobile) .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
    width: 100%;
  }

  :global(html.layout-mobile) .header-actions > button {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 44px;
    height: auto;
    padding: 8px var(--spacing-sm);
    font-size: var(--font-size-xs);
    justify-content: center;
    white-space: nowrap;
    text-align: center;
  }

  :global(html.layout-mobile) .sort-selector {
    flex: 1 1 100%;
    min-width: 0;
    width: 100%;
  }

  :global(html.layout-mobile) .sort-btn {
    width: 100%;
    min-height: 44px;
    justify-content: space-between;
  }

  :global(html.layout-mobile) .plugin-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }

  :global(html.layout-mobile) .remove-btn {
    opacity: 1;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .plugin-badges {
    gap: 4px;
  }

  :global(html.layout-mobile) .badge {
    padding: 2px 6px;
    font-size: 0.625rem;
  }

  :global(html.layout-mobile) .card-repo-btn {
    max-width: 100%;
  }

  :global(html.layout-mobile) .tabs {
    flex-wrap: wrap;
    overflow-x: visible;
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: var(--spacing-md);
    gap: 6px;
  }

  :global(html.layout-mobile) .tab {
    min-width: 0;
    min-height: 44px;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    background-color: var(--bg-elevated);
    border: 1px solid transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  :global(html.layout-mobile) .tab:hover {
    background-color: var(--bg-highlight);
    color: var(--text-primary);
  }

  :global(html.layout-mobile) .tab.active {
    background-color: var(--accent-subtle);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  :global(html.layout-mobile) .category-filters {
    padding-left: var(--spacing-sm);
    padding-right: var(--spacing-sm);
  }

  :global(html.layout-mobile) .category-chip {
    min-height: 36px;
    min-width: unset;
    padding: 6px var(--spacing-sm);
    font-size: var(--font-size-xs);
  }

  :global(html.layout-mobile) .plugin-actions button {
    min-height: 44px;
    flex: 1;
    min-width: 100px;
  }

  :global(html.layout-mobile) .registry-card {
    flex-direction: column;
    align-items: stretch;
    gap: var(--spacing-sm);
    padding: var(--spacing-md);
  }

  :global(html.layout-mobile) .registry-actions {
    width: 100%;
    justify-content: flex-end;
  }

  :global(html.layout-mobile) .registry-actions button {
    min-height: 44px;
    flex: 1;
  }

  :global(html.layout-mobile) .registries-container {
    padding: 0 var(--spacing-sm);
  }

  :global(html.layout-mobile) .create-form {
    flex-direction: column;
  }

  :global(html.layout-mobile) .create-form input {
    width: 100%;
    min-height: 44px;
  }

  :global(html.layout-mobile) .create-form button {
    min-height: 44px;
  }

  /* Permission / install modal — bottom sheet respecting safe areas */
  :global(html.layout-mobile) .modal-overlay {
    align-items: flex-end;
    padding: var(--safe-area-top, 16px) 0 0;
  }

  :global(html.layout-mobile) .modal {
    position: relative;
    width: 100%;
    max-width: 100%;
    max-height: 90dvh;
    padding: 20px var(--spacing-md) var(--spacing-md);
    border-radius: 20px 20px 0 0;
    border-bottom: none;
  }

  :global(html.layout-mobile) .modal::before {
    content: "";
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-highlight);
  }

  :global(html.layout-mobile) .modal-header {
    margin-bottom: var(--spacing-sm);
  }

  :global(html.layout-mobile) .modal-header h2 {
    font-size: var(--font-size-lg);
  }

  :global(html.layout-mobile) .modal-close-btn {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .modal-plugin-header {
    padding: var(--spacing-sm);
    gap: var(--spacing-sm);
  }

  :global(html.layout-mobile) .modal-desc-section {
    margin-bottom: var(--spacing-md);
  }

  :global(html.layout-mobile) .modal-desc {
    margin-bottom: var(--spacing-md);
  }

  :global(html.layout-mobile) .modal-full-desc {
    max-height: 30vh;
    padding: var(--spacing-sm) var(--spacing-md);
  }

  :global(html.layout-mobile) .method-badge {
    padding: 2px 6px;
    font-size: 0.625rem;
  }

  /* Sticky footer keeps Cancel/Install reachable while permissions scroll */
  :global(html.layout-mobile) .modal-actions {
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin: var(--spacing-md) calc(-1 * var(--spacing-md)) calc(-1 * var(--spacing-md));
    padding: var(--spacing-sm) var(--spacing-md) calc(var(--spacing-sm) + var(--safe-area-bottom, 0px));
    background-color: var(--bg-elevated);
    border-top: 1px solid var(--border-color);
    justify-content: stretch;
  }

  :global(html.layout-mobile) .modal-actions > button {
    flex: 1;
    min-width: 0;
    min-height: 46px;
  }

  /* Registries Manager Styling */
  .registries-container {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
    padding: var(--spacing-sm) 0;
  }

  .registry-add-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .registry-add-header h4 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }

  .registry-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
  }

  .registry-form {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .registry-form input {
    flex: 1;
    min-width: 220px;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .registries-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .registry-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
  }

  .registry-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .registry-title-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .registry-name {
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .registry-url {
    font-size: var(--font-size-xs);
    color: var(--text-subdued);
    font-family: monospace;
  }

  .registry-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-shrink: 0;
  }

  .btn-active-status {
    border-color: rgba(30, 215, 96, 0.4);
    color: #1ed760;
  }

  .badge-community {
    background: rgba(138, 43, 226, 0.15);
    color: #b070ff;
    border: 1px solid rgba(138, 43, 226, 0.3);
  }

</style>
