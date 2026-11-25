<script lang="ts">
  import { _ } from "svelte-i18n";
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { get } from "svelte/store";
  import { currentTrack, addToQueue } from "$lib/stores/player";
  import { toggleFullScreen, isStatsForNerdsOpen } from "$lib/stores/ui";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { playlists, albums, adjustPlaylistTrackCount } from "$lib/stores/library";
  import { addToast } from "$lib/stores/toast";
  import { wsStore } from "$lib/stores/websocket";
  import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
  import { registerBackHandler } from "$lib/stores/mobile";
  import { formatArtists } from "$lib/utils/artists";
  import Icon from "$lib/components/Icon.svelte";
  import AudioQualityBadge from "$lib/components/AudioQualityBadge.svelte";
  import { gestureGuard, isGestureGuarded } from "$lib/utils/gestureGuard";
  import {
    sleepTimerActive,
    sleepTimerRemainingMs,
    sleepTimerMode,
    SLEEP_TIMER_PRESETS,
    startSleepTimer,
    startSleepTimerEndOfTrack,
    stopSleepTimer,
  } from "$lib/stores/sleepTimer";
  import { addTrackToPlaylist } from "$lib/api/tauri";

  export let showMobileMenu = false;
  export let showConnectPanel = false;
  export let albumArt: string | null = null;

  const dispatch = createEventDispatcher<{ trackInfo: void }>();

  let showPlaylistPicker = false;
  let sheetEl: HTMLDivElement | null = null;
  let dragY = 0;
  let isDraggingSheet = false;
  let touchStartY = 0;
  let touchStartX = 0;

  $: connectedDevices = $wsStore.devices.length;
  $: isCurrentLiked = $currentTrack ? $likedTrackIds.has($currentTrack.id) : false;

  let unregisterBack: (() => void) | null = null;
  $: if (showMobileMenu && !unregisterBack) {
    unregisterBack = registerBackHandler(() => {
      if (showPlaylistPicker) {
        showPlaylistPicker = false;
        return true;
      }
      showMobileMenu = false;
      return true;
    });
  } else if (!showMobileMenu && unregisterBack) {
    unregisterBack();
    unregisterBack = null;
  }

  onDestroy(() => {
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  });

  function resolveAlbumId(track = $currentTrack): number | null {
    if (!track) return null;
    if (track.album_id != null) return track.album_id;
    if (!track.album) return null;

    const albumName = track.album.trim().toLowerCase();
    const trackArtist = track.artist?.trim().toLowerCase();
    const allAlbums = get(albums);
    const matched =
      allAlbums.find(
        (a) =>
          a.name.trim().toLowerCase() === albumName &&
          trackArtist &&
          a.artist?.trim().toLowerCase() === trackArtist,
      ) || allAlbums.find((a) => a.name.trim().toLowerCase() === albumName);
    return matched?.id ?? null;
  }

  $: targetAlbumId = resolveAlbumId($currentTrack);

  async function handleAddToPlaylist(playlistId: number, playlistName: string) {
    const track = $currentTrack;
    if (!track) return;
    try {
      await addTrackToPlaylist(playlistId, track.id);
      adjustPlaylistTrackCount(playlistId, 1);
      addToast($_('player.addedToPlaylist', { values: { name: playlistName } }), "success");
      showMobileMenu = false;
    } catch (error) {
      console.error("Failed to add track to playlist:", error);
      addToast($_('player.addToPlaylistFailed'), "error");
    }
  }

  function handleSheetTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    dragY = 0;
    isDraggingSheet = true;
  }

  function handleSheetTouchMove(e: TouchEvent) {
    if (!isDraggingSheet || e.touches.length !== 1) return;
    if (isGestureGuarded(e) || (sheetEl && sheetEl.scrollTop > 1)) {
      dragY = 0;
      return;
    }
    const dy = e.touches[0].clientY - touchStartY;
    const dx = e.touches[0].clientX - touchStartX;
    if (dragY === 0 && (Math.abs(dx) > Math.abs(dy) || dy < 6)) {
      return;
    }
    dragY = Math.max(0, dy);
  }

  function handleSheetTouchEnd() {
    if (!isDraggingSheet) return;
    isDraggingSheet = false;
    if (dragY > 80) {
      dragY = 0;
      showMobileMenu = false;
      return;
    }
    dragY = 0;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="mobile-menu-backdrop"
  on:click={() => (showMobileMenu = false)}
  transition:fade={{ duration: 200 }}
  role="presentation"
>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="mobile-menu-sheet"
    bind:this={sheetEl}
    use:gestureGuard={{ direction: 'vertical', bubbleAtEdges: true }}
    on:touchstart={handleSheetTouchStart}
    on:touchmove={handleSheetTouchMove}
    on:touchend={handleSheetTouchEnd}
    on:touchcancel={handleSheetTouchEnd}
    on:click|stopPropagation
    style={dragY > 0 ? `transform: translate3d(0, ${dragY}px, 0); transition: none;` : ""}
    transition:fly={{ y: 300, duration: 300 }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="sheet-handle-zone">
      <div class="sheet-handle" aria-hidden="true"></div>
    </div>

    {#if $currentTrack}
      <div class="sheet-track-info">
        {#key $currentTrack.id}
          {#if albumArt}
            <img class="sheet-art" in:fly={{ x: 20, duration: 250 }} src={albumArt} alt="Cover" />
          {:else}
            <div class="sheet-art sheet-art-placeholder" in:fly={{ x: 20, duration: 250 }}>
              <Icon name="music" size={20} />
            </div>
          {/if}
        {/key}
        <div class="sheet-track-details">
          <div class="sheet-track-title-row">
            <span class="sheet-track-title">{$currentTrack.title || $_('player.unknownTitle')}</span>
            <AudioQualityBadge variant="compact" />
          </div>
          <span class="sheet-track-artist">{formatArtists($currentTrack.artists) || $currentTrack.artist || $_('common.unknownArtist')}</span>
        </div>
      </div>
    {/if}

    <div class="sheet-divider"></div>

    <!-- Inline Like / Unlike -->
    {#if $currentTrack}
      <button
        type="button"
        class="sheet-item"
        class:liked={isCurrentLiked}
        on:click={() => $currentTrack && toggleLike($currentTrack.id)}
      >
        <Icon name={isCurrentLiked ? "heart-filled" : "heart"} size={22} />
        <span>{isCurrentLiked ? $_('contextMenu.unlike') : $_('contextMenu.like')}</span>
      </button>
    {/if}

    <!-- Inline Add to Queue -->
    {#if $currentTrack}
      <button
        type="button"
        class="sheet-item"
        on:click={() => {
          if ($currentTrack) {
            addToQueue([$currentTrack]);
            addToast($_('player.addedToQueue'), "success");
            showMobileMenu = false;
          }
        }}
      >
        <Icon name="queue" size={22} />
        <span>{$_('contextMenu.addToQueue')}</span>
      </button>
    {/if}

    <!-- Inline Add to Playlist -->
    <button
      type="button"
      class="sheet-item"
      aria-expanded={showPlaylistPicker}
      on:click={() => (showPlaylistPicker = !showPlaylistPicker)}
    >
      <Icon name="list-music" size={22} />
      <span>{$_('contextMenu.addToPlaylist')}</span>
      <Icon name={showPlaylistPicker ? "chevron-down" : "chevron-right"} size={18} />
    </button>

    {#if showPlaylistPicker}
      <div class="sheet-playlist-list">
        {#if $playlists.length === 0}
          <div class="sheet-playlist-empty">{$_('contextMenu.noPlaylists')}</div>
        {:else}
          {#each $playlists as playlist (playlist.id)}
            <button
              type="button"
              class="sheet-playlist-item"
              on:click={() => handleAddToPlaylist(playlist.id, playlist.name)}
            >
              <Icon name="plus" size={16} />
              <span>{playlist.name}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- Go to Artist -->
    {#if $currentTrack?.artists && $currentTrack.artists.length > 1}
      {#each $currentTrack.artists as artistName (artistName)}
        <button
          type="button"
          class="sheet-item"
          on:click={() => {
            showMobileMenu = false;
            toggleFullScreen();
            goToArtistDetail(artistName);
          }}
        >
          <Icon name="user" size={22} />
          <span>{$_('contextMenu.goToArtist')} · {artistName}</span>
        </button>
      {/each}
    {:else if $currentTrack?.artist}
      <button
        type="button"
        class="sheet-item"
        on:click={() => {
          showMobileMenu = false;
          toggleFullScreen();
          if ($currentTrack?.artist) goToArtistDetail($currentTrack.artist);
        }}
      >
        <Icon name="user" size={22} />
        <span>{$_('contextMenu.goToArtist')}</span>
      </button>
    {/if}

    <!-- Go to Album -->
    {#if targetAlbumId}
      <button
        type="button"
        class="sheet-item"
        on:click={() => {
          showMobileMenu = false;
          toggleFullScreen();
          if (targetAlbumId) goToAlbumDetail(targetAlbumId);
        }}
      >
        <Icon name="disc" size={22} />
        <span>{$_('contextMenu.goToAlbum')}</span>
      </button>
    {/if}

    <!-- Track Info -->
    {#if $currentTrack}
      <button
        type="button"
        class="sheet-item"
        on:click={() => dispatch('trackInfo')}
      >
        <Icon name="file-text" size={22} />
        <span>{$_('contextMenu.showMoreInfo')}</span>
      </button>
    {/if}

    <!-- Sleep Timer -->
    <div class="sheet-item-group">
      <div class="sheet-item-header">
        <Icon name="moon" size={22} />
        <span>{$_('player.sleepTimer')}</span>
        {#if $sleepTimerActive}
          <span class="sheet-timer-badge">
            {$_('player.minutesLeft', { values: { minutes: Math.ceil($sleepTimerRemainingMs / 60000) } })}
          </span>
        {/if}
      </div>
      <div class="sheet-timer-presets">
        {#each SLEEP_TIMER_PRESETS as minutes}
          <button
            type="button"
            class="sheet-timer-btn"
            class:active={$sleepTimerMode === 'duration' && Math.ceil($sleepTimerRemainingMs / 60000) === minutes}
            on:click={() => { startSleepTimer(minutes); showMobileMenu = false; }}
          >
            {minutes}m
          </button>
        {/each}
        <button
          type="button"
          class="sheet-timer-btn end-track-btn"
          class:active={$sleepTimerMode === 'end_of_track'}
          on:click={() => { startSleepTimerEndOfTrack(); showMobileMenu = false; }}
        >
          {$_('player.endOfTrack')}
        </button>
        {#if $sleepTimerActive}
          <button
            type="button"
            class="sheet-timer-btn cancel"
            on:click={() => { stopSleepTimer(); showMobileMenu = false; }}
          >
            {$_('common.cancel')}
          </button>
        {/if}
      </div>
    </div>

    <!-- Connect to Device -->
    <button
      type="button"
      class="sheet-item"
      on:click={() => { showMobileMenu = false; showConnectPanel = true; }}
    >
      <Icon name="connect" size={22} />
      <span>{$_('connect.connectToDevice')}</span>
      {#if connectedDevices > 0}
        <span class="sheet-connected-badge">{connectedDevices}</span>
      {/if}
    </button>

    <!-- Stats for Nerds (Audio Telemetry HUD) -->
    <button
      type="button"
      class="sheet-item"
      on:click={() => { showMobileMenu = false; isStatsForNerdsOpen.set(true); }}
    >
      <Icon name="info" size={22} />
      <span>{$_('player.statsForNerds') || "Audio Pipeline (Stats for Nerds)"}</span>
    </button>
  </div>
</div>

<style>
  .mobile-menu-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: var(--z-sheet, 3000);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .mobile-menu-sheet {
    width: 100%;
    max-width: 560px;
    background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
    color: var(--text-primary);
    backdrop-filter: blur(32px) saturate(190%);
    -webkit-backdrop-filter: blur(32px) saturate(190%);
    border-radius: 24px 24px 0 0;
    border-top: 1px solid var(--border-subtle, var(--border-color));
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
    padding: 0 0 calc(20px + var(--safe-area-bottom, 0px));
    max-height: 75dvh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scrollbar-width: none;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .mobile-menu-sheet::-webkit-scrollbar {
    display: none;
  }

  .sheet-handle-zone {
    padding: 12px 0 8px;
    display: flex;
    justify-content: center;
    cursor: grab;
  }

  .sheet-handle {
    width: 36px;
    height: 4px;
    background: var(--text-tertiary, var(--bg-highlight));
    border-radius: 2px;
  }

  .sheet-track-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 20px 12px;
  }

  .sheet-art {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .sheet-art-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface);
    color: var(--text-subdued);
    width: 44px;
    height: 44px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .sheet-track-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sheet-track-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .sheet-track-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sheet-track-artist {
    font-size: 0.8rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .sheet-divider {
    height: 1px;
    background: var(--border-subtle, var(--border-color));
    margin: 0 20px 4px;
  }

  .sheet-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 48px;
    padding: 12px 20px;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 0.95rem;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s ease;
  }

  .sheet-item:active {
    background: var(--surface-subtle-hover, var(--bg-surface));
  }

  .sheet-item :global(svg) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .sheet-item.liked :global(svg) {
    color: var(--accent-primary);
  }

  .sheet-item span {
    flex: 1;
    text-align: left;
  }

  .sheet-playlist-list {
    display: flex;
    flex-direction: column;
    margin: 0 20px 8px 56px;
    padding: 4px 0;
    border-left: 2px solid var(--border-subtle, var(--border-color));
    max-height: 220px;
    overflow-y: auto;
  }

  .sheet-playlist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 8px 14px;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .sheet-playlist-item:active {
    background: var(--surface-subtle-hover, var(--bg-surface));
  }

  .sheet-playlist-item span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet-playlist-empty {
    padding: 10px 14px;
    font-size: 0.85rem;
    color: var(--text-subdued);
  }

  .sheet-connected-badge {
    background: var(--accent-primary);
    color: var(--text-on-accent, #000000);
    font-size: 0.7rem;
    font-weight: 700;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sheet-item-group {
    padding: 8px 20px 12px;
  }

  .sheet-item-header {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--text-primary);
    font-size: 0.95rem;
    margin-bottom: 10px;
  }

  .sheet-item-header :global(svg) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .sheet-timer-badge {
    margin-left: auto;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-primary);
  }

  .sheet-timer-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 36px;
  }

  .sheet-timer-btn {
    min-height: 40px;
    padding: 6px 16px;
    border-radius: 20px;
    border: 1px solid var(--border-subtle, var(--border-color));
    background: var(--surface-subtle, var(--bg-surface));
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.15s ease;
    outline: none;
  }

  .sheet-timer-btn:active {
    background: var(--surface-subtle-hover, var(--bg-highlight));
  }

  .sheet-timer-btn.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--text-on-accent, #000000);
    font-weight: 600;
  }

  .sheet-timer-btn.cancel {
    border-color: var(--error-color, #e53935);
    color: var(--error-color, #e53935);
  }
</style>
