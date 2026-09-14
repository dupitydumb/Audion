<script lang="ts">
  import { get } from "svelte/store";
  import {
    progress,
    currentTime,
    duration,
    shuffle,
    repeat,
    isPlaying,
    volume,
    toggleShuffle,
    previousTrack,
    togglePlay,
    nextTrack,
    cycleRepeat,
    seek,
  } from "$lib/stores/player";
  import Icon from "$lib/components/Icon.svelte";
  import { formatDuration } from "$lib/api/tauri";

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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }

  function handleVolumeChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    volume.set(val);
  }
</script>

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
      <Icon name="shuffle" size={18} />
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
      <Icon name={$repeat === "one" ? "repeat-1" : "repeat"} size={18} />
      {#if $repeat === "one"}<span class="repeat-indicator">1</span>{/if}
    </button>
  </div>

  <div class="desktop-volume-row">
    <Icon
      name={$volume === 0 ? "volume-x" : $volume < 0.5 ? "volume-1" : "volume-2"}
      size={18}
      className="volume-icon"
    />
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={$volume}
      on:input={handleVolumeChange}
      class="volume-slider"
      style="background: linear-gradient(to right, rgba(255, 255, 255, 0.6) {$volume * 100}%, rgba(255, 255, 255, 0.15) {$volume * 100}%);"
      aria-label="Volume"
    />
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
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    position: relative;
    cursor: pointer;
    margin-bottom: 0.75rem;
  }

  .progress-track {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 2px;
  }

  .progress-fill {
    height: 100%;
    background: #ffffff;
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .desktop-progress-bar:hover .progress-fill {
    background: #fff;
  }

  .progress-thumb-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }

  .desktop-progress-bar:hover .progress-thumb-dot {
    box-shadow: 0 0 16px var(--accent-primary, #1DB954);
    transform: translate(-50%, -50%) scale(1.4);
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
    gap: 28px;
    margin-bottom: 0.6rem;
  }

  .control-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.35);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 44px;
    height: 44px;
  }

  .control-btn:hover {
    color: #fff;
    transform: scale(1.1);
  }

  .control-btn.secondary {
    color: rgba(255, 255, 255, 0.75);
  }

  .control-btn.play-pause-main {
    width: 56px;
    height: 56px;
    background: #fff;
    color: #000;
    border-radius: 50%;
  }

  .control-btn.play-pause-main:hover {
    transform: scale(1.08);
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
    gap: 0.9rem;
    width: 100%;
    max-width: 280px;
    margin: 1rem auto 0;
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
    height: 3px;
    border-radius: 1.5px;
    outline: none;
    cursor: pointer;
    transition: background 0.1s ease;
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
</style>
