<script lang="ts">
    import { getLikedTracks, type Track } from "$lib/api/tauri";
    import { likedTrackIds } from "$lib/stores/liked";
    import { playTracks, shuffle } from "$lib/stores/player";
    import TrackList from "./TrackList.svelte";

    let tracks: Track[] = [];
    let loading = true;
    let scrollTop = 0;

    $: loadTracks($likedTrackIds);

    // Header transition calculations
    $: headerOpacity = Math.max(0, 1 - scrollTop / 150);
    $: headerScale = Math.max(0.85, 1 - scrollTop / 800);
    $: headerTranslateY = -scrollTop * 0.4;
    $: isHeaderSmall = scrollTop > 60;

    async function loadTracks(_ids: Set<number>) {
        try {
            tracks = await getLikedTracks();
        } catch (error) {
            console.error("[LikedSongs] Failed to load:", error);
        } finally {
            loading = false;
        }
    }

    function handlePlayAll() {
        if (tracks.length > 0) {
            shuffle.set(false);
            playTracks(tracks, 0);
        }
    }

    function handleShufflePlay() {
        if (tracks.length > 0) {
            shuffle.set(true);
            const randomIndex = Math.floor(Math.random() * tracks.length);
            playTracks(tracks, randomIndex);
        }
    }
    function handleScroll(e: Event) {
        scrollTop = (e.target as HTMLElement).scrollTop;
    }
</script>

<div class="liked-songs-view">
    <!-- Header -->
    <div
        class="liked-header"
        class:is-small={isHeaderSmall}
        style:opacity={headerOpacity}
        style:transform="translateY({headerTranslateY}px) scale({headerScale})"
    >
        <div class="liked-gradient-bg">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                <path
                    d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                />
            </svg>
        </div>
        <div class="liked-header-info">
            <span class="liked-label">PLAYLIST</span>
            <h1 class="liked-title">Liked Songs</h1>
            <div class="liked-count-container">
                <span class="liked-count">{tracks.length} songs</span>
            </div>
        </div>
    </div>

    <!-- Controls -->
    <div class="liked-controls">
        <div class="controls-wrapper">
            <button
                class="play-all-btn"
                on:click={handlePlayAll}
                disabled={tracks.length === 0}
                aria-label="Play All"
            >
                <div class="btn-icon">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="24"
                        height="24"
                    >
                        <path d="M8 5v14l11-7z" />
                    </svg>
                </div>
                <span>Play All</span>
            </button>

            <button
                class="shuffle-btn"
                on:click={handleShufflePlay}
                disabled={tracks.length === 0}
                aria-label="Shuffle Play"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                >
                    <path
                        d="M10.59 9.17L5.41 4L4 5.41l5.17 5.17l1.42-1.41zM14.5 4l2.04 2.04L4 18.59L5.41 20L17.96 7.45L20 9.5V4h-5.5zm.33 9.41l-1.41 1.41l3.13 3.13L14.5 20H20v-5.5l-2.04 2.04l-3.13-3.13z"
                    />
                </svg>
                <span>Shuffle</span>
            </button>
        </div>
    </div>

    <!-- Track List -->
    <div class="liked-body" on:scroll={handleScroll}>
        {#if loading}
            <div class="loading">Loading liked songs...</div>
        {:else if tracks.length === 0}
            <div class="empty-state">
                <svg
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                >
                    <path
                        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                    />
                </svg>
                <p>Songs you like will appear here</p>
                <span class="empty-hint"
                    >Find songs and tap the heart icon to save them.</span
                >
            </div>
        {:else}
            <TrackList
                {tracks}
                title="Liked Songs"
                showAlbum={true}
                scrollKey="liked-songs"
            />
        {/if}
    </div>
</div>

<style>
    .liked-songs-view {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--bg-base);
    }

    /* Header */
    .liked-header {
        display: flex;
        flex-direction: column; /* Center alignment stack */
        align-items: center;
        text-align: center;
        gap: var(--spacing-md);
        padding: 30px var(--spacing-xl) 15px;
        background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent-primary) 20%, transparent) 0%,
            color-mix(in srgb, var(--accent-primary) 5%, transparent) 50%,
            var(--bg-base) 100%
        );
        flex-shrink: 0;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        transform-origin: center top;
        z-index: 10;
        pointer-events: none;
    }

    .liked-header.is-small {
        padding-top: 15px;
        padding-bottom: 5px;
        pointer-events: none;
    }

    .liked-gradient-bg {
        width: 130px;
        height: 130px;
        background: linear-gradient(135deg, #450af5, #c4efd9);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        color: white;
        transition: transform var(--transition-normal);
    }

    .liked-songs-view:hover .liked-gradient-bg {
        transform: scale(1.02);
    }

    .liked-header-info {
        display: flex;
        flex-direction: column;
        align-items: center; /* CENTERED */
        gap: var(--spacing-xs);
        padding-bottom: var(--spacing-sm);
    }

    .liked-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-secondary);
    }

    .liked-title {
        font-size: 2.8rem;
        font-weight: 900;
        color: var(--text-primary);
        margin: 0;
        line-height: 1;
        letter-spacing: -0.02em;
    }

    .liked-count-container {
        display: flex;
        justify-content: center;
        width: 100%;
    }

    .liked-count {
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-primary);
        margin-top: var(--spacing-sm);
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .liked-count::before {
        content: "•";
        color: var(--text-secondary);
    }

    /* Controls */
    .liked-controls {
        padding: var(--spacing-lg) var(--spacing-xl);
        background-color: var(--bg-base);
        flex-shrink: 0;
        display: flex;
        justify-content: center; /* CENTERED */
    }

    .controls-wrapper {
        display: flex;
        align-items: center;
        gap: var(--spacing-lg);
        width: 100%;
        max-width: 1200px;
        justify-content: center;
    }

    .play-all-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        height: 56px;
        min-width: 170px;
        padding: 0 32px 0 8px;
        background-color: var(--accent-primary);
        color: white;
        font-weight: 700;
        border: none;
        border-radius: var(--radius-full);
        font-size: 1.05rem;
        cursor: pointer;
        transition: all var(--transition-normal);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .btn-icon {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform var(--transition-fast);
    }

    .play-all-btn:hover:not(:disabled) {
        background-color: var(--accent-hover);
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    }

    .play-all-btn:hover .btn-icon {
        transform: scale(1.1);
        background: rgba(255, 255, 255, 0.2);
    }

    .shuffle-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        height: 56px;
        min-width: 140px;
        padding: 0 28px;
        background-color: transparent;
        color: var(--text-primary);
        font-weight: 600;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        font-size: 1rem;
        cursor: pointer;
        transition: all var(--transition-normal);
    }

    .shuffle-btn:hover:not(:disabled) {
        border-color: var(--text-primary);
        background: rgba(255, 255, 255, 0.05);
        transform: translateY(-1px);
    }

    .play-all-btn:disabled,
    .shuffle-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        filter: grayscale(1);
    }

    /* Body - fills remaining space */
    .liked-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    /* Empty / Loading State */
    .loading,
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 64px var(--spacing-xl);
        color: var(--text-subdued);
        gap: var(--spacing-md);
    }

    .empty-state p {
        font-size: 1.2rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .empty-hint {
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    @media (max-width: 768px) {
        .liked-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: var(--spacing-md);
        }

        .liked-gradient-bg {
            width: 120px;
            height: 120px;
        }

        .liked-title {
            font-size: 2rem;
        }

        .liked-body {
            padding-bottom: calc(
                var(--mobile-bottom-inset) + var(--spacing-md)
            );
        }
    }
</style>
