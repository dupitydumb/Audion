<script lang="ts">
    import { getLikedTracks, exportLikedSongsZip, type Track } from "$lib/api/tauri";
    import { likedTrackIds } from "$lib/stores/liked";
    import { playTracks, shuffle, addToQueue } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import { addToast } from "$lib/stores/toast";
    import { buildLikedSongsContextMenu } from "$lib/menus/contextMenus";
    import { _ } from "svelte-i18n";
    import TrackList from "./track-list/TrackList.svelte";
    import Icon from "$lib/components/Icon.svelte";

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

    async function handleExportZip() {
        if (tracks.length === 0) return;
        try {
            addToast("Exporting…", "info");
            const result = await exportLikedSongsZip();
            if (!result) return; // user cancelled picker
            const { track_count, skipped_count } = result;
            const exported = track_count - skipped_count;
            const skippedMsg = skipped_count > 0
                ? ` (${skipped_count} streaming-only track${skipped_count === 1 ? "" : "s"} skipped)`
                : "";
            addToast(`Exported ${exported} track${exported === 1 ? "" : "s"}${skippedMsg}`, "success");
        } catch (err) {
            console.error("[LikedSongs] exportZip failed:", err);
            addToast(`Export failed: ${err}`, "error");
        }
    }

    function handleHeaderContextMenu(e: MouseEvent) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildLikedSongsContextMenu({
                tracks,
                onPlay: handlePlayAll,
                onAddToQueue: () => {
                    if (tracks.length > 0) addToQueue(tracks);
                },
                onExportZip: handleExportZip,
                t: $_,
            }),
        });
    }

    function handleScroll(e: Event) {
        scrollTop = (e.target as HTMLElement).scrollTop;
    }
</script>

<div class="liked-songs-view">
    <!-- Header -->
    <header
        class="liked-header"
        class:is-small={isHeaderSmall}
        style:opacity={headerOpacity}
        style:transform="translateY({headerTranslateY}px) scale({headerScale})"
        on:contextmenu={handleHeaderContextMenu}
        aria-label="Liked Songs header"
    >
        <div class="liked-gradient-bg">
            <Icon name="heart-filled" size={64} />
        </div>
        <div class="liked-header-info">
            <span class="liked-label"
                >{$_("common.playlist")}</span
            >
            <h1 class="liked-title">
                {$_("sidebar.likedSongs")}
            </h1>
            <div class="liked-count-container">
                <span class="liked-count"
                    >{$_("liked.songsCount", { values: { count: tracks.length } })}</span
                >
            </div>
        </div>
    </header>

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
                    <Icon name="play" size={24} />
                </div>
                <span>{$_("artist.playAll")}</span>
            </button>

            <button
                class="shuffle-btn"
                on:click={handleShufflePlay}
                disabled={tracks.length === 0}
                aria-label="Shuffle Play"
            >
                <Icon name="shuffle" size={20} />
                <span>{$_("liked.shuffle")}</span>
            </button>
        </div>
    </div>

    <!-- Track List -->
    <div class="liked-body" on:scroll={handleScroll}>
        {#if loading}
            <div class="loading">
                {$_("liked.loading")}
            </div>
        {:else if tracks.length === 0}
            <div class="empty-state">
                <Icon name="heart" size={48} strokeWidth={1.5} />
                <p>
                    {$_("liked.emptyTitle")}
                </p>
                <span class="empty-hint"
                    >{$_("liked.emptyHint")}</span
                >
            </div>
        {:else}
            <TrackList
                {tracks}
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
        pointer-events: auto;
    }

    .liked-header.is-small {
        padding-top: 15px;
        padding-bottom: 5px;
        pointer-events: auto;
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
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
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
        font-weight: var(--font-weight-medium);
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
        font-weight: var(--font-weight-bold);
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
        font-weight: var(--font-weight-semibold);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        font-size: var(--font-size-md);
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
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
    }

    .empty-hint {
        font-size: var(--font-size-base);
        color: var(--text-secondary);
    }

    :global(html.layout-mobile) .liked-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: calc(var(--safe-area-top) + var(--spacing-md))
            var(--spacing-md) var(--spacing-md);
    }

    :global(html.layout-mobile) .liked-gradient-bg {
        width: 120px;
        height: 120px;
    }

    :global(html.layout-mobile) .liked-title {
        font-size: 2rem;
    }
</style>
