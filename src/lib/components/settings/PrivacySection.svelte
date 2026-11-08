<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { authState, isLoggedIn, deleteAccount } from "$lib/stores/sync";
  import { resetDatabase, clearFetchedCovers } from "$lib/api/tauri";
  import { purgeFetchedCovers } from "$lib/stores/library";
  import { stripFetchedCoversFromPlayer } from "$lib/stores/player";
  import { confirm } from "$lib/stores/dialogs";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = true;
  const dispatch = createEventDispatcher();

  let isClearingCovers = false;
  let clearCoversStatus = "";

  async function handleClearFetchedCovers() {
    if (isClearingCovers) return;
    const ok = await confirm(
      $_('settings.clearFetchedCoversConfirm', {
        default: 'Remove all covers that were fetched online? Covers from your music files and ones you set yourself are not affected.',
      }),
      {
        title: $_('settings.clearFetchedCovers', { default: 'Clear fetched covers' }),
        confirmLabel: $_('common.clear', { default: 'Clear' }),
        danger: true,
      }
    );
    if (!ok) return;

    isClearingCovers = true;
    clearCoversStatus = "";
    try {
      const clearedIds = await clearFetchedCovers();
      purgeFetchedCovers(clearedIds);
      stripFetchedCoversFromPlayer(clearedIds);
      clearCoversStatus = clearedIds.length > 0
        ? $_('settings.clearFetchedCoversDone', { values: { count: clearedIds.length }, default: `Cleared ${clearedIds.length} fetched cover(s).` })
        : $_('settings.clearFetchedCoversNone', { default: 'No fetched covers to clear.' });
    } catch (err) {
      clearCoversStatus = $_('settings.clearFetchedCoversFailed', { values: { error: String(err) }, default: `Failed: ${err}` });
    } finally {
      isClearingCovers = false;
      setTimeout(() => { clearCoversStatus = ""; }, 5000);
    }
  }

  async function handleResetDatabase() {
    const confirmed = await confirm(
      $_('settings.resetDatabaseConfirm', {
        default: 'Are you sure you want to reset the database? This will clear all tracks, playlists, and metadata, but your music files will remain untouched on your computer.',
      }),
      {
        title: $_('settings.resetDatabase', { default: 'Reset Database' }),
        confirmLabel: $_('common.proceed', { default: 'Proceed with Reset' }),
        danger: true,
      }
    );
    if (!confirmed) return;
    try {
      await resetDatabase();
      location.reload();
    } catch (err) {
      alert(String(err));
    }
  }

  async function handleDeleteAccount() {
    const ok = await confirm(
      $_('settings.deleteAccountConfirm', { default: 'Permanently delete your Audion cloud account and all synced metadata? This cannot be undone.' }),
      {
        title: $_('settings.deleteAccount', { default: 'Delete Cloud Account' }),
        confirmLabel: $_('common.delete', { default: 'Delete Forever' }),
        danger: true,
      }
    );
    if (ok) await deleteAccount();
  }
</script>

