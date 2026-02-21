<script lang="ts">
    import { getLikedTracks, type Track } from "$lib/api/tauri";
    import { likedTrackIds } from "$lib/stores/liked";
    import { playTracks } from "$lib/stores/player";
    import TrackList from "./TrackList.svelte";

    let tracks: Track[] = [];
    let loading = true;

    $: loadTracks($likedTrackIds);

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
            playTracks(tracks, 0);
        }
    }
</script>

<div class="liked-songs-view">
    <!-- Header -->
    <div class="liked-header">
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
            <span class="liked-count">{tracks.length} songs</span>
        </div>
    </div>

    <!-- Controls -->
    <div class="liked-controls">
        <button
            class="play-all-btn"
            on:click={handlePlayAll}
            disabled={tracks.length === 0}
        >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M8 5v14l11-7z" />
            </svg>
            Play All
        </button>
    </div>

    <!-- Track List -->
    <div class="liked-body">
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
            <TrackList {tracks} title="Liked Songs" showAlbum={true} />
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
        align-items: flex-end;
        gap: var(--spacing-lg);
        padding: 40px var(--spacing-xl) var(--spacing-lg);
        background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent-primary) 45%, var(--bg-base)) 0%,
            var(--bg-base) 100%
        );
        flex-shrink: 0;
    }

    .liked-gradient-bg {
        width: 160px;
        height: 160px;
        background: linear-gradient(
            135deg,
            var(--accent-primary),
            color-mix(in srgb, var(--accent-primary) 60%, var(--bg-base))
        );
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-lg);
        color: var(--text-primary);
    }

    .liked-header-info {
        display: flex;
        flex-direction: column;
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
        font-size: 3rem;
        font-weight: 900;
        color: var(--text-primary);
        margin: 0;
        line-height: 1.1;
    }

    .liked-count {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-top: var(--spacing-xs);
    }

    /* Controls */
    .liked-controls {
        padding: var(--spacing-md) var(--spacing-xl);
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        background-color: var(--bg-base);
        flex-shrink: 0;
    }

    .play-all-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-lg);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        font-weight: 600;
        border: none;
        border-radius: var(--radius-full);
        font-size: 0.9rem;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .play-all-btn:hover:not(:disabled) {
        background-color: var(--accent-hover);
        transform: scale(1.04);
    }

    .play-all-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
