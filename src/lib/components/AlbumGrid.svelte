<script lang="ts">
    import type { Album } from "$lib/api/tauri";
    import { goToAlbumDetail } from "$lib/stores/view";
    import { loadLibrary, getAlbumCoverFromTracks, loadMoreAlbums } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { deleteAlbum, getTracksByAlbum } from "$lib/api/tauri";
    import { playTracks, currentAlbumId, isPlaying } from "$lib/stores/player";
    import { onDestroy, onMount } from 'svelte';

    export let albums: Album[] = [];

    // Virtual Scrolling Configuration
    const ALBUM_CARD_WIDTH = 180;
    const GRID_GAP = 24;
    const ALBUM_CARD_HEIGHT = 260;
    const OVERSCAN = 2;

    let containerHeight = 600;
    let containerWidth = 800;
    let scrollTop = 0;
    let containerElement: HTMLDivElement;

    // Extract store values
    $: currentAlbumIdValue = $currentAlbumId;
    $: isPlayingValue = $isPlaying;

    // Cache Structures
    let failedImages = new Set<string>();
    const MAX_FAILED_IMAGES = 200;

    //  library.ts handles this with LRU cache

    // Build album index map for O(1) lookups (like TrackList)
    let albumIndexMap = new Map<number, number>();
    $: {
        albumIndexMap = new Map(
            albums.map((album, index) => [album.id, index])
        );
    }

    // Helper function that accepts parameters 
    function isAlbumPlaying(albumId: number, currentId: number | null, playing: boolean): boolean {
        return currentId === albumId && playing;
    }

    // Cover
    function getAlbumCover(album: Album): string | null {
        return getAlbumCoverFromTracks(album.id);
    }

    // Virtual Scrolling Calculations
    let virtualScrollState = {
        totalHeight: 0,
        columns: 1,
        rowHeight: ALBUM_CARD_HEIGHT,
        startIndex: 0,
        endIndex: 0,
        offsetY: 0,
        visibleAlbums: [] as Album[],
    };

    $: {
        const availableWidth = containerWidth - (GRID_GAP * 2);
        const cardWithGap = ALBUM_CARD_WIDTH + GRID_GAP;
        const columns = Math.max(1, Math.floor((availableWidth + GRID_GAP) / cardWithGap));
        
        const totalRows = Math.ceil(albums.length / columns);
        const rowHeight = ALBUM_CARD_HEIGHT + GRID_GAP;
        const totalHeight = totalRows * rowHeight;
        
        const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / rowHeight) + OVERSCAN);
        
        const startIndex = startRow * columns;
        const endIndex = Math.min(albums.length, endRow * columns);
        const visibleAlbums = albums.slice(startIndex, endIndex);
        const offsetY = startRow * rowHeight;

        virtualScrollState = {
            totalHeight,
            columns,
            rowHeight,
            startIndex,
            endIndex,
            offsetY,
            visibleAlbums,
        };
    }

    // Pre-compute metadata for visible albums
    type AlbumWithMetadata = {
        album: Album;
        coverSrc: string | null;
    };

    let visibleAlbumsWithMetadata: AlbumWithMetadata[] = [];

    $: visibleAlbumsWithMetadata = virtualScrollState.visibleAlbums.map(
        (album) => ({
            album,
            coverSrc: getAlbumCover(album),
        }),
    );

    // Event Handlers
    function handleScroll(e: Event) {
        scrollTop = (e.target as HTMLElement).scrollTop;
    }

    // Event delegation - container
    async function handleBodyClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        
        // Check if play button was clicked
        const playButton = target.closest('.play-button');
        if (playButton) {
            e.stopPropagation();
            const card = playButton.closest('.album-card');
            if (!card) return;

            const albumId = parseInt(card.getAttribute('data-album-id') || '0');
            if (!albumId) return;

            // Don't restart if already playing
            if (isAlbumPlaying(albumId, currentAlbumIdValue, isPlayingValue)) {
                return;
            }

            // Load tracks and play
            try {
                const tracks = await getTracksByAlbum(albumId);
                if (tracks.length > 0) {
                    const album = albums.find(a => a.id === albumId);
                    playTracks(tracks, 0, {
                        type: 'album',
                        albumId: albumId,
                        displayName: album?.name ?? 'Album'
                    });
                }
            } catch (error) {
                console.error('Failed to load tracks for album:', error);
            }
            return;
        }

        // Otherwise, navigate to album detail
        const card = target.closest('.album-card');
        if (!card) return;

        const albumId = parseInt(card.getAttribute('data-album-id') || '0');
        if (!albumId) return;

        goToAlbumDetail(albumId);
    }

    // Event delegation - context menu handler on container
    async function handleBodyContextMenu(e: MouseEvent) {
        const card = (e.target as HTMLElement).closest('.album-card');
        if (!card) return;

        e.preventDefault();

        const albumId = parseInt(card.getAttribute('data-album-id') || '0');
        const albumIndex = albumIndexMap.get(albumId);
        
        if (albumIndex === undefined) return;
        
        const album = albums[albumIndex];
        if (!album) return;

        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Play",
                    action: async () => {
                        try {
                            const tracks = await getTracksByAlbum(album.id);
                            if (tracks.length > 0) {
                                playTracks(tracks, 0, {
                                    type: 'album',
                                    albumId: album.id,
                                    displayName: album.name
                                });
                            }
                        } catch (error) {
                            console.error('Failed to load tracks for album:', error);
                        }
                    },
                },
                { type: "separator" },
                {
                    label: "Delete Album",
                    danger: true,
                    action: async () => {
                        try {
                            await deleteAlbum(album.id);
                            await loadLibrary();
                        } catch (error) {
                            console.error("Failed to delete album:", error);
                        }
                    },
                },
            ],
        });
    }

    // image error handler
    function handleImageError(e: Event) {
        const img = e.target as HTMLImageElement;
        const coverSrc = img.src;
        
        if (failedImages.size >= MAX_FAILED_IMAGES) {
            const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
            failedImages.clear();
            toKeep.forEach(src => failedImages.add(src));
        }
        
        failedImages.add(coverSrc);
        failedImages = failedImages; // Trigger reactivity
        
        // Start cleanup interval if needed
        startCleanupInterval();
    }

    // Cleanup
    let cleanupInterval: number | undefined;
    let resizeObserver: ResizeObserver | undefined;

    function startCleanupInterval() {
        if (cleanupInterval || typeof window === "undefined") return;

        cleanupInterval = window.setInterval(() => {
            if (failedImages.size > MAX_FAILED_IMAGES) {
                const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
                failedImages.clear();
                toKeep.forEach((src) => failedImages.add(src));
                failedImages = failedImages;
            }

            if (failedImages.size === 0 && cleanupInterval) {
                clearInterval(cleanupInterval);
                cleanupInterval = undefined;
            }
        }, 300000);
    }

    // Use ResizeObserver
    onMount(() => {
        if (containerElement) {
            const updateDimensions = () => {
                containerHeight = containerElement.clientHeight;
                containerWidth = containerElement.clientWidth;
            };
            updateDimensions();

            // Use ResizeObserver for better performance
            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(updateDimensions);
                resizeObserver.observe(containerElement);
            } else {
                // Fallback to window resize
                window.addEventListener("resize", updateDimensions);
                return () => {
                    window.removeEventListener("resize", updateDimensions);
                };
            }
        }
    });

    // cleanup on destroy
    onDestroy(() => {
        // Clear lazy-loaded images
        if (containerElement) {
            const images = containerElement.querySelectorAll('img');
            images.forEach(img => {
                img.src = '';
            });
        }

        // Clear remaining caches
        failedImages.clear();
        albumIndexMap.clear();

        // Clear intervals
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = undefined;
        }

        // Disconnect ResizeObserver
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = undefined;
        }

        // Force cleanup of container reference
        containerElement = undefined as any;
    });

