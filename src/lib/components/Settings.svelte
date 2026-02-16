<script lang="ts">
  import { theme, presetAccents, type ThemeMode } from "$lib/stores/theme";
  import { appSettings } from "$lib/stores/settings";
  import { equalizer, EQ_PRESETS } from "$lib/stores/equalizer";
  import { updates } from "$lib/stores/updates";
  import {
    resetDatabase,
    selectMusicFolder,
    syncCoverPathsFromFiles,
    mergeDuplicateCovers,
    type MergeCoverResult,
    rescanMusic
  } from "$lib/api/tauri";
  import { loadLibrary, loadAlbumsAndArtists, loadPlaylists } from "$lib/stores/library";
  import UpdatePopup from "./UpdatePopup.svelte";
  import { confirm } from "$lib/stores/dialogs";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import { progressiveScan } from "$lib/stores/progressiveScan";
  import { addToast } from "$lib/stores/toast";


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

  let customColorInput = "#1DB954";
  let showUpdatePopup = false;

  // Database reset state
  let showResetModal = false;
  let resetConfirmText = "";
  let isResetting = false;
  let resetError = "";

  // Cover sync state
  let isSyncingCovers = false;
  let syncMessage = "";
  let syncSuccess = false;
  let syncProgress: MigrationProgressUpdate | null = null;
  let syncPercentage = 0;

  // Cover merge state
  let isMergingCovers = false;
  let mergeMessage = "";
  let mergeSuccess = false;
  let mergeProgress: MergeProgressUpdate | null = null;
  let mergePercentage = 0;

  // album match mode
  let pendingAlbumMatchingMode: string | null = null;
  let isRescanning = false;
  let rescanMessage = "";
  let rescanSuccess = false;

  // Event listeners
  let unlistenSync: UnlistenFn | null = null;
  let unlistenMerge: UnlistenFn | null = null;

  onMount(async () => {
    // Listen for migration events (used by sync)
    unlistenSync = await listen("migration-batch-ready", (event) => {
      const data = event.payload as { progress: MigrationProgressUpdate };
      syncProgress = data.progress;
      if (syncProgress && syncProgress.total > 0) {
        syncPercentage = Math.round(
          (syncProgress.current / syncProgress.total) * 100,
        );
      }
    });

    // Listen for merge events
    unlistenMerge = await listen("merge-batch-ready", (event) => {
      const data = event.payload as { progress: MergeProgressUpdate };
      mergeProgress = data.progress;
      if (mergeProgress && mergeProgress.total_albums > 0) {
        mergePercentage = Math.round(
          (mergeProgress.current_album / mergeProgress.total_albums) * 100,
        );
      }
    });
  });

  onDestroy(() => {
    if (unlistenSync) unlistenSync();
    if (unlistenMerge) unlistenMerge();
  });

  function handleModeChange(mode: ThemeMode) {
    theme.setMode(mode);
  }

  function handleAccentChange(color: string) {
    theme.setAccentColor(color);
  }

  function handleCustomColorAdd() {
    if (customColorInput && /^#[0-9A-Fa-f]{6}$/.test(customColorInput)) {
      theme.addCustomColor(customColorInput);
      theme.setAccentColor(customColorInput);
    }
  }

  function handleAlbumModeChange(mode: string) {
    // Only mark as pending if it's different from current saved setting
    if (mode !== $appSettings.albumMatchingMode) {
      pendingAlbumMatchingMode = mode;
    } else {
      pendingAlbumMatchingMode = null;
    }
  }

  async function handleApplyAndRescan() {
    if (!pendingAlbumMatchingMode) return;

    isRescanning = true;
    rescanMessage = "";

    try {
        // Save the setting first
        await appSettings.setAlbumMatchingMode(pendingAlbumMatchingMode as any);

        await progressiveScan.startScan(true);

        const result = await rescanMusic();

        // Reload
        await loadAlbumsAndArtists();
        await loadPlaylists();

        rescanSuccess = true;
        rescanMessage = "✓ Rescan complete. Library re-grouped.";
        pendingAlbumMatchingMode = null;

        const parts = [];
        if (result.tracks_added > 0) parts.push(`${result.tracks_added} added`);
        if (result.tracks_updated > 0) parts.push(`${result.tracks_updated} updated`);
        if (result.tracks_deleted > 0) parts.push(`${result.tracks_deleted} deleted`);

        addToast(parts.length > 0 ? `Rescan complete: ${parts.join(", ")}` : "Rescan complete", "success", 4000);

        setTimeout(() => { rescanMessage = ""; }, 5000);
    } catch (error) {
        rescanSuccess = false;
        rescanMessage = `✗ Failed: ${error}`;
        addToast("Failed to rescan library", "error");
    } finally {
        isRescanning = false;
        progressiveScan.reset();
    }
}

  async function openResetModal() {
    const confirmed = await confirm(
      "Are you sure you want to reset the database? This will clear all tracks and metadata, but your music files will remain on your computer.",
      {
        title: "Reset Database",
        confirmLabel: "Proceed",
        danger: true,
      },
    );

    if (!confirmed) return;

    showResetModal = true;
    resetConfirmText = "";
    resetError = "";
  }

  function closeResetModal() {
    showResetModal = false;
    resetConfirmText = "";
    resetError = "";
    isResetting = false;
  }

  async function handleResetDatabase() {
    if (resetConfirmText !== "DELETE CONFIRM") {
      resetError = "Please type 'DELETE CONFIRM' exactly to proceed";
      return;
    }

    isResetting = true;
    resetError = "";

    try {
      await resetDatabase();

      // Reload the library to reflect changes
      await loadLibrary();

      closeResetModal();
    } catch (error) {
      resetError = `Failed to reset database: ${error}`;
      isResetting = false;
    }
  }

  async function handleSetDownloadLocation() {
    try {
      const selected = await selectMusicFolder();
      if (selected) {
        appSettings.setDownloadLocation(selected);
      }
    } catch (error) {
      console.error("Failed to select download location:", error);
    }
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

      // Reset progress
      syncProgress = null;
      syncPercentage = 0;

      if (
        result.tracks_migrated === 0 &&
        result.albums_migrated === 0 &&
        result.errors.length === 0
      ) {
        syncSuccess = true;
        syncMessage = `✓ No cover files found to sync.`;
      } else if (result.errors.length === 0) {
        syncSuccess = true;
        syncMessage = ` Successfully synced ${result.tracks_migrated} track covers and ${result.albums_migrated} album covers`;

        // Reload library to show the covers
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

      // Clear message after 5 seconds
      setTimeout(() => {
        syncMessage = "";
      }, 5000);
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

      // Reset progress
      mergeProgress = null;
      mergePercentage = 0;

      if (result.covers_merged === 0 && result.errors.length === 0) {
        mergeSuccess = true;
        mergeMessage = `✓ No duplicate covers found. All album covers are unique.`;
      } else if (result.errors.length === 0) {
        mergeSuccess = true;
        const spaceSavedMB = (result.space_saved_bytes / (1024 * 1024)).toFixed(
          2,
        );
        mergeMessage = `✓ Successfully merged ${result.covers_merged} duplicate covers across ${result.albums_processed} albums. Saved ${spaceSavedMB} MB of disk space.`;

        // Reload library to refresh cover references
        console.log("[Settings] Reloading library...");
        await loadLibrary();
        console.log("[Settings] Library reloaded");
      } else {
        mergeSuccess = false;
        const spaceSavedMB = (result.space_saved_bytes / (1024 * 1024)).toFixed(
          2,
        );
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

      // Clear message after 8 seconds
      setTimeout(() => {
        mergeMessage = "";
      }, 8000);
    }
  }

  function formatTime(ms: number): string {
    if (!ms || ms === 0) return "";

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
</script>

<div class="settings-view">
  <header class="view-header">
    <h1>Settings</h1>
  </header>

  <div class="settings-content">
    <div class="settings-container">
      <!-- Theme Mode -->
      <section class="settings-section">
        <h3 class="section-title">Appearance</h3>

        <div class="setting-item">
          <span class="setting-label">Theme Mode</span>
          <div class="theme-modes">
            <button
              class="mode-btn"
              class:active={$theme.mode === "dark"}
              on:click={() => handleModeChange("dark")}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M9.37 5.51c-.18.64-.27 1.31-.27 1.99 0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27C17.45 17.19 14.93 19 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49zM12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"
                />
              </svg>
              <span>Dark</span>
            </button>
            <button
              class="mode-btn"
              class:active={$theme.mode === "light"}
              on:click={() => handleModeChange("light")}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"
                />
              </svg>
              <span>Light</span>
            </button>
            <button
              class="mode-btn"
              class:active={$theme.mode === "system"}
              on:click={() => handleModeChange("system")}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"
                />
              </svg>
              <span>System</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Accent Color -->
      <section class="settings-section">
        <h3 class="section-title">Accent Color</h3>

        <div class="setting-item">
          <div class="color-grid">
            {#each presetAccents as preset}
              <button
                class="color-swatch"
                class:active={$theme.accentColor === preset.color}
                style="--swatch-color: {preset.color}"
                on:click={() => handleAccentChange(preset.color)}
                title={preset.name}
              >
                {#if $theme.accentColor === preset.color}
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="currentColor"
                  >
                    <path
                      d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                    />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Custom Colors -->
        {#if $theme.customAccentColors.length > 0}
          <div class="setting-item">
            <span class="setting-label">Custom Colors</span>
            <div class="color-grid small">
              {#each $theme.customAccentColors as color}
                <button
                  class="color-swatch small"
                  class:active={$theme.accentColor === color}
                  style="--swatch-color: {color}"
                  on:click={() => handleAccentChange(color)}
                >
                  {#if $theme.accentColor === color}
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="currentColor"
                    >
                      <path
                        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                      />
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Add Custom Color -->
        <div class="setting-item">
          <span class="setting-label">Add Custom Color</span>
          <div class="custom-color-input">
            <input
              type="color"
              bind:value={customColorInput}
              class="color-picker"
            />
            <input
              type="text"
              bind:value={customColorInput}
              placeholder="#1DB954"
              class="color-text"
              maxlength="7"
            />
            <button class="add-btn" on:click={handleCustomColorAdd}>
              Add
            </button>
          </div>
        </div>
      </section>

      <!-- General -->
      <section class="settings-section">
        <h3 class="section-title">General</h3>

        <div class="setting-item">
          <span class="setting-label">Download Location</span>
          <div class="path-selector">
            <div
              class="path-display"
              title={$appSettings.downloadLocation || "Not set"}
            >
              {$appSettings.downloadLocation || "No download location set"}
            </div>
            <button class="selector-btn" on:click={handleSetDownloadLocation}>
              Change
            </button>
          </div>
          <p class="setting-hint">Where downloaded songs will be saved</p>
        </div>

        <div class="setting-item">
          <span class="setting-label">Window Start Mode</span>
          <div class="theme-modes">
            <button
              class="mode-btn"
              class:active={$appSettings.startMode === "normal"}
              on:click={() => appSettings.setStartMode("normal")}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="currentColor"
              >
                <path
                  d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"
                />
              </svg>
              <span>Normal</span>
            </button>
            <button
              class="mode-btn"
              class:active={$appSettings.startMode === "maximized"}
              on:click={() => appSettings.setStartMode("maximized")}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="currentColor"
              >
                <path d="M4 4h16v16H4V4zm2 4v10h12V8H6z" />
              </svg>
              <span>Maximized</span>
            </button>
            <button
              class="mode-btn"
              class:active={$appSettings.startMode === "minimized"}
              on:click={() => appSettings.setStartMode("minimized")}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="currentColor"
              >
                <path d="M6 19h12v2H6z" />
              </svg>
              <span>Minimized</span>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-label">Show Discord Button</span>
              <p class="setting-hint">
                Show a link to the community Discord in the sidebar
              </p>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showDiscord}
              on:click={() =>
                appSettings.setShowDiscord(!$appSettings.showDiscord)}
              aria-label="Toggle Discord Button"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-label">Autoplay</span>
              <p class="setting-hint">
                Keep playing random tracks from your library when the queue ends
              </p>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.autoplay}
              on:click={() => appSettings.setAutoplay(!$appSettings.autoplay)}
              aria-label="Toggle Autoplay"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>
      </section>

      <!-- Library Organization -->
      <section class="settings-section">
        <h3 class="section-title">Library Organization</h3>

        <div class="setting-item">
          <span class="setting-label">Album Grouping</span>
          <div class="theme-modes">
            <button
              class="mode-btn"
              class:active={($appSettings.albumMatchingMode === "name_only" && !pendingAlbumMatchingMode) || pendingAlbumMatchingMode === "name_only"}
              on:click={() => handleAlbumModeChange("name_only")}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10v2H7z"
                />
              </svg>
              <span>By Name Only</span>
            </button>
            <button
              class="mode-btn"
              class:active={($appSettings.albumMatchingMode === "name_and_artist" && !pendingAlbumMatchingMode) || pendingAlbumMatchingMode === "name_and_artist"}
              on:click={() => handleAlbumModeChange("name_and_artist")}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm1-13h-2v4H7v2h4v4h2v-4h4v-2h-4V7z"
                />
              </svg>
              <span>By Name + Artist</span>
            </button>
          </div>
          {#if pendingAlbumMatchingMode}
            <div class="pending-rescan">
              <p class="setting-hint pending-hint">
                ⚠ Changing this requires a library rescan to take effect.
              </p>
              <div class="pending-actions">
                <button
                  class="cancel-pending-btn"
                  on:click={() => pendingAlbumMatchingMode = null}
                  disabled={isRescanning}
                >
                  Cancel
                </button>
                <button
                  class="apply-rescan-btn"
                  on:click={handleApplyAndRescan}
                  disabled={isRescanning}
                >
                  {#if isRescanning}
                    Rescanning...
                  {:else}
                    Apply & Rescan
                  {/if}
                </button>
              </div>
            </div>
          {/if}
      
          {#if rescanMessage}
            <p class="sync-message" class:success={rescanSuccess} class:error={!rescanSuccess}>
              {rescanMessage}
            </p>
          {/if}
      
          <p class="setting-hint">
            {#if (pendingAlbumMatchingMode ?? $appSettings.albumMatchingMode) === "name_only"}
              Albums with the same name are grouped together, even if by different artists.
            {:else}
              "Greatest Hits" by different artists will appear as separate albums.
            {/if}
          </p>
        </div>
      </section>
    

      <!-- Cover Management -->
      <section class="settings-section">
        <h3 class="section-title">Cover Management</h3>

        <!-- Sync Cover Files -->
        <div class="setting-item">
          <div class="danger-item">
            <div class="danger-info">
              <span class="setting-label">Sync Cover Files</span>
              <p class="setting-hint">
                Scan existing cover image files and update the database with
                their paths. Use this if covers were created but aren't showing
                in the app.
              </p>
            </div>
            <button
              class="selector-btn"
              on:click={handleSyncCovers}
              disabled={isSyncingCovers}
            >
              {#if isSyncingCovers}
                Syncing...
              {:else}
                Sync Covers
              {/if}
            </button>
          </div>

          <!-- Sync Progress Bar -->
          {#if isSyncingCovers && syncProgress}
            <div class="progress-container">
              <div class="progress-header">
                <div class="progress-info">
                  <span class="progress-text">
                    {syncProgress.current.toLocaleString()} of {syncProgress.total.toLocaleString()}
                    items
                  </span>
                  {#if syncProgress.estimated_time_remaining_ms}
                    <span class="progress-separator">·</span>
                    <span class="progress-eta">
                      {formatTime(syncProgress.estimated_time_remaining_ms)} remaining
                    </span>
                  {/if}
                </div>
                <div class="progress-percentage">{syncPercentage}%</div>
              </div>
              <div class="progress-bar-container">
                <div
                  class="progress-bar-fill"
                  style="width: {syncPercentage}%"
                ></div>
              </div>
              <div class="progress-stats">
                <span class="stat-item">
                  <span class="stat-label">Tracks:</span>
                  <span class="stat-value">{syncProgress.tracks_migrated}</span>
                </span>
                <span class="stat-item">
                  <span class="stat-label">Albums:</span>
                  <span class="stat-value">{syncProgress.albums_migrated}</span>
                </span>
              </div>
            </div>
          {/if}

          {#if syncMessage}
            <p
              class="sync-message"
              class:success={syncSuccess}
              class:error={!syncSuccess}
            >
              {syncMessage}
            </p>
          {/if}
        </div>

        <!-- Merge Duplicate Covers -->
        <div class="setting-item">
          <div class="danger-item">
            <div class="danger-info">
              <span class="setting-label">Merge Duplicate Covers</span>
              <p class="setting-hint">
                Find and merge identical album covers to save disk space and
                improve performance
              </p>
            </div>
            <button
              class="selector-btn"
              on:click={handleMergeDuplicateCovers}
              disabled={isMergingCovers}
            >
              {#if isMergingCovers}
                Merging...
              {:else}
                Merge Duplicates
              {/if}
            </button>
          </div>

          <!-- Merge Progress Bar -->
          {#if isMergingCovers && mergeProgress}
            <div class="progress-container">
              <div class="progress-header">
                <div class="progress-info">
                  <span class="progress-text">
                    {mergeProgress.current_album.toLocaleString()} of {mergeProgress.total_albums.toLocaleString()}
                    albums
                  </span>
                  {#if mergeProgress.estimated_time_remaining_ms}
                    <span class="progress-separator">·</span>
                    <span class="progress-eta">
                      {formatTime(mergeProgress.estimated_time_remaining_ms)} remaining
                    </span>
                  {/if}
                </div>
                <div class="progress-percentage">{mergePercentage}%</div>
              </div>
              <div class="progress-bar-container">
                <div
                  class="progress-bar-fill"
                  style="width: {mergePercentage}%"
                ></div>
              </div>
              <div class="progress-stats">
                <span class="stat-item">
                  <span class="stat-label">Covers Merged:</span>
                  <span class="stat-value">{mergeProgress.covers_merged}</span>
                </span>
                <span class="stat-item">
                  <span class="stat-label">Space Saved:</span>
                  <span class="stat-value"
                    >{formatBytes(mergeProgress.space_saved_bytes)}</span
                  >
                </span>
              </div>
            </div>
          {/if}

          {#if mergeMessage}
            <p
              class="sync-message"
              class:success={mergeSuccess}
              class:error={!mergeSuccess}
            >
              {mergeMessage}
            </p>
          {/if}
        </div>
      </section>

      <!-- Equalizer -->
      <section class="settings-section">
        <h3 class="section-title">Equalizer</h3>

        <div class="setting-item">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-label">Enable Equalizer</span>
              <p class="setting-hint">
                Apply audio frequency adjustments to your music
              </p>
            </div>
            <button
              class="toggle-btn"
              class:active={$equalizer.enabled}
              on:click={() => equalizer.setEnabled(!$equalizer.enabled)}
              aria-label="Toggle Equalizer"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <span class="setting-label">Preset</span>
          <div class="preset-selector">
            <select
              class="preset-select"
              value={$equalizer.currentPreset || ""}
              on:change={(e) => equalizer.applyPreset(e.currentTarget.value)}
              disabled={!$equalizer.enabled}
            >
              <option value="" disabled>Custom</option>
              {#each EQ_PRESETS as preset}
                <option value={preset.name}>{preset.name}</option>
              {/each}
            </select>
            <button
              class="reset-btn"
              on:click={() => equalizer.reset()}
              disabled={!$equalizer.enabled}
              title="Reset to Flat"
            >
              Reset
            </button>
          </div>
        </div>

        <div
          class="setting-item eq-bands-container"
          class:disabled={!$equalizer.enabled}
        >
          <div class="eq-bands">
            {#each $equalizer.bands as band, i}
              <div class="eq-band">
                <span class="eq-gain"
                  >{band.gain > 0 ? "+" : ""}{band.gain}</span
                >
                <div class="eq-slider-container">
                  <input
                    type="range"
                    class="eq-slider"
                    min="-12"
                    max="12"
                    step="1"
                    value={band.gain}
                    disabled={!$equalizer.enabled}
                    on:input={(e) =>
                      equalizer.setBandGain(i, parseInt(e.currentTarget.value))}
                    aria-label="{band.label} Hz"
                  />
                </div>
                <span class="eq-label">{band.label}</span>
              </div>
            {/each}
          </div>
          <div class="eq-scale">
            <span>+12</span>
            <span>0</span>
            <span>-12</span>
          </div>
        </div>
      </section>

      <!-- Developer -->
      <section class="settings-section">
        <h3 class="section-title">Developer</h3>

        <div class="setting-item">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-label">Developer Mode</span>
              <p class="setting-hint">
                Enable browser right-click menu and inspection tools
              </p>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.developerMode}
              on:click={() =>
                appSettings.setDeveloperMode(!$appSettings.developerMode)}
              aria-label="Toggle Developer Mode"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>
      </section>

      <!-- Danger Zone -->
      <section class="settings-section danger-zone">
        <h3 class="section-title danger">Danger Zone</h3>

        <div class="setting-item">
          <div class="danger-item">
            <div class="danger-info">
              <span class="setting-label">Reset Database</span>
              <p class="setting-hint">
                Delete all tracks, albums, playlists, and music folder
                references. This action cannot be undone.
              </p>
            </div>
            <button class="danger-btn" on:click={openResetModal}>
              Reset Database
            </button>
          </div>
        </div>
      </section>

      <!-- About -->
      <section class="settings-section">
        <h3 class="section-title">About</h3>
        <div class="about-info">
          <div class="app-logo">
            <span>Audion</span>
          </div>
          <p class="version">Version {__APP_VERSION__}</p>
          {#if $updates.hasUpdate}
            <button
              class="update-btn"
              on:click={() => (showUpdatePopup = true)}
            >
              Update Available
            </button>
          {:else if $updates.latestRelease}
            <p class="up-to-date">You are up to date</p>
          {/if}
          <p class="copyright">
            A modern music player built with Tauri & Svelte
          </p>
        </div>
      </section>
    </div>
  </div>
</div>

{#if showUpdatePopup && $updates.latestRelease}
  <UpdatePopup
    release={$updates.latestRelease}
    on:close={() => (showUpdatePopup = false)}
  />
{/if}

{#if showResetModal}
  <div
    class="modal-overlay"
    on:click={closeResetModal}
    on:keydown={(e) => e.key === "Escape" && closeResetModal()}
    role="button"
    tabindex="0"
  >
    <div
      class="modal-content"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
    >
      <div class="modal-header">
        <h2>Reset Database</h2>
        <button class="modal-close" on:click={closeResetModal}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="warning-box">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <p>This will permanently delete:</p>
          <ul>
            <li>All tracks in your library</li>
            <li>All albums</li>
            <li>All playlists</li>
            <li>All music folder references</li>
          </ul>
          <p class="warning-note">This action cannot be undone!</p>
        </div>

        <div class="confirm-input">
          <label for="confirm-text">
            Type <strong>DELETE CONFIRM</strong> to proceed:
          </label>
          <input
            id="confirm-text"
            type="text"
            bind:value={resetConfirmText}
            placeholder="DELETE CONFIRM"
            disabled={isResetting}
          />
        </div>

        {#if resetError}
          <p class="error-message">{resetError}</p>
        {/if}
      </div>

      <div class="modal-footer">
        <button
          class="cancel-btn"
          on:click={closeResetModal}
          disabled={isResetting}
        >
          Cancel
        </button>
        <button
          class="confirm-danger-btn"
          on:click={handleResetDatabase}
          disabled={isResetting || resetConfirmText !== "DELETE CONFIRM"}
        >
          {#if isResetting}
            Resetting...
          {:else}
            Reset Database
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-view {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .view-header {
    padding: var(--spacing-lg) var(--spacing-md);
    flex-shrink: 0;
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
  }

  .view-header h1 {
    font-size: 2rem;
    font-weight: 700;
    padding-left: var(--spacing-md);
  }

  .settings-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-md);
    padding-bottom: calc(var(--player-height) + var(--spacing-lg));
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
  }

  @media (max-width: 768px) {
    .settings-content {
      padding-bottom: calc(
        var(--mobile-bottom-inset, 130px) + var(--spacing-xl)
      );
    }

    .view-header h1 {
      font-size: 1.5rem;
    }
  }

  .settings-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 var(--spacing-md);
  }

  .settings-section {
    margin-bottom: var(--spacing-xl);
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-subdued);
    margin-bottom: var(--spacing-lg);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .setting-item {
    margin-bottom: var(--spacing-lg);
  }

  .setting-item:last-child {
    margin-bottom: 0;
  }

  .setting-label {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: var(--spacing-sm);
    display: block;
  }

  /* Theme Mode Buttons */
  .theme-modes {
    display: flex;
    gap: var(--spacing-md);
  }

  .mode-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-lg);
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    transition: all var(--transition-fast);
    border: 2px solid transparent;
  }

  .mode-btn:hover {
    background-color: var(--bg-highlight);
    color: var(--text-primary);
  }

  .mode-btn.active {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background-color: rgba(var(--accent-rgb), 0.1);
  }

  .mode-btn span {
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* Color Grid */
  .color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: var(--spacing-sm);
  }

  .color-swatch {
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    background-color: var(--swatch-color);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--transition-fast);
    border: 2px solid transparent;
    width: 100%;
    max-width: 48px;
  }

  .color-swatch:hover {
    transform: scale(1.1);
  }

  .color-swatch.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--bg-base);
  }

  .color-swatch.small {
    border-radius: var(--radius-sm);
  }

  .color-swatch svg {
    color: white;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }

  /* Custom Color Input */
  .custom-color-input {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
  }

  .color-picker {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: var(--radius-sm);
  }

  .color-text {
    flex: 1;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: monospace;
    max-width: 120px;
  }

  .color-text:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .pending-rescan {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-md);
  background-color: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.4);
  border-radius: var(--radius-sm);
}

.pending-hint {
  color: #ffc107;
  margin: 0 0 var(--spacing-sm) 0;
}

.pending-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.cancel-pending-btn {
  padding: var(--spacing-xs) var(--spacing-md);
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cancel-pending-btn:hover:not(:disabled) {
  background-color: var(--bg-highlight);
}

.apply-rescan-btn {
  padding: var(--spacing-xs) var(--spacing-md);
  background-color: var(--accent-primary);
  color: var(--bg-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.apply-rescan-btn:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.apply-rescan-btn:disabled,
.cancel-pending-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

  .add-btn {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    font-weight: 600;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }

  .add-btn:hover {
    background-color: var(--accent-hover);
  }

  .setting-hint {
    font-size: 0.8125rem;
    color: var(--text-subdued);
    margin-top: var(--spacing-xs);
  }

  /* About */
  .about-info {
    text-align: center;
    padding: var(--spacing-lg);
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    margin-top: var(--spacing-sm);
  }

  .app-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    color: var(--accent-primary);
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-sm);
  }

  .version {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
  }

  .copyright {
    font-size: 0.75rem;
    color: var(--text-subdued);
  }

  /* Toggle Switch */
  .toggle-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .toggle-btn {
    width: 48px;
    height: 26px;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 13px;
    position: relative;
    cursor: pointer;
    transition: all var(--transition-fast);
    padding: 0;
  }

  .toggle-btn.active {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .toggle-handle {
    width: 20px;
    height: 20px;
    background-color: var(--text-subdued);
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition:
      transform var(--transition-fast),
      background-color var(--transition-fast);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .toggle-btn.active .toggle-handle {
    transform: translateX(22px);
    background-color: white;
  }

  .update-btn {
    margin: var(--spacing-sm) auto;
    padding: 6px 12px;
    background-color: var(--accent-primary);
    color: white;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    display: block;
    transition: all 0.2s;
  }

  .path-selector {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
  }

  .path-display {
    flex: 1;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: monospace;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .selector-btn {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .selector-btn:hover {
    border-color: var(--text-primary);
    background-color: var(--bg-highlight);
  }

  .update-btn:hover {
    background-color: var(--accent-hover);
    transform: translateY(-1px);
  }

  .up-to-date {
    font-size: 0.75rem;
    color: var(--text-subdued);
    margin-bottom: var(--spacing-sm);
  }

  /* Danger Zone */
  .danger-zone {
    border: 1px solid #dc3545;
  }

  .section-title.danger {
    color: #dc3545;
    border-bottom-color: rgba(220, 53, 69, 0.3);
  }

  .danger-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
  }

  .danger-info {
    flex: 1;
  }

  .danger-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    background-color: transparent;
    color: #dc3545;
    border: 1px solid #dc3545;
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .danger-btn:hover {
    background-color: #dc3545;
    color: white;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-lg);
    max-width: 480px;
    width: 90%;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #dc3545;
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }

  .modal-close:hover {
    background-color: var(--bg-highlight);
    color: var(--text-primary);
  }

  .modal-body {
    padding: var(--spacing-lg);
  }

  .warning-box {
    background-color: rgba(220, 53, 69, 0.1);
    border: 1px solid rgba(220, 53, 69, 0.3);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
    text-align: center;
    margin-bottom: var(--spacing-lg);
  }

  .warning-box svg {
    color: #dc3545;
    margin-bottom: var(--spacing-sm);
  }

  .warning-box p {
    color: var(--text-primary);
    margin: var(--spacing-sm) 0;
  }

  .warning-box ul {
    text-align: left;
    margin: var(--spacing-md) 0;
    padding-left: var(--spacing-xl);
    color: var(--text-secondary);
  }

  .warning-box li {
    margin: var(--spacing-xs) 0;
  }

  .warning-note {
    color: #dc3545 !important;
    font-weight: 600;
  }

  .confirm-input {
    margin-top: var(--spacing-md);
  }

  .confirm-input label {
    display: block;
    margin-bottom: var(--spacing-sm);
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .confirm-input label strong {
    color: #dc3545;
    font-family: monospace;
  }

  .confirm-input input {
    width: 100%;
    padding: var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 1rem;
    font-family: monospace;
  }

  .confirm-input input:focus {
    outline: none;
    border-color: #dc3545;
  }

  .confirm-input input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-message {
    color: #dc3545;
    font-size: 0.875rem;
    margin-top: var(--spacing-sm);
    text-align: center;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    border-top: 1px solid var(--border-color);
  }

  .cancel-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .cancel-btn:hover:not(:disabled) {
    background-color: var(--bg-highlight);
  }

  .cancel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .confirm-danger-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    background-color: #dc3545;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .confirm-danger-btn:hover:not(:disabled) {
    background-color: #c82333;
  }

  .confirm-danger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Equalizer Styles */
  .preset-selector {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
  }

  .preset-select {
    flex: 1;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
    max-width: 200px;
  }

  .preset-select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .preset-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .reset-btn {
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .reset-btn:hover:not(:disabled) {
    background-color: var(--bg-highlight);
    border-color: var(--text-primary);
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .eq-bands-container {
    display: flex;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    background-color: var(--bg-surface);
    border-radius: var(--radius-md);
    transition: opacity var(--transition-fast);
    overflow: hidden;
  }

  .eq-bands-container.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .eq-bands {
    display: flex;
    justify-content: space-around;
    gap: var(--spacing-xs);
    flex: 1;
    min-width: 0;
  }

  .eq-band {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-xs);
    flex: 1;
    min-width: 0;
    max-width: 60px;
  }

  .eq-gain {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    min-width: 28px;
    text-align: center;
    font-family: monospace;
  }

  .eq-label {
    font-size: 0.6rem;
    color: var(--text-subdued);
    text-transform: uppercase;
    white-space: nowrap;
  }

  .eq-slider-container {
    height: 100px;
    width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .eq-slider {
    width: 100px;
    height: 6px;
    transform: rotate(-90deg);
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-highlight);
    border-radius: 3px;
    cursor: pointer;
    outline: none;
  }

  .eq-slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    background: var(--bg-highlight);
    border-radius: 3px;
  }

  .eq-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    border-radius: 50%;
    margin-top: -5px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .eq-slider::-webkit-slider-thumb:hover {
    background: var(--accent-hover);
    transform: scale(1.1);
  }

  .eq-slider::-moz-range-track {
    width: 100%;
    height: 6px;
    background: var(--bg-highlight);
    border-radius: 3px;
  }

  .eq-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    border-radius: 50%;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .eq-slider::-moz-range-thumb:hover {
    background: var(--accent-hover);
  }

  .eq-slider:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .eq-slider:disabled::-webkit-slider-thumb {
    background: var(--text-subdued);
  }

  .eq-slider:disabled::-moz-range-thumb {
    background: var(--text-subdued);
  }

  .eq-scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    font-size: 0.6rem;
    color: var(--text-subdued);
    padding: 20px 0;
    font-family: monospace;
    min-width: 24px;
  }

  .sync-message {
    margin-top: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    text-align: center;
  }

  .sync-message.success {
    background-color: rgba(40, 167, 69, 0.1);
    color: #28a745;
    border: 1px solid rgba(40, 167, 69, 0.3);
  }

  .sync-message.error {
    background-color: rgba(220, 53, 69, 0.1);
    color: #dc3545;
    border: 1px solid rgba(220, 53, 69, 0.3);
  }

  /* Progress Bar Styles */
  .progress-container {
    margin-top: var(--spacing-md);
    padding: var(--spacing-md);
    background-color: var(--bg-base);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  .progress-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .progress-text {
    font-weight: 500;
    color: var(--text-primary);
  }

  .progress-separator {
    color: var(--text-subdued);
  }

  .progress-eta {
    color: var(--accent-primary);
    font-weight: 500;
  }

  .progress-percentage {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent-primary);
  }

  .progress-bar-container {
    height: 6px;
    background-color: var(--bg-surface);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: var(--spacing-sm);
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--accent-primary),
      var(--accent-light, #1ed760)
    );
    transition: width 0.3s ease;
    border-radius: 3px;
  }

  .progress-stats {
    display: flex;
    gap: var(--spacing-lg);
    font-size: 0.75rem;
  }

  .stat-item {
    display: flex;
    gap: 4px;
  }

  .stat-label {
    color: var(--text-subdued);
  }

  .stat-value {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .view-header h1 {
      font-size: 1.5rem;
      padding-left: var(--spacing-sm);
    }

    .settings-content {
      padding: var(--spacing-sm);
      /* Preserve bottom padding for fixed bottom nav (60px) + mini player (64px) + margin */
      padding-bottom: calc(140px + var(--spacing-xl));
    }

    .settings-container {
      padding: 0;
    }

    .settings-section {
      padding: var(--spacing-md);
      margin-bottom: var(--spacing-md);
    }
  }
</style>
