<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { derived } from "svelte/store";
  import {
    isFullScreen,
    toggleFullScreen,
    isQueueVisible,
    toggleQueue,
    contextMenu,
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
    addToQueue,
  } from "$lib/stores/player";
  import { isMobile } from "$lib/stores/mobile";
  import { lyricsVisible, toggleLyrics } from "$lib/stores/lyrics";
  import { goToArtistDetail } from "$lib/stores/view";
  import { lyricsData, activeLine } from "$lib/stores/lyrics";
  // Only keep the used imports
  import {
    getTrackCoverSrc,
    formatDuration,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deleteTrack,
  } from "$lib/api/tauri";
  import { onMount, tick } from "svelte";
  import { likedTrackIds, toggleLike } from "$lib/stores/liked";
  import { playlists, loadLibrary } from "$lib/stores/library";
  import { confirm } from "$lib/stores/dialogs";
  import { addToast } from "$lib/stores/toast";
  import QueuePanel from "./QueuePanel.svelte";

  let albumArt: string | null = null;
  let lyricsContainer: HTMLDivElement;
  let isSeeking = false;

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

  // Get word state: 'past', 'highlighted', or 'future'
  function getWordState(
    lineIdx: number,
    wordIdx: number,
    currentActiveLine: number,
    currentActiveWord: number,
  ): string {
    if (lineIdx < currentActiveLine) return "past";
    if (lineIdx > currentActiveLine) return "future";
    if (wordIdx < currentActiveWord) return "past";
    if (wordIdx === currentActiveWord) return "highlighted";
    return "future";
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
  async function showTrackMenu(
    e: MouseEvent | PointerEvent,
    onlyAddToPlaylist = false,
  ) {
    const track = $currentTrack;
    if (!track) return;

    e.preventDefault();
    e.stopPropagation();

    const playlistItems = $playlists.map((playlist) => ({
      label: playlist.name,
      action: async () => {
        try {
          await addTrackToPlaylist(playlist.id, track.id);
          addToast(`Added to ${playlist.name}`, "success");
        } catch (error) {
          console.error("Failed to add track to playlist:", error);
          addToast("Failed to add to playlist", "error");
        }
      },
    }));

    const menuItems: any[] = [
      {
        label: "Add to Queue",
        action: () => {
          addToQueue([track]);
          addToast("Added to queue", "success");
        },
      },
      { type: "separator" },
      {
        label: "Add to Playlist",
        submenu:
          playlistItems.length > 0
            ? playlistItems
            : [
                {
                  label: "No playlists",
                  action: () => {},
                  disabled: true,
                },
              ],
      },
      { type: "separator" },
      {
        label: "Delete from Library",
        danger: true,
        action: async () => {
          const confirmed = await confirm(
            `Are you sure you want to delete "${track.title}" from your library?`,
            {
              title: "Delete Track",
              confirmLabel: "Delete",
              danger: true,
            },
          );

          if (!confirmed) return;

          try {
            await deleteTrack(track.id);
            await loadLibrary();
            toggleFullScreen(); // Close player if track is deleted
          } catch (error) {
            console.error("Failed to delete track:", error);
          }
        },
      },
    ];

    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: onlyAddToPlaylist
        ? [
            {
              label: "Add to Playlist",
              submenu:
                playlistItems.length > 0
                  ? playlistItems
                  : [
                      {
                        label: "No playlists",
                        action: () => {},
                        disabled: true,
                      },
                    ],
            },
          ]
        : menuItems,
    });
  }

  onMount(() => {
    // No global listeners needed; pointer events are attached to the element.
    return () => {};
  });
</script>

