<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { appSettings } from "$lib/stores/settings";
  import { theme } from "$lib/stores/theme";
  import { cleanupPlayer, initAudioBackend } from "$lib/stores/player";
  import {
    migrateCoversToFiles,
    isAndroid,
    isTauri,
    ensureAudioPermission,
    openAppSettings,
    initPlatformDetection,
  } from "$lib/api/tauri";
  import { initMobileDetection, isMobile } from "$lib/stores/mobile";
  import { mobileSearchOpen } from "$lib/stores/mobile";
  import { initAndroidNotification } from "$lib/services/android-notification";
  import { loadLikedTracks } from "$lib/stores/liked";
  import { goBack, navigationHistory } from "$lib/stores/view";
  import { isFullScreen, isQueueVisible, contextMenu } from "$lib/stores/ui";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import ProgressiveScanStatus from "$lib/components/ProgressiveScanStatus.svelte";
  import "../app.css";

  let handleVisibilityChange: (() => void) | null = null;
  let migrationStatus = "";
  let showMigrationBanner = false;
  let showPermissionBanner = false;
  let permissionDenied = false;

  // =========================================================================
  // ANDROID BACK BUTTON HANDLER
  // =========================================================================
  // Called from native Android (MainActivity.kt) via evaluateJavascript().
  // Dismisses overlays first, then navigates back through view history.
  // Returns true if handled, false if at root (so native side can minimize).
  // =========================================================================
  function setupAndroidBackHandler() {
    (window as any).__audionHandleBack = (): boolean => {
      // 1. Close context menu if open
      const ctx = get(contextMenu);
      if (ctx.visible) {
        contextMenu.set({ ...ctx, visible: false });
        return true;
      }

      // 2. Close full-screen player
      if (get(isFullScreen)) {
        isFullScreen.set(false);
        return true;
      }

      // 3. Close queue panel
      if (get(isQueueVisible)) {
        isQueueVisible.set(false);
        return true;
      }

      // 4. Close mobile search
      if (get(mobileSearchOpen)) {
        mobileSearchOpen.set(false);
        return true;
      }

      // 5. Navigate back through view history
      const nav = get(navigationHistory);
      if (nav.canGoBack) {
        goBack();
        return true;
      }

      // 6. At root — return false so native side minimizes the app
      return false;
    };
  }

  function cleanupAndroidBackHandler() {
    delete (window as any).__audionHandleBack;
  }

  onMount(async () => {
    // Detect platform early for Linux-specific fixes (asset:// -> file://)
    await initPlatformDetection();

    appSettings.initialize();
    theme.initialize();
    initMobileDetection();
    await initAudioBackend();

    // Load liked tracks from database
    loadLikedTracks();

    // Initialize Android-specific features
    if (isAndroid() && isTauri()) {
      setupAndroidBackHandler();
      await checkAndroidPermissions();
      initAndroidNotification();
    }

    const migrationStart = performance.now();

    // Run cover migration if needed
    await runCoverMigration();

    console.log(
      `  [LAYOUT] Cover migration: ${(performance.now() - migrationStart).toFixed(2)}ms`,
    );

    // handle page visibility
    handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - we could pause here if desired
        // But DON'T call cleanupPlayer() - too aggressive
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  async function checkAndroidPermissions() {
    console.log("[PERMISSIONS] Checking Android audio permissions...");
    const granted = await ensureAudioPermission();

    if (!granted) {
      console.warn("[PERMISSIONS] Audio permission not granted");
      showPermissionBanner = true;
      permissionDenied = true;
    } else {
      console.log("[PERMISSIONS] Audio permission granted");
      showPermissionBanner = false;
      permissionDenied = false;
    }
  }

  async function handleOpenSettings() {
    await openAppSettings();
    // Re-check after returning from settings
    setTimeout(async () => {
      await checkAndroidPermissions();
    }, 1000);
  }

  async function runCoverMigration() {
    const migrated = localStorage.getItem("covers_migrated");

    if (migrated !== "true") {
      try {
        showMigrationBanner = true;
        migrationStatus = "Migrating cover images to file storage...";
        console.log("[MIGRATION FRONTEND] Starting migration...");

        const result = await migrateCoversToFiles();

        console.log("[MIGRATION FRONTEND] Migration result:", result);
        console.log("[MIGRATION FRONTEND] Total:", result.total);
        console.log("[MIGRATION FRONTEND] Processed:", result.processed);
        console.log(
          "[MIGRATION FRONTEND] Tracks migrated:",
          result.tracks_migrated,
        );
        console.log(
          "[MIGRATION FRONTEND] Albums migrated:",
          result.albums_migrated,
        );
        console.log("[MIGRATION FRONTEND] Errors:", result.errors.length);

        if (result.errors.length > 0) {
          console.error("[MIGRATION FRONTEND] Errors encountered:");
          result.errors.forEach((error, i) => {
            console.error(`[MIGRATION FRONTEND]   ${i + 1}. ${error}`);
          });
        }

        if (result.errors.length === 0) {
          localStorage.setItem("covers_migrated", "true");
          migrationStatus = ` Successfully migrated ${result.tracks_migrated} track covers and ${result.albums_migrated} album covers`;
          console.log("[MIGRATION FRONTEND] Migration completed successfully!");

          setTimeout(() => {
            showMigrationBanner = false;
          }, 3000);
        } else {
          console.error("[MIGRATION FRONTEND] Migration completed with errors");
          migrationStatus = `Migration completed with ${result.errors.length} errors. Check console for details.`;

          setTimeout(() => {
            showMigrationBanner = false;
          }, 5000);
        }
      } catch (error) {
        console.error("[MIGRATION FRONTEND] Migration failed:", error);
        migrationStatus = "Migration failed. Please try again from settings.";

        setTimeout(() => {
          showMigrationBanner = false;
        }, 5000);
      }
    } else {
      console.log(
        "[MIGRATION FRONTEND] Migration already completed (skipping)",
      );
    }
  }

  // Cleanup on component unmount
  onDestroy(() => {
    console.log("[App] Cleaning up on unmount");

    // Remove visibility change listener
    if (handleVisibilityChange) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    // Cleanup Android back handler
    cleanupAndroidBackHandler();

    // Cleanup player resources
    cleanupPlayer();
  });

  // Cleanup on hot reload (development only)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      console.log("[App] Cleaning up on hot reload");
      cleanupPlayer();
    });
  }
