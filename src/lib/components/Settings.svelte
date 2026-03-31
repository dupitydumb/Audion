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
    setListenbrainzToken,
    deleteListenbrainzToken,
    verifyListenbrainzToken,
    isAndroid,
    type MergeCoverResult,
  } from "$lib/api/tauri";
  import { loadLibrary } from "$lib/stores/library";
  import UpdatePopup from "./UpdatePopup.svelte";
  import { confirm } from "$lib/stores/dialogs";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import {
    authState,
    syncStatus,
    isLoggedIn,
    isSyncing,
    showLoginModal,
    logout,
    triggerSync,
    deleteAccount,
  } from "$lib/stores/sync";
  import { nativeAudioStop } from '$lib/services/native-audio';

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
      handleRefresh();

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
      if (isAndroid()) {
        // Use native Android SAF folder picker
        const path = await new Promise<string | null>((resolve) => {
          // Register one-shot callback for the result
          (window as any).__onAndroidFolderPicked = (
            pickedPath: string | null,
          ) => {
            delete (window as any).__onAndroidFolderPicked;
            resolve(pickedPath);
          };
          // Launch the native picker
          (window as any).AndroidFolderPicker?.pickFolder();
        });
        if (path) {
          appSettings.setDownloadLocation(path);
        }
      } else {
        const selected = await selectMusicFolder();
        if (selected) {
          appSettings.setDownloadLocation(selected);
        }
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
    if (!ms || ms === 0) return "0s";

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  function formatLastSynced(isoString: string | null): string {
    if (!isoString) return "Not synced yet";

    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);

      if (diffSec < 60) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;

      // Format as DD/MM/YYYY
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      console.error("Failed to format last sync date:", e);
      return isoString;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function handleRefresh() {
    nativeAudioStop();
    window.location.reload();
  }

  // ── ListenBrainz ───────────────────────────────────────────────────────────
  let lbTokenInput = "";
  let lbIsVerifying = false;
  let lbVerifyError = "";
  let lbVerifySuccess = false;

  async function handleVerifyLbToken() {
    if (!lbTokenInput.trim()) return;
    lbIsVerifying = true;
    lbVerifyError = "";
    lbVerifySuccess = false;
    try {
      const username = await verifyListenbrainzToken(lbTokenInput.trim());
      await setListenbrainzToken(lbTokenInput.trim());
      appSettings.setListenBrainzTokenSet(true, username);
      lbVerifySuccess = true;
      lbTokenInput = "";
      setTimeout(() => {
        lbVerifySuccess = false;
      }, 4000);
    } catch (e) {
      lbVerifyError = String(e);
    } finally {
      lbIsVerifying = false;
    }
  }

  async function handleRemoveLbToken() {
    await deleteListenbrainzToken();
    appSettings.setListenBrainzTokenSet(false, "");
    if ($appSettings.listenBrainzEnabled) appSettings.toggleListenBrainz();
  }

  // ─── API Key ──────────────────────────────────────────────────────────────
  import { apiKey, setApiKey } from "$lib/stores/sync";
  let apiKeyInput = $apiKey;
  let apiKeySaving = false;
  let apiKeySuccess = false;
  let apiKeyError = "";

  async function handleSaveApiKey() {
    apiKeySaving = true;
    apiKeyError = "";
    apiKeySuccess = false;
    try {
      await setApiKey(apiKeyInput.trim());
      apiKeySuccess = true;
      setTimeout(() => {
        apiKeySuccess = false;
      }, 3000);
    } catch (e) {
      let errorMessage = String(e);
      if (
        errorMessage.includes("403") ||
        errorMessage.includes("Invalid or missing API Key")
      ) {
        errorMessage =
          "Account sync is only available for supporters who donated to the project.";
      }
      apiKeyError = errorMessage;
    } finally {
      apiKeySaving = false;
    }
  }
</script>

<div class="settings-view">
  <header class="view-header">
    <h1>Settings</h1>
  </header>

  <div class="settings-content">
    <div class="settings-container">
      <!-- Support Links -->
      <section class="settings-section">
        <div class="support-links">
          <a
            href="https://discord.gg/27XRVQsBd9"
            target="_blank"
            rel="noreferrer"
            class="support-btn discord-btn"
            aria-label="Join our Discord"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path
                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
              />
            </svg>
            Discord
          </a>
          <a
            href="https://ko-fi.com/N4N5UMNR1"
            target="_blank"
            rel="noreferrer"
            class="support-btn kofi-btn"
            aria-label="Support on Ko-fi"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path
                d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-.995 4.032.019.152.154.16.166.152.166s.068-.112.151-.166c1.27-1.241 3.563-.78 4.346.394.886 1.318.488 2.927-.127 3.332zm4.906.658c-.375.133-1.259.053-1.259.053l.13-3.998s.932-.171 1.432.064c1.004.472.835 3.44-.303 3.881z"
              />
            </svg>
            Ko-fi
          </a>
        </div>
      </section>

      <!-- Account & Sync -->
      <section class="settings-section">
        <h3 class="section-title">Account</h3>

        {#if $isLoggedIn}
          <div class="setting-item account-card">
            <div class="account-profile">
              {#if $authState.avatar_url}
                <img src={$authState.avatar_url} alt="Profile" class="avatar" />
              {:else}
                <div class="avatar avatar-placeholder">
                  {($authState.name || $authState.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
              {/if}
              <div class="account-info">
                <span class="account-name">{$authState.name || "User"}</span>
                <span class="account-email">{$authState.email || ""}</span>
              </div>
              <button
                class="logout-btn"
                on:click={async () => {
                  const ok = await confirm(
                      "Are you sure you want to log out? Unsynced changes will be lost.",
                      { title: "Log Out" }
                  );
                  if (ok) logout();
                }}
                aria-label="Log out"
              >
                Log Out
              </button>
            </div>

            <div class="sync-status-area">
              <div class="sync-info">
                <span class="setting-label">Sync Status</span>
                <span class="setting-value">
                  {#if $isSyncing}
                    Syncing...
                  {:else if $syncStatus.last_error}
                    <span class="text-error"
                      >Error: {$syncStatus.last_error}</span
                    >
                  {:else}
                    {formatLastSynced($syncStatus.last_sync_at)}
                  {/if}
                </span>
                {#if $syncStatus.pending_changes > 0}
                  <span class="setting-hint"
                    >{$syncStatus.pending_changes} pending change{$syncStatus.pending_changes !==
                    1
                      ? "s"
                      : ""}</span
                  >
                {/if}
              </div>
              <button
                class="btn-secondary btn-sm sync-btn"
                on:click={() => triggerSync()}
                disabled={$isSyncing}
                aria-label="Sync now"
              >
                {#if $isSyncing}
                  <svg
                    class="spinner"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                  >
                    <path
                      fill="currentColor"
                      d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
                    />
                  </svg>
                  Syncing
                {:else}
                  Sync Now
                {/if}
              </button>
            </div>

            <div
              class="setting-item"
              style="border-top: 1px solid var(--border-color); padding-top: var(--spacing-md); margin-top: var(--spacing-sm);"
            >
              <span class="setting-label">Sync API Key</span>
              <div class="path-selector">
                <input
                  type="password"
                  bind:value={apiKeyInput}
                  placeholder="Enter your Sync API Key"
                  class="lb-token-input"
                  on:keydown={(e) => e.key === "Enter" && handleSaveApiKey()}
                />
                <button
                  class="selector-btn"
                  on:click={handleSaveApiKey}
                  disabled={apiKeySaving}
                >
                  {apiKeySaving ? "Saving..." : "Save Key"}
                </button>
              </div>
              <p class="setting-hint">
                Account sync is available for supporters who donated to the
                project.
              </p>
              {#if apiKeyError}
                <p class="setting-hint" style="color: var(--text-error);">
                  ✗ {apiKeyError}
                </p>
              {/if}
              {#if apiKeySuccess}
                <p class="setting-hint" style="color: var(--accent-primary);">
                  ✓ API Key saved!
                </p>
              {/if}
            </div>
          </div>

          <div class="setting-item">
            <div class="danger-item">
              <div class="danger-info">
                <span class="setting-label">Delete Account</span>
                <p class="setting-hint">
                  Permanently delete your account and all synced data from the
                  server. Your local library is not affected.
                </p>
              </div>
              <button
                class="danger-btn"
                on:click={async () => {
                  const ok = await confirm(
                      "This will permanently delete your account and all synced data from the server. This cannot be undone. Continue?",
                      { title: "Delete Account", danger: true }
                  );
                  if (ok) {
                    try {
                      await deleteAccount();
                    } catch (e) {
                      console.error("Failed to delete account:", e);
                    }
                  }
                }}
                aria-label="Delete account"
              >
                Delete Account
              </button>
            </div>
          </div>
        {:else}
          <div class="setting-item">
            <div class="account-signin">
              <p class="setting-hint">
                Sign in to sync your playlists, liked songs, and settings across
                all your devices.
              </p>
              <button
                class="btn-primary"
                on:click={() => showLoginModal.set(true)}
                aria-label="Sign in"
              >
                Sign In
              </button>
            </div>
          </div>

          <div class="setting-item">
            <span class="setting-label">Sync API Key</span>
            <div class="path-selector">
              <input
                type="password"
                bind:value={apiKeyInput}
                placeholder="Enter your Sync API Key"
                class="lb-token-input"
                on:keydown={(e) => e.key === "Enter" && handleSaveApiKey()}
              />
              <button
                class="selector-btn"
                on:click={handleSaveApiKey}
                disabled={apiKeySaving}
              >
                {apiKeySaving ? "Saving..." : "Save Key"}
              </button>
            </div>
            <p class="setting-hint">
              Account sync is available for supporters who donated to the
              project.
            </p>
            {#if apiKeyError}
              <p class="setting-hint" style="color: var(--text-error);">
                ✗ {apiKeyError}
              </p>
            {/if}
            {#if apiKeySuccess}
              <p class="setting-hint" style="color: var(--accent-primary);">
                ✓ API Key saved!
              </p>
            {/if}
          </div>
        {/if}
      </section>

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

        {#if !isAndroid()}
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
        {/if}

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
        <h3 class="section-title">ListenBrainz</h3>

        <!-- Enable toggle -->
        <div class="setting-item">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-label">Enable ListenBrainz</span>
              <p class="setting-hint">
                Submit your listening history and receive personalised
                recommendations. Requires a free
                <a
                  href="https://listenbrainz.org"
                  target="_blank"
                  rel="noreferrer">ListenBrainz</a
                >
                account.
              </p>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.listenBrainzEnabled}
              on:click={() => appSettings.toggleListenBrainz()}
              role="switch"
              aria-checked={$appSettings.listenBrainzEnabled}
              aria-label="Toggle ListenBrainz"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <!-- Token management -->
        {#if !$appSettings.listenBrainzTokenSet}
          <div class="setting-item">
            <span class="setting-label">User Token</span>
            <div class="path-selector">
              <input
                type="password"
                bind:value={lbTokenInput}
                placeholder="Paste your ListenBrainz token"
                class="lb-token-input"
                on:keydown={(e) => e.key === "Enter" && handleVerifyLbToken()}
              />
              <button
                class="selector-btn"
                on:click={handleVerifyLbToken}
                disabled={!lbTokenInput.trim() || lbIsVerifying}
              >
                {lbIsVerifying ? "Verifying…" : "Verify & Save"}
              </button>
            </div>
            <p class="setting-hint">
              Find your token at
              <a
                href="https://listenbrainz.org/settings/"
                target="_blank"
                rel="noreferrer">listenbrainz.org/settings</a
              >.
            </p>
            {#if lbVerifyError}
              <p class="setting-hint" style="color: var(--text-error);">
                ✗ {lbVerifyError}
              </p>
            {/if}
            {#if lbVerifySuccess}
              <p class="setting-hint" style="color: var(--accent-primary);">
                ✓ Token verified and saved!
              </p>
            {/if}
          </div>
        {:else}
          <div class="setting-item">
            <div class="danger-item">
              <div class="danger-info">
                <span class="setting-label">Token Stored</span>
                <p class="setting-hint">
                  {#if $appSettings.listenBrainzUsername}
                    Signed in as <strong
                      >{$appSettings.listenBrainzUsername}</strong
                    >.
                  {:else}
                    A token is saved. Enable the toggle above to start
                    scrobbling.
                  {/if}
                </p>
              </div>
              <button
                class="selector-btn danger-btn"
                on:click={handleRemoveLbToken}
                aria-label="Remove ListenBrainz token"
              >
                Remove Token
              </button>
            </div>
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

  /* Support links (Discord / Ko-fi) */
  .support-links {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .support-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    transition:
      opacity var(--transition-fast),
      transform var(--transition-fast);
    flex: 1;
    justify-content: center;
    min-width: 120px;
  }

  .support-btn:active {
    transform: scale(0.96);
  }

  .discord-btn {
    background-color: #5865f2;
    color: #fff;
  }

  .discord-btn:hover {
    opacity: 0.9;
  }

  .kofi-btn {
    background-color: #ff5e5b;
    color: #fff;
  }

  .kofi-btn:hover {
    opacity: 0.9;
  }

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

  @media (max-width: 768px) {
    .path-selector {
      display: flex;
      gap: var(--spacing-sm);
      flex-direction: column;
    }
  }

  .path-selector {
    display: flex;
    gap: var(--spacing-sm);
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
    gap: var(--spacing-md);
    flex-direction: column;
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

  /* Account section */
  .account-card {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
    background-color: var(--bg-surface);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }

  .account-profile {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    width: 100%;
  }

  .avatar {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    object-fit: cover;
    flex-shrink: 0;
    border: 2px solid var(--border-color);
  }

  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-primary);
    color: #fff;
    font-weight: 700;
    font-size: 1.25rem;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
  }

  .account-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .account-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 1rem;
  }

  .account-email {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .logout-btn {
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .logout-btn:hover {
    color: var(--error-color);
    border-color: var(--error-color);
    background-color: rgba(220, 53, 69, 0.05);
  }

  .account-signin {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    align-items: flex-start;
  }

  .sync-status-area {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    gap: var(--spacing-md);
  }

  .sync-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .sync-info .setting-label {
    margin-bottom: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sync-info .setting-value {
    font-size: 0.9375rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .sync-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  .spinner {
    animation: rotate 2s linear infinite;
  }

  @keyframes rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .text-error {
    color: #dc3545;
    font-size: 0.8125rem;
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
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23b3b3b3' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--spacing-sm) center;
    padding-right: calc(var(--spacing-md) + 16px);
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

  .notice-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--accent-primary);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .refresh-notice {
    background-color: rgba(var(--accent-primary-rgb, 30, 215, 96), 0.1);
    border: 1px solid rgba(var(--accent-primary-rgb, 30, 215, 96), 0.3);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--spacing-md);
    animation: fadeIn 0.3s ease;
  }

  .refresh-btn {
    background-color: var(--accent-primary);
    color: #000;
    border: none;
    font-weight: 600;
    padding: var(--spacing-xs) var(--spacing-md);
    cursor: pointer;
    transition:
      transform 0.2s ease,
      background-color 0.2s ease;
  }

  .refresh-btn:hover {
    background-color: var(--accent-hover);
    transform: scale(1.05);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* MOBILE-SPECIFIC ENHANCEMENTS */
  @media (max-width: 768px) {
    /* Layout Spacing Adjustments */
    .view-header {
      padding: var(--spacing-md) var(--spacing-sm);
    }

    .view-header h1 {
      padding-left: var(--spacing-sm);
    }

    .settings-container {
      padding: 0 var(--spacing-sm);
    }

    .settings-section {
      margin-bottom: var(--spacing-md);
      padding: var(--spacing-md);
      border-radius: var(--radius-md);
    }

    .section-title {
      margin-bottom: var(--spacing-md);
      padding-bottom: var(--spacing-xs);
    }

    .setting-item {
      margin-bottom: var(--spacing-md);
    }

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
