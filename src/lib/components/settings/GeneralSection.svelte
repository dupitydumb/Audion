<script lang="ts">
  import { _, locale } from "svelte-i18n";
  import { appSettings, type StartupPage } from "$lib/stores/settings";
  import { isAndroid, getAutostartEnabled, setAutostartEnabled } from "$lib/api/tauri";
  import { isMobile } from "$lib/stores/mobile";
  import { showShortcutsHelp } from "$lib/stores/shortcuts";
  import Icon from "$lib/components/Icon.svelte";
  import { onMount } from "svelte";
  import SettingRow from "./SettingRow.svelte";
  import SettingToggle from "./SettingToggle.svelte";

  export let open: boolean = true;

  // ---------------------------------------------------------------------
  // 1. Startup Page Dropdown
  // ---------------------------------------------------------------------
  let startupPageDropdownOpen = false;
  let startupPageDropdownRef: HTMLDivElement | null = null;

  const startupPageOptions: { value: StartupPage; labelKey: string; default: string }[] = [
    { value: 'home', labelKey: 'settings.startupHome', default: 'Home' },
    { value: 'tracks', labelKey: 'settings.startupTracks', default: 'Tracks' },
    { value: 'albums', labelKey: 'settings.startupAlbums', default: 'Albums' },
    { value: 'artists', labelKey: 'settings.startupArtists', default: 'Artists' },
    { value: 'playlists', labelKey: 'settings.startupPlaylists', default: 'Playlists' },
    { value: 'liked-songs', labelKey: 'settings.startupLikedSongs', default: 'Liked Songs' },
    { value: 'discover', labelKey: 'settings.startupDiscover', default: 'Discover' },
    { value: 'plugins', labelKey: 'settings.startupPlugins', default: 'Plugins' },
    { value: 'listenbrainz', labelKey: 'settings.startupListenBrainz', default: 'ListenBrainz' },
    { value: 'settings', labelKey: 'settings.startupSettings', default: 'Settings' },
    { value: 'last-visited', labelKey: 'settings.startupLastVisited', default: 'Last visited page' },
  ];

  $: selectedStartupPageLabel = (() => {
    const opt = startupPageOptions.find((o) => o.value === $appSettings.startupPage);
    return opt ? $_(opt.labelKey, { default: opt.default }) : $_('settings.startupHome', { default: 'Home' });
  })();

  function handleStartupPageDropdownToggle() {
    startupPageDropdownOpen = !startupPageDropdownOpen;
    if (startupPageDropdownOpen) languageDropdownOpen = false;
  }

  function handleStartupPageSelect(value: StartupPage) {
    if (value !== $appSettings.startupPage) {
      appSettings.setStartupPage(value);
    }
    startupPageDropdownOpen = false;
  }

  // ---------------------------------------------------------------------
  // 2. Language Dropdown
  // ---------------------------------------------------------------------
  let languageDropdownOpen = false;
  let languageDropdownRef: HTMLDivElement | null = null;

  const availableLanguages = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'ru', label: 'Русский' },
  ];

  $: currentLanguageLabel = availableLanguages.find((l) => l.code === $locale)?.label ?? 'English';

  function toggleLanguageDropdown() {
    languageDropdownOpen = !languageDropdownOpen;
    if (languageDropdownOpen) startupPageDropdownOpen = false;
  }

  function changeLanguage(code: string) {
    locale.set(code);
    try {
      localStorage.setItem('locale', code);
    } catch {}
    languageDropdownOpen = false;
  }

  function handleDropdownOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (startupPageDropdownRef && !startupPageDropdownRef.contains(target)) {
      startupPageDropdownOpen = false;
    }
    if (languageDropdownRef && !languageDropdownRef.contains(target)) {
      languageDropdownOpen = false;
    }
  }

  function handleDropdownKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      startupPageDropdownOpen = false;
      languageDropdownOpen = false;
    }
  }

  // ---------------------------------------------------------------------
  // 3. Launch on Startup
  // ---------------------------------------------------------------------
  let autostartEnabled = false;
  let autostartPending = false;

  async function toggleAutostart(next: boolean) {
    if (autostartPending) return;
    autostartPending = true;
    autostartEnabled = next;
    try {
      await setAutostartEnabled(next);
    } catch (e) {
      autostartEnabled = !next;
      console.error("Failed to update launch on startup:", e);
    } finally {
      autostartPending = false;
    }
  }

  onMount(() => {
    if (!isAndroid()) {
      getAutostartEnabled()
        .then((enabled) => (autostartEnabled = enabled))
        .catch((e) => console.error("Failed to read launch on startup state:", e));
    }
  });
</script>

<svelte:window on:mousedown={handleDropdownOutside} on:keydown={handleDropdownKeydown} />

