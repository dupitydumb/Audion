<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { modalSheetTransition } from "$lib/stores/mobile";
  import { getAudioTelemetry, type AudioTelemetry, isTauri } from "$lib/api/tauri";
  import { nativeAudioListDevices, type DeviceList } from "$lib/services/native-audio";
  import { appSettings } from "$lib/stores/settings";
  import { currentTrack, activeBackend, isPlaying, currentTime, duration } from "$lib/stores/player";
  import { isStatsForNerdsOpen } from "$lib/stores/ui";
  import Icon from "$lib/components/Icon.svelte";
  import AudionChain from "$lib/components/AudionChain.svelte";
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
    return $currentTrack ? "Unknown Codec" : "—";
  })();

  // Bit depth only from real decoder telemetry — never guessed from the format
  $: resolvedBitDepth =
    telemetry?.bit_depth && telemetry.bit_depth > 0
      ? `${telemetry.bit_depth}-bit PCM`
      : "—";

  // Telemetry only describes a live decoder once a track path is set
  $: live = !!telemetry?.path;

  const BACKEND_LABELS: Record<string, string> = {
    native: "Rust Rodio / Symphonia (Native)",
    html5: "WebAudio API / HTML5",
    remote: "Remote Device (Network)",
    none: "Idle (No Backend)",
  };
  $: backendLabel = BACKEND_LABELS[$activeBackend] ?? $activeBackend;

  let deviceList: DeviceList | null = null;
  let devicesLoaded = false;
  async function loadDevices() {
    if (devicesLoaded || !isTauri()) return;
    try {
      deviceList = await nativeAudioListDevices();
      devicesLoaded = true;
    } catch {
      // device enumeration unavailable
    }
  }
  $: if (open) loadDevices();

  $: outputDeviceLabel = (() => {
    if ($appSettings.audioBackend === "html5") return "Browser Default (HTML5)";
    const configuredId = $appSettings.outputDevice;
    if (!configuredId) return "System Default Device";
    const device = deviceList?.devices.find((d) => d.id === configuredId);
    return device?.name || "Custom Device";
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
      transition:modalSheetTransition
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
          <span>Audion Chain</span>
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

      <!-- Tab Panel 1: Audion Chain Signal Path -->
      {#if activeTab === 'audio'}
        <div id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" class="hud-body">
          <AudionChain />
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

      <!-- Footer Shortcut Hint (Desktop only) -->
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
    z-index: var(--z-modal, 4000);
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    padding-top: 56px;
    padding-right: 20px;
    pointer-events: auto;
  }

  .stats-hud-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg, 12px);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
    font-family: inherit;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-width: 380px;
    width: calc(100vw - 32px);
    max-height: calc(100dvh - 80px);
    pointer-events: auto;
  }

  .hud-header {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle, var(--border-color));
    flex-shrink: 0;
  }

  .hud-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hud-badge {
    background: var(--accent-primary);
    color: var(--text-on-accent, #000000);
    font-size: 0.625rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .hud-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .btn-hud-close {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
    padding: 0;
  }

  .btn-hud-close:hover {
    color: var(--text-primary);
    background: var(--surface-subtle-hover, var(--bg-highlight));
  }

  .btn-hud-close:active {
    transform: scale(0.92);
  }

  .hud-tabs {
    display: flex;
    background: var(--bg-base);
    border-bottom: 1px solid var(--border-subtle, var(--border-color));
    flex-shrink: 0;
  }

  .hud-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 10px 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.15s ease, background-color 0.15s ease;
    border-bottom: 2px solid transparent;
  }

  .hud-tab:hover {
    color: var(--text-primary);
    background: var(--surface-subtle, rgba(128, 128, 128, 0.08));
  }

  .hud-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
    background: var(--bg-surface);
  }

  .hud-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.75rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    min-height: 0;
  }

  .providers-body {
    max-height: 360px;
  }

  .providers-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-subtle, var(--border-color));
    margin-bottom: 4px;
  }

  .providers-count-label {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-weight: 600;
  }

  .btn-ping-all {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--surface-subtle, var(--bg-surface));
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.7rem;
    font-weight: 600;
    padding: 5px 10px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .btn-ping-all:hover:not(:disabled) {
    background: var(--surface-subtle-hover, var(--bg-highlight));
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
    color: var(--text-secondary);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .hud-val {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--text-primary);
    text-align: right;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 210px;
  }

  .highlight {
    color: var(--text-primary);
    background: var(--surface-subtle-hover, var(--bg-surface));
    border: 1px solid var(--border-subtle, var(--border-color));
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 600;
  }

  .accent-val {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .ok-val {
    color: var(--success-color, #16a34a);
    font-weight: 600;
  }

  .warn-val {
    color: var(--warning-color, #d97706);
    font-weight: 600;
  }

  .hud-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 24px 10px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    text-align: center;
  }

  .hud-empty small {
    font-size: 0.72rem;
    color: var(--text-subdued);
  }

  .provider-matrix-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .provider-matrix-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle, var(--border-color));
    border-radius: 8px;
    padding: 10px 12px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .provider-matrix-card.clickable {
    cursor: pointer;
  }

  .provider-matrix-card.clickable:hover {
    background: var(--surface-subtle-hover, var(--bg-highlight));
    border-color: var(--border-color);
  }

  .provider-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .provider-card-name-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .provider-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .provider-status-dot.status-healthy {
    background: var(--success-color, #16a34a);
  }

  .provider-status-dot.status-degraded {
    background: var(--warning-color, #d97706);
  }

  .provider-status-dot.status-offline {
    background: var(--error-color, #dc2626);
  }

  .provider-status-dot.status-idle {
    background: var(--text-subdued);
  }

  .provider-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-primary);
    max-width: 160px;
  }

  .provider-type-tag {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.04em;
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    color: var(--accent-primary);
  }

  .btn-ping {
    background: var(--surface-subtle, var(--bg-elevated));
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .btn-ping:hover:not(:disabled) {
    background: var(--surface-subtle-hover, var(--bg-highlight));
    color: var(--text-primary);
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
    background: var(--bg-base);
    border-radius: 6px;
    padding: 6px 10px;
  }

  .provider-stat-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-micro-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    color: var(--text-subdued);
    letter-spacing: 0.03em;
  }

  .stat-micro-val {
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
  }

  .stat-micro-val.mono {
    font-family: ui-monospace, monospace;
  }

  .latency-pill {
    font-weight: 600;
  }

  .latency-pill.fast {
    color: var(--success-color, #16a34a);
  }

  .latency-pill.med {
    color: var(--warning-color, #d97706);
  }

  .latency-pill.slow {
    color: var(--error-color, #dc2626);
  }

  .text-subdued {
    color: var(--text-subdued);
  }

  .hud-footer {
    padding: 8px 14px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle, var(--border-color));
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-align: center;
    flex-shrink: 0;
  }

  kbd {
    background: var(--surface-subtle-hover, var(--bg-highlight));
    color: var(--text-primary);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.65rem;
    font-family: inherit;
  }

  /* Mobile: native bottom sheet aligned with app theme */
  :global(html.layout-mobile) .stats-hud-backdrop {
    align-items: flex-end;
    justify-content: center;
    padding: var(--safe-area-top, 16px) 0 0;
  }

  :global(html.layout-mobile) .stats-hud-card {
    width: 100%;
    max-width: 100%;
    max-height: 85dvh;
    border-radius: 20px 20px 0 0;
    border-bottom: none;
  }

  :global(html.layout-mobile) .hud-header {
    padding: 16px 16px 12px;
  }

  :global(html.layout-mobile) .hud-header::before {
    content: "";
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-highlight);
  }

  :global(html.layout-mobile) .btn-hud-close {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .hud-tab {
    min-height: 44px;
    font-size: 0.8125rem;
  }

  :global(html.layout-mobile) .hud-body {
    padding: 14px 16px calc(16px + var(--safe-area-bottom, 0px));
    gap: 10px;
    font-size: 0.8125rem;
  }

  :global(html.layout-mobile) .providers-body {
    max-height: none;
  }

  :global(html.layout-mobile) .hud-label,
  :global(html.layout-mobile) .hud-val {
    font-size: 0.8125rem;
  }

  :global(html.layout-mobile) .btn-ping-all {
    min-height: 38px;
    padding: 6px 12px;
    font-size: 0.75rem;
  }

  :global(html.layout-mobile) .btn-ping {
    min-width: 40px;
    min-height: 40px;
  }

  :global(html.layout-mobile) .hud-footer {
    display: none;
  }
</style>
