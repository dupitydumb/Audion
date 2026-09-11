<script lang="ts">
  import { _ } from "svelte-i18n";
  import { supportsOta, otaState, otaEnabled, setOtaEnabled, startOtaDownload, installOtaNow, deferOtaInstallToClose, skipOtaVersion, type PendingUpdateNotes } from "$lib/stores/otaUpdate";
  import { updates } from "$lib/stores/updates";
  import UpdatePopup from "../UpdatePopup.svelte";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  let showUpdatePopup = false;
  let updatePopupMode: "github" | "ota" = "github";
  let updatePopupRelease: any = null;

  function otaNotesToRelease(notes: PendingUpdateNotes | null) {
    if (!notes) return null;
    return {
      tag_name: notes.version,
      name: `Version ${notes.version}`,
      body: notes.body ?? null,
      published_at: notes.date ?? "",
      assets: [],
    };
  }

  function handleRefresh() {
    window.location.reload();
  }
</script>

<section class="settings-section" aria-labelledby="about-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="info" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.about')}</span>
      <span class="accordion-subtitle">{$_('settings.aboutSubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
    {#if supportsOta()}
      <div class="toggle-container">
        <div class="toggle-info">
          <span class="setting-title">{$_('settings.otaEnabled')}</span>
          <span class="setting-description">{$_('settings.otaEnabledDesc')}</span>
        </div>
        <button
          class="toggle-btn"
          class:active={$otaEnabled}
          on:click={() => setOtaEnabled(!$otaEnabled)}
          role="switch"
          aria-checked={$otaEnabled}
          aria-label={$_('settings.otaEnabled')}
        >
          <div class="toggle-handle"></div>
        </button>
      </div>

      <div class="divider"></div>
    {/if}

    <div class="about-row">
      <div class="app-logo-sm">Audion</div>
      <div class="about-details">
        <span class="setting-title">Audion {__APP_VERSION__}</span>
        <span class="setting-description">{$_('settings.modernPlayerDesc')}</span>
      </div>
    </div>
    {#if $otaState.phase === "ready"}
      <div class="restart-notice">
        <div class="restart-notice-text">
          <span class="setting-title" style="color: var(--accent-primary)">{$_('settings.restartRequired')}</span>
          <span class="setting-description">{$_('settings.restartRequiredDesc', { values: { version: $otaState.notes?.version ?? '' } })}</span>
        </div>
        <button
          class="btn-restart-compact"
          on:click={() => {
            updatePopupRelease = otaNotesToRelease($otaState.notes);
            updatePopupMode = "ota";
            showUpdatePopup = true;
          }}
        >{$_('settings.restartToUpdate')}</button>
      </div>
    {:else if $otaState.phase === "downloading"}
      <div class="restart-notice">
        <div class="restart-notice-text">
          <span class="setting-title">{$_('updatePopup.downloading')}</span>
          <span class="setting-description">{$otaState.progress}%</span>
        </div>
      </div>
    {:else if $otaState.phase === "available"}
      <button
        class="btn-green-compact"
        on:click={() => {
          updatePopupRelease = otaNotesToRelease($otaState.notes);
          updatePopupMode = "ota";
          showUpdatePopup = true;
        }}
        style="margin-top: var(--spacing-sm)"
      >{$_('settings.updateAvailable')}</button>
    {:else if $updates.hasUpdate}
      <button class="btn-green-compact" on:click={() => { updatePopupRelease = $updates.latestRelease; updatePopupMode = "github"; showUpdatePopup = true; }} style="margin-top: var(--spacing-sm)">{$_('settings.updateAvailable')}</button>
    {/if}
  </div>
  </div>
  {/if}
</section>

{#if showUpdatePopup && updatePopupRelease}
  <UpdatePopup
    release={updatePopupRelease}
    mode={updatePopupMode}
    otaPhase={$otaState.phase === "downloading" || $otaState.phase === "ready" ? $otaState.phase : "available"}
    otaProgress={$otaState.progress}
    on:close={() => (showUpdatePopup = false)}
    on:download={() => startOtaDownload()}
    on:skip={() => { skipOtaVersion(); showUpdatePopup = false; }}
    on:restart={() => installOtaNow()}
    on:later={() => deferOtaInstallToClose()}
  />
{/if}
