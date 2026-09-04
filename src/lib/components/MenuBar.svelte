<script lang="ts">
  import { _ } from "svelte-i18n";
  import { pickFolder, addFolder, rescanMusic } from "$lib/api/tauri";
  import {
    loadLibrary,
    loadAlbumsAndArtists,
    loadPlaylists,
    clearLibrary,
  } from "$lib/stores/library";
  import { progressiveScan } from "$lib/stores/progressiveScan";
  import { lyricsStore } from "$lib/stores/lyrics";
  import { addToast } from "$lib/stores/toast";
  import { confirm } from "$lib/stores/dialogs";
  import { nativeAudioStop } from '$lib/services/native-audio';
  import Icon from '$lib/components/Icon.svelte';

  let openMenu: string | null = null;
  let isScanning = false;

  function toggleMenu(menu: string) {
    openMenu = openMenu === menu ? null : menu;
  }

  function closeMenus() {
    openMenu = null;
    // Return focus to body so spacebar works as a global shortcut
    (document.activeElement as HTMLElement | null)?.blur();
  }

  async function handleLoadFolder() {
    closeMenus();
    try {
      const overallStart = performance.now();
      console.log("[TIMING] handleLoadFolder started");

      const selectStart = performance.now();
      const path = await pickFolder();
      console.log(
        ` [TIMING] pickFolder took ${(performance.now() - selectStart).toFixed(2)}ms`,
      );

      if (path) {
        isScanning = true;

        // Start progressive scan (clearExisting = true to start fresh)
        const scanStart = performance.now();
        await progressiveScan.startScan(true);
        console.log(
          ` [TIMING] progressiveScan.startScan took ${(performance.now() - scanStart).toFixed(2)}ms`,
        );

        // Add folder and trigger rescan
        const addFolderStart = performance.now();
        await addFolder(path);
        console.log(
          ` [TIMING] addFolder took ${(performance.now() - addFolderStart).toFixed(2)}ms`,
        );

        const rescanStart = performance.now();
        const result = await rescanMusic();
        console.log(
          ` [TIMING] rescanMusic took ${(performance.now() - rescanStart).toFixed(2)}ms`,
        );

        if (result.errors.length > 0) {
          console.warn("Scan errors:", result.errors);
        }

        console.log(
          `Scan complete: ${result.tracks_added} added, ${result.tracks_updated} updated, ${result.tracks_deleted} deleted`,
        );

        // Load albums/artists after progressive track loading completes
        // this was a huge pain point. i tried to load them simultaneously
        // but the problems it created, are waaaay too big for minimal benifit
        const albumsStart = performance.now();
        await loadAlbumsAndArtists();
        console.log(
          ` [TIMING] loadAlbumsAndArtists took ${(performance.now() - albumsStart).toFixed(2)}ms`,
        );

        const playlistsStart = performance.now();
        await loadPlaylists();
        console.log(
          ` [TIMING] loadPlaylists took ${(performance.now() - playlistsStart).toFixed(2)}ms`,
        );

        console.log(
          `[TIMING] Total handleLoadFolder time: ${(performance.now() - overallStart).toFixed(2)}ms`,
        );

        // Add success toast
        const parts = [];
        if (result.tracks_added > 0) parts.push(`${result.tracks_added} ${$_('menu.added')}`);
        if (result.tracks_updated > 0)
          parts.push(`${result.tracks_updated} ${$_('menu.updated')}`);
        if (result.tracks_deleted > 0)
          parts.push(`${result.tracks_deleted} ${$_('menu.deleted')}`);

        const message =
          parts.length > 0
            ? $_('menu.scanComplete', { values: { parts: parts.join(", ") } })
            : $_('menu.scanCompleteSimple');

        addToast(message, "success", 4000);
      } else {
        console.log("[TIMING] No path selected");
      }
    } catch (error) {
      console.error("Failed to load folder:", error);
      addToast($_('menu.loadFolderFailed'), "error");
    } finally {
      isScanning = false;
      progressiveScan.reset();
    }
  }

  async function handleRescan() {
    closeMenus();
    try {
      const overallStart = performance.now();
      console.log("[TIMING] handleRescan started");

      isScanning = true;

      // Clear existing tracks and set up progressive loading
      const scanStart = performance.now();
      await progressiveScan.startScan(true); // true = clear existing tracks
      console.log(
        ` [TIMING] progressiveScan.startScan took ${(performance.now() - scanStart).toFixed(2)}ms`,
      );

      const rescanStart = performance.now();
      const result = await rescanMusic();
      console.log(
        ` [TIMING] rescanMusic took ${(performance.now() - rescanStart).toFixed(2)}ms`,
      );

      if (result.errors.length > 0) {
        console.warn("Rescan errors:", result.errors);
      }

      console.log(
        `Rescan complete: ${result.tracks_added} added, ${result.tracks_updated} updated, ${result.tracks_deleted} deleted`,
      );

      // Load albums/artists after progressive track loading completes
      const albumsStart = performance.now();
      await loadAlbumsAndArtists();
      console.log(
        ` [TIMING] loadAlbumsAndArtists took ${(performance.now() - albumsStart).toFixed(2)}ms`,
      );

      const playlistsStart = performance.now();
      await loadPlaylists();
      console.log(
        ` [TIMING] loadPlaylists took ${(performance.now() - playlistsStart).toFixed(2)}ms`,
      );

      console.log(
        `[TIMING] Total handleRescan time: ${(performance.now() - overallStart).toFixed(2)}ms`,
      );

      // success toast
      const parts = [];
      if (result.tracks_added > 0) parts.push(`${result.tracks_added} ${$_('menu.added')}`);
      if (result.tracks_updated > 0)
        parts.push(`${result.tracks_updated} ${$_('menu.updated')}`);
      if (result.tracks_deleted > 0)
        parts.push(`${result.tracks_deleted} ${$_('menu.deleted')}`);

      const message =
        parts.length > 0
          ? $_('menu.rescanComplete', { values: { parts: parts.join(", ") } })
          : $_('menu.rescanCompleteNoChanges');

      addToast(message, "success", 4000);
    } catch (error) {
      console.error("Failed to rescan:", error);
      addToast($_('menu.rescanFailed'), "error");
    } finally {
      isScanning = false;
      progressiveScan.reset();
    }
  }

  async function handleClearCache() {
    closeMenus();

    const confirmed = await confirm(
      $_('menu.clearCacheConfirm'),
      {
        title: $_('menu.clearCache'),
        confirmLabel: $_('common.clear'),
        danger: true,
      },
    );

    if (!confirmed) return;

    try {
      // Clear lyrics cache from localStorage
      localStorage.removeItem("musixmatch_token");
      localStorage.removeItem("musixmatch_expiration");

      // Clear the current track's LRC file cache
      await lyricsStore.clearCurrentTrackCache();

      // Clear library data and reload
      await clearLibrary();
      await loadLibrary();
      await loadPlaylists();
    } catch (error) {
      console.error("Failed to clear cache:", error);
    }
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".menu-bar")) {
      closeMenus();
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="menu-bar">
  <button
    class="menu-trigger"
    on:click|stopPropagation={() => toggleMenu("file")}
    class:active={openMenu === "file"}
    aria-label="Open menu"
    title={$_('menu.menuTitle')}
  >
    <Icon name="more-vertical" size={20} />
  </button>

  {#if openMenu}
    <div class="menu-dropdown">
      <div class="menu-section">
        <div class="menu-header">{$_('menu.file')}</div>
        <button
          class="menu-item"
          on:click={handleLoadFolder}
          disabled={isScanning}
        >
          <Icon name="folder" size={16} />
          <span>{$_('menu.loadFolder')}</span>
          <span class="shortcut">Ctrl+O</span>
        </button>
        <button class="menu-item" on:click={handleRescan} disabled={isScanning}>
          <Icon name="refresh" size={16} />
          <span>{$_('menu.rescanLibrary')}</span>
          <span class="shortcut">Ctrl+R</span>
        </button>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-section">
        <div class="menu-header">{$_('menu.view')}</div>
        <button
          class="menu-item"
          on:click={() => {
            closeMenus();
            nativeAudioStop();
            window.location.reload();
          }}
        >
          <Icon name="refresh" size={16} />
          <span>{$_('menu.refreshPage')}</span>
          <span class="shortcut">Ctrl+Shift+R</span>
        </button>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-section">
        <div class="menu-header">{$_('sidebar.settings')}</div>
        <button class="menu-item" on:click={handleClearCache}>
          <Icon name="trash" size={16} />
          <span>{$_('menu.clearCache')}</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .menu-bar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .menu-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .menu-trigger:hover,
  .menu-trigger.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .menu-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 220px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    overflow: hidden;
  }

  .menu-section {
    padding: 6px 0;
  }

  .menu-header {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-subdued);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--bg-highlight);
  }

  .menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .menu-item svg {
    flex-shrink: 0;
    color: var(--text-secondary);
  }

  .menu-item span {
    flex: 1;
  }

  .shortcut {
    flex: 0 !important;
    font-size: 11px;
    color: var(--text-subdued);
  }

  .menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }
</style>
