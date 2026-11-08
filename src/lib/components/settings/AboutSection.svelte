<script lang="ts">
  import { _ } from "svelte-i18n";
  import { supportsOta, otaState, otaEnabled, setOtaEnabled, startOtaDownload, installOtaNow, deferOtaInstallToClose, skipOtaVersion, type PendingUpdateNotes } from "$lib/stores/otaUpdate";
  import { updates } from "$lib/stores/updates";
  import UpdatePopup from "../UpdatePopup.svelte";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { exportLogFile } from "$lib/api/tauri";

  export let open: boolean = true;
  const dispatch = createEventDispatcher();

  let showUpdatePopup = false;
  let updatePopupMode: "github" | "ota" = "github";
  let updatePopupRelease: any = null;

  let exportingLogs = false;
  let logExportMessage = "";
  let logExportSuccess = false;

  async function handleExportLogs() {
    if (exportingLogs) return;
    exportingLogs = true;
    logExportMessage = "";

    try {
      const saved = await exportLogFile();
      if (saved) {
        logExportSuccess = true;
        logExportMessage = $_('settings.exportLogsSuccess', { default: 'Logs exported successfully' });
      }
    } catch (error) {
      logExportSuccess = false;
      logExportMessage = $_('settings.exportLogsFailed', { values: { error: String(error) }, default: `Failed to export logs: ${error}` });
      console.error("Failed to export log file:", error);
    } finally {
      exportingLogs = false;
      setTimeout(() => { logExportMessage = ""; }, 5000);
    }
  }

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
</script>

<section class="settings-section" aria-labelledby="about-heading">
  <div class="section-body">
    <!-- About App Card -->
    <div class="settings-card" id="setting-about-app">
        <div class="about-row">
          <div class="app-logo-sm">Audion</div>
          <div class="about-details">
            <span class="setting-title" style="font-size: 1.1rem; font-weight: 700;">Audion {__APP_VERSION__}</span>
            <span class="setting-description">{$_('settings.modernPlayerDesc', { default: 'Modern, high-performance music player with native audio engine, synced karaoke lyrics, and cloud synchronization.' })}</span>
          </div>
        </div>

        {#if supportsOta()}
          <div class="divider"></div>
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.otaEnabled', { default: 'Automatic background updates' })}</span>
              <span class="setting-description">{$_('settings.otaEnabledDesc', { default: 'Download and install updates seamlessly over the air' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$otaEnabled}
              on:click={() => setOtaEnabled(!$otaEnabled)}
              role="switch"
              aria-checked={$otaEnabled}
              aria-label={$_('settings.otaEnabled', { default: 'Automatic updates' })}
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        {/if}

        {#if $otaState.phase === "ready"}
          <div class="restart-notice" style="margin-top: 12px;">
            <div class="restart-notice-text">
              <span class="setting-title" style="color: var(--accent-primary)">{$_('settings.restartRequired', { default: 'Update Ready' })}</span>
              <span class="setting-description">{$_('settings.restartRequiredDesc', { values: { version: $otaState.notes?.version ?? '' }, default: `Audion ${$otaState.notes?.version ?? ''} has been downloaded and is ready to install.` })}</span>
            </div>
            <button
              class="btn-restart-compact"
              on:click={() => {
                updatePopupRelease = otaNotesToRelease($otaState.notes);
                updatePopupMode = "ota";
                showUpdatePopup = true;
              }}
            >{$_('settings.restartToUpdate', { default: 'Restart to Update' })}</button>
          </div>
        {:else if $otaState.phase === "downloading"}
          <div class="restart-notice" style="margin-top: 12px;">
            <div class="restart-notice-text">
              <span class="setting-title">{$_('updatePopup.downloading', { default: 'Downloading update...' })}</span>
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
          >{$_('settings.updateAvailable', { default: 'Update available' })}</button>
        {:else if $updates.hasUpdate}
          <button
            class="btn-green-compact"
            on:click={() => {
              updatePopupRelease = $updates.latestRelease;
              updatePopupMode = "github";
              showUpdatePopup = true;
            }}
            style="margin-top: var(--spacing-sm)"
          >{$_('settings.updateAvailable', { default: 'Update available' })}</button>
        {/if}

        <div class="divider"></div>

        <div class="toggle-container" id="setting-export-logs">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.exportLogs', { default: 'Diagnostic logs' })}</span>
            <span class="setting-description">{$_('settings.exportLogsDesc', { default: 'Save application log files for debugging and issue reporting' })}</span>
          </div>
          <button class="btn-outline-compact" on:click={handleExportLogs} disabled={exportingLogs}>
            <Icon name="download" size={13} />
            <span>{exportingLogs ? $_('settings.exportLogsInProgress', { default: 'Exporting...' }) : $_('settings.exportLogsAction', { default: 'Export Logs' })}</span>
          </button>
        </div>
        {#if logExportMessage}
          <span class="setting-description" style="color: {logExportSuccess ? 'var(--accent-primary)' : 'var(--error-color)'}; margin-top: 6px; display: block;">
            {logExportMessage}
          </span>
        {/if}
      </div>

      <!-- Single Consolidated Support & Community Section -->
      <div class="settings-card support-card-premium" id="setting-support-audion" style="margin-top: var(--spacing-md);">
        <div class="premium-card-badge">{$_('settings.support', { default: 'Support' })}</div>
        <div class="support-content">
          <div class="support-text">
            <h3 class="support-title">{$_('settings.supportAudion', { default: 'Support Audion Development' })}</h3>
            <p class="support-description">
              {$_('settings.supportDesc', { default: 'Audion is built with care as open software. Your support helps cover server infrastructure, lyrics APIs, and active development.' })}
            </p>
          </div>
          <div class="support-icon-large">
            <Icon name="heart" size={32} />
          </div>
        </div>

        <div class="support-grid">
          <a
            href="https://ko-fi.com/N4N5UMNR1"
            target="_blank"
            rel="noreferrer"
            class="support-platform-card kofi"
          >
            <span class="platform-name">Ko-fi</span>
            <span class="platform-tag">{$_('settings.kofiTag', { default: 'One-time & Membership' })}</span>
          </a>
          <a
            href="https://www.patreon.com/AudionPlayer"
            target="_blank"
            rel="noreferrer"
            class="support-platform-card patreon"
          >
            <span class="platform-name">Patreon</span>
            <span class="platform-tag">{$_('settings.patreonTag', { default: 'Supporter Benefits' })}</span>
          </a>
        </div>

        <div class="divider"></div>

        <span class="setting-title" style="font-size: 0.875rem;">{$_('settings.playerBarButtons', { default: 'Player Bar Buttons' })}</span>
        <span class="setting-description">{$_('settings.playerBarButtonsDesc', { default: 'Toggle quick access community and support buttons shown in the player bar' })}</span>

        <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
          <div class="toggle-container compact-toggle">
            <div class="toggle-info">
              <span class="setting-title" style="font-size: 0.8125rem;">{$_('settings.kofiButton', { default: 'Ko-fi button' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showKofi}
              on:click={() => appSettings.setShowKofi(!$appSettings.showKofi)}
              role="switch"
              aria-checked={$appSettings.showKofi}
              aria-label={$_('settings.toggleKofiButton', { default: 'Toggle Ko-fi Button' })}
            >
              <div class="toggle-handle"></div>
            </button>
          </div>

          <div class="toggle-container compact-toggle">
            <div class="toggle-info">
              <span class="setting-title" style="font-size: 0.8125rem;">{$_('settings.patreonButton', { default: 'Patreon button' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showPatreon}
              on:click={() => appSettings.setShowPatreon(!$appSettings.showPatreon)}
              role="switch"
              aria-checked={$appSettings.showPatreon}
              aria-label={$_('settings.togglePatreonButton', { default: 'Toggle Patreon Button' })}
            >
              <div class="toggle-handle"></div>
            </button>
          </div>

          <div class="toggle-container compact-toggle">
            <div class="toggle-info">
              <span class="setting-title" style="font-size: 0.8125rem;">{$_('settings.discordButton', { default: 'Discord button' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showDiscord}
              on:click={() => appSettings.setShowDiscord(!$appSettings.showDiscord)}
              role="switch"
              aria-checked={$appSettings.showDiscord}
              aria-label={$_('settings.toggleDiscordButton', { default: 'Toggle Discord Button' })}
            >
              <div class="toggle-handle"></div>
            </button>
          </div>

          <div class="toggle-container compact-toggle">
            <div class="toggle-info">
              <span class="setting-title" style="font-size: 0.8125rem;">{$_('settings.resonateButton', { default: 'Resonate button' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showResonate}
              on:click={() => appSettings.setShowResonate(!$appSettings.showResonate)}
              role="switch"
              aria-checked={$appSettings.showResonate}
              aria-label={$_('settings.toggleResonateButton', { default: 'Toggle Resonate Button' })}
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <span class="setting-title" style="font-size: 0.875rem;">{$_('settings.communityLinks', { default: 'Community & Resources' })}</span>
        <div class="button-group-row" style="margin-top: 8px; gap: 8px; flex-wrap: wrap;">
          <a href="https://discord.gg/27XRVQsBd9" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1 1 calc(50% - 8px); text-align: center; justify-content: center;">
            <Icon name="message-circle" size={13} />
            <span>{$_('settings.openDiscord', { default: 'Discord Server' })}</span>
          </a>
          <a href="https://resonate.audionplayer.com?ref=audion" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1 1 calc(50% - 8px); text-align: center; justify-content: center;">
            <Icon name="radio" size={13} />
            <span>{$_('settings.openResonate', { default: 'Resonate Playlists' })}</span>
          </a>
          <a href="https://github.com/dupitydumb/Audion" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1 1 calc(50% - 8px); text-align: center; justify-content: center;">
            <Icon name="github" size={13} />
            <span>{$_('settings.openGithub', { default: 'GitHub & Issues' })}</span>
          </a>
          <a href="https://github.com/dupitydumb/audion-server-docker" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1 1 calc(50% - 8px); text-align: center; justify-content: center;">
            <Icon name="server" size={13} />
            <span>{$_('settings.dockerSetupGuide', { default: 'Docker Server' })}</span>
          </a>
        </div>
      </div>
    </div>
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
