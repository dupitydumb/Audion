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
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import MarqueeText from "$lib/components/MarqueeText.svelte";
  import {
    lyricsData,
    activeLine,
    wordSyncState,
    getLineSyncState,
    type LineSyncState,
  } from "$lib/stores/lyrics";
  import {
    getTrackCoverSrc,
    formatDuration,
  } from "$lib/api/tauri";
  import { onMount, tick } from "svelte";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { buildTrackContextMenu } from "$lib/menus/contextMenus";
  import { addToast } from "$lib/stores/toast";
  import QueuePanel from "../QueuePanel.svelte";
  import ConnectPanel from "../ConnectPanel.svelte";
  import { wsStore } from "$lib/stores/websocket";
  import MeshGradientBg from "../MeshGradientBg.svelte";
  import MeshBackgroundSettings from "./MeshBackgroundSettings.svelte";
  import FullScreenMobileBottomSheet from "./FullScreenMobileBottomSheet.svelte";
  import FullScreenPlaybackControls from "./FullScreenPlaybackControls.svelte";
  import LyricsView from "../LyricsView.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let showMeshSettings = false;

  let showConnectPanel = false;
  let showMobileMenu = false;
  $: connectedDevices = $wsStore.devices.length;

  let albumArt: string | null = null;
  let isSeeking = false;
  let isAndroid = false;
  $: hideAndroidLyricsControls = isAndroid && $isMobile && $lyricsVisible;
  let desktopArtWrapperEl: HTMLDivElement | null = null;
  $: if (desktopArtWrapperEl) {
    desktopArtWrapperEl.style.viewTransitionName = $isFullScreen ? 'player-album-art' : 'none';
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

  // Load album art
  $: if ($currentTrack) {
    const trackCover = getTrackCoverSrc($currentTrack);
    albumArt = trackCover || null;
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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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

  onMount(() => {
    isAndroid =
      typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

    // No global listeners needed; pointer events are attached to the element.
    return () => {};
  });

  $: if (!$isFullScreen && showMeshSettings) showMeshSettings = false;
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
      <!-- Mobile header -->
      <div class="mobile-header">
        <button
          class="chevron-btn"
          on:click={toggleFullScreen}
          aria-label="Close"
        >
          <Icon name="chevron-down" size={28} />
        </button>
        <span class="now-playing-label">{$_('player.nowPlaying')}</span>
        <div class="mobile-header-btns">
          <button
            class="chevron-btn"
            class:active={$lyricsVisible}
            on:click={handleMobileLyricsToggle}
            aria-label="Lyrics"
          >
            <Icon name="lyrics" size={24} />
          </button>
          <button
            class="chevron-btn"
            on:click={handleMobileQueueToggle}
            aria-label="Queue"
          >
            <Icon name="queue" size={24} />
          </button>
          <button
            class="chevron-btn"
            on:click={() => (showMobileMenu = !showMobileMenu)}
            aria-label="More options"
          >
            <Icon name="more-vertical" size={24} />
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
                <Icon name="music" size={64} />
              </div>
            {/if}
          </div>

          <div class="track-info">
            <h1 class="track-title">
              {$currentTrack?.title || $_('player.unknownTitle')}
            </h1>
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
          <!-- In-place Lyrics for Mobile -->
          <div
            class="mobile-lyrics-wrapper"
            in:fade={{ duration: isAndroid ? 140 : 300 }}
          >
            {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
              <LyricsView
                transparent
                reducedMotion={isAndroid}
                style={(isAndroid
                  ? "--lyrics-content-padding: 0.75rem 1.5rem 0.75rem; --lyrics-font-size: 1.22rem; --lyrics-active-font-size: 1.22rem; --lyrics-line-padding: 0.5rem 0; --label-beam-max-width: 180px;"
                  : "--lyrics-content-padding: 2rem 1.5rem 25vh; --lyrics-font-size: 22px; --lyrics-active-font-size: 24px; --lyrics-line-padding: 0.75rem 0; --label-beam-max-width: 195px;")
                  + " " + lyricsDarkPalette}
              />
            {:else}
              <div class="no-lyrics"><p>{$_('lyrics.unavailable')}</p></div>
            {/if}
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
                <Icon name="shuffle" size={22} />
              </button>
              <button
                class="icon-btn large"
                on:click={previousTrack}
                aria-label="Previous"
              >
                <Icon name="skip-back" size={32} />
              </button>
              <button
                class="play-btn large"
                on:click={togglePlay}
                aria-label={$isPlaying ? "Pause" : "Play"}
              >
                {#if $isPlaying}
                  <Icon name="pause" size={40} />
                {:else}
                  <Icon name="play" size={40} />
                {/if}
              </button>
              <button
                class="icon-btn large"
                on:click={nextTrack}
                aria-label="Next"
              >
                <Icon name="skip-forward" size={32} />
              </button>
              <button
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

            <div class="mobile-volume-row">
              <button
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
    {:else}
      <!-- Desktop layout (enhanced 2-column) -->
      <div class="desktop-container">
        <!-- Close button (top right) -->
        <button
          class="desktop-close-btn"
          on:click={toggleFullScreen}
          aria-label="Close FullScreen"
        >
          <Icon name="x" size={24} />
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

  .mobile-view .mobile-volume-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    margin-top: 1.25rem;
  }

  .mobile-view .mobile-volume-row .volume-icon {
    color: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  .mobile-view .mobile-volume-row .volume-mute-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 6px;
    flex-shrink: 0;
    cursor: pointer;
  }

  /* same as the desktop playerbar's
     volume-bar, just a taller touch target and an always-visible thumb
     since mobile has no hover state */
  .mobile-view .mobile-volume-row .volume-bar {
    flex: 1;
    height: 28px; /* tall touch hit area, matches progress-bar */
    display: flex;
    align-items: center;
    position: relative;
    cursor: pointer;
  }

  .mobile-view .mobile-volume-row .volume-track {
    width: 100%;
    height: 4px;
    background-color: var(--bg-highlight);
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
    background-color: var(--text-primary);
    border-radius: var(--radius-full);
    transform: translateX(-50%);
    top: 50%;
    margin-top: -7px;
    box-shadow: var(--shadow-md);
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
