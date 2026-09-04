<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings, type StartupPage } from "$lib/stores/settings";
  import { isAndroid, getAutostartEnabled, setAutostartEnabled } from "$lib/api/tauri";
  import Icon from "$lib/components/Icon.svelte";
  import { slide } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // ---------------------------------------------------------------------
  // startup page dropdown
  // ---------------------------------------------------------------------
  let startupPageDropdownOpen = false;
  let startupPageDropdownRef: HTMLDivElement;

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
  }

  function handleStartupPageSelect(value: StartupPage) {
    if (value !== $appSettings.startupPage) {
      appSettings.setStartupPage(value);
    }
    startupPageDropdownOpen = false;
  }

  function handleStartupPageDropdownKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      startupPageDropdownOpen = false;
    }
  }

  function handleStartupPageDropdownOutside(e: MouseEvent) {
    if (startupPageDropdownRef && !startupPageDropdownRef.contains(e.target as Node)) {
      startupPageDropdownOpen = false;
    }
  }

  // ---------------------------------------------------------------------
  // launch on startup (autostart) => desktop only
  // we read it fresh on mount rather than persisting a mirrored flag to not diverge
  // ---------------------------------------------------------------------
  let autostartEnabled = false;
  let autostartPending = false;

  async function toggleAutostart() {
    if (autostartPending) return;
    autostartPending = true;
    const next = !autostartEnabled;
    autostartEnabled = next; // optimistic
    try {
      await setAutostartEnabled(next);
    } catch (e) {
      autostartEnabled = !next; // revert on failure
      console.error("Failed to update launch on startup:", e);
    } finally {
      autostartPending = false;
    }
  }

  onMount(() => {
    // load current launch-on-startup state (desktop only; resolves false on Android)
    if (!isAndroid()) {
      getAutostartEnabled()
        .then((enabled) => (autostartEnabled = enabled))
        .catch((e) => console.error("Failed to read launch on startup state:", e));
    }
  });
</script>

<svelte:window on:mousedown={handleStartupPageDropdownOutside} />

<section class="settings-section" aria-labelledby="startup-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="power" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.startup', { default: 'Startup' })}</span>
      <span class="accordion-subtitle">{$_('settings.startupSubtitle', { default: 'Choose what happens when Audion launches' })}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <div class="inner-section">
          <span class="setting-title">{$_('settings.startupPage', { default: 'Startup page' })}</span>
          <span class="setting-description">{$_('settings.startupPageDesc', { default: 'Page to show when the app launches' })}</span>
          <div class="device-dropdown-wrap" style="margin-top: 6px;" bind:this={startupPageDropdownRef}>
            <button
              class="device-dropdown-trigger"
              class:open={startupPageDropdownOpen}
              on:click={handleStartupPageDropdownToggle}
              on:keydown={handleStartupPageDropdownKeydown}
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
              <div class="device-dropdown-menu startup-page-dropdown-menu" role="listbox" aria-label={$_('settings.startupPage', { default: 'Startup page' })}>
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
        </div>

        {#if !isAndroid()}
          <div class="divider"></div>
          <div class="inner-section">
            <span class="setting-title">{$_('settings.windowStartMode', { default: 'Window start mode' })}</span>
            <div class="segmented-pill">
              <button class="segment-btn" class:active={$appSettings.startMode === 'normal'} on:click={() => appSettings.setStartMode('normal')}>{$_('settings.normal', { default: 'Normal' })}</button>
              <button class="segment-btn" class:active={$appSettings.startMode === 'maximized'} on:click={() => appSettings.setStartMode('maximized')}>{$_('settings.max', { default: 'Max' })}</button>
              <button class="segment-btn" class:active={$appSettings.startMode === 'minimized'} on:click={() => appSettings.setStartMode('minimized')}>{$_('settings.min', { default: 'Min' })}</button>
            </div>
          </div>

          <div class="divider"></div>
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.closeToTray', { default: 'Close to tray' })}</span>
              <span class="setting-description">{$_('settings.closeToTrayDesc', { default: 'Hide the window to the system tray when closed' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.closeToTray}
              on:click={() => appSettings.setCloseToTray(!$appSettings.closeToTray)}
              role="switch"
              aria-checked={$appSettings.closeToTray}
              aria-label="Toggle Close to Tray"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>

          <div class="divider"></div>
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.launchOnStartup', { default: 'Launch on startup' })}</span>
              <span class="setting-description">{$_('settings.launchOnStartupDesc', { default: 'Automatically start Audion when you log in' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={autostartEnabled}
              on:click={toggleAutostart}
              disabled={autostartPending}
              role="switch"
              aria-checked={autostartEnabled}
              aria-label="Toggle Launch on Startup"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>