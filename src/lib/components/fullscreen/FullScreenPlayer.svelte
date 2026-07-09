<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import { derived } from "svelte/store";
  import {
    isFullScreen,
    toggleFullScreen,
    isQueueVisible,
    toggleQueue,
    contextMenu,
    nativeTransitionActive,
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
  } from "$lib/stores/player";
  import { isMobile } from "$lib/stores/mobile";
  import { lyricsVisible, toggleLyrics } from "$lib/stores/lyrics";
  import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
  import { lyricsData, activeLine } from "$lib/stores/lyrics";
  import {
    getTrackCoverSrc,
    formatDuration,
  } from "$lib/api/tauri";
  import { onMount, tick } from "svelte";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { _ } from "svelte-i18n";
  import { buildTrackContextMenu } from "$lib/menus/contextMenus";
  import { addToast } from "$lib/stores/toast";
  import QueuePanel from "../QueuePanel.svelte";
  import ConnectPanel from "../ConnectPanel.svelte";
  import { wsStore } from "$lib/stores/websocket";
  import MeshGradientBg from "../MeshGradientBg.svelte";
  import FullScreenMobileBottomSheet from "./FullScreenMobileBottomSheet.svelte";
  import FullScreenPlaybackControls from "./FullScreenPlaybackControls.svelte";

  let showConnectPanel = false;
  let showMobileMenu = false;
  $: connectedDevices = $wsStore.devices.length;

  let albumArt: string | null = null;
  let lyricsContainer: HTMLDivElement;
  let isSeeking = false;
  let isAndroid = false;
  $: hideAndroidLyricsControls = isAndroid && $isMobile && $lyricsVisible;
  $: isUnsynced = !$lyricsData?.lines || $lyricsData.lines.length === 0 || !$lyricsData.lines.some((line) => line.time > 0);
  let desktopArtWrapperEl: HTMLDivElement | null = null;
  $: if (desktopArtWrapperEl) {
    desktopArtWrapperEl.style.viewTransitionName = $isFullScreen ? 'player-album-art' : 'none';
  }

  // Combined reactive state for word-by-word sync
  const wordSyncState = derived(
    [lyricsData, currentTime, activeLine],
    ([$lyrics, $time, $activeLineIdx]) => {
      // Guard against missing lyrics data
      if (!$lyrics?.lines || $activeLineIdx < 0) {
        return { activeWordIdx: -1, progress: 0 };
      }

      const line = $lyrics.lines[$activeLineIdx];
      if (!line?.words || line.words.length === 0) {
        return { activeWordIdx: -1, progress: 0 };
      }

      // Find the word that's currently active
      let activeWordIdx = -1;
      for (let i = 0; i < line.words.length; i++) {
        const word = line.words[i];
        if ($time >= word.time && $time <= word.endTime) {
          activeWordIdx = i;
          break;
        }
        if ($time >= word.time) {
          const nextWord = line.words[i + 1];
          if (!nextWord || $time < nextWord.time) {
            activeWordIdx = i;
          }
        }
      }

      // Calculate progress for active word
      let progress = 0;
      if (activeWordIdx >= 0) {
        const word = line.words[activeWordIdx];
        const wordStart = word.time;
        const wordEnd = word.endTime;
        const duration = wordEnd - wordStart;

        if (duration > 0) {
          const elapsed = $time - wordStart;
          progress = Math.min(100, Math.max(0, (elapsed / duration) * 100));
        } else {
          progress = 100;
        }
      }

      return { activeWordIdx, progress };
    },
  );

  // Get word progress percentage for smooth filling
  function getWordPercentage(
    lineIdx: number,
    wordIdx: number,
    currentActiveLine: number,
    currentActiveWordIdx: number,
    currentWordProgress: number,
  ): number {
    if (lineIdx < currentActiveLine) return 100;
    if (lineIdx > currentActiveLine) return 0;
    if (wordIdx < currentActiveWordIdx) return 100;
    if (wordIdx === currentActiveWordIdx) return currentWordProgress;
    return 0;
  }

  // Load album art
  $: if ($currentTrack) {
    const trackCover = getTrackCoverSrc($currentTrack);
    albumArt = trackCover || null;
  } else {
    albumArt = null;
  }

  // Apple Music-style smooth scroll with custom easing
  let scrollAnimationId: number | null = null;
  let prevActiveLine = -1;

  $: if (
    $activeLine !== -1 &&
    lyricsContainer &&
    $activeLine !== prevActiveLine
  ) {
    prevActiveLine = $activeLine;
    scrollToCurrentLine();
  }

  function easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  async function scrollToCurrentLine() {
    await tick();
    if (!lyricsContainer) return;

    const activeEl = lyricsContainer.querySelector(
      ".lyric-line.active, .desktop-lyric-line.active",
    ) as HTMLElement;
    if (!activeEl) return;

    if (scrollAnimationId) {
      cancelAnimationFrame(scrollAnimationId);
    }

    const containerRect = lyricsContainer.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const containerCenter = containerRect.height / 2;
    const activeCenter =
      activeRect.top - containerRect.top + activeRect.height / 2;
    const targetScroll =
      lyricsContainer.scrollTop + (activeCenter - containerCenter);

    const startScroll = lyricsContainer.scrollTop;
    const distance = targetScroll - startScroll;
    const duration = 600;
    let startTime: number | null = null;

    function step(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const prog = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(prog);

      lyricsContainer.scrollTop = startScroll + distance * eased;

      if (prog < 1) {
        scrollAnimationId = requestAnimationFrame(step);
      } else {
        scrollAnimationId = null;
      }
    }

    scrollAnimationId = requestAnimationFrame(step);
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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }

  // --- Tab Management ---
  let activeTab: "lyrics" | "queue" = "lyrics";

  // --- Marquee & Overflow Management ---
  let titleContainerWidth = 0;
  let titleContentWidth = 0;
  let artistContainerWidth = 0;
  let artistContentWidth = 0;

  $: isTitleOverflowing = titleContentWidth > titleContainerWidth;
  $: isArtistOverflowing = artistContentWidth > artistContainerWidth;

  // Dynamic duration based on content length for consistent speed
  $: titleScrollDuration = Math.max(10, titleContentWidth / 40);
  $: artistScrollDuration = Math.max(8, artistContentWidth / 35);

  // --- Volume Management ---
  function handleVolumeChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    volume.set(val);
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

  onMount(() => {
    isAndroid =
      typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

    // No global listeners needed; pointer events are attached to the element.
    return () => {};
  });
