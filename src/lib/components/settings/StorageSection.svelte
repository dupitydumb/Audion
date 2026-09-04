<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import {
    pickFolder,
    addFolder,
    rescanMusic,
    syncCoverPathsFromFiles,
    mergeDuplicateCovers,
    scanFolder,
    removeFolder,
    getMusicFolders,
    type MergeCoverResult,
  } from "$lib/api/tauri";
  import { loadLibrary } from "$lib/stores/library";
  import { progressiveScan } from "$lib/stores/progressiveScan";
  import { confirm } from "$lib/stores/dialogs";
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

  // ---------------------------------------------------------------------
  // desktop/android multi folder library state
  // ---------------------------------------------------------------------
  let musicFolders: string[] = [];
  let isLoadingFolders = false;
  let isAddingFolder = false;
  let isRescanningAll = false;
  let folderListMessage = "";
  let folderListSuccess = false;
  // per folder busy state, keyed by folder path, so each row can show its
  // own Rescanning.../Removing... state independently of the others
  let busyFolders: Record<string, "rescanning" | "removing"> = {};

  // true while any of the 4 folder actions (add, rescan-one, remove-one, rescan-all) is in flight
  // running two of these concurrently isn't safe
  $: anyFolderActionBusy =
    isAddingFolder || isRescanningAll || Object.keys(busyFolders).length > 0;

  async function refreshMusicFolders() {
    isLoadingFolders = true;
    try {
      musicFolders = await getMusicFolders();
    } catch (error) {
      console.error("Failed to load music folders:", error);
    } finally {
      isLoadingFolders = false;
    }
  }

  function formatScanResultMessage(
    result: { tracks_added: number; tracks_updated: number; tracks_deleted: number },
    addedMessage: string,
    noChangeMessage: string,
  ): string {
    const parts: string[] = [];
    if (result.tracks_added > 0) parts.push(`${result.tracks_added} added`);
    if (result.tracks_updated > 0) parts.push(`${result.tracks_updated} updated`);
    if (result.tracks_deleted > 0) parts.push(`${result.tracks_deleted} removed`);
    return parts.length > 0 ? `${addedMessage}: ${parts.join(", ")}` : noChangeMessage;
  }

  async function handleAddMusicFolder() {
    if (anyFolderActionBusy) return;
    folderListMessage = "";
    try {
      const path = await pickFolder();
      if (!path) return;

      if (path.startsWith("content://")) {
        folderListSuccess = false;
        folderListMessage =
          "Folder URI is not supported yet. Please pick a local Music folder path.";
        return;
      }

      isAddingFolder = true;

      await addFolder(path);
      // attach progress listeners before invoking the scan
      // don't clear the existing library data since only a single folder is scanned
      await progressiveScan.startScan(false);
      // only scan the newly added folder, not the whole library
      const result = await scanFolder(path);
      await refreshMusicFolders();
      await loadLibrary();

      folderListSuccess = true;
      folderListMessage = formatScanResultMessage(
        result,
        "Folder added",
        "Folder added. No tracks found.",
      );
    } catch (error) {
      folderListSuccess = false;
      folderListMessage = `Failed to add folder: ${error}`;
      console.error("Failed to add music folder:", error);
    } finally {
      isAddingFolder = false;
      setTimeout(() => {
        folderListMessage = "";
      }, 5000);
    }
  }

  async function handleRescanFolder(path: string) {
    if (anyFolderActionBusy) return;
    folderListMessage = "";
    busyFolders = { ...busyFolders, [path]: "rescanning" };

    try {
      // attach listeners first, don't clear the library
      await progressiveScan.startScan(false);
      const result = await scanFolder(path);
      await loadLibrary();

      folderListSuccess = true;
      folderListMessage = formatScanResultMessage(
        result,
        "Folder rescanned",
        "Folder rescanned. No changes detected.",
      );
    } catch (error) {
      folderListSuccess = false;
      folderListMessage = `Failed to rescan folder: ${error}`;
      console.error("Failed to rescan folder:", path, error);
    } finally {
      const { [path]: _removed, ...rest } = busyFolders;
      busyFolders = rest;
      setTimeout(() => {
        folderListMessage = "";
      }, 5000);
    }
  }

  async function handleRemoveMusicFolder(path: string) {
    if (anyFolderActionBusy) return;

    const ok = await confirm(
      `Remove "${path}" from your library? Tracks from this folder will be deleted from the database (the files on disk are not affected).`,
      { title: "Remove Folder", danger: true },
    );
    if (!ok) return;

    folderListMessage = "";
    busyFolders = { ...busyFolders, [path]: "removing" };

    try {
      const tracksRemoved = await removeFolder(path);
      await refreshMusicFolders();
      await loadLibrary();

      folderListSuccess = true;
      folderListMessage =
        tracksRemoved > 0
          ? `Folder removed, ${tracksRemoved} track(s) deleted from library.`
          : "Folder removed.";
    } catch (error) {
      folderListSuccess = false;
      folderListMessage = `Failed to remove folder: ${error}`;
      console.error("Failed to remove folder:", path, error);
    } finally {
      const { [path]: _removed, ...rest } = busyFolders;
      busyFolders = rest;
      setTimeout(() => {
        folderListMessage = "";
      }, 5000);
    }
  }

  async function handleRescanAllFolders() {
    if (anyFolderActionBusy) return;
    isRescanningAll = true;
    folderListMessage = "";

    try {
      // full rescan: clear existing library data so the progress banner shows a clean repopulation
      await progressiveScan.startScan(true);
      const result = await rescanMusic();
      await loadLibrary();

      folderListSuccess = true;
      folderListMessage = formatScanResultMessage(
        result,
        "Rescanned all folders",
        "Rescanned all folders. No changes detected.",
      );
    } catch (error) {
      folderListSuccess = false;
      folderListMessage = `Failed to rescan folders: ${error}`;
      console.error("Failed to rescan all folders:", error);
      // startScan(true) already cleared the library store for the "clean
      // repopulation" banner; reload from the db so the ui doesn't get
      // stuck showing an empty library after a failed rescan
      try {
        await loadLibrary();
      } catch (reloadError) {
        console.error("Failed to reload library after rescan failure:", reloadError);
      }
    } finally {
      isRescanningAll = false;
      setTimeout(() => {
        folderListMessage = "";
      }, 5000);
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
    // load registered music folders
    refreshMusicFolders();

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

        <div class="divider"></div>

        <div class="inner-section">
          <div class="folder-section-header">
            <span class="setting-title">{$_('settings.musicFolders', { default: 'Music folders' })}</span>
            <button
              class="btn-folder-action primary"
              on:click={handleAddMusicFolder}
              disabled={anyFolderActionBusy}
              aria-label={$_('settings.addFolder', { default: 'Add folder' })}
            >
              {isAddingFolder ? $_('settings.adding', { default: 'Adding...' }) : $_('settings.addFolder', { default: 'Add folder' })}
            </button>
          </div>
          <span class="setting-description">{$_('settings.musicFoldersDesc', { default: 'Folders included when scanning your library' })}</span>
          <span class="setting-description" style="margin-top: 4px;">{$_('settings.multiArtistTaggingHint', { default: 'Tracks with multiple artists (e.g. "Artist A & Artist B") are split automatically. In places with limited space, only the first-listed artist is shown - tag your files with the primary artist first for the best results.' })}</span>

          {#if isLoadingFolders}
            <span class="setting-description" style="margin-top: 8px;">{$_('settings.loading', { default: 'Loading...' })}</span>
          {:else if musicFolders.length === 0}
            <span class="setting-description" style="margin-top: 8px;">{$_('settings.noMusicFolders', { default: 'No folders added yet' })}</span>
          {:else}
            <ul class="folder-list">
              {#each musicFolders as path (path)}
                <li class="folder-item">
                  <span class="folder-item-path" title={path}>{path}</span>
                  <div class="folder-item-actions">
                    <button
                      class="btn-folder-action"
                      on:click={() => handleRescanFolder(path)}
                      disabled={anyFolderActionBusy}
                    >
                      {busyFolders[path] === 'rescanning' ? $_('settings.rescanning', { default: 'Rescanning...' }) : $_('settings.rescan', { default: 'Rescan' })}
                    </button>
                    <button
                      class="btn-folder-action danger"
                      on:click={() => handleRemoveMusicFolder(path)}
                      disabled={anyFolderActionBusy}
                    >
                      {busyFolders[path] === 'removing' ? $_('settings.removing', { default: 'Removing...' }) : $_('settings.remove', { default: 'Remove' })}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
            <div class="button-group-row" style="margin-top: 8px;">
              <button class="btn-outline-compact" on:click={handleRescanAllFolders} disabled={anyFolderActionBusy}>
                {isRescanningAll ? $_('settings.rescanning', { default: 'Rescanning...' }) : $_('settings.rescanAll', { default: 'Rescan all' })}
              </button>
            </div>
          {/if}

          {#if folderListMessage}
            <div class="sync-message {folderListSuccess ? 'success' : 'error'}">{folderListMessage}</div>
          {/if}
        </div>

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
