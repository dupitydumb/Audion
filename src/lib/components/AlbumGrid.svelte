<script lang="ts">
    import type { Album } from "$lib/api/tauri";
    import { goToAlbumDetail, goToArtistDetail } from "$lib/stores/view";
    import { formatArtists } from "$lib/utils/artists";
    import {
        getAlbumCoverFromTracks,
        loadMoreAlbums,
    } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { getTracksByAlbum } from "$lib/api/tauri";
    import {
        playTracks,
        currentAlbumId,
        isPlaying,
        togglePlay,
    } from "$lib/stores/player";
    import VirtualizedGrid from "./Virtualizedgrid.svelte";
    import MediaCard from "./MediaCard.svelte";
    import { onDestroy } from "svelte";
    import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
    import { pinnedItems, isPinned } from "$lib/stores/pinned";
    import { buildAlbumContextMenu } from "$lib/menus/contextMenus";
    import { _ } from "svelte-i18n";

    let currentScrollTop = getScroll("albums");

    onDestroy(() => {
        saveScroll("albums", currentScrollTop);
    });

    export let albums: Album[] = [];

    // Playback state
    $: playingAlbumId = $currentAlbumId;
    $: playing = $isPlaying;
    $: pausedAlbumId = !playing ? playingAlbumId : null;

    // Sorting/Pinning logic
    $: sortedAlbums = [...albums].sort((a, b) => {
        const aPinned = isPinned("album", a.id, $pinnedItems);
        const bPinned = isPinned("album", b.id, $pinnedItems);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0; // Maintain original order if both same
    });

    // Image error cache
    let failedImages = new Set<string>();
    const MAX_FAILED_IMAGES = 200;

    function handleImageError(e: Event) {
        const img = e.target as HTMLImageElement;
        if (failedImages.size >= MAX_FAILED_IMAGES) {
            const toKeep = Array.from(failedImages).slice(
                -MAX_FAILED_IMAGES / 2,
            );
            failedImages.clear();
            toKeep.forEach((s) => failedImages.add(s));
        }
        failedImages.add(img.src);
        failedImages = failedImages;
    }

    // Playback
    async function playAlbum(album: Album) {
        if (pausedAlbumId === album.id) {
            togglePlay();
            return;
        }
        if (playingAlbumId === album.id && playing) return;
        try {
            const tracks = await getTracksByAlbum(album.id);
            if (tracks.length > 0) {
                playTracks(tracks, 0, {
                    type: "album",
                    albumId: album.id,
                    displayName: album.name,
                });
            }
        } catch (err) {
            console.error("Failed to load tracks for album:", err);
        }
    }

    // Navigation
    function handleAlbumClick(album: Album, e: MouseEvent) {
        if ((e.target as HTMLElement).closest("[data-mediacard-play]")) return;
        goToAlbumDetail(album.id);
    }

    function handleAlbumContextMenu(album: Album, e: MouseEvent) {
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildAlbumContextMenu({
                album,
                showPlay: true,
                showDelete: true,
                onPlay: playAlbum,
                t: $_,
            }),
        });
    }

    async function handleLoadMore(): Promise<boolean> {
        return await loadMoreAlbums();
    }

    const emptyState = {
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>`,
        title: "No albums found",
        description: "Add a music folder to see your albums",
    };
</script>

<VirtualizedGrid
    items={sortedAlbums}
    bind:currentScrollTop
    initialScrollTop={currentScrollTop}
    onItemClick={handleAlbumClick}
    onItemContextMenu={handleAlbumContextMenu}
    onLoadMore={handleLoadMore}
    emptyStateConfig={emptyState}
    columnsBreakpoint={924}
    columnsBelow={2}
    let:item={album}
>
    {@const cover = getAlbumCoverFromTracks(album.id)}
    {@const isNowPlaying = playingAlbumId === album.id && playing}
    {@const isPaused = pausedAlbumId === album.id}

    <MediaCard
        {isNowPlaying}
        {isPaused}
        isPinned={isPinned("album", album.id, $pinnedItems)}
        playTooltip="Play album"
        resumeTooltip="Resume album"
        pauseTooltip="Pause"
        ariaLabel={album.name}
        primaryText={album.name}
        secondaryText={formatArtists(album.artists) || album.artist || "Unknown Artist"}
        secondaryAction={album.artist
            ? () => goToArtistDetail((album.artists && album.artists[0]) || album.artist!)
            : null}
        on:play={() => playAlbum(album)}
        on:pause={togglePlay}
    >
        <svelte:fragment slot="cover">
            {#if cover && !failedImages.has(cover)}
                <img
                    src={cover}
                    alt={album.name}
                    loading="lazy"
                    decoding="async"
                    on:error={handleImageError}
                />
            {:else}
                <div class="placeholder">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="48"
                        height="48"
                        aria-hidden="true"
                    >
                        <path
                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                        />
                    </svg>
                </div>
            {/if}
        </svelte:fragment>
    </MediaCard>
</VirtualizedGrid>

<style>
    .placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background: linear-gradient(
            135deg,
            var(--bg-surface) 0%,
            var(--bg-highlight) 100%
        );
    }
</style>