</script>

{#if $isFullScreen}
  <div
    class="fullscreen-player"
    class:android-lite={isAndroid && $isMobile}
    transition:fade={{ duration: $nativeTransitionActive ? 0 : (isAndroid ? 180 : 300) }}
  >
    <!-- Animated blurred background -->
    <MeshGradientBg lite={isAndroid && $isMobile} />
    <div class="backdrop-layer"></div>

    {#if $isMobile}
      <!-- Mobile header -->
      <div class="mobile-header">
        <button
          class="chevron-btn"
          on:click={toggleFullScreen}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </button>
        <span class="now-playing-label">Now Playing</span>
        <div class="mobile-header-btns">
          <button
            class="chevron-btn"
            class:active={$lyricsVisible}
            on:click={handleMobileLyricsToggle}
            aria-label="Lyrics"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path
                d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 16H5V4h14v14zM7 10h10V8H7v2zm10 3H7v-2h10v2zm-3 3H7v-2h7v2z"
              />
            </svg>
          </button>
          <button
            class="chevron-btn"
            on:click={handleMobileQueueToggle}
            aria-label="Queue"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path
                d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
              />
            </svg>
          </button>
          <button
            class="chevron-btn"
            on:click={() => (showMobileMenu = !showMobileMenu)}
            aria-label="More options"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile three-dot bottom-sheet menu -->
      {#if showMobileMenu}
        <FullScreenMobileBottomSheet
          bind:showMobileMenu
          bind:showConnectPanel
          {albumArt}
        />
      {/if}

      <div class="player-content mobile-view">
        {#if !$lyricsVisible}
          <div
            class="art-container"
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
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="64"
                  height="64"
                >
                  <path
                    d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                  />
                </svg>
              </div>
            {/if}
          </div>

          <div class="track-info">
            <h1 class="track-title">
              {$currentTrack?.title || "Unknown Title"}
            </h1>
            <button
              class="track-artist"
              on:click={() => {
                if ($currentTrack?.artist) {
                  toggleFullScreen();
                  goToArtistDetail($currentTrack.artist);
                }
              }}
            >
              {$currentTrack?.artist || "Unknown Artist"}
            </button>
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
          <!-- In-place Lyrics for Mobile -->
          <div
            class="mobile-lyrics-wrapper"
            in:fade={{ duration: isAndroid ? 140 : 300 }}
          >
            <div class="lyrics-container" bind:this={lyricsContainer}>
              {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
                {#each $lyricsData.lines as line, i}
                  {@const hasWordSync = line.words && line.words.length > 0}
                  {#if line.structure && (i === 0 || line.structure !== $lyricsData.lines[i - 1].structure)}
                    <div class="section-label" aria-hidden="true">{line.structure}</div>
                  {/if}
                  <div
                    class="lyric-line"
                    class:active={i === $activeLine}
                    class:past={i < $activeLine}
                    class:upcoming={i > $activeLine}
                    class:opposite={!!line.opposite_turn && !line.is_background}
                    class:opposite-bg={!!line.opposite_turn && !!line.is_background}
                    role="button"
                    tabindex="0"
                    on:click={() => {
                      const dur = $duration;
                      if (dur && dur > 0) seek(line.time / dur);
                    }}
                    on:keydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        const dur = $duration;
                        if (dur && dur > 0) seek(line.time / dur);
                      }
                    }}
                  >
                    {#if hasWordSync && i === $activeLine && line.words}
                      {#each line.words as word, wordIdx}
                        {@const wordProgress = getWordPercentage(
                          i,
                          wordIdx,
                          $activeLine,
                          $wordSyncState.activeWordIdx,
                          $wordSyncState.progress,
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
              {:else}
                <div class="no-lyrics"><p>No lyrics available</p></div>
              {/if}
            </div>
          </div>
        {/if}

        {#if !hideAndroidLyricsControls}
          <div class="player-controls">
            <div class="progress-bar-container">
              <span class="time">{formatDuration($currentTime)}</span>
              <div
                class="progress-bar"
                on:pointerdown={handleSeekPointerDown}
                on:pointermove={handleSeekPointerMove}
                on:pointerup={handleSeekPointerUp}
                on:pointercancel={handleSeekPointerUp}
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
            </div>

            <div class="buttons">
              <button
                class="icon-btn shuffle-repeat"
                class:active={$shuffle}
                on:click={toggleShuffle}
                aria-label="Shuffle"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="22"
                  height="22"
                >
                  <path
                    d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
                  />
                </svg>
              </button>
              <button
                class="icon-btn large"
                on:click={previousTrack}
                aria-label="Previous"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="32"
                  height="32"
                >
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
              </button>
              <button
                class="play-btn large"
                on:click={togglePlay}
                aria-label={$isPlaying ? "Pause" : "Play"}
              >
                {#if $isPlaying}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="40"
                    height="40"
                    ><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg
                  >
                {:else}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="40"
                    height="40"><path d="M8 5v14l11-7z" /></svg
                  >
                {/if}
              </button>
              <button
                class="icon-btn large"
                on:click={nextTrack}
                aria-label="Next"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="32"
                  height="32"
                >
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
              </button>
              <button
                class="icon-btn shuffle-repeat"
                class:active={$repeat !== "none"}
                on:click={cycleRepeat}
                aria-label="Repeat"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="22"
                  height="22"
                >
                  <path
                    d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
                  />
                </svg>
                {#if $repeat === "one"}<span class="repeat-one-badge">1</span
                  >{/if}
              </button>
            </div>
          </div>
        {/if}

        {#if !$lyricsVisible && $lyricsData?.lines}
          <div class="compact-lyrics-mobile" in:fade>
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
                      $wordSyncState.activeWordIdx,
                      $wordSyncState.progress,
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
    {:else}
      <!-- Desktop layout (enhanced 2-column) -->
      <div class="desktop-container">
        <!-- Close button (top right) -->
        <button
          class="desktop-close-btn"
          on:click={toggleFullScreen}
          aria-label="Close FullScreen"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>

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
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width="128"
                      height="128"
                    >
                      <path
                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                      />
                    </svg>
                  </div>
                {/if}
              </div>
            </div>

            <div class="desktop-track-details">
              <div class="track-info-header">
                <div
                  class="marquee-container"
                  bind:clientWidth={titleContainerWidth}
                >
                  <div
                    class="marquee-inner"
                    class:animate={isTitleOverflowing}
                    style="--duration: {titleScrollDuration}s"
                  >
                    <h1
                      class="desktop-title"
                      bind:clientWidth={titleContentWidth}
                    >
                      {$currentTrack?.title || "Unknown Title"}
                    </h1>
                    {#if isTitleOverflowing}
                      <span class="desktop-title" aria-hidden="true"
                        >{$currentTrack?.title || "Unknown Title"}</span
                      >
                    {/if}
                  </div>
                </div>
              </div>

              <div
                class="marquee-container artist"
                bind:clientWidth={artistContainerWidth}
              >
                <div
                  class="marquee-inner"
                  class:animate={isArtistOverflowing}
                  style="--duration: {artistScrollDuration}s"
                >
                  <button
                    class="desktop-subtitle"
                    bind:clientWidth={artistContentWidth}
                    on:click={() => {
                      $currentTrack?.artist &&
                        (toggleFullScreen(),
                        goToArtistDetail($currentTrack.artist));
                    }}
                  >
                    {$currentTrack?.artist || "Unknown Artist"}
                  </button>
                  {#if isArtistOverflowing}
                    <button class="desktop-subtitle" aria-hidden="true"
                      >{$currentTrack?.artist || "Unknown Artist"}</button
                    >
                  {/if}
                </div>
              </div>

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

              <div class="action-buttons">
                <button
                  class="action-btn"
                  class:active={$currentTrack
                    ? $likedTrackIds.has($currentTrack.id)
                    : false}
                  on:click={() => $currentTrack && toggleLike($currentTrack.id)}
                  aria-label="Like"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                  >
                    {#if $currentTrack && $likedTrackIds.has($currentTrack.id)}
                      <path
                        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                      />
                    {:else}
                      <path
                        d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5c0-3.08-2.42-5.5-5.5-5.5zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"
                      />
                    {/if}
                  </svg>
                </button>
                <button
                  class="action-btn"
                  on:click={(e) => showTrackMenu(e, true)}
                  aria-label="Add to Playlist"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                    ><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg
                  >
                </button>
                <button
                  class="action-btn"
                  on:click={(e) => showTrackMenu(e)}
                  aria-label="More Options"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                  >
                    <path
                      d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                    />
                  </svg>
                </button>
                <button
                  class="action-btn connect-btn"
                  class:active={connectedDevices > 0}
                  on:click={() => (showConnectPanel = !showConnectPanel)}
                  aria-label="Connect"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                  >
                    <path
                      d="M19,2H5A3,3,0,0,0,2,5V15a3,3,0,0,0,3,3H9.17l-1.42,1.41a1,1,0,0,0,0,1.42,1,1,0,0,0,1.42,0L11,18.99,12.83,20.83a1,1,0,0,0,1.42,0,1,1,0,0,0,0-1.42L12.83,18H19a3,3,0,0,0,3-3V5A3,3,0,0,0,19,2Zm1,13a1,1,0,0,1-1,1H5a1,1,0,0,1-1-1V5A1,1,0,0,1,5,4H19a1,1,0,0,1,1,1Z"
                    />
                  </svg>
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
                on:click={() => (activeTab = "lyrics")}>Lyrics</button
              >
              <button
                class="tab-btn"
                class:active={activeTab === "queue"}
                on:click={() => (activeTab = "queue")}>Queue</button
              >
            </div>

            <div class="tab-content-wrapper">
              {#if activeTab === "lyrics"}
                <div
                  class="desktop-lyrics-container"
                  class:unsynced={isUnsynced}
                  bind:this={lyricsContainer}
                  in:fade
                >
                  {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
                    {#each $lyricsData.lines as line, i}
                      {@const isActiveLine = i === $activeLine}
                      {@const hasWordSync = line.words && line.words.length > 0}
                      {#if line.structure && (i === 0 || line.structure !== $lyricsData.lines[i - 1].structure)}
                        <div class="section-label" aria-hidden="true">{line.structure}</div>
                      {/if}
                      <div
                        class="desktop-lyric-line"
                        class:active={isActiveLine}
                        class:past={i < $activeLine}
                        class:upcoming={i > $activeLine}
                        class:opposite={!!line.opposite_turn && !line.is_background}
                        class:opposite-bg={!!line.opposite_turn && !!line.is_background}
                        role="button"
                        tabindex="0"
                        on:click={() => {
                          $duration && seek(line.time / $duration);
                        }}
                        on:keydown={(e) => {
                          (e.key === "Enter" || e.key === " ") &&
                            $duration &&
                            seek(line.time / $duration);
                        }}
                      >
                        {#if hasWordSync && isActiveLine && line.words}
                          {#each line.words as word, wordIdx}
                            {@const wordProgress = getWordPercentage(
                              i,
                              wordIdx,
                              $activeLine,
                              $wordSyncState.activeWordIdx,
                              $wordSyncState.progress,
                            )}
                            <span
                              class="desktop-lyric-word"
                              style="--word-progress: {wordProgress}%;"
                              >{word.word}</span
                            >
                            {#if wordIdx < line.words.length - 1}{" "}{/if}
                          {/each}
                        {:else}
                          <span class="lyric-text-fallback">{line.text}</span>
                        {/if}
                      </div>
                    {/each}
                  {:else}
                    <div class="no-lyrics-desktop">
                      <p>No lyrics available for this track.</p>
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

{#if showConnectPanel}
  <ConnectPanel on:close={() => (showConnectPanel = false)} />
{/if}

<style>
  .fullscreen-player {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background-color: #000;
    color: #fff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
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

  .desktop-track-details .marquee-container {
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
  .marquee-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    margin-bottom: 0;
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

  .marquee-container.artist {
    margin-top: 0.25rem;
  }

  .marquee-inner {
    display: flex;
    width: max-content;
    gap: 4rem;
  }

  .marquee-inner.animate {
    animation: running-marquee var(--duration) linear infinite;
  }

  @keyframes running-marquee {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(calc(-50% - 2rem));
    }
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
    color: #ff4d4d;
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
    gap: 2rem;
    background: none;
    padding: 0;
    border-radius: 0;
    align-self: flex-start;
    margin-bottom: 1.5rem;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    width: 100%;
  }

  .tab-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.35);
    padding: 0.5rem 0;
    border-radius: 0;
    font-weight: var(--font-weight-semibold);
    font-size: 0.95rem;
    cursor: pointer;
    position: relative;
    transition: color 0.2s ease;
  }

  .tab-btn:hover {
    color: rgba(255, 255, 255, 0.75);
  }

  .tab-btn.active {
    background: none;
    color: #fff;
  }

  .tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 1.5px;
    background-color: #fff;
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

  /* Lyrics Content Styling */
  .desktop-lyrics-container {
    height: 100%;
    width: 100%;
    overflow: hidden;
    padding: 35vh 3rem 35vh 0;
    scrollbar-width: none;
    will-change: transform;
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 20%,
      black 80%,
      transparent
    );
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent,
      black 20%,
      black 80%,
      transparent
    );
  }

  .desktop-lyrics-container::-webkit-scrollbar {
    display: none;
  }

  /* Unsynced container & lines overrides */
  .desktop-lyrics-container.unsynced {
    overflow-y: auto;
    height: 100%;
    padding: 2rem 3rem 2rem 0;
    mask-image: none;
    -webkit-mask-image: none;
  }

  .desktop-lyrics-container.unsynced .desktop-lyric-line {
    color: rgba(255, 255, 255, 0.75);
    opacity: 1;
    transform: none !important;
    cursor: default;
  }

  .desktop-lyrics-container.unsynced .desktop-lyric-line:hover {
    color: #ffffff;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    padding: 16px 0 4px;
    user-select: none;
    pointer-events: none;
    width: 100%;
  }

  .desktop-lyric-line {
    font-size: clamp(20px, 2.2vh, 32px);
    font-weight: 800;
    color: rgba(255, 255, 255, 0.15);
    padding: 0.7rem 0;
    cursor: pointer;
    transition:
      color 0.4s ease,
      opacity 0.4s ease,
      transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: left;
    line-height: 1.4;
    letter-spacing: -0.01em;
    will-change: transform, opacity;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    width: 100%;
    max-width: 90%;
    overflow-wrap: break-word;
    word-break: break-word;
    white-space: normal;
  }

  .desktop-lyric-line.opposite {
    text-align: right;
    transform-origin: right center;
    font-style: italic;
  }

  .desktop-lyric-line.opposite-bg {
    text-align: right;
    transform-origin: right center;
    font-style: italic;
    opacity: 0.6;
  }

  .desktop-lyric-line.past {
    color: rgba(255, 255, 255, 0.15);
  }

  .desktop-lyric-line.upcoming {
    color: rgba(255, 255, 255, 0.45);
  }

  .desktop-lyric-line:hover {
    color: rgba(255, 255, 255, 0.7);
  }

  .desktop-lyric-line.active {
    color: #fff;
    font-size: clamp(22px, 2.5vh, 36px);
    transform: scale(1.04);
    margin: 0;
    text-shadow: 0 0 15px rgba(255, 255, 255, 0.1);
  }

  .desktop-lyric-word {
    position: relative;
    display: inline-block;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
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
  .mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(1rem + var(--safe-area-top)) 1.5rem 1rem;
    z-index: 100;
  }

  .chevron-btn {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
  }

  .now-playing-label {
    text-transform: uppercase;
    font-size: 0.7rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.1em;
    opacity: 0.6;
  }

  .player-content.mobile-view {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 2rem 2rem;
    height: 100%;
    gap: 1.25rem;
    z-index: 10;
  }

  .mobile-view .art-container {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 16px;
    overflow: hidden;
    max-height: 48vh;
    margin: 0 auto;
  }

  .mobile-view .art-container img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mobile-view .track-info {
    text-align: left;
  }

  .mobile-view .track-title {
    font-size: 1.75rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
  }

  .mobile-view .track-artist {
    font-size: 1.1rem;
    color: rgba(255, 255, 255, 0.6);
    background: none;
    border: none;
    padding: 0;
  }

  .mobile-view .track-album {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.4);
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
  }

  .mobile-view .progress-bar-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .mobile-view .progress-bar {
    flex: 1;
    height: 28px; /* tall touch hit area */
    background: transparent;
    border-radius: 2px;
    position: relative;
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .mobile-view .progress-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    overflow: visible; /* don't clip thumb */
    position: relative;
  }

  .mobile-view .progress-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 2px;
  }

  .mobile-view .progress-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    transform: translateX(-50%) scale(1);
    top: 50%;
    margin-top: -7px;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .mobile-view .time {
    font-size: var(--font-size-xs);
    opacity: 0.5;
    min-width: 35px;
  }

  .mobile-view .buttons {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .mobile-view .play-btn.large {
    width: 64px;
    height: 64px;
    background: #fff;
    color: #000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mobile-header-btns {
    display: flex;
    gap: 0.5rem;
  }

  .chevron-btn.active {
    color: #1ed760;
  }

  .mobile-lyrics-wrapper {
    flex: 1;
    overflow: hidden;
    margin-top: -1rem;
    margin-bottom: 0;
  }

  .mobile-lyrics-wrapper .lyrics-container {
    height: 100%;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    padding: 2rem 1.5rem 25vh;
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 15%,
      black 75%,
      transparent
    );
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent,
      black 15%,
      black 75%,
      transparent
    );
  }

  .compact-lyrics-mobile {
    margin-top: 1rem;
    text-align: center;
    color: #fff;
    min-height: 4.5em;
    padding: 0 1rem;
    line-height: 1.4;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: break-word;
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

  .mobile-lyrics-wrapper .lyric-line {
    font-size: 22px;
    font-weight: var(--font-weight-bold);
    line-height: 1.4;
    padding: 0.75rem 0;
    color: rgba(255, 255, 255, 0.15);
    transition: all 0.3s ease;
    width: 100%;
    max-width: 94%;
    overflow-wrap: break-word;
    word-break: break-word;
    white-space: normal;
  }

  .mobile-lyrics-wrapper .lyric-line.opposite {
    text-align: right;
    transform-origin: right center;
    font-style: italic;
  }

  .mobile-lyrics-wrapper .lyric-line.opposite-bg {
    text-align: right;
    transform-origin: right center;
    font-style: italic;
    opacity: 0.6;
  }

  .mobile-lyrics-wrapper .lyric-line.past {
    color: rgba(255, 255, 255, 0.15);
  }

  .mobile-lyrics-wrapper .lyric-line.upcoming {
    color: rgba(255, 255, 255, 0.45);
  }

  .mobile-lyrics-wrapper .lyric-line.active {
    color: #fff;
    font-size: 24px;
    transform: scale(1.04);
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
    .desktop-lyric-line,
    .desktop-lyric-word,
    .lyric-word {
      animation: none !important;
      transition: none !important;
    }
  }

  /* Android webview fallback: lighter composition to avoid transition glitches */
  .fullscreen-player.android-lite .marquee-container,
  .fullscreen-player.android-lite .desktop-lyrics-container,
  .fullscreen-player.android-lite .mobile-lyrics-wrapper .lyrics-container {
    mask-image: none;
    -webkit-mask-image: none;
  }

  .fullscreen-player.android-lite .desktop-lyric-line,
  .fullscreen-player.android-lite .mobile-lyrics-wrapper .lyric-line {
    transform: none !important;
    text-shadow: none;
    transition:
      color 0.2s ease,
      opacity 0.2s ease;
  }

  .fullscreen-player.android-lite .compact-line {
    transition: opacity 0.2s ease;
  }

  .fullscreen-player.android-lite .mobile-lyrics-wrapper {
    margin-top: 0;
    padding-bottom: 0.5rem;
  }

  .fullscreen-player.android-lite .mobile-lyrics-wrapper .lyrics-container {
    padding: 0.75rem 0 0.75rem;
  }

  .fullscreen-player.android-lite .mobile-lyrics-wrapper .lyric-line {
    font-size: 1.22rem;
    line-height: 1.3;
    padding: 0.5rem 0;
    word-break: break-word;
  }
</style>
