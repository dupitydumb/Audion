<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { authState, isLoggedIn, deleteAccount } from "$lib/stores/sync";
  import { confirm } from "$lib/stores/dialogs";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="privacy-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="shield" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.privacy')}</span>
      <span class="accordion-subtitle">{$_('settings.privacySubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
    <div class="toggle-container">
      <div class="toggle-info">
        <span class="setting-title">{$_('settings.remoteControl')}</span>
        <span class="setting-description">{$_('settings.remoteControlDesc')}</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$appSettings.remoteControlEnabled}
        on:click={() => appSettings.setRemoteControlEnabled(!$appSettings.remoteControlEnabled)}
        role="switch"
        aria-checked={$appSettings.remoteControlEnabled}
        aria-label="Toggle Remote Control"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <div class="divider"></div>

    <div class="toggle-container">
      <div class="toggle-info">
        <span class="setting-title">{$_('settings.developerMode')}</span>
        <span class="setting-description">{$_('settings.developerModeDesc')}</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$appSettings.developerMode}
        on:click={() => appSettings.setDeveloperMode(!$appSettings.developerMode)}
        role="switch"
        aria-checked={$appSettings.developerMode}
        aria-label="Toggle Developer Mode"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <div class="divider"></div>

    <div class="card-title-group compact">
      <h3 class="setting-title" style="color: var(--error-color)">{$_('settings.dangerZone')}</h3>
      <span class="setting-description">{$_('settings.dangerZoneDesc')}</span>
    </div>

    <div class="button-group-row">
      <button class="btn-outline-compact danger" on:click={async () => {
          const confirmed = await confirm(
            "Are you sure you want to reset the database? This will clear all tracks and metadata, but your music files will remain on your computer.",
            { title: "Reset Database", confirmLabel: "Proceed", danger: true },
          );
          if (!confirmed) return;
          // Reset modal flow handled by parent
        }}>{$_('settings.resetDatabase')}</button>
      {#if $isLoggedIn}
        <button class="btn-outline-compact danger" on:click={async () => {
          const ok = await confirm($_('settings.deleteAccount'), { title: $_('settings.deleteAccount'), danger: true });
          if (ok) await deleteAccount();
        }}>{$_('settings.deleteAccount')}</button>
      {/if}
    </div>
    </div>
  </div>
  {/if}
</section>