</script>

{#if !$isMobile}
  <TitleBar />
{/if}
<ConfirmDialog />
<ProgressiveScanStatus />

{#if showMigrationBanner}
  <div class="migration-banner">
    <div class="migration-content">
      {#if migrationStatus.startsWith("")}
        <span class="success-icon"></span>
      {:else if migrationStatus.includes("error") || migrationStatus.includes("failed")}
        <span class="error-icon"></span>
      {:else}
        <span class="loading-icon">⏳</span>
      {/if}
      <span class="migration-text">{migrationStatus}</span>
    </div>
  </div>
{/if}

{#if showPermissionBanner}
  <div class="permission-banner">
    <div class="permission-content">
      <span class="permission-icon">🎵</span>
      <span class="permission-text">
        {#if permissionDenied}
          Audio permission required to play local music files.
        {:else}
          Requesting audio permission...
        {/if}
      </span>
      {#if permissionDenied}
        <button class="permission-button" on:click={handleOpenSettings}>
          Open Settings
        </button>
      {/if}
    </div>
  </div>
{/if}

<div class="app-content" class:mobile={$isMobile}>
  <slot />
</div>

<style>
  .app-content {
    padding-top: 48px; /* Height of TitleBar */
    height: 100vh;
    width: 100%;
    overflow: hidden; /* Prevent body scroll if content handles it, otherwise auto */
  }

  .migration-banner {
    position: fixed;
    top: 48px; /* Below TitleBar */
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 0.75rem 1rem;
    text-align: center;
    z-index: 999;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    animation: slideDown 0.3s ease-out;
  }

  @keyframes slideDown {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .migration-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .success-icon {
    color: #4ade80;
    font-size: 1.2rem;
    font-weight: bold;
  }

  .error-icon {
    color: #fbbf24;
    font-size: 1.2rem;
  }

  .loading-icon {
    font-size: 1.2rem;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .migration-text {
    font-size: 0.9rem;
    font-weight: 500;
  }

  .app-content.mobile {
    padding-top: 0;
  }

  /* Permission Banner Styles */
  .permission-banner {
    position: fixed;
    top: 48px;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: white;
    padding: 0.75rem 1rem;
    text-align: center;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    animation: slideDown 0.3s ease-out;
  }

  .permission-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .permission-icon {
    font-size: 1.2rem;
  }

  .permission-text {
    font-size: 0.9rem;
    font-weight: 500;
  }

  .permission-button {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: white;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .permission-button:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .permission-button:active {
    background: rgba(255, 255, 255, 0.4);
  }
</style>
