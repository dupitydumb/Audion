<script lang="ts">
    import { fly } from "svelte/transition";
    import {
        isMiniPlayer,
        toggleMiniPlayer,
        setMiniPlayer,
        toggleFullScreen,
    } from "$lib/stores/ui";
    import {
        currentTrack,
        isPlaying,
        togglePlay,
        nextTrack,
        previousTrack,
        progress,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";
    import { getAlbumArtSrc, getAlbum, formatDuration } from "$lib/api/tauri";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { isTauri } from "$lib/api/tauri";

    let albumArt: string | null = null;
    let progressBarElement: HTMLDivElement;
    let isDragging = false;
    let isDraggingWindow = false;
    let dragStartX = 0;
    let dragStartY = 0;

    let imageLoadFailed = false;

    // Load album art - check cover_url first (for external/streaming tracks), then album art
    $: if ($currentTrack?.cover_url) {
        // Streaming track with direct cover URL (e.g., Tidal)
        albumArt = $currentTrack.cover_url;
        imageLoadFailed = false;
    } else if ($currentTrack?.album_id) {
        loadAlbumArt($currentTrack.album_id);
        imageLoadFailed = false;
    } else {
        albumArt = null;
        imageLoadFailed = false;
    }

    async function loadAlbumArt(albumId: number) {
        try {
            const album = await getAlbum(albumId);
            albumArt = album ? getAlbumArtSrc(album.art_data) : null;
        } catch {
            albumArt = null;
        }
    }

    function handleSeek(e: MouseEvent) {
        if (!progressBarElement) return;
        const rect = progressBarElement.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        seek(Math.max(0, Math.min(1, pos)));
    }

    function handleMouseDown(e: MouseEvent) {
        isDragging = true;
        handleSeek(e);
    }

    function handleMouseMove(e: MouseEvent) {
        if (isDragging) handleSeek(e);
    }

    function handleMouseUp() {
        isDragging = false;
    }

    async function handleExpand() {
        await toggleMiniPlayer();
    }

    async function handleMaximize() {
        await setMiniPlayer(false);
        toggleFullScreen();
    }

    // Window dragging for PIP mode
    async function handleWindowDragStart(e: MouseEvent) {
        if (isTauri() && $isMiniPlayer) {
            isDraggingWindow = true;
            dragStartX = e.screenX;
            dragStartY = e.screenY;
        }
    }

    async function handleWindowDragMove(e: MouseEvent) {
        if (isDraggingWindow && isTauri()) {
            try {
                const appWindow = getCurrentWindow();
                await appWindow.startDragging();
                isDraggingWindow = false;
            } catch (error) {
                console.error("Failed to drag window:", error);
            }
        }
    }

    function handleWindowDragEnd() {
        isDraggingWindow = false;
    }
</script>

<svelte:window on:mousemove={handleMouseMove} on:mouseup={handleMouseUp} />

{#if $isMiniPlayer}
    <div
        class="mini-player"
        transition:fly={{ y: 100, duration: 300 }}
        on:mousedown={handleWindowDragStart}
        on:mousemove={handleWindowDragMove}
        on:mouseup={handleWindowDragEnd}
        role="region"
        aria-label="Mini player"
    >
        <!-- Album Art with expand -->
        <button class="album-art" on:click={handleExpand} title="Expand player">
            {#if albumArt && !imageLoadFailed}
                <img
                    src={albumArt}
                    alt="Album art"
                    decoding="async"
                    on:error={() => (imageLoadFailed = true)}
                />
            {:else}
                <div class="art-placeholder">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="24"
                        height="24"
                    >
                        <path
                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                        />
                    </svg>
                </div>
            {/if}
        </button>

        <!-- Track Info -->
        <div class="track-info">
            <span
                class="track-title truncate"
                title={$currentTrack?.title || "No track playing"}
            >
                {$currentTrack?.title || "No track playing"}
            </span>
            <span
                class="track-artist truncate"
                title={$currentTrack?.artist || ""}
            >
                {$currentTrack?.artist || ""}
            </span>
        </div>

        <!-- Controls -->
        <div class="controls">
            <button
                class="control-btn"
                on:click={previousTrack}
                title="Previous"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                >
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
            </button>

            <button
                class="play-btn"
                on:click={togglePlay}
                title={$isPlaying ? "Pause" : "Play"}
            >
                {#if $isPlaying}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="18"
                        height="18"
                    >
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                {:else}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="18"
                        height="18"
                    >
                        <path d="M8 5v14l11-7z" />
                    </svg>
                {/if}
            </button>

            <button class="control-btn" on:click={nextTrack} title="Next">
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                >
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
            </button>
        </div>

        <!-- Time -->
        <div class="time-display">
            <span>{formatDuration($currentTime)}</span>
            <span class="separator">/</span>
            <span>{formatDuration($duration)}</span>
        </div>

        <!-- Expand button -->
        <button
            class="expand-btn"
            on:click={handleMaximize}
            title="Full screen"
        >
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path
                    d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                />
            </svg>
        </button>

        <!-- Close mini player -->
        <button class="close-btn" on:click={handleExpand} title="Exit PIP mode">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                />
            </svg>
        </button>

        <!-- Progress bar at bottom -->
        <div
            class="progress-bar"
            bind:this={progressBarElement}
            on:mousedown={handleMouseDown}
            role="slider"
            aria-label="Seek"
            aria-valuenow={Math.round($progress * 100)}
            aria-valuemin="0"
            aria-valuemax="100"
            tabindex="0"
        >
            <div class="progress-fill" style="width: {$progress * 100}%"></div>
        </div>
    </div>
{/if}

<style>
    .mini-player {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        background-color: var(--bg-elevated);
        border-radius: 0;
        box-shadow: none;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs);
        padding-right: var(--spacing-sm);
        z-index: 1000;
        backdrop-filter: blur(20px);
        cursor: grab;
    }

    .mini-player:active {
        cursor: grabbing;
    }

    .album-art {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
        cursor: pointer;
        transition: transform var(--transition-fast);
    }

    .album-art:hover {
        transform: scale(1.03);
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        background-color: var(--bg-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .track-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    .track-title {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .track-artist {
        font-size: 0.65rem;
        color: var(--text-secondary);
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .control-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: var(--radius-full);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
    }

    .control-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .play-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-full);
        background-color: var(--text-primary);
        color: var(--bg-base);
        transition: all var(--transition-fast);
    }

    .play-btn:hover {
        transform: scale(1.06);
        background-color: var(--accent-hover);
    }

    .time-display {
        font-size: 0.6rem;
        color: var(--text-subdued);
        display: flex;
        align-items: center;
        gap: 2px;
        font-variant-numeric: tabular-nums;
    }

    .separator {
        opacity: 0.5;
    }

    .expand-btn,
    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: var(--radius-full);
        color: var(--text-subdued);
        transition: all var(--transition-fast);
    }

    .expand-btn:hover,
    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .progress-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 4px;
        background-color: var(--bg-highlight);
        cursor: pointer;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background-color: var(--accent-primary);
        transition: width 0.1s linear;
    }

    .progress-bar:hover .progress-fill {
        background-color: var(--accent-hover);
    }
</style>
