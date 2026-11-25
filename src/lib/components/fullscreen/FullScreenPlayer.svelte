<script lang="ts">
  import { get } from "svelte/store";
  import { _ } from "svelte-i18n";
  import { fade, fly } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import {
    isFullScreen,
    toggleFullScreen,
    isQueueVisible,
    toggleQueue,
    contextMenu,
    nativeTransitionActive,
    isStatsForNerdsOpen,
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
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    volume,
    playbackContext,
  } from "$lib/stores/player";
  import { isMobile, registerBackHandler } from "$lib/stores/mobile";
  import { lyricsVisible, toggleLyrics } from "$lib/stores/lyrics";
  import { goToArtistDetail, goToAlbumDetail, goToSettings } from "$lib/stores/view";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import MarqueeText from "$lib/components/MarqueeText.svelte";
  import {
    lyricsData,
    activeLine,
    wordSyncState,
    getLineSyncState,
    type LineSyncState,
  } from "$lib/stores/lyrics";
  import { formatDuration, getIsLinux } from "$lib/api/tauri";
  import { resolveTrackCover } from "$lib/stores/library";
  import { customArtworks } from "$lib/stores/customArtwork";
  import { onMount, onDestroy, tick } from "svelte";
  import { gestureGuard, isGestureGuarded } from "$lib/utils/gestureGuard";
  import { isBackgroundFrozen } from "$lib/stores/offstage";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { buildTrackContextMenu } from "$lib/menus/contextMenus";
  import { addToast } from "$lib/stores/toast";
  import QueuePanel from "../QueuePanel.svelte";
  import ConnectPanel from "../ConnectPanel.svelte";
  import MetadataModal from "../MetadataModal.svelte";
  import { wsStore } from "$lib/stores/websocket";
  import MeshGradientBg from "../MeshGradientBg.svelte";
  import MeshBackgroundSettings from "./MeshBackgroundSettings.svelte";
  import FullScreenMobileBottomSheet from "./FullScreenMobileBottomSheet.svelte";
  import FullScreenPlaybackControls from "./FullScreenPlaybackControls.svelte";
  import LyricsView from "../LyricsView.svelte";
  import LyricCardModal from "../LyricCardModal.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import AudioQualityBadge from "$lib/components/AudioQualityBadge.svelte";

  let showMeshSettings = false;
  let showLyricCardModal = false;
  let showMetadataModal = false;

  let showConnectPanel = false;
  let showMobileMenu = false;
  $: connectedDevices = $wsStore.devices.length;
  $: isCurrentLiked = $currentTrack ? $likedTrackIds.has($currentTrack.id) : false;
  $: sourceTitle =
    $playbackContext?.displayName ||
    $currentTrack?.album ||
    $_('player.nowPlaying');

  let albumArt: string | null = null;
  let isSeeking = false;
  let isAndroid = false;
  let isLinux = false;

  // mobile lyrics live inside this view; leaving it must not leave the
  // desktop-style side panel open behind the main layout
  let prevFullScreen = $isFullScreen;
  $: {
    if (prevFullScreen && !$isFullScreen && $isMobile) lyricsVisible.set(false);
    prevFullScreen = $isFullScreen;
  }
  let desktopArtWrapperEl: HTMLDivElement | null = null;
  $: if (desktopArtWrapperEl) {
    desktopArtWrapperEl.style.viewTransitionName = ($isFullScreen && !isLinux) ? 'player-album-art' : 'none';
  }

  /*
   * pinning a fixed dark palette here (via the same 'style' prop used for sizing)
   * guarantees contrast regardless of app theme
   * since fullscreen's background is always black
   */
  const lyricsDarkPalette =
    "--text-primary: #ffffff; " +
    "--text-secondary: rgba(255, 255, 255, 0.7); " +
    "--text-subdued: rgba(255, 255, 255, 0.4); " +
    "--lyrics-inactive: rgba(255, 255, 255, 0.22); " +
    "--lyrics-near: rgba(255, 255, 255, 0.55); " +
    "--lyrics-mid: rgba(255, 255, 255, 0.35); " +
    "--lyrics-far: rgba(255, 255, 255, 0.15); " +
    "--lyrics-past-near: rgba(255, 255, 255, 0.45); " +
    "--lyrics-past-mid: rgba(255, 255, 255, 0.3); " +
    "--lyrics-past-far: rgba(255, 255, 255, 0.15);";
  function getWordPercentage(
    lineIdx: number,
    wordIdx: number,
    currentActiveLine: number,
    ws: LineSyncState,
  ): number {
    if (lineIdx < currentActiveLine) return 100;
    if (lineIdx > currentActiveLine) return 0;
    if (wordIdx < ws.activeWordIdx) return 100;
    if (wordIdx === ws.activeWordIdx) return ws.wordProgress;
    return 0;
  }

  // Load album art (shared resolver
  // re-runs when custom artwork changes)
  $: if ($currentTrack) {
    void $customArtworks;
    albumArt = resolveTrackCover($currentTrack);
  } else {
    albumArt = null;
  }

  // --- Unified pointer-based seeking ---
  function handleSeekPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // primary button only
    isSeeking = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleSeekPointerMove(e);
  }

  function handleSeekPointerMove(e: PointerEvent) {
    if (!isSeeking) return;
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, pos)));
  }

  function handleSeekPointerUp(e: PointerEvent) {
    if (isSeeking) {
      isSeeking = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  }

  // --- Tab Management ---
  let activeTab: "lyrics" | "queue" = "lyrics";

  // --- Volume Management (mirrors the desktop playerbar's volume-bar) ---
  let isVolumeSeeking = false;

  function handleVolumePointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // primary button only
    isVolumeSeeking = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleVolumePointerMove(e);
  }

  function handleVolumePointerMove(e: PointerEvent) {
    if (!isVolumeSeeking) return;
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    volume.set(Math.max(0, Math.min(1, pos)));
  }

  function handleVolumePointerUp(e: PointerEvent) {
    if (isVolumeSeeking) {
      isVolumeSeeking = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  }

  const SEEK_STEP = 0.05;
  const VOLUME_STEP = 0.05;

  function handleSeekKeydown(e: KeyboardEvent) {
    const current = get(progress);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      seek(Math.min(1, current + SEEK_STEP));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      seek(Math.max(0, current - SEEK_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seek(1);
    }
  }

  function handleVolumeKeydown(e: KeyboardEvent) {
    const current = get(volume);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      volume.set(Math.min(1, current + VOLUME_STEP));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      volume.set(Math.max(0, current - VOLUME_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      volume.set(0);
    } else if (e.key === "End") {
      e.preventDefault();
      volume.set(1);
    }
  }

  // --- Context Menu Management ---
  function showTrackMenu(
    e: MouseEvent | PointerEvent,
    onlyAddToPlaylist = false,
  ) {
    const track = $currentTrack;
    if (!track) return;

    e.preventDefault();
    e.stopPropagation();

    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: buildTrackContextMenu({
        track,
        trackIndex: 0,
        sortedTracks: [],
        isUnavailable: false,
        variant: onlyAddToPlaylist ? 'playlist-only' : 'player',
        onAfterDelete: toggleFullScreen,
        t: $_,
      }),
    });
  }

  function handleMobileLyricsToggle() {
    const openingLyrics = !$lyricsVisible;

    if (openingLyrics && $isQueueVisible) {
      toggleQueue();

      if (isAndroid) {
        requestAnimationFrame(() => {
          toggleLyrics();
        });
        return;
      }
    }

    toggleLyrics();
  }

  function handleMobileQueueToggle() {
    const openingQueue = !$isQueueVisible;

    if (openingQueue && $lyricsVisible) {
      lyricsVisible.set(false);

      if (isAndroid) {
        requestAnimationFrame(() => {
          toggleQueue();
        });
        return;
      }
    }

    toggleQueue();
  }

  function openEqualizerSettings() {
    try {
      localStorage.setItem("audion_settings_open_tab", "sound");
    } catch {}
    toggleFullScreen();
    goToSettings();
  }

  let unregisterConnectBack: (() => void) | null = null;
  $: if (showConnectPanel && !unregisterConnectBack) {
    unregisterConnectBack = registerBackHandler(() => {
      showConnectPanel = false;
      return true;
    });
  } else if (!showConnectPanel && unregisterConnectBack) {
    unregisterConnectBack();
    unregisterConnectBack = null;
  }

  onMount(() => {
    isLinux = getIsLinux();
    isAndroid =
      typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

    // No global listeners needed; pointer events are attached to the element.
    return () => {};
  });

  // --- Interactive Drag-to-Dismiss with Velocity Tracking & Spring Physics ---
  let sheetTranslateY = 0;
  let isDismissDragging = false;
  let isDismissAnimating = false;
  let dismissTouchStartY = 0;
  let dismissTouchStartX = 0;
  let touchHistory: Array<{ y: number; time: number }> = [];
  let springRafId: number | null = null;

  function cancelSpringAnimation() {
    if (springRafId !== null) {
      cancelAnimationFrame(springRafId);
      springRafId = null;
    }
    isDismissAnimating = false;
  }

  function handleMobileTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || isDismissAnimating) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="slider"], .progress-bar, .volume-bar, input, textarea, select')) {
      return;
    }
    cancelSpringAnimation();
    dismissTouchStartY = e.touches[0].clientY;
    dismissTouchStartX = e.touches[0].clientX;
    touchHistory = [{ y: dismissTouchStartY, time: performance.now() }];
    isDismissDragging = true;
  }

  function handleMobileTouchMove(e: TouchEvent) {
    if (!isDismissDragging || e.touches.length !== 1) return;
    if (isGestureGuarded(e)) {
      isDismissDragging = false;
      sheetTranslateY = 0;
      return;
    }
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const dy = currentY - dismissTouchStartY;
    const dx = currentX - dismissTouchStartX;

    // If gesture direction is primarily horizontal or within touch slop, don't hijack
    if (sheetTranslateY === 0 && (Math.abs(dx) > Math.abs(dy) || Math.abs(dy) < 6)) {
      return;
    }

    // Track touch velocity history (keep samples within ~120ms)
    const now = performance.now();
    touchHistory.push({ y: currentY, time: now });
    if (touchHistory.length > 8) touchHistory.shift();

    if (dy > 0) {
      // 1:1 direct downward tracking for responsive modal dismiss
      sheetTranslateY = dy;
    } else {
      // Rubber-banding upward resistance
      sheetTranslateY = dy * 0.22;
    }
  }

  function handleMobileTouchEnd() {
    if (!isDismissDragging) return;
    isDismissDragging = false;

    // Calculate exit velocity in px/ms
    const now = performance.now();
    const recentTouches = touchHistory.filter((t) => now - t.time < 120);
    let velocityY = 0;
    if (recentTouches.length >= 2) {
      const first = recentTouches[0];
      const last = recentTouches[recentTouches.length - 1];
      const dt = last.time - first.time;
      if (dt > 8) {
        velocityY = (last.y - first.y) / dt; // px per ms
      }
    }

    const thresholdDist =
      typeof window !== "undefined"
        ? Math.min(180, window.innerHeight * 0.22)
        : 140;
    const thresholdVel = 0.55; // px/ms (~550px/s flick)

    // Dismiss condition: pulled past threshold distance OR flicked downwards with speed
    if (
      sheetTranslateY > thresholdDist ||
      (velocityY > thresholdVel && sheetTranslateY > 25)
    ) {
      animateDismiss(velocityY);
    } else {
      runSpringSnapBack(sheetTranslateY, velocityY);
    }
  }

  function animateDismiss(initialVelocity: number) {
    cancelSpringAnimation();
    isDismissAnimating = true;
    const targetY =
      typeof window !== "undefined" ? window.innerHeight + 60 : 900;
    let pos = sheetTranslateY;
    let speed = Math.max(900, Math.min(3000, initialVelocity * 1000));
    const gravity = 3400; // px/s^2 acceleration downwards
    let lastTime = performance.now();

    function step(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.032);
      lastTime = now;
      speed += gravity * dt;
      pos += speed * dt;
      sheetTranslateY = pos;

      if (pos >= targetY) {
        sheetTranslateY = 0;
        isDismissAnimating = false;
        springRafId = null;
        toggleFullScreen();
        return;
      }

      springRafId = requestAnimationFrame(step);
    }

    springRafId = requestAnimationFrame(step);
  }

  function runSpringSnapBack(initialPos: number, initialVelocity: number) {
    cancelSpringAnimation();
    isDismissAnimating = true;
    let pos = initialPos;
    let vel = initialVelocity * 1000; // px/s
    const stiffness = 280; // spring constant
    const damping = 26; // damping factor
    const mass = 1;
    let lastTime = performance.now();

    function step(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.032);
      lastTime = now;

      const springForce = -stiffness * pos;
      const dampingForce = -damping * vel;
      const totalForce = springForce + dampingForce;
      const acc = totalForce / mass;

      vel += acc * dt;
      pos += vel * dt;
      sheetTranslateY = pos;

      if (Math.abs(pos) < 0.5 && Math.abs(vel) < 8) {
        sheetTranslateY = 0;
        isDismissAnimating = false;
        springRafId = null;
        return;
      }

      springRafId = requestAnimationFrame(step);
    }

    springRafId = requestAnimationFrame(step);
  }

  onDestroy(() => {
    cancelSpringAnimation();
    if (unregisterConnectBack) {
      unregisterConnectBack();
      unregisterConnectBack = null;
    }
  });

  $: if (!$isFullScreen) {
    if (showMeshSettings) showMeshSettings = false;
    if (showMobileMenu) showMobileMenu = false;
    if (showLyricCardModal) showLyricCardModal = false;
    if (showMetadataModal) showMetadataModal = false;
  }
