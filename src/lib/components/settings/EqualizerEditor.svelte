<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    equalizer,
    customEqPresets,
    BUILTIN_PRESETS,
    formatFreqLabel,
    MIN_FREQ,
    MAX_FREQ,
    MIN_GAIN,
    MAX_GAIN,
    MIN_PREAMP_DB,
    MAX_PREAMP_DB,
    MAX_BANDS,
    type FilterType,
  } from '$lib/stores/equalizer';
  import EqResponseCurve from './EqResponseCurve.svelte';

  $: allPresets = [...BUILTIN_PRESETS, ...$customEqPresets];

  const dispatch = createEventDispatcher<{ back: void }>();

  let selectedBandIndex: number | null = null;
  let savePresetOpen = false;
  let savePresetName = '';

  const FILTER_TYPE_LABELS: Record<FilterType, string> = {
    peaking: 'Peak',
    lowShelf: 'Low Shelf',
    highShelf: 'High Shelf',
    lowPass: 'Low Pass',
    highPass: 'High Pass',
    bandPass: 'Band Pass',
    notch: 'Notch',
    allPass: 'All Pass',
  };
  const FILTER_TYPE_GROUPS: { label: string; types: FilterType[] }[] = [
    { label: 'Gain', types: ['peaking', 'lowShelf', 'highShelf'] },
    { label: 'Filter', types: ['lowPass', 'highPass', 'bandPass', 'notch', 'allPass'] },
  ];
  const GAINLESS_FILTERS = new Set<FilterType>(['lowPass', 'highPass', 'bandPass', 'notch', 'allPass']);

  function formatGain(g: number): string {
    const r = Math.round(g * 10) / 10;
    return `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`;
  }

  function selectBand(i: number) {
    selectedBandIndex = selectedBandIndex === i ? null : i;
  }

  function addBand() {
    const newIndex = equalizer.addBand(1000);
    if (newIndex >= 0) selectedBandIndex = newIndex;
  }

  function removeSelectedBand() {
    if (selectedBandIndex === null) return;
    equalizer.removeBand(selectedBandIndex);
    selectedBandIndex = null;
  }

  function openSavePreset() {
    savePresetName = '';
    savePresetOpen = true;
  }

  function confirmSavePreset() {
    if (!savePresetName.trim()) return;
    equalizer.saveCurrentAsPreset(savePresetName.trim());
    savePresetOpen = false;
  }
</script>

