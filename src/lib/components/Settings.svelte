<script lang="ts">
  import AudioSection from "./settings/AudioSection.svelte";
  import EqualizerEditor from "./settings/EqualizerEditor.svelte";
  import AppearanceSection from "./settings/AppearanceSection.svelte";
  import StartupSection from "./settings/StartupSection.svelte";
  import PlaybackSection from "./settings/PlaybackSection.svelte";
  import SyncSection from "./settings/SyncSection.svelte";
  import AccountSection from "./settings/AccountSection.svelte";
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

  <!-- Tab bar -->
  {#if !showEqEditor}
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
        <AppearanceSection open={isDesktop || (openSections['appearance'] ?? false)} on:toggle={() => toggle('appearance')} />
        <StartupSection    open={isDesktop || (openSections['startup']    ?? false)} on:toggle={() => toggle('startup')}    />
      </div>

    {:else if activeTab === 'account'}
      <div class="settings-pane settings-container" id="panel-account" role="tabpanel">
        <AccountSection   open={isDesktop || (openSections['account']    ?? false)} on:toggle={() => toggle('account')}    />
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
