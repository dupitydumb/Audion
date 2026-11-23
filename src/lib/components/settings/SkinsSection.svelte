<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { _ } from "svelte-i18n";
  import { slide } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";
  import { confirm } from "$lib/stores/dialogs";
  import { isTauri } from "$lib/api/tauri";
  import {
    theme,
    openSkinStudio,
    exportSkinPackage,
  } from "$lib/stores/theme";
  import {
    localSkins,
    skinsLoading,
    refreshLocalSkins,
    openSkinsFolder,
    applyLocalSkin,
    removeLocalSkin,
    importSkinToFolder,
  } from "$lib/stores/skins";
  import ThemeBrowserSection from "$lib/components/settings/ThemeBrowserSection.svelte";
  import type { LocalSkinInfo } from "$lib/api/tauri";

  export let open: boolean = true;
  export let advancedOpen: boolean = false;

  let showCommunity = false;

  let customCssInput = $theme.customCss || "";
  $: {
    customCssInput = $theme.customCss || "";
  }

  function handleCustomCssBlur() {
    if (customCssInput !== $theme.customCss) {
      theme.setCustomCss(customCssInput);
    }
  }

  let pkgName = "";
  let pkgAuthor = "";
  let pkgDescription = "";
  let pkgExportError = "";
  let pkgExportSuccess = "";

  async function handleExport() {
    const state = get(theme);
    const name = pkgName.trim() || state.skinName || "My Skin";
    const pkg = exportSkinPackage(state, name, pkgAuthor || state.skinAuthor, pkgDescription || state.skinDescription);
    const json = JSON.stringify(pkg, null, 2);
    const fileName = name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() + ".audionskin";

    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = await save({
          defaultPath: fileName,
          filters: [
            { name: "Audion Skin", extensions: ["audionskin", "audiotheme"] },
            { name: "JSON", extensions: ["json"] },
          ],
        });
        if (!path) return;
        await writeTextFile(path, json);
        pkgExportSuccess = "Skin exported successfully!";
        setTimeout(() => { pkgExportSuccess = ""; }, 3000);
      } catch (e) {
        pkgExportError = String(e);
        setTimeout(() => { pkgExportError = ""; }, 5000);
      }
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      pkgExportSuccess = "Skin exported successfully!";
      setTimeout(() => { pkgExportSuccess = ""; }, 3000);
    }
  }

  onMount(() => {
    refreshLocalSkins();
  });

  function handleApplySkin(skin: LocalSkinInfo) {
    const chosenScheme = skin.schemes[0];
    applyLocalSkin(skin, chosenScheme);
  }

  function handleSelectScheme(schemeName: string) {
    theme.selectScheme(schemeName);
  }

  function resetToDefault() {
    theme.applyPackage({
      skinName: undefined,
      skinAuthor: undefined,
      skinDescription: undefined,
      customCss: "",
      customJs: "",
      schemes: undefined,
      activeScheme: undefined,
    });
    theme.resetColors();
    theme.setAccentColor("#1DB954");
    theme.setMode("dark");
  }

  async function handleDelete(skin: LocalSkinInfo) {
    const msg = $_("settings.deleteSkinConfirm", {
      default: `Are you sure you want to delete "${skin.name}" from your skins folder?`,
    });
    const ok = await confirm(msg, {
      title: $_("settings.deleteSkin", { default: "Delete Skin" }),
      confirmLabel: $_("common.delete", { default: "Delete" }),
      danger: true,
    });
    if (ok) {
      await removeLocalSkin(skin);
    }
  }

  function handleEditInStudio(skin: LocalSkinInfo) {
    try {
      const raw = JSON.parse(skin.raw_package);
      theme.applyPackage(raw);
      openSkinStudio();
    } catch (e) {
      console.error("Failed to open skin in studio:", e);
    }
  }
</script>

