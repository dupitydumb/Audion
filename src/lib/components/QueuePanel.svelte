<script lang="ts">
    import { _ } from "svelte-i18n";
    import { fade, fly } from "svelte/transition";
    import { isQueueVisible, toggleQueue, isFullScreen, closeFullScreen } from "$lib/stores/ui";
    import { isMobile } from "$lib/stores/mobile";
    import { get } from "svelte/store";
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
    import { albums, resolveTrackCover } from "$lib/stores/library";
    import { customArtworks } from "$lib/stores/customArtwork";
    import { formatDuration } from "$lib/api/tauri";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import { goToArtistDetail } from "$lib/stores/view";
    import { onMount, onDestroy } from "svelte";
    import Icon from "$lib/components/Icon.svelte";
    
    export let hideheader: boolean = false;
    export let forceVisible: boolean = false;

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

    // Unified scroll tracking on mobile (single outer scroll container)
    let queueContentElement: HTMLDivElement;
    let mobileContentScrollTop = 0;
    let mobileContentHeight = 600;
    let isAndroid = false;

    // Create album map for art lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

    // reassigned (not a plain function)
    // so the template re-renders when custom artwork or the album list changes
    $: getTrackArt = (track: Track): string | null => {
        if (!track) return null;
        void $customArtworks;
        return resolveTrackCover(track, track.album_id ? albumMap.get(track.album_id) : null);
    };

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
                .map((idx) => ({ track: q[idx], index: idx }))
                .filter((item) => !!item.track);

            upcomingTracks = sIndices
                .slice(sIdx + 1)
                .map((idx, i) => ({
                    track: q[idx],
                    index: idx,
                    isPriority: i < uCount,
                }))
                .filter((item) => !!item.track);
        } else {
            historyTracks = q
                .slice(0, qIdx)
                .map((t, i) => ({ track: t, index: i }));

            upcomingTracks = q
                .slice(qIdx + 1)
                .map((t, i) => ({
                    track: t,
                    index: qIdx + 1 + i,
                    isPriority: i < uCount,
                }))
                .filter((item) => !!item.track);
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

    $: useUnifiedMobileScroll = $isMobile && !forceVisible;

    $: {
        const totalHeight = upcomingTracks.length * TRACK_ROW_HEIGHT;
        let startIndex: number;
        let endIndex: number;
        if (useUnifiedMobileScroll) {
            const offsetTop = upcomingContainerElement?.offsetTop ?? 0;
            const relStart = mobileContentScrollTop - offsetTop;
            const relEnd = relStart + mobileContentHeight;
            startIndex = Math.max(0, Math.floor(relStart / TRACK_ROW_HEIGHT) - OVERSCAN);
            endIndex = Math.min(
                upcomingTracks.length,
                Math.max(0, Math.ceil(relEnd / TRACK_ROW_HEIGHT) + OVERSCAN)
            );
        } else {
            startIndex = Math.max(0, Math.floor(upcomingScrollTop / TRACK_ROW_HEIGHT) - OVERSCAN);
            endIndex = Math.min(
                upcomingTracks.length,
                Math.ceil((upcomingScrollTop + upcomingContainerHeight) / TRACK_ROW_HEIGHT) + OVERSCAN
            );
        }
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
        let startIndex: number;
        let endIndex: number;
        if (useUnifiedMobileScroll) {
            const offsetTop = historyContainerElement?.offsetTop ?? 0;
            const relStart = mobileContentScrollTop - offsetTop;
            const relEnd = relStart + mobileContentHeight;
            startIndex = Math.max(0, Math.floor(relStart / TRACK_ROW_HEIGHT) - OVERSCAN);
            endIndex = Math.min(
                historyTracks.length,
                Math.max(0, Math.ceil(relEnd / TRACK_ROW_HEIGHT) + OVERSCAN)
            );
        } else {
            startIndex = Math.max(0, Math.floor(historyScrollTop / TRACK_ROW_HEIGHT) - OVERSCAN);
            endIndex = Math.min(
                historyTracks.length,
                Math.ceil((historyScrollTop + historyContainerHeight) / TRACK_ROW_HEIGHT) + OVERSCAN
            );
        }
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

    function handleMobileContentScroll(e: Event) {
        if (!useUnifiedMobileScroll) return;
        mobileContentScrollTop = (e.target as HTMLElement).scrollTop;
    }

    function handleArtistSelect(artistName: string) {
        if (get(isQueueVisible)) isQueueVisible.set(false);
        if (get(isFullScreen)) closeFullScreen();
        goToArtistDetail(artistName);
    }

    function observeHeight(node: HTMLElement, onHeight: (h: number) => void) {
        const update = () => {
            if (node.clientHeight > 0) {
                onHeight(node.clientHeight);
            }
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(node);
        return {
            destroy() {
                ro.disconnect();
            }
        };
    }

    onMount(() => {
        isAndroid =
            typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
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
    let hoveredCurrentTrack = false;
    let hoveredQueueKey: string | null = null;
    let dragGhost: HTMLElement | null = null;
    let dragGrabOffsetY = 0;
    let dragRowHeight = TRACK_ROW_HEIGHT;
    let dragShifts: Record<number, number> = {};

    function computeShifts(dragged: number, over: number | null): Record<number, number> {
        if (over === null) return {};
        const dragPos = upcomingTracks.findIndex((t) => t.index === dragged);
        const overPos = upcomingTracks.findIndex((t) => t.index === over);
        if (dragPos === -1 || overPos === -1 || dragPos === overPos) return {};
        const shifts: Record<number, number> = {};
        const dir = overPos > dragPos ? 1 : -1;
        const lo = Math.min(dragPos, overPos);
        const hi = Math.max(dragPos, overPos);
        for (let pos = lo; pos <= hi; pos++) {
            if (pos === dragPos) continue;
            shifts[upcomingTracks[pos].index] = dir > 0 ? -dragRowHeight : dragRowHeight;
        }
        return shifts;
    }

    function createGhost(sourceRow: HTMLElement, clientY: number): HTMLElement {
        const rect = sourceRow.getBoundingClientRect();
        dragRowHeight = rect.height + 4; // include --spacing-xs gap
        dragGrabOffsetY = clientY - rect.top;

        const ghost = sourceRow.cloneNode(true) as HTMLElement;
        ghost.classList.remove("dragging", "drag-over", "current");
        ghost.style.cssText = [
            `position: fixed`,
            `top: ${rect.top}px`,
            `left: ${rect.left}px`,
            `width: ${rect.width}px`,
            `height: ${rect.height}px`,
            `pointer-events: none`,
            `z-index: 9999`,
            `opacity: 0.95`,
            `border-radius: var(--radius-md, 8px)`,
            `box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)`,
            `transform: rotate(1.5deg) scale(1.02)`,
            `transform-origin: center center`,
            `background: var(--bg-highlight)`,
            `transition: none`,
            `will-change: top`,
        ].join("; ");
        document.body.appendChild(ghost);
        return ghost;
    }

    function removeGhost() {
        if (!dragGhost) return;
        dragGhost.style.transition = "opacity 120ms ease, transform 120ms ease";
        dragGhost.style.opacity = "0";
        dragGhost.style.transform = "scale(0.96)";
        const g = dragGhost;
        setTimeout(() => g.remove(), 130);
        dragGhost = null;
    }

    function handlePointerDown(e: PointerEvent, actualIndex: number) {
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget as HTMLElement;
        const row = target.closest(".queue-track") as HTMLElement | null;
        if (row) dragGhost = createGhost(row, e.clientY);

        isDragging = true;
        draggedIndex = actualIndex;
        dragOverIndex = null;
        dragShifts = {};

        // Capture pointer events
        try {
            target.setPointerCapture(e.pointerId);
        } catch {}

        // Clean up any stale listeners before attaching new ones
        if (cleanupDragListeners) cleanupDragListeners();

        // Add global listeners
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);

        cleanupDragListeners = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerCancel);
            try {
                target.releasePointerCapture(e.pointerId);
            } catch {}
        };
    }

    function handlePointerMove(e: PointerEvent) {
        if (!isDragging || draggedIndex === null) return;

        if (dragGhost) {
            dragGhost.style.top = `${e.clientY - dragGrabOffsetY}px`;
        }

        let newOver: number | null = null;
        if (upcomingContainerElement && upcomingTracks.length > 0) {
            const rect = upcomingContainerElement.getBoundingClientRect();
            const relY = useUnifiedMobileScroll
                ? e.clientY - rect.top
                : e.clientY - rect.top + upcomingContainerElement.scrollTop;
            const idx = Math.floor(relY / TRACK_ROW_HEIGHT);
            const clamped = Math.max(0, Math.min(upcomingTracks.length - 1, idx));
            const targetItem = upcomingTracks[clamped];
            if (targetItem && targetItem.index !== draggedIndex) {
                newOver = targetItem.index;
            }
        }

        if (newOver !== dragOverIndex) {
            dragOverIndex = newOver;
            dragShifts = computeShifts(draggedIndex, dragOverIndex);
        }
    }

    function resetDragState() {
        removeGhost();
        isDragging = false;
        draggedIndex = null;
        dragOverIndex = null;
        dragShifts = {};

        if (cleanupDragListeners) {
            cleanupDragListeners();
            cleanupDragListeners = null;
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

        resetDragState();
    }

    function handlePointerCancel() {
        resetDragState();
    }
</script>

{#if true}
    <aside
        class="queue-panel"
        class:mobile={$isMobile}
        class:android-lite={isAndroid && $isMobile}
        class:closed={!$isQueueVisible && !forceVisible}
        transition:fly={{
            x: $isMobile ? 0 : 300,
            y: $isMobile ? (isAndroid ? 0 : 100) : 0,
            duration: $isMobile && isAndroid ? 180 : 300,
        }}
    >
    {#if !hideheader}
        <header class="queue-header">
            <h3>{$_('player.queue')}</h3>
            <div class="header-actions">
                {#if hasUpcoming}
                    <button
                        class="clear-btn"
                        on:click={clearUpcoming}
                        title={$_('player.clearUpcoming')}
                    >
                        {$_('common.clear')}
                    </button>
                {/if}
                <button
                    class="close-btn"
                    on:click={toggleQueue}
                    title={$_('player.closeQueue')}
                    aria-label="Close queue"
                >
                    <Icon name="x" size={20} />
                </button>
            </div>
        </header>
    {/if}

        <div
            class="queue-content"
            class:unified-mobile={useUnifiedMobileScroll}
            bind:this={queueContentElement}
            on:scroll={handleMobileContentScroll}
            use:observeHeight={(h) => (mobileContentHeight = h)}
        >
            {#if $currentTrack}
                <section class="queue-section now-playing-section">
                    <h4 class="section-title">{$_('player.nowPlaying')}</h4>
                    <div class="now-playing">
                        <div class="queue-track current"
                            on:mouseenter={() => (hoveredCurrentTrack = true)}
                            on:mouseleave={() => (hoveredCurrentTrack = false)}
                        >
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
                                        <Icon name="music" size={16} />
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
                                        $_('player.unknownTitle')}</span
                                >
                                <ArtistLinks
                                    artist={$currentTrack.artist || $_('common.unknownArtist')}
                                    artists={$currentTrack.artists}
                                    chipClass="track-artist truncate"
                                    marquee
                                    marqueeTrigger="external"
                                    marqueeActive={hoveredCurrentTrack}
                                    resetKey={$currentTrack.id}
                                    on:select={(e) => handleArtistSelect(e.detail)}
                                />
                            </div>
                            <span class="track-duration"
                                >{formatDuration($currentTrack.duration)}</span
                            >
                        </div>
                    </div>
                </section>
            {/if}

            {#if upcomingTracks.length > 0}
                <section class="queue-section upcoming-section">
                    <h4 class="section-title">
                        {$_('player.nextUp')}
                        <span class="count">{upcomingTracks.length}</span>
                    </h4>
                    <div 
                        class="queue-list virtualized"
                        on:scroll={handleUpcomingScroll}
                        use:observeHeight={(h) => (upcomingContainerHeight = h)}
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
                                        style="height: {TRACK_ROW_HEIGHT}px;{dragShifts[item.index] ? ` transform: translateY(${dragShifts[item.index]}px);` : ''}"
                                        on:mouseenter={() =>
                                            (hoveredQueueKey = item.track.id + "-next-" + item.index)}
                                        on:mouseleave={() => (hoveredQueueKey = null)}
                                    >
                                        <div
                                            class="drag-handle"
                                            on:pointerdown={(e) =>
                                                handlePointerDown(e, item.index)}
                                            on:click|stopPropagation
                                            on:dblclick|stopPropagation
                                            title={$_('player.dragToReorder')}
                                            role="button"
                                            tabindex="-1"
                                        >
                                            <Icon name="drag-handle" size={16} />
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
                                                        <Icon name="music" size={16} />
                                                    </div>
                                                {/if}
                                            </div>
                                            <div class="track-info">
                                                <span class="track-title truncate"
                                                    >{item.track.title ||
                                                        $_('player.unknownTitle')}</span
                                                >
                                                <ArtistLinks
                                                    artist={item.track.artist || $_('common.unknownArtist')}
                                                    artists={item.track.artists}
                                                    chipClass="track-artist truncate"
                                                    marquee
                                                    marqueeTrigger="external"
                                                    marqueeActive={hoveredQueueKey === item.track.id + "-next-" + item.index}
                                                    resetKey={item.track.id}
                                                    on:select={(e) => handleArtistSelect(e.detail)}
                                                />
                                            </div>
                                        </button>
                                        <span class="track-duration"
                                            >{formatDuration(item.track.duration)}</span
                                        >
                                        <button
                                            class="remove-btn"
                                            on:click={() => handleRemove(item.index)}
                                            title={$_('player.removeFromQueueTooltip')}
                                        >
                                            <Icon name="x" size={16} />
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    </div>
                </section>
            {/if}

            {#if historyTracks.length > 0}
                <section class="queue-section history history-section">
                    <h4 class="section-title">
                        {$_('player.recentlyPlayed')}
                        <span class="count">{historyTracks.length}</span>
                    </h4>
                    <div 
                        class="queue-list virtualized"
                        on:scroll={handleHistoryScroll}
                        use:observeHeight={(h) => (historyContainerHeight = h)}
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
                                        on:mouseenter={() =>
                                            (hoveredQueueKey = item.track.id + "-history-" + item.index)}
                                        on:mouseleave={() => (hoveredQueueKey = null)}
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
                                                        <Icon name="music" size={16} />
                                                    </div>
                                                {/if}
                                            </div>
                                            <div class="track-info">
                                                <span class="track-title truncate"
                                                    >{item.track.title ||
                                                        $_('player.unknownTitle')}</span
                                                >
                                                <ArtistLinks
                                                    artist={item.track.artist || $_('common.unknownArtist')}
                                                    artists={item.track.artists}
                                                    chipClass="track-artist truncate"
                                                    marquee
                                                    marqueeTrigger="external"
                                                    marqueeActive={hoveredQueueKey === item.track.id + "-history-" + item.index}
                                                    resetKey={item.track.id}
                                                    on:select={(e) => handleArtistSelect(e.detail)}
                                                />
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
                    <Icon name="list-music" size={48} />
                    <p>{$_('player.queueEmpty')}</p>
                    <span>{$_('player.queueEmptyHint')}</span>
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
        transition: width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    min-width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    max-width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    opacity 0.25s ease,
                    border-left 0.3s ease;
    }

    .queue-panel.closed {
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        opacity: 0;
        padding: 0;
        border-left: none;
        overflow: hidden;
        pointer-events: none;
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
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .clear-btn {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        padding: var(--spacing-xs) var(--spacing-sm);
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
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        padding: var(--spacing-md);
        box-sizing: border-box;
        overscroll-behavior-y: contain;
    }

    .queue-section {
        display: flex;
        flex-direction: column;
        min-height: 0;
        margin-bottom: var(--spacing-md);
    }

    .queue-section.now-playing-section {
        flex-shrink: 0;
    }

    .queue-section.upcoming-section {
        flex: 1;
        min-height: 0;
        margin-bottom: 0;
    }

    .queue-section.history {
        flex-shrink: 0;
        max-height: 40%;
        margin-top: var(--spacing-md);
        margin-bottom: 0;
    }

    .queue-content:not(:has(.upcoming-section)) .queue-section.history {
        flex: 1;
        max-height: none;
        margin-top: 0;
    }

    .section-title {
        flex-shrink: 0;
        font-size: 0.6875rem;
        font-weight: var(--font-weight-bold);
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
        padding: var(--spacing-xs) var(--spacing-xs);
        border-radius: var(--radius-full);
        font-size: 0.625rem;
    }

    .queue-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    /* Virtualization - fills 100% available section height */
    .queue-list.virtualized {
        flex: 1;
        height: 100%;
        min-height: 0;
        max-height: none;
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
        gap: var(--spacing-xs);
    }

    .queue-track {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs);
        border-radius: var(--radius-md);
        transition:
            background-color var(--transition-fast),
            transform 180ms var(--ease-spring-gentle),
            opacity var(--transition-fast);
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
        opacity: 0.25;
        background-color: var(--bg-highlight);
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
        gap: var(--spacing-xs);
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
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
    }

    .queue-track.current .track-title {
        color: var(--accent-primary);
    }

    .track-artist {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
    }

    .track-duration {
        font-size: var(--font-size-xs);
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
        flex: 1;
        height: 100%;
        min-height: 200px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .empty-state p {
        font-size: var(--font-size-md);
        color: var(--text-secondary);
    }

    .empty-state span {
        font-size: var(--font-size-sm);
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
        z-index: var(--z-panel, 2100);
        border-left: none;
        border-radius: 0;
    }

    .queue-panel.mobile.android-lite {
        transform: translateZ(0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
    }

    .queue-panel.mobile .queue-header {
        padding: var(--spacing-md) var(--spacing-md);
        padding-top: calc(var(--spacing-md) + var(--safe-area-top, 0px));
    }

    .queue-panel.mobile .close-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
    }

    .queue-panel.mobile .queue-content.unified-mobile {
        overflow-y: auto;
        overflow-x: hidden;
        padding-bottom: calc(var(--spacing-md) + var(--safe-area-bottom, 0px));
    }

    .queue-panel.mobile .queue-content.unified-mobile .queue-section.upcoming-section {
        flex: none;
    }

    .queue-panel.mobile .queue-content.unified-mobile .queue-section.history {
        max-height: none;
        opacity: 1;
    }

    .queue-panel.mobile .queue-content.unified-mobile .queue-list.virtualized {
        overflow: visible;
        flex: none;
        height: auto;
        max-height: none;
    }

    /* On mobile, always show drag handles and remove buttons since hover doesn't exist */
    .queue-panel.mobile .drag-handle {
        opacity: 1;
        width: 32px;
        height: 44px;
    }

    .queue-panel.mobile .remove-btn {
        opacity: 1;
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
    }
</style>