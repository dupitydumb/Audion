<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount } from "svelte";
    import { get } from "svelte/store";
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
        activeBackend,
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
    import { pluginDrawerOpen } from "$lib/stores/plugin-drawer";
    import { goToArtistDetail } from "$lib/stores/view";
    import { isMobile } from "$lib/stores/mobile";
    import type { Album } from "$lib/api/tauri";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import { likedTrackIds, toggleLike } from "$lib/stores/liked";
    import {
        sleepTimerActive,
        sleepTimerLastDurationMinutes,
        sleepTimerRemainingMs,
        SLEEP_TIMER_PRESETS,
        startSleepTimer,
        stopSleepTimer,
    } from "$lib/stores/sleepTimer";
    import ConnectPanel from "./ConnectPanel.svelte";
    import Icon from "$lib/components/Icon.svelte";
    import { wsStore } from "$lib/stores/websocket";

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
    let showConnectPanel = false;
    let showSleepTimerMenu = false;
    let sleepTimerElement: HTMLDivElement;

    $: connectedDevices = $wsStore.devices.length;

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
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        // Update UI immediately for smooth drag — fire-and-forget to backend
        // i know the drag is buggy. but this is the best we can do
        // Poller will correct position on next tick if keyframe alignment differs.
        const previousSecs = get(currentTime);
        currentTime.set(pos * $duration);
        seek(pos, previousSecs);
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

    function formatSleepTimerRemaining(ms: number): string {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m`;
        }

        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function toggleSleepTimerMenu() {
        showSleepTimerMenu = !showSleepTimerMenu;
    }

    function setSleepTimer(minutes: number) {
        startSleepTimer(minutes);
        showSleepTimerMenu = false;
    }

    function cancelSleepTimer() {
        stopSleepTimer();
        showSleepTimerMenu = false;
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
        const handleDocumentMouseDown = (e: MouseEvent) => {
            if (
                showSleepTimerMenu &&
                sleepTimerElement &&
                !sleepTimerElement.contains(e.target as Node)
            ) {
                showSleepTimerMenu = false;
            }
        };

        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        document.addEventListener("mousedown", handleDocumentMouseDown);

        // Register UI slots
        if (slotStart)
            uiSlotManager.registerContainer("playerbar:left", slotStart);
        if (slotEnd)
            uiSlotManager.registerContainer("playerbar:right", slotEnd);

        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            document.removeEventListener("mousedown", handleDocumentMouseDown);

            // Unregister slots
            uiSlotManager.unregisterContainer("playerbar:left");
            uiSlotManager.unregisterContainer("playerbar:right");
        };
    });
</script>

{#if !$isMobile}
<footer
    class="player-bar"
    class:hidden
>
    <!-- Native audio backend handles playback in Rust -->

    <!-- Track info -->
    <div class="track-info desktop-track-info">
            {#if $currentTrack}
                <div
                    class="album-art"
                    style="view-transition-name: {$isFullScreen ? 'none' : 'player-album-art'};"
                >
                    {#if albumArt && !imageLoadFailed}
                        <img
                            src={albumArt}
                            alt="Album art"
                            decoding="async"
                            on:error={() => (imageLoadFailed = true)}
                        />
                    {:else}
                        <div class="album-art-placeholder">
                            <Icon name="music" size={24} />
                        </div>
                    {/if}
                </div>
                <div class="track-details">
                    <span class="track-title truncate"
                        >{$currentTrack.title || $_('player.unknownTitle')}</span
                    >
                    <ArtistLinks
                        artist={$currentTrack.artist || $_('common.unknownArtist')}
                        artists={$currentTrack.artists}
                        chipClass="track-artist truncate"
                        marquee
                        marqueeTrigger="always"
                        resetKey={$currentTrack.id}
                        on:select={(e) => goToArtistDetail(e.detail)}
                    />
                </div>

                <!-- Like button (desktop) -->
                <button
                    class="like-btn"
                    class:liked={isCurrentLiked}
                    on:click|stopPropagation={() =>
                        $currentTrack && toggleLike($currentTrack.id)}
                    title={isCurrentLiked
                        ? $_('player.removeFromLiked')
                        : $_('player.addToLiked')}
                >
                    <Icon name={isCurrentLiked ? "heart-filled" : "heart"} size={16} />
                </button>
            {:else}
                <div class="no-track">
                    <span>{$_('player.noTrack')}</span>
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
                    title={$_('player.shuffle')}
                >
                    <Icon name="shuffle" size={20} />
                </button>
                <button
                    class="icon-btn"
                    on:click={previousTrack}
                    title={$_('player.previous')}
                >
                    <Icon name="skip-back" size={24} />
                </button>
                <button
                    class="play-btn"
                    on:click={togglePlay}
                    title={$isPlaying ? $_('common.pause') : $_('common.play')}
                >
                    <Icon name={$isPlaying ? "pause" : "play"} size={24} />
                </button>
                <button class="icon-btn" on:click={nextTrack} title={$_('player.next')}>
                    <Icon name="skip-forward" size={24} />
                </button>
                <button
                    class="icon-btn"
                    class:active={$repeat !== "none"}
                    on:click={cycleRepeat}
                    title={$_('player.repeatMode', {
                        values: {
                            mode:
                                $repeat === 'one'
                                    ? $_('player.repeatOne')
                                    : $repeat === 'all'
                                      ? $_('player.repeatAll')
                                      : $_('player.repeatOff'),
                        },
                    })}
                >
                    <Icon name={$repeat === "one" ? "repeat-1" : "repeat"} size={20} />
                    {#if $repeat === "one"}
                        <span class="repeat-one">1</span>
                    {/if}
                </button>
            </div>

            <!-- Progress bar -->
            <div class="progress-container">
                {#if isLive}
                    <span class="live-badge">{$_('player.live')}</span>
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
                        class:seeking={isSeeking}
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

            <div class="utility-controls">
                <!-- Backend indicator -->
                {#if $activeBackend === 'native'}
                    <span class="backend-badge native" title={$_('player.nativeAudioBackend')}>N</span>
                {:else if $activeBackend === 'html5'}
                    <span class="backend-badge html5" title={$_('player.html5AudioBackend')}>H</span>
                {/if}
                <!-- Connect button moved into utility group -->
                <button
                    class="icon-btn connect-btn"
                    class:active={connectedDevices > 0}
                    on:click={() => (showConnectPanel = !showConnectPanel)}
                    title={$_('connect.title')}
                >
                    <Icon name="cast" size={18} />
                    {#if connectedDevices > 0}
                        <div class="device-dot"></div>
                    {/if}
                </button>
                <div class="sleep-timer" bind:this={sleepTimerElement}>
                    <button
                        class="icon-btn"
                        class:active={$sleepTimerActive}
                        on:click={toggleSleepTimerMenu}
                        title={$sleepTimerActive
                            ? $_('player.sleepTimerRemaining', { values: { remaining: formatSleepTimerRemaining($sleepTimerRemainingMs) } })
                            : $_('player.sleepTimer')}
                    >
                        <Icon name="moon" size={20} />
                    </button>

                    {#if showSleepTimerMenu}
                        <div class="sleep-timer-menu">
                            <div class="sleep-timer-header">
                                <span class="sleep-timer-title">{$_('player.sleepTimer')}</span>
                                {#if $sleepTimerActive}
                                    <span class="sleep-timer-remaining"
                                        >{formatSleepTimerRemaining(
                                            $sleepTimerRemainingMs,
                                        )}</span
                                    >
                                {/if}
                            </div>

                            <div class="sleep-timer-presets">
                                {#each SLEEP_TIMER_PRESETS as minutes}
                                    <button
                                        class="sleep-preset-btn"
                                        class:active={
                                            $sleepTimerLastDurationMinutes ===
                                            minutes
                                        }
                                        on:click={() => setSleepTimer(minutes)}
                                    >
                                        {minutes}m
                                    </button>
                                {/each}
                            </div>

                            {#if $sleepTimerActive}
                                <button
                                    class="sleep-cancel-btn"
                                    on:click={cancelSleepTimer}
                                >
                                    {$_('player.cancelTimer')}
                                </button>
                            {/if}
                        </div>
                    {/if}
                </div>

                <button
                    class="icon-btn"
                    class:active={$isQueueVisible}
                    on:click={toggleQueue}
                    title={$_('player.queueShortcut')}
                >
                    <Icon name="queue" size={18} />
                </button>
                <button
                    class="icon-btn"
                    class:active={$lyricsVisible}
                    on:click={toggleLyrics}
                    title={$_('player.lyricsShortcut')}
                >
                    <Icon name="lyrics" size={18} />
                </button>
                <button
                    class="icon-btn"
                    class:active={$pluginDrawerOpen}
                    on:click={() => pluginDrawerOpen.set(true)}
                    title={$_('player.pluginActions')}
                >
                    <Icon name="plugin" size={18} />
                </button>
            </div>

            <div class="volume-controls-main">
                <button
                    class="icon-btn"
                    on:click={() => setVolume($volume > 0 ? 0 : 1)}
                    title={$volume > 0 ? $_('player.mute') : $_('player.unmute')}
                >
                    <Icon name={$volume === 0 ? "volume-x" : $volume < 0.5 ? "volume-1" : "volume-2"} size={20} />
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
            </div>

            <div class="view-controls">
                <button
                    class="icon-btn"
                    class:active={$isFullScreen}
                    on:click={toggleFullScreen}
                    title={$_('player.fullscreen')}
                >
                    <Icon name={$isFullScreen ? "minimize" : "fullscreen"} size={18} />
                </button>
                <button
                    class="icon-btn"
                    on:click={toggleMiniPlayer}
                    title={$_('player.miniPlayer')}
                >
                    <Icon name="monitor" size={18} />
                </button>
            </div>
        </div>
</footer>
{/if}

{#if showConnectPanel}
    <ConnectPanel on:close={() => showConnectPanel = false} />
{/if}

<style>
    .player-bar {
        height: var(--player-height);
        background-color: var(--bg-elevated);
        border-top: 1px solid var(--border-color);
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
        align-items: center;
        padding: 0 calc(var(--spacing-md) + 2px);
        gap: clamp(20px, 2.2vw, 36px);
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

    .desktop-track-info {
        padding-right: var(--spacing-sm);
    }

    .album-art {
        width: 54px;
        height: 54px;
        border-radius: 14px;
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
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
    }

    .track-title:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .track-artist {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
    }

    .track-artist:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .no-track {
        color: var(--text-subdued);
        font-size: var(--font-size-base);
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

    .icon-btn.active {
        color: var(--accent-color, #1db954);
    }

    .connect-btn {
        position: relative;
    }

    .device-dot {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 6px;
        height: 6px;
        background: var(--accent-color, #1db954);
        border-radius: 50%;
        box-shadow: 0 0 5px var(--accent-color, #1db954);
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
        padding-top: 6px;
    }

    .controls-buttons {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .controls-buttons .icon-btn {
        width: 34px;
        height: 34px;
    }

    .controls-buttons .icon-btn svg {
        width: 18px;
        height: 18px;
    }

    .play-btn {
        width: 44px;
        height: 44px;
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

    .play-btn svg {
        width: 24px;
        height: 24px;
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
        font-size: var(--font-size-xs);
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
        font-weight: var(--font-weight-bold);
        margin-top: 2px;
    }

    /* Progress bar */
    .progress-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        width: 100%;
        max-width: 600px;
    }

    .time {
        font-size: 0.7rem;
        color: var(--text-subdued);
        min-width: 40px;
        text-align: center;
    }

    .progress-bar {
        flex: 1;
        height: 16px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .volume-bar {
        flex: 1;
        height: 12px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .progress-track {
        width: 100%;
        height: 7px;
        background-color: var(--bg-highlight);
        border-radius: var(--radius-full);
        overflow: hidden;
    }

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

    .progress-bar:not(.seeking) .progress-fill {
        transition: background-color var(--transition-fast), width 100ms linear;
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
        transform: translateX(-50%) scale(1.25);
        box-shadow: 0 0 12px var(--accent-primary);
    }


    /* Backend indicator badge */
    .backend-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        flex-shrink: 0;
        line-height: 1;
        opacity: 0.6;
        transition: opacity 0.2s;
    }
    .backend-badge:hover {
        opacity: 1;
    }
    .backend-badge.native {
        color: #4ade80;
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid rgba(74, 222, 128, 0.3);
    }
    .backend-badge.html5 {
        color: #60a5fa;
        background: rgba(96, 165, 250, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.3);
    }

    /* LIVE badge */
    .live-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.65rem;
        font-weight: var(--font-weight-bold);
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
        gap: 10px;
        min-width: 0;
        padding-left: var(--spacing-sm);
        /* overflow: hidden; - Removed to allow nested menus */
    }

    .utility-controls {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .utility-controls .icon-btn {
        width: 32px;
        height: 32px;
    }

    .sleep-timer {
        position: relative;
    }

    .sleep-timer-menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + 10px);
        width: 220px;
        padding: 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-lg);
        z-index: 60;
    }

    .sleep-timer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        gap: 8px;
    }

    .sleep-timer-title {
        font-size: 0.78rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .sleep-timer-remaining {
        font-size: 0.72rem;
        color: var(--accent-color, #1db954);
        font-weight: var(--font-weight-semibold);
    }

    .sleep-timer-presets {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
    }

    .sleep-preset-btn,
    .sleep-cancel-btn {
        border: 1px solid var(--border-color);
        background: var(--bg-surface);
        color: var(--text-secondary);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        height: 30px;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .sleep-preset-btn:hover,
    .sleep-cancel-btn:hover {
        border-color: var(--accent-color, #1db954);
        color: var(--text-primary);
    }

    .sleep-preset-btn.active {
        border-color: var(--accent-color, #1db954);
        color: var(--accent-color, #1db954);
    }

    .sleep-cancel-btn {
        width: 100%;
        margin-top: 8px;
    }

    .volume-controls-main {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .view-controls {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .view-controls .icon-btn {
        width: 32px;
        height: 32px;
    }

    .volume-bar {
        width: 96px;
        flex-shrink: 1;
        min-width: 60px;
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
        font-weight: var(--font-weight-semibold);
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
