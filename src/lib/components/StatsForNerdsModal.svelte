<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { getAudioTelemetry, type AudioTelemetry } from "$lib/api/tauri";
  import { currentTrack, activeBackend } from "$lib/stores/player";
  import { isTauri } from "$lib/api/tauri";
  import Icon from "$lib/components/Icon.svelte";
  import { providerTelemetryStore, globalProviders, type ProviderTelemetryEntry } from "$lib/plugins/providers";

  export let open: boolean = false;
  export let onClose: () => void = () => { open = false; };

  let telemetry: AudioTelemetry | null = null;
  let intervalId: any = null;
  let isClosing = false;
  let activeTab: 'audio' | 'providers' = 'audio';
  let pingingId: string | null = null;

  async function handlePing(item: ProviderTelemetryEntry) {
    if (pingingId) return;
    pingingId = item.id;
    try {
      await globalProviders.pingProvider(item.type, item.id);
    } finally {
      pingingId = null;
    }
  }

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

      <!-- Tab Switcher -->
      <div class="hud-tabs">
        <button
          class="hud-tab"
          class:active={activeTab === 'audio'}
          on:click={() => activeTab = 'audio'}
        >
          Audio Engine
        </button>
        <button
          class="hud-tab"
          class:active={activeTab === 'providers'}
          on:click={() => activeTab = 'providers'}
        >
          Providers Matrix ({$providerTelemetryStore.length})
        </button>
      </div>

      <!-- Live Specs Table / Providers Matrix -->
      {#if activeTab === 'audio'}
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
      {:else}
      <div class="hud-body providers-body">
        {#if $providerTelemetryStore.length === 0}
          <div class="hud-empty">
            <Icon name="radio" size={24} />
            <span>No modular providers active</span>
            <small>Plugins can register Stream, Metadata & Lyrics providers.</small>
          </div>
        {:else}
          <div class="provider-matrix-list">
            {#each $providerTelemetryStore as provider (provider.id)}
              <div class="provider-matrix-card">
                <div class="provider-card-top">
                  <div class="provider-card-name-group">
                    <span class="provider-status-dot status-{provider.status}" title={provider.status}></span>
                    <span class="provider-name truncate">{provider.name}</span>
                    <span class="provider-type-tag type-{provider.type}">{provider.type}</span>
                  </div>
                  <button
                    class="btn-ping"
                    title="Ping provider"
                    disabled={pingingId === provider.id}
                    on:click={() => handlePing(provider)}
                  >
                    <Icon name="refresh-cw" size={10} className={pingingId === provider.id ? 'spin' : ''} />
                  </button>
                </div>

                <div class="provider-card-stats">
                  <div class="provider-stat-col">
                    <span class="stat-micro-label">Latency</span>
                    <span class="stat-micro-val">
                      {#if provider.lastLatencyMs !== null}
                        <span class="latency-pill" class:fast={provider.lastLatencyMs < 400} class:med={provider.lastLatencyMs >= 400 && provider.lastLatencyMs < 1200} class:slow={provider.lastLatencyMs >= 1200}>
                          {provider.lastLatencyMs}ms
                        </span>
                      {:else}
                        <span class="text-subdued">—</span>
                      {/if}
                    </span>
                  </div>
                  <div class="provider-stat-col">
                    <span class="stat-micro-label">Avg Latency</span>
                    <span class="stat-micro-val mono">
                      {provider.avgLatencyMs !== null ? `${provider.avgLatencyMs}ms` : '—'}
                    </span>
                  </div>
                  <div class="provider-stat-col">
                    <span class="stat-micro-label">Success Rate</span>
                    <span class="stat-micro-val">
                      {#if provider.totalRequests > 0}
                        {Math.round((provider.successCount / provider.totalRequests) * 100)}% ({provider.totalRequests})
                      {:else}
                        <span class="text-subdued">Idle</span>
                      {/if}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      {/if}

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

  /* Hud Tabs */
  .hud-tabs {
    display: flex;
    background: rgba(0, 0, 0, 0.25);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .hud-tab {
    flex: 1;
    background: transparent;
    border: none;
    padding: 6px 10px;
    font-size: 0.7rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
    border-bottom: 2px solid transparent;
  }

  .hud-tab:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .hud-tab.active {
    color: #fff;
    border-bottom-color: var(--accent-primary, #1db954);
    background: rgba(255, 255, 255, 0.03);
  }

  /* Provider Matrix List */
  .providers-body {
    max-height: 280px;
    overflow-y: auto;
  }

  .hud-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 20px 10px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.75rem;
    text-align: center;
  }

  .hud-empty small {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.3);
  }

  .provider-matrix-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .provider-matrix-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 7px 9px;
  }

  .provider-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .provider-card-name-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .provider-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .provider-status-dot.status-healthy {
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
  }

  .provider-status-dot.status-degraded {
    background: #fbbf24;
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.6);
  }

  .provider-status-dot.status-offline {
    background: #f87171;
    box-shadow: 0 0 6px rgba(248, 113, 113, 0.6);
  }

  .provider-status-dot.status-idle {
    background: rgba(255, 255, 255, 0.3);
  }

  .provider-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    max-width: 140px;
  }

  .provider-type-tag {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 3px;
    letter-spacing: 0.04em;
  }

  .provider-type-tag.type-stream {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }

  .provider-type-tag.type-metadata {
    background: rgba(168, 85, 247, 0.2);
    color: #d8b4fe;
  }

  .provider-type-tag.type-lyrics {
    background: rgba(236, 72, 153, 0.2);
    color: #f472b6;
  }

  .btn-ping {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.6);
    padding: 3px 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-ping:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .btn-ping:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .provider-card-stats {
    display: flex;
    justify-content: space-between;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    padding: 4px 6px;
  }

  .provider-stat-col {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .stat-micro-label {
    font-size: 0.55rem;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 0.03em;
  }

  .stat-micro-val {
    font-size: 0.68rem;
    font-family: ui-monospace, monospace;
    color: rgba(255, 255, 255, 0.85);
  }

  .stat-micro-val.mono {
    font-family: ui-monospace, monospace;
  }

  .latency-pill {
    font-weight: 600;
  }

  .latency-pill.fast {
    color: #4ade80;
  }

  .latency-pill.med {
    color: #fbbf24;
  }

  .latency-pill.slow {
    color: #f87171;
  }

  .text-subdued {
    color: rgba(255, 255, 255, 0.35);
  }
</style>
