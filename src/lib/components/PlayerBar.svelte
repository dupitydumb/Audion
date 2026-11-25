<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount } from "svelte";
    import { fly } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
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
        isInspectorOpen,
        activeInspectorTab,
        toggleInspectorTab,
    } from "$lib/stores/inspector";
    import { formatDuration, getAlbum, getIsLinux } from "$lib/api/tauri";
    import { resolveTrackCover } from "$lib/stores/library";
    import { customArtworks } from "$lib/stores/customArtwork";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import { pluginDrawerOpen } from "$lib/stores/plugin-drawer";
    import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
    import { isMobile } from "$lib/stores/mobile";
    import { albums } from "$lib/stores/library";
    import type { Album } from "$lib/api/tauri";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import { likedTrackIds, toggleLike } from "$lib/stores/liked";
    import {
        sleepTimerActive,
        sleepTimerLastDurationMinutes,
        sleepTimerRemainingMs,
        sleepTimerMode,
        sleepTimerFadeEnabled,
        SLEEP_TIMER_PRESETS,
        startSleepTimer,
        startSleepTimerEndOfTrack,
        stopSleepTimer,
        toggleSleepTimerFade,
    } from "$lib/stores/sleepTimer";
    import ConnectPanel from "./ConnectPanel.svelte";
    import Icon from "$lib/components/Icon.svelte";
    import AudioQualityBadge from "$lib/components/AudioQualityBadge.svelte";
    import AudioVisualizer from "$lib/components/AudioVisualizer.svelte";
    import { theme } from "$lib/stores/theme";
    import { wsStore } from "$lib/stores/websocket";
    import { appSettings } from "$lib/stores/settings";
    import {
        nativeAudioListDevices,
        nativeAudioSetOutputDevice,
        type AudioDeviceInfo,
    } from "$lib/services/native-audio";

    $: isCurrentLiked = $currentTrack
        ? $likedTrackIds.has($currentTrack.id)
        : false;

    // Detect live streams (radio, etc.) — no duration, streaming source
    $: isLive = $currentTrack
        ? $currentTrack.source_type === "radio" ||
          (isStreaming($currentTrack) &&
              (!$currentTrack.duration || $currentTrack.duration === 0) &&
              (!$duration || $duration === 0 || !isFinite($duration)))
        : false;

    export let hidden: boolean = false;

    let seekBarElement: HTMLDivElement;
    let volumeBarElement: HTMLDivElement;
    let isSeeking = false;
    let isDraggingSeek = false;
    let seekStartSecs = 0;
    let seekPos = 0;
    let isScrubberHovered = false;
    let hoverRatio = 0;

    $: displayProgress = isSeeking ? seekPos : $progress;
    $: displayCurrentTime = isSeeking ? (seekPos * $duration) : $currentTime;

    let isVolumeChanging = false;
    let isVolumeHovered = false;
    let isVolumeWheeling = false;
    let volumeWheelTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastNonZeroVolume = 0.7;

    $: if ($volume >= 0.05) {
        lastNonZeroVolume = $volume;
    }

    function toggleMute() {
        if ($volume > 0) {
            if ($volume >= 0.05) {
                lastNonZeroVolume = $volume;
            }
            setVolume(0);
        } else {
            setVolume(lastNonZeroVolume >= 0.05 ? lastNonZeroVolume : 0.7);
        }
    }

    function triggerVolumeBadge() {
        isVolumeWheeling = true;
        if (volumeWheelTimeout) clearTimeout(volumeWheelTimeout);
        volumeWheelTimeout = setTimeout(() => {
            isVolumeWheeling = false;
        }, 1200);
    }

    $: displayHoverRatio = isSeeking ? seekPos : hoverRatio;
    $: hoverTime = displayHoverRatio * ($duration || 0);
    $: showScrubberTooltip = (isScrubberHovered || isSeeking) && ($duration > 0);
    $: showVolumeTooltip = isVolumeHovered || isVolumeChanging || isVolumeWheeling;

    let albumArt: string | null = null;
    let imageLoadFailed = false;
    let showConnectPanel = false;
    let showSleepTimerMenu = false;
    let sleepTimerElement: HTMLDivElement;

    // Audio Output Device Picker
    let showDevicePicker = false;
    let devicePickerRef: HTMLDivElement | null = null;
    let audioDevices: AudioDeviceInfo[] = [];

    // Overflow "⋯" menu when playerbar is compressed
    let showOverflowMenu = false;
    let overflowMenuRef: HTMLDivElement | null = null;

    function toggleOverflowMenu(e: MouseEvent) {
        e.stopPropagation();
        showOverflowMenu = !showOverflowMenu;
    }

    async function toggleDevicePicker(e: MouseEvent) {
        e.stopPropagation();
        showDevicePicker = !showDevicePicker;
        if (showDevicePicker) {
            try {
                const res = await nativeAudioListDevices();
                audioDevices = res.devices || [];
            } catch (err) {
                console.warn("[PlayerBar] Failed to enumerate audio devices:", err);
            }
        }
    }

    async function selectDevice(deviceId: string | null) {
        try {
            await nativeAudioSetOutputDevice(deviceId);
            appSettings.setOutputDevice(deviceId);
        } catch (err) {
            console.warn("[PlayerBar] Failed to switch output device:", err);
        }
        showDevicePicker = false;
    }

    $: connectedDevices = $wsStore.devices.length;

    // Slot containers
    let slotStart: HTMLDivElement;
    let slotEnd: HTMLDivElement;

    // Expose audio element for visualizer - removed for native backend

    // Load track cover - single shared resolver (custom artwork aware)
    $: if ($currentTrack) {
        void loadTrackCover($currentTrack, $customArtworks);
    } else {
        albumArt = null;
        imageLoadFailed = false;
    }

    async function loadTrackCover(track: any, _customs?: unknown) {
        imageLoadFailed = false;

        try {
            let src = resolveTrackCover(track);

            // album art not cached yet (library still loading) => fetch the album and retry
            if (!src && track.album_id) {
                const album = await getAlbum(track.album_id);
                // ignore if the track changed while we were awaiting
                if (get(currentTrack)?.id !== track.id) return;
                src = resolveTrackCover(track, album);
            }

            albumArt = src;
        } catch (e) {
            console.error("Failed to load track cover:", e);
            albumArt = null;
        }
    }

    $: canNavigateToAlbum = Boolean(
        $currentTrack &&
            ($currentTrack.album_id != null ||
                ($currentTrack.album &&
                    $albums.some(
                        (a) =>
                            a.name.trim().toLowerCase() ===
                            $currentTrack?.album?.trim().toLowerCase(),
                    ))),
    );

    function handleAlbumClick(e: MouseEvent) {
        e.stopPropagation();
        if (!$currentTrack) return;

        let targetAlbumId: number | null = $currentTrack.album_id ?? null;

        if (!targetAlbumId && $currentTrack.album) {
            const albumName = $currentTrack.album.trim().toLowerCase();
            const trackArtist = $currentTrack.artist?.trim().toLowerCase();
            const allAlbums = get(albums);

            const matched =
                allAlbums.find(
                    (a) =>
                        a.name.trim().toLowerCase() === albumName &&
                        trackArtist &&
                        a.artist?.trim().toLowerCase() === trackArtist,
                ) ||
                allAlbums.find((a) => a.name.trim().toLowerCase() === albumName);

            if (matched) {
                targetAlbumId = matched.id;
            }
        }

        if (targetAlbumId) {
            if (get(lyricsVisible)) lyricsVisible.set(false);
            if (get(isQueueVisible)) isQueueVisible.set(false);
            goToAlbumDetail(targetAlbumId);
        }
    }

    function handleSeekStart(e: MouseEvent | PointerEvent) {
        if (!seekBarElement) return;
        if (!$currentTrack || !$duration || $duration <= 0) return;
        if (isDraggingSeek) return;
        isSeeking = true;
        isDraggingSeek = true;
        seekStartSecs = get(currentTime);
        if ('setPointerCapture' in e && 'pointerId' in e) {
            try {
                (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
            } catch {}
        }
        handleSeek(e);
    }

    function handleSeek(e: MouseEvent | PointerEvent) {
        if (!seekBarElement || !isDraggingSeek) return;
        const rect = seekBarElement.getBoundingClientRect();
        seekPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    async function handleSeekEnd(e?: MouseEvent | PointerEvent) {
        if (!isDraggingSeek) return;
        if (e && 'releasePointerCapture' in e && 'pointerId' in e) {
            try {
                (e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);
            } catch {}
        }
        isDraggingSeek = false;
        const targetPos = seekPos;
        const startSecs = seekStartSecs;
        currentTime.set(targetPos * $duration);
        try {
            await seek(targetPos, startSecs);
        } finally {
            isSeeking = false;
        }
    }

    function handleScrubberMouseMove(e: MouseEvent | PointerEvent) {
        if (!seekBarElement) return;
        const rect = seekBarElement.getBoundingClientRect();
        hoverRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        isScrubberHovered = true;
    }

    function handleScrubberMouseLeave() {
        isScrubberHovered = false;
    }

    function handleVolumeStart(e: MouseEvent | PointerEvent) {
        if (isVolumeChanging) return;
        isVolumeChanging = true;
        if ('setPointerCapture' in e && 'pointerId' in e) {
            try {
                (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
            } catch {}
        }
        handleVolumeChange(e);
    }

    function handleVolumeChange(e: MouseEvent | PointerEvent) {
        if (!volumeBarElement) return;
        const rect = volumeBarElement.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        setVolume(Math.max(0, Math.min(1, pos)));
    }

    function handleVolumeEnd(e?: MouseEvent | PointerEvent) {
        if (!isVolumeChanging) return;
        if (e && 'releasePointerCapture' in e && 'pointerId' in e) {
            try {
                (e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);
            } catch {}
        }
        isVolumeChanging = false;
    }

    function handleVolumeKey(e: KeyboardEvent) {
        const step = 0.05;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            triggerVolumeBadge();
            setVolume(Math.min(1, $volume + step));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            triggerVolumeBadge();
            setVolume(Math.max(0, $volume - step));
        }
    }

    function handleVolumeScroll(e: WheelEvent) {
        e.preventDefault();
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        triggerVolumeBadge();
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

    function setEndOfTrackTimer() {
        startSleepTimerEndOfTrack();
        showSleepTimerMenu = false;
    }

    function cancelSleepTimer() {
        stopSleepTimer();
        showSleepTimerMenu = false;
    }

    onMount(() => {
        // Global mouse events for seeking and volume
        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (isDraggingSeek) {
                handleSeek(e);
                hoverRatio = seekPos;
            }
            if (isVolumeChanging) handleVolumeChange(e);
        };
        const handleGlobalMouseUp = (e: MouseEvent) => {
            if (isDraggingSeek) handleSeekEnd(e);
            if (isVolumeChanging) handleVolumeEnd(e);
        };
        const handleDocumentMouseDown = (e: MouseEvent) => {
            if (
                showSleepTimerMenu &&
                sleepTimerElement &&
                !sleepTimerElement.contains(e.target as Node)
            ) {
                showSleepTimerMenu = false;
            }
            if (
                showDevicePicker &&
                devicePickerRef &&
                !devicePickerRef.contains(e.target as Node)
            ) {
                showDevicePicker = false;
            }
            if (
                showOverflowMenu &&
                overflowMenuRef &&
                !overflowMenuRef.contains(e.target as Node)
            ) {
                showOverflowMenu = false;
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
            if (volumeWheelTimeout) clearTimeout(volumeWheelTimeout);

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
    <div class="track-info desktop-track-info player-left">
            {#if $currentTrack}
                <button
                    type="button"
                    class="album-art"
                    class:clickable={canNavigateToAlbum}
                    on:click={handleAlbumClick}
                    disabled={!canNavigateToAlbum}
                    title={canNavigateToAlbum
                        ? ($currentTrack.album
                            ? `${$_('contextMenu.goToAlbum')}: ${$currentTrack.album}`
                            : $_('contextMenu.goToAlbum'))
                        : undefined}
                    aria-label={canNavigateToAlbum
                        ? ($currentTrack.album
                            ? `${$_('contextMenu.goToAlbum')}: ${$currentTrack.album}`
                            : $_('contextMenu.goToAlbum'))
                        : "Album art"}
                    style="view-transition-name: {($isFullScreen || getIsLinux()) ? 'none' : 'player-album-art'};"
                >
                    {#key $currentTrack.id}
                        <div class="album-art-inner" in:fly={{ y: 6, duration: 220, easing: cubicOut }}>
                            {#if albumArt && !imageLoadFailed}
                                <img
                                    src={albumArt}
                                    alt={$currentTrack.album || "Album art"}
                                    decoding="async"
                                    on:error={() => (imageLoadFailed = true)}
                                />
                            {:else}
                                <div class="album-art-placeholder">
                                    <Icon name="music" size={24} />
                                </div>
                            {/if}
                        </div>
                    {/key}
                </button>
                {#key $currentTrack.id}
                    <div class="track-details" in:fly={{ y: 8, duration: 220, easing: cubicOut }}>
                        <div class="track-title-row">
                            <span class="track-title truncate"
                                >{$currentTrack.title || $_('player.unknownTitle')}</span
                            >
                            <AudioQualityBadge variant="compact" />
                        </div>
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
                {/key}

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
        <div class="playback-controls player-center">
            <div class="controls-buttons">
                <button
                    class="icon-btn btn-shuffle"
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
                    class="icon-btn btn-repeat"
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
                    <span class="time">{formatDuration(displayCurrentTime)}</span>
                    <div
                        class="progress-bar"
                        class:seeking={isSeeking}
                        bind:this={seekBarElement}
                        on:pointerdown={handleSeekStart}
                        on:pointermove={(e) => { if (isDraggingSeek) { handleSeek(e); hoverRatio = seekPos; } }}
                        on:pointerup={handleSeekEnd}
                        on:pointercancel={handleSeekEnd}
                        on:mousedown={handleSeekStart}
                        on:mousemove={handleScrubberMouseMove}
                        on:mouseleave={handleScrubberMouseLeave}
                        role="slider"
                        aria-label="Seek"
                        aria-valuenow={Math.round(displayProgress * 100)}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        tabindex="0"
                    >
                        {#if showScrubberTooltip}
                            <div
                                class="scrubber-tooltip"
                                style="left: clamp(36px, {displayHoverRatio * 100}%, calc(100% - 36px));"
                            >
                                {formatDuration(hoverTime)}
                            </div>
                        {/if}
                        <div class="progress-track">
                            <div
                                class="progress-fill"
                                style="width: {displayProgress * 100}%"
                            ></div>
                            {#if $duration > 15 && $appSettings?.crossfadeSeconds > 0}
                                {@const automixPct = Math.min(30, ($appSettings.crossfadeSeconds / $duration) * 100)}
                                <div
                                    class="automix-cue-zone"
                                    style="width: {automixPct}%;"
                                    title="Automix Handoff Zone ({$appSettings.crossfadeSeconds}s)"
                                ></div>
                            {/if}
                        </div>
                        <div
                            class="progress-thumb"
                            style="left: {displayProgress * 100}%"
                        ></div>
                    </div>
                    <span class="time">{formatDuration($duration)}</span>
                {/if}
            </div>

            <!-- Audio visualizer — shown when visualization mode is active -->
            {#if $theme.animation.playerVisualization !== 'none' && !$theme.animation.reducedMotion}
                <div class="visualizer-container">
                    <AudioVisualizer width={200} height={20} />
                </div>
            {/if}
        </div>

        <!-- Volume controls -->
        <div class="volume-controls player-right">
            <!-- Plugin slot: Right -->
            <div class="plugin-slot" bind:this={slotEnd}></div>

            <div class="utility-controls utility-controls-desktop">
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
                                            $sleepTimerMode === 'duration' &&
                                            $sleepTimerLastDurationMinutes ===
                                            minutes
                                        }
                                        on:click={() => setSleepTimer(minutes)}
                                    >
                                        {minutes}m
                                    </button>
                                {/each}
                            </div>

                            <button
                                class="sleep-preset-btn sleep-end-track-btn"
                                class:active={$sleepTimerMode === 'end_of_track'}
                                on:click={setEndOfTrackTimer}
                            >
                                <Icon name="music" size={13} />
                                <span>{$_('player.endOfTrack')}</span>
                            </button>

                            <button
                                type="button"
                                class="sleep-fade-toggle-row"
                                class:active={$sleepTimerFadeEnabled}
                                on:click={() => toggleSleepTimerFade()}
                            >
                                <Icon name="volume-2" size={13} />
                                <span class="sleep-fade-label">{$_('player.sleepTimerFade')}</span>
                                <span class="sleep-fade-pill">{$sleepTimerFadeEnabled ? 'ON' : 'OFF'}</span>
                            </button>

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
                    class:active={$isInspectorOpen && $activeInspectorTab === 'queue'}
                    on:click={() => toggleInspectorTab('queue')}
                    title={$_('player.queueShortcut')}
                >
                    <Icon name="queue" size={18} />
                </button>
                <button
                    class="icon-btn"
                    class:active={$isInspectorOpen && $activeInspectorTab === 'lyrics'}
                    on:click={() => toggleInspectorTab('lyrics')}
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
                    on:click={toggleMute}
                    title={$volume > 0 ? $_('player.mute') : $_('player.unmute')}
                >
                    <Icon name={$volume === 0 ? "volume-x" : $volume < 0.5 ? "volume-1" : "volume-2"} size={20} />
                </button>
                <div
                    class="volume-bar"
                    bind:this={volumeBarElement}
                    on:pointerdown={handleVolumeStart}
                    on:pointermove={(e) => { if (isVolumeChanging) handleVolumeChange(e); }}
                    on:pointerup={handleVolumeEnd}
                    on:pointercancel={handleVolumeEnd}
                    on:mousedown={handleVolumeStart}
                    on:mouseenter={() => (isVolumeHovered = true)}
                    on:mouseleave={() => (isVolumeHovered = false)}
                    on:keydown={handleVolumeKey}
                    on:wheel|nonpassive={handleVolumeScroll}
                    role="slider"
                    aria-label="Volume"
                    aria-valuenow={Math.round($volume * 100)}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    tabindex="0"
                >
                    {#if showVolumeTooltip}
                        <div
                            class="volume-tooltip"
                            style="left: clamp(14px, {$volume * 100}%, calc(100% - 14px));"
                        >
                            {Math.round($volume * 100)}%
                        </div>
                    {/if}
                    <div class="volume-track">
                        <div
                            class="volume-fill"
                            style="width: {$volume * 100}%"
                        ></div>
                    </div>
                    <div class="volume-thumb" style="left: {$volume * 100}%"></div>
                </div>
            </div>

            <!-- Audio Output Device Selector Pill -->
            <div class="device-picker-wrapper desktop-device-picker" bind:this={devicePickerRef}>
                <button
                    class="icon-btn device-picker-btn"
                    class:active={showDevicePicker || !!$appSettings.outputDevice}
                    on:click={toggleDevicePicker}
                    title="Audio Output Device"
                    aria-label="Audio Output Device"
                >
                    <Icon name="headphones" size={18} />
                </button>

                {#if showDevicePicker}
                    <div class="device-picker-menu" on:click|stopPropagation>
                        <div class="device-menu-header">Output Device</div>
                        <button
                            class="device-option"
                            class:active={!$appSettings.outputDevice}
                            on:click={() => selectDevice(null)}
                        >
                            <span class="device-option-name">System Default</span>
                            {#if !$appSettings.outputDevice}
                                <Icon name="check" size={14} />
                            {/if}
                        </button>
                        <div class="device-divider"></div>
                        {#each audioDevices as dev}
                            <button
                                class="device-option"
                                class:active={$appSettings.outputDevice === dev.id}
                                on:click={() => selectDevice(dev.id)}
                            >
                                <div class="device-option-text">
                                    <span class="device-option-name truncate" title={dev.name}>{dev.name}</span>
                                    {#if dev.is_default}
                                        <span class="device-badge">Default</span>
                                    {/if}
                                </div>
                                {#if $appSettings.outputDevice === dev.id}
                                    <Icon name="check" size={14} />
                                {/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="view-controls desktop-view-controls">
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

            <!-- Overflow "⋯" menu when playerbar is compressed -->
            <div class="overflow-more-wrapper" bind:this={overflowMenuRef}>
                <button
                    class="icon-btn overflow-more-btn"
                    class:active={showOverflowMenu}
                    on:click={toggleOverflowMenu}
                    title="More actions"
                    aria-label="More actions"
                >
                    <Icon name="more-horizontal" size={18} />
                </button>

                {#if showOverflowMenu}
                    <div class="overflow-menu-popover" on:click|stopPropagation>
                        <div class="overflow-menu-header">Quick Actions</div>

                        <button
                            class="overflow-menu-item"
                            class:active={$shuffle}
                            on:click={() => { toggleShuffle(); }}
                        >
                            <Icon name="shuffle" size={16} />
                            <span>{$_('player.shuffle')}</span>
                            {#if $shuffle}
                                <span class="overflow-badge">ON</span>
                            {/if}
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$repeat !== "none"}
                            on:click={() => { cycleRepeat(); }}
                        >
                            <Icon name={$repeat === "one" ? "repeat-1" : "repeat"} size={16} />
                            <span>{$_('player.repeatMode', { values: { mode: $repeat === 'one' ? $_('player.repeatOne') : $repeat === 'all' ? $_('player.repeatAll') : $_('player.repeatOff') } })}</span>
                            {#if $repeat !== "none"}
                                <span class="overflow-badge">{$repeat === 'one' ? '1' : 'ALL'}</span>
                            {/if}
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$isInspectorOpen && $activeInspectorTab === 'queue'}
                            on:click={() => { toggleInspectorTab('queue'); showOverflowMenu = false; }}
                        >
                            <Icon name="queue" size={16} />
                            <span>{$_('player.queueShortcut')}</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$isInspectorOpen && $activeInspectorTab === 'lyrics'}
                            on:click={() => { toggleInspectorTab('lyrics'); showOverflowMenu = false; }}
                        >
                            <Icon name="lyrics" size={16} />
                            <span>{$_('player.lyricsShortcut')}</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={connectedDevices > 0}
                            on:click={() => { showConnectPanel = !showConnectPanel; showOverflowMenu = false; }}
                        >
                            <Icon name="cast" size={16} />
                            <span>{$_('connect.title')}</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$sleepTimerActive}
                            on:click={() => { toggleSleepTimerMenu(); showOverflowMenu = false; }}
                        >
                            <Icon name="moon" size={16} />
                            <span>{$_('player.sleepTimer')}</span>
                            {#if $sleepTimerActive}
                                <span class="overflow-badge">{formatSleepTimerRemaining($sleepTimerRemainingMs)}</span>
                            {/if}
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$pluginDrawerOpen}
                            on:click={() => { pluginDrawerOpen.set(true); showOverflowMenu = false; }}
                        >
                            <Icon name="plugin" size={16} />
                            <span>{$_('player.pluginActions')}</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={showDevicePicker || !!$appSettings.outputDevice}
                            on:click={(e) => { toggleDevicePicker(e); showOverflowMenu = false; }}
                        >
                            <Icon name="headphones" size={16} />
                            <span>Audio Device</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            on:click={() => { toggleMiniPlayer(); showOverflowMenu = false; }}
                        >
                            <Icon name="monitor" size={16} />
                            <span>{$_('player.miniPlayer')}</span>
                        </button>

                        <button
                            class="overflow-menu-item"
                            class:active={$isFullScreen}
                            on:click={() => { toggleFullScreen(); showOverflowMenu = false; }}
                        >
                            <Icon name={$isFullScreen ? "minimize" : "fullscreen"} size={16} />
                            <span>{$_('player.fullscreen')}</span>
                        </button>

                        <div class="overflow-divider"></div>

                        <!-- Mini volume control inside overflow menu -->
                        <div class="overflow-volume-row">
                            <button
                                class="icon-btn mini"
                                on:click={toggleMute}
                                title={$volume > 0 ? $_('player.mute') : $_('player.unmute')}
                            >
                                <Icon name={$volume === 0 ? "volume-x" : $volume < 0.5 ? "volume-1" : "volume-2"} size={16} />
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={$volume}
                                on:input={(e) => setVolume(parseFloat(e.currentTarget.value))}
                                class="overflow-volume-slider"
                            />
                            <span class="overflow-volume-pct">{Math.round($volume * 100)}%</span>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
</footer>
{/if}

{#if showConnectPanel}
    <ConnectPanel on:close={() => showConnectPanel = false} />
{/if}

<style>
    .player-bar {
        position: relative;
        z-index: 100;
        height: var(--player-height);
        background-color: var(--player-bg, var(--bg-elevated));
        background: color-mix(in srgb, var(--player-bg, var(--bg-elevated)) 85%, transparent);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        transition: background-color var(--transition-slow, 400ms ease), color var(--transition-slow, 400ms ease);
        border-top: 1px solid var(--border-color);
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.25);
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.7fr) minmax(0, 1.15fr);
        align-items: center;
        padding: 0 calc(var(--spacing-md) + 2px);
        gap: 16px;
        container-type: inline-size;
        color: var(--text-on-player, var(--text-primary));
        /* overflow: hidden; - Removed to allow menus to popup */
    }

    .player-left {
        min-width: 0;
        display: flex;
        gap: 10px;
        align-items: center;
    }

    .player-left .track-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .player-center {
        min-width: 0;
        position: relative;
        z-index: 2;
    }

    .player-right {
        min-width: 0;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;
    }

    .player-right button {
        flex-shrink: 0;
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
        padding: 0;
        border: none;
        display: block;
        transition: transform var(--transition-fast), filter var(--transition-fast);
        cursor: default;
    }

    .album-art.clickable {
        cursor: pointer;
    }

    .album-art.clickable:hover {
        transform: scale(1.05);
        filter: brightness(1.06);
    }

    .album-art.clickable:active {
        transform: scale(0.97);
    }

    .album-art:focus-visible {
        outline: 2px solid var(--accent, #1db954);
        outline-offset: 2px;
    }

    button.album-art:disabled {
        opacity: 1;
        cursor: default;
    }

    .album-art-inner {
        width: 100%;
        height: 100%;
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

    .track-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
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

    /* rendered inside ArtistLinks => scoped selector never matches */
    .track-details :global(.track-artist) {
        font-size: var(--font-size-xs);
        color: var(--text-on-player, var(--text-secondary));
    }

    .track-details :global(.track-artist:hover) {
        color: var(--text-on-player, var(--text-primary));
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
        color: var(--text-on-player, var(--text-subdued));
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
        color: var(--text-on-player, var(--text-primary));
        transform: scale(1.15);
    }

    .player-bar .icon-btn.active,
    .player-bar .icon-btn.active:hover {
        color: var(--player-accent, var(--accent-primary, #1db954));
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
        background: var(--accent-primary, #1db954);
        border-radius: 50%;
        box-shadow: 0 0 5px var(--accent-primary, #1db954);
    }

    .like-btn.liked {
        color: var(--accent-primary, #1db954);
        animation: heartPop 0.32s var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    .like-btn.liked:hover {
        transform: scale(1.15);
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

    .visualizer-container {
        width: 200px;
        height: 20px;
        opacity: 0.7;
        pointer-events: none;
    }

    .controls-buttons {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    /* global icon-btn color is not player aware => follow player text */
    .player-bar .icon-btn:not(.active),
    .player-bar .icon-btn:not(.active):hover {
        color: var(--text-on-player, var(--text-secondary));
    }

    .player-bar .icon-btn,
    .player-bar .like-btn {
        background-color: var(--player-btn-bg, transparent);
    }

    .player-bar .icon-btn:hover,
    .player-bar .like-btn:hover {
        background-color: var(--player-btn-bg-hover, rgba(255, 255, 255, 0.1));
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
        background-color: var(--accent-primary);
        color: var(--text-on-accent, #fff);
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
        color: var(--text-on-player, var(--text-subdued));
        opacity: 0.75;
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
        position: relative;
    }

    .automix-cue-zone {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        background: linear-gradient(to right, transparent, rgba(29, 185, 84, 0.4));
        pointer-events: none;
        border-radius: 0 var(--radius-full) var(--radius-full) 0;
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
        background-color: var(--text-on-player, var(--text-secondary));
        border-radius: var(--radius-full);
        transition: background-color var(--transition-fast);
    }

    .progress-bar:not(.seeking) .progress-fill {
        transition: background-color var(--transition-fast), width 100ms linear;
    }

    .progress-bar.seeking .progress-fill,
    .progress-bar.seeking .progress-thumb {
        transition: none !important;
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

    /* Floating glass pill tooltips */
    .scrubber-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        transform: translateX(-50%);
        padding: 3px 8px;
        background: color-mix(in srgb, var(--bg-elevated, #18181b) 80%, transparent);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
        border-radius: 9999px;
        color: var(--text-primary, #ffffff);
        font-size: 0.7rem;
        font-weight: var(--font-weight-medium, 500);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        z-index: 50;
        animation: pill-pop 150ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .volume-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        transform: translateX(-50%);
        padding: 2px 7px;
        background: color-mix(in srgb, var(--bg-elevated, #18181b) 80%, transparent);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
        border-radius: 9999px;
        color: var(--text-primary, #ffffff);
        font-size: 0.68rem;
        font-weight: var(--font-weight-semibold, 600);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        z-index: 50;
        animation: pill-pop 150ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes pill-pop {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(4px) scale(0.92);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .scrubber-tooltip,
        .volume-tooltip {
            animation: none;
        }
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
    .backend-badge.native,
    .backend-badge.html5 {
        color: var(--text-on-player, var(--text-subdued));
        background: none;
        border: 1px solid currentColor;
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
        transform-origin: bottom right;
        animation: popoverUpIn 0.2s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
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
        color: var(--accent-primary, #1db954);
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
        border-color: var(--accent-primary, #1db954);
        color: var(--text-primary);
    }

    .sleep-preset-btn.active {
        border-color: var(--accent-primary, #1db954);
        color: var(--accent-primary, #1db954);
    }

    .sleep-end-track-btn {
        width: 100%;
        margin-top: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }

    .sleep-fade-toggle-row {
        width: 100%;
        margin-top: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: none;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        color: var(--text-subdued);
        font-size: 0.7rem;
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .sleep-fade-toggle-row:hover {
        background: var(--bg-surface);
        color: var(--text-primary);
    }

    .sleep-fade-toggle-row.active {
        color: var(--text-secondary);
    }

    .sleep-fade-label {
        flex: 1;
        text-align: left;
    }

    .sleep-fade-pill {
        font-size: 0.62rem;
        font-weight: var(--font-weight-bold);
        padding: 1px 4px;
        border-radius: 4px;
        background: var(--bg-surface);
        color: var(--text-subdued);
    }

    .sleep-fade-toggle-row.active .sleep-fade-pill {
        background: var(--accent-subtle, rgba(29, 185, 84, 0.15));
        color: var(--accent-primary, #1db954);
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

    /* Output Device Picker */
    .device-picker-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .device-picker-menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + 10px);
        width: 240px;
        max-height: 280px;
        overflow-y: auto;
        padding: 8px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-lg);
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 4px;
        transform-origin: bottom right;
        animation: popoverUpIn 0.2s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .device-menu-header {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-subdued);
        padding: 4px 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .device-divider {
        height: 1px;
        background: var(--border-color);
        margin: 4px 0;
    }

    .device-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background: transparent;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
        text-align: left;
        width: 100%;
        gap: 8px;
    }

    .device-option:hover {
        background: var(--bg-surface);
        color: var(--text-primary);
    }

    .device-option.active {
        background: var(--bg-surface);
        color: var(--accent-primary, #1ed760);
        font-weight: var(--font-weight-medium);
    }

    .device-option-text {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
    }

    .device-option-name {
        flex: 1;
    }

    .device-badge {
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 4px;
        background: var(--bg-card);
        color: var(--text-subdued);
        border: 1px solid var(--border-color);
    }

    .plugin-slot {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    /* Overflow "⋯" menu when compressed */
    .overflow-more-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        max-width: 0;
        opacity: 0;
        transform: scale(0.85);
        pointer-events: none;
        overflow: hidden;
        transition:
            max-width 0.24s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)),
            opacity 0.18s ease,
            transform 0.22s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .overflow-menu-popover {
        position: absolute;
        right: 0;
        bottom: calc(100% + 10px);
        width: 220px;
        padding: 8px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-lg);
        z-index: 70;
        display: flex;
        flex-direction: column;
        gap: 4px;
        transform-origin: bottom right;
        animation: popoverUpIn 0.2s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .overflow-menu-header {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-subdued);
        padding: 4px 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .overflow-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: transparent;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
        text-align: left;
        width: 100%;
    }

    .overflow-menu-item:hover {
        background: var(--bg-surface);
        color: var(--text-primary);
    }

    .overflow-menu-item.active {
        background: var(--bg-surface);
        color: var(--accent-primary, #1ed760);
        font-weight: var(--font-weight-medium);
    }

    .overflow-badge {
        margin-left: auto;
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--accent-subtle, rgba(29, 185, 84, 0.15));
        color: var(--accent-primary, #1ed760);
    }

    .overflow-divider {
        height: 1px;
        background: var(--border-color);
        margin: 4px 0;
    }

    .overflow-volume-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
    }

    .overflow-volume-slider {
        flex: 1;
        height: 4px;
        accent-color: var(--accent-primary);
        cursor: pointer;
    }

    .overflow-volume-pct {
        font-size: 11px;
        color: var(--text-subdued);
        min-width: 28px;
        text-align: right;
    }

    .desktop-view-controls,
    .volume-bar,
    .utility-controls-desktop,
    .desktop-device-picker,
    .controls-buttons .btn-shuffle,
    .controls-buttons .btn-repeat,
    .player-left .track-details,
    .player-left .like-btn {
        transition:
            max-width 0.24s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)),
            opacity 0.18s ease,
            transform 0.22s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)),
            margin 0.22s ease,
            padding 0.22s ease;
        max-width: 480px;
    }

    @container (max-width: 1524px) {
        .desktop-view-controls {
            max-width: 0 !important;
            opacity: 0 !important;
            transform: scale(0.85) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
        .overflow-more-wrapper {
            max-width: 48px !important;
            opacity: 1 !important;
            transform: scale(1) !important;
            pointer-events: auto !important;
            overflow: visible !important;
        }
    }

    @container (max-width: 1400px) {
        .utility-controls-desktop,
        .desktop-device-picker {
            max-width: 0 !important;
            opacity: 0 !important;
            transform: scale(0.85) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
    }

    @container (max-width: 860px) {
        .volume-bar {
            max-width: 0 !important;
            min-width: 0 !important;
            opacity: 0 !important;
            transform: scale(0.85) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
    }

    @container (max-width: 750px) {
        .player-bar :global(.audio-quality-badge),
        .progress-container .time {
            display: none !important;
        }
        .controls-buttons .btn-shuffle,
        .controls-buttons .btn-repeat {
            max-width: 0 !important;
            opacity: 0 !important;
            transform: scale(0.85) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
    }

    @container (max-width: 550px) {
        .player-left .track-details,
        .player-left .like-btn {
            max-width: 0 !important;
            opacity: 0 !important;
            transform: scale(0.85) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
    }
</style>
