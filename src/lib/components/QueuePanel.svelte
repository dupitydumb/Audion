<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import { isQueueVisible, toggleQueue } from "$lib/stores/ui";
    import { isMobile } from "$lib/stores/mobile";
    import {
        queue,
        queueIndex,
        currentTrack,
        isPlaying,
        playFromQueue,
        removeFromQueue,
        clearUpcoming,
        reorderQueue,
        userQueueCount,
        shuffle,
        shuffledIndices,
        shuffledIndex,
    } from "$lib/stores/player";
    import { albums } from "$lib/stores/library";
    import { formatDuration, getAlbumArtSrc, getTrackCoverSrc, getAlbumCoverSrc } from "$lib/api/tauri";
    import { onMount, onDestroy } from "svelte";

    import type { Track } from "$lib/api/tauri";

    // Virtual scrolling configuration
    const TRACK_ROW_HEIGHT = 56; // pixels
    const OVERSCAN = 5; // Extra rows to render above/below viewport

    let upcomingContainerHeight = 400;
    let upcomingScrollTop = 0;
    let upcomingContainerElement: HTMLDivElement;

    let historyContainerHeight = 300;
    let historyScrollTop = 0;
    let historyContainerElement: HTMLDivElement;

    // Create album map for art lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

    function getTrackArt(track: Track): string | null {
        if (!track) return null;
        
        // Priority 1: Track's file-based cover
        if (track.track_cover_path) return getTrackCoverSrc(track);
        
        // Priority 2: Track's base64 cover - old
        if (track.track_cover) return getAlbumArtSrc(track.track_cover);
        
        // Priority 3: Streaming cover URL
        if (track.cover_url) return track.cover_url;
        
        // Priority 4 & 5: Album art (file-based or base64)
        if (!track.album_id) return null;
        const album = albumMap.get(track.album_id);
        if (!album) return null;
        
        // Priority 4: Album's file-based art
        if (album.art_path) return getAlbumCoverSrc(album);
        
        // Priority 5: Album's base64 art - old
        return album.art_data ? getAlbumArtSrc(album.art_data) : null;
    }

    // Derived queue state for display
    let historyTracks: Array<{ track: Track; index: number }> = [];
    let upcomingTracks: Array<{
        track: Track;
        index: number;
        isPriority: boolean;
    }> = [];

    // Simple reactive statement to rebuild lists when any dependency changes
    $: {
        const q = $queue;
        const qIdx = $queueIndex;
        const uCount = $userQueueCount;
        const isShuffle = $shuffle;
        const sIndices = $shuffledIndices;
        const sIdx = $shuffledIndex;

        // History: always what's before current in absolute playback history?
        // Or based on mode?
        // Traditionally, history is just "what played before".
        // In shuffle mode, "Previous" button goes back in shuffle history.
        // So we should show shuffle history?

        if (isShuffle) {
            historyTracks = sIndices
                .slice(0, sIdx)
                .map((idx) => ({ track: q[idx], index: idx }));
        } else {
            historyTracks = q
                .slice(0, qIdx)
                .map((t, i) => ({ track: t, index: i }));
        }

        // Upcoming
        if (isShuffle) {
            upcomingTracks = [];

            // 1. Priority Tracks (User Queue)
            // These are strictly q[qIdx+1 ... qIdx+uCount]
            for (let i = 1; i <= uCount; i++) {
                const idx = qIdx + i;
                if (idx < q.length) {
                    upcomingTracks.push({
                        track: q[idx],
                        index: idx,
                        isPriority: true,
                    });
                }
            }

            // 2. Shuffled Tracks
            // Start from sIdx + 1
            const remainingShuffled = sIndices.slice(sIdx + 1);

            // We need to filter out tracks that are ALREADY in Priority list.
            // Priority indices are [qIdx+1 ... qIdx+uCount].
            const priorityIndices = new Set<number>();
            for (let i = 1; i <= uCount; i++) priorityIndices.add(qIdx + i);

            for (const idx of remainingShuffled) {
                if (!priorityIndices.has(idx)) {
                    upcomingTracks.push({
                        track: q[idx],
                        index: idx,
                        isPriority: false,
                    });
                }
            }
        } else {
            // Linear Upcoming
            upcomingTracks = q.slice(qIdx + 1).map((t, i) => ({
                track: t,
                index: qIdx + 1 + i,
                isPriority: i < uCount,
            }));
        }
    }

    $: hasUpcoming = upcomingTracks.length > 0;

    // Virtual scroll state for upcoming tracks
    let upcomingVirtualState = {
        totalHeight: 0,
        startIndex: 0,
        endIndex: 0,
        offsetY: 0,
        visibleTracks: [] as typeof upcomingTracks,
    };

    $: {
        const totalHeight = upcomingTracks.length * TRACK_ROW_HEIGHT;
        const startIndex = Math.max(0, Math.floor(upcomingScrollTop / TRACK_ROW_HEIGHT) - OVERSCAN);
        const endIndex = Math.min(
            upcomingTracks.length,
            Math.ceil((upcomingScrollTop + upcomingContainerHeight) / TRACK_ROW_HEIGHT) + OVERSCAN
        );
        const visibleTracks = upcomingTracks.slice(startIndex, endIndex);
        const offsetY = startIndex * TRACK_ROW_HEIGHT;
        upcomingVirtualState = { totalHeight, startIndex, endIndex, offsetY, visibleTracks };
    }

    // Virtual scroll state for history tracks
    let historyVirtualState = {
        totalHeight: 0,
        startIndex: 0,
        endIndex: 0,
        offsetY: 0,
        visibleTracks: [] as typeof historyTracks,
    };

    $: {
        const totalHeight = historyTracks.length * TRACK_ROW_HEIGHT;
        const startIndex = Math.max(0, Math.floor(historyScrollTop / TRACK_ROW_HEIGHT) - OVERSCAN);
        const endIndex = Math.min(
            historyTracks.length,
            Math.ceil((historyScrollTop + historyContainerHeight) / TRACK_ROW_HEIGHT) + OVERSCAN
        );
        const visibleTracks = historyTracks.slice(startIndex, endIndex);
        const offsetY = startIndex * TRACK_ROW_HEIGHT;
        historyVirtualState = { totalHeight, startIndex, endIndex, offsetY, visibleTracks };
    }

    function handleUpcomingScroll(e: Event) {
        upcomingScrollTop = (e.target as HTMLElement).scrollTop;
    }

    function handleHistoryScroll(e: Event) {
        historyScrollTop = (e.target as HTMLElement).scrollTop;
    }

    onMount(() => {
        const observers: ResizeObserver[] = [];
        
        // Set up ResizeObserver for upcoming container
        if (upcomingContainerElement) {
            const updateUpcomingHeight = () => {
                upcomingContainerHeight = upcomingContainerElement.clientHeight;
            };
            updateUpcomingHeight();
            const upcomingObserver = new ResizeObserver(updateUpcomingHeight);
            upcomingObserver.observe(upcomingContainerElement);
            observers.push(upcomingObserver);
        }
        
        // Set up ResizeObserver for history container
        if (historyContainerElement) {
            const updateHistoryHeight = () => {
                historyContainerHeight = historyContainerElement.clientHeight;
            };
            updateHistoryHeight();
            const historyObserver = new ResizeObserver(updateHistoryHeight);
            historyObserver.observe(historyContainerElement);
            observers.push(historyObserver);
        }
        
        return () => {
            observers.forEach(observer => observer.disconnect());
        };
    });

    onDestroy(() => {
        if (cleanupDragListeners) cleanupDragListeners();
    });

    function handlePlayTrack(index: number) {
        playFromQueue(index);
    }

    function handleRemove(index: number) {
        removeFromQueue(index);
    }

    // Pointer-based drag and drop (works better in Tauri webview)
    let draggedIndex: number | null = null;
    let dragOverIndex: number | null = null;
    let isDragging = false;
    let cleanupDragListeners: (() => void) | null = null;

    function handlePointerDown(e: PointerEvent, actualIndex: number) {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        draggedIndex = actualIndex;

        // Capture pointer events
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        // Add global listeners
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);

        cleanupDragListeners = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }

    function handlePointerMove(e: PointerEvent) {
        if (!isDragging || draggedIndex === null) return;

        // Find element under pointer
        const elementsUnderPointer = document.elementsFromPoint(
            e.clientX,
            e.clientY,
        );
        const queueTrack = elementsUnderPointer.find((el) =>
            el.classList.contains("queue-track"),
        );

        if (queueTrack) {
            const indexAttr = queueTrack.getAttribute("data-index");
            if (indexAttr !== null) {
                const overIndex = parseInt(indexAttr, 10);
                if (overIndex !== draggedIndex) {
                    dragOverIndex = overIndex;
                } else {
                    dragOverIndex = null;
                }
            }
        } else {
            dragOverIndex = null;
        }
    }

    function handlePointerUp() {
        if (
            isDragging &&
            draggedIndex !== null &&
            dragOverIndex !== null &&
            draggedIndex !== dragOverIndex
        ) {
            console.log("Reorder:", draggedIndex, "->", dragOverIndex);
            reorderQueue(draggedIndex, dragOverIndex);
        }

        // Cleanup
        isDragging = false;
        draggedIndex = null;
        dragOverIndex = null;
        
        if (cleanupDragListeners) {
            cleanupDragListeners();
            cleanupDragListeners = null;
        }
    }
