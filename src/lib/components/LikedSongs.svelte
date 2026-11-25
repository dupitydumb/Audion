<script lang="ts">
    import { getLikedTracks, exportLikedSongsZip, type Track } from "$lib/api/tauri";
    import { likedTrackIds } from "$lib/stores/liked";
    import { playTracks, shuffle, addToQueue, currentTrack, isPlaying, togglePlay } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import { addToast } from "$lib/stores/toast";
    import { isMobile } from "$lib/stores/mobile";
    import { goBack, goToHome, navigationHistory } from "$lib/stores/view";
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
    $: isHeaderSmall = scrollTop > 60;
    $: isScrolledPastHero = scrollTop > 140;
    $: isLikedPlaying = $isPlaying && tracks.some((t) => t.id === $currentTrack?.id);

    function handleBack() {
        if ($navigationHistory.canGoBack) {
            goBack();
        } else {
            goToHome();
        }
    }

    function handlePlayPause() {
        if (isLikedPlaying) {
            togglePlay();
        } else {
            handlePlayAll();
        }
    }

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

    function handleHeaderContextMenu(e: MouseEvent, anchorRect?: DOMRect) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: anchorRect ? anchorRect.left : e.clientX,
            y: anchorRect ? anchorRect.bottom : e.clientY,
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

    function openHeaderMenu(e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        handleHeaderContextMenu(e, rect);
    }

    function handleScroll(e: Event) {
        scrollTop = (e.currentTarget as HTMLElement).scrollTop;
    }
</script>

<div class="liked-songs-view" on:scroll={handleScroll}>
    <!-- Sticky 56px Top Bar -->
    <div
        class="sticky-top-bar"
        class:scrolled={isScrolledPastHero}
        aria-label="Liked Songs navigation"
    >
        <div class="sticky-left">
            <button
                class="top-bar-btn"
                on:click={handleBack}
                aria-label={$_("common.back")}
                title={$_("common.back")}
            >
                <Icon name="arrow-left" size={22} />
            </button>
            <span class="sticky-title" class:revealed={isScrolledPastHero}>
                {$_("sidebar.likedSongs")}
            </span>
        </div>
        <div class="sticky-right">
            <button
                class="sticky-play-btn"
                class:revealed={isScrolledPastHero}
                on:click={handlePlayPause}
                disabled={tracks.length === 0}
                aria-label={isLikedPlaying ? $_("common.pause") : $_("artist.playAll")}
            >
                <Icon name={isLikedPlaying ? "pause" : "play"} size={18} />
            </button>
            <button
                class="top-bar-btn"
                on:click|stopPropagation={openHeaderMenu}
                aria-label={$_("common.more")}
                title={$_("common.more")}
            >
                <Icon name={$isMobile ? "more-vertical" : "more-horizontal"} size={20} />
            </button>
        </div>
    </div>

    <!-- Header -->
    <header
        class="liked-header"
        class:is-small={isHeaderSmall}
        style:opacity={headerOpacity}
        style:transform="scale({headerScale})"
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
    <div class="liked-body">
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
                externalScroll={true}
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
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        position: relative;
    }

    .sticky-top-bar {
        position: sticky;
        top: 0;
        z-index: var(--z-sticky, 100);
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 56px;
        margin-bottom: -56px;
        padding: 0 var(--spacing-sm);
        background: transparent;
        border-bottom: 1px solid transparent;
        transition: background-color 0.22s ease, border-color 0.22s ease;
        flex-shrink: 0;
    }

    .sticky-top-bar.scrolled {
        background: color-mix(in srgb, var(--bg-base) 90%, transparent);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom-color: var(--border-subtle, var(--border-color));
    }

    .sticky-left,
    .sticky-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .sticky-left {
        min-width: 0;
        flex: 1;
    }

    .top-bar-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        border-radius: var(--radius-full);
        background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: background-color var(--transition-fast);
    }

    .sticky-top-bar.scrolled .top-bar-btn {
        background: transparent;
    }

    .top-bar-btn:hover {
        background: var(--surface-subtle-hover, rgba(255, 255, 255, 0.12));
    }

    .sticky-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s ease;
        padding: 0 var(--spacing-xs);
    }

    .sticky-title.revealed {
        opacity: 1;
    }

    .sticky-play-btn {
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        border-radius: var(--radius-full);
        background: var(--accent-primary);
        color: var(--text-on-accent, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform var(--transition-fast);
    }

    .sticky-play-btn.revealed {
        opacity: 1;
        pointer-events: auto;
    }

    /* Header */
    .liked-header {
        display: flex;
        flex-direction: column; /* Center alignment stack */
        align-items: center;
        text-align: center;
        gap: var(--spacing-md);
        padding: 64px var(--spacing-xl) 15px;
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
        color: var(--text-on-accent, #fff);
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

    /* Body - flows naturally in outer scroll container */
    .liked-body {
        flex: 1 0 auto;
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
        padding: calc(56px + var(--spacing-sm)) var(--spacing-md) var(--spacing-sm);
    }

    :global(html.layout-mobile) .liked-gradient-bg {
        width: 120px;
        height: 120px;
    }

    :global(html.layout-mobile) .liked-title {
        font-size: 2rem;
    }

    :global(html.layout-mobile) .liked-controls {
        padding: var(--spacing-md);
    }

    :global(html.layout-mobile) .controls-wrapper {
        gap: var(--spacing-sm);
    }

    :global(html.layout-mobile) .play-all-btn,
    :global(html.layout-mobile) .shuffle-btn {
        flex: 1 1 0;
        min-width: 0;
        max-width: 200px;
        height: 48px;
        padding: 0 var(--spacing-md);
        font-size: var(--font-size-base);
    }

    :global(html.layout-mobile) .btn-icon {
        width: 32px;
        height: 32px;
    }
</style>
