<script lang="ts">
    import type { Album } from "$lib/api/tauri";
    import { goToAlbumDetail } from "$lib/stores/view";
    import { loadLibrary, getAlbumCoverFromTracks, loadMoreAlbums } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { deleteAlbum, getTracksByAlbum } from "$lib/api/tauri";
    import { playTracks, currentAlbumId, isPlaying, togglePlay } from "$lib/stores/player";
    import VirtualizedGrid from "./Virtualizedgrid.svelte";
    import { onDestroy } from 'svelte';

    export let albums: Album[] = [];

    // Cache for failed images
    let failedImages = new Set<string>();
    const MAX_FAILED_IMAGES = 200;

    // Extract store values
    $: playingAlbumId = $currentAlbumId;
    $: playing = $isPlaying;
    
    // Determine if this album is the current one and paused
    function isAlbumPaused(albumId: number): boolean {
        return playingAlbumId === albumId && !playing;
    }

    function handlePauseClick(e: MouseEvent) {
        e.stopPropagation();
        togglePlay();
    }

    function getAlbumCover(album: Album): string | null {
        return getAlbumCoverFromTracks(album.id);
    }

    async function handleAlbumClick(album: Album, e: MouseEvent) {
        const target = e.target as HTMLElement;
        
        // Check if play button was clicked
        const playButton = target.closest('.play-button');
        if (playButton) {
            e.stopPropagation();
            
            // If paused, resume playback
            if (isAlbumPaused(album.id)) {
                togglePlay();
                return;
            }

            // Don't restart if already playing
            if (playingAlbumId === album.id && playing) {
                return;
            }

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
            return;
        }

        // Otherwise, navigate to album detail
        goToAlbumDetail(album.id);
    }

    async function handleAlbumContextMenu(album: Album, e: MouseEvent) {
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
        failedImages = failedImages;
    }

    async function handleLoadMore(): Promise<boolean> {
        return await loadMoreAlbums();
    }

    const emptyState = {
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>`,
        title: "No albums found",
        description: "Add a music folder to see your albums"
    };

    // Cleanup on component destroy
    onDestroy(() => {
        failedImages.clear();
    });
</script>

<VirtualizedGrid
    items={albums}
    onItemClick={handleAlbumClick}
    onItemContextMenu={handleAlbumContextMenu}
    onLoadMore={handleLoadMore}
    emptyStateConfig={emptyState}
    let:item={album}
>
    <div
        class="album-card"
        class:now-playing={playingAlbumId === album.id && playing}
        class:paused={isAlbumPaused(album.id)}
    >
        <div class="album-art">
            {#if getAlbumCover(album) && !failedImages.has(getAlbumCover(album) || '')}
                <img
                    src={getAlbumCover(album)}
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
            {#if playingAlbumId === album.id && playing}
                <div class="now-playing-badge">
                    Now Playing
                </div>
            {:else if isAlbumPaused(album.id)}
                <div class="now-playing-badge paused-badge">
                    Paused
                </div>
            {/if}
            
            {#if playingAlbumId === album.id && playing}
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
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                    </button>
                </div>
            {/if}
            <!-- Darkening overlay -->
            <div class="album-art-overlay" class:is-playing={playingAlbumId === album.id && playing}>
                {#if !(playingAlbumId === album.id && playing)}
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
            <span class="album-artist truncate">{album.album_artist || "Unknown Artist"}</span>
        </div>
    </div>
</VirtualizedGrid>

<style>
    .album-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: left;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
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

    /* Paused state */
    .album-card.paused {
        background-color: var(--accent-subtle);
    }

    .album-card.paused:hover {
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
        max-height: calc(100% - 60px);
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

    .now-playing-badge.paused-badge {
        background-color: var(--text-secondary);
    }

    .album-art-overlay {
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

    /* Show overlay when hovering the album-art */
    .album-art:hover .album-art-overlay {
        opacity: 1;
        pointer-events: auto;
    }

    /* hide darkening overlay by default */
    .album-art-overlay.is-playing {
        opacity: 0;
        background: transparent;
    }

    .album-art:hover .album-art-overlay.is-playing {
        opacity: 1;
        background: rgba(0, 0, 0, 0.5);
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

    /* tooltip for "Resume album */
    .album-card.paused .play-button::after {
        content: "Resume album";
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

    .album-card.paused .album-name,
    .album-card.paused .album-artist {
        color: var(--accent-primary);
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Mobile ── */
    @media (max-width: 768px) {
        .album-card {
            padding: var(--spacing-sm);
        }

        .album-art {
            margin-bottom: var(--spacing-sm);
        }

        .album-name {
            font-size: 0.8125rem;
        }

        .album-artist {
            font-size: 0.75rem;
        }

        /* Hide play overlay on mobile — tapping the card navigates */
        .play-overlay {
            display: none;
        }

        .now-playing-badge {
            font-size: 0.625rem;
            padding: 2px 6px;
        }
    }
</style>