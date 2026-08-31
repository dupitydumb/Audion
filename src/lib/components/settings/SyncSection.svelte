<script lang="ts">
  import { _ } from "svelte-i18n";
  import { syncStatus, isSyncing, triggerSync } from "$lib/stores/sync";
  import { trackCount, playlists } from "$lib/stores/library";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  $: libraryProgress = Math.min(($trackCount / 100) * 100, 100);
  $: playlistProgress = Math.min(($playlists.length / 3) * 100, 100);

  function formatTime(ms: number): string {
    if (!ms || ms === 0) return "0s";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function formatLastSynced(isoString: string | null): string {
    if (!isoString) return $_('syncSection.notSyncedYet');
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      if (diffSec < 60) return $_('syncStatus.justNow');
      if (diffMin < 60) return $_('syncStatus.minutesAgo', { values: { minutes: diffMin } });
      if (diffHour < 24) return $_('syncStatus.hoursAgo', { values: { hours: diffHour } });
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      console.error("Failed to format last sync date:", e);
      return isoString;
    }
  }

  const formatLastSyncedRelative = formatLastSynced;

  function formatSyncError(error: string | null): string {
    if (!error) return "";
    try {
      if (error.includes("{") && error.includes("}")) {
        const jsonStart = error.indexOf("{");
        const jsonEnd = error.lastIndexOf("}") + 1;
        const jsonStr = error.substring(jsonStart, jsonEnd);
        const parsed = JSON.parse(jsonStr);
        if (parsed.details) return parsed.details;
        if (parsed.error) return parsed.error;
      }
    } catch (e) {
      console.warn("Failed to parse sync error JSON:", e);
    }
    return error.replace(/Request failed: \d+ [^—]+ — /, "");
  }
</script>

<section class="settings-section" aria-labelledby="sync-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.sync')}</span>
      <span class="accordion-subtitle">{$_('settings.syncSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
    <div class="card-header-row">
      <div class="card-title-group">
        <h3 class="setting-title">{$_('settings.libraryStatus')}</h3>
        <span class="setting-description" aria-live="polite">
          {#if $isSyncing}
            <span class="animate-pulse">{$_('settings.syncingTracks')}</span>
          {:else}
            {$_('settings.synced')} {formatLastSyncedRelative($syncStatus.last_sync_at)}
            {#if $syncStatus.pending_changes > 0}
              · {$syncStatus.pending_changes} {$_('settings.pending')}
            {/if}
          {/if}
        </span>
      </div>
      <div class="pill-badge">{$_('settings.autoEvery12h')}</div>
    </div>

    <button
      class="btn-outline-compact btn-full-width"
      style="margin-top: var(--spacing-md);"
      on:click={() => triggerSync()}
      disabled={$isSyncing}
      aria-label={$_('settings.syncNow')}
    >{$isSyncing ? $_('settings.syncing') : $_('settings.syncNow')}</button>

    <div class="divider"></div>
    <div class="tier-limits" role="group" aria-label="Usage Limits">
      <div class="tier-limit-item">
        <div class="limit-header">
          <span id="limit-label-music" class="setting-title" style="font-size: 11px; opacity: 0.8">{$_('common.tracks')}</span>
          <span class="setting-title" style="font-size: 11px; opacity: 0.8">{$trackCount} / 100</span>
        </div>
        <div class="limit-bar-thick-wrap" role="progressbar" aria-valuenow={$trackCount} aria-valuemin="0" aria-valuemax="100" aria-labelledby="limit-label-music">
          <div class="limit-bar-thick" style="width: {libraryProgress}%"></div>
        </div>
      </div>

      <div class="tier-limit-item">
        <div class="limit-header">
          <span id="limit-label-playlists" class="setting-title" style="font-size: 11px; opacity: 0.8">{$_('sidebar.playlists')}</span>
          <span class="setting-title" style="font-size: 11px; opacity: 0.8">{$playlists.length} / 3</span>
        </div>
        <div class="limit-bar-thick-wrap" role="progressbar" aria-valuenow={$playlists.length} aria-valuemin="0" aria-valuemax="3" aria-labelledby="limit-label-playlists">
          <div class="limit-bar-thick" style="width: {playlistProgress}%"></div>
        </div>
      </div>
    </div>

    {#if $syncStatus.last_error}
      <div class="sync-error-banner">
        <div class="error-content">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div class="error-text">
            <span class="error-message">
              {#if $syncStatus.last_error.includes("Limit Exceeded") || $syncStatus.last_error.includes("limit exceeded")}
                {$_('settings.limitExceeded')}
              {:else}
                {formatSyncError($syncStatus.last_error)}
              {/if}
            </span>
            {#if $syncStatus.last_error.includes("Limit Exceeded") || $syncStatus.last_error.includes("limit exceeded")}
              <p class="error-hint">
                {$_('settings.limitExceededDesc')}
                <br />
                <a href="https://ko-fi.com/N4N5UMNR1" target="_blank" rel="noreferrer" class="donate-link">
                  {$_('settings.supportAudion')}
                </a>
              </p>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
  </div>
  {/if}
</section>
