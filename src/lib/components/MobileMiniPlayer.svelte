<script lang="ts">
  import { _ } from "svelte-i18n";
  import { fly } from "svelte/transition";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import { goToArtistDetail } from "$lib/stores/view";
  import {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    previousTrack,
    progress,
  } from "$lib/stores/player";
  import { isFullScreen, openFullScreen } from "$lib/stores/ui";
  import { getAlbum } from "$lib/api/tauri";
  import { resolveTrackCover } from "$lib/stores/library";
  import { customArtworks } from "$lib/stores/customArtwork";
  import Icon from "$lib/components/Icon.svelte";

  let albumArt: string | null = null;
  let imageLoadFailed = false;

  $: if ($currentTrack) {
    loadTrackCover($currentTrack, $customArtworks);
  } else {
    albumArt = null;
    imageLoadFailed = false;
  }

  async function loadTrackCover(track: any, _customs?: unknown) {
    imageLoadFailed = false;

    try {
      let src = resolveTrackCover(track);
      // album art not cached yet => fetch the album and retry
      if (!src && track.album_id) {
        const album = await getAlbum(track.album_id);
        if ($currentTrack?.id !== track.id) return;
        src = resolveTrackCover(track, album);
      }
      albumArt = src;
    } catch (err) {
      console.error("Failed to load album cover in MobileMiniPlayer:", err);
      albumArt = null;
    }
  }

  function handleOpenPlayer() {
    openFullScreen();
  }

  function handlePlayPause(e: Event) {
    e.stopPropagation();
    togglePlay();
  }

  function handleNext(e: Event) {
    e.stopPropagation();
    nextTrack();
  }

  // Touch gesture tracking (Swipe up to expand, swipe left/right to skip)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let dragX = 0;
  let dragY = 0;
  let isDragging = false;

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    dragX = 0;
    dragY = 0;
    isDragging = true;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - touchStartX;
    const dy = currentY - touchStartY;

    // Apply soft spring damping on pull
    dragX = dx * 0.35;
    dragY = Math.min(0, dy * 0.35); // upwards only
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!isDragging) return;
    isDragging = false;
    const elapsed = Date.now() - touchStartTime;
    const finalDx = dragX / 0.35;
    const finalDy = dragY / 0.35;
    dragX = 0;
    dragY = 0;

    // Swipe Up => Expand full player
    if (finalDy < -40 || (finalDy < -25 && elapsed < 250)) {
      handleOpenPlayer();
      return;
    }

    // Horizontal Swipe => Next / Previous track
    if (Math.abs(finalDx) > 50 && Math.abs(finalDx) > Math.abs(finalDy)) {
      if (finalDx < 0) {
        nextTrack();
      } else {
        previousTrack();
      }
    }
  }
</script>

{#if $currentTrack}
  <div
    class="mobile-mini-player"
    on:click={handleOpenPlayer}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={handleTouchEnd}
    on:keydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpenPlayer();
      }
    }}
    style="transform: translate3d({dragX}px, {dragY}px, 0);"
    role="button"
    tabindex="0"
    aria-label={$_('player.openFullPlayer')}
    transition:fly={{ y: 50, duration: 250 }}
  >
    <!-- Extremely thin progress bar at the top -->
    <div class="mini-progress-bar">
      <div class="mini-progress-fill" style="width: {$progress * 100}%"></div>
    </div>

    <div class="mini-player-content">
      <div class="track-info-group">
        <div class="mini-cover">
          {#if albumArt && !imageLoadFailed}
            <img
              src={albumArt}
              alt="Cover art"
              on:error={() => (imageLoadFailed = true)}
            />
          {:else}
            <div class="cover-placeholder">
              <Icon name="music" size={16} />
            </div>
          {/if}
        </div>
        <div class="track-text">
          <div class="track-title-row">
            <span class="track-title truncate">{$currentTrack.title || $_('player.unknownTitle')}</span>
          </div>
          <ArtistLinks
            artist={$currentTrack.artist}
            artists={$currentTrack.artists}
            compact
            tapMenu
            chipClass="track-artist truncate"
            on:select={(e) => goToArtistDetail(e.detail)}
          />
        </div>
      </div>

      <div class="mini-controls">
        <button
          class="control-btn play-pause-btn"
          on:click={handlePlayPause}
          aria-label={$isPlaying ? $_('common.pause') : $_('common.play')}
        >
          {#if $isPlaying}
            <Icon name="pause" size={20} />
          {:else}
            <Icon name="play" size={20} />
          {/if}
        </button>

        <button
          class="control-btn next-btn"
          on:click={handleNext}
          aria-label={$_('player.next')}
        >
          <Icon name="skip-forward" size={20} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mobile-mini-player {
    position: fixed;
    bottom: calc(var(--mobile-nav-height, 60px) + var(--spacing-sm) + var(--safe-area-bottom, 0px));
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    height: 64px;
    background: color-mix(in srgb, var(--bg-elevated, #181818) 82%, transparent);
    backdrop-filter: blur(28px) saturate(190%);
    -webkit-backdrop-filter: blur(28px) saturate(190%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-lg, 14px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    transition: background-color var(--transition-normal), transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
    cursor: pointer;
    touch-action: pan-y;
  }

  .mobile-mini-player:hover {
    background: color-mix(in srgb, var(--bg-surface, #282828) 88%, transparent);
  }

  .mobile-mini-player:focus-visible {
    outline: 2px solid var(--accent-primary, #1db954);
    outline-offset: 2px;
  }

  .mobile-mini-player:active {
    background: color-mix(in srgb, var(--bg-surface, #282828) 90%, black);
  }

  .mini-progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--accent-primary);
    box-shadow: 0 0 6px var(--accent-primary);
    transition: width 100ms linear;
  }

  .mini-player-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--spacing-md);
    height: 100%;
  }

  .track-info-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    min-width: 0;
    flex: 1;
    margin-right: var(--spacing-md);
  }

  .mini-cover {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-surface);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .mini-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued, #8e8e8e);
  }

  .track-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .track-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .track-title {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .track-artist {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .mini-controls {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: transform var(--transition-fast), background-color var(--transition-fast);
  }

  .control-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .control-btn:focus-visible {
    outline: 2px solid var(--accent-primary, #1db954);
    outline-offset: 1px;
  }

  .control-btn:active {
    transform: scale(0.92);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
