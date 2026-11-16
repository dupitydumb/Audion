<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { getAudioTelemetry, type AudioTelemetry } from "$lib/api/tauri";
  import { currentTrack, activeBackend } from "$lib/stores/player";
  import { isTauri } from "$lib/api/tauri";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  export let onClose: () => void = () => { open = false; };

  let telemetry: AudioTelemetry | null = null;
  let intervalId: any = null;
  let isClosing = false;

  async function updateTelemetry() {
    if (!open) return;
    try {
      if (isTauri()) {
        telemetry = await getAudioTelemetry();
      }
    } catch (e) {
      // Audio engine may be initializing or stopped
    }
  }

  $: if (open) {
    updateTelemetry();
    if (!intervalId) {
      intervalId = setInterval(updateTelemetry, 1000);
    }
  } else {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });

  function formatSampleRate(hz: number): string {
    if (!hz) return "44.1 kHz";
    if (hz >= 1000) {
      return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz (${hz.toLocaleString()} Hz)`;
    }
    return `${hz} Hz`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div class="stats-hud-wrapper" transition:scale={{ duration: 180, start: 0.95 }}>
    <div class="stats-hud-card">
      <!-- Header -->
      <div class="hud-header">
        <div class="hud-title-group">
          <span class="hud-badge">HUD</span>
          <span class="hud-title">Stats for Nerds</span>
        </div>
        <button class="btn-hud-close" on:click={onClose} aria-label="Close Stats HUD">
          <Icon name="x" size={14} />
        </button>
      </div>

      <!-- Live Specs Table -->
      <div class="hud-body">
        <!-- Track Title / Path -->
        {#if $currentTrack}
          <div class="hud-row">
            <span class="hud-label">Track</span>
            <span class="hud-val truncate">{$currentTrack.title} — {$currentTrack.artist}</span>
          </div>
        {/if}

        <!-- Audio Backend -->
        <div class="hud-row">
          <span class="hud-label">Backend</span>
          <span class="hud-val accent-val">
            {$activeBackend === 'native' ? 'Rust Rodio (Native)' : 'WebAudio / HTML5'}
          </span>
        </div>

        <!-- Codec & Container -->
        <div class="hud-row">
          <span class="hud-label">Codec</span>
          <span class="hud-val pill-val highlight">
            {telemetry?.codec || ($currentTrack?.format?.toUpperCase()) || 'Unknown'}
          </span>
        </div>

        <!-- Bit Depth -->
        <div class="hud-row">
          <span class="hud-label">Bit Depth</span>
          <span class="hud-val mono-val">
            {telemetry?.bit_depth ? `${telemetry.bit_depth}-bit` : '16-bit PCM'}
          </span>
        </div>

        <!-- Source Sample Rate -->
        <div class="hud-row">
          <span class="hud-label">Source Rate</span>
          <span class="hud-val mono-val">
            {formatSampleRate(telemetry?.sample_rate || 44100)}
          </span>
        </div>

        <!-- Device Output Rate -->
        <div class="hud-row">
          <span class="hud-label">Output Clock</span>
          <span class="hud-val mono-val">
            {formatSampleRate(telemetry?.device_sample_rate || 44100)}
          </span>
        </div>

        <!-- Resampler Status -->
        <div class="hud-row">
          <span class="hud-label">Resampling</span>
          {#if telemetry?.resampler_active}
            <span class="hud-val warn-val">Rubato Sinc Resampling</span>
          {:else}
            <span class="hud-val ok-val">Direct 1:1 (Bit-Perfect)</span>
          {/if}
        </div>

        <!-- Channels -->
        <div class="hud-row">
          <span class="hud-label">Channels</span>
          <span class="hud-val mono-val">
            {telemetry?.channels || 2} {telemetry?.channels === 1 ? '(Mono)' : '(Stereo)'}
          </span>
        </div>

        <!-- Bitrate -->
        {#if $currentTrack?.bitrate}
          <div class="hud-row">
            <span class="hud-label">Bitrate</span>
            <span class="hud-val mono-val">{$currentTrack.bitrate} kbps</span>
          </div>
        {/if}

        <!-- Safety Limiter -->
        <div class="hud-row">
          <span class="hud-label">Peak Limiter</span>
          <span class="hud-val mono-val">
            {telemetry?.limiter_enabled !== false ? 'Active (Lookahead)' : 'Bypassed'}
          </span>
        </div>

        <!-- Exclusive / Bit-Perfect Mode -->
        <div class="hud-row">
          <span class="hud-label">DAC Exclusive</span>
          {#if telemetry?.exclusive_mode}
            <span class="hud-val ok-val">Active (Bit-Perfect)</span>
          {:else}
            <span class="hud-val mono-val">Standard (Shared)</span>
          {/if}
        </div>

        <!-- ReplayGain -->
        <div class="hud-row">
          <span class="hud-label">ReplayGain</span>
          <span class="hud-val mono-val">
            {telemetry?.replay_gain_db ? `${telemetry.replay_gain_db.toFixed(1)} dB` : 'Unity (0.0 dB)'}
          </span>
        </div>

        <!-- Active Sink -->
        <div class="hud-row">
          <span class="hud-label">Output Device</span>
          <span class="hud-val truncate mono-val">
            {telemetry?.output_device || 'System Default Sink'}
          </span>
        </div>
      </div>

      <!-- Footer Shortcut Hint -->
      <div class="hud-footer">
        <span>Toggle shortcut: <kbd>Ctrl</kbd> + <kbd>I</kbd></span>
      </div>
    </div>
  </div>
{/if}

<style>
  .stats-hud-wrapper {
    position: fixed;
    top: 54px;
    right: 20px;
    z-index: 9999;
    max-width: 340px;
    width: calc(100vw - 40px);
    pointer-events: auto;
  }

  .stats-hud-card {
    background: rgba(18, 18, 22, 0.88);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
    color: var(--text-primary, #ffffff);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }

  .hud-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .hud-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hud-badge {
    background: var(--accent-primary, #1db954);
    color: #000;
    font-size: 0.625rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .hud-title {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.95);
  }

  .btn-hud-close {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-hud-close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .hud-body {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.75rem;
  }

  .hud-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .hud-label {
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.7188rem;
    white-space: nowrap;
  }

  .hud-val {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.7188rem;
    color: rgba(255, 255, 255, 0.9);
    text-align: right;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .highlight {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }

  .accent-val {
    color: var(--accent-primary, #1db954);
    font-weight: 500;
  }

  .ok-val {
    color: #4ade80;
    font-weight: 500;
  }

  .warn-val {
    color: #fbbf24;
    font-weight: 500;
  }

  .hud-footer {
    padding: 6px 14px;
    background: rgba(0, 0, 0, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
  }

  kbd {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.625rem;
    font-family: inherit;
  }
</style>