<section class="settings-section" aria-labelledby="general-heading">
  <div class="settings-card">
    <!-- 1. Startup Page -->
    <SettingRow
      id="setting-startup-page"
      label={$_('settings.startupPage', { default: 'Startup page' })}
      description={$_('settings.startupPageDesc', { default: 'Choose which view appears when Audion opens.' })}
    >
      <div class="device-dropdown-wrap" bind:this={startupPageDropdownRef}>
        <button
          type="button"
          class="device-dropdown-trigger"
          class:open={startupPageDropdownOpen}
          on:click={handleStartupPageDropdownToggle}
          aria-haspopup="listbox"
          aria-expanded={startupPageDropdownOpen}
          aria-label={$_('settings.startupPage', { default: 'Startup page' })}
        >
          <span class="device-dropdown-label">{selectedStartupPageLabel}</span>
          <span class="device-dropdown-chevron" class:rotated={startupPageDropdownOpen}>
            <Icon name="chevron-down" size={12} />
          </span>
        </button>

        {#if startupPageDropdownOpen}
          <div class="device-dropdown-menu" role="listbox" aria-label={$_('settings.startupPage', { default: 'Startup page' })}>
            {#each startupPageOptions as option}
              {@const selected = option.value === $appSettings.startupPage}
              <div
                class="device-dropdown-item"
                class:selected
                role="option"
                aria-selected={selected}
                tabindex="0"
                on:click={() => handleStartupPageSelect(option.value)}
                on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStartupPageSelect(option.value); } }}
              >
                <span class="device-item-check">
                  {#if selected}
                    <Icon name="check" size={12} />
                  {/if}
                </span>
                <span class="device-item-name">{$_(option.labelKey, { default: option.default })}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </SettingRow>

    <!-- 2. Launch on Startup (Desktop only) -->
    {#if !isAndroid()}
      <SettingRow
        id="setting-autostart"
        label={$_('settings.launchOnStartup', { default: 'Launch on startup' })}
        description={$_('settings.launchOnStartupDesc', { default: 'Automatically start Audion when your computer boots up.' })}
        disabled={autostartPending}
      >
        <SettingToggle
          checked={autostartEnabled}
          disabled={autostartPending}
          label={$_('settings.launchOnStartup', { default: 'Launch on startup' })}
          on:change={(e) => toggleAutostart(e.detail)}
        />
      </SettingRow>
    {/if}

    <!-- 3. Language Selector -->
    <SettingRow
      id="setting-language"
      label={$_('settings.selectLanguage', { default: 'Language' })}
      description={$_('settings.languageDesc', { default: 'Choose your preferred language for the interface.' })}
    >
      <div class="device-dropdown-wrap" bind:this={languageDropdownRef}>
        <button
          type="button"
          class="device-dropdown-trigger"
          class:open={languageDropdownOpen}
          on:click={toggleLanguageDropdown}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
          aria-label={$_('settings.selectLanguage', { default: 'Language' })}
        >
          <span class="device-dropdown-label">{currentLanguageLabel}</span>
          <span class="device-dropdown-chevron" class:rotated={languageDropdownOpen}>
            <Icon name="chevron-down" size={12} />
          </span>
        </button>

        {#if languageDropdownOpen}
          <div class="device-dropdown-menu" role="listbox" aria-label={$_('settings.selectLanguage', { default: 'Language' })}>
            {#each availableLanguages as lang}
              {@const selected = lang.code === $locale}
              <div
                class="device-dropdown-item"
                class:selected
                role="option"
                aria-selected={selected}
                tabindex="0"
                on:click={() => changeLanguage(lang.code)}
                on:keydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    changeLanguage(lang.code);
                  }
                }}
              >
                <span class="device-item-check">
                  {#if selected}
                    <Icon name="check" size={12} />
                  {/if}
                </span>
                <span class="device-item-name">{lang.label}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </SettingRow>

    <!-- 4. Keyboard Shortcuts (Desktop only) -->
    {#if !$isMobile}
      <SettingRow
        id="setting-shortcuts"
        label={$_('settings.shortcuts', { default: 'Keyboard shortcuts' })}
        description={$_('settings.enableShortcutsDesc', { default: 'Control playback using global and application hotkeys.' })}
      >
        <div class="shortcuts-control-group">
          <button
            type="button"
            class="btn-customize-shortcuts"
            on:click={() => showShortcutsHelp()}
            disabled={!$appSettings.shortcutsEnabled}
          >
            <Icon name="keyboard" size={14} />
            <span>{$_('settings.editShortcuts', { default: 'Customize' })}</span>
          </button>
          <SettingToggle
            checked={$appSettings.shortcutsEnabled}
            label={$_('settings.toggleShortcuts', { default: 'Toggle keyboard shortcuts' })}
            on:change={(e) => appSettings.setShortcutsEnabled(e.detail)}
          />
        </div>
      </SettingRow>
    {/if}
  </div>
</section>

<style>
  .settings-section {
    margin-bottom: var(--spacing-md, 16px);
  }

  .settings-card {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-color);
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .device-dropdown-wrap {
    position: relative;
    width: 200px;
  }

  .device-dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .device-dropdown-trigger:hover,
  .device-dropdown-trigger.open {
    border-color: var(--accent-primary);
  }

  .device-dropdown-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .device-dropdown-chevron {
    color: var(--text-subdued);
    transition: transform var(--transition-fast);
    display: flex;
    align-items: center;
  }

  .device-dropdown-chevron.rotated {
    transform: rotate(180deg);
  }

  .device-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    max-height: 240px;
    overflow-y: auto;
    z-index: 100;
    padding: 4px;
  }

  .device-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }

  .device-dropdown-item:hover,
  .device-dropdown-item:focus {
    background: var(--bg-highlight);
    color: var(--text-primary);
    outline: none;
  }

  .device-dropdown-item.selected {
    color: var(--accent-primary);
    font-weight: 500;
  }

  .device-item-check {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .device-item-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcuts-control-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .btn-customize-shortcuts {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-customize-shortcuts:hover:not(:disabled) {
    background: var(--bg-highlight);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .btn-customize-shortcuts:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
