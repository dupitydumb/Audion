<script lang="ts">
  import AudioSection from "./settings/AudioSection.svelte";
  import EqualizerEditor from "./settings/EqualizerEditor.svelte";
  import AppearanceSection from "./settings/AppearanceSection.svelte";
  import ThemeBrowserSection from "./settings/ThemeBrowserSection.svelte";
  import StartupSection from "./settings/StartupSection.svelte";
  import PlaybackSection from "./settings/PlaybackSection.svelte";
  import SyncSection from "./settings/SyncSection.svelte";
  import AccountSection from "./settings/AccountSection.svelte";
  import SubsonicSection from "./settings/SubsonicSection.svelte";
  import StorageSection from "./settings/StorageSection.svelte";
  import ArtistsSection from "./settings/ArtistsSection.svelte";
  import LyricsSection from "./settings/LyricsSection.svelte";
  import ShortcutsSection from "./settings/ShortcutsSection.svelte";
  import PrivacySection from "./settings/PrivacySection.svelte";
  import CommunitySection from "./settings/CommunitySection.svelte";
  import UpgradeSection from "./settings/UpgradeSection.svelte";
  import AboutSection from "./settings/AboutSection.svelte";
  import SupportSection from "./settings/SupportSection.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import "./settings/styles.css";
  import { _ } from "svelte-i18n";
  import { isLoggedIn } from "$lib/stores/sync";
  import { isMobile } from "$lib/stores/mobile";

  let showEqEditor = false;
  let activeTab = 'sound';
  let searchQuery = '';

  // On desktop, all sections are always open (no accordion).
  // matchMedia is safe here — Settings only renders client-side.
  const desktopQuery = typeof window !== 'undefined'
    ? window.matchMedia('(min-width: 641px)')
    : null;
  let isDesktop = desktopQuery?.matches ?? true;
  desktopQuery?.addEventListener('change', (e) => { isDesktop = e.matches; });

  const TABS = [
    { id: 'sound',      icon: 'volume-2',        label: 'Sound'      },
    { id: 'library',    icon: 'library',          label: 'Library'    },
    { id: 'appearance', icon: 'monitor',          label: 'Appearance' },
    { id: 'account',    icon: 'user',             label: 'Account'    },
    { id: 'more',       icon: 'more-horizontal',  label: 'More'       },
  ];

  type SettingIndexItem = {
    sectionId: string;
    targetElementId?: string;
    tab: string;
    tabLabel: string;
    title: string;
    subtitle?: string;
    keywords: string[];
  };

  const SETTINGS_INDEX: SettingIndexItem[] = [
    // Sound Tab
    { sectionId: 'audio', targetElementId: 'setting-equalizer', tab: 'sound', tabLabel: 'Sound', title: 'Equalizer & EQ Presets', subtitle: 'Audio frequency bands, presets, customizable EQ', keywords: ['equalizer', 'eq', 'bass', 'treble', 'bands', 'preset', 'frequency', 'gain', 'preamp'] },
    { sectionId: 'audio', targetElementId: 'setting-output-driver', tab: 'sound', tabLabel: 'Sound', title: 'Output Driver & Device', subtitle: 'Select native, rodio, or HTML5 playback engine', keywords: ['output', 'device', 'driver', 'native', 'html5', 'sound', 'speaker', 'headphone'] },
    { sectionId: 'audio', targetElementId: 'setting-replay-gain', tab: 'sound', tabLabel: 'Sound', title: 'ReplayGain & Audio Limiter', subtitle: 'Volume normalization and clipping protection', keywords: ['replaygain', 'replay gain', 'limiter', 'clipping', 'loudness', 'normalize', 'volume'] },
    { sectionId: 'audio', targetElementId: 'setting-crossfade', tab: 'sound', tabLabel: 'Sound', title: 'Crossfade', subtitle: 'Fade between consecutive tracks', keywords: ['crossfade', 'fade', 'transition', 'gapless'] },
    { sectionId: 'playback', tab: 'sound', tabLabel: 'Sound', title: 'Autoplay & Queue', subtitle: 'Keep playing when queue finishes', keywords: ['playback', 'autoplay', 'queue', 'play', 'infinite'] },
    { sectionId: 'lyrics', tab: 'sound', tabLabel: 'Sound', title: 'Lyrics Providers & Sync', subtitle: 'Synced karaoke lyrics, LRCLIB & Genius sources', keywords: ['lyrics', 'synced', 'karaoke', 'lrc', 'lrclib', 'genius', 'provider', 'text', 'words'] },

    // Library Tab
    { sectionId: 'storage', targetElementId: 'setting-download-location', tab: 'library', tabLabel: 'Library', title: 'Download Location', subtitle: 'Directory where downloaded tracks and files are saved', keywords: ['download location', 'download folder', 'downloads', 'path', 'save directory', 'location'] },
    { sectionId: 'storage', targetElementId: 'setting-music-folders', tab: 'library', tabLabel: 'Library', title: 'Music Library Folders', subtitle: 'Folders scanned for audio files and tags', keywords: ['music folder', 'scan folder', 'add folder', 'directory', 'rescan', 'library folder', 'storage'] },
    { sectionId: 'storage', targetElementId: 'setting-cover-management', tab: 'library', tabLabel: 'Library', title: 'Cover Management & Cache', subtitle: 'Sync album covers or merge duplicates to free disk space', keywords: ['cover', 'cache', 'covers', 'merge duplicates', 'album art', 'disk space', 'artwork'] },
    { sectionId: 'artists', tab: 'library', tabLabel: 'Library', title: 'Artist Separation Delimiters', subtitle: 'Split collaboration tracks by delimiters', keywords: ['artist', 'separator', 'featuring', 'ft', 'delimiters', 'split', 'collab'] },

    // Appearance Tab
    { sectionId: 'appearance', targetElementId: 'setting-theme-mode', tab: 'appearance', tabLabel: 'Appearance', title: 'Theme Mode (Dark / Light / System)', subtitle: 'Switch between dark, light, or auto theme mode', keywords: ['theme mode', 'dark mode', 'light mode', 'system mode', 'theme', 'color scheme'] },
    { sectionId: 'appearance', targetElementId: 'setting-accent-color', tab: 'appearance', tabLabel: 'Appearance', title: 'Accent Colors & Palette Tokens', subtitle: 'Pick preset accents or configure custom token colors', keywords: ['accent', 'color', 'custom colors', 'palette', 'green', 'blue', 'tokens', 'background'] },
    { sectionId: 'appearance', targetElementId: 'setting-background', tab: 'appearance', tabLabel: 'Appearance', title: 'Background Effects & Custom JS', subtitle: 'Gradients, canvas visual effects, custom scripts', keywords: ['background', 'customjs', 'custom js', 'canvas', 'effect', 'overlay', 'gradient', 'blur', 'animation'] },
    { sectionId: 'appearance', targetElementId: 'setting-theme-package', tab: 'appearance', tabLabel: 'Appearance', title: 'Theme Package Export & Import', subtitle: 'Save and load .audiotheme files', keywords: ['audiotheme', 'export theme', 'import theme', 'package', 'share theme'] },
    { sectionId: 'themes', tab: 'appearance', tabLabel: 'Appearance', title: 'Community Theme Browser', subtitle: 'Explore community themes: Nord, Catppuccin, Gruvbox, etc.', keywords: ['theme browser', 'community themes', 'nord', 'catppuccin', 'mocha', 'gruvbox', 'matrix', 'frost', 'install theme'] },
    { sectionId: 'startup', tab: 'appearance', tabLabel: 'Appearance', title: 'Startup Page & Autostart', subtitle: 'Choose initial landing view and system boot start', keywords: ['startup', 'autostart', 'boot', 'launch', 'default page', 'home page'] },

    // Account Tab
    { sectionId: 'account', tab: 'account', tabLabel: 'Account', title: 'Account Profile & Supporter', subtitle: 'Cloud sign-in, avatar, and supporter status', keywords: ['account', 'login', 'logout', 'user', 'profile', 'supporter', 'subscription', 'avatar'] },
    { sectionId: 'subsonic', tab: 'account', tabLabel: 'Account', title: 'Subsonic & Navidrome Server', subtitle: 'Connect your personal self-hosted music server', keywords: ['subsonic', 'navidrome', 'server', 'stream', 'remote library', 'url', 'credentials', 'self hosted'] },
    { sectionId: 'sync', tab: 'account', tabLabel: 'Account', title: 'Cloud & Database Sync', subtitle: 'Real-time synchronization across devices', keywords: ['sync', 'cloud sync', 'backup', 'devices', 'pending changes', 'library status'] },
    { sectionId: 'community', tab: 'account', tabLabel: 'Account', title: 'ListenBrainz Scrobbling', subtitle: 'Track listening statistics and user token', keywords: ['listenbrainz', 'scrobble', 'token', 'tracking', 'history', 'stats'] },

    // More Tab
    { sectionId: 'shortcuts', tab: 'more', tabLabel: 'More', title: 'Keyboard Shortcuts', subtitle: 'View and customize player hotkeys', keywords: ['shortcuts', 'hotkeys', 'keyboard', 'keybindings', 'space', 'play pause', 'skip'] },
    { sectionId: 'privacy', targetElementId: 'setting-cache-database', tab: 'more', tabLabel: 'More', title: 'Cache & Reset Database', subtitle: 'Wipe database metadata, clear track index, or manage logs', keywords: ['cache', 'reset database', 'clear cache', 'database', 'wipe', 'danger zone', 'delete'] },
    { sectionId: 'privacy', tab: 'more', tabLabel: 'More', title: 'Remote Control & Privacy', subtitle: 'Allow external remote control and telemetry options', keywords: ['privacy', 'remote control', 'developer mode', 'telemetry', 'logs'] },
    { sectionId: 'upgrade', tab: 'more', tabLabel: 'More', title: 'Support & Supporter Access', subtitle: 'Support the project development', keywords: ['upgrade', 'support', 'donate', 'patreon', 'pro', 'tier'] },
    { sectionId: 'support', tab: 'more', tabLabel: 'More', title: 'Discord Community & Feedback', subtitle: 'Chat with developers and get assistance', keywords: ['help', 'discord', 'support', 'issues', 'bugs', 'github', 'community'] },
    { sectionId: 'about', tab: 'more', tabLabel: 'More', title: 'About Audion & Release Notes', subtitle: 'Version info, credits, and updates', keywords: ['about', 'version', 'update', 'changelog', 'release', 'credits', 'license', 'github'] },
  ];

  $: searchResults = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_INDEX.filter(item => {
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.subtitle?.toLowerCase().includes(q)) return true;
      if (item.tabLabel.toLowerCase().includes(q)) return true;
      return item.keywords.some(k => k.toLowerCase().includes(q));
    });
  })();

  function navigateToSetting(item: SettingIndexItem) {
    activeTab = item.tab;
    openSections = { [item.sectionId]: true };
    searchQuery = '';

    // Scroll directly to target item element or to section container
    setTimeout(() => {
      let targetEl: HTMLElement | null = null;
      if (item.targetElementId) {
        targetEl = document.getElementById(item.targetElementId);
      }
      if (!targetEl) {
        targetEl = document.querySelector(`[aria-labelledby="${item.sectionId}-heading"]`);
      }
      if (targetEl) {
        const pane = targetEl.closest('.settings-pane') as HTMLElement | null;
        if (pane) {
          const paneRect = pane.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const targetTopRelativeToPane = targetRect.top - paneRect.top + pane.scrollTop;
          const centeredScrollTop = targetTopRelativeToPane - (pane.clientHeight / 2) + (targetRect.height / 2);
          pane.scrollTo({
            top: Math.max(0, centeredScrollTop),
            behavior: 'smooth'
          });
        } else {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        targetEl.classList.remove('setting-highlight-flash');
        // Force reflow for animation restart
        void targetEl.offsetWidth;
        targetEl.classList.add('setting-highlight-flash');
        setTimeout(() => {
          targetEl?.classList.remove('setting-highlight-flash');
        }, 2200);
      }
    }, 120);
  }

  // On desktop (≥641px) all sections expand; CSS hides accordion triggers.
  // On mobile, accordion toggles work normally.
  let openSections: Record<string, boolean> = {};

  function toggle(section: string) {
    const isCurrentlyOpen = !!openSections[section];
    openSections = { [section]: !isCurrentlyOpen };
  }

  function switchTab(id: string) {
    activeTab = id;
    openSections = {};
  }
</script>

<div class="settings-view">

  <!-- Header & Search Toolbar -->
  {#if !showEqEditor}
  <div class="settings-header-bar">
    <div class="settings-search-wrapper">
      <Icon name="search" size={15} className="search-icon" />
      <input
        type="search"
        class="settings-search-input"
        placeholder="Search settings (equalizer, download location, cache, themes...)"
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button class="search-clear-btn" on:click={() => searchQuery = ''} aria-label="Clear search">
          <Icon name="x" size={13} />
        </button>
      {/if}
    </div>

    <!-- Search Dropdown / Live Results -->
    {#if searchQuery.trim()}
      <div class="settings-search-results">
        {#if searchResults.length === 0}
          <div class="search-no-results">
            No settings found matching "{searchQuery}"
          </div>
        {:else}
          {#each searchResults as res}
            <button class="search-result-item" on:click={() => navigateToSetting(res)}>
              <div class="search-res-text">
                <span class="search-res-title">{res.title}</span>
                {#if res.subtitle}
                  <span class="search-res-subtitle">{res.subtitle}</span>
                {/if}
              </div>
              <span class="search-res-tab">{res.tabLabel}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Tab bar -->
  <div class="settings-tabs" role="tablist">
    {#each TABS as tab}
      <button
        class="tab-btn"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls="panel-{tab.id}"
        on:click={() => switchTab(tab.id)}
      >
        <Icon name={tab.icon} size={15} />
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>
  {/if}

  <!-- Content -->
  <div class="settings-content">

    {#if showEqEditor}
      <div class="settings-pane">
        <EqualizerEditor on:back={() => showEqEditor = false} />
      </div>

    {:else if activeTab === 'sound'}
      <div class="settings-pane settings-container" id="panel-sound" role="tabpanel">
        <AudioSection    open={isDesktop || (openSections['audio']    ?? false)} on:toggle={() => toggle('audio')}    on:openEqEditor={() => showEqEditor = true} />
        <PlaybackSection open={isDesktop || (openSections['playback'] ?? false)} on:toggle={() => toggle('playback')} />
        <LyricsSection   open={isDesktop || (openSections['lyrics']   ?? false)} on:toggle={() => toggle('lyrics')}   />
      </div>

    {:else if activeTab === 'library'}
      <div class="settings-pane settings-container" id="panel-library" role="tabpanel">
        <StorageSection  open={isDesktop || (openSections['storage']  ?? false)} on:toggle={() => toggle('storage')}  />
        <ArtistsSection  open={isDesktop || (openSections['artists']  ?? false)} on:toggle={() => toggle('artists')}  />
      </div>

    {:else if activeTab === 'appearance'}
      <div class="settings-pane settings-container" id="panel-appearance" role="tabpanel">
        <AppearanceSection    open={isDesktop || (openSections['appearance'] ?? false)} on:toggle={() => toggle('appearance')} />
        <ThemeBrowserSection  open={isDesktop || (openSections['themes']     ?? false)} on:toggle={() => toggle('themes')}     />
        <StartupSection       open={isDesktop || (openSections['startup']    ?? false)} on:toggle={() => toggle('startup')}    />
      </div>

    {:else if activeTab === 'account'}
      <div class="settings-pane settings-container" id="panel-account" role="tabpanel">
        <AccountSection   open={isDesktop || (openSections['account']    ?? false)} on:toggle={() => toggle('account')}    />
        <SubsonicSection  open={isDesktop || (openSections['subsonic']   ?? false)} on:toggle={() => toggle('subsonic')}   />
        {#if $isLoggedIn}
          <SyncSection    open={isDesktop || (openSections['sync']       ?? false)} on:toggle={() => toggle('sync')}        />
        {/if}
        <CommunitySection open={isDesktop || (openSections['community']  ?? false)} on:toggle={() => toggle('community')}   />
      </div>

    {:else if activeTab === 'more'}
      <div class="settings-pane settings-container" id="panel-more" role="tabpanel">
        {#if !$isMobile}
          <ShortcutsSection open={isDesktop || (openSections['shortcuts']  ?? false)} on:toggle={() => toggle('shortcuts')}  />
        {/if}
        <PrivacySection   open={isDesktop || (openSections['privacy']    ?? false)} on:toggle={() => toggle('privacy')}    />
        <UpgradeSection   open={isDesktop || (openSections['upgrade']    ?? false)} on:toggle={() => toggle('upgrade')}    />
        <SupportSection   open={isDesktop || (openSections['support']    ?? false)} on:toggle={() => toggle('support')}    />
        <AboutSection     open={isDesktop || (openSections['about']      ?? false)} on:toggle={() => toggle('about')}      />
      </div>
    {/if}

  </div>
</div>

<style>
  .settings-view {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header Bar & Search ── */
  .settings-header-bar {
    position: relative;
    padding: 12px 16px;
    background: var(--bg-base);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    z-index: 20;
  }

  .settings-search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    max-width: 600px;
    margin: 0 auto;
  }

  .settings-search-wrapper :global(.search-icon) {
    position: absolute;
    left: 12px;
    color: var(--text-subdued);
    pointer-events: none;
  }

  .settings-search-input {
    width: 100%;
    height: 36px;
    padding: 0 34px 0 34px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .settings-search-input:focus {
    border-color: var(--accent-primary);
    background: var(--bg-elevated);
  }

  .settings-search-input::placeholder {
    color: var(--text-subdued);
  }

  .search-clear-btn {
    position: absolute;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .search-clear-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.2);
  }

  /* ── Search Dropdown Results ── */
  .settings-search-results {
    position: absolute;
    top: calc(100% + 4px);
    left: 16px;
    right: 16px;
    max-width: 600px;
    margin: 0 auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    z-index: 100;
  }

  .search-no-results {
    padding: 16px;
    font-size: 0.85rem;
    color: var(--text-subdued);
    text-align: center;
  }

  .search-result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border: none;
    background: transparent;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .search-result-item:last-child {
    border-bottom: none;
  }

  .search-result-item:hover {
    background: var(--bg-highlight);
  }

  .search-res-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .search-res-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .search-res-subtitle {
    font-size: 0.75rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-res-tab {
    font-size: 0.75rem;
    color: var(--text-subdued);
    background: var(--bg-surface);
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  /* ── Tab bar ── */
  .settings-tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-base);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .settings-tabs::-webkit-scrollbar { display: none; }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 14px;
    height: 44px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-subdued);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px; /* sit on the border */
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
    font-weight: 600;
  }

  /* ── Content ── */
  .settings-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .settings-pane {
    height: 100%;
    overflow-y: auto;
    padding: var(--spacing-md) var(--spacing-lg);
  }

  .settings-container {
    max-width: 100%;
    margin: 0 auto;
    padding-bottom: calc(var(--player-height, 80px) + 40px);
  }

  /* Glow highlight animation when navigating directly to setting item */
  :global(.setting-highlight-flash) {
    animation: setting-flash 2.2s ease-out forwards;
    border-radius: var(--radius-md, 8px);
  }

  @keyframes setting-flash {
    0% {
      outline: 2px solid var(--accent-primary);
      box-shadow: 0 0 16px var(--accent-primary);
      background-color: var(--bg-highlight);
    }
    50% {
      outline: 2px solid var(--accent-primary);
      box-shadow: 0 0 12px var(--accent-primary);
      background-color: var(--bg-highlight);
    }
    100% {
      outline: 2px solid transparent;
      box-shadow: none;
      background-color: transparent;
    }
  }

  @media (max-width: 768px) {
    .settings-container {
      padding-bottom: calc(var(--mobile-bottom-inset, 130px) + 40px);
    }

    .tab-btn {
      padding: 0 10px;
      font-size: 0.8rem;
      gap: 5px;
    }
  }

  /* Desktop: show all sections expanded, hide the accordion toggle button */
  @media (min-width: 641px) {
    .settings-container :global(.accordion-trigger) {
      cursor: default;
      pointer-events: none;
      /* Section heading style */
      padding: var(--spacing-sm) 0 var(--spacing-sm) 0;
      border-radius: 0;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: var(--spacing-md);
      background: none !important;
    }
    .settings-container :global(.accordion-title) {
      font-size: 1rem;
      font-weight: var(--font-weight-bold);
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .settings-container :global(.accordion-subtitle) {
      font-size: var(--font-size-sm);
      color: var(--text-subdued);
    }
    .settings-container :global(.accordion-icon) {
      color: var(--accent-primary);
    }
    .settings-container :global(.accordion-chevron) {
      display: none;
    }
    /* Remove section bottom border — heading border replaces it */
    .settings-container :global(.settings-section) {
      border-bottom: none;
      margin-bottom: var(--spacing-xl);
    }
    .settings-container :global(.settings-section:last-child) {
      margin-bottom: 0;
    }
  }
</style>
