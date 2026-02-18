<script lang="ts">
  import type { Artist } from "$lib/api/tauri";
  import { goToArtistDetail } from "$lib/stores/view";
  import {
    currentArtistName,
    isPlaying,
    playTracks,
    togglePlay,
  } from "$lib/stores/player";
  import { getTracksByArtist } from "$lib/api/tauri";
  import VirtualizedGrid from "./Virtualizedgrid.svelte";

  export let artists: Artist[] = [];

  // Extract store values
  $: playingArtistName = $currentArtistName;
  $: playing = $isPlaying;

  // Cache for artist pictures from Tidal
  let artistPictureCache = new Map<string, string | null>();
  let failedImages = new Set<string>();
  const MAX_FAILED_IMAGES = 200;

  // Determine if this artist is the current one and paused
  function isArtistPaused(artistName: string): boolean {
    return playingArtistName === artistName && !playing;
  }

  // Get artist picture URL from Tidal search
  async function getArtistPicture(artistName: string): Promise<string | null> {
    console.log("[ArtistGrid] getArtistPicture called for:", artistName);

    if (artistPictureCache.has(artistName)) {
      console.log("[ArtistGrid] Using cached result for:", artistName);
      return artistPictureCache.get(artistName) || null;
    }

    try {
      console.log("[ArtistGrid] Checking for tidalSearchPlugin...");
      const plugin = (window as any).tidalSearchPlugin;
      console.log("[ArtistGrid] Plugin available:", !!plugin);

      if (!plugin) {
        console.log("[ArtistGrid] Plugin not available yet");
        artistPictureCache.set(artistName, null);
        artistPictureCache = artistPictureCache;
        return null;
      }

      console.log("[ArtistGrid] Calling searchArtistPictureForRPC...");
      // Call Tidal search plugin to get artist image
      const result = await plugin.searchArtistPictureForRPC(artistName);
      console.log("[ArtistGrid] Result from plugin:", result);

      if (result) {
        artistPictureCache.set(artistName, result);
        artistPictureCache = artistPictureCache;
        return result;
      }
    } catch (error) {
      console.log("[ArtistGrid] Failed to fetch artist picture:", error);
    }

    artistPictureCache.set(artistName, null);
    artistPictureCache = artistPictureCache;
    return null;
  }

  function handleImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    const src = img.src;

    if (failedImages.size >= MAX_FAILED_IMAGES) {
      const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
      failedImages.clear();
      toKeep.forEach((s) => failedImages.add(s));
    }

    failedImages.add(src);
    failedImages = failedImages;
  }

  async function handleArtistClick(artist: Artist, e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Check if play/resume button was clicked
    const playButton = target.closest(".play-button");
    if (playButton) {
      e.stopPropagation();

      // If paused, resume playback
      if (isArtistPaused(artist.name)) {
        togglePlay();
        return;
      }

      // Don't restart if already playing
      if (playingArtistName === artist.name && playing) {
        return;
      }

      try {
        const tracks = await getTracksByArtist(artist.name);
        if (tracks.length > 0) {
          playTracks(tracks, 0, {
            type: "artist",
            artistName: artist.name,
            displayName: artist.name,
          });
        }
      } catch (error) {
        console.error("Failed to load tracks for artist:", error);
      }
      return;
    }

    // Otherwise navigate to artist detail
    goToArtistDetail(artist.name);
  }

  function handlePauseClick(e: MouseEvent) {
    e.stopPropagation();
    togglePlay();
  }

  function handleArtistContextMenu(artist: Artist, e: MouseEvent) {}

  function getArtistInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  const emptyState = {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
    title: "No artists found",
    description: "Add a music folder to see your artists",
  };
</script>

<VirtualizedGrid
  items={artists}
  getItemKey={(artist: Artist) => artist.name}
  onItemClick={handleArtistClick}
  onItemContextMenu={handleArtistContextMenu}
  emptyStateConfig={emptyState}
  cardWidthDesktop={200}
  cardWidthMobile={140}
  cardHeightDesktop={240}
  cardHeightMobile={190}
  let:item={artist}
