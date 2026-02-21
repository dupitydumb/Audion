<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { derived } from "svelte/store";
  import {
    isFullScreen,
    toggleFullScreen,
    isQueueVisible,
    toggleQueue,
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
  } from "$lib/stores/player";
  import { isMobile } from "$lib/stores/mobile";
  import { lyricsVisible, toggleLyrics } from "$lib/stores/lyrics";
  import { goToArtistDetail } from "$lib/stores/view";

  // Seek to a specific lyric line time
  function handleLineClick(lineTime: number) {
    const dur = $duration;
    if (dur && dur > 0) {
      const position = lineTime / dur;
      seek(Math.max(0, Math.min(1, position)));
    }
  }
  import { lyricsData, activeLine } from "$lib/stores/lyrics";
  import {
    getAlbumArtSrc,
    getAlbum,
    getAlbumCoverSrc,
    getTrackCoverSrc,
    formatDuration,
  } from "$lib/api/tauri";
  import { onMount, tick } from "svelte";

  let albumArt: string | null = null;
  let lyricsContainer: HTMLDivElement;
  let isSeeking = false;

  // Combined reactive state for word-by-word sync
  const wordSyncState = derived(
    [lyricsData, currentTime, activeLine],
    ([$lyrics, $time, $activeLineIdx]) => {
      if (!$lyrics || $activeLineIdx < 0) {
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
    // Use the helper function that handles all cover sources
    const trackCover = getTrackCoverSrc($currentTrack);

    if (trackCover) {
      albumArt = trackCover;
    } else {
      albumArt = null;
    }
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
      ".lyric-line.active",
    ) as HTMLElement;
    if (!activeEl) return;

    // Cancel any ongoing scroll animation
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
    const duration = 600; // ms — smooth but not sluggish
    let startTime: number | null = null;

    function step(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(progress);

      lyricsContainer.scrollTop = startScroll + distance * eased;

      if (progress < 1) {
        scrollAnimationId = requestAnimationFrame(step);
      } else {
        scrollAnimationId = null;
      }
    }

    scrollAnimationId = requestAnimationFrame(step);
  }

  function handleSeekStart(e: MouseEvent) {
    isSeeking = true;
    handleSeek(e);
  }

  function handleSeek(e: MouseEvent) {
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, pos)));
  }

  onMount(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isSeeking) {
        const bar = document.querySelector(
          ".fullscreen-player .progress-bar",
        ) as HTMLDivElement;
        if (bar) {
          const rect = bar.getBoundingClientRect();
          const pos = (e.clientX - rect.left) / rect.width;
          seek(Math.max(0, Math.min(1, pos)));
        }
      }
    };

    const onMouseUp = () => {
      isSeeking = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  });
</script>

{#if $isFullScreen}
  <div class="fullscreen-player" transition:fade={{ duration: 300 }}>
    <!-- Apple Music-style animated blurred background -->
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
      <!-- Mobile: Spotify-style header with chevron down -->
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
    {:else}
      <!-- Desktop: corner close button -->
      <button
        class="close-btn"
        on:click={toggleFullScreen}
        aria-label="Close FullScreen"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
          <path
            d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
          />
        </svg>
      </button>
    {/if}

    <div class="player-content">
      <!-- Left Panel: Art & Controls -->
      <div class="left-panel">
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
          <h1 class="track-title">
            {$currentTrack?.title || "Unknown Title"}
          </h1>
          <span
            class="track-artist"
            role="button"
            tabindex="0"
            on:click={() => {
              if ($currentTrack?.artist) {
                toggleFullScreen();
                goToArtistDetail($currentTrack.artist);
              }
            }}
            on:keydown={(e) => {
              if (e.key === "Enter" && $currentTrack?.artist) {
                toggleFullScreen();
                goToArtistDetail($currentTrack.artist);
              }
            }}
          >
            {$currentTrack?.artist || "Unknown Artist"}
          </span>
        </div>

        <div class="player-controls">
          <div class="progress-bar-container">
            <span class="time">{formatDuration($currentTime)}</span>
            <div
              class="progress-bar"
              on:mousedown={handleSeekStart}
              on:touchstart|preventDefault={(e) => {
                isSeeking = true;
                const touch = e.touches[0];
                const bar = e.currentTarget;
                const rect = bar.getBoundingClientRect();
                const pos = (touch.clientX - rect.left) / rect.width;
                seek(Math.max(0, Math.min(1, pos)));
              }}
              on:touchmove|preventDefault={(e) => {
                if (isSeeking) {
                  const touch = e.touches[0];
                  const bar = e.currentTarget;
                  const rect = bar.getBoundingClientRect();
                  const pos = (touch.clientX - rect.left) / rect.width;
                  seek(Math.max(0, Math.min(1, pos)));
                }
              }}
              on:touchend={() => (isSeeking = false)}
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
            <button class="play-btn large" on:click={togglePlay}>
              {#if $isPlaying}
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="40"
                  height="40"
                >
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              {:else}
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="40"
                  height="40"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
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
              aria-label="Repeat: {$repeat}"
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
              {#if $repeat === "one"}
                <span class="repeat-one-badge">1</span>
              {/if}
            </button>
          </div>

          <!-- Secondary row: Lyrics toggle -->
          <div class="secondary-controls">
            <button
              class="secondary-btn"
              class:active={$lyricsVisible}
              on:click={toggleLyrics}
              aria-label="Lyrics"
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
              <span>Lyrics</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Right Panel: Lyrics -->
      <div class="right-panel">
        <div class="lyrics-container" bind:this={lyricsContainer}>
          {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
            {#each $lyricsData.lines as line, i}
              {@const distance = Math.abs(i - $activeLine)}
              {@const clampedDist = Math.min(distance, 6)}
              {@const hasWordSync = line.words && line.words.length > 0}
              {@const isActiveLine = i === $activeLine}
              <div
                class="lyric-line"
                class:active={isActiveLine}
                class:near={distance === 1}
                class:mid={distance === 2}
                class:far={distance >= 3}
                class:passed={i < $activeLine}
                class:word-sync={hasWordSync && isActiveLine}
                style="--line-distance: {clampedDist};"
                on:click={() => handleLineClick(line.time)}
                on:keydown={(e) =>
                  e.key === "Enter" && handleLineClick(line.time)}
                role="button"
                tabindex="0"
              >
                {#if hasWordSync && line.words}
                  {#each line.words as word, wordIdx}
                    {@const wordState = getWordState(
                      i,
                      wordIdx,
                      $activeLine,
                      $wordSyncState.activeWordIdx,
                    )}
                    {@const wordProgress =
                      isActiveLine && wordIdx === $wordSyncState.activeWordIdx
                        ? $wordSyncState.progress
                        : 0}
                    <span
                      class="lyric-word {wordState}"
                      style="--word-progress: {wordProgress}%;"
                      >{word.word}</span
                    >{#if wordIdx < line.words.length - 1}{" "}{/if}
                  {/each}
                {:else}
                  {line.text}
                {/if}
              </div>
            {/each}
          {:else}
            <div class="no-lyrics">
              <p>No lyrics available</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .fullscreen-player {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2000;
    background-color: #000;
    color: #fff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .bg-canvas {
    position: absolute;
    inset: -60%;
    width: 220%;
    height: 220%;
    z-index: -2;
    overflow: hidden;
  }

  .bg-layer {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    will-change: transform, opacity;
  }

  /* Mobile: GPU layer promotion and containment for backgrounds */
  @media (max-width: 768px) {
    .bg-canvas {
      contain: strict;
      isolation: isolate;
    }

    .bg-layer {
      transform: translateZ(0);
      backface-visibility: hidden;
    }
  }

  .bg-layer-1 {
    filter: blur(80px) saturate(2.5) brightness(0.45);
    transform-origin: 30% 30%;
    animation: bgDrift1 22s ease-in-out infinite alternate;
  }

  .bg-layer-2 {
    filter: blur(100px) saturate(2) brightness(0.38);
    opacity: 0.8;
    transform-origin: 70% 60%;
    animation: bgDrift2 28s ease-in-out infinite alternate;
  }

  .bg-layer-3 {
    filter: blur(60px) saturate(3) brightness(0.42);
    opacity: 0.6;
    mix-blend-mode: screen;
    transform-origin: 50% 80%;
    animation: bgDrift3 18s ease-in-out infinite alternate;
  }

  @keyframes bgDrift1 {
    0% {
      transform: translate(0, 0) scale(1) rotate(0deg);
    }
    20% {
      transform: translate(15%, -10%) scale(1.15) rotate(2deg);
    }
    40% {
      transform: translate(-10%, 18%) scale(1.05) rotate(-1deg);
    }
    60% {
      transform: translate(8%, 12%) scale(1.2) rotate(3deg);
    }
    80% {
      transform: translate(-18%, -8%) scale(1.1) rotate(-2deg);
    }
    100% {
      transform: translate(12%, -15%) scale(1) rotate(1deg);
    }
  }

  @keyframes bgDrift2 {
    0% {
      transform: translate(0, 0) scale(1.1) rotate(0deg);
    }
    25% {
      transform: translate(-20%, 12%) scale(1) rotate(-3deg);
    }
    50% {
      transform: translate(15%, -18%) scale(1.2) rotate(2deg);
    }
    75% {
      transform: translate(-8%, -15%) scale(1.08) rotate(-1deg);
    }
    100% {
      transform: translate(18%, 10%) scale(1.12) rotate(3deg);
    }
  }

  @keyframes bgDrift3 {
    0% {
      transform: translate(10%, 5%) scale(1.05) rotate(0deg);
    }
    33% {
      transform: translate(-15%, -20%) scale(1.25) rotate(-4deg);
    }
    66% {
      transform: translate(20%, 12%) scale(1) rotate(3deg);
    }
    100% {
      transform: translate(-10%, 18%) scale(1.15) rotate(-2deg);
    }
  }

  .backdrop-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(
      ellipse at center,
      rgba(0, 0, 0, 0.25) 0%,
      rgba(0, 0, 0, 0.55) 100%
    );
    z-index: -1;
  }

  .close-btn {
    position: absolute;
    top: var(--spacing-lg);
    right: var(--spacing-lg);
    color: rgba(255, 255, 255, 0.8);
    z-index: 10;
    opacity: 0.7;
    transition: opacity var(--transition-fast);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
  }

  .close-btn:hover {
    opacity: 1;
    color: #fff;
  }

  .player-content {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: var(--spacing-xl);
    gap: var(--spacing-md);
    max-width: 1600px;
    margin: 0 auto;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    align-items: center;
    overflow: hidden;
  }

  .left-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--spacing-lg);
    padding-left: var(--spacing-xl);
    height: 100%;
    max-height: calc(100vh - var(--spacing-xl) * 2);
    overflow: hidden;
  }

  .art-container {
    width: 100%;
    max-width: min(400px, 45vh);
    aspect-ratio: 1;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    background-color: var(--bg-surface);
    flex-shrink: 0;
  }

  .art-container img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .art-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
  }

  .track-info {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }

  .track-title {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
    font-weight: 800;
    line-height: 1.1;
    color: #fff;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
  }

  .track-artist {
    font-size: clamp(1rem, 2vw, 1.25rem);
    color: rgba(255, 255, 255, 0.75);
    font-weight: 500;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
  }

  .player-controls {
    width: 100%;
    max-width: min(400px, 45vh);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    flex-shrink: 0;
  }

  /* progress-bar*/
  .progress-bar-container {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    width: 100%;
  }

  .progress-bar {
    flex: 1;
    height: 12px;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
  }

  .progress-track {
    width: 100%;
    height: 4px;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background-color: rgba(255, 255, 255, 0.7);
    border-radius: var(--radius-full);
    transition: background-color var(--transition-fast);
  }

  .progress-bar:hover .progress-fill {
    background-color: var(--accent-primary);
  }

  .progress-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    background-color: #fff;
    border-radius: var(--radius-full);
    transform: translateX(-50%) scale(0);
    transition: transform var(--transition-fast);
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
  }

  .progress-bar:hover .progress-thumb {
    transform: translateX(-50%) scale(1);
  }

  .time {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.6);
    min-width: 40px;
    text-align: center;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }

  .buttons {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xl);
  }

  .icon-btn.large {
    width: 48px;
    height: 48px;
    color: rgba(255, 255, 255, 0.85);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  .icon-btn.large:hover {
    color: #fff;
  }

  /*play-btn */
  .play-btn.large {
    width: 64px;
    height: 64px;
    background-color: rgba(255, 255, 255, 0.95);
    color: #000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }

  .play-btn.large:hover {
    transform: scale(1.08);
    background-color: #fff;
  }

  /* Right Panel (Lyrics) */
  .right-panel {
    height: 100%;
    max-height: 80vh;
    overflow: hidden;
    mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      black 10%,
      black 88%,
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      black 10%,
      black 88%,
      transparent 100%
    );
  }

  .lyrics-container {
    display: flex;
    flex-direction: column;
    padding: 42vh 0;
    height: 100%;
    overflow-y: auto;
    -ms-overflow-style: none;
    scrollbar-width: none;
    gap: 2px;
  }

  .lyrics-container::-webkit-scrollbar {
    display: none;
  }

  /* Mobile: containment for lyrics container */
  @media (max-width: 768px) {
    .lyrics-container {
      contain: content;
      will-change: scroll-position;
    }
  }

  .lyric-line {
    --line-distance: 6;
    font-size: 2rem;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.25);
    padding: 16px 0;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    /* Apple Music spring-like curve: slight overshoot */
    transition:
      transform 0.55s cubic-bezier(0.175, 0.885, 0.32, 1.275),
      color 0.45s cubic-bezier(0.25, 0.1, 0.25, 1),
      filter 0.5s cubic-bezier(0.25, 0.1, 0.25, 1),
      opacity 0.45s cubic-bezier(0.25, 0.1, 0.25, 1),
      text-shadow 0.5s ease;
    filter: blur(calc(var(--line-distance) * 0.7px));
    opacity: calc(1 - var(--line-distance) * 0.12);
    transform: scale(0.95) translateY(0);
    transform-origin: left center;
    cursor: pointer;
    line-height: 1.5;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
    letter-spacing: -0.01em;
  }

  /* Mobile: performance optimizations for lyric lines */
  @media (max-width: 768px) {
    .lyric-line {
      /* Containment isolates repaint regions */
      contain: layout style paint;
      /* Skip rendering off-screen lines */
      content-visibility: auto;
      contain-intrinsic-size: auto 60px;
      /* Remove filter from transition - use instant blur class changes */
      transition:
        transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1),
        opacity 0.35s ease;
    }

    /* Force visible for active and nearby lines */
    .lyric-line.active,
    .lyric-line.near,
    .lyric-line.mid {
      content-visibility: visible;
    }
  }

  .lyric-line:hover {
    color: rgba(255, 255, 255, 0.5);
    filter: blur(0px);
    opacity: 1;
  }

  /* Distance-based depth — progressive blur & fade */
  .lyric-line.near {
    color: rgba(255, 255, 255, 0.4);
    filter: blur(0.5px);
    opacity: 0.85;
    transform: scale(0.97);
  }

  .lyric-line.mid {
    color: rgba(255, 255, 255, 0.25);
    filter: blur(1.5px);
    opacity: 0.6;
    transform: scale(0.95);
  }

  .lyric-line.far {
    color: rgba(255, 255, 255, 0.15);
    filter: blur(calc(var(--line-distance) * 0.7px));
    opacity: calc(0.55 - var(--line-distance) * 0.06);
    transform: scale(0.93);
  }

  /* Active line: scale up, glow, no blur */
  .lyric-line.active {
    color: #fff;
    filter: blur(0px);
    opacity: 1;
    transform: scale(1) translateY(0);
    text-shadow:
      0 0 30px rgba(255, 255, 255, 0.25),
      0 0 60px rgba(255, 255, 255, 0.1),
      0 2px 10px rgba(0, 0, 0, 0.4);
  }

  /* Mobile: fixed blur values instead of calc() for better caching */
  @media (max-width: 768px) {
    .lyric-line.near {
      filter: blur(0.5px);
    }

    .lyric-line.mid {
      filter: blur(1.5px);
    }

    .lyric-line.far {
      filter: blur(3px);
      opacity: 0.35;
    }

    .lyric-line.active {
      /* Simplified text-shadow: single layer instead of 3 */
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    }

    .lyric-line.passed.far {
      filter: blur(3px);
      opacity: 0.25;
    }
  }

  /* Passed lines mirror future but slightly more faded */
  .lyric-line.passed.near {
    color: rgba(255, 255, 255, 0.35);
    opacity: 0.75;
    filter: blur(1px);
    transform: scale(0.96);
  }

  .lyric-line.passed.mid {
    color: rgba(255, 255, 255, 0.2);
    opacity: 0.5;
    filter: blur(2px);
    transform: scale(0.94);
  }

  .lyric-line.passed.far {
    color: rgba(255, 255, 255, 0.12);
    opacity: calc(0.45 - var(--line-distance) * 0.06);
    filter: blur(calc(var(--line-distance) * 0.8px));
    transform: scale(0.92);
  }

  /* Word highlighting - Apple Music style */
  .lyric-word {
    --word-progress: 0%;
    --highlight-color: #fff;
    --future-color: rgba(255, 255, 255, 0.3);
    display: inline;
    color: transparent;
    background-clip: text;
    -webkit-background-clip: text;
    background-size: 200% 100%;
    will-change: background-position;
    transition: text-shadow 0.2s ease;
  }

  /* Mobile: containment and GPU optimization for words */
  @media (max-width: 768px) {
    .lyric-word {
      contain: layout style;
      /* Remove text-shadow transition on mobile */
      transition: none;
    }

    .lyric-line.word-sync .lyric-word.highlighted {
      /* Simplified: no text-shadow glow on mobile */
      text-shadow: none;
    }
  }

  /* Active word being filled — soft gradient edge (8% feather) */
  .lyric-line.word-sync .lyric-word.highlighted {
    background-image: linear-gradient(
      to right,
      var(--highlight-color) 0%,
      var(--highlight-color) calc(var(--word-progress) - 4%),
      var(--future-color) calc(var(--word-progress) + 4%),
      var(--future-color) 100%
    );
    text-shadow: 0 0 16px rgba(255, 255, 255, 0.2);
  }

  .lyric-line.word-sync .lyric-word.past {
    background-image: linear-gradient(
      to right,
      var(--highlight-color) 0%,
      var(--highlight-color) 100%
    );
  }

  .lyric-line.word-sync .lyric-word.future {
    background-image: linear-gradient(
      to right,
      var(--future-color) 0%,
      var(--future-color) 100%
    );
  }

  /* Past lines - all words fully highlighted */
  .lyric-line.passed .lyric-word {
    background-image: linear-gradient(
      to right,
      var(--highlight-color) 0%,
      var(--highlight-color) 100%
    );
  }

  /* Future lines - all words dimmed */
  .lyric-line:not(.active):not(.passed) .lyric-word {
    background-image: linear-gradient(
      to right,
      var(--future-color) 0%,
      var(--future-color) 100%
    );
  }

  .no-lyrics {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.5rem;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
  }

  /* ── Shuffle / Repeat buttons ── */
  .icon-btn.shuffle-repeat {
    width: 36px;
    height: 36px;
    color: rgba(255, 255, 255, 0.5);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
    position: relative;
    transition: color 0.2s ease;
  }

  .icon-btn.shuffle-repeat.active {
    color: #1db954;
  }

  .repeat-one-badge {
    position: absolute;
    font-size: 0.55rem;
    font-weight: 700;
    color: #1db954;
    bottom: 2px;
    right: 2px;
  }

  /* ── Secondary controls row (Lyrics, etc.) ── */
  .secondary-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-lg);
    margin-top: var(--spacing-xs);
  }

  .secondary-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.75rem;
    font-weight: 500;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    transition: all 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .secondary-btn.active {
    color: #1db954;
  }

  .secondary-btn:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  /* ── Mobile header (chevron + Now Playing) ── */
  .mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top));
    position: relative;
    z-index: 10;
    flex-shrink: 0;
  }

  .chevron-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.8);
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 50%;
    -webkit-tap-highlight-color: transparent;
    transition: opacity 0.15s ease;
  }

  .chevron-btn:active {
    opacity: 0.5;
  }

  .now-playing-label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Track artist is tappable */
  .track-artist {
    cursor: pointer;
  }

  .track-artist:hover {
    text-decoration: underline;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .fullscreen-player {
      /* Ensure it covers safe areas */
      padding-bottom: env(safe-area-inset-bottom);
    }

    .player-content {
      grid-template-columns: 1fr;
      padding: 0 var(--spacing-lg);
      padding-top: 0;
      gap: var(--spacing-md);
      overflow-y: auto;
      align-items: start;
    }

    .left-panel {
      align-items: center;
      padding-left: 0;
      height: auto;
      max-height: none;
      gap: var(--spacing-md);
    }

    .art-container {
      max-width: min(320px, 75vw);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .track-info {
      text-align: center;
      align-items: center;
      width: 100%;
    }

    .track-title {
      font-size: 1.35rem;
      font-weight: 700;
    }

    .track-artist {
      font-size: 0.95rem;
      color: rgba(255, 255, 255, 0.7);
    }

    .player-controls {
      max-width: 100%;
      align-items: center;
    }

    .progress-bar-container {
      width: 100%;
    }

    .progress-track {
      height: 4px;
    }

    .progress-fill {
      background-color: #1db954;
    }

    .progress-thumb {
      transform: translateX(-50%) scale(1);
      width: 12px;
      height: 12px;
    }

    .buttons {
      gap: var(--spacing-md);
      width: 100%;
      justify-content: space-between;
      max-width: 320px;
    }

    .play-btn.large {
      width: 60px;
      height: 60px;
      background-color: #fff;
      color: #000;
    }

    .icon-btn.large {
      width: 44px;
      height: 44px;
    }

    .right-panel {
      max-height: 30vh;
      margin-top: var(--spacing-md);
    }

    .lyrics-container {
      padding: 10vh 0;
    }

    .lyric-line {
      font-size: 1.25rem;
    }

    .close-btn {
      top: var(--spacing-md);
      right: var(--spacing-md);
    }

    .close-btn svg {
      width: 28px;
      height: 28px;
    }
  }
</style>