{#if $isFullScreen}
  <div class="fullscreen-player" transition:fade={{ duration: 300 }}>
    <!-- Animated blurred background -->
    <div class="bg-canvas">
      <div
        class="bg-layer bg-layer-1"
        style="background-image: url({albumArt || ''})"
      ></div>
      <div
        class="bg-layer bg-layer-2"
        style="background-image: url({albumArt || ''})"
      ></div>
      <div
        class="bg-layer bg-layer-3"
        style="background-image: url({albumArt || ''})"
      ></div>
    </div>
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
        <button class="chevron-btn" on:click={toggleQueue} aria-label="Queue">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path
              d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
            />
          </svg>
        </button>
      </div>

      <div class="player-content mobile-view">
        <div
          class="art-container"
          in:fly={{ y: 20, duration: 500, delay: 100 }}
        >
          {#if albumArt}
            <img src={albumArt} alt="Album Art" decoding="async" />
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
          <h1 class="track-title">{$currentTrack?.title || "Unknown Title"}</h1>
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
        </div>

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
                  height="40"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg
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

        <div class="right-panel">
          <div class="lyrics-container" bind:this={lyricsContainer}>
            {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
              {#each $lyricsData.lines as line, i}
                {@const hasWordSync = line.words && line.words.length > 0}
                <div
                  class="lyric-line"
                  class:active={i === $activeLine}
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
                      {@const wordState = getWordState(
                        i,
                        wordIdx,
                        $activeLine,
                        $wordSyncState.activeWordIdx,
                      )}
                      <span class="lyric-word {wordState}">{word.word}</span>
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
              <div class="desktop-art-wrapper shadow-lg">
                {#if albumArt}
                  <img src={albumArt} alt="Album Art" decoding="async" />
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

                <div class="action-buttons">
                  <button
                    class="action-btn"
                    class:active={$currentTrack
                      ? $likedTrackIds.has($currentTrack.id)
                      : false}
                    on:click={() =>
                      $currentTrack && toggleLike($currentTrack.id)}
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
                      ><path
                        d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                      /></svg
                    >
                  </button>
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
            </div>

            <div class="desktop-playback-area">
              <div class="desktop-progress-container">
                <div
                  class="desktop-progress-bar"
                  on:pointerdown={handleSeekPointerDown}
                  on:pointermove={handleSeekPointerMove}
                  on:pointerup={handleSeekPointerUp}
                  role="slider"
                  aria-label="Seek track"
                  aria-valuenow={Math.round($progress * 100)}
                  tabindex="0"
                >
                  <div class="progress-track">
                    <div
                      class="progress-fill"
                      style="width: {$progress * 100}%"
                    ></div>
                  </div>
                </div>
                <div class="time-row">
                  <span>{formatDuration($currentTime)}</span>
                  <span>{formatDuration($duration)}</span>
                </div>
              </div>

              <div class="desktop-controls">
                <button
                  class="control-btn"
                  class:track-active={$shuffle}
                  on:click={toggleShuffle}
                  aria-label="Shuffle"
                  ><svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                    ><path
                      d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
                    /></svg
                  ></button
                >
                <button
                  class="control-btn secondary"
                  on:click={previousTrack}
                  aria-label="Previous"
                  ><svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="28"
                    height="28"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg
                  ></button
                >
                <button
                  class="control-btn play-pause-main"
                  on:click={togglePlay}
                  aria-label={$isPlaying ? "Pause" : "Play"}
                >
                  {#if $isPlaying}
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width="36"
                      height="36"
                      ><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg
                    >
                  {:else}
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width="36"
                      height="36"><path d="M8 5v14l11-7z" /></svg
                    >
                  {/if}
                </button>
                <button
                  class="control-btn secondary"
                  on:click={nextTrack}
                  aria-label="Next"
                  ><svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="28"
                    height="28"
                    ><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg
                  ></button
                >
                <button
                  class="control-btn"
                  class:track-active={$repeat !== "none"}
                  on:click={cycleRepeat}
                  aria-label="Repeat"
                  ><svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                    ><path
                      d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
                    /></svg
                  >{#if $repeat === "one"}<span class="repeat-indicator">1</span
                    >{/if}</button
                >
              </div>

              <div class="desktop-volume-row">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="18"
                  height="18"
                  class="volume-icon"
                  ><path
                    d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                  /></svg
                >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={$volume}
                  on:input={handleVolumeChange}
                  class="volume-slider"
                  aria-label="Volume"
                />
              </div>
            </div>
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
                  bind:this={lyricsContainer}
                  in:fade
                >
                  {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
                    {#each $lyricsData.lines as line, i}
                      {@const isActiveLine = i === $activeLine}
                      {@const hasWordSync = line.words && line.words.length > 0}
                      <div
                        class="desktop-lyric-line"
                        class:active={isActiveLine}
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
                            {@const wordState = getWordState(
                              i,
                              wordIdx,
                              $activeLine,
                              $wordSyncState.activeWordIdx,
                            )}
                            {@const wordProgress =
                              wordIdx === $wordSyncState.activeWordIdx
                                ? $wordSyncState.progress
                                : 0}
                            <span
                              class="desktop-lyric-word {wordState}"
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
  .bg-canvas {
    position: absolute;
    inset: -50%;
    width: 200%;
    height: 200%;
    z-index: 0;
    pointer-events: none;
    filter: blur(80px) saturate(1.8);
    opacity: 0.5;
  }

  .bg-layer {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    will-change: transform, opacity;
  }

  .bg-layer-1 {
    opacity: 0.8;
    animation: bg-pulse-1 20s infinite alternate linear;
  }
  .bg-layer-2 {
    opacity: 0.5;
    animation: bg-pulse-2 25s infinite alternate linear;
    mix-blend-mode: soft-light;
  }
  .bg-layer-3 {
    opacity: 0.3;
    animation: bg-pulse-3 30s infinite alternate linear;
    mix-blend-mode: overlay;
  }

  @keyframes bg-pulse-1 {
    0% {
      transform: translate(0, 0) scale(1) rotate(0deg);
    }
    100% {
      transform: translate(10%, 15%) scale(1.1) rotate(5deg);
    }
  }
  @keyframes bg-pulse-2 {
    0% {
      transform: translate(0, 0) scale(1.1) rotate(0deg);
    }
    100% {
      transform: translate(-15%, 10%) scale(1) rotate(-8deg);
    }
  }
  @keyframes bg-pulse-3 {
    0% {
      transform: translate(0, 0) scale(1) rotate(0deg);
    }
    100% {
      transform: translate(5%, -10%) scale(1.2) rotate(12deg);
    }
  }

  .backdrop-layer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.4) 0%,
      rgba(0, 0, 0, 0.7) 100%
    );
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
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    align-items: center;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .desktop-left {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center; /* Center the entire block in the left column */
    height: 100%;
    max-height: 100%;
    gap: 2.5rem;
  }

  /* Each section in the left panel shares the same max-width for uniformity */
  .desktop-art-section,
  .desktop-track-details,
  .desktop-playback-area {
    width: 100%;
    max-width: 400px;
  }

  .desktop-art-section {
    aspect-ratio: 1;
    position: relative;
    flex-shrink: 1;
    min-height: 200px;
    margin-bottom: 0;
  }

  .desktop-art-wrapper {
    width: 100%;
    height: 100%;
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
    background: var(--bg-surface);
  }

  .desktop-art-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .desktop-track-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .track-info-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 1.5rem;
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
    text-decoration: underline;
  }

  /* Marquee Styles */
  .marquee-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    margin-bottom: 0;
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 5%,
      black 95%,
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 5%,
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
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .action-btn {
    width: 42px;
    height: 42px;
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

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
    transform: translateY(-2px);
  }

  .action-btn.active {
    color: #ff4d4d;
  }

  .desktop-playback-area {
    display: flex;
    flex-direction: column;
  }

  .desktop-progress-container {
    margin-bottom: 1.5rem;
    width: 100%;
  }

  .desktop-progress-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    position: relative;
    cursor: pointer;
    margin-bottom: 0.75rem;
  }

  .progress-track {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 3px;
  }

  .progress-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 3px;
    transition: width 0.1s linear;
  }

  .desktop-progress-bar:hover .progress-fill {
    background: #fff;
  }

  .time-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.4);
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .desktop-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2.5rem;
    margin-bottom: 1.5rem;
  }

  .control-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 0.5rem;
  }

  .control-btn:hover {
    color: #fff;
    transform: scale(1.15);
  }

  .control-btn.secondary {
    color: rgba(255, 255, 255, 0.8);
  }

  .control-btn.play-pause-main {
    width: 64px;
    height: 64px;
    background: #fff;
    color: #000;
    border-radius: 50%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  }

  .control-btn.play-pause-main:hover {
    transform: scale(1.08);
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4);
  }

  .control-btn.track-active {
    color: #1ed760;
  }

  .repeat-indicator {
    position: absolute;
    top: 0;
    right: -4px;
    font-size: 0.6rem;
    font-weight: 800;
    background: #1ed760;
    color: #000;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .desktop-volume-row {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    max-width: 280px;
    margin: 0 auto;
    opacity: 0.5;
    transition: opacity 0.3s;
  }

  .desktop-volume-row:hover {
    opacity: 1;
  }

  .volume-icon {
    color: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  .volume-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.15);
    outline: none;
    cursor: pointer;
  }

  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }

  .volume-slider:hover::-webkit-slider-thumb {
    transform: scale(1.2);
  }

  /* Right column styles (Tabs & Content) */
  .desktop-right {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 100%;
  }

  .tab-switcher {
    display: flex;
    gap: 0.25rem;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.35rem;
    border-radius: 50px;
    align-self: center;
    margin-bottom: 2.5rem;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tab-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    padding: 0.6rem 2.2rem;
    border-radius: 50px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tab-btn:hover {
    color: rgba(255, 255, 255, 0.85);
  }

  .tab-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  }

  .tab-content-wrapper {
    flex: 1;
    overflow: hidden;
    position: relative;
    border-radius: 24px;
  }

  /* Lyrics Content Styling */
  .desktop-lyrics-container {
    height: 100%;
    overflow-y: auto;
    padding: 30vh 0;
    scrollbar-width: none;
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

  .desktop-lyric-line {
    font-size: 2.25rem;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.2);
    padding: 1.25rem 0;
    cursor: pointer;
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: left;
    filter: blur(1.5px);
    line-height: 1.3;
    letter-spacing: -0.01em;
  }

  .desktop-lyric-line:hover {
    color: rgba(255, 255, 255, 0.4);
    filter: blur(0.5px);
  }

  .desktop-lyric-line.active {
    color: #fff;
    transform: scale(1.06);
    filter: blur(0);
    text-shadow: 0 4px 25px rgba(255, 255, 255, 0.25);
  }

  .desktop-lyric-word {
    position: relative;
    display: inline-block;
  }

  .desktop-lyric-word.highlighted {
    color: #fff;
    text-shadow: 0 0 15px rgba(255, 255, 255, 0.4);
    transition: all 0.2s ease;
  }

  .desktop-lyric-word.past {
    color: #fff;
  }

  .desktop-lyric-word.future {
    color: rgba(255, 255, 255, 0.2);
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
    padding: 1rem 1.5rem;
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
    font-weight: 700;
    letter-spacing: 0.1em;
    opacity: 0.6;
  }

  .player-content.mobile-view {
    display: flex;
    flex-direction: column;
    padding: 1rem 2rem 3rem;
    height: 100%;
    gap: 2rem;
    z-index: 10;
  }

  .mobile-view .art-container {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
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
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    position: relative;
  }

  .mobile-view .progress-fill {
    height: 100%;
    background: #fff;
    border-radius: 2px;
  }

  .mobile-view .time {
    font-size: 0.75rem;
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

  .mobile-view .right-panel {
    display: none; /* Mobile uses separate toggles usually */
  }

  .lyric-word.highlighted {
    color: #fff;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
  }

  .lyric-word.past {
    color: #fff;
  }

  .lyric-word.future {
    color: rgba(255, 255, 255, 0.2);
  }

  @media (prefers-reduced-motion: reduce) {
    .bg-layer,
    .desktop-lyric-line,
    .desktop-lyric-word,
    .lyric-word {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
