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
  } from "$lib/api/tauri";
  import { loadLibrary } from "$lib/stores/library";
  import UpdatePopup from "./UpdatePopup.svelte";
  import { confirm } from "$lib/stores/dialogs";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";

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

  // Audio Backend state
  let initialAudioBackend = $appSettings.audioBackend;
  let showRefreshNotice = false;

  $: showRefreshNotice = $appSettings.audioBackend !== initialAudioBackend;

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

  function handleRefresh() {
    window.location.reload();
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
              aria-label="Dark theme"
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
              aria-label="Light theme"
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
              aria-label="System theme"
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
                aria-label="Accent color {preset.name} ({preset.color})"
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
                  aria-label="Custom accent color {color}"
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
              aria-label="Pick a custom color"
            />
            <input
              type="text"
              bind:value={customColorInput}
              placeholder="#1DB954"
              class="color-text"
              maxlength="7"
              aria-label="Hex color code"
            />
            <button
              class="add-btn"
              on:click={handleCustomColorAdd}
              aria-label="Add custom color"
            >
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
            <button
              class="selector-btn"
              on:click={handleSetDownloadLocation}
              aria-label="Change download location"
            >
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
              aria-label="Start window in normal mode"
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
              aria-label="Start window maximized"
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
              aria-label="Start window minimized"
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
              role="switch"
              aria-checked={$appSettings.showDiscord}
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
              role="switch"
              aria-checked={$appSettings.autoplay}
              aria-label="Toggle Autoplay"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <span class="setting-label">Audio Backend</span>
          <div class="theme-modes">
            <button
              class="mode-btn"
              class:active={$appSettings.audioBackend === "auto"}
              on:click={() => appSettings.setAudioBackend("auto")}
              aria-label="Auto audio backend"
            >
              <span>Auto</span>
            </button>
            <button
              class="mode-btn"
              class:active={$appSettings.audioBackend === "native"}
              on:click={() => appSettings.setAudioBackend("native")}
              aria-label="Native audio backend"
            >
              <span>Native</span>
            </button>
            <button
              class="mode-btn"
              class:active={$appSettings.audioBackend === "html5"}
              on:click={() => appSettings.setAudioBackend("html5")}
              aria-label="HTML5 audio backend"
            >
              <span>HTML5</span>
            </button>
          </div>
          <p class="setting-hint">
            <strong>Auto:</strong> Recommended. Uses Native on Linux/Android and
            HTML5 elsewhere.<br />
            <strong>Native:</strong> Better performance, system-wide EQ (Rust
            backend).<br />
            <strong>HTML5:</strong> Legacy web audio playback.
          </p>
        </div>

        {#if showRefreshNotice}
          <div class="setting-item refresh-notice">
            <div class="notice-content">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
                />
              </svg>
              <span
                >Changing the audio backend requires a refresh to take effect.</span
              >
            </div>
            <button
              class="selector-btn refresh-btn"
              on:click={handleRefresh}
              aria-label="Refresh now"
            >
              Refresh Now
            </button>
          </div>
        {/if}
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
              aria-label="Sync cover files"
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
              aria-label="Merge duplicate covers"
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
              role="switch"
              aria-checked={$equalizer.enabled}
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
              aria-label="Equalizer preset"
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
              aria-label="Reset equalizer to flat"
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
              role="switch"
              aria-checked={$appSettings.developerMode}
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
            <button
              class="danger-btn"
              on:click={openResetModal}
              aria-label="Reset database"
            >
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
              aria-label="View update"
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
    aria-label="Close modal"
  >
    <div
      class="modal-content"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-dialog-title"
    >
      <div class="modal-header">
        <h2 id="reset-dialog-title">Reset Database</h2>
        <button
          class="modal-close"
          on:click={closeResetModal}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="warning-box">
          <svg
            viewBox="0 0 24 24"
            width="48"
            height="48"
            fill="currentColor"
            aria-hidden="true"
          >
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
            aria-label="Confirmation text"
          />
        </div>

        {#if resetError}
          <p class="error-message" role="alert">{resetError}</p>
        {/if}
      </div>

      <div class="modal-footer">
        <button
          class="cancel-btn"
          on:click={closeResetModal}
          disabled={isResetting}
          aria-label="Cancel reset"
        >
          Cancel
        </button>
        <button
          class="confirm-danger-btn"
          on:click={handleResetDatabase}
          disabled={isResetting || resetConfirmText !== "DELETE CONFIRM"}
          aria-label="Confirm reset"
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
  /* ... existing styles (unchanged) ... */

  /* MOBILE-SPECIFIC ENHANCEMENTS */
  @media (max-width: 768px) {
    /* Ensure all interactive elements are at least 44x44 */
    button,
    .mode-btn,
    .color-swatch,
    .selector-btn,
    .add-btn,
    .danger-btn,
    .toggle-btn,
    .reset-btn,
    .preset-select {
      min-height: 44px;
      min-width: 44px;
    }

    /* Mode buttons – allow wrapping and ensure touchable */
    .theme-modes {
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }

    .mode-btn {
      flex: 1 0 calc(50% - var(--spacing-sm));
      min-width: 120px;
      padding: var(--spacing-md);
    }

    /* Color grid – adjust columns to maintain touchable swatches */
    .color-grid {
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    }

    /* Preset selector – stack on small screens */
    .preset-selector {
      flex-direction: column;
      align-items: stretch;
    }

    .preset-select {
      max-width: none;
      width: 100%;
    }

    .reset-btn {
      width: 100%;
    }

    /* Toggle switch – increase hit area */
    .toggle-btn {
      width: 56px;
      height: 32px;
    }

    .toggle-handle {
      width: 24px;
      height: 24px;
      top: 3px;
      left: 3px;
    }

    .toggle-btn.active .toggle-handle {
      transform: translateX(26px);
    }

    /* Equalizer sliders – more touch-friendly */
    .eq-slider-container {
      height: 120px;
    }

    .eq-slider {
      width: 120px;
    }

    /* Modal buttons – ensure touchable */
    .cancel-btn,
    .confirm-danger-btn {
      min-height: 48px;
    }

    /* Adjust bottom padding for content */
    .settings-content {
      padding-bottom: calc(
        var(--mobile-bottom-inset, 130px) + var(--spacing-xl)
      );
    }
  }
</style>