</script>

{#if $isQueueVisible}
    <aside class="queue-panel" class:mobile={$isMobile} transition:fly={{ x: $isMobile ? 0 : 300, y: $isMobile ? 100 : 0, duration: 300 }}>
        <header class="queue-header">
            <h3>Queue</h3>
            <div class="header-actions">
                {#if hasUpcoming}
                    <button
                        class="clear-btn"
                        on:click={clearUpcoming}
                        title="Clear upcoming"
                    >
                        Clear
                    </button>
                {/if}
                <button
                    class="close-btn"
                    on:click={toggleQueue}
                    title="Close queue"
                    aria-label="Close queue"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            </div>
        </header>

        <div class="queue-content">
            {#if $currentTrack}
                <section class="queue-section">
                    <h4 class="section-title">Now Playing</h4>
                    <div class="now-playing">
                        <div class="queue-track current">
                            <div class="track-art">
                                {#if getTrackArt($currentTrack)}
                                    <img
                                        src={getTrackArt($currentTrack)}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                    />
                                {:else}
                                    <div class="art-placeholder">
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            width="16"
                                            height="16"
                                        >
                                            <path
                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                            />
                                        </svg>
                                    </div>
                                {/if}
                                {#if $isPlaying}
                                    <div class="playing-indicator">
                                        <span class="bar"></span>
                                        <span class="bar"></span>
                                        <span class="bar"></span>
                                    </div>
                                {/if}
                            </div>
                            <div class="track-info">
                                <span class="track-title truncate"
                                    >{$currentTrack.title ||
                                        "Unknown Title"}</span
                                >
                                <span class="track-artist truncate"
                                    >{$currentTrack.artist ||
                                        "Unknown Artist"}</span
                                >
                            </div>
                            <span class="track-duration"
                                >{formatDuration($currentTrack.duration)}</span
                            >
                        </div>
                    </div>
                </section>
            {/if}

            {#if upcomingTracks.length > 0}
                <section class="queue-section">
                    <h4 class="section-title">
                        Next Up
                        <span class="count">{upcomingTracks.length}</span>
                    </h4>
                    <div 
                        class="queue-list virtualized"
                        on:scroll={handleUpcomingScroll}
                        bind:this={upcomingContainerElement}
                    >
                        <div class="virtual-spacer" style="height: {upcomingVirtualState.totalHeight}px;">
                            <div 
                                class="virtual-content"
                                style="transform: translateY({upcomingVirtualState.offsetY}px);"
                            >
                                {#each upcomingVirtualState.visibleTracks as item, i (item.track.id + "-next-" + item.index)}
                                    <div
                                        class="queue-track"
                                        class:dragging={draggedIndex === item.index}
                                        class:drag-over={dragOverIndex === item.index}
                                        class:priority={item.isPriority}
                                        data-index={item.index}
                                        role="listitem"
                                        style="height: {TRACK_ROW_HEIGHT}px;"
                                    >
                                        <div
                                            class="drag-handle"
                                            on:pointerdown={(e) =>
                                                handlePointerDown(e, item.index)}
                                            on:click|stopPropagation
                                            on:dblclick|stopPropagation
                                            title="Drag to reorder"
                                            role="button"
                                            tabindex="-1"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                width="16"
                                                height="16"
                                            >
                                                <path
                                                    d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"
                                                />
                                            </svg>
                                        </div>
                                        <button
                                            class="track-btn"
                                            on:click={() => handlePlayTrack(item.index)}
                                        >
                                            <div class="track-art">
                                                {#if getTrackArt(item.track)}
                                                    <img
                                                        src={getTrackArt(item.track)}
                                                        alt=""
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                {:else}
                                                    <div class="art-placeholder">
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="16"
                                                            height="16"
                                                        >
                                                            <path
                                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                            />
                                                        </svg>
                                                    </div>
                                                {/if}
                                            </div>
                                            <div class="track-info">
                                                <span class="track-title truncate"
                                                    >{item.track.title ||
                                                        "Unknown Title"}</span
                                                >
                                                <span class="track-artist truncate"
                                                    >{item.track.artist ||
                                                        "Unknown Artist"}</span
                                                >
                                            </div>
                                        </button>
                                        <span class="track-duration"
                                            >{formatDuration(item.track.duration)}</span
                                        >
                                        <button
                                            class="remove-btn"
                                            on:click={() => handleRemove(item.index)}
                                            title="Remove from queue"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                width="16"
                                                height="16"
                                            >
                                                <path
                                                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    </div>
                </section>
            {/if}

            {#if historyTracks.length > 0}
                <section class="queue-section history">
                    <h4 class="section-title">
                        Recently Played
                        <span class="count">{historyTracks.length}</span>
                    </h4>
                    <div 
                        class="queue-list virtualized"
                        on:scroll={handleHistoryScroll}
                        bind:this={historyContainerElement}
                    >
                        <div class="virtual-spacer" style="height: {historyVirtualState.totalHeight}px;">
                            <div 
                                class="virtual-content"
                                style="transform: translateY({historyVirtualState.offsetY}px);"
                            >
                                {#each historyVirtualState.visibleTracks as item, i (item.track.id + "-history-" + item.index)}
                                    <div 
                                        class="queue-track past"
                                        style="height: {TRACK_ROW_HEIGHT}px;"
                                    >
                                        <button
                                            class="track-btn"
                                            on:click={() => handlePlayTrack(item.index)}
                                        >
                                            <div class="track-art">
                                                {#if getTrackArt(item.track)}
                                                    <img
                                                        src={getTrackArt(item.track)}
                                                        alt=""
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                {:else}
                                                    <div class="art-placeholder">
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="16"
                                                            height="16"
                                                        >
                                                            <path
                                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                            />
                                                        </svg>
                                                    </div>
                                                {/if}
                                            </div>
                                            <div class="track-info">
                                                <span class="track-title truncate"
                                                    >{item.track.title ||
                                                        "Unknown Title"}</span
                                                >
                                                <span class="track-artist truncate"
                                                    >{item.track.artist ||
                                                        "Unknown Artist"}</span
                                                >
                                            </div>
                                        </button>
                                        <span class="track-duration"
                                            >{formatDuration(item.track.duration)}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        </div>
                    </div>
                </section>
            {/if}

            {#if $queue.length === 0}
                <div class="empty-state">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="48"
                        height="48"
                    >
                        <path
                            d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
                        />
                    </svg>
                    <p>Queue is empty</p>
                    <span>Play some tracks to fill the queue</span>
                </div>
            {/if}
        </div>
    </aside>
{/if}

<style>
    .queue-panel {
        width: 350px;
        min-width: 300px;
        max-width: 400px;
        height: 100%;
        min-height: 0;
        background: linear-gradient(
            180deg,
            var(--bg-elevated) 0%,
            var(--bg-base) 100%
        );
        border-left: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
    }

    .queue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .queue-header h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .clear-btn {
        font-size: 0.75rem;
        color: var(--text-secondary);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }

    .clear-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-full);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .queue-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
        overscroll-behavior-y: contain;
    }

    .queue-section {
        margin-bottom: var(--spacing-lg);
    }

    .section-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-subdued);
        margin-bottom: var(--spacing-sm);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .section-title .count {
        background-color: var(--bg-surface);
        padding: 2px 6px;
        border-radius: var(--radius-full);
        font-size: 0.625rem;
    }

    .queue-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    /* Virtualization - flexible height  */
    .queue-list.virtualized {
        /* height for desktop can change */
        max-height: min(400px, 40vh);
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        overscroll-behavior-y: contain;
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
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .queue-track {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs);
        border-radius: var(--radius-md);
        transition: background-color var(--transition-fast);
        box-sizing: border-box;
    }

    .queue-track:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .queue-track.current {
        background-color: var(--accent-subtle);
        padding: var(--spacing-sm);
    }

    .queue-track.past {
        opacity: 0.6;
    }

    .queue-track.past:hover {
        opacity: 1;
    }

    .queue-track.dragging {
        opacity: 0.5;
        background-color: var(--bg-highlight);
    }

    .queue-track.drag-over {
        border-top: 2px solid var(--accent-primary);
        margin-top: -2px;
    }

    .drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--text-subdued);
        cursor: grab;
        opacity: 0;
        transition: all var(--transition-fast);
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
    }

    .queue-track:hover .drag-handle {
        opacity: 1;
    }

    .drag-handle:hover {
        color: var(--text-primary);
    }

    .drag-handle:active {
        cursor: grabbing;
    }

    .track-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
        min-width: 0;
        text-align: left;
    }

    .track-art {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
    }

    .track-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        background-color: var(--bg-highlight);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .playing-indicator {
        position: absolute;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
    }

    .playing-indicator .bar {
        width: 3px;
        height: 12px;
        background-color: var(--accent-primary);
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
            height: 4px;
        }
        50% {
            height: 14px;
        }
    }

    .track-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
    }

    .track-title {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .queue-track.current .track-title {
        color: var(--accent-primary);
    }

    .track-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .track-duration {
        font-size: 0.75rem;
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .remove-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-full);
        color: var(--text-subdued);
        opacity: 0;
        transition: all var(--transition-fast);
    }

    .queue-track:hover .remove-btn {
        opacity: 1;
    }

    .remove-btn:hover {
        color: var(--error-color);
        background-color: rgba(241, 94, 108, 0.1);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .empty-state p {
        font-size: 1rem;
        color: var(--text-secondary);
    }

    .empty-state span {
        font-size: 0.8125rem;
    }

    .history {
        opacity: 0.7;
    }

    .history:hover {
        opacity: 1;
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Mobile: full-screen overlay (z-index above FullScreenPlayer at 2000) */
    .queue-panel.mobile {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        z-index: 2100;
        border-left: none;
        border-radius: 0;
    }

    .queue-panel.mobile .queue-header {
        padding: var(--spacing-md) var(--spacing-md);
        padding-top: calc(var(--spacing-md) + env(safe-area-inset-top, 0px));
    }

    .queue-panel.mobile .close-btn {
        width: 44px;
        height: 44px;
    }

    /* On mobile, always show drag handles since hover dosen't exist */
    .queue-panel.mobile .drag-handle {
        opacity: 1;
    }

    /* On mobile virtualized listsuse more space */
    .queue-panel.mobile .queue-list.virtualized {
        max-height: min(50vh, 500px);
    }
</style>