// Infinite Scroll

let isLoadingMore = false;
let hasMoreAlbums = true;

async function loadMoreAlbumsIfNeeded() {
    if (isLoadingMore || !hasMoreAlbums) return;

    // Check if we're near the bottom
    const threshold = virtualScrollState.totalHeight * 0.8;
    if (scrollTop + containerHeight < threshold) return;

    isLoadingMore = true;
    try {
        const loaded = await loadMoreAlbums();
        hasMoreAlbums = loaded;
    } catch (error) {
        console.error('[AlbumGrid] Failed to load more albums:', error);
    } finally {
        isLoadingMore = false;
    }
}

// Add to existing reactive statement for scroll
$: {
    if (scrollTop > 0) {
        loadMoreAlbumsIfNeeded();
    }
}
</script>

{#if albums.length > 0}
    <div
        class="album-grid-container"
        on:scroll={handleScroll}
        on:click={handleBodyClick}
        on:contextmenu={handleBodyContextMenu}
        bind:this={containerElement}
    >
        <div
            class="virtual-spacer"
            style="height: {virtualScrollState.totalHeight}px;"
        >
            <div
                class="virtual-content"
                style="
                    transform: translateY({virtualScrollState.offsetY}px);
                    grid-template-columns: repeat({virtualScrollState.columns}, minmax(180px, 1fr));
                "
            >
            {#each visibleAlbumsWithMetadata as { album, coverSrc } (album.id)}
                <div
                    class="album-card"
                    class:now-playing={isAlbumPlaying(album.id, currentAlbumIdValue, isPlayingValue)}
                    data-album-id={album.id}
                    role="button"
                    tabindex="0"
                >
                    <div class="album-art">
                        {#if coverSrc && !failedImages.has(coverSrc)}
                            <img
                                src={coverSrc}
                                alt={album.name}
                                decoding="async"
                                on:error={handleImageError}
                            />
                        {:else}
                            <div class="album-art-placeholder">
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
                        {#if isAlbumPlaying(album.id, currentAlbumIdValue, isPlayingValue)}
                            <div class="now-playing-badge">
                                Now Playing
                            </div>
                        {/if}
                        <div class="play-overlay">
                            {#if isAlbumPlaying(album.id, currentAlbumIdValue, isPlayingValue)}
                                <div class="playing-indicator">
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                </div>
                            {:else}
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
                    <div class="album-info">
                        <span class="album-name truncate">{album.name}</span>
                        <span class="album-artist truncate"
                            >{album.artist || "Unknown Artist"}</span
                        >
                    </div>
                </div>
            {/each}
            </div>
        </div>
    </div>
{:else}
    <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" aria-hidden="true">
            <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
            />
        </svg>
        <h3>No albums found</h3>
        <p>Add a music folder to see your albums</p>
    </div>
{/if}

<style>
    .album-grid-container {
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        padding: var(--spacing-md);
        will-change: scroll-position;
    }

    .virtual-spacer {
        position: relative;
        width: 100%;
    }

    .virtual-content {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        will-change: transform;
        display: grid;
        gap: var(--spacing-lg);
        contain: layout style paint;
    }

    .album-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: left;
        display: flex;
        flex-direction: column;
        width: 100%;
        contain: layout style;
        cursor: pointer;
    }

    .album-card:hover {
        background-color: var(--bg-surface);
    }

    .album-card.now-playing {
        background-color: var(--accent-subtle);
    }

    .album-card.now-playing:hover {
        background-color: var(--accent-subtle);
        opacity: 0.95;
    }

    .album-art {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background-color: var(--bg-surface);
        margin-bottom: var(--spacing-md);
        box-shadow: var(--shadow-md);
        flex-shrink: 0;
        isolation: isolate;
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: auto;
    }

    .album-art-placeholder {
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
        pointer-events: none;
        z-index: 2;
    }

    .play-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity var(--transition-fast);
        pointer-events: none;
    }

    .album-card:hover .play-overlay {
        opacity: 1;
        pointer-events: auto;
    }

    .album-card.now-playing .play-overlay {
        opacity: 1;
        pointer-events: auto;
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
        transition: transform var(--transition-fast), scale var(--transition-fast);
        box-shadow: var(--shadow-lg);
        will-change: transform, scale;
        cursor: pointer;
        position: relative;
    }

    .play-button::after {
        content: 'Play album';
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

    .play-button:hover::after {
        opacity: 1;
    }

    .album-card:hover .play-button {
        transform: translateY(0);
    }

    .play-button:hover {
        transform: translateY(0) scale(1.05);
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

    .album-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        min-height: 0;
        overflow: hidden;
    }

    .album-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .album-artist {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .album-card.now-playing .album-name,
    .album-card.now-playing .album-artist {
        color: var(--accent-primary);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
        height: 100%;
    }

    .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: 0.875rem;
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>