<div class="eq-editor">
  <div class="eq-editor-topbar">
    <button class="eq-back-btn" on:click={() => dispatch('back')} aria-label="Back to Audio settings">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>

  <div class="eq-editor-body">
    <div class="eq-graph-header">
      <span class="eq-graph-title">Equalizer</span>
      <button
        class="toggle-btn"
        class:active={$equalizer.enabled}
        on:click={() => equalizer.setEnabled(!$equalizer.enabled)}
        role="switch"
        aria-checked={$equalizer.enabled}
        aria-label="Toggle Equalizer"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <EqResponseCurve bind:selectedBandIndex on:select={(e) => selectedBandIndex = e.detail} />

    <div class="eq-editor-toolbar">
      <button class="btn-secondary-small" on:click={addBand} disabled={$equalizer.bands.length >= MAX_BANDS}>
        + Add band
      </button>
      <span class="eq-band-count">{$equalizer.bands.length} / {MAX_BANDS} bands</span>
    </div>

    {#if selectedBandIndex !== null && $equalizer.bands[selectedBandIndex]}
      {@const selBand = $equalizer.bands[selectedBandIndex]}
      {@const gainless = GAINLESS_FILTERS.has(selBand.filterType)}
      <div class="eq-band-detail" role="region" aria-label="Band detail">
        <div class="eq-band-detail-header">
          <div class="eq-detail-title-group">
            <span class="setting-title">{formatFreqLabel(selBand.frequency)} Hz</span>
            <span class="eq-detail-subtitle">
              {FILTER_TYPE_LABELS[selBand.filterType]} · Q {selBand.q.toFixed(2)}
              {#if !gainless} · {formatGain(selBand.gain)}{/if}
            </span>
          </div>
          <div class="eq-detail-header-actions">
            <button class="btn-text-small" on:click={removeSelectedBand} title="Remove band">Remove</button>
            <button
              class="toggle-btn toggle-btn-sm"
              class:active={selBand.enabled}
              on:click={() => equalizer.setBandEnabled(selectedBandIndex!, !selBand.enabled)}
              role="switch"
              aria-checked={selBand.enabled}
              title="{selBand.enabled ? 'Bypass' : 'Enable'} band"
            >
              <div class="toggle-handle"></div>
            </button>
            <button class="btn-text-small" on:click={() => selectedBandIndex = null} aria-label="Close">✕</button>
          </div>
        </div>

        <div class="eq-band-detail-row">
          <label class="eq-detail-label" for="eq-freq-{selectedBandIndex}">
            Frequency
            <span class="eq-q-value">{formatFreqLabel(selBand.frequency)} Hz</span>
          </label>
          <input
            id="eq-freq-{selectedBandIndex}"
            type="range"
            class="eq-q-slider"
            min={Math.log10(MIN_FREQ)}
            max={Math.log10(MAX_FREQ)}
            step="0.001"
            value={Math.log10(selBand.frequency)}
            on:input={(e) => equalizer.setBandFrequency(selectedBandIndex!, Math.pow(10, parseFloat(e.currentTarget.value)))}
            aria-label="Frequency"
          />
        </div>

        {#if !gainless}
          <div class="eq-band-detail-row">
            <label class="eq-detail-label" for="eq-gain-{selectedBandIndex}">
              Gain
              <span class="eq-q-value">{formatGain(selBand.gain)}</span>
            </label>
            <input
              id="eq-gain-{selectedBandIndex}"
              type="range"
              class="eq-q-slider"
              min={MIN_GAIN}
              max={MAX_GAIN}
              step="0.1"
              value={selBand.gain}
              on:input={(e) => equalizer.setBandGain(selectedBandIndex!, parseFloat(e.currentTarget.value))}
              aria-label="Gain"
            />
          </div>
        {/if}

        <div class="eq-band-detail-row">
          <span class="eq-detail-label">Filter type</span>
          <div class="eq-filter-type-grid" role="group" aria-label="Filter type">
            {#each FILTER_TYPE_GROUPS as group}
              <div class="eq-filter-group">
                <span class="eq-filter-group-label">{group.label}</span>
                <div class="segmented-pill eq-filter-pill">
                  {#each group.types as ft}
                    <button
                      class="segment-btn eq-segment-sm"
                      class:active={selBand.filterType === ft}
                      on:click={() => equalizer.setBandFilterType(selectedBandIndex!, ft)}
                      aria-pressed={selBand.filterType === ft}
                    >
                      {FILTER_TYPE_LABELS[ft]}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="eq-band-detail-row">
          <label class="eq-detail-label" for="eq-q-{selectedBandIndex}">
            Q factor
            <span class="eq-q-value">{selBand.q.toFixed(2)}</span>
          </label>
          <input
            id="eq-q-{selectedBandIndex}"
            type="range"
            class="eq-q-slider"
            min="0.1"
            max="10"
            step="0.01"
            value={selBand.q}
            on:input={(e) => equalizer.setBandQ(selectedBandIndex!, parseFloat(e.currentTarget.value))}
            aria-label="Q factor"
          />
        </div>
      </div>
    {/if}

    <div class="eq-band-detail-row eq-preamp-row">
      <label class="eq-detail-label" for="eq-preamp">
        Preamp
        <span class="eq-q-value">{$equalizer.preampDb > 0 ? '+' : ''}{$equalizer.preampDb.toFixed(1)} dB</span>
      </label>
      <input
        id="eq-preamp"
        type="range"
        class="eq-q-slider"
        min={MIN_PREAMP_DB}
        max={MAX_PREAMP_DB}
        step="0.5"
        value={$equalizer.preampDb}
        on:input={(e) => equalizer.setPreampDb(parseFloat(e.currentTarget.value))}
        aria-label="Preamp gain"
      />
      <p class="eq-preamp-hint">Trims overall output after all bands — use it to avoid clipping from boosted bands, not to raise volume.</p>
    </div>

    <div class="eq-presets">
      <div class="eq-presets-header">
        <span class="eq-presets-label">Presets</span>
        <button class="btn-text-small" on:click={openSavePreset}>Save current as preset</button>
      </div>
      <div class="eq-preset-pills">
        {#each allPresets as preset (preset.name)}
          <div class="preset-pill-wrap">
            <button
              class="preset-pill"
              class:active={$equalizer.currentPreset === preset.name}
              on:click={() => { equalizer.applyPreset(preset.name); selectedBandIndex = null; }}
              title={preset.name}
            >
              {preset.name}
            </button>
            {#if !preset.builtIn}
              <button
                class="preset-delete-btn"
                on:click={() => equalizer.deleteCustomPreset(preset.name)}
                title="Delete preset"
                aria-label="Delete preset {preset.name}"
              >✕</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

{#if savePresetOpen}
  <div
    class="eq-modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close dialog"
    on:click={() => savePresetOpen = false}
    on:keydown={(e) => e.key === 'Escape' && (savePresetOpen = false)}
  >
    <div
      class="eq-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Save preset"
      on:click|stopPropagation
      on:keydown|stopPropagation={(e) => e.key === 'Escape' && (savePresetOpen = false)}
    >
      <span class="setting-title">Save preset</span>
      <input
        type="text"
        class="eq-preset-name-input"
        placeholder="Preset name"
        bind:value={savePresetName}
        on:keydown={(e) => e.key === 'Enter' && confirmSavePreset()}
      />
      <div class="eq-modal-actions">
        <button class="btn-text-small" on:click={() => savePresetOpen = false}>Cancel</button>
        <button class="btn-secondary-small" on:click={confirmSavePreset} disabled={!savePresetName.trim()}>Save</button>
      </div>
    </div>
  </div>
{/if}