<script lang="ts">
    import { onMount } from "svelte";
    import {
        currentTrack,
        isPlaying,
        volume,
        currentTime,
        duration,
        progress,
        shuffle,
        repeat,
        togglePlay,
        nextTrack,
        previousTrack,
        seek,
        setVolume,
        toggleShuffle,
        cycleRepeat,
        isStreaming,
    } from "$lib/stores/player";
    import { lyricsVisible, toggleLyrics } from "$lib/stores/lyrics";
    import {
        isFullScreen,
        toggleFullScreen,
        isQueueVisible,
        toggleQueue,
        toggleMiniPlayer,
    } from "$lib/stores/ui";
    import {
        formatDuration,
        getAlbumArtSrc,
        getAlbum,
        getTrackCoverSrc,
        getAlbumCoverSrc,
    } from "$lib/api/tauri";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import PluginMenu from "$lib/components/PluginMenu.svelte";
    import { goToArtistDetail } from "$lib/stores/view";
    import { isMobile } from "$lib/stores/mobile";
    import type { Album } from "$lib/api/tauri";
    import { likedTrackIds, toggleLike } from "$lib/stores/liked";

    $: isCurrentLiked = $currentTrack
        ? $likedTrackIds.has($currentTrack.id)
        : false;

    // Detect live streams (radio, etc.) — no duration, streaming source
    $: isLive = $currentTrack
        ? $currentTrack.source_type === "radio" ||
          (isStreaming($currentTrack) &&
              (!$currentTrack.duration || $currentTrack.duration === 0))
        : false;

    export let hidden: boolean = false;

    let seekBarElement: HTMLDivElement;
    let volumeBarElement: HTMLDivElement;
    let isSeeking = false;
    let isVolumeChanging = false;
    let albumArt: string | null = null;
    let imageLoadFailed = false;
    let loadedAlbum: any = null;

    // Slot containers
    let slotStart: HTMLDivElement;
    let slotEnd: HTMLDivElement;

    // Expose audio element for visualizer - removed for native backend

    // Load track cover - with priority order
    $: if ($currentTrack) {
        loadTrackCover($currentTrack);
    } else {
        albumArt = null;
        imageLoadFailed = false;
        loadedAlbum = null;
    }

    async function loadTrackCover(track: any) {
        imageLoadFailed = false;

        if (track.track_cover_path) {
            // Priority 1: Track's file-based cover
            albumArt = getTrackCoverSrc(track);
        } else if (track.track_cover) {
            // Priority 2: Track's base64 cover - old
            albumArt = getAlbumArtSrc(track.track_cover);
        } else if (track.cover_url) {
            // Priority 3: Streaming track cover URL
            albumArt = track.cover_url;
        } else if (track.album_id) {
            // Priority 4 & 5: Album art (file-based or base64)
            await loadAlbumArt(track.album_id);
        } else {
            albumArt = null;
        }
    }

    async function loadAlbumArt(albumId: number) {
        try {
            const album = await getAlbum(albumId);

            if (!album) {
                albumArt = null;
                loadedAlbum = null;
                return;
            }

            loadedAlbum = album;

            if (album.art_path) {
                // Priority 4: Album's file-based art
                albumArt = getAlbumCoverSrc(album);
            } else if (album.art_data) {
                // Priority 5: Album's base64 art - old
                albumArt = getAlbumArtSrc(album.art_data);
            } else {
                albumArt = null;
            }
        } catch {
            albumArt = null;
            loadedAlbum = null;
        }
    }

    function handleSeekStart(e: MouseEvent) {
        isSeeking = true;
        handleSeek(e);
    }

    function handleSeek(e: MouseEvent) {
        if (!seekBarElement) return;
        const rect = seekBarElement.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        seek(Math.max(0, Math.min(1, pos)));
    }

    function handleSeekEnd() {
        isSeeking = false;
    }

    function handleVolumeStart(e: MouseEvent) {
        isVolumeChanging = true;
        handleVolumeChange(e);
    }

    function handleVolumeChange(e: MouseEvent) {
        if (!volumeBarElement) return;
        const rect = volumeBarElement.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        setVolume(Math.max(0, Math.min(1, pos)));
    }

    function handleVolumeKey(e: KeyboardEvent) {
        const step = 0.05;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            setVolume(Math.min(1, $volume + step));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            setVolume(Math.max(0, $volume - step));
        }
    }

    function handleVolumeScroll(e: WheelEvent) {
        e.preventDefault();
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const step = 0.05;
        if (e.deltaY < 0) {
            setVolume(Math.min(1, $volume + step));
        } else if (e.deltaY > 0) {
            setVolume(Math.max(0, $volume - step));
        }
    }

    function getRepeatIcon(mode: "none" | "one" | "all"): string {
        if (mode === "one") return "1";
        return "";
    }

    onMount(() => {
        // Global mouse events for seeking and volume
        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (isSeeking) handleSeek(e);
            if (isVolumeChanging) handleVolumeChange(e);
        };
        const handleGlobalMouseUp = () => {
            isSeeking = false;
            isVolumeChanging = false;
        };

        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);

        // Register UI slots
        if (slotStart)
            uiSlotManager.registerContainer("playerbar:left", slotStart);
        if (slotEnd)
            uiSlotManager.registerContainer("playerbar:right", slotEnd);

        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);

            // Unregister slots
            uiSlotManager.unregisterContainer("playerbar:left");
            uiSlotManager.unregisterContainer("playerbar:right");
        };
    });
