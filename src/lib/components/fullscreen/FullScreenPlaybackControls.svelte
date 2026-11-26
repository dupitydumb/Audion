<script lang="ts">
  import { get } from "svelte/store";
  import { iconPopTransition } from "$lib/motion";
  import {
    progress,
    currentTime,
    duration,
    shuffle,
    repeat,
    isPlaying,
    isTrackLoading,
    volume,
    toggleShuffle,
    previousTrack,
    togglePlay,
    nextTrack,
    cycleRepeat,
    seek,
    setVolume,
  } from "$lib/stores/player";
  import Icon from "$lib/components/Icon.svelte";
  import { formatDuration } from "$lib/api/tauri";
  import { appSettings } from "$lib/stores/settings";

  let isSeeking = false;

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
    setVolume(Math.max(0, Math.min(1, pos)));
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
      setVolume(Math.min(1, current + VOLUME_STEP));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setVolume(Math.max(0, current - VOLUME_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setVolume(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setVolume(1);
    }
  }
</script>

<div class="desktop-playback-area">
  <div class="desktop-progress-container">
    <div
      class="desktop-progress-bar"
      class:active-seeking={isSeeking}
      on:pointerdown={handleSeekPointerDown}
      on:pointermove={handleSeekPointerMove}
      on:pointerup={handleSeekPointerUp}
      on:pointercancel={handleSeekPointerUp}
      on:keydown={handleSeekKeydown}
      role="slider"
      aria-label="Seek track"
      aria-valuenow={Math.round($progress * 100)}
      aria-valuemin="0"
      aria-valuemax="100"
      tabindex="0"
    >
      <div class="progress-track" class:loading={$isTrackLoading}>
        <div
          class="progress-fill"
          style="width: {$progress * 100}%"
        >
          <div class="progress-shimmer"></div>
        </div>
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
        class="progress-thumb-dot"
        style="left: {$progress * 100}%"
      ></div>
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
    >
      {#key $shuffle}
        <span class="icon-pop" in:iconPopTransition>
          <Icon name="shuffle" size={18} />
        </span>
      {/key}
    </button>
    <button
      class="control-btn secondary"
      on:click={previousTrack}
      aria-label="Previous"
    >
      <Icon name="skip-back" size={22} />
    </button>
    <button
      class="control-btn play-pause-main"
      on:click={togglePlay}
      aria-label={$isPlaying ? "Pause" : "Play"}
    >
      <Icon name={$isPlaying ? "pause" : "play"} size={32} />
    </button>
    <button
      class="control-btn secondary"
      on:click={nextTrack}
      aria-label="Next"
    >
      <Icon name="skip-forward" size={22} />
    </button>
    <button
      class="control-btn"
      class:track-active={$repeat !== "none"}
      on:click={cycleRepeat}
      aria-label="Repeat"
    >
      {#key $repeat}
        <span class="icon-pop" in:iconPopTransition>
          <Icon name={$repeat === "one" ? "repeat-1" : "repeat"} size={18} />
        </span>
      {/key}
      {#if $repeat === "one"}<span class="repeat-indicator">1</span>{/if}
    </button>
  </div>

  <div class="desktop-volume-row">
    <button
      class="volume-mute-btn"
      on:click={() => setVolume($volume > 0 ? 0 : 1)}
      aria-label={$volume > 0 ? "Mute" : "Unmute"}
    >
      {#if $volume === 0}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          class="volume-icon"
          ><path
            d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
          /></svg
        >
      {:else if $volume < 0.5}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          class="volume-icon"
          ><path
            d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"
          /></svg
        >
      {:else}
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
        <div class="volume-fill" style="width: {$volume * 100}%"></div>
      </div>
      <div class="volume-thumb" style="left: {$volume * 100}%"></div>
    </div>
  </div>
</div>

<style>
  .desktop-playback-area {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .desktop-progress-container {
    margin-bottom: 1rem;
    width: 100%;
  }

  .desktop-progress-bar {
    width: 100%;
    height: 24px;
    display: flex;
    align-items: center;
    position: relative;
    cursor: pointer;
    touch-action: none;
    margin-bottom: 0.4rem;
  }

  .progress-track {
    width: 100%;
    height: 4px;
    background: var(--fs-surface-hover, rgba(255, 255, 255, 0.2));
    overflow: hidden;
    border-radius: 9999px;
    position: relative;
    transition: height 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .automix-cue-zone {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    background: linear-gradient(to right, transparent, color-mix(in srgb, var(--accent-primary) 42%, transparent));
    border-left: 1.5px solid color-mix(in srgb, var(--accent-primary) 80%, #ffffff);
    pointer-events: none;
    border-radius: 0 9999px 9999px 0;
  }

  .desktop-progress-bar:hover .progress-track,
  .desktop-progress-bar.active-seeking .progress-track {
    height: 8px;
  }

  .progress-track.loading::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--accent-primary) 65%, transparent) 50%,
      transparent 100%
    );
    animation: fs-desktop-loading-shimmer 1.15s ease-in-out infinite;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--accent-primary) 0%,
      color-mix(in srgb, var(--accent-primary) 70%, var(--fs-text, #ffffff)) 50%,
      var(--accent-primary) 100%
    );
    background-size: 200% 100%;
    border-radius: 9999px;
    position: relative;
    transition: width 100ms linear;
  }

  .desktop-progress-bar.active-seeking .progress-fill {
    transition: none;
  }

  .progress-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.28) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: fs-desktop-shimmer-sheen 3.2s infinite linear;
  }

  @keyframes fs-desktop-shimmer-sheen {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes fs-desktop-loading-shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  .progress-thumb-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--fs-text, #ffffff);
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) scale(1);
    pointer-events: none;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5), 0 0 8px var(--accent-primary);
    transition: transform 180ms var(--ease-spring-snappy, cubic-bezier(0.34, 1.56, 0.64, 1)),
                box-shadow 180ms ease;
  }

  .desktop-progress-bar:hover .progress-thumb-dot,
  .desktop-progress-bar.active-seeking .progress-thumb-dot {
    box-shadow: 0 0 14px rgba(0, 0, 0, 0.6), 0 0 12px var(--accent-primary);
    transform: translate(-50%, -50%) scale(1.42);
  }

  .time-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--fs-text-subdued, rgba(255, 255, 255, 0.45));
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .desktop-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    margin-bottom: 0.6rem;
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--fs-text-subdued, rgba(255, 255, 255, 0.45));
    cursor: pointer;
    transition: transform 150ms var(--ease-spring-snappy), opacity 150ms ease, color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 44px;
    height: 44px;
  }

  .control-btn:hover {
    color: var(--fs-text, #ffffff);
    transform: scale(1.1);
  }

  .control-btn:active {
    transform: scale(0.88);
    opacity: 0.78;
  }

  .icon-pop {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .control-btn.secondary {
    color: var(--fs-text-muted, rgba(255, 255, 255, 0.75));
  }

  .control-btn.play-pause-main {
    width: 56px;
    height: 56px;
    background: var(--fs-text, #ffffff);
    color: #000000;
    border-radius: 50%;
  }

  .control-btn.play-pause-main:hover {
    transform: scale(1.08);
  }

  .control-btn.play-pause-main:active {
    transform: scale(0.92);
    opacity: 0.9;
  }

  .control-btn.track-active {
    color: var(--accent-primary);
  }

  .repeat-indicator {
    position: absolute;
    top: 2px;
    right: 0;
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
  }

  .desktop-volume-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    width: 100%;
    max-width: 280px;
    margin: 1rem auto 0;
    opacity: 0.6;
    transition: opacity 0.3s;
  }

  .desktop-volume-row:hover {
    opacity: 1;
  }

  .volume-icon {
    color: var(--fs-text-muted, rgba(255, 255, 255, 0.7));
    flex-shrink: 0;
  }

  .volume-mute-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    min-width: 36px;
    min-height: 36px;
    flex-shrink: 0;
    cursor: pointer;
  }

  /* same as the main playerbar's volume-bar */
  .volume-bar {
    flex: 1;
    height: 24px;
    display: flex;
    align-items: center;
    position: relative;
    cursor: pointer;
    touch-action: none;
  }

  .volume-track {
    width: 100%;
    height: 3px;
    background-color: var(--fs-surface, rgba(255, 255, 255, 0.15));
    border-radius: 1.5px;
    overflow: hidden;
  }

  .volume-fill {
    height: 100%;
    background-color: var(--fs-text, #ffffff);
    border-radius: 1.5px;
  }

  .volume-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    background-color: var(--fs-text, #ffffff);
    border-radius: 50%;
    transform: translateX(-50%) scale(0);
    transition: transform 0.2s;
    top: 50%;
    margin-top: -6px;
  }

  .volume-bar:hover .volume-thumb {
    transform: translateX(-50%) scale(1);
  }
</style>