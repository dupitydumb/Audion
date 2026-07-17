<script lang="ts">
  import { fly } from "svelte/transition";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import { goToArtistDetail } from "$lib/stores/view";
  import {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    progress,
  } from "$lib/stores/player";
  import { isFullScreen, openFullScreen } from "$lib/stores/ui";
  import {
    getTrackCoverSrc,
    getAlbumArtSrc,
    getAlbum,
    getAlbumCoverSrc,
  } from "$lib/api/tauri";

  let albumArt: string | null = null;
  let imageLoadFailed = false;

  $: if ($currentTrack) {
    loadTrackCover($currentTrack);
  } else {
    albumArt = null;
    imageLoadFailed = false;
  }

  async function loadTrackCover(track: any) {
    imageLoadFailed = false;

    if (track.track_cover_path) {
      albumArt = getTrackCoverSrc(track);
    } else if (track.track_cover) {
      albumArt = getAlbumArtSrc(track.track_cover);
    } else if (track.cover_url) {
      albumArt = track.cover_url;
    } else if (track.album_id) {
      try {
        const loadedAlbum = await getAlbum(track.album_id);
        if (loadedAlbum) {
          if (loadedAlbum.art_path) {
            albumArt = getAlbumCoverSrc(loadedAlbum);
          } else if (loadedAlbum.art_data) {
            albumArt = getAlbumArtSrc(loadedAlbum.art_data);
          } else {
            albumArt = null;
          }
        }
      } catch (err) {
        console.error("Failed to load album cover in MobileMiniPlayer:", err);
        albumArt = null;
      }
    } else {
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
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if $currentTrack}
  <div
    class="mobile-mini-player"
    on:click={handleOpenPlayer}
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
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          {/if}
        </div>
        <div class="track-text">
          <span class="track-title truncate">{$currentTrack.title || "Unknown Title"}</span>
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
          aria-label={$isPlaying ? "Pause" : "Play"}
        >
          {#if $isPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M8 5v14l11-7z" />
            </svg>
          {/if}
        </button>

        <button
          class="control-btn next-btn"
          on:click={handleNext}
          aria-label="Next track"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mobile-mini-player {
    position: fixed;
    bottom: calc(var(--mobile-nav-height, 60px) + var(--spacing-sm) + var(--safe-area-inset-bottom, 0px));
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    height: 64px;
    background: rgba(18, 18, 18, 0.75);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    transition: background-color var(--transition-normal);
  }

  .mobile-mini-player:active {
    background: rgba(28, 28, 28, 0.85);
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
    color: var(--text-secondary);
  }

  .track-text {
    display: flex;
    flex-direction: column;
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
    gap: var(--spacing-sm);
    flex-shrink: 0;
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    padding: var(--spacing-xs);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: transform var(--transition-fast);
  }

  .control-btn:active {
    transform: scale(0.9);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
