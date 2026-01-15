<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import MainView from "$lib/components/MainView.svelte";
  import PlayerBar from "$lib/components/PlayerBar.svelte";
  import LyricsPanel from "$lib/components/LyricsPanel.svelte";
  import FullScreenPlayer from "$lib/components/FullScreenPlayer.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import QueuePanel from "$lib/components/QueuePanel.svelte";
  import MiniPlayer from "$lib/components/MiniPlayer.svelte";
  import KeyboardShortcuts from "$lib/components/KeyboardShortcuts.svelte";
  import KeyboardShortcutsHelp from "$lib/components/KeyboardShortcutsHelp.svelte";

  import { loadLibrary, loadPlaylists } from "$lib/stores/library";
  import ToastContainer from "$lib/components/ToastContainer.svelte";
  import { isTauri } from "$lib/api/tauri";
  import {
    initializeFromPersistedState,
    setupAutoSave,
  } from "$lib/stores/persist";
  import { theme } from "$lib/stores/theme";
  import { isMiniPlayer } from "$lib/stores/ui";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { appSettings } from "$lib/stores/settings";

  let isLoading = true;
  let notInTauri = false;
  let audioElement: HTMLAudioElement | null = null;

  function handleContextMenu(e: MouseEvent) {
    if (!$appSettings.developerMode) {
      e.preventDefault();
    }
  }

  onMount(async () => {
    // Initialize persisted state (volume, lyrics visibility, etc.)
    initializeFromPersistedState();
    setupAutoSave();

    // Check if we're in Tauri environment
    if (!isTauri()) {
      notInTauri = true;
      isLoading = false;
      return;
    }

    try {
      await Promise.all([
        loadLibrary(),
        loadPlaylists(),
        // Initialize plugins to auto-load enabled ones
        pluginStore.init(),
      ]);
    } catch (error) {
      console.error("Failed to load library:", error);
    } finally {
      isLoading = false;
    }
  });
</script>

<svelte:window on:contextmenu={handleContextMenu} />

<div class="app-container">
  {#if notInTauri}
    <div class="loading-screen">
      <div class="logo">
        <img src="/logo.png" alt="Audion Logo" width="48" height="48" />
        <span>Audion</span>
      </div>
      <p
        style="color: var(--text-primary); font-size: 1.1rem; margin-top: 1rem;"
      >
        🖥️ Please open the Tauri desktop app
      </p>
      <p>This app requires the Tauri desktop window to function.</p>
      <p style="opacity: 0.7; font-size: 0.8rem;">
        The Tauri window should open automatically when running <code
          >npm run tauri dev</code
        >
      </p>
    </div>
  {:else if isLoading}
    <div class="loading-screen">
      <div class="logo">
        <img src="/logo.png" alt="Audion Logo" width="48" height="48" />
        <span>Audion</span>
      </div>
      <div class="loading-spinner"></div>
      <p>Loading your music library...</p>
    </div>
  {:else}
    <div class="app-layout">
      <Sidebar />
      <MainView />
      <LyricsPanel />
      <QueuePanel />
      <FullScreenPlayer />
      <ContextMenu />
    </div>
    <PlayerBar bind:audioElementRef={audioElement} hidden={$isMiniPlayer} />
    <MiniPlayer />
    <ToastContainer />
    <KeyboardShortcuts />
    <KeyboardShortcutsHelp />
  {/if}
</div>

<style>
  .app-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-base);
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
</style>