</script>

<footer
    class="player-bar"
    class:hidden
    class:mobile={$isMobile}
    class:mobile-no-track={$isMobile && !$currentTrack}
>
    <!-- Native audio backend handles playback in Rust -->

    {#if $isMobile}
        <!-- SPOTIFY-STYLE MOBILE MINI-PLAYER -->
        <div
            class="mini-player-tap"
            on:click={toggleFullScreen}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.key === "Enter" && toggleFullScreen()}
        >
            <!-- Thin progress line at top edge -->
            <div class="mini-progress">
                <div class="mini-progress-bg"></div>
                <div
                    class="mini-progress-fill"
                    style="width: {$progress * 100}%"
                ></div>
            </div>

            <!-- Main content row -->
            <div class="mini-content">
                <!-- Left: Album art -->
                {#if $currentTrack}
                    <div class="mini-art">
                        {#if albumArt && !imageLoadFailed}
                            <img
                                src={albumArt}
                                alt="Album art"
                                decoding="async"
                                on:error={() => (imageLoadFailed = true)}
                            />
                        {:else}
                            <div class="mini-art-placeholder">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="20"
                                    height="20"
                                >
                                    <path
                                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                    />
                                </svg>
                            </div>
                        {/if}
                    </div>

                    <!-- Middle: Track info -->
                    <div class="mini-info">
                        <div class="mini-title-row">
                            <span class="mini-title"
                                >{$currentTrack.title || "Unknown Title"}</span
                            >
                            {#if isLive}
                                <span class="live-badge mini">LIVE</span>
                            {/if}
                        </div>
                        <span class="mini-artist"
                            >{$currentTrack.artist || "Unknown Artist"}</span
                        >
                    </div>
                {:else}
                    <div class="mini-info">
                        <span
                            class="mini-title"
                            style="color: var(--text-subdued)"
                            >No track playing</span
                        >
                    </div>
                {/if}

                <!-- Like button (mobile) -->
                {#if $currentTrack}
                    <button
                        class="mini-like-btn"
                        class:liked={isCurrentLiked}
                        on:click|stopPropagation={() =>
                            $currentTrack && toggleLike($currentTrack.id)}
                        title={isCurrentLiked
                            ? "Remove from Liked Songs"
                            : "Add to Liked Songs"}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill={isCurrentLiked
                                ? "var(--accent-color, #1db954)"
                                : "none"}
                            stroke={isCurrentLiked
                                ? "var(--accent-color, #1db954)"
                                : "currentColor"}
                            stroke-width="2"
                        >
                            <path
                                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                            />
                        </svg>
                    </button>
                {/if}

                <!-- Right: Controls (stop propagation so taps don't open fullscreen) -->
                <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                <div
                    class="mini-controls"
                    on:click|stopPropagation
                    on:keydown|stopPropagation
                    role="group"
                >
                    <button
                        class="mini-btn"
                        on:click={togglePlay}
                        title={$isPlaying ? "Pause" : "Play"}
                    >
                        {#if $isPlaying}
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="28"
                                height="28"
                            >
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                            </svg>
                        {:else}
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="28"
                                height="28"
                            >
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        {/if}
                    </button>
                    <button class="mini-btn" on:click={nextTrack} title="Next">
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    {:else}
        <!-- Track info -->
        <div class="track-info desktop-track-info">
            {#if $currentTrack}
                <div class="album-art">
                    {#if albumArt && !imageLoadFailed}
                        <img
                            src={albumArt}
                            alt="Album art"
                            decoding="async"
                            on:error={() => (imageLoadFailed = true)}
                        />
                    {:else}
                        <div class="album-art-placeholder">
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
                </div>
                <div class="track-details">
                    <span class="track-title truncate"
                        >{$currentTrack.title || "Unknown Title"}</span
                    >
                    <span
                        class="track-artist truncate"
                        role="button"
                        tabindex="0"
                        on:click|stopPropagation={() => {
                            if ($currentTrack?.artist) {
                                goToArtistDetail($currentTrack.artist);
                            }
                        }}
                        on:keydown={(e) => {
                            if (e.key === "Enter" && $currentTrack?.artist) {
                                goToArtistDetail($currentTrack.artist);
                            }
                        }}>{$currentTrack.artist || "Unknown Artist"}</span
                    >
                </div>

                <!-- Like button (desktop) -->
                <button
                    class="like-btn"
                    class:liked={isCurrentLiked}
                    on:click|stopPropagation={() =>
                        $currentTrack && toggleLike($currentTrack.id)}
                    title={isCurrentLiked
                        ? "Remove from Liked Songs"
                        : "Add to Liked Songs"}
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill={isCurrentLiked
                            ? "var(--accent-color, #1db954)"
                            : "none"}
                        stroke={isCurrentLiked
                            ? "var(--accent-color, #1db954)"
                            : "currentColor"}
                        stroke-width="2"
                    >
                        <path
                            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                        />
                    </svg>
                </button>
            {:else}
                <div class="no-track">
                    <span>No track playing</span>
                </div>
            {/if}
            <!-- Plugin slot: Left -->
            <div class="plugin-slot" bind:this={slotStart}></div>
        </div>

        <!-- Playback controls -->
        <div class="playback-controls">
            <div class="controls-buttons">
                <button
                    class="icon-btn"
                    class:active={$shuffle}
                    on:click={toggleShuffle}
                    title="Shuffle"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
                        />
                    </svg>
                </button>
                <button
                    class="icon-btn"
                    on:click={previousTrack}
                    title="Previous"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="24"
                        height="24"
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
                            width="24"
                            height="24"
                        >
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                    {:else}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    {/if}
                </button>
                <button class="icon-btn" on:click={nextTrack} title="Next">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="24"
                        height="24"
                    >
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                    </svg>
                </button>
                <button
                    class="icon-btn"
                    class:active={$repeat !== "none"}
                    on:click={cycleRepeat}
                    title="Repeat: {$repeat}"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
                        />
                    </svg>
                    {#if $repeat === "one"}
                        <span class="repeat-one">1</span>
                    {/if}
                </button>
            </div>

            <!-- Progress bar -->
            <div class="progress-container">
                {#if isLive}
                    <span class="live-badge">LIVE</span>
                    <div class="progress-bar live-bar">
                        <div class="progress-track">
                            <div class="progress-fill live-fill"></div>
                        </div>
                    </div>
                    <span class="time live-time"
                        >{formatDuration($currentTime)}</span
                    >
                {:else}
                    <span class="time">{formatDuration($currentTime)}</span>
                    <div
                        class="progress-bar"
                        bind:this={seekBarElement}
                        on:mousedown={handleSeekStart}
                        role="slider"
                        aria-label="Seek"
                        aria-valuenow={Math.round($progress * 100)}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        tabindex="0"
                    >
                        <div class="progress-track">
                            <div
                                class="progress-fill"
                                style="width: {$progress * 100}%"
                            ></div>
                        </div>
                        <div
                            class="progress-thumb"
                            style="left: {$progress * 100}%"
                        ></div>
                    </div>
                    <span class="time">{formatDuration($duration)}</span>
                {/if}
            </div>
        </div>

        <!-- Volume controls -->
        <div class="volume-controls">
            <!-- Plugin slot: Right -->
            <div class="plugin-slot" bind:this={slotEnd}></div>
            <button
                class="icon-btn"
                class:active={$isQueueVisible}
                on:click={toggleQueue}
                title="Queue (Q)"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                >
                    <path
                        d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
                    />
                </svg>
            </button>
            <button
                class="icon-btn"
                class:active={$lyricsVisible}
                on:click={toggleLyrics}
                title="Lyrics (L)"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                >
                    <path
                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm-2 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"
                    />
                </svg>
            </button>
            <div class="volume-separator"></div>
            <PluginMenu />
            <div class="volume-separator"></div>
            <button
                class="icon-btn"
                on:click={() => setVolume($volume > 0 ? 0 : 1)}
                title={$volume > 0 ? "Mute (M)" : "Unmute (M)"}
            >
                {#if $volume === 0}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                        />
                    </svg>
                {:else if $volume < 0.5}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"
                        />
                    </svg>
                {:else}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                        />
                    </svg>
                {/if}
            </button>
            <div
                class="volume-bar"
                bind:this={volumeBarElement}
                on:mousedown={handleVolumeStart}
                on:keydown={handleVolumeKey}
                on:wheel={handleVolumeScroll}
                role="slider"
                aria-label="Volume"
                aria-valuenow={Math.round($volume * 100)}
                aria-valuemin="0"
                aria-valuemax="100"
                tabindex="0"
            >
                <div class="volume-track">
                    <div
                        class="volume-fill"
                        style="width: {$volume * 100}%"
                    ></div>
                </div>
                <div class="volume-thumb" style="left: {$volume * 100}%"></div>
            </div>
            <button
                class="icon-btn"
                class:active={$isFullScreen}
                on:click={toggleFullScreen}
                title="Fullscreen"
            >
                {#if $isFullScreen}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                        />
                    </svg>
                {:else}
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path
                            d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                        />
                    </svg>
                {/if}
            </button>
            <button
                class="icon-btn"
                on:click={toggleMiniPlayer}
                title="Mini Player (P)"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                >
                    <path
                        d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"
                    />
                </svg>
            </button>
        </div>
    {/if}
</footer>

<style>
    .player-bar {
        height: var(--player-height);
        background-color: var(--bg-elevated);
        border-top: 1px solid var(--border-color);
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
        align-items: center;
        padding: 0 var(--spacing-md);
        gap: var(--spacing-md);
        /* overflow: hidden; - Removed to allow menus to popup */
    }

    .player-bar.hidden {
        position: absolute;
        left: -9999px;
        visibility: hidden;
        pointer-events: none;
    }

    /* Track info */
    .track-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
        overflow: hidden;
    }

    .album-art {
        width: 64px;
        height: 64px;
        border-radius: var(--radius-md);
        overflow: hidden;
        flex-shrink: 0;
        background-color: var(--bg-surface);
        transition: transform var(--transition-fast);
        cursor: pointer;
    }

    .album-art:hover {
        transform: scale(1.05);
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .album-art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .track-details {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .track-title {
        font-size: 0.875rem;
        font-weight: 500;
    }

    .track-title:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .track-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .track-artist:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .no-track {
        color: var(--text-subdued);
        font-size: 0.875rem;
    }

    /* Like button (desktop) */
    .like-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
        flex-shrink: 0;
        margin-left: 8px;
    }

    .like-btn:hover {
        color: var(--text-primary);
        transform: scale(1.15);
    }

    .like-btn.liked {
        color: var(--accent-color, #1db954);
    }

    .like-btn.liked:hover {
        transform: scale(1.15);
    }

    /* Like button (mobile mini-player) */
    .mini-like-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
    }

    .mini-like-btn:hover {
        color: var(--text-primary);
    }

    .mini-like-btn.liked {
        color: var(--accent-color, #1db954);
    }

    /* Playback controls */
    .playback-controls {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-xs);
        min-width: 0;
        overflow: visible;
    }

    .controls-buttons {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-shrink: 0;
    }

    .play-btn {
        width: 40px;
        height: 40px;
        position: relative;
        border-radius: var(--radius-full);
        background-color: var(--text-primary);
        color: var(--bg-base);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all var(--transition-fast);
        flex-shrink: 0;
        z-index: 10;
    }

    .play-btn:hover {
        transform: scale(1.08);
        background-color: var(--accent-hover);
        z-index: 100;
    }

    .icon-btn {
        position: relative;
    }

    .icon-btn::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
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
        margin-bottom: 8px;
        box-shadow: var(--shadow-md);
    }

    .icon-btn:hover::after {
        opacity: 1;
    }

    .repeat-one {
        position: absolute;
        font-size: 0.6rem;
        font-weight: 700;
        margin-top: 2px;
    }

    /* Progress bar */
    .progress-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        max-width: 600px;
    }

    .time {
        font-size: 0.7rem;
        color: var(--text-subdued);
        min-width: 40px;
        text-align: center;
    }

    .progress-bar,
    .volume-bar {
        flex: 1;
        height: 12px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .progress-track,
    .volume-track {
        width: 100%;
        height: 4px;
        background-color: var(--bg-highlight);
        border-radius: var(--radius-full);
        overflow: hidden;
    }

    .progress-fill,
    .volume-fill {
        height: 100%;
        background-color: var(--text-secondary);
        border-radius: var(--radius-full);
        transition: background-color var(--transition-fast);
    }

    .progress-bar:hover .progress-fill,
    .volume-bar:hover .volume-fill {
        background-color: var(--accent-primary);
    }

    .progress-thumb,
    .volume-thumb {
        position: absolute;
        width: 14px;
        height: 14px;
        background-color: var(--text-primary);
        border-radius: var(--radius-full);
        transform: translateX(-50%) scale(0);
        transition: transform var(--transition-fast);
        box-shadow: var(--shadow-md);
    }

    .progress-bar:hover .progress-thumb,
    .volume-bar:hover .volume-thumb {
        transform: translateX(-50%) scale(1);
    }

    /* LIVE badge */
    .live-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #fff;
        background: #e53935;
        padding: 2px 8px;
        border-radius: 4px;
        flex-shrink: 0;
        text-transform: uppercase;
        line-height: 1;
    }

    .live-badge::before {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #fff;
        animation: live-pulse 1.5s ease-in-out infinite;
    }

    @keyframes live-pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.3;
        }
    }

    /* Mobile mini-player LIVE badge */
    .live-badge.mini {
        font-size: 0.55rem;
        padding: 1px 5px;
        margin-left: 6px;
    }

    .mini-title-row {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .mini-title-row .mini-title {
        flex: 0 1 auto;
        min-width: 0;
    }

    /* Live progress bar — non-interactive, steady glow */
    .live-bar {
        cursor: default;
    }

    .live-fill {
        width: 100% !important;
        background: linear-gradient(90deg, #e53935, #ff7043, #e53935);
        background-size: 200% 100%;
        animation: live-bar-shimmer 3s ease-in-out infinite;
    }

    @keyframes live-bar-shimmer {
        0% {
            background-position: 0% 50%;
        }
        50% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0% 50%;
        }
    }

    .live-time {
        color: #e53935;
    }

    /* Volume controls */
    .volume-controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--spacing-xs);
        min-width: 0;
        /* overflow: hidden; - Removed to allow nested menus */
    }

    .volume-separator {
        width: 1px;
        height: 20px;
        background-color: var(--border-color);
        margin: 0 var(--spacing-xs);
    }

    .volume-bar {
        width: 80px;
        flex-shrink: 1;
        min-width: 40px;
    }

    .plugin-slot {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    /* =========================================
       SPOTIFY-STYLE MOBILE MINI-PLAYER
       ========================================= */
    .player-bar.mobile {
        position: fixed;
        bottom: calc(60px + env(safe-area-inset-bottom));
        left: 8px;
        right: 8px;
        width: auto;
        height: 64px;
        display: block;
        padding: 0;
        gap: 0;
        z-index: 900;
        background-color: #282828;
        border: none;
        border-radius: 8px;
        box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }

    .player-bar.mobile-no-track {
        visibility: hidden;
        height: 0;
        overflow: hidden;
        border: none;
        pointer-events: none;
    }

    /* The entire mini-player is tappable to open fullscreen */
    .mini-player-tap {
        width: 100%;
        height: 100%;
        cursor: pointer;
        position: relative;
        -webkit-tap-highlight-color: transparent;
    }

    /* Thin progress line at the very top */
    .mini-progress {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        z-index: 1;
    }

    .mini-progress-bg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: #404040;
    }

    .mini-progress-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        background-color: #1db954;
        transition: width 0.3s linear;
    }

    /* Main content row */
    .mini-content {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 12px 0 8px;
        gap: 12px;
    }

    /* Album art */
    .mini-art {
        width: 48px;
        height: 48px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background-color: #333;
    }

    .mini-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .mini-art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background-color: #333;
    }

    /* Track info */
    .mini-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        overflow: hidden;
    }

    .mini-title {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
    }

    .mini-artist {
        font-size: 12px;
        color: #b3b3b3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
        line-height: 1.3;
    }

    /* Control buttons */
    .mini-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .mini-btn {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: none;
        border: none;
        cursor: pointer;
        border-radius: 50%;
        -webkit-tap-highlight-color: transparent;
        transition: opacity 0.15s ease;
    }

    .mini-btn:active {
        opacity: 0.6;
    }
</style>
