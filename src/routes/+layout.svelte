<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appSettings } from "$lib/stores/settings";
  import { theme } from "$lib/stores/theme";
  import { cleanupPlayer } from "$lib/stores/player";
  import { migrateCoversToFiles } from "$lib/api/tauri";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import ProgressiveScanStatus from "$lib/components/ProgressiveScanStatus.svelte";
  import "../app.css";

  let handleVisibilityChange: (() => void) | null = null;
  let migrationStatus = "";
  let showMigrationBanner = false;

  onMount(async () => {
    appSettings.initialize();
    theme.initialize();

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

<TitleBar />
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

<div class="app-content">
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
</style>
