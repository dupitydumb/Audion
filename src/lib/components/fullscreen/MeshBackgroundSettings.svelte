<script lang="ts">
  import { fly } from "svelte/transition";
  import { meshSettings } from "$lib/stores/meshSettings";
  import { lyricsRenderMode } from "$lib/stores/lyrics";

  export let onClose: () => void = () => {};
</script>

<div class="mesh-settings-panel" transition:fly={{ y: 12, duration: 180 }}>
  <div class="panel-header">
    <span class="panel-title">Background</span>
    <button class="close-btn" on:click={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M18.3 5.71L12 12.01l-6.3-6.3-1.41 1.42 6.3 6.29-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z" />
      </svg>
    </button>
  </div>

  <label class="row toggle-row">
    <span>Animated mesh</span>
    <span class="switch">
      <input type="checkbox" bind:checked={$meshSettings.enabled} />
      <span class="switch-track"><span class="switch-thumb"></span></span>
    </span>
  </label>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Speed</span>
    <input
      type="range"
      min="0.25"
      max="2.5"
      step="0.05"
      bind:value={$meshSettings.speed}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Blur</span>
    <input
      type="range"
      min="0"
      max="100"
      step="1"
      bind:value={$meshSettings.blur}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Opacity</span>
    <input
      type="range"
      min="0.1"
      max="1"
      step="0.05"
      bind:value={$meshSettings.opacity}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Saturation</span>
    <input
      type="range"
      min="0.5"
      max="4"
      step="0.05"
      bind:value={$meshSettings.saturation}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Quality <em class:warn={$meshSettings.quality > 160}>{$meshSettings.quality}px</em></span>
    <input
      type="range"
      min="16"
      max="256"
      step="8"
      bind:value={$meshSettings.quality}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Spread</span>
    <input
      type="range"
      min="0.05"
      max="0.4"
      step="0.01"
      bind:value={$meshSettings.spread}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <div class="row" class:disabled={!$meshSettings.enabled}>
    <span>Sharpness</span>
    <input
      type="range"
      min="1.5"
      max="8"
      step="0.1"
      bind:value={$meshSettings.sharpness}
      disabled={!$meshSettings.enabled}
    />
  </div>

  <button class="reset-btn" on:click={() => meshSettings.reset()}>
    Reset to defaults
  </button>

  <div class="divider"></div>

  <label class="row toggle-row">
    <span>Dynamic lyrics layout</span>
    <span class="switch">
      <input
        type="checkbox"
        checked={$lyricsRenderMode === 'dynamic'}
        on:change={(e) =>
          lyricsRenderMode.set(e.currentTarget.checked ? 'dynamic' : 'legacy')}
      />
      <span class="switch-track"><span class="switch-thumb"></span></span>
    </span>
  </label>
</div>

<style>
  .mesh-settings-panel {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 240px;
    padding: 12px 14px 14px;
    border-radius: 12px;
    background: rgba(20, 20, 20, 0.72);
    backdrop-filter: blur(20px) saturate(1.6);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    color: #fff;
    z-index: 50;
    font-size: 12px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .panel-title {
    font-weight: 600;
    font-size: 12.5px;
    letter-spacing: 0.02em;
    opacity: 0.9;
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    padding: 2px;
    border-radius: 6px;
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 0;
    opacity: 1;
    transition: opacity 0.15s ease;
  }

  .row.disabled {
    opacity: 0.4;
  }

  .divider {
    height: 1px;
    margin: 10px 0 4px;
    background: rgba(255, 255, 255, 0.08);
  }

  .row span {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.75);
  }

  .row span em {
    font-style: normal;
    color: rgba(255, 255, 255, 0.4);
    font-size: 10.5px;
    margin-left: 2px;
  }

  .row span em.warn {
    color: rgba(255, 176, 90, 0.9);
  }

  .row input[type="range"] {
    flex: 1;
    accent-color: #fff;
    width: 110px;
  }

  .switch {
    position: relative;
    display: inline-flex;
    width: 34px;
    height: 20px;
    flex: 0 0 auto;
  }

  .switch input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 1;
  }

  .switch-track {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: background 0.18s ease;
  }

  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    transition: transform 0.18s ease;
  }

  .switch input:checked ~ .switch-track {
    background: #4a9eff;
  }

  .switch input:checked ~ .switch-track .switch-thumb {
    transform: translateX(14px);
  }

  .switch input:focus-visible ~ .switch-track {
    outline: 2px solid rgba(255, 255, 255, 0.6);
    outline-offset: 2px;
  }

  .reset-btn {
    margin-top: 10px;
    width: 100%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    border-radius: 8px;
    padding: 6px 0;
    font-size: 11.5px;
    cursor: pointer;
  }

  .reset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
</style>