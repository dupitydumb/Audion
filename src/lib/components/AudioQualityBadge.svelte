<script lang="ts">
  import { onMount } from "svelte";
  import { currentTrack, activeBackend } from "$lib/stores/player";
  import { isStatsForNerdsOpen } from "$lib/stores/ui";
  import { isTauri, getAudioTelemetry, type AudioTelemetry, type Track } from "$lib/api/tauri";
  import Icon from "$lib/components/Icon.svelte";

  export let track: Track | null = null;
  export let variant: "compact" | "pill" | "full" = "pill";
  export let clickable: boolean = true;
  export let className: string = "";

  let telemetry: AudioTelemetry | null = null;
  let lastTrackId: number | null = null;

  $: activeTrack = track || $currentTrack;

  $: if (activeTrack && activeTrack.id !== lastTrackId) {
    lastTrackId = activeTrack.id;
    refreshTelemetry();
  }

  async function refreshTelemetry() {
    if (!isTauri()) return;
    try {
      telemetry = await getAudioTelemetry();
    } catch {
      // Telemetry might be busy or unavailable
    }
  }

  onMount(() => {
    refreshTelemetry();
  });

  // Derive badge properties
  const EMPTY_CODECS = new Set(["", "NONE", "NULL", "UNKNOWN"]);
  $: codec = (
    telemetry?.codec ||
    activeTrack?.format ||
    ""
  ).toUpperCase();

  $: hasCodec = !!codec && !EMPTY_CODECS.has(codec);

  $: bitDepth = telemetry?.bit_depth || (codec === "FLAC" || codec === "ALAC" ? 16 : null);
  $: sampleRate = telemetry?.sample_rate || 44100;
  $: isExclusive = !!telemetry?.exclusive_mode;
  $: isDirect = !telemetry?.resampler_active;

  $: isHiRes = (sampleRate > 48000) || (bitDepth !== null && bitDepth >= 24);
  $: isLossless = isHiRes || ["FLAC", "ALAC", "WAV", "AIFF", "DSD"].includes(codec);
  $: hasInfo = isLossless || hasCodec || !!activeTrack?.bitrate;

  $: badgeTier = isHiRes ? "hires" : isLossless ? "lossless" : "standard";

  $: mainLabel = isHiRes
    ? "Hi-Res"
    : isLossless
      ? "Lossless"
      : codec || "HQ";

  $: detailText = isHiRes
    ? `${bitDepth ? `${bitDepth}-bit/` : ""}${Math.round(sampleRate / 1000)}kHz`
    : isLossless
      ? `${bitDepth ? `${bitDepth}-bit` : codec}`
      : activeTrack?.bitrate
        ? `${activeTrack.bitrate}k`
        : codec || "Audio";

  function handleClick(e: MouseEvent) {
    if (!clickable) return;
    e.stopPropagation();
    isStatsForNerdsOpen.update((v) => !v);
  }
</script>

{#if activeTrack && hasInfo}
  <button
    type="button"
    class="audio-quality-badge tier-{badgeTier} variant-{variant} {className}"
    class:clickable
    class:exclusive={isExclusive}
    on:click={handleClick}
    title={clickable ? "Audio Pipeline Specs (Click for Stats for Nerds)" : "Audio Quality"}
    aria-label="Audio Quality Specs"
  >
    <!-- Visual tier indicator icon -->
    {#if isExclusive}
      <span class="badge-dot exclusive-dot" title="Bit-Perfect DAC Exclusive"></span>
    {:else if isHiRes}
      <span class="badge-dot hires-dot"></span>
    {/if}

    <span class="badge-title">{mainLabel}</span>

    {#if variant !== "compact" && detailText}
      <span class="badge-separator">·</span>
      <span class="badge-detail">{detailText}</span>
    {/if}

    {#if clickable && variant === "full"}
      <Icon name="info" size={12} className="badge-info-icon" />
    {/if}
  </button>
{/if}

<style>
  .audio-quality-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: var(--radius-sm, 4px);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-secondary, rgba(255, 255, 255, 0.75));
    transition: all var(--transition-fast, 150ms ease);
    cursor: default;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    line-height: 1.3;
  }

  .audio-quality-badge.clickable {
    cursor: pointer;
  }

  .audio-quality-badge.clickable:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    color: var(--text-primary, #ffffff);
    transform: translateY(-0.5px);
  }

  .audio-quality-badge.clickable:active {
    transform: scale(0.96);
  }

  /* Compact variant (e.g. for PlayerBar / MobileMiniPlayer) */
  .variant-compact {
    padding: 2px 7px;
    font-size: 9px;
    line-height: 1.2;
    border-radius: var(--radius-full, 9999px);
    letter-spacing: 0.04em;
  }

  /* Full variant (e.g. FullScreenPlayer) */
  .variant-full {
    padding: 3px 9px;
    font-size: 11px;
    border-radius: var(--radius-full, 9999px);
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Tier-specific styling — follows app theme tokens */
  .tier-hires {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
    color: var(--accent-primary);
  }

  .tier-hires:hover {
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 55%, transparent);
  }

  .tier-lossless {
    background: var(--bg-elevated);
    border-color: color-mix(in srgb, var(--text-primary) 18%, transparent);
    color: var(--text-primary);
  }

  .tier-standard {
    background: var(--bg-elevated);
    border-color: var(--border-color);
    color: var(--text-subdued);
  }

  .exclusive {
    border-color: var(--accent-primary, #1db954);
  }

  /* Indicator dots */
  .badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
  }

  .hires-dot {
    background: #ffd166;
    box-shadow: 0 0 6px rgba(255, 209, 102, 0.6);
  }

  .exclusive-dot {
    background: var(--accent-primary, #1db954);
    box-shadow: 0 0 6px var(--accent-primary, #1db954);
  }

  .badge-separator {
    opacity: 0.4;
    margin: 0 1px;
  }

  .badge-detail {
    font-weight: 500;
    opacity: 0.85;
    text-transform: none;
    letter-spacing: normal;
  }

  :global(.badge-info-icon) {
    opacity: 0.6;
    margin-left: 2px;
  }

  .audio-quality-badge:hover :global(.badge-info-icon) {
    opacity: 1;
  }
</style>
