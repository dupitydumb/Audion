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
  import { contextMenu } from "$lib/stores/ui";
  import VirtualizedGrid from "./Virtualizedgrid.svelte";
  import MediaCard from "./MediaCard.svelte";
  import { onDestroy } from "svelte";
  import { saveScroll, getScroll } from '$lib/stores/scrollMemory';

  let currentScrollTop = getScroll('artists');

  export let artists: Artist[] = [];

  // Playback state
  $: playingArtistName = $currentArtistName;
  $: playing = $isPlaying;
  $: pausedArtistName = !playing ? playingArtistName : null;

  // Picture
  let resolvedPictures = new Map<string, string | null>();
  let failedImages = new Set<string>();
  const MAX_FAILED_IMAGES = 200;
  const CONCURRENCY = 5;

  let currentRunId = 0;

  async function resolveArtistPictures(artistList: Artist[]) {
    const runId = ++currentRunId;
    const unresolved = artistList.filter((a) => !resolvedPictures.has(a.name));
    if (unresolved.length === 0) return;

    try {
      for (let i = 0; i < unresolved.length; i += CONCURRENCY) {
        if (runId !== currentRunId) return;
        const chunk = unresolved.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (artist) => {
            const url = await fetchArtistPicture(artist.name);
            if (runId !== currentRunId) return;
            resolvedPictures.set(artist.name, url);
          }),
        );
        resolvedPictures = resolvedPictures;
      }
    } catch (err) {
      console.error("Failed to resolve artist pictures:", err);
    }
  }

  async function fetchArtistPicture(artistName: string): Promise<string | null> {
    try {
      const plugin = (window as any).tidalSearchPlugin;
      if (!plugin) return null;
      return (await plugin.searchArtistPictureForRPC(artistName)) ?? null;
    } catch {
      return null;
    }
  }

  $: resolveArtistPictures(artists);

  function handleImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    if (failedImages.size >= MAX_FAILED_IMAGES) {
      const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
      failedImages.clear();
      toKeep.forEach((s) => failedImages.add(s));
    }
    failedImages.add(img.src);
    failedImages = failedImages;
  }

  // Playback
  async function playArtist(artist: Artist) {
    if (pausedArtistName === artist.name) {
      togglePlay();
      return;
    }
    if (playingArtistName === artist.name && playing) return;
    try {
      const tracks = await getTracksByArtist(artist.name);
      if (tracks.length > 0) {
        playTracks(tracks, 0, {
          type: "artist",
          artistName: artist.name,
          displayName: artist.name,
        });
      }
    } catch (err) {
      console.error("Failed to load tracks for artist:", err);
    }
  }

  // Click
  function handleArtistClick(artist: Artist, e: MouseEvent) {
    // The play button inside MediaCard 
    if ((e.target as HTMLElement).closest("[data-mediacard-play]")) return;
    goToArtistDetail(artist.name);
  }

  function handleArtistContextMenu(artist: Artist, e: MouseEvent) {
    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Play",
          action: () => playArtist(artist),
        },
        { type: "separator" },
        {
          label: "Add to Playlist",
          // TODO: implement playlist logic
          action: () => {},
        },
      ],
    });
  }

  function getArtistInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  const emptyState = {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
    title: "No artists found",
    description: "Add a music folder to see your artists",
  };

  onDestroy(() => {
      saveScroll('artists', currentScrollTop);
      currentRunId++;
      resolvedPictures.clear();
      failedImages.clear();
  });
</script>

<VirtualizedGrid
  items={artists}
  bind:currentScrollTop
  initialScrollTop={currentScrollTop}
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
  {@const pictureUrl = resolvedPictures.get(artist.name) ?? null}
  {@const isNowPlaying = playingArtistName === artist.name && playing}
  {@const isPaused = pausedArtistName === artist.name}

  <MediaCard
    {isNowPlaying}
    {isPaused}
    playTooltip="Play artist"
    resumeTooltip="Resume artist"
    pauseTooltip="Pause"
    ariaLabel={artist.name}
    primaryText={artist.name}
    secondaryText="{artist.album_count} albums • {artist.track_count} songs"
    variant="round"
    coverBackground="linear-gradient(135deg, var(--accent-primary) 0%, #1a1a1a 100%)"
    on:play={() => playArtist(artist)}
    on:pause={togglePlay}
  >
    <svelte:fragment slot="cover">
      {#if pictureUrl && !failedImages.has(pictureUrl)}
        <img
          src={pictureUrl}
          alt={artist.name}
          loading="lazy"
          decoding="async"
          on:error={handleImageError}
        />
      {:else}
        <span class="artist-initial" aria-hidden="true">
          {getArtistInitial(artist.name)}
        </span>
      {/if}
    </svelte:fragment>
  </MediaCard>
</VirtualizedGrid>

<style>
  .artist-initial {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  @media (max-width: 768px) {
    .artist-initial { font-size: 2rem; }
  }
</style>