>
  <div
    class="artist-card"
    class:now-playing={playingArtistName === artist.name && playing}
    class:paused={isArtistPaused(artist.name)}
  >
    {#if playingArtistName === artist.name && playing}
      <div class="now-playing-badge">Now Playing</div>
    {:else if isArtistPaused(artist.name)}
      <div class="now-playing-badge paused-badge">Paused</div>
    {/if}
    <div class="artist-avatar">
      {#await getArtistPicture(artist.name) then pictureUrl}
        {#if pictureUrl && !failedImages.has(pictureUrl)}
          <img
            src={pictureUrl}
            alt={artist.name}
            class="artist-picture"
            decoding="async"
            on:error={handleImageError}
          />
        {:else}
          <span class="artist-initial">{getArtistInitial(artist.name)}</span>
        {/if}
      {:catch}
        <span class="artist-initial">{getArtistInitial(artist.name)}</span>
      {/await}

      <!-- playing indicator -->
      {#if playingArtistName === artist.name && playing}
        <div class="playing-indicator-container">
          <div class="playing-indicator">
            <span class="bar"></span>
            <span class="bar"></span>
            <span class="bar"></span>
          </div>
          <button
            class="pause-button-overlay"
            on:click={handlePauseClick}
            aria-label="Pause"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          </button>
        </div>
      {/if}

      <!-- Darkening overlay -->
      <div
        class="avatar-overlay"
        class:is-playing={playingArtistName === artist.name && playing}
      >
        {#if !(playingArtistName === artist.name && playing)}
          <div class="play-button">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="24"
              height="24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        {/if}
      </div>
    </div>
    <div class="artist-info">
      <span class="artist-name truncate">{artist.name}</span>
      <span class="artist-meta"
        >{artist.album_count} albums • {artist.track_count} songs</span
      >
    </div>
  </div>
</VirtualizedGrid>

<style>
  .artist-card {
    background-color: var(--bg-elevated);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    transition: background-color var(--transition-normal);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-md);
    position: relative;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  .artist-card:hover {
    background-color: var(--bg-surface);
  }

  .artist-card.now-playing {
    background-color: var(--accent-subtle);
  }

  .artist-card.now-playing:hover {
    background-color: var(--accent-subtle);
    opacity: 0.95;
  }

  /* Paused state */
  .artist-card.paused {
    background-color: var(--accent-subtle);
  }

  .artist-card.paused:hover {
    background-color: var(--accent-subtle);
    opacity: 0.95;
  }

  .now-playing-badge {
    position: absolute;
    top: var(--spacing-sm);
    left: var(--spacing-sm);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
    z-index: 2;
  }

  .now-playing-badge.paused-badge {
    background-color: var(--text-secondary);
  }

  .artist-avatar {
    width: 140px;
    height: 140px;
    border-radius: var(--radius-full);
    background: linear-gradient(135deg, var(--accent-primary) 0%, #1a1a1a 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-md);
    flex-shrink: 0;
    position: relative;
    isolation: isolate;
  }

  .artist-card.now-playing .artist-avatar {
    box-shadow: 0 0 0 3px var(--accent-primary);
  }

  .artist-card.paused .artist-avatar {
    box-shadow: 0 0 0 3px var(--accent-primary);
  }

  .artist-initial {
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .artist-picture {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-full);
  }

  /* overlay */
  .avatar-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity var(--transition-fast);
    pointer-events: none;
  }

  .artist-avatar:hover .avatar-overlay {
    opacity: 1;
    pointer-events: auto;
  }

  .avatar-overlay.is-playing {
    opacity: 0;
    background: transparent;
  }

  .artist-avatar:hover .avatar-overlay.is-playing {
    opacity: 1;
    background: rgba(0, 0, 0, 0.5);
  }

  .play-button {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    background-color: var(--accent-primary);
    color: var(--bg-base);
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateY(8px);
    transition:
      transform var(--transition-fast),
      scale var(--transition-fast);
    box-shadow: var(--shadow-lg);
    will-change: transform, scale;
    cursor: pointer;
    position: relative;
  }

  .play-button::after {
    content: "Play artist";
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  /* tooltip for "Resume artist" */
  .artist-card.paused .play-button::after {
    content: "Resume artist";
  }

  .play-button:hover::after {
    opacity: 1;
  }

  .artist-avatar:hover .play-button {
    transform: translateY(0);
  }

  .play-button:hover {
    transform: translateY(0) scale(1.05);
  }

  /* Playing indicator */
  .playing-indicator-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    pointer-events: auto;
  }

  .playing-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 48px;
    height: 48px;
    background-color: var(--accent-primary);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    transition: transform var(--transition-fast);
    position: relative;
  }

  .playing-indicator:hover {
    transform: scale(1.05);
  }

  .playing-indicator .bar {
    width: 4px;
    height: 16px;
    background-color: var(--bg-base);
    border-radius: 2px;
    animation: equalizer 0.8s ease-in-out infinite;
  }

  .playing-indicator .bar:nth-child(2) {
    animation-delay: 0.2s;
  }

  .playing-indicator .bar:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes equalizer {
    0%,
    100% {
      height: 6px;
    }
    50% {
      height: 20px;
    }
  }

  /* Pause button overlay */
  .pause-button-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--accent-primary);
    border-radius: var(--radius-full);
    opacity: 0;
    transition: opacity var(--transition-fast);
    color: var(--bg-base);
    border: none;
    padding: 0;
    cursor: pointer;
  }

  /* tooltip to pause button */
  .pause-button-overlay::after {
    content: "Pause";
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-fast);
    box-shadow: var(--shadow-md);
    z-index: 1000;
  }

  .playing-indicator-container:hover .pause-button-overlay {
    opacity: 1;
  }

  .pause-button-overlay:hover::after {
    opacity: 1;
  }

  .artist-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    width: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .artist-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .artist-card.now-playing .artist-name {
    color: var(--accent-primary);
  }

  .artist-card.paused .artist-name {
    color: var(--accent-primary);
  }

  .artist-meta {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .artist-card.now-playing .artist-meta {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .artist-card.paused .artist-meta {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .artist-card {
      padding: var(--spacing-sm);
      gap: var(--spacing-sm);
    }

    .artist-avatar {
      width: 100px;
      height: 100px;
    }

    .artist-initial {
      font-size: 2rem;
    }

    .artist-name {
      font-size: 0.875rem;
    }

    .artist-meta {
      font-size: 0.75rem;
    }

    .now-playing-badge {
      font-size: 0.625rem;
      padding: 2px 6px;
    }
  }
</style>
