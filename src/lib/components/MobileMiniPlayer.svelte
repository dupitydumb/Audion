<script lang="ts">
  import { _ } from "svelte-i18n";
  import { fade, fly } from "svelte/transition";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import { goToArtistDetail } from "$lib/stores/view";
  import {
    currentTrack,
    isPlaying,
    isTrackLoading,
    togglePlay,
    nextTrack,
    previousTrack,
    progress,
    duration,
    isStreaming,
  } from "$lib/stores/player";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { openFullScreen } from "$lib/stores/ui";
  import { getAlbum } from "$lib/api/tauri";
  import { resolveTrackCover } from "$lib/stores/library";
  import { customArtworks } from "$lib/stores/customArtwork";
  import Icon from "$lib/components/Icon.svelte";

  let albumArt: string | null = null;
  let imageLoadFailed = false;

  $: isCurrentLiked = $currentTrack
    ? $likedTrackIds.has($currentTrack.id)
    : false;

  $: isLive = $currentTrack
    ? $currentTrack.source_type === "radio" ||
      (isStreaming($currentTrack) &&
        (!$currentTrack.duration || $currentTrack.duration === 0) &&
        (!$duration || $duration === 0 || !isFinite($duration)))
    : false;

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

  function handleLike(e: Event) {
    e.stopPropagation();
    if ($currentTrack) {
      toggleLike($currentTrack.id);
    }
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

  function handleTouchEnd() {
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

  function handleTouchCancel() {
    isDragging = false;
    dragX = 0;
    dragY = 0;
  }
</script>

{#if $currentTrack}
  <div
    class="mobile-mini-player"
    on:click={handleOpenPlayer}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={handleTouchEnd}
    on:touchcancel={handleTouchCancel}
    on:keydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpenPlayer();
      }
    }}
    style={dragX !== 0 || dragY !== 0 ? `transform: translate3d(${dragX}px, ${dragY}px, 0);` : ""}
    role="button"
    tabindex="0"
    aria-label={$_('player.openFullPlayer')}
    transition:fly={{ y: 50, duration: 250 }}
  >
    <!-- Display-only 2px hairline progress indicator at the top -->
    <div class="mini-progress-bar" class:loading={$isTrackLoading} aria-hidden="true">
      {#if isLive}
        <div class="mini-progress-fill live"></div>
      {:else}
        <div class="mini-progress-fill" style="width: {$progress * 100}%"></div>
      {/if}
    </div>

    <div class="mini-player-content">
      <div class="track-info-group">
        <div class="mini-cover">
          {#key $currentTrack?.id}
            <div class="mini-cover-inner" in:fade={{ duration: 200 }} out:fade={{ duration: 150 }}>
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
          {/key}
        </div>
        <div class="track-text">
          <div class="track-title-row">
            <span class="track-title truncate">{$currentTrack.title || $_('player.unknownTitle')}</span>
            {#if isLive}
              <span class="live-badge">{$_('player.live')}</span>
            {/if}
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
          type="button"
          class="control-btn like-btn"
          class:liked={isCurrentLiked}
          on:click={handleLike}
          aria-label={isCurrentLiked ? $_('player.removeFromLiked') : $_('player.addToLiked')}
        >
          <Icon name={isCurrentLiked ? "heart-filled" : "heart"} size={19} />
        </button>

        <button
          type="button"
          class="control-btn play-pause-btn"
          class:loading={$isTrackLoading}
          on:click={handlePlayPause}
          aria-label={$isPlaying ? $_('common.pause') : $_('common.play')}
          aria-busy={$isTrackLoading}
        >
          {#if $isTrackLoading}
            <span class="mini-play-spinner" aria-hidden="true"></span>
          {:else if $isPlaying}
            <Icon name="pause" size={20} />
          {:else}
            <Icon name="play" size={20} />
          {/if}
        </button>

        <button
          type="button"
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
    bottom: calc(var(--mobile-nav-height, 64px) + var(--mobile-mini-player-gap, 8px) + var(--safe-area-bottom, 0px));
    left: calc(var(--spacing-sm) + var(--safe-area-left, 0px));
    right: calc(var(--spacing-sm) + var(--safe-area-right, 0px));
    height: var(--mobile-mini-player-height, 64px);
    background: color-mix(in srgb, var(--player-bg, var(--bg-elevated)) 88%, transparent);
    color: var(--player-text, var(--text-on-player, var(--text-primary)));
    backdrop-filter: blur(28px) saturate(190%);
    -webkit-backdrop-filter: blur(28px) saturate(190%);
    border: 1px solid var(--border-subtle, color-mix(in srgb, var(--text-primary) 10%, transparent));
    border-radius: var(--radius-lg, 14px);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-mini-player, 900);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    transition: background-color var(--transition-normal), transform 0.32s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
    cursor: pointer;
    touch-action: pan-y;
    -webkit-tap-highlight-color: transparent;
  }

  .mobile-mini-player:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .mobile-mini-player:active {
    background: color-mix(in srgb, var(--player-bg, var(--bg-surface)) 94%, transparent);
  }

  .mini-progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--border-subtle, color-mix(in srgb, var(--text-primary) 10%, transparent));
    pointer-events: none;
    z-index: 2;
    overflow: hidden;
  }

  .mini-progress-bar.loading::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--accent-primary) 70%, transparent) 50%,
      transparent 100%
    );
    animation: mini-loading-shimmer 1.1s ease-in-out infinite;
  }

  .mini-play-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: mini-spin 0.7s linear infinite;
  }

  @keyframes mini-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes mini-loading-shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--accent-primary);
    transition: width 100ms linear;
    border-radius: 0 2px 2px 0;
  }

  .mini-progress-fill.live {
    width: 100%;
    background: linear-gradient(
      90deg,
      var(--error-color, #e53935),
      var(--accent-warning, #ff7043),
      var(--error-color, #e53935)
    );
    background-size: 200% 100%;
    animation: mini-live-shimmer 3s ease-in-out infinite;
  }

  @keyframes mini-live-shimmer {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }

  .mini-player-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--spacing-sm) 0 var(--spacing-md);
    height: 100%;
    gap: var(--spacing-xs);
  }

  .track-info-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
    flex: 1;
  }

  .mini-cover {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
  }

  .mini-cover-inner {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    color: var(--text-subdued);
  }

  .track-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
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
    color: var(--player-text, var(--text-on-player, var(--text-primary)));
    min-width: 0;
  }

  .live-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.6rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: var(--error-color, #e53935);
    color: var(--text-on-accent, #ffffff);
    flex-shrink: 0;
  }

  .track-artist {
    font-size: var(--font-size-xs);
    color: color-mix(in srgb, var(--player-text, var(--text-on-player, var(--text-secondary))) 75%, transparent);
    margin-top: 2px;
  }

  .mini-controls {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--player-text, var(--text-on-player, var(--text-primary)));
    min-width: 44px;
    min-height: 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: transform 0.16s var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1)),
                background-color var(--transition-fast),
                color var(--transition-fast);
  }

  .control-btn:active {
    transform: scale(0.88);
  }

  .control-btn.like-btn {
    color: color-mix(in srgb, var(--player-text, var(--text-on-player, var(--text-secondary))) 75%, transparent);
  }

  .control-btn.like-btn.liked {
    color: var(--accent-primary, #e53935);
    animation: heartPop 0.32s var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1));
  }

  .control-btn.like-btn.liked {
    color: var(--accent-primary);
  }

  .control-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .control-btn:active {
    background: var(--surface-subtle-hover, color-mix(in srgb, var(--player-text, var(--text-primary)) 12%, transparent));
    transform: scale(0.92);
  }

  @media (hover: hover) and (pointer: fine) {
    .mobile-mini-player:hover {
      background: color-mix(in srgb, var(--player-bg, var(--bg-surface)) 92%, transparent);
    }

    .control-btn:hover {
      background: var(--surface-subtle, color-mix(in srgb, var(--player-text, var(--text-primary)) 8%, transparent));
    }
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