</script>

{#if $isFullScreen}
  <div
    class="fullscreen-player"
    class:android-lite={isAndroid && $isMobile}
    transition:fade={{ duration: ($nativeTransitionActive || isLinux) ? 0 : (isAndroid ? 180 : 300) }}
  >
    <!-- Animated blurred background -->
    <MeshGradientBg lite={isAndroid && $isMobile} />
    <div class="backdrop-layer"></div>

    {#if !$isMobile}
      {#if !showMeshSettings}
        <button
          class="mesh-settings-toggle"
          class:active={showMeshSettings}
          on:click={() => (showMeshSettings = !showMeshSettings)}
          aria-label="Background settings"
        >
          <Icon name="settings" size={16} />
        </button>
      {/if}
      {#if showMeshSettings}
        <MeshBackgroundSettings onClose={() => (showMeshSettings = false)} />
      {/if}
    {/if}

    {#if $isMobile}
      <!-- Mobile interactive player sheet container with spring-dismiss physics -->
      <div
        class="mobile-player-container"
        class:is-dragging={isDismissDragging || isDismissAnimating}
        style={sheetTranslateY !== 0 ? `transform: translate3d(0, ${sheetTranslateY}px, 0);` : ""}
        on:touchstart={handleMobileTouchStart}
        on:touchmove={handleMobileTouchMove}
        on:touchend={handleMobileTouchEnd}
        on:touchcancel={handleMobileTouchEnd}
      >
        <!-- Mobile header zone with drag pill -->
        <div class="mobile-header-zone">
        <div class="mobile-drag-pill" aria-hidden="true"></div>
        <div class="mobile-header">
          <button
            type="button"
            class="chevron-btn header-back-btn"
            on:click={toggleFullScreen}
            aria-label={$_('common.close')}
          >
            <Icon name="chevron-down" size={26} />
          </button>
          <span class="now-playing-label" title={sourceTitle}>{sourceTitle}</span>
          <div class="mobile-header-btns">
            <button
              type="button"
              class="chevron-btn"
              class:active={$isQueueVisible}
              on:click={handleMobileQueueToggle}
              aria-label={$_('player.queue')}
            >
              <Icon name="queue" size={22} />
            </button>
            <button
              type="button"
              class="chevron-btn"
              on:click={() => (showMobileMenu = !showMobileMenu)}
              aria-label="More options"
            >
              <Icon name="more-vertical" size={22} />
            </button>
          </div>
        </div>
      </div>

      <div class="player-content mobile-view">
        {#if !$lyricsVisible}
          <div
            class="art-container"
            class:playing={$isPlaying}
            in:fly={{
              y: isAndroid ? 8 : 20,
              duration: isAndroid ? 180 : 500,
              delay: isAndroid ? 0 : 100,
            }}
          >
            {#if albumArt}
              {#key albumArt}
                <img
                  src={albumArt}
                  alt="Album Art"
                  decoding="async"
                  class="art-flip"
                  in:fly={{
                    x: 300,
                    duration: 400,
                    easing: cubicInOut,
                  }}
                  out:fly={{
                    x: -300,
                    duration: 300,
                    easing: cubicInOut,
                  }}
                />
              {/key}
            {:else}
              <div class="art-placeholder">
                <Icon name="music" size={64} />
              </div>
            {/if}
          </div>

          <div class="track-info">
            <div class="track-title-row">
              <div class="track-title-meta">
                <h1 class="track-title">
                  {$currentTrack?.title || $_('player.unknownTitle')}
                </h1>
                <div class="quality-badge-wrapper mobile-quality-badge">
                  <AudioQualityBadge variant="compact" />
                </div>
              </div>
              <button
                type="button"
                class="mobile-like-btn"
                class:liked={isCurrentLiked}
                on:click={() => $currentTrack && toggleLike($currentTrack.id)}
                aria-label={isCurrentLiked ? $_('player.removeFromLiked') : $_('player.addToLiked')}
              >
                <Icon name={isCurrentLiked ? "heart-filled" : "heart"} size={22} />
              </button>
            </div>
            <ArtistLinks
              artist={$currentTrack?.artist || $_('common.unknownArtist')}
              artists={$currentTrack?.artists}
              chipClass="track-artist"
              on:select={(e) => {
                toggleFullScreen();
                goToArtistDetail(e.detail);
              }}
            />
            {#if $currentTrack?.album}
              {#if $currentTrack?.album_id}
                <button
                  class="track-album"
                  on:click={() => {
                    if ($currentTrack?.album_id) {
                      toggleFullScreen();
                      goToAlbumDetail($currentTrack.album_id);
                    }
                  }}
                >
                  {$currentTrack.album}
                </button>
              {:else}
                <span class="track-album track-album--static">
                  {$currentTrack.album}
                </span>
              {/if}
            {/if}
          </div>
        {:else}
          <!-- In-place Lyrics for Mobile with nested gesture guard -->
          <div
            class="mobile-lyrics-wrapper"
            use:gestureGuard={{ direction: 'vertical', bubbleAtEdges: true }}
            in:fade={{ duration: isAndroid ? 140 : 300 }}
          >
            {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
              <LyricsView
                transparent
                reducedMotion={isAndroid}
                style={(isAndroid
                  ? "--lyrics-content-padding: 0.75rem 1rem 0.75rem; --lyrics-font-size: 1.2rem; --lyrics-active-font-size: 1.25rem; --lyrics-line-padding: 0.45rem 0; --label-beam-max-width: 180px;"
                  : "--lyrics-content-padding: 1.5rem 1rem 12vh; --lyrics-font-size: 20px; --lyrics-active-font-size: 22px; --lyrics-line-padding: 0.65rem 0; --label-beam-max-width: 195px;")
                  + " " + lyricsDarkPalette}
              />
            {:else}
              <div class="no-lyrics"><p>{$_('lyrics.unavailable')}</p></div>
            {/if}
          </div>
        {/if}

        <div class="player-controls">
          <div class="progress-bar-container">
            <span class="time">{formatDuration($currentTime)}</span>
            <div
              class="progress-bar hairline-scrubber"
              class:active-seeking={isSeeking}
              on:pointerdown={handleSeekPointerDown}
              on:pointermove={handleSeekPointerMove}
              on:pointerup={handleSeekPointerUp}
              on:pointercancel={handleSeekPointerUp}
              on:keydown={handleSeekKeydown}
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
                >
                  <div class="progress-shimmer"></div>
                </div>
              </div>
              <div
                class="progress-thumb"
                style="left: {$progress * 100}%"
              ></div>
            </div>
            <span class="time">{formatDuration($duration)}</span>
          </div>

          <div class="buttons">
            <button
              type="button"
              class="icon-btn shuffle-repeat"
              class:active={$shuffle}
              on:click={toggleShuffle}
              aria-label={$_('player.shuffle')}
            >
              <Icon name="shuffle" size={22} />
            </button>
            <button
              type="button"
              class="icon-btn large"
              on:click={previousTrack}
              aria-label={$_('player.previous')}
            >
              <Icon name="skip-back" size={32} />
            </button>
            <button
              type="button"
              class="play-btn large"
              on:click={togglePlay}
              aria-label={$isPlaying ? $_('common.pause') : $_('common.play')}
            >
              {#if $isPlaying}
                <Icon name="pause" size={36} />
              {:else}
                <Icon name="play" size={36} />
              {/if}
            </button>
            <button
              type="button"
              class="icon-btn large"
              on:click={nextTrack}
              aria-label={$_('player.next')}
            >
              <Icon name="skip-forward" size={32} />
            </button>
            <button
              type="button"
              class="icon-btn shuffle-repeat"
              class:active={$repeat !== "none"}
              on:click={cycleRepeat}
              aria-label="Repeat"
            >
              <Icon name="repeat" size={22} />
              {#if $repeat === "one"}<span class="repeat-one-badge">1</span
                >{/if}
            </button>
          </div>

          {#if !isAndroid}
            <div class="mobile-volume-row">
              <button
                type="button"
                class="volume-mute-btn"
                on:click={() => volume.set($volume > 0 ? 0 : 1)}
                aria-label={$volume > 0 ? "Mute" : "Unmute"}
              >
                {#if $volume === 0}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                    class="volume-icon"
                    ><path
                      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                    /></svg
                  >
                {:else if $volume < 0.5}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                    class="volume-icon"
                    ><path
                      d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"
                    /></svg
                  >
                {:else}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                    class="volume-icon"
                    ><path
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    /></svg
                  >
                {/if}
              </button>
              <div
                class="volume-bar"
                on:pointerdown={handleVolumePointerDown}
                on:pointermove={handleVolumePointerMove}
                on:pointerup={handleVolumePointerUp}
                on:pointercancel={handleVolumePointerUp}
                on:keydown={handleVolumeKeydown}
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
                <div
                  class="volume-thumb"
                  style="left: {$volume * 100}%"
                ></div>
              </div>
            </div>
          {/if}

          <div class="mobile-utility-row">
            <button
              type="button"
              class="mobile-utility-btn"
              class:active={$lyricsVisible}
              on:click={handleMobileLyricsToggle}
              aria-label={$_('player.lyrics')}
              title={$_('player.lyrics')}
            >
              <Icon name="lyrics" size={20} />
            </button>
            <button
              type="button"
              class="mobile-utility-btn"
              on:click={openEqualizerSettings}
              aria-label={$_('settings.equalizer')}
              title={$_('settings.equalizer')}
            >
              <Icon name="sliders" size={20} />
            </button>
            {#if $lyricsData?.lines?.length}
              <button
                type="button"
                class="mobile-utility-btn"
                on:click={() => (showLyricCardModal = true)}
                aria-label="Share Lyric Card"
                title="Share Lyric Card"
              >
                <Icon name="share" size={20} />
              </button>
            {/if}
            <button
              type="button"
              class="mobile-utility-btn connect-btn"
              class:active={connectedDevices > 0}
              on:click={() => (showConnectPanel = true)}
              aria-label={$_('connect.connectToDevice')}
              title={$_('connect.connectToDevice')}
            >
              <Icon name="connect" size={20} />
              {#if connectedDevices > 0}
                <span class="device-dot"></span>
              {/if}
            </button>
          </div>
        </div>

        {#if !$lyricsVisible && $lyricsData?.lines}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="compact-lyrics-mobile"
            role="button"
            tabindex="0"
            aria-label={$_('player.showLyrics')}
            on:click={handleMobileLyricsToggle}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleMobileLyricsToggle();
              }
            }}
            in:fade
          >
            {#each [$activeLine - 1, $activeLine, $activeLine + 1].filter((idx) => idx >= 0 && idx < $lyricsData.lines.length) as lineIdx (lineIdx)}
              {@const line = $lyricsData.lines[lineIdx]}
              {@const isCurrent = lineIdx === $activeLine}
              {@const hasWordSync = line.words && line.words.length > 0}
              <div
                class="compact-line"
                class:current={isCurrent}
                class:dimmed={!isCurrent}
                animate:flip={{ duration: isAndroid ? 150 : 300 }}
                in:fly={{
                  y: isAndroid ? 6 : 20,
                  duration: isAndroid ? 160 : 300,
                }}
                out:fly={{
                  y: isAndroid ? -6 : -20,
                  duration: isAndroid ? 140 : 300,
                }}
              >
                {#if isCurrent && hasWordSync && line.words}
                  {#each line.words as word, wordIdx}
                    {@const wordProgress = getWordPercentage(
                      lineIdx,
                      wordIdx,
                      $activeLine,
                      getLineSyncState($wordSyncState, lineIdx),
                    )}
                    <span
                      class="lyric-word"
                      style="--word-progress: {wordProgress}%;"
                      >{word.word}</span
                    >
                    {#if wordIdx < line.words.length - 1}{" "}{/if}
                  {/each}
                {:else}
                  {line.text}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    {:else}
      <!-- Desktop layout (enhanced 2-column) -->
      <div class="desktop-container">
        <!-- Header action buttons (top right) -->
        <div style="position: absolute; top: 20px; right: 20px; display: flex; gap: 10px; z-index: 10;">
          <button
            class="desktop-close-btn"
            style="position: static;"
            on:click={(e) => { e.stopPropagation(); isStatsForNerdsOpen.update(v => !v); }}
            aria-label="Stats for Nerds"
            title="Stats for Nerds (Ctrl+I)"
          >
            <Icon name="info" size={20} />
          </button>
          <button
            class="desktop-close-btn"
            style="position: static;"
            on:click={toggleFullScreen}
            aria-label="Close FullScreen"
          >
            <Icon name="x" size={24} />
          </button>
        </div>

        <div class="desktop-content">
          <!-- Left Area: Track Info & Playback Controls -->
          <div class="desktop-left">
            <div class="desktop-art-section">
              <div class="desktop-art-wrapper shadow-lg" bind:this={desktopArtWrapperEl}>
                {#if albumArt}
                  <img
                    src={albumArt}
                    alt="Album Art"
                    decoding="async"
                  />
                {:else}
                  <div class="art-placeholder large">
                    <Icon name="music" size={128} />
                  </div>
                {/if}
              </div>
            </div>

            <div class="desktop-track-details">
              <div class="track-info-header">
                <MarqueeText trigger="always" pauseOnHover="reset" resetKey={$currentTrack?.id} containerClass="title-marquee">
                  <h1 class="desktop-title">
                    {$currentTrack?.title || $_('player.unknownTitle')}
                  </h1>
                </MarqueeText>
              </div>

              <ArtistLinks
                artist={$currentTrack?.artist || $_('common.unknownArtist')}
                artists={$currentTrack?.artists}
                chipClass="desktop-subtitle"
                wrapClass="artist-marquee"
                marquee
                marqueeTrigger="always"
                resetKey={$currentTrack?.id}
                on:select={(e) => {
                  toggleFullScreen();
                  goToArtistDetail(e.detail);
                }}
              />

              {#if $currentTrack?.album}
                {#if $currentTrack?.album_id}
                  <button
                    class="desktop-album-context"
                    on:click={() => {
                      $currentTrack?.album_id &&
                        (toggleFullScreen(),
                        goToAlbumDetail($currentTrack.album_id));
                    }}
                  >
                    {$currentTrack.album}
                  </button>
                {:else}
                  <span class="desktop-album-context desktop-album-context--static">
                    {$currentTrack.album}
                  </span>
                {/if}
              {/if}

              <div class="quality-badge-wrapper desktop-quality-badge">
                <AudioQualityBadge variant="full" />
              </div>

              <div class="action-buttons">
                <button
                  class="action-btn"
                  class:active={$currentTrack
                    ? $likedTrackIds.has($currentTrack.id)
                    : false}
                  on:click={() => $currentTrack && toggleLike($currentTrack.id)}
                  aria-label="Like"
                >
                  {#if $currentTrack && $likedTrackIds.has($currentTrack.id)}
                    <Icon name="heart-filled" size={24} />
                  {:else}
                    <Icon name="heart" size={24} />
                  {/if}
                </button>
                <button
                  class="action-btn"
                  on:click={(e) => showTrackMenu(e, true)}
                  aria-label="Add to Playlist"
                >
                  <Icon name="plus" size={24} />
                </button>
                <button
                  class="action-btn"
                  on:click={(e) => showTrackMenu(e)}
                  aria-label="More Options"
                >
                  <Icon name="more-horizontal" size={24} />
                </button>
                <button
                  class="action-btn connect-btn"
                  class:active={connectedDevices > 0}
                  on:click={() => (showConnectPanel = !showConnectPanel)}
                  aria-label="Connect"
                >
                  <Icon name="connect" size={24} />
                  {#if connectedDevices > 0}
                    <div class="device-dot"></div>
                  {/if}
                </button>
              </div>
            </div>

            <FullScreenPlaybackControls />
          </div>

          <!-- Right Area: Tabbed Content (Lyrics/Queue) -->
          <div class="desktop-right">
            <div class="tab-switcher">
              <button
                class="tab-btn"
                class:active={activeTab === "lyrics"}
                on:click={() => (activeTab = "lyrics")}>{$_('player.lyrics')}</button
              >
              <button
                class="tab-btn"
                class:active={activeTab === "queue"}
                on:click={() => (activeTab = "queue")}>{$_('player.queue')}</button
              >
            </div>

            <div class="tab-content-wrapper">
              {#if activeTab === "lyrics"}
                <div class="desktop-lyrics-container" in:fade>
                  {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
                    <LyricsView
                      transparent
                      reducedMotion={isAndroid}
                      style={"--lyrics-content-padding: 2rem 3rem 2rem 0; --lyrics-font-size: clamp(20px, 2.2vh, 32px); --lyrics-active-font-size: clamp(22px, 2.5vh, 36px); --lyrics-line-padding: 0.7rem 0; --label-beam-max-width: 230px; " + lyricsDarkPalette}
                    />
                  {:else}
                    <div class="no-lyrics-desktop">
                      <p>{$_('lyrics.unavailableTrack')}</p>
                    </div>
                  {/if}
                </div>
              {:else if activeTab === "queue"}
                <div class="desktop-queue-container" in:fade>
                  <QueuePanel hideheader={true} forceVisible={true} />
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if $isFullScreen && $isMobile && showMobileMenu}
  <FullScreenMobileBottomSheet
    bind:showMobileMenu
    bind:showConnectPanel
    on:trackInfo={() => {
      showMobileMenu = false;
      showMetadataModal = true;
    }}
    {albumArt}
  />
{/if}

{#if $isFullScreen && showLyricCardModal}
  <LyricCardModal
    bind:open={showLyricCardModal}
    onClose={() => (showLyricCardModal = false)}
  />
{/if}

{#if showMetadataModal && $currentTrack}
  <MetadataModal
    track={$currentTrack}
    onClose={() => (showMetadataModal = false)}
  />
{/if}

{#if showConnectPanel}
  <ConnectPanel on:close={() => (showConnectPanel = false)} />
{/if}

<style>
  .fullscreen-player {
    --fs-text: #ffffff;
    --fs-text-muted: rgba(255, 255, 255, 0.72);
    --fs-text-subdued: rgba(255, 255, 255, 0.45);
    --fs-surface: rgba(255, 255, 255, 0.1);
    --fs-surface-hover: rgba(255, 255, 255, 0.18);

    position: fixed;
    inset: 0;
    z-index: var(--z-fullscreen, 2000);
    background-color: #000000;
    color: var(--fs-text);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .mesh-settings-toggle {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 20, 20, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    z-index: 51;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .mesh-settings-toggle:hover,
  .mesh-settings-toggle.active {
    background: rgba(40, 40, 40, 0.8);
    color: #fff;
  }

  /* Animated blurred background */
  .backdrop-layer {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 20% 50%, rgba(0, 0, 0, 0.15) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, rgba(0, 0, 0, 0.1) 0%, transparent 50%),
      linear-gradient(to bottom, rgba(10, 10, 10, 0.3) 0%, rgba(10, 10, 10, 0.85) 100%);
    z-index: 1;
  }

  /* Shared UI Elements */
  .art-placeholder {
    width: 100%;
    height: 100%;
    background-color: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
  }

  /* Desktop Redesign Styles */
  .desktop-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1.5rem 4rem;
    position: relative;
    z-index: 10;
    height: 100%;
    overflow: hidden;
  }

  .desktop-close-btn {
    position: absolute;
    top: 2rem;
    right: 2rem;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    z-index: 100;
  }

  .desktop-close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }

  .desktop-content {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(360px, 440px) 1fr;
    gap: clamp(2.5rem, 5vw, 5rem);
    align-items: center;
    max-width: 1800px;
    margin: 0 auto;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .desktop-left {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    max-height: 100%;
    gap: clamp(1rem, 2.5vh, 2rem);
    padding-left: 24px;
    padding-top: 0.75rem;
    width: 100%;
  }

  /* Each section in the left panel shares the same max-width for uniformity */
  .desktop-art-section,
  .desktop-track-details,
  .desktop-playback-area {
    width: 100%;
    max-width: 440px;
  }

  .desktop-art-section {
    aspect-ratio: 1;
    position: relative;
    flex-shrink: 0;
    margin-bottom: 26px;
  }

  .desktop-art-wrapper {
    width: 100%;
    height: 100%;
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-surface);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
  }

  .desktop-art-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .desktop-track-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 18px;
  }

  .title-marquee {
    width: 100%;
    flex: none;
  }

  .desktop-album-context {
    margin: 0.15rem 0 0;
    font-size: 0.95rem;
    line-height: var(--line-height-tight);
    color: rgba(255, 255, 255, 0.64);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .desktop-album-context:hover {
    color: #fff;
  }

  .desktop-album-context--static {
    display: block;
    cursor: default;
  }

  .desktop-album-context--static:hover {
    color: rgba(255, 255, 255, 0.64);
  }

  .quality-badge-wrapper {
    display: flex;
    align-items: center;
  }

  .desktop-quality-badge {
    margin-top: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .mobile-quality-badge {
    margin-top: 0;
    flex-shrink: 0;
  }

  .mobile-view .track-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    width: 100%;
  }

  .track-info-header {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
    gap: 0.5rem;
  }

  .desktop-title {
    font-size: 2.5rem;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.02em;
    color: #fff;
    white-space: nowrap;
  }

  .desktop-subtitle {
    font-size: 1.25rem;
    color: rgba(255, 255, 255, 0.6);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.2s;
    text-align: left;
    white-space: nowrap;
    display: block;
    width: max-content;
  }

  .desktop-subtitle:hover {
    color: #fff;
  }

  /* Marquee Styles */
  .title-marquee,
  .artist-marquee {
    flex: 1;
    position: relative;
    mask-image: linear-gradient(
      to right,
      black 0%,
      black 95%,
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      black 0%,
      black 95%,
      transparent 100%
    );
  }

  .artist-marquee {
    margin-top: 0.25rem;
  }

  .action-buttons {
    display: flex;
    gap: 12px;
    flex-shrink: 0;
    margin-top: 18px;
    justify-content: flex-start;
  }

  .action-btn {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .action-btn svg {
    width: 22px;
    height: 22px;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
    transform: translateY(-2px);
  }

  .action-btn.active {
    color: var(--error-color, #ff4d4d);
  }

  @media (max-height: 900px) {
    .desktop-left {
      gap: 0.9rem;
      padding-top: 0.4rem;
    }

    .desktop-art-section {
      max-width: 240px;
    }

    .desktop-title {
      font-size: clamp(2rem, 3.8vh, 2.35rem);
    }

    .desktop-subtitle {
      font-size: 1.1rem;
    }
  }

  /* Right column styles (Tabs & Content) */
  .desktop-right {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 100%;
    min-width: 0;
  }

  .tab-switcher {
    display: flex;
    gap: 2px;
    background: rgba(255, 255, 255, 0.06);
    padding: 3px;
    border-radius: 999px;
    align-self: flex-start;
    margin-bottom: 1.5rem;
    border: none;
  }

  .tab-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    padding: 0.4rem 1.1rem;
    border-radius: 999px;
    font-weight: var(--font-weight-semibold);
    font-size: 0.88rem;
    cursor: pointer;
    position: relative;
    transition: color 0.2s ease, background 0.2s ease;
  }

  .tab-btn:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .tab-btn.active {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  .tab-content-wrapper {
    flex: 1;
    overflow: hidden;
    position: relative;
    border-radius: 24px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  /*
   * lyrics rendering (proximity grading, word/syllable sync, alignment,
   * section labels, scrolling) now lives in LyricsView.svelte
   * this is just a sizing wrapper around it
   */
  .desktop-lyrics-container {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .no-lyrics-desktop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(255, 255, 255, 0.2);
    font-size: 1.25rem;
    gap: 1rem;
  }

  /* Queue Content Styling */
  .desktop-queue-container {
    height: 100%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
  }

  /* Deeply integrated QueuePanel overrides */
  :global(.desktop-queue-container .queue-panel) {
    background: transparent !important;
    border: none !important;
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    position: relative !important;
    inset: auto !important;
    box-shadow: none !important;
    z-index: 1 !important;
    top: 0 !important;
  }

  :global(.desktop-queue-container .queue-content) {
    padding: 1.5rem !important;
  }

  /* Mobile View Fixes */
  .mobile-player-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 10;
    touch-action: pan-y;
  }

  .mobile-player-container.is-dragging {
    will-change: transform;
  }

  .mobile-header-zone {
    width: 100%;
    flex-shrink: 0;
    z-index: 100;
    touch-action: pan-y;
  }

  .mobile-drag-pill {
    width: 36px;
    height: 4px;
    background: var(--fs-surface-hover);
    border-radius: 2px;
    margin: calc(var(--safe-area-top, 0px) + 8px) auto 0;
  }

  .mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: 0.25rem calc(0.75rem + var(--safe-area-right, 0px)) 0.5rem calc(0.75rem + var(--safe-area-left, 0px));
    z-index: 100;
  }

  .chevron-btn {
    background: none;
    border: none;
    color: var(--fs-text);
    cursor: pointer;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    padding: 0;
    flex-shrink: 0;
  }

  .chevron-btn.header-back-btn {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
  }

  .now-playing-label {
    flex: 1;
    text-align: center;
    text-transform: uppercase;
    font-size: 0.72rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    color: var(--fs-text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-content.mobile-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.25rem calc(1.5rem + var(--safe-area-right, 0px)) calc(16px + var(--safe-area-bottom, 0px)) calc(1.5rem + var(--safe-area-left, 0px));
    gap: clamp(0.65rem, 1.8vh, 1.25rem);
    z-index: 10;
    overflow: hidden;
  }

  .mobile-view .art-container {
    width: min(100%, 38vh);
    aspect-ratio: 1;
    border-radius: 18px;
    overflow: hidden;
    margin: 0 auto;
    flex-shrink: 0;
    box-shadow: 0 14px 28px -8px rgba(0, 0, 0, 0.45);
    border: 1px solid var(--fs-surface);
    transform: scale(0.93);
    transition: transform 0.45s var(--ease-spring-gentle, cubic-bezier(0.25, 1, 0.5, 1)),
                box-shadow 0.45s ease;
    will-change: transform, box-shadow;
  }

  .mobile-view .art-container.playing {
    transform: scale(1);
    box-shadow: 0 22px 52px -10px rgba(0, 0, 0, 0.75);
  }

  @media (prefers-reduced-motion: reduce) {
    .mobile-view .art-container,
    .mobile-view .art-container.playing {
      transform: none !important;
      transition: none !important;
    }
  }

  .mobile-view .art-container img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mobile-view .track-info {
    text-align: left;
    flex-shrink: 0;
  }

  .mobile-view .track-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    width: 100%;
  }

  .mobile-view .track-title-meta {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
    flex: 1;
  }

  .mobile-view .track-title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: clamp(1.35rem, 3vh, 1.75rem);
    font-weight: 800;
    margin-bottom: 0.25rem;
    color: var(--fs-text);
  }

  .mobile-like-btn {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fs-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: transform var(--transition-fast), color var(--transition-fast);
  }

  .mobile-like-btn.liked {
    color: var(--accent-primary);
  }

  .mobile-like-btn:active {
    transform: scale(0.9);
  }

  .mobile-view .track-artist {
    font-size: 1.05rem;
    color: var(--fs-text-muted);
    background: none;
    border: none;
    padding: 0;
  }

  .mobile-view .track-album {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--fs-text-subdued);
    background: none;
    border: none;
    padding: 0;
    margin-top: 2px;
    cursor: pointer;
  }

  .mobile-view .track-album--static {
    display: block;
    cursor: default;
  }

  .mobile-view .player-controls {
    width: 100%;
    flex-shrink: 0;
  }

  .mobile-view .progress-bar-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .mobile-view .progress-bar {
    flex: 1;
    height: 44px; /* 44dp touch hit area for effortless scrubbing */
    min-height: 44px;
    background: transparent;
    border-radius: 9999px;
    position: relative;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .mobile-view .progress-track {
    width: 100%;
    height: 4px; /* hairline minimalist rest state */
    background: var(--fs-surface-hover);
    border-radius: 9999px;
    overflow: hidden;
    position: relative;
    transition: height 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .mobile-view .progress-bar.active-seeking .progress-track {
    height: 8px; /* reactive expansion on touch/scrub */
  }

  .mobile-view .progress-fill {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--accent-primary) 0%,
      color-mix(in srgb, var(--accent-primary) 70%, var(--fs-text)) 50%,
      var(--accent-primary) 100%
    );
    background-size: 200% 100%;
    border-radius: 9999px;
    position: relative;
    transition: width 100ms linear;
  }

  .mobile-view .progress-bar.active-seeking .progress-fill {
    transition: none;
  }

  .mobile-view .progress-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.28) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: shimmer-sheen 3.2s infinite linear;
  }

  @keyframes shimmer-sheen {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .mobile-view .progress-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    background: var(--fs-text);
    border-radius: 50%;
    transform: translateX(-50%) scale(1);
    top: 50%;
    margin-top: -7px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5), 0 0 8px var(--accent-primary);
    transition: transform 180ms var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1));
    opacity: 1;
    pointer-events: none;
  }

  .mobile-view .progress-bar.active-seeking .progress-thumb {
    transform: translateX(-50%) scale(1.42);
    box-shadow: 0 0 14px rgba(0, 0, 0, 0.6), 0 0 12px var(--accent-primary);
  }

  .mobile-view .time {
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    color: var(--fs-text-muted);
    min-width: 36px;
    transition: color 160ms ease;
  }

  .mobile-view .progress-bar.active-seeking ~ .time {
    color: var(--fs-text);
  }

  .mobile-view .buttons {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .mobile-view .icon-btn {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    color: var(--fs-text-muted);
  }

  .mobile-view .icon-btn.large {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
    color: var(--fs-text);
  }

  .mobile-view .icon-btn.active {
    color: var(--accent-primary);
  }

  .mobile-view .shuffle-repeat {
    position: relative;
  }

  .mobile-view .repeat-one-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 0.6rem;
    font-weight: 800;
    background: var(--accent-primary);
    color: var(--text-on-accent, #000000);
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .mobile-view .mobile-volume-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    margin-top: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
    padding: 0 var(--spacing-xs);
  }

  .mobile-view .mobile-volume-row .volume-icon {
    color: var(--fs-text-muted);
    flex-shrink: 0;
  }

  .mobile-view .mobile-volume-row .volume-mute-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 6px;
    min-width: 44px;
    min-height: 44px;
    flex-shrink: 0;
    cursor: pointer;
    color: var(--fs-text);
  }

  /* same as the desktop playerbar's
     volume-bar, just a taller touch target and an always-visible thumb
     since mobile has no hover state */
  .mobile-view .mobile-volume-row .volume-bar {
    flex: 1;
    height: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    position: relative;
    cursor: pointer;
    touch-action: none;
  }

  .mobile-view .mobile-volume-row .volume-track {
    width: 100%;
    height: 4px;
    background-color: var(--fs-surface-hover);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .mobile-view .mobile-volume-row .volume-fill {
    height: 100%;
    background-color: var(--accent-primary);
    border-radius: var(--radius-full);
  }

  .mobile-view .mobile-volume-row .volume-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    background-color: var(--fs-text);
    border-radius: var(--radius-full);
    transform: translateX(-50%);
    top: 50%;
    margin-top: -7px;
    box-shadow: var(--shadow-md);
  }

  .mobile-view .play-btn.large {
    width: 64px;
    height: 64px;
    background: var(--fs-text);
    color: #000000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.16s var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1)),
                background-color var(--transition-fast);
  }

  .mobile-view .play-btn.large:active {
    transform: scale(0.90);
  }

  .mobile-utility-row {
    display: flex;
    align-items: center;
    justify-content: space-around;
    margin-top: var(--spacing-sm);
    padding: 0 var(--spacing-sm);
  }

  .mobile-utility-btn {
    position: relative;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fs-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-fast);
  }

  .mobile-utility-btn.active {
    color: var(--accent-primary);
    background: var(--fs-surface);
  }

  .mobile-utility-btn:active {
    transform: scale(0.92);
    background: var(--fs-surface);
  }

  .mobile-utility-btn .device-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-primary);
  }

  .mobile-header-btns {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .chevron-btn.active {
    color: var(--accent-primary);
  }

  .mobile-lyrics-wrapper {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    margin: 0;
  }

  .no-lyrics {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fs-text-subdued);
    text-align: center;
  }

  .compact-lyrics-mobile {
    margin-top: 0;
    text-align: center;
    color: var(--fs-text);
    min-height: 3.6em;
    padding: 0 0.5rem;
    line-height: 1.35;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: break-word;
    cursor: pointer;
    flex-shrink: 1;
  }

  .compact-line {
    transition: all 0.3s ease;
  }

  .compact-line.current {
    font-size: 1.05rem;
    font-weight: var(--font-weight-bold);
    margin: 0.25rem 0;
  }

  .compact-line.dimmed {
    font-size: 0.85rem;
    font-weight: var(--font-weight-medium);
    opacity: 0.4;
  }


  .lyric-word {
    position: relative;
    display: inline-block;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    background-image: linear-gradient(
      to right,
      #ffffff 0%,
      #ffffff calc(var(--word-progress, 0%) - 4%),
      rgba(255, 255, 255, 0.2) calc(var(--word-progress, 0%) + 4%),
      rgba(255, 255, 255, 0.2) 100%
    );
    transition: text-shadow 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .lyric-word {
      animation: none !important;
      transition: none !important;
    }
  }

  /*
   * Android webview fallback: lighter composition to avoid transition
   * glitches
   * now handled by LyricsView's own 'reducedMotion' prop
   */
  .fullscreen-player.android-lite .title-marquee,
  .fullscreen-player.android-lite .artist-marquee {
    mask-image: none;
    -webkit-mask-image: none;
  }

  .fullscreen-player.android-lite .compact-line {
    transition: opacity 0.2s ease;
  }

  .fullscreen-player.android-lite .mobile-lyrics-wrapper {
    margin-top: 0;
    padding-bottom: 0.5rem;
  }
</style>
