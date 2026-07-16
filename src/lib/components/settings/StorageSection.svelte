<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { isAndroid, pickFolder, addFolder, rescanMusic, syncCoverPathsFromFiles, mergeDuplicateCovers, type MergeCoverResult } from "$lib/api/tauri";
  import { loadLibrary } from "$lib/stores/library";
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  interface MigrationProgressUpdate {
    current: number;
    total: number;
    current_batch: number;
    batch_size: number;
    estimated_time_remaining_ms: number;
    tracks_migrated: number;
    albums_migrated: number;
  }

  interface MergeProgressUpdate {
    current_album: number;
    total_albums: number;
    covers_merged: number;
    space_saved_bytes: number;
    estimated_time_remaining_ms: number;
  }

  async function handleSetDownloadLocation() {
    try {
      const path = await pickFolder();
      if (path) appSettings.setDownloadLocation(path);
    } catch (error) {
      console.error("Failed to select download location:", error);
    }
  }

  let isUpdatingAndroidMusicFolder = false;
  let androidMusicFolderMessage = "";
  let androidMusicFolderSuccess = false;

  async function handleSetAndroidMusicFolder() {
    try {
      androidMusicFolderMessage = "";
      androidMusicFolderSuccess = false;
      const path = await pickFolder();
      if (!path) return;
      if (path.startsWith("content://")) {
        androidMusicFolderSuccess = false;
        androidMusicFolderMessage = "Folder URI is not supported yet. Please pick a local Music folder path.";
        return;
      }
      isUpdatingAndroidMusicFolder = true;
      await addFolder(path);
      appSettings.setAndroidMusicFolder(path);
      const result = await rescanMusic();
      await loadLibrary();
      const parts = [];
      if (result.tracks_added > 0) parts.push(`${result.tracks_added} added`);
      if (result.tracks_updated > 0) parts.push(`${result.tracks_updated} updated`);
      if (result.tracks_deleted > 0) parts.push(`${result.tracks_deleted} deleted`);
      androidMusicFolderSuccess = true;
      androidMusicFolderMessage = parts.length > 0 ? `Music folder added: ${parts.join(", ")}` : "Music folder added. No library changes detected.";
    } catch (error) {
      androidMusicFolderSuccess = false;
      androidMusicFolderMessage = `Failed to add music folder: ${error}`;
      console.error("Failed to add Android music folder:", error);
    } finally {
      isUpdatingAndroidMusicFolder = false;
      setTimeout(() => { androidMusicFolderMessage = ""; }, 5000);
    }
  }

  let isSyncingCovers = false;
  let syncMessage = "";
  let syncSuccess = false;
  let syncProgress: MigrationProgressUpdate | null = null;
  let syncPercentage = 0;

  let isMergingCovers = false;
  let mergeMessage = "";
  let mergeSuccess = false;
  let mergeProgress: MergeProgressUpdate | null = null;
  let mergePercentage = 0;

  let unlistenSync: UnlistenFn | null = null;
  let unlistenMerge: UnlistenFn | null = null;

  onMount(async () => {
    unlistenSync = await listen("migration-batch-ready", (event) => {
      const data = event.payload as { progress: MigrationProgressUpdate };
      syncProgress = data.progress;
      if (syncProgress && syncProgress.total > 0) {
        syncPercentage = Math.round((syncProgress.current / syncProgress.total) * 100);
      }
    });
    unlistenMerge = await listen("merge-batch-ready", (event) => {
      const data = event.payload as { progress: MergeProgressUpdate };
      mergeProgress = data.progress;
      if (mergeProgress && mergeProgress.total_albums > 0) {
        mergePercentage = Math.round((mergeProgress.current_album / mergeProgress.total_albums) * 100);
      }
    });
  });

  onDestroy(() => {
    if (unlistenSync) unlistenSync();
    if (unlistenMerge) unlistenMerge();
  });

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function formatTime(ms: number): string {
    if (!ms || ms === 0) return "0s";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  async function handleSyncCovers() {
    isSyncingCovers = true;
    syncMessage = "";
    syncSuccess = false;
    syncProgress = null;
    syncPercentage = 0;
    try {
      console.log("[Settings] Starting cover sync...");
      const result = await syncCoverPathsFromFiles();
      console.log("[Settings] Sync result:", result);
      syncProgress = null;
      syncPercentage = 0;
      if (result.tracks_migrated === 0 && result.albums_migrated === 0 && result.errors.length === 0) {
        syncSuccess = true;
        syncMessage = `✓ No cover files found to sync.`;
      } else if (result.errors.length === 0) {
        syncSuccess = true;
        syncMessage = `✓ Successfully synced ${result.tracks_migrated} track covers and ${result.albums_migrated} album covers`;
        console.log("[Settings] Reloading library...");
        await loadLibrary();
        console.log("[Settings] Library reloaded");
      } else {
        syncSuccess = false;
        syncMessage = `Synced ${result.tracks_migrated} tracks, ${result.albums_migrated} albums with ${result.errors.length} errors. Check console.`;
        console.error("[Settings] Sync errors:", result.errors);
      }
    } catch (error) {
      syncSuccess = false;
      syncMessage = `Failed to sync covers: ${error}`;
      console.error("[Settings] Sync failed:", error);
      syncProgress = null;
      syncPercentage = 0;
    } finally {
      isSyncingCovers = false;
      setTimeout(() => { syncMessage = ""; }, 5000);
    }
  }

  async function handleMergeDuplicateCovers() {
    isMergingCovers = true;
    mergeMessage = "";
    mergeSuccess = false;
    mergeProgress = null;
    mergePercentage = 0;
    try {
      console.log("[Settings] Starting cover merge...");
      const result = await mergeDuplicateCovers();
      console.log("[Settings] Merge result:", result);
      mergeProgress = null;
      mergePercentage = 0;
      if (result.covers_merged === 0 && result.errors.length === 0) {
        mergeSuccess = true;
        mergeMessage = `✓ No duplicate covers found. All album covers are unique.`;
      } else if (result.errors.length === 0) {
        mergeSuccess = true;
        const spaceSavedMB = (result.space_saved_bytes / (1024 * 1024)).toFixed(2);
        mergeMessage = `✓ Successfully merged ${result.covers_merged} duplicate covers across ${result.albums_processed} albums. Saved ${spaceSavedMB} MB of disk space.`;
        console.log("[Settings] Reloading library...");
        await loadLibrary();
        console.log("[Settings] Library reloaded");
      } else {
        mergeSuccess = false;
        const spaceSavedMB = (result.space_saved_bytes / (1024 * 1024)).toFixed(2);
        mergeMessage = `⚠ Merged ${result.covers_merged} covers (saved ${spaceSavedMB} MB) with ${result.errors.length} errors. Check console.`;
        console.error("[Settings] Merge errors:", result.errors);
      }
    } catch (error) {
      mergeSuccess = false;
      mergeMessage = `✗ Failed to merge covers: ${error}`;
      console.error("[Settings] Merge failed:", error);
      mergeProgress = null;
      mergePercentage = 0;
    } finally {
      isMergingCovers = false;
      setTimeout(() => { mergeMessage = ""; }, 8000);
    }
  }
</script>

<section class="settings-section" aria-labelledby="storage-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.storage')}</span>
      <span class="accordion-subtitle">{$_('settings.storageSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <div class="inner-section">
          <span class="setting-title">{$_('settings.downloadLocation')}</span>
          <div class="path-selector">
            <div class="setting-description path-display" style="margin-top: 0;" title={$appSettings.downloadLocation || $_('settings.noDownloadLocation')}>
              {$appSettings.downloadLocation || $_('settings.noDownloadLocation')}
            </div>
            <button class="selector-btn" on:click={handleSetDownloadLocation} aria-label={$_('settings.change')}>{$_('settings.change')}</button>
          </div>
        </div>

        {#if isAndroid()}
          <div class="divider"></div>
          <div class="inner-section">
            <span class="setting-title">{$_('settings.musicLibraryFolder')}</span>
            <span class="setting-description">{$_('settings.musicLibraryFolderDesc')}</span>
            <div class="path-selector">
              <div class="setting-description path-display" style="margin-top: 0;" title={$appSettings.androidMusicFolder || $_('settings.noMusicFolder')}>
                {$appSettings.androidMusicFolder || $_('settings.noMusicFolder')}
              </div>
              <button
                class="selector-btn"
                on:click={handleSetAndroidMusicFolder}
                aria-label={$_('settings.addFolder')}
                disabled={isUpdatingAndroidMusicFolder}
              >{isUpdatingAndroidMusicFolder ? $_('settings.adding') : $_('settings.addFolder')}</button>
            </div>
            {#if androidMusicFolderMessage}
              <div class="sync-message {androidMusicFolderSuccess ? 'success' : 'error'}">{androidMusicFolderMessage}</div>
            {/if}
          </div>
        {/if}

        <div class="divider"></div>

        <div class="card-title-group compact">
          <h3 class="setting-title">{$_('settings.coverManagement')}</h3>
          <span class="setting-description">{$_('settings.coverManagementDesc')}</span>
        </div>

        <div class="button-group-row">
          <button class="btn-outline-compact" on:click={handleSyncCovers} disabled={isSyncingCovers}>
            {isSyncingCovers ? $_('settings.syncing') : $_('settings.syncCovers')}
          </button>
          <button class="btn-outline-compact" on:click={handleMergeDuplicateCovers} disabled={isMergingCovers}>
            {isMergingCovers ? $_('settings.merging') : $_('settings.mergeDuplicates')}
          </button>
        </div>

        {#if isSyncingCovers || isMergingCovers}
          <div class="divider"></div>
          <div class="progress-notice-inline">
            <span class="setting-description animate-pulse">{$_('settings.processingCovers')}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
