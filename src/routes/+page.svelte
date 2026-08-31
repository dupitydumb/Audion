<script lang="ts">
  import { _ } from "svelte-i18n";
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import "../app.css";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import MainView from "$lib/components/MainView.svelte";
  import PlayerBar from "$lib/components/PlayerBar.svelte";
  import LyricsPanel from "$lib/components/LyricsPanel.svelte";
  import FullScreenPlayer from "$lib/components/fullscreen/FullScreenPlayer.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import QueuePanel from "$lib/components/QueuePanel.svelte";
  import MiniPlayer from "$lib/components/MiniPlayer.svelte";
  import KeyboardShortcuts from "$lib/components/KeyboardShortcuts.svelte";
  import KeyboardShortcutsHelp from "$lib/components/KeyboardShortcutsHelp.svelte";
  import StatsWrapped from "$lib/components/StatsWrapped.svelte";

  import { loadLibrary, loadPlaylists, getTrackByIdSync } from "$lib/stores/library";
  import ToastContainer from "$lib/components/ToastContainer.svelte";
  import { isTauri } from "$lib/api/tauri";
  import { invoke } from "@tauri-apps/api/core";
  import {
    initializeFromPersistedState,
    setupAutoSave,
  } from "$lib/stores/persist";
  import { playTrack, playFromQueue, queue, openAssociatedFile, dispatchSmtcEvent } from "$lib/stores/player";
  import { theme } from "$lib/stores/theme";
  import { isMiniPlayer, withViewTransition, isStatsWrappedOpen } from "$lib/stores/ui";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { appSettings } from "$lib/stores/settings";
  import { isMobile, mobileSearchOpen } from "$lib/stores/mobile";
  import MobileBottomNav from "$lib/components/MobileBottomNav.svelte";
  import { searchQuery, clearSearch } from "$lib/stores/search";
  import PluginUpdateDialog from "$lib/components/PluginUpdateDialog.svelte";
  import PluginDrawer from "$lib/components/PluginDrawer.svelte";

  let isLoading = true;
  let notInTauri = false;

  function handleContextMenu(e: MouseEvent) {
    if (!$appSettings.developerMode) {
      e.preventDefault();
    }
  }

  // Mobile search handling
  let mobileSearchInput = "";
  let mobileSearchInputEl: HTMLInputElement | undefined;
  let mobileSearchTimer: ReturnType<typeof setTimeout>;

  function handleMobileSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    mobileSearchInput = target.value;
    clearTimeout(mobileSearchTimer);
    mobileSearchTimer = setTimeout(() => {
      searchQuery.set(mobileSearchInput);
    }, 200);
  }

  function closeMobileSearch() {
    mobileSearchOpen.set(false);
    mobileSearchInput = "";
    clearSearch();
  }

  // Auto-focus mobile search input when opened
  $: if ($mobileSearchOpen && mobileSearchInputEl) {
    tick().then(() => mobileSearchInputEl?.focus());
  }

  // startup page is now resolved synchronously in view.ts's getInitialView
  // runs at module-load time (before any component mounts) 
  // by reading appSettings.startupPage and, for last-visited, a localStorage cache
  // kept fresh on every app close.
  // see view.ts and +layout.svelte's app://request-last-view handler
  // currentView is already correct by the time MainView mounts

  onMount(async () => {
    // check for a jump-list cold-start deep link before restoring persisted playback state
    // it stashes the track id (get_pending_play_track) we resolve it here
    let pendingJumpListTrackId: number | null = null;
    if (isTauri()) {
      try {
        const pendingId = await invoke<string | null>("get_pending_play_track");
        if (pendingId) {
          const parsed = Number(pendingId);
          if (parsed && !isNaN(parsed)) pendingJumpListTrackId = parsed;
        }
      } catch (error) {
        console.error("[Player] Failed to check pending play-track:", error);
      }
    }

    // Initialize persisted state (volume, lyrics visibility, etc.)
    initializeFromPersistedState(pendingJumpListTrackId);
    setupAutoSave();

    // check for a cold start file association open
    // stashed the same way as the jump list track above, for the same cold start race
    if (isTauri()) {
      try {
        const pendingFile = await invoke<string | null>("get_pending_open_file");
        if (pendingFile) {
          void openAssociatedFile(pendingFile);
        }
      } catch (error) {
        console.error("[Player] Failed to check pending open-file:", error);
      }
    }

    // Check if we're in Tauri environment
    if (!isTauri()) {
      notInTauri = true;
      isLoading = false;
      return;
    }

    try {
      const dataLoadStart = performance.now();
      await Promise.all([loadLibrary(), loadPlaylists()]);

      if (pendingJumpListTrackId !== null) {
        const track = getTrackByIdSync(pendingJumpListTrackId);
        if (track) {
          // jump list entries come from the queue itself
          const idxInQueue = get(queue).findIndex((t) => t.id === pendingJumpListTrackId);
          if (idxInQueue !== -1) {
            playFromQueue(idxInQueue);
          } else {
            void playTrack(track);
          }
        } else {
          console.warn(
            "[Player] cold-start jump-list track not found in library:",
            pendingJumpListTrackId,
          );
        }
      }

      // check for a cold start cli playback flag
      // (--play/--next/etc e.g. from the .desktop file's quick actions)
      // stashed by PendingCliAction
      // see cli.rs. deliberately checked here
      if (isTauri()) {
        try {
          const pendingCliAction = await invoke<{ type: string; data?: any } | null>(
            "get_pending_cli_action",
          );
          if (pendingCliAction) {
            dispatchSmtcEvent(pendingCliAction);
          }
        } catch (error) {
          console.error("[Player] Failed to check pending cli action:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load library:", error);
    } finally {
      // morph the loading screen logo into the sidebar's logo
      // see app-logo-icon/app-logo-text view-transition-name below
      // and the group rules in +layout.svelte
      // sidebar (the morph target) doesn't render on mobile so disabled here
      if (get(isMobile)) {
        isLoading = false;
      } else {
        withViewTransition(() => {
          isLoading = false;
        }, 'app-boot-logo');
      }

      // Lazy load plugins- reduce startup time
      requestIdleCallback(() => {
        const pluginLoadStart = performance.now();
        console.log("  [PLUGINS] Starting lazy load...");

        pluginStore
          .init()
          .then(() => {
            console.log(
              `  [PLUGINS] Loaded in background: ${(performance.now() - pluginLoadStart).toFixed(2)}ms`,
            );
          })
          .catch((error) => {
            console.error("[PLUGINS] Failed to load:", error);
          });
      });
    }
  });
</script>

<svelte:window on:contextmenu={handleContextMenu} />

<div class="app-container" class:pip={$isMiniPlayer}>
  {#if notInTauri}
    <div class="loading-screen">
      <div class="logo">
        <img src="/logo.png" alt={$_('app.logoAlt', { default: 'Audion Logo' })} width="48" height="48" />
        <span>Audion</span>
      </div>
      <p
        style="color: var(--text-primary); font-size: 1.1rem; margin-top: 1rem;"
      >
        🖥️ {$_('app.tauriRequired')}
      </p>
      <p>{$_('app.tauriRequiredDesc')}</p>
      <p style="opacity: 0.7; font-size: 0.8rem;">
        {$_('app.tauriRunHint')} <code
          >npm run tauri dev</code
        >
      </p>
    </div>
  {:else if isLoading}
    <div class="loading-screen">
      <div class="logo">
        <img
          src="/logo.png"
          alt={$_('app.logoAlt', { default: 'Audion Logo' })}
          width="48"
          height="48"
          style="view-transition-name: app-logo-icon;"
        />
        <span style="view-transition-name: app-logo-text;">Audion</span>
      </div>
      <div class="loading-spinner"></div>
      <p>{$_('app.loadingLibrary')}</p>
    </div>
  {:else}
    {#if $isMiniPlayer}
      <MiniPlayer />
    {:else if $isMobile}
      <!-- ========= MOBILE LAYOUT (Spotify-like) ========= -->
      <div class="mobile-layout">
        <div class="mobile-content">
          <MainView />
        </div>
      </div>

      <!-- PlayerBar always rendered for audio element (never hidden on mobile) -->
      <PlayerBar />
      <MobileBottomNav />

      <FullScreenPlayer />
      <ContextMenu />
      <QueuePanel />
      <LyricsPanel />
    {:else}
      <!-- ========= DESKTOP LAYOUT ========= -->
      <div class="app-layout">
        <Sidebar />
        <MainView />
        <LyricsPanel />
        <QueuePanel />
        <FullScreenPlayer />
        <ContextMenu />
      </div>
      <PlayerBar />
      <KeyboardShortcuts />
      <KeyboardShortcutsHelp />
    {/if}

    {#if !$isMiniPlayer}
      <PluginDrawer />
      <ToastContainer />
      {#if $pluginStore.pendingUpdates.length > 0}
        <PluginUpdateDialog
          on:close={() => pluginStore.clearPendingUpdates()}
        />
      {/if}

      <StatsWrapped
        show={$isStatsWrappedOpen}
        onClose={() => isStatsWrappedOpen.set(false)}
      />
    {/if}
  {/if}
</div>

<style>
  .app-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-base);
  }

  /* In PIP mode the window is just 380×148px — make the container
     transparent so only the MiniPlayer card (position:fixed inset:0) shows */
  .app-container.pip {
    background: transparent;
  }

  .loading-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-lg);
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--accent-primary);
    font-size: 2rem;
    font-weight: 700;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--bg-highlight);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-screen p {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .app-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ========= MOBILE LAYOUT ========= */
  .mobile-layout {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-base);
  }

  .mobile-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
</style>