<section class="settings-section skins-section" aria-labelledby="skins-heading">
  <div class="section-header-row">
    <div>
      <h2 class="settings-section-title" id="skins-heading">
        {$_("settings.skins", { default: "Skins & Themes" })}
      </h2>
      <p class="settings-section-desc">
        {$_("settings.skinsSubtitle", {
          default: "Manage custom skins, open the skins folder, and style your player",
        })}
      </p>
    </div>
  </div>

  <div class="section-body">
    <div class="settings-card">
      <!-- ── TOP TOOLBAR ── -->
      <div class="skins-toolbar">
        <button
          type="button"
          class="btn-folder"
          id="setting-skins-folder"
          on:click={openSkinsFolder}
          title={$_("settings.openSkinsFolderTitle", {
            default: "Open skins directory in system file explorer",
          })}
        >
          <Icon name="folder" size={15} />
          <span>{$_("settings.openSkinsFolder", { default: "Open Skins Folder" })}</span>
        </button>

        <button
          type="button"
          class="btn-tool"
          on:click={refreshLocalSkins}
          disabled={$skinsLoading}
          title={$_("settings.refreshSkins", { default: "Refresh" })}
        >
          <Icon name="refresh" size={14} className={$skinsLoading ? "spinning" : ""} />
          <span>{$_("settings.refresh", { default: "Refresh" })}</span>
        </button>

        <button
          type="button"
          class="btn-tool"
          on:click={importSkinToFolder}
          title={$_("settings.importSkinFile", { default: "Import skin file into folder" })}
        >
          <Icon name="upload" size={14} />
          <span>{$_("settings.importSkin", { default: "Import File" })}</span>
        </button>

        <button
          type="button"
          class="btn-tool btn-studio"
          id="setting-skin-studio"
          on:click={openSkinStudio}
          title={$_("settings.openSkinStudio", { default: "Open Skin Studio" })}
        >
          <Icon name="sparkles" size={14} />
          <span>Skin Studio</span>
        </button>
      </div>

      <!-- ── ACTIVE SKIN STATUS ROW (Flat, integrated, no nested card) ── -->
      <div class="active-status-row">
        <div class="active-meta-col">
          <span class="active-swatch-dot" style="background-color: {$theme.accentColor};"></span>
          <span class="active-label">{$_("settings.activeSkin", { default: "Active" })}:</span>
          <span class="active-name">{$theme.skinName || "Default Audion (Spotify Dark)"}</span>
          {#if $theme.skinAuthor}
            <span class="active-author">by {$theme.skinAuthor}</span>
          {/if}
        </div>

        <!-- Scheme selector if multi-scheme -->
        {#if $theme.schemes && Object.keys($theme.schemes).length > 1}
          <div class="scheme-inline-selector">
            <span class="scheme-inline-label">{$_("settings.colorScheme", { default: "Scheme" })}:</span>
            <div class="scheme-pill-group">
              {#each Object.keys($theme.schemes) as schemeName}
                {@const isCurrent = ($theme.activeScheme || "Default") === schemeName}
                <button
                  type="button"
                  class="scheme-pill"
                  class:selected={isCurrent}
                  on:click={() => handleSelectScheme(schemeName)}
                >
                  {#if isCurrent}
                    <Icon name="check" size={11} />
                  {/if}
                  <span>{schemeName}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if $theme.skinName}
          <button
            type="button"
            class="btn-reset-skin"
            on:click={resetToDefault}
            title="Reset to default Audion theme"
          >
            Reset
          </button>
        {/if}
      </div>

      <div class="divider"></div>

      <!-- ── INSTALLED SKINS SECTION ── -->
      <div class="inner-section" id="setting-installed-skins">
        <div class="skins-grid-header">
          <div>
            <span class="setting-title">
              {$_("settings.installedSkins", { default: "Installed Skins" })}
            </span>
            <span class="setting-description">
              {$localSkins.length} {$localSkins.length === 1 ? "skin" : "skins"} detected in skins folder
            </span>
          </div>
        </div>

        {#if $skinsLoading && $localSkins.length === 0}
          <div class="skins-loading">
            <div class="spinner"></div>
            <span>Loading skins from folder...</span>
          </div>
        {:else if $localSkins.length === 0}
          <!-- Empty State -->
          <div class="skins-empty-state">
            <div class="empty-icon-wrap">
              <Icon name="palette" size={28} />
            </div>
            <h3>{$_("settings.noSkinsFound", { default: "No custom skins found in skins folder" })}</h3>
            <p>
              {$_("settings.noSkinsFoundDesc", {
                default: "Paste .audionskin files or theme folders into your skins folder, or install community themes below.",
              })}
            </p>
            <div class="empty-actions">
              <button type="button" class="btn-tool" on:click={openSkinsFolder}>
                <Icon name="folder" size={15} />
                <span>{$_("settings.openSkinsFolder", { default: "Open Skins Folder" })}</span>
              </button>
              <button type="button" class="btn-tool" on:click={() => (showCommunity = true)}>
                <Icon name="globe" size={15} />
                <span>Browse Community Skins</span>
              </button>
            </div>
          </div>
        {:else}
          <!-- Grid of installed skins (flat, hairlines, no hover lift) -->
          <div class="skins-grid">
            {#each $localSkins as skin (skin.path || skin.id)}
              {@const isActive = $theme.skinName === skin.name}
              <div
                class="skin-card"
                class:active={isActive}
                on:click={() => !isActive && handleApplySkin(skin)}
                role="button"
                tabindex="0"
                on:keydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!isActive) handleApplySkin(skin);
                  }
                }}
              >
                <!-- Color Palette Preview Strip -->
                <div class="skin-palette-bar">
                  {#if skin.preview_colors && skin.preview_colors.length > 0}
                    {#each skin.preview_colors as color}
                      <span class="palette-swatch" style="background-color: {color};"></span>
                    {/each}
                  {:else}
                    <span class="palette-swatch" style="background-color: {skin.accent_color};"></span>
                  {/if}
                </div>

                <!-- Card Body -->
                <div class="skin-card-body">
                  <div class="skin-card-header">
                    <span class="skin-card-title">{skin.name}</span>
                    {#if isActive}
                      <span class="active-badge">
                        <Icon name="check" size={11} />
                        Active
                      </span>
                    {/if}
                  </div>

                  <span class="skin-card-sub">
                    {skin.schemes_count > 1 ? `${skin.schemes_count} schemes` : "Default scheme"}
                    {#if skin.author} · by {skin.author}{/if}
                  </span>

                  <!-- Card Action Row -->
                  <div class="skin-card-actions" on:click|stopPropagation>
                    {#if !isActive}
                      <button
                        type="button"
                        class="btn-apply-card"
                        on:click={() => handleApplySkin(skin)}
                      >
                        Apply
                      </button>
                    {/if}

                    <div class="action-icons">
                      <button
                        type="button"
                        class="btn-icon-subtle"
                        title="Edit in Skin Studio"
                        on:click={() => handleEditInStudio(skin)}
                        aria-label="Edit in Skin Studio"
                      >
                        <Icon name="sparkles" size={14} />
                      </button>
                      <button
                        type="button"
                        class="btn-icon-subtle danger"
                        title="Delete Skin"
                        on:click={() => handleDelete(skin)}
                        aria-label="Delete Skin"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="divider"></div>

      <!-- ── COMMUNITY THEMES ACCORDION / TOGGLE ── -->
      <div class="inner-section" id="setting-community-skins">
        <button
          type="button"
          class="community-toggle-header"
          on:click={() => (showCommunity = !showCommunity)}
        >
          <div class="community-toggle-text">
            <span class="setting-title">
              {$_("settings.themeBrowser", { default: "Community Skins" })}
            </span>
            <span class="setting-description">
              Browse and install community skins directly to your skins folder
            </span>
          </div>
          <span class="pill-badge">
            {showCommunity ? "Hide" : "Browse"}
          </span>
        </button>

        {#if showCommunity}
          <div transition:slide class="community-wrapper">
            <!-- Embedded mode: no duplicate card-in-card wrapper -->
            <ThemeBrowserSection open={true} embedded={true} />
          </div>
        {/if}
      </div>

      <div class="divider"></div>

      <!-- ── ADVANCED & CUSTOM STYLES (Collapsible) ── -->
      <div class="advanced-section-wrapper" id="setting-advanced-skins">
        <button
          type="button"
          class="advanced-toggle-btn"
          on:click={() => advancedOpen = !advancedOpen}
          aria-expanded={advancedOpen}
        >
          <span class="advanced-toggle-icon">
            <Icon name={advancedOpen ? "chevron-down" : "chevron-right"} size={16} />
          </span>
          <div class="advanced-toggle-text">
            <span class="advanced-toggle-title">{$_('settings.advancedSettings', { default: 'Advanced & Custom Styles' })}</span>
            <span class="advanced-toggle-subtitle">{$_('settings.advancedSettingsDesc', { default: 'Live CSS editor, theme package export, and script execution' })}</span>
          </div>
          <span class="pill-badge" style="margin-left: auto; font-size: 0.6875rem;">
            {advancedOpen ? $_('settings.hide', { default: 'Hide' }) : $_('settings.show', { default: 'Show' })}
          </span>
        </button>

        {#if advancedOpen}
          <div transition:slide class="advanced-section-inner">
            <!-- ── Custom CSS (user.css) ── -->
            <div class="inner-section" id="setting-custom-css">
              <span class="setting-title">{$_('settings.customCss', { default: 'Custom CSS (user.css)' })}</span>
              <span class="setting-description">{$_('settings.customCssDesc', { default: 'Quick live CSS stylesheet injection to style any player element (.player-bar, .sidebar, etc.)' })}</span>
              <textarea
                class="quick-css-input"
                bind:value={customCssInput}
                on:blur={handleCustomCssBlur}
                placeholder="/* Enter custom CSS rules to style any element across Audion (e.g. .player-bar, .sidebar) */"
                rows="4"
                spellcheck="false"
              ></textarea>
            </div>

            <div class="divider"></div>

            <!-- ── Theme / Skin Package Export ── -->
            <div class="inner-section" id="setting-theme-package">
              <span class="setting-title">{$_('settings.themePackage', { default: 'Export Skin Package' })}</span>
              <span class="setting-description">{$_('settings.themePackageDesc', { default: 'Save your current theme styling and custom CSS as a shareable .audionskin package' })}</span>

              <div class="pkg-fields">
                <input class="pkg-input" type="text" bind:value={pkgName} placeholder={$_('settings.themeNamePlaceholder', { default: 'Skin name' })} maxlength="64" />
                <input class="pkg-input" type="text" bind:value={pkgAuthor} placeholder={$_('settings.authorPlaceholder', { default: 'Author name' })} maxlength="64" />
                <input class="pkg-input" type="text" bind:value={pkgDescription} placeholder={$_('settings.descriptionPlaceholder', { default: 'Short description' })} maxlength="120" />
              </div>

              <div class="pkg-actions">
                <button type="button" class="btn-pkg btn-pkg-export" on:click={handleExport}>
                  <Icon name="download" size={14} />
                  <span>{$_('settings.export', { default: 'Export .audionskin' })}</span>
                </button>
              </div>

              {#if pkgExportSuccess}
                <span class="pkg-msg pkg-msg-ok">{pkgExportSuccess}</span>
              {/if}
              {#if pkgExportError}
                <span class="pkg-msg pkg-msg-err">{pkgExportError}</span>
              {/if}
            </div>

            <div class="divider"></div>

            <!-- ── Custom JavaScript ── -->
            <div class="inner-section" id="setting-custom-js">
              <div class="toggle-container">
                <div class="toggle-info">
                  <span class="setting-title">{$_('settings.enableCustomJs', { default: 'Enable Custom JavaScript' })}</span>
                  <span class="setting-description">{$_('settings.customJsDesc', { default: 'Execute custom scripts bundled with installed skins' })}</span>
                </div>
                <button
                  type="button"
                  class="toggle-btn"
                  class:active={$theme.allowCustomJs}
                  on:click={() => theme.setAllowCustomJs(!$theme.allowCustomJs)}
                  role="switch"
                  aria-checked={$theme.allowCustomJs}
                  aria-label={$_('settings.enableCustomJs', { default: 'Enable Custom JavaScript' })}
                >
                  <div class="toggle-handle"></div>
                </button>
              </div>

              <div class="security-warning-card" style="margin-top: 8px;">
                <Icon name="alert-triangle" size={15} className="warning-icon" />
                <span class="warning-text">
                  {$_('settings.customJsWarning', { default: 'Security Warning: Custom JavaScript allows arbitrary code execution in your app. Only enable if you trust the source.' })}
                </span>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .skins-toolbar {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    margin-bottom: var(--spacing-md);
  }

  .btn-folder {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    background-color: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    font-weight: 600;
    font-size: 0.8125rem;
    padding: 7px 15px;
    border-radius: var(--radius-full);
    border: none;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .btn-folder:hover {
    background-color: var(--accent-hover);
  }

  .btn-tool {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.8125rem;
    padding: 7px 14px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
  }

  .btn-tool:hover {
    background-color: var(--bg-highlight);
    border-color: var(--text-secondary);
  }

  .btn-studio {
    margin-left: auto;
    color: var(--accent-primary);
    border-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.35);
  }

  /* Active Skin Status Row (Integrated, flat, no nested box) */
  .active-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0;
    flex-wrap: wrap;
  }

  .active-meta-col {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .active-swatch-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px var(--border-color);
  }

  .active-label {
    font-size: 0.8125rem;
    color: var(--text-subdued);
  }

  .active-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .active-author {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .scheme-inline-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .scheme-inline-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .scheme-pill-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .scheme-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .scheme-pill:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .scheme-pill.selected {
    background: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.15);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .btn-reset-skin {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }

  .btn-reset-skin:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  /* Skins Grid (Flat, hairlines, no hover lift or shadow) */
  .skins-grid-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
  }

  .skins-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: var(--spacing-sm);
  }

  .skin-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
  }

  .skin-card:hover {
    background: var(--bg-highlight);
    border-color: var(--text-subdued);
  }

  .skin-card.active {
    border-color: var(--accent-primary);
    background: var(--bg-highlight);
    cursor: default;
  }

  .skin-palette-bar {
    display: flex;
    height: 6px;
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
  }

  .palette-swatch {
    flex: 1;
    height: 100%;
  }

  .skin-card-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .skin-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .skin-card-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--accent-primary);
  }

  .skin-card-sub {
    font-size: 0.75rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skin-card-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }

  .btn-apply-card {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 14px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border: none;
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .btn-apply-card:hover {
    background: var(--accent-hover);
  }

  .action-icons {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .btn-icon-subtle {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--text-subdued);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }

  .btn-icon-subtle:hover {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .btn-icon-subtle.danger:hover {
    color: var(--error-color, #ff4d4f);
    background: rgba(255, 77, 79, 0.12);
  }

  /* Empty state */
  .skins-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--spacing-xl) var(--spacing-md);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    border: 1px dashed var(--border-color);
  }

  .empty-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--bg-highlight);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    margin-bottom: var(--spacing-md);
  }

  .skins-empty-state h3 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--spacing-xs);
  }

  .skins-empty-state p {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    max-width: 480px;
    margin-bottom: var(--spacing-lg);
  }

  .empty-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    justify-content: center;
  }

  /* Community toggle header */
  .community-toggle-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .community-wrapper {
    margin-top: var(--spacing-sm);
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Advanced section & CSS editor ── */
  .advanced-section-wrapper {
    margin-top: var(--spacing-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    background: var(--bg-surface);
  }

  .advanced-toggle-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .advanced-toggle-btn:hover {
    background: var(--bg-highlight);
  }

  .advanced-toggle-icon {
    color: var(--text-subdued);
    display: flex;
    align-items: center;
  }

  .advanced-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .advanced-toggle-title {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .advanced-toggle-subtitle {
    font-size: 0.75rem;
    color: var(--text-subdued);
  }

  .advanced-section-inner {
    padding: 14px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-base);
  }

  .quick-css-input {
    width: 100%;
    margin-top: 8px;
    background: var(--bg-surface, #0d0d0d);
    border: 1px solid var(--border-color, #333);
    border-radius: var(--radius-sm, 6px);
    padding: 10px 12px;
    color: var(--text-primary, #e0e0e0);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  .quick-css-input:focus {
    border-color: var(--accent-primary);
  }

  .pkg-fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }

  .pkg-input {
    padding: 7px 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-fast);
  }

  .pkg-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .pkg-input::placeholder {
    color: var(--text-subdued);
  }

  .pkg-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .btn-pkg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-full);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: background var(--transition-fast), opacity var(--transition-fast);
  }

  .btn-pkg-export {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  .btn-pkg-export:hover {
    background: var(--accent-hover);
  }

  .pkg-msg {
    display: block;
    margin-top: 8px;
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
  }

  .pkg-msg-ok {
    background: rgba(29, 185, 84, 0.15);
    color: var(--accent-primary);
  }

  .pkg-msg-err {
    background: rgba(231, 76, 60, 0.12);
    color: var(--error-color, #e74c3c);
  }

  .security-warning-card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: var(--radius-sm, 6px);
  }

  :global(.warning-icon) {
    color: #eab308;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .warning-text {
    font-size: 0.78125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
</style>