<section class="settings-section" aria-labelledby="privacy-heading">
  <div class="section-body">
    <div class="settings-card">
        <!-- 1. Remote Control -->
        <div class="toggle-container" id="setting-remote-control">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.remoteControl', { default: 'Remote Control API' })}</span>
            <span class="setting-description">{$_('settings.remoteControlDesc', { default: 'Allow other devices on your local network to discover and control this player' })}</span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.remoteControlEnabled}
            on:click={() => appSettings.setRemoteControlEnabled(!$appSettings.remoteControlEnabled)}
            role="switch"
            aria-checked={$appSettings.remoteControlEnabled}
            aria-label={$_('settings.toggleRemoteControl', { default: 'Toggle Remote Control' })}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        <div class="divider"></div>

        <!-- 2. Developer Mode -->
        <div class="toggle-container" id="setting-developer-mode">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.developerMode', { default: 'Developer Mode' })}</span>
            <span class="setting-description">{$_('settings.developerModeDesc', { default: 'Enable inspection tools, developer console diagnostics, and debug logs' })}</span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.developerMode}
            on:click={() => appSettings.setDeveloperMode(!$appSettings.developerMode)}
            role="switch"
            aria-checked={$appSettings.developerMode}
            aria-label={$_('settings.toggleDeveloperMode', { default: 'Toggle Developer Mode' })}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>
      </div>

      <!-- 3. Visually Separated Danger Zone -->
      <div class="settings-card danger-zone-card" id="setting-danger-zone" style="margin-top: var(--spacing-md);">
        <div class="danger-zone-header">
          <div class="danger-zone-title-wrap">
            <Icon name="alert-triangle" size={18} className="danger-icon" />
            <h3 class="setting-title" style="color: var(--error-color, #ef4444); font-weight: 700;">
              {$_('settings.dangerZone', { default: 'Danger Zone' })}
            </h3>
          </div>
          <span class="pill-badge danger-badge">{$_('settings.destructive', { default: 'Destructive Actions' })}</span>
        </div>
        <p class="setting-description" style="margin-top: 4px; margin-bottom: 16px;">
          {$_('settings.dangerZoneDesc', { default: 'These actions affect your local database or cloud account. Please proceed with caution.' })}
        </p>

        <div class="danger-action-row">
          <div class="danger-action-info">
            <span class="danger-action-title">{$_('settings.clearFetchedCovers', { default: 'Clear Fetched Covers Cache' })}</span>
            <span class="setting-description">{$_('settings.clearFetchedCoversDesc', { default: 'Remove all online album artwork downloaded from the web. Embedded cover art in files is preserved.' })}</span>
          </div>
          <button class="btn-outline-compact danger-btn" on:click={handleClearFetchedCovers} disabled={isClearingCovers}>
            {isClearingCovers ? $_('common.loading', { default: 'Clearing...' }) : $_('settings.clearCache', { default: 'Clear Cache' })}
          </button>
        </div>
        {#if clearCoversStatus}
          <p class="setting-description" style="margin-top: 4px; color: var(--accent-primary);">{clearCoversStatus}</p>
        {/if}

        <div class="divider" style="border-color: rgba(239, 68, 68, 0.2);"></div>

        <div class="danger-action-row">
          <div class="danger-action-info">
            <span class="danger-action-title">{$_('settings.resetDatabase', { default: 'Reset Local Database' })}</span>
            <span class="setting-description">{$_('settings.resetDatabaseDesc', { default: 'Wipes indexed tracks, albums, playlists, and tags. Your music files on disk are completely safe.' })}</span>
          </div>
          <button class="btn-outline-compact danger-btn" on:click={handleResetDatabase}>
            {$_('settings.resetDatabase', { default: 'Reset Database' })}
          </button>
        </div>

        {#if $isLoggedIn}
          <div class="divider" style="border-color: rgba(239, 68, 68, 0.2);"></div>

          <div class="danger-action-row">
            <div class="danger-action-info">
              <span class="danger-action-title">{$_('settings.deleteAccount', { default: 'Delete Cloud Account' })}</span>
              <span class="setting-description">{$_('settings.deleteAccountDesc', { default: 'Permanently remove your cloud profile and cross-device sync history' })}</span>
            </div>
            <button class="btn-outline-compact danger-btn" on:click={handleDeleteAccount}>
              {$_('settings.deleteAccount', { default: 'Delete Account' })}
            </button>
          </div>
        {/if}
      </div>
    </div>
</section>

<style>
  .danger-zone-card {
    border: 1px solid rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.04);
    border-radius: var(--radius-md, 8px);
  }

  .danger-zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .danger-zone-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(.danger-icon) {
    color: var(--error-color, #ef4444);
    flex-shrink: 0;
  }

  .danger-badge {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error-color, #ef4444);
    border: 1px solid rgba(239, 68, 68, 0.3);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .danger-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 0;
  }

  .danger-action-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .danger-action-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .danger-btn {
    color: var(--error-color, #ef4444) !important;
    border-color: rgba(239, 68, 68, 0.4) !important;
    flex-shrink: 0;
  }

  .danger-btn:hover {
    background: rgba(239, 68, 68, 0.15) !important;
    border-color: var(--error-color, #ef4444) !important;
  }

  @media (max-width: 640px) {
    .danger-action-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  }
</style>
