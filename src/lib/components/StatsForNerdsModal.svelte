<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { getAudioTelemetry, type AudioTelemetry, isTauri } from "$lib/api/tauri";
  import { currentTrack, activeBackend, isPlaying, currentTime, duration } from "$lib/stores/player";
  import { isStatsForNerdsOpen } from "$lib/stores/ui";
  import Icon from "$lib/components/Icon.svelte";
  import { providerTelemetryStore, globalProviders, type ProviderTelemetryEntry } from "$lib/plugins/providers";

  export let open: boolean = false;
  export let onClose: () => void = () => {
    open = false;
    isStatsForNerdsOpen.set(false);
  };

  let telemetry: AudioTelemetry | null = null;
  let intervalId: any = null;
  let activeTab: 'audio' | 'providers' = 'audio';
  let pingingKey: string | null = null;
  let isPingingAll = false;

  function handleClose() {
    open = false;
    isStatsForNerdsOpen.set(false);
    onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  async function handlePing(item: ProviderTelemetryEntry) {
    const key = `${item.type}-${item.id}`;
    if (pingingKey) return;
    pingingKey = key;
    try {
      await globalProviders.pingProvider(item.type, item.id);
    } catch (err) {
      console.warn(`[StatsForNerds] Failed to ping provider '${item.id}':`, err);
    } finally {
      pingingKey = null;
    }
  }

  async function handlePingAll() {
    if (isPingingAll) return;
    isPingingAll = true;
    try {
      const items = $providerTelemetryStore;
      for (const item of items) {
        try {
          await globalProviders.pingProvider(item.type, item.id);
        } catch {
          // continue pinging next
        }
      }
    } finally {
      isPingingAll = false;
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

  function formatSampleRate(hz?: number | null): string {
    if (!hz || hz <= 0) return "—";
    if (hz >= 1000) {
      const khz = (hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1);
      return `${khz} kHz (${hz.toLocaleString()} Hz)`;
    }
    return `${hz} Hz`;
  }

  function formatTime(sec: number): string {
    if (!sec || isNaN(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  }

  // Purely computed codec name (no placeholder)
  $: resolvedCodec = (() => {
    if (!telemetry && !$currentTrack) return "—";
    if (telemetry?.codec && telemetry.codec !== "None") {
      return telemetry.codec.toUpperCase();
    }
    if ($currentTrack?.format) {
      return $currentTrack.format.toUpperCase();
    }
    if ($currentTrack?.path) {
      const ext = $currentTrack.path.split('.').pop();
      if (ext && ext.length <= 5) return ext.toUpperCase();
    }
    return $currentTrack ? "Unknown Codec" : "—";
  })();

  // Purely computed bit depth (no hardcoded '16-bit PCM')
  $: resolvedBitDepth = (() => {
    if (!telemetry && !$currentTrack) return "—";
    if (telemetry?.bit_depth && telemetry.bit_depth > 0) {
      return `${telemetry.bit_depth}-bit PCM`;
    }
    const fmt = ($currentTrack?.format || "").toLowerCase();
    const isLossy = ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'webm'].some(ext => fmt.includes(ext));
    if (isLossy) {
      return "32-bit Float (Lossy Decode)";
    }
    const isLossless = ['flac', 'wav', 'alac', 'aiff'].some(ext => fmt.includes(ext));
    if (isLossless) {
      return "PCM (Lossless)";
    }
    return $currentTrack ? "32-bit Float Pipeline" : "—";
  })();

  // True total duration in seconds
  $: totalDurationSec = (() => {
    if ($duration && $duration > 0) return $duration;
    if ($currentTrack?.duration) {
      return $currentTrack.duration > 1000 ? Math.round($currentTrack.duration / 1000) : $currentTrack.duration;
    }
    return 0;
  })();
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stats-hud-backdrop"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 140 }}
  >
    <div
      class="stats-hud-card"
      on:click|stopPropagation
      transition:scale={{ duration: 160, start: 0.96 }}
      role="dialog"
      aria-modal="true"
      aria-label="Stats for Nerds Telemetry"
    >
      <!-- Header -->
      <div class="hud-header">
        <div class="hud-title-group">
          <span class="hud-badge">HUD</span>
          <span class="hud-title">Stats for Nerds</span>
        </div>
        <button
          type="button"
          class="btn-hud-close"
          on:click|stopPropagation={handleClose}
          aria-label="Close Stats HUD"
          title="Close (Esc)"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <!-- Tab Switcher -->
      <div class="hud-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-audio"
          aria-selected={activeTab === 'audio'}
          aria-controls="panel-audio"
          class="hud-tab"
          class:active={activeTab === 'audio'}
          on:click|stopPropagation={() => activeTab = 'audio'}
        >
          <Icon name="info" size={12} />
          <span>Audio Engine</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-providers"
          aria-selected={activeTab === 'providers'}
          aria-controls="panel-providers"
          class="hud-tab"
          class:active={activeTab === 'providers'}
          on:click|stopPropagation={() => activeTab = 'providers'}
        >
          <Icon name="radio" size={12} />
          <span>Providers Matrix ({$providerTelemetryStore.length})</span>
        </button>
      </div>

      <!-- Tab Panel 1: Live Specs Table -->
      {#if activeTab === 'audio'}
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" class="hud-body">
          <!-- Playback State & Clock -->
          <div class="hud-row">
            <span class="hud-label">Playback</span>
            <span class="hud-val mono-val">
              {#if $isPlaying}
                <span class="ok-val">Playing</span> ({formatTime($currentTime)} / {formatTime(totalDurationSec)})
              {:else if $currentTrack}
                <span class="warn-val">Paused</span> ({formatTime($currentTime)} / {formatTime(totalDurationSec)})
              {:else}
                <span class="text-subdued">Stopped (Idle)</span>
              {/if}
            </span>
          </div>

          <!-- Track Title / Path -->
          {#if $currentTrack}
            <div class="hud-row">
              <span class="hud-label">Track</span>
              <span class="hud-val truncate" title="{$currentTrack.title} — {$currentTrack.artist}">
                {$currentTrack.title} — {$currentTrack.artist}
              </span>
            </div>
          {/if}

          <!-- Audio Backend -->
          <div class="hud-row">
            <span class="hud-label">Backend</span>
            <span class="hud-val accent-val">
              {$activeBackend === 'native' ? 'Rust Rodio / Symphonia (Native)' : 'WebAudio API / HTML5'}
            </span>
          </div>

          <!-- Codec & Container -->
          <div class="hud-row">
            <span class="hud-label">Codec</span>
            <span class="hud-val pill-val highlight">
              {resolvedCodec}
            </span>
          </div>

          <!-- Bit Depth -->
          <div class="hud-row">
            <span class="hud-label">Bit Depth</span>
            <span class="hud-val mono-val">
              {resolvedBitDepth}
            </span>
          </div>

          <!-- Source Sample Rate -->
          <div class="hud-row">
            <span class="hud-label">Source Rate</span>
            <span class="hud-val mono-val">
              {#if telemetry?.sample_rate && telemetry.sample_rate > 0}
                {formatSampleRate(telemetry.sample_rate)}
              {:else if $currentTrack}
                <span class="text-subdued">44.1 kHz (Stream Native)</span>
              {:else}
                <span class="text-subdued">—</span>
              {/if}
            </span>
          </div>

          <!-- Device Output Rate -->
          <div class="hud-row">
            <span class="hud-label">Output Clock</span>
            <span class="hud-val mono-val">
              {#if telemetry?.device_sample_rate && telemetry.device_sample_rate > 0}
                {formatSampleRate(telemetry.device_sample_rate)}
              {:else}
                <span class="text-subdued">—</span>
              {/if}
            </span>
          </div>

          <!-- Resampler Status -->
          <div class="hud-row">
            <span class="hud-label">Resampling</span>
            {#if !$currentTrack && !telemetry}
              <span class="hud-val text-subdued">—</span>
            {:else if telemetry?.resampler_active}
              <span class="hud-val warn-val">
                Rubato Sinc ({telemetry.sample_rate} → {telemetry.device_sample_rate} Hz)
              </span>
            {:else if telemetry}
              <span class="hud-val ok-val">Direct 1:1 (Bit-Perfect, No Resample)</span>
            {:else}
              <span class="hud-val text-subdued">Bypassed</span>
            {/if}
          </div>

          <!-- Channels -->
          <div class="hud-row">
            <span class="hud-label">Channels</span>
            <span class="hud-val mono-val">
              {#if telemetry?.channels}
                {telemetry.channels} {telemetry.channels === 1 ? '(Mono)' : telemetry.channels === 2 ? '(Stereo)' : `(${telemetry.channels}ch)`}
              {:else if $currentTrack}
                2 (Stereo)
              {:else}
                <span class="text-subdued">—</span>
              {/if}
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
              {#if telemetry}
                {telemetry.limiter_enabled ? 'Active (Lookahead Safety)' : 'Bypassed'}
              {:else}
                <span class="text-subdued">Bypassed</span>
              {/if}
            </span>
          </div>

          <!-- Exclusive / Bit-Perfect Mode -->
          <div class="hud-row">
            <span class="hud-label">DAC Mode</span>
            {#if telemetry?.exclusive_mode}
              <span class="hud-val ok-val">Exclusive (Bit-Perfect)</span>
            {:else}
              <span class="hud-val mono-val">Standard (Shared Output)</span>
            {/if}
          </div>

          <!-- ReplayGain -->
          <div class="hud-row">
            <span class="hud-label">ReplayGain</span>
            <span class="hud-val mono-val">
              {#if telemetry?.replay_gain_db != null}
                {telemetry.replay_gain_db > 0 ? '+' : ''}{telemetry.replay_gain_db.toFixed(1)} dB
              {:else if $currentTrack}
                0.0 dB (None applied)
              {:else}
                <span class="text-subdued">—</span>
              {/if}
            </span>
          </div>

          <!-- Active Sink -->
          <div class="hud-row">
            <span class="hud-label">Output Device</span>
            <span class="hud-val truncate mono-val">
              {#if telemetry?.output_device && telemetry.output_device !== "Default"}
                {telemetry.output_device}
              {:else}
                System Default Device
              {/if}
            </span>
          </div>
        </div>
      {:else}
        <!-- Tab Panel 2: Providers Matrix -->
        <div id="panel-providers" role="tabpanel" aria-labelledby="tab-providers" class="hud-body providers-body">
          <div class="providers-toolbar">
            <span class="providers-count-label">
              {$providerTelemetryStore.length} {$providerTelemetryStore.length === 1 ? 'Provider' : 'Providers'} Registered
            </span>
            <button
              type="button"
              class="btn-ping-all"
              disabled={isPingingAll || $providerTelemetryStore.length === 0}
              on:click|stopPropagation={handlePingAll}
              title="Ping all registered providers to check live connectivity"
            >
              <Icon name="refresh-cw" size={11} className={isPingingAll ? 'spin' : ''} />
              <span>{isPingingAll ? 'Pinging...' : 'Ping All'}</span>
            </button>
          </div>

          {#if $providerTelemetryStore.length === 0}
            <div class="hud-empty">
              <Icon name="radio" size={24} />
              <span>No modular providers active</span>
              <small>Installed plugins can register Stream, Metadata & Lyrics providers.</small>
            </div>
          {:else}
            <div class="provider-matrix-list">
              {#each $providerTelemetryStore as provider (`${provider.type}-${provider.id}`)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="provider-matrix-card clickable"
                  role="button"
                  tabindex="0"
                  on:click|stopPropagation={() => handlePing(provider)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePing(provider); } }}
                  title="Click anywhere to ping '{provider.name}' and test live response latency"
                >
                  <div class="provider-card-top">
                    <div class="provider-card-name-group">
                      <span class="provider-status-dot status-{provider.status}" title="Status: {provider.status}"></span>
                      <span class="provider-name truncate">{provider.name}</span>
                      <span class="provider-type-tag type-{provider.type}">{provider.type}</span>
                    </div>
                    <button
                      type="button"
                      class="btn-ping"
                      title="Ping provider test request"
                      disabled={pingingKey === `${provider.type}-${provider.id}` || isPingingAll}
                      on:click|stopPropagation={() => handlePing(provider)}
                    >
                      <Icon name="refresh-cw" size={11} className={pingingKey === `${provider.type}-${provider.id}` ? 'spin' : ''} />
                    </button>
                  </div>

                  <div class="provider-card-stats">
                    <div class="provider-stat-col">
                      <span class="stat-micro-label">Latency</span>
                      <span class="stat-micro-val">
                        {#if provider.lastLatencyMs !== null}
                          <span
                            class="latency-pill"
                            class:fast={provider.lastLatencyMs < 400}
                            class:med={provider.lastLatencyMs >= 400 && provider.lastLatencyMs < 1200}
                            class:slow={provider.lastLatencyMs >= 1200}
                          >
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
        <span>Toggle HUD: <kbd>Ctrl</kbd> + <kbd>I</kbd> &nbsp;•&nbsp; Click outside or <kbd>Esc</kbd> to close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .stats-hud-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10005;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    padding-top: 56px;
    padding-right: 20px;
    pointer-events: auto;
  }

  @media (max-width: 600px) {
    .stats-hud-backdrop {
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
  }

  .stats-hud-card {
    background: rgba(18, 18, 22, 0.94);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65), 0 2px 10px rgba(0, 0, 0, 0.4);
    color: var(--text-primary, #ffffff);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    max-width: 360px;
    width: calc(100vw - 32px);
    pointer-events: auto;
  }

  .hud-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.05);
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
    padding: 2px 6px;
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
    color: rgba(255, 255, 255, 0.65);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    padding: 0;
  }

  .btn-hud-close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-hud-close:active {
    transform: scale(0.95);
  }

  .hud-tabs {
    display: flex;
    background: rgba(0, 0, 0, 0.35);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .hud-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 8px 12px;
    font-size: 0.72rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    transition: all 0.15s ease;
    border-bottom: 2px solid transparent;
  }

  .hud-tab:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.03);
  }

  .hud-tab.active {
    color: #fff;
    border-bottom-color: var(--accent-primary, #1db954);
    background: rgba(255, 255, 255, 0.06);
  }

  .hud-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 0.75rem;
  }

  .providers-body {
    max-height: 320px;
    overflow-y: auto;
  }

  .providers-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 4px;
  }

  .providers-count-label {
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 500;
  }

  .btn-ping-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-ping-all:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }

  .btn-ping-all:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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
    color: rgba(255, 255, 255, 0.92);
    text-align: right;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 210px;
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
    font-weight: 600;
  }

  .ok-val {
    color: #4ade80;
    font-weight: 600;
  }

  .warn-val {
    color: #fbbf24;
    font-weight: 600;
  }

  .hud-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 24px 10px;
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.75rem;
    text-align: center;
  }

  .hud-empty small {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.35);
  }

  .provider-matrix-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .provider-matrix-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 8px 10px;
    transition: all 0.15s ease;
  }

  .provider-matrix-card.clickable {
    cursor: pointer;
  }

  .provider-matrix-card.clickable:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
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
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .provider-status-dot.status-healthy {
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
  }

  .provider-status-dot.status-degraded {
    background: #fbbf24;
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.7);
  }

  .provider-status-dot.status-offline {
    background: #f87171;
    box-shadow: 0 0 6px rgba(248, 113, 113, 0.7);
  }

  .provider-status-dot.status-idle {
    background: rgba(255, 255, 255, 0.35);
  }

  .provider-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    max-width: 150px;
  }

  .provider-type-tag {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.04em;
  }

  .provider-type-tag.type-stream {
    background: rgba(59, 130, 246, 0.22);
    color: #93c5fd;
  }

  .provider-type-tag.type-metadata {
    background: rgba(168, 85, 247, 0.22);
    color: #d8b4fe;
  }

  .provider-type-tag.type-lyrics {
    background: rgba(236, 72, 153, 0.22);
    color: #f472b6;
  }

  .btn-ping {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.75);
    padding: 4px 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-ping:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }

  .btn-ping:disabled {
    opacity: 0.45;
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
    background: rgba(0, 0, 0, 0.25);
    border-radius: 4px;
    padding: 5px 8px;
  }

  .provider-stat-col {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .stat-micro-label {
    font-size: 0.55rem;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 0.03em;
  }

  .stat-micro-val {
    font-size: 0.68rem;
    font-family: ui-monospace, monospace;
    color: rgba(255, 255, 255, 0.9);
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
    color: rgba(255, 255, 255, 0.38);
  }

  .hud-footer {
    padding: 8px 14px;
    background: rgba(0, 0, 0, 0.25);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
  }

  kbd {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.9);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.625rem;
    font-family: inherit;
  }
</style>
