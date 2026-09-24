<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from 'svelte-i18n';
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
  import Icon from '$lib/components/Icon.svelte';

  $: allPresets = [...BUILTIN_PRESETS, ...$customEqPresets];

  const dispatch = createEventDispatcher<{ back: void }>();

  let selectedBandIndex: number | null = null;
  let savePresetOpen = false;
  let savePresetName = '';

  $: FILTER_TYPE_LABELS = {
    peaking: $_('settings.eqFilterPeak'),
    lowShelf: $_('settings.eqFilterLowShelf'),
    highShelf: $_('settings.eqFilterHighShelf'),
    lowPass: $_('settings.eqFilterLowPass'),
    highPass: $_('settings.eqFilterHighPass'),
    bandPass: $_('settings.eqFilterBandPass'),
    notch: $_('settings.eqFilterNotch'),
    allPass: $_('settings.eqFilterAllPass'),
  } as Record<FilterType, string>;

  $: FILTER_TYPE_GROUPS = [
    { label: $_('settings.eqGroupGain'), types: ['peaking', 'lowShelf', 'highShelf'] as FilterType[] },
    { label: $_('settings.eqGroupFilter'), types: ['lowPass', 'highPass', 'bandPass', 'notch', 'allPass'] as FilterType[] },
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
    <button class="eq-back-btn" on:click={() => dispatch('back')} aria-label={$_('settings.backToAudio')}>
      <Icon name="chevron-left" size={16} />
    </button>
  </div>

  <div class="eq-editor-body">
    <div class="eq-graph-header">
      <span class="eq-graph-title">{$_('settings.equalizer')}</span>
      <button
        class="toggle-btn"
        class:active={$equalizer.enabled}
        on:click={() => equalizer.setEnabled(!$equalizer.enabled)}
        role="switch"
        aria-checked={$equalizer.enabled}
        aria-label={$_('settings.equalizer')}
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <EqResponseCurve bind:selectedBandIndex on:select={(e) => selectedBandIndex = e.detail} />

    <div class="eq-editor-toolbar">
      <button class="btn-secondary-small" on:click={addBand} disabled={$equalizer.bands.length >= MAX_BANDS}>
        {$_('settings.eqAddBand')}
      </button>
      <span class="eq-band-count">{$_('settings.eqBandSlash', { values: { count: $equalizer.bands.length, max: MAX_BANDS } })}</span>
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
            <button class="btn-text-small" on:click={removeSelectedBand} title={$_('settings.remove')}>{$_('settings.remove')}</button>
            <button
              class="toggle-btn toggle-btn-sm"
              class:active={selBand.enabled}
              on:click={() => equalizer.setBandEnabled(selectedBandIndex!, !selBand.enabled)}
              role="switch"
              aria-checked={selBand.enabled}
              title={selBand.enabled ? $_('settings.eqBypassBand') : $_('settings.eqEnableBand')}
            >
              <div class="toggle-handle"></div>
            </button>
            <button class="btn-text-small" on:click={() => selectedBandIndex = null} aria-label={$_('settings.close')}>✕</button>
          </div>
        </div>

        <div class="eq-band-detail-row">
          <label class="eq-detail-label" for="eq-freq-{selectedBandIndex}">
            {$_('settings.eqFrequency')}
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
            aria-label={$_('settings.eqFrequency')}
          />
        </div>

        {#if !gainless}
          <div class="eq-band-detail-row">
            <label class="eq-detail-label" for="eq-gain-{selectedBandIndex}">
              {$_('settings.eqGain')}
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
              aria-label={$_('settings.eqGain')}
            />
          </div>
        {/if}

        <div class="eq-band-detail-row">
          <span class="eq-detail-label">{$_('settings.eqFilterType')}</span>
          <div class="eq-filter-type-grid" role="group" aria-label={$_('settings.eqFilterType')}>
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
            {$_('settings.eqQFactor')}
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
            aria-label={$_('settings.eqQFactor')}
          />
        </div>
      </div>
    {/if}

    <div class="eq-band-detail-row eq-preamp-row">
      <label class="eq-detail-label" for="eq-preamp">
        {$_('settings.eqPreamp')}
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
        aria-label={$_('settings.eqPreamp')}
      />
      <p class="eq-preamp-hint">{$_('settings.eqPreampHint')}</p>
    </div>

    <div class="eq-presets">
      <div class="eq-presets-header">
        <span class="eq-presets-label">{$_('settings.presets')}</span>
        <button class="btn-text-small" on:click={openSavePreset}>{$_('settings.eqSavePreset')}</button>
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
                title={$_('settings.eqDeletePreset')}
                aria-label="{$_('settings.eqDeletePreset')} {preset.name}"
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
    aria-label={$_('settings.close')}
    on:click={() => savePresetOpen = false}
    on:keydown={(e) => e.key === 'Escape' && (savePresetOpen = false)}
  >
    <div
      class="eq-modal"
      role="dialog"
      aria-modal="true"
      aria-label={$_('settings.eqSavePresetTitle')}
      on:click|stopPropagation
      on:keydown|stopPropagation={(e) => e.key === 'Escape' && (savePresetOpen = false)}
    >
      <span class="setting-title">{$_('settings.eqSavePresetTitle')}</span>
      <input
        type="text"
        class="eq-preset-name-input"
        placeholder={$_('settings.eqPresetNamePlaceholder')}
        bind:value={savePresetName}
        on:keydown={(e) => e.key === 'Enter' && confirmSavePreset()}
      />
      <div class="eq-modal-actions">
        <button class="btn-text-small" on:click={() => savePresetOpen = false}>{$_('settings.cancel')}</button>
        <button class="btn-secondary-small" on:click={confirmSavePreset} disabled={!savePresetName.trim()}>{$_('settings.save')}</button>
      </div>
    </div>
  </div>
{/if}