<script lang="ts">
  import { theme, presetAccents, type ThemeMode } from "$lib/stores/theme";
  import { appSettings } from "$lib/stores/settings";
  import { equalizer, EQ_PRESETS } from "$lib/stores/equalizer";
  import { _, locale } from "svelte-i18n";
  import { updates } from "$lib/stores/updates";
  import {
    resetDatabase,
    selectMusicFolder,
    pickAndroidFolder,
    addFolder,
    syncCoverPathsFromFiles,
    mergeDuplicateCovers,
    rescanMusic,
    setListenbrainzToken,
    deleteListenbrainzToken,
    verifyListenbrainzToken,
    isAndroid,
    type MergeCoverResult,
  } from "$lib/api/tauri";
  import { trackCount, playlists, loadLibrary } from "$lib/stores/library";
  import UpdatePopup from "./UpdatePopup.svelte";
  import { confirm } from "$lib/stores/dialogs";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import {
    authState,
    syncStatus,
    isLoggedIn,
    isSupporter,
    isSyncing,
    showLoginModal,
    logout,
    triggerSync,
    deleteAccount,
  } from "$lib/stores/sync";
  import { nativeAudioStop } from "$lib/services/native-audio";

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

  // Android single music folder state
  let isUpdatingAndroidMusicFolder = false;
  let androidMusicFolderMessage = "";
  let androidMusicFolderSuccess = false;

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

  function changeLanguage(lang: string) {
    $locale = lang;
    localStorage.setItem("audion_language", lang);
  }

  function handleCustomColorAdd() {
    if (customColorInput && /^#[0-9A-Fa-f]{6}$/.test(customColorInput)) {
      theme.addCustomColor(customColorInput);
      theme.setAccentColor(customColorInput);
    }
  }

  function formatEqGain(gain: number): string {
    const rounded = Math.round(gain * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
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
        const path = await pickAndroidFolder();
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

  async function handleSetAndroidMusicFolder() {
    try {
      androidMusicFolderMessage = "";
      androidMusicFolderSuccess = false;

      const path = await pickAndroidFolder();
      if (!path) return;

      if (path.startsWith("content://")) {
        androidMusicFolderSuccess = false;
        androidMusicFolderMessage =
          "Folder URI is not supported yet. Please pick a local Music folder path.";
        return;
      }

      isUpdatingAndroidMusicFolder = true;

      await addFolder(path);
      appSettings.setAndroidMusicFolder(path);

      const result = await rescanMusic();
      await loadLibrary();

      const parts = [];
      if (result.tracks_added > 0) parts.push(`${result.tracks_added} added`);
      if (result.tracks_updated > 0)
        parts.push(`${result.tracks_updated} updated`);
      if (result.tracks_deleted > 0)
        parts.push(`${result.tracks_deleted} deleted`);

      androidMusicFolderSuccess = true;
      androidMusicFolderMessage =
        parts.length > 0
          ? `Music folder added: ${parts.join(", ")}`
          : "Music folder added. No library changes detected.";
    } catch (error) {
      androidMusicFolderSuccess = false;
      androidMusicFolderMessage = `Failed to add music folder: ${error}`;
      console.error("Failed to add Android music folder:", error);
    } finally {
      isUpdatingAndroidMusicFolder = false;

      setTimeout(() => {
        androidMusicFolderMessage = "";
      }, 5000);
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

      if (diffSec < 60) return "just now";
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

  // Alias for readability in template
  const formatLastSyncedRelative = formatLastSynced;

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

  function formatSupporterUntil(ts: number | null): string {
    if (ts === null) return "Active (subscription)";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatSyncError(error: string | null): string {
    if (!error) return "";

    // Check if it's a JSON error from the server (often wrapped in Request failed message)
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

    // Fallback cleanup: remove the "Request failed: 403 Forbidden — " prefix if present
    return error.replace(/Request failed: \d+ [^—]+ — /, "");
  }

  // Tier limits logic
  $: libraryProgress = Math.min(($trackCount / 100) * 100, 100);
  $: playlistProgress = Math.min(($playlists.length / 3) * 100, 100);

  // Account display fallbacks (for users without profile name/avatar)
  $: accountDisplayName =
    $authState.name?.trim() ||
    ($authState.email ? $authState.email.split("@")[0] : "User");
  $: accountEmail = $authState.email || "No email";
  $: accountInitial = (accountDisplayName || "U").charAt(0).toUpperCase();
</script>

<div class="settings-view">
  <header class="view-header">
    <h1>{$_('settings.title', { default: 'Settings' })}</h1>
  </header>

  <div class="settings-content">
    <div class="settings-container">
      <!-- Section: Support -->
      <section class="settings-section" aria-labelledby="support-heading">
        <h2 id="support-heading" class="section-label">{$_('settings.support', { default: 'Support' })}</h2>
        <div class="settings-card support-card-premium">
          <div class="support-content">
            <div class="support-text">
              <h3 class="support-title">{$_('settings.supportAudion', { default: 'Support Audion' })}</h3>
              <p class="support-description">{$_('settings.supportDesc', { default: 'Help keep development active and unlock unlimited sync features.' })}</p>
            </div>
            <div class="support-icon-large">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                 <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
               </svg>
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
              <span class="platform-tag">One-time / Monthly</span>
            </a>
            <a
              href="https://www.patreon.com/AudionPlayer"
              target="_blank"
              rel="noreferrer"
              class="support-platform-card patreon"
            >
              <span class="platform-name">Patreon</span>
              <span class="platform-tag">Membership</span>
            </a>
          </div>
        </div>
      </section>

      <!-- Section: Account -->
      <section class="settings-section" aria-labelledby="account-heading">
        <h2 id="account-heading" class="section-label">{$_('settings.account', { default: 'Account' })}</h2>
        <div class="settings-card">
          {#if $isLoggedIn}
            <div class="account-profile-row">
              {#if $authState.avatar_url}
                <img
                  src={$authState.avatar_url}
                  alt="Profile"
                  class="avatar"
                  referrerpolicy="no-referrer"
                  crossorigin="anonymous"
                />
              {:else}
                <div class="avatar avatar-placeholder">
                  {accountInitial}
                </div>
              {/if}
              <div class="account-details">
                <span class="setting-title">{accountDisplayName}</span>
                <span class="setting-description">{accountEmail}</span>
                <span class="setting-description">
                  {#if $isSupporter}
                    {$_('settings.supporterUntil', { default: 'Supporter access until' })}
                    {#if $authState.supporter_until}
                      {formatSupporterUntil($authState.supporter_until)}
                    {:else}
                      {$_('settings.activeSubscription', { default: 'Active (subscription)' })}
                    {/if}
                  {:else}
                    {$_('settings.freePlan', { default: 'Free plan' })}
                  {/if}
                </span>
              </div>
              <button
                class="btn-outline-compact"
                on:click={async () => {
                  const ok = await confirm(
                    "Are you sure you want to log out? Unsynced changes will be lost.",
                    { title: $_('settings.logout', { default: 'Log Out' }) },
                  );
                  if (ok) logout();
                }}
                aria-label={$_('settings.logout', { default: 'Log out' })}
              >
                {$_('settings.logout', { default: 'Log out' })}
              </button>
            </div>
          {:else}
            <div class="account-signin">
              <span class="setting-description">
                {$_('settings.signInToSync', { default: 'Sign in to sync your library and settings across devices' })}
              </span>
              <button
                class="btn-outline-compact btn-full-width"
                style="margin-top: var(--spacing-sm)"
                on:click={() => showLoginModal.set(true)}
                aria-label={$_('settings.signIn', { default: 'Sign In' })}
              >
                {$_('settings.signIn', { default: 'Sign In' })}
              </button>
            </div>
          {/if}
        </div>
      </section>

      <!-- Section: Sync -->
      {#if $isLoggedIn}
        <section class="settings-section" aria-labelledby="sync-heading">
          <h2 id="sync-heading" class="section-label">{$_('settings.sync', { default: 'Sync' })}</h2>
          <div class="settings-card">
            <div class="card-header-row">
              <div class="card-title-group">
                <h3 class="setting-title">{$_('settings.libraryStatus', { default: 'Library status' })}</h3>
                <span class="setting-description" aria-live="polite">
                  {#if $isSyncing}
                    <span class="animate-pulse">{$_('settings.syncingTracks', { default: 'Syncing tracks...' })}</span>
                  {:else}
                    {$_('settings.synced', { default: 'Synced' })} {formatLastSyncedRelative($syncStatus.last_sync_at)}
                    {#if $syncStatus.pending_changes > 0}
                      · {$syncStatus.pending_changes} {$_('settings.pending', { default: 'pending' })}
                    {/if}
                  {/if}
                </span>
              </div>
              <div class="pill-badge">{$_('settings.autoEvery12h', { default: 'Auto every 12h' })}</div>
            </div>

            <button
              class="btn-outline-compact btn-full-width"
              style="margin-top: var(--spacing-md);"
              on:click={() => triggerSync()}
              disabled={$isSyncing}
              aria-label={$_('settings.syncNow', { default: 'Sync now' })}
            >
              {$isSyncing ? $_('settings.syncing', { default: 'Syncing...' }) : $_('settings.syncNow', { default: 'Sync now' })}
            </button>

            <div class="divider"></div>
            <div class="tier-limits" role="group" aria-label="Usage Limits">
              <div class="tier-limit-item">
                <div class="limit-header">
                  <span id="limit-label-music" class="setting-title" style="font-size: 11px; opacity: 0.8">Tracks</span>
                  <span class="setting-title" style="font-size: 11px; opacity: 0.8">{$trackCount} / 100</span>
                </div>
                <div class="limit-bar-thick-wrap" role="progressbar" aria-valuenow={$trackCount} aria-valuemin="0" aria-valuemax="100" aria-labelledby="limit-label-music">
                  <div class="limit-bar-thick" style="width: {libraryProgress}%"></div>
                </div>
              </div>
              
              <div class="tier-limit-item">
                <div class="limit-header">
                  <span id="limit-label-playlists" class="setting-title" style="font-size: 11px; opacity: 0.8">Playlists</span>
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
                        {$_('settings.limitExceeded', { default: 'Sync limit exceeded' })}
                      {:else}
                        {formatSyncError($syncStatus.last_error)}
                      {/if}
                    </span>
                    {#if $syncStatus.last_error.includes("Limit Exceeded") || $syncStatus.last_error.includes("limit exceeded")}
                      <p class="error-hint">
                        {$_('settings.limitExceededDesc', { default: "You've reached the free tier limit of 100 tracks. Support development to get unlimited sync!" })}
                        <br />
                        <a href="https://ko-fi.com/N4N5UMNR1" target="_blank" rel="noreferrer" class="donate-link">
                          {$_('settings.supportAudion', { default: 'Support Audion' })}
                        </a>
                      </p>
                    {/if}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Section: Playback -->
      <section class="settings-section" aria-labelledby="playback-heading">
        <h2 id="playback-heading" class="section-label">{$_('settings.playback', { default: 'Playback' })}</h2>
        <div class="settings-card">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.autoplay', { default: 'Autoplay' })}</span>
              <span class="setting-description">{$_('settings.autoplayDesc', { default: 'Play random tracks when the queue ends' })}</span>
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
      </section>

      <!-- Section: Storage -->
      <section class="settings-section" aria-labelledby="storage-heading">
        <h2 id="storage-heading" class="section-label">{$_('settings.storage', { default: 'Storage' })}</h2>
        <div class="settings-card">
          <div class="inner-section">
            <span class="setting-title">{$_('settings.downloadLocation', { default: 'Download location' })}</span>
            <div class="path-selector">
              <div class="setting-description path-display" style="margin-top: 0;" title={$appSettings.downloadLocation || $_('settings.noDownloadLocation', { default: 'Not set' })}>
                {$appSettings.downloadLocation || $_('settings.noDownloadLocation', { default: 'No download location set' })}
              </div>
              <button class="selector-btn" on:click={handleSetDownloadLocation} aria-label={$_('settings.change', { default: 'Change location' })}>{$_('settings.change', { default: 'Change' })}</button>
            </div>
          </div>

          {#if isAndroid()}
            <div class="divider"></div>

            <div class="inner-section">
              <span class="setting-title">{$_('settings.musicLibraryFolder', { default: 'Music library folder (Android)' })}</span>
              <span class="setting-description">{$_('settings.musicLibraryFolderDesc', { default: 'Add folders to your library scan while avoiding system audio clips' })}</span>
              <div class="path-selector">
                <div class="setting-description path-display" style="margin-top: 0;" title={$appSettings.androidMusicFolder || $_('settings.noMusicFolder', { default: 'Not set' })}>
                  {$appSettings.androidMusicFolder || $_('settings.noMusicFolder', { default: 'No music folder selected' })}
                </div>
                <button
                  class="selector-btn"
                  on:click={handleSetAndroidMusicFolder}
                  aria-label={$_('settings.addFolder', { default: 'Add folder' })}
                  disabled={isUpdatingAndroidMusicFolder}
                >
                  {isUpdatingAndroidMusicFolder ? $_('settings.adding', { default: 'Adding...' }) : $_('settings.addFolder', { default: 'Add folder' })}
                </button>
              </div>

              {#if androidMusicFolderMessage}
                <div class="sync-message {androidMusicFolderSuccess ? 'success' : 'error'}">
                  {androidMusicFolderMessage}
                </div>
              {/if}
            </div>
          {/if}

          <div class="divider"></div>

          <div class="card-title-group compact">
            <h3 class="setting-title">{$_('settings.coverManagement', { default: 'Cover Management' })}</h3>
            <span class="setting-description">{$_('settings.coverManagementDesc', { default: 'Sync or merge cover files to save space' })}</span>
          </div>

          <div class="button-group-row">
            <button class="btn-outline-compact" on:click={handleSyncCovers} disabled={isSyncingCovers}>
              {isSyncingCovers ? $_('settings.syncing', { default: 'Syncing...' }) : $_('settings.syncCovers', { default: 'Sync Covers' })}
            </button>
            <button class="btn-outline-compact" on:click={handleMergeDuplicateCovers} disabled={isMergingCovers}>
              {isMergingCovers ? $_('settings.merging', { default: 'Merging...' }) : $_('settings.mergeDuplicates', { default: 'Merge Duplicates' })}
            </button>
          </div>

          {#if isSyncingCovers || isMergingCovers}
             <div class="divider"></div>
             <div class="progress-notice-inline">
               <span class="setting-description animate-pulse">{$_('settings.processingCovers', { default: 'Processing covers... view details below for progress' })}</span>
             </div>
          {/if}
        </div>
      </section>

      <!-- Section: Audio -->
      <section class="settings-section" aria-labelledby="audio-heading">
        <h2 id="audio-heading" class="section-label">{$_('settings.audio', { default: 'Audio' })}</h2>
        <div class="settings-card">
          <div class="inner-section">
            <span class="setting-title">{$_('settings.outputDriver', { default: 'Output driver' })}</span>
            <span class="setting-description">{$_('settings.outputDriverDesc', { default: 'Select the backend for audio playback' })}</span>
            <div class="segmented-pill" style="margin-top: 6px;">
              <button class="segment-btn" class:active={$appSettings.audioBackend === 'auto'} on:click={() => appSettings.setAudioBackend('auto')}>{$_('settings.auto', { default: 'Auto' })}</button>
              <button class="segment-btn" class:active={$appSettings.audioBackend === 'native'} on:click={() => appSettings.setAudioBackend('native')}>{$_('settings.native', { default: 'Native' })}</button>
              <button class="segment-btn" class:active={$appSettings.audioBackend === 'html5'} on:click={() => appSettings.setAudioBackend('html5')}>{$_('settings.html5', { default: 'HTML5' })}</button>
            </div>
            {#if showRefreshNotice}
              <div class="refresh-notice-inline">
                <span class="setting-description" style="color: var(--accent-primary)">{$_('settings.requiresRestart', { default: 'Requires restart to apply' })}</span>
                <button class="btn-text-small" style="padding-left: 0" on:click={handleRefresh}>{$_('settings.restartNow', { default: 'Restart now' })}</button>
              </div>
            {/if}
          </div>

          <div class="divider"></div>

          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.equalizer', { default: 'Equalizer' })}</span>
              <span class="setting-description">{$_('settings.equalizerDesc', { default: 'Adjust frequency levels across multiple bands' })}</span>
              <span class="setting-description" style="color: var(--accent-warning, #ffae42);">
                {$_('settings.equalizerLocalOnlyWarning', { default: 'Equalizer is most reliable on local playback (especially with Native driver). Some streaming sources may bypass EQ.' })}
              </span>
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

          {#if $equalizer.enabled}
            <div class="divider"></div>
            <div class="eq-control-compact">
              <select class="preset-select-pill" value={$equalizer.currentPreset || ""} on:change={(e) => equalizer.applyPreset((e.currentTarget as HTMLSelectElement).value)}>
                <option value="" disabled>{$_('settings.customPreset', { default: 'Custom Preset' })}</option>
                {#each EQ_PRESETS as preset}
                  <option value={preset.name}>{preset.name}</option>
                {/each}
              </select>
              <button class="btn-text-small" on:click={() => equalizer.reset()}>{$_('settings.resetToFlat', { default: 'Reset to Flat' })}</button>
            </div>

            <div class="eq-bands-container">
              <div class="eq-scale" aria-hidden="true">
                <span>+12</span>
                <span>0</span>
                <span>-12</span>
              </div>

              <div class="eq-bands">
                {#each $equalizer.bands as band, i}
                  <div class="eq-band">
                    <span class="eq-gain">{formatEqGain(band.gain)}</span>
                    <div class="eq-slider-container">
                      <input
                        class="eq-slider"
                        type="range"
                        min="-12"
                        max="12"
                        step="0.5"
                        value={band.gain}
                        aria-label={`EQ ${band.label}`}
                        on:input={(e) => equalizer.setBandGain(i, Number((e.currentTarget as HTMLInputElement).value))}
                      />
                    </div>
                    <span class="eq-label">{band.label}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </section>

      <!-- Section: Community -->
      <section class="settings-section" aria-labelledby="community-heading">
        <h2 id="community-heading" class="section-label">{$_('settings.community', { default: 'Community' })}</h2>
        <div class="settings-card">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.listenBrainz', { default: 'ListenBrainz' })}</span>
              <span class="setting-description">{$_('settings.listenBrainzDesc', { default: 'Submit listening history to ListenBrainz' })}</span>
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

          {#if $appSettings.listenBrainzEnabled}
            <div class="divider"></div>
            <div class="inner-section">
              {#if !$appSettings.listenBrainzTokenSet}
                <div class="lb-token-row" style="display: flex; gap: var(--spacing-sm);">
                  <input
                    type="password"
                    bind:value={lbTokenInput}
                    placeholder={$_('settings.userToken', { default: 'User Token' })}
                    class="input-compact"
                    style="flex: 1; min-width: 0;"
                  />
                  <button class="btn-outline-compact" on:click={handleVerifyLbToken} disabled={lbIsVerifying}>
                    {lbIsVerifying ? "..." : $_('settings.verify', { default: 'Verify' })}
                  </button>
                </div>
                {#if lbVerifyError}<p class="text-error" style="font-size: 0.7rem; margin-top: 4px;">{lbVerifyError}</p>{/if}
              {:else}
                <div class="lb-status-row" style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8125rem;">{$_('settings.loggedInAs', { default: 'Logged in as' })} <strong>{$appSettings.listenBrainzUsername || 'User'}</strong></span>
                  <button class="btn-text-small" on:click={handleRemoveLbToken}>{$_('settings.remove', { default: 'Remove' })}</button>
                </div>
              {/if}
            </div>
          {/if}

          <div class="divider"></div>

          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.discordButton', { default: 'Discord button' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.showDiscord}
              on:click={() => appSettings.setShowDiscord(!$appSettings.showDiscord)}
              role="switch"
              aria-checked={$appSettings.showDiscord}
              aria-label="Toggle Discord Button"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
          
          <div class="button-group-row" style="margin-top: var(--spacing-sm)">
            <a href="https://discord.gg/27XRVQsBd9" target="_blank" rel="noreferrer" class="btn-outline-compact" style="width: 100%; text-align: center;">{$_('settings.openDiscord', { default: 'Open Discord' })}</a>
          </div>
        </div>
      </section>

      <!-- Section: Appearance -->
      <section class="settings-section" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" class="section-label">{$_('settings.language', { default: 'Appearance' })}</h2>
        <div class="settings-card">
           <div class="inner-section">
             <span class="setting-title">{$_('settings.selectLanguage', { default: 'Language' })}</span>
             <div class="segmented-pill" style="margin-top: 6px;">
               <button class="segment-btn" class:active={$locale === 'en'} on:click={() => changeLanguage('en')}>English</button>
               <button class="segment-btn" class:active={$locale === 'es'} on:click={() => changeLanguage('es')}>Español</button>
               <button class="segment-btn" class:active={$locale === 'fr'} on:click={() => changeLanguage('fr')}>Français</button>
             </div>
           </div>

           <div class="divider"></div>

           <div class="inner-section">
             <span class="setting-title">{$_('settings.themeMode', { default: 'Theme mode' })}</span>
             <div class="segmented-pill" style="margin-top: 6px;">
               <button class="segment-btn" class:active={$theme.mode === 'dark'} on:click={() => handleModeChange('dark')}>{$_('settings.dark', { default: 'Dark' })}</button>
               <button class="segment-btn" class:active={$theme.mode === 'light'} on:click={() => handleModeChange('light')}>{$_('settings.light', { default: 'Light' })}</button>
               <button class="segment-btn" class:active={$theme.mode === 'system'} on:click={() => handleModeChange('system')}>{$_('settings.system', { default: 'System' })}</button>
             </div>
           </div>

           {#if !isAndroid()}
             <div class="divider"></div>
             <div class="inner-section">
               <span class="setting-title">{$_('settings.windowStartMode', { default: 'Window start mode' })}</span>
               <div class="segmented-pill">
                 <button class="segment-btn" class:active={$appSettings.startMode === 'normal'} on:click={() => appSettings.setStartMode('normal')}>{$_('settings.normal', { default: 'Normal' })}</button>
                 <button class="segment-btn" class:active={$appSettings.startMode === 'maximized'} on:click={() => appSettings.setStartMode('maximized')}>{$_('settings.max', { default: 'Max' })}</button>
                 <button class="segment-btn" class:active={$appSettings.startMode === 'minimized'} on:click={() => appSettings.setStartMode('minimized')}>{$_('settings.min', { default: 'Min' })}</button>
               </div>
             </div>



             <div class="divider"></div>
             <div class="toggle-container">
               <div class="toggle-info">
                 <span class="setting-title">{$_('settings.closeToTray', { default: 'Close to tray' })}</span>
                 <span class="setting-description">{$_('settings.closeToTrayDesc', { default: 'Hide the window to the system tray when closed' })}</span>
               </div>
               <button
                 class="toggle-btn"
                 class:active={$appSettings.closeToTray}
                 on:click={() => appSettings.setCloseToTray(!$appSettings.closeToTray)}
                 role="switch"
                 aria-checked={$appSettings.closeToTray}
                 aria-label="Toggle Close to Tray"
               >
                 <div class="toggle-handle"></div>
               </button>
             </div>
           {/if}

           <div class="divider"></div>

           <div class="inner-section">
             <span class="setting-title">Accent color</span>
             <div class="color-grid-compact" style="margin-top: 6px;">
               {#each presetAccents as preset}
                 <button
                   class="color-swatch-sm"
                   class:active={$theme.accentColor === preset.color}
                   style="background-color: {preset.color}"
                   on:click={() => handleAccentChange(preset.color)}
                   title={preset.name}
                 ></button>
               {/each}
             </div>
           </div>
        </div>
      </section>

      <!-- Section: Privacy -->
      <section class="settings-section" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" class="section-label">{$_('settings.privacy', { default: 'Privacy' })}</h2>
        <div class="settings-card">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.remoteControl', { default: 'Remote control' })}</span>
              <span class="setting-description">{$_('settings.remoteControlDesc', { default: 'Other devices can discover and control this app' })}</span>
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
              <span class="setting-title">{$_('settings.developerMode', { default: 'Developer mode' })}</span>
              <span class="setting-description">{$_('settings.developerModeDesc', { default: 'Enable inspection tools and debug menus' })}</span>
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
            <h3 class="setting-title" style="color: var(--error-color)">{$_('settings.dangerZone', { default: 'Danger zone' })}</h3>
            <span class="setting-description">{$_('settings.dangerZoneDesc', { default: 'Irreversible actions like resetting data' })}</span>
          </div>

          <div class="button-group-row">
            <button class="btn-outline-compact danger" on:click={openResetModal}>{$_('settings.resetDatabase', { default: 'Reset Database' })}</button>
            {#if $isLoggedIn}
              <button class="btn-outline-compact danger" on:click={async () => {
                const ok = await confirm($_('settings.deleteAccount', { default: 'Delete account permanently?' }), { title: $_('settings.deleteAccount', { default: 'Delete Account' }), danger: true });
                if (ok) await deleteAccount();
              }}>{$_('settings.deleteAccount', { default: 'Delete Account' })}</button>
            {/if}
          </div>
        </div>
      </section>

      <!-- Section: Upgrade -->
      <section class="settings-section" aria-labelledby="upgrade-heading">
        <h2 id="upgrade-heading" class="section-label">{$_('settings.upgrade', { default: 'Upgrade' })}</h2>
        <div class="settings-card upgrade-card">
          {#if !$isSupporter}
            <div class="card-header-row">
              <div class="card-title-group">
                <h3 class="setting-title">{$_('settings.unlimitedSync', { default: 'Unlimited sync' })}</h3>
                <span class="setting-description">{$_('settings.unlimitedSyncDesc', { default: 'Support development and sync unlimited tracks' })}</span>
              </div>
              <div class="pill-badge accent">Support</div>
            </div>
            <a href="https://ko-fi.com/N4N5UMNR1" target="_blank" rel="noreferrer" class="btn-primary-compact" style="margin-top: var(--spacing-sm); text-align: center;">Support on Ko-fi</a>
          {:else}
            <div class="card-header-row">
              <div class="card-title-group">
                <h3 class="setting-title">{$_('settings.supporterStatus', { default: 'Supporter status' })}</h3>
                <span class="setting-description">{$_('settings.proBenefitsActive', { default: 'Pro benefits are active' })}</span>
              </div>
              <div class="pill-badge accent">Pro</div>
            </div>
            <p class="notice-text-sm" style="margin-top: var(--spacing-sm)">
              {#if $authState.supporter_until}
                {$_('settings.validUntil', { default: 'Valid until' })} {formatSupporterUntil($authState.supporter_until)}
              {:else}
                {$_('settings.activePerpetual', { default: 'Active perpetual support' })}
              {/if}
            </p>
          {/if}
        </div>
      </section>

      <!-- Section: About -->
      <section class="settings-section" aria-labelledby="about-heading">
        <h2 id="about-heading" class="section-label">{$_('settings.about', { default: 'About' })}</h2>
        <div class="settings-card">
          <div class="about-row">
            <div class="app-logo-sm">Audion</div>
            <div class="about-details">
              <span class="setting-title">Audion {__APP_VERSION__}</span>
              <span class="setting-description">{$_('settings.modernPlayerDesc', { default: 'Modern player powered by Tauri and Svelte' })}</span>
            </div>
          </div>
          {#if $updates.hasUpdate}
            <button class="btn-green-compact" on:click={() => (showUpdatePopup = true)} style="margin-top: var(--spacing-sm)">{$_('settings.updateAvailable', { default: 'Update Available' })}</button>
          {/if}
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
    padding: calc(var(--safe-area-top) + var(--spacing-lg)) var(--spacing-md)
      var(--spacing-md);
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
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-subdued);
    margin-bottom: var(--spacing-sm);
    padding-left: var(--spacing-xs);
    opacity: 0.8;
  }

  .setting-item {
    margin-bottom: var(--spacing-lg);
  }

  .setting-item:last-child {
    margin-bottom: 0;
  }

  .setting-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.2;
    display: block;
  }

  .setting-description {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.4;
    margin-top: 2px;
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

  .inner-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .divider {
    height: 1px;
    background-color: var(--border-color);
    margin: var(--spacing-xs) 0;
    opacity: 0.5;
  }

  /* Segmented Pill Control */
  .segmented-pill {
    display: flex;
    background-color: var(--bg-highlight);
    padding: 4px;
    border-radius: var(--radius-full);
    gap: 2px;
    border: 1px solid var(--border-color);
  }

  .segment-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: var(--radius-xl);
    transition: all var(--transition-fast);
    background: transparent;
    border: none;
    cursor: pointer;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .segment-btn:hover:not(.active) {
    background-color: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }

  .segment-btn.active {
    background-color: var(--bg-surface);
    color: var(--accent-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  /* Compact Action Buttons */
  .button-group-row {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .support-links-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .btn-text-small {
    background: none;
    border: none;
    color: var(--text-subdued);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 8px;
    cursor: pointer;
    transition: color 0.2s;
    text-decoration: underline;
  }

  .btn-text-small:hover {
    color: var(--accent-primary);
  }

  .btn-primary-compact {
    background-color: var(--accent-primary);
    color: #000;
    padding: 10px 20px;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 700;
    text-decoration: none;
    display: inline-block;
    transition: transform 0.2s, background-color 0.2s;
  }

  .btn-primary-compact:hover {
    background-color: var(--accent-hover);
    transform: scale(1.02);
  }

  .btn-support-compact {
    width: 100%;
    text-align: center;
  }

  .support-card-premium {
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent-primary), transparent 85%) 0%, color-mix(in srgb, var(--accent-primary), transparent 95%) 100%);
    border: 1px solid color-mix(in srgb, var(--accent-primary), transparent 80%) !important;
    position: relative;
    overflow: hidden;
    padding: var(--spacing-lg) !important;
  }

  .support-card-premium::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent-primary), transparent 90%) 0%, transparent 70%);
    pointer-events: none;
  }

  .support-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .support-text {
    flex: 1;
  }

  .support-title {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--text-primary);
    margin: 0 0 4px 0;
    letter-spacing: -0.01em;
  }

  .support-description {
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .support-icon-large {
    width: 42px;
    height: 42px;
    color: var(--accent-primary);
    opacity: 0.8;
    flex-shrink: 0;
  }

  .support-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-md);
  }

  .support-platform-card {
    display: flex;
    flex-direction: column;
    padding: var(--spacing-md);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    min-height: 0 !important; /* Reset touch target min-height for cards */
  }

  .support-platform-card:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--accent-primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    text-decoration: none;
  }

  .platform-name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .platform-tag {
    font-size: 0.75rem;
    color: var(--text-subdued);
    margin-top: 2px;
  }

  .support-platform-card.kofi:hover .platform-name {
    color: #29abe0;
  }

  .support-platform-card.patreon:hover .platform-name {
    color: #f96854;
  }

  @media (max-width: 520px) {
    .support-grid {
      grid-template-columns: 1fr;
    }
    
    .support-content {
      flex-direction: row;
      align-items: flex-start;
    }
  }

  .btn-outline-compact.danger {
    color: var(--error-color);
    border-color: rgba(220, 53, 69, 0.3);
  }

  .btn-outline-compact.danger:hover {
    background-color: rgba(220, 53, 69, 0.1);
    border-color: var(--error-color);
  }

  /* Color Grid Refinement */
  .color-grid-compact {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 0;
  }

  .color-swatch-sm {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    cursor: pointer;
    border: 2px solid transparent;
    transition: transform 0.2s, border-color 0.2s;
    padding: 0;
  }

  .color-swatch-sm:hover {
    transform: scale(1.2);
  }

  .color-swatch-sm.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--bg-surface);
  }

  /* About Section */
  .about-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .app-logo-sm {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--accent-primary);
    letter-spacing: -0.02em;
  }

  .about-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .notice-text-sm {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  /* Path Selector Minimal */
  .path-selector {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    width: 100%;
  }

  .path-display {
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 8px 0;
    font-family: monospace;
    opacity: 0.8;
  }

  .selector-btn {
    background: none;
    border: none;
    color: var(--accent-primary);
    font-size: 0.8125rem;
    font-weight: 700;
    cursor: pointer;
    padding: 8px;
    text-decoration: underline;
  }
  .settings-card {
    background-color: var(--bg-surface);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  .upgrade-card {
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent-primary), transparent 92%) 0%, color-mix(in srgb, var(--accent-primary), transparent 97%) 100%);
    border-color: color-mix(in srgb, var(--accent-primary), transparent 80%);
  }

  .card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .card-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .pill-badge {
    padding: 4px 10px;
    border-radius: var(--radius-full);
    font-size: 0.75rem;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .pill-badge.accent {
    background: color-mix(in srgb, var(--accent-primary), transparent 90%);
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary), transparent 80%);
  }

  .btn-outline-compact {
    padding: 8px 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    transition: all var(--transition-fast);
    background: transparent;
  }

  .btn-outline-compact:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--text-secondary);
  }

  .btn-full-width {
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  /* Account Card Specifics */
  .account-profile-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    width: 100%;
  }

  .account-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .account-email-sm {
    font-size: 0.875rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .avatar {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background-color: var(--bg-highlight);
    border: 1px solid var(--border-color);
  }

  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent-primary);
  }

  /* Info Notice Box */
  .info-notice-compact {
    padding: var(--spacing-sm) 0;
    display: flex;
    gap: var(--spacing-sm);
    align-items: flex-start;
  }

  .notice-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background-color: var(--accent-warning, #ffae42);
    margin-top: 5px;
    flex-shrink: 0;
  }

  .notice-text {
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-secondary);
  }

  /* Enhanced Progress Bars */
  .tier-limit-item {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .limit-bar-thick-wrap {
    height: 8px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
  }

  .limit-bar-thick {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 4px;
    transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .kofi-not-supporter {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    margin-top: var(--spacing-sm);
  }

  .kofi-support-link {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    width: fit-content;
    text-decoration: none;
    font-size: 0.875rem;
  }

  /* ─── Supporter Benefits & Limits Styles ─── */

  .badge-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .badge-text {
    display: flex;
    flex-direction: column;
  }

  .status-unlocked {
    font-weight: 700;
    font-size: 0.9375rem;
  }

  .supporter-benefits-mini {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .benefits-title,
  .upsell-title {
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--spacing-sm);
    color: var(--text-secondary);
  }

  .supporter-benefits-mini ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .supporter-benefits-mini li,
  .upsell-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .supporter-benefits-mini li svg {
    color: var(--accent-primary);
  }

  .tier-limits {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
    padding-top: var(--spacing-md);
  }

  .tier-limit-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .limit-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .limit-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .limit-count {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-primary);
    font-family: monospace;
  }

  .limit-bar-wrap {
    height: 6px;
    background: var(--border-color);
    border-radius: 3px;
    overflow: hidden;
  }

  .limit-bar {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--accent-primary),
      var(--accent-hover)
    );
    border-radius: 3px;
    opacity: 0.8;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .limit-bar.at-limit {
    background: linear-gradient(90deg, var(--error-color), #ff4d4d);
    opacity: 1;
  }

  .limit-value {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--accent-warning, #ffae42);
    text-align: right;
  }

  .benefits-upsell {
    padding: var(--spacing-sm);
  }

  .upsell-desc {
    font-size: 0.8125rem;
    margin-bottom: var(--spacing-sm);
    color: var(--text-secondary);
  }

  .upsell-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .upsell-list li strong {
    color: var(--accent-primary);
    font-weight: 700;
  }

  .text-accent {
    color: var(--accent-primary);
    font-weight: 600;
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
  .eq-control-compact {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .preset-select-pill {
    flex: 1;
    min-width: 160px;
    max-width: 320px;
    padding: var(--spacing-sm) var(--spacing-md);
    background-color: var(--bg-highlight);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .preset-select-pill:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

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
    padding: var(--spacing-md) 0;
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
    font-size: 0.625rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    white-space: nowrap;
    font-weight: 600;
  }

  /* ─── Modern Toggle Styles ─── */

  .toggle-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    width: 100%;
  }

  .toggle-btn {
    position: relative;
    width: 48px;
    height: 26px;
    background-color: var(--bg-highlight);
    border-radius: 13px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    padding: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .toggle-btn.active {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .toggle-handle {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background-color: var(--text-primary);
    border-radius: 50%;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .toggle-btn.active .toggle-handle {
    transform: translateX(22px);
    background-color: #000;
  }

  /* ─── Segmented Pill Control (3-segment) ─── */

  .segmented-pill {
    display: flex;
    background-color: var(--bg-highlight);
    border-radius: var(--radius-lg);
    padding: 4px;
    border: 1px solid var(--border-color);
    width: 100%;
  }

  .segment-btn {
    flex: 1;
    background: none;
    border: none;
    padding: var(--spacing-sm);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    border-radius: calc(var(--radius-lg) - 2px);
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    gap: 4px;
  }

  .segment-btn.active {
    background-color: var(--bg-elevated);
    color: var(--accent-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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
    padding: var(--spacing-xs) 0;
    font-size: 0.8125rem;
    text-align: left;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .sync-message.success {
    color: var(--accent-primary);
  }

  .sync-message.error {
    color: var(--error-color);
  }

  .sync-error-banner {
    margin-top: var(--spacing-md);
    background-color: rgba(220, 53, 69, 0.1);
    border: 1px solid rgba(220, 53, 69, 0.2);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
  }

  .error-content {
    display: flex;
    gap: var(--spacing-md);
    align-items: flex-start;
  }

  .error-icon {
    width: 20px;
    height: 20px;
    color: #dc3545;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .error-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .error-message {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
  }

  .error-hint {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    margin: 0;
    line-height: 1.4;
    text-align: left;
  }

  .donate-link {
    color: var(--accent-primary);
    text-decoration: underline;
    font-weight: 600;
  }
  
  .donate-link:hover {
    color: var(--accent-hover);
  }

  /* Progress Bar Styles */
  .progress-container {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
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
    padding: var(--spacing-sm) 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--spacing-xs);
    animation: fadeIn 0.3s ease;
    border-top: 1px solid rgba(var(--accent-primary-rgb, 30, 215, 96), 0.2);
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
      padding: var(--spacing-md) 0;
      margin-bottom: var(--spacing-sm);
    }
    
    .view-header h1 {
      padding-left: var(--spacing-md);
      font-size: 1.75rem;
    }

    .settings-container {
      padding: 0 var(--spacing-sm);
    }

    .settings-section {
      margin-bottom: var(--spacing-md);
      margin-left: -4px;
      margin-right: -4px;
    }

    .section-title {
      margin-bottom: var(--spacing-md);
      padding-bottom: var(--spacing-xs);
      font-size: 0.75rem;
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
      min-height: 48px;
    }

    /* Mode buttons – allow wrapping and ensure touchable */
    .theme-modes {
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }

    .mode-btn {
      flex: 1 0 calc(50% - var(--spacing-sm));
      min-width: 100px;
      padding: var(--spacing-md) var(--spacing-sm);
    }

    /* Color grid – adjust columns to maintain touchable swatches */
    .color-grid {
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
      gap: var(--spacing-md);
    }
    
    .color-swatch {
      height: 44px;
      border-radius: var(--radius-md);
    }

    /* Preset selector – stack on small screens */
    .preset-selector {
      flex-direction: column;
      align-items: stretch;
      gap: var(--spacing-md);
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
      min-height: 52px;
    }

    /* Adjust bottom padding for content */
    .settings-content {
      padding-bottom: calc(
        var(--mobile-bottom-inset, 130px) + var(--spacing-xl)
      );
    }

    /* Account Section Mobile Fixes */
    .account-card {
      padding: var(--spacing-md);
      gap: var(--spacing-md);
    }

    .account-profile {
      align-items: flex-start;
    }

    .avatar {
      width: 56px;
      height: 56px;
    }

    .avatar-placeholder {
      width: 56px;
      height: 56px;
      font-size: 1.5rem;
    }

    .account-info {
      margin-top: 4px;
    }

    .logout-btn {
      width: auto;
      margin-top: 0;
      align-self: flex-start;
      margin-left: auto;
    }

    .sync-status-area {
      flex-direction: column;
      align-items: stretch;
    }

    .sync-btn {
      width: 100%;
      height: 48px;
    }

    .tier-limits {
      padding: var(--spacing-md) 0;
    }
    
    .progress-bar-container {
      height: 10px;
    }
    
    .limit-bar-wrap {
      height: 10px;
    }
  }
</style>
