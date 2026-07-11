<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { equalizer, EQ_PRESETS, type FilterType } from "$lib/stores/equalizer";
  import { nativeAudioStop, nativeAudioSetReplayGainEnabled, nativeAudioListDevices, nativeAudioGetDeviceInfo, nativeAudioSetOutputDevice, type DeviceList, type AudioDeviceInfo } from "$lib/services/native-audio";
  import { html5SetReplayGainEnabled } from "$lib/services/html5-audio";
  import Icon from "$lib/components/Icon.svelte";
  import { onMount, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // Audio Backend state
  let initialAudioBackend = $appSettings.audioBackend;
  let showRefreshNotice = false;
  $: showRefreshNotice = $appSettings.audioBackend !== initialAudioBackend;
  $: outputDeviceDisabled = $appSettings.audioBackend === 'html5';

  let deviceList: DeviceList | null = null;
  let isLoadingDevices = false;
  let deviceDropdownOpen = false;
  let deviceDropdownRef: HTMLDivElement;
  let infoPopoverDevice: AudioDeviceInfo | null = null;

  function handleDeviceDropdownToggle() {
    if (outputDeviceDisabled) return;
    deviceDropdownOpen = !deviceDropdownOpen;
    if (deviceDropdownOpen) {
      handleLoadDevices();
    } else {
      infoPopoverDevice = null;
    }
  }

  function handleDeviceSelect(device: AudioDeviceInfo | null) {
    const requestedId = device?.id ?? null;
    const currentId = $appSettings.outputDevice ?? null;
    if (requestedId === currentId) {
      deviceDropdownOpen = false;
      infoPopoverDevice = null;
      return;
    }
    handleSetOutputDevice(requestedId);
    deviceDropdownOpen = false;
    infoPopoverDevice = null;
  }

  function handleDeviceDropdownKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      infoPopoverDevice = null;
      deviceDropdownOpen = false;
    }
  }

  function handleDeviceDropdownOutside(e: MouseEvent) {
    if (deviceDropdownRef && !deviceDropdownRef.contains(e.target as Node)) {
      deviceDropdownOpen = false;
      infoPopoverDevice = null;
    }
  }

  let isLoadingDevicesStore: boolean = false;

  async function handleLoadDevices() {
    if (isLoadingDevicesStore) return;
    isLoadingDevicesStore = true;
    isLoadingDevices = true;
    try {
      const freshList = await nativeAudioListDevices();
      deviceList = freshList;
    } catch (e) {
      console.warn('[AudioSection] Failed to load devices:', e);
      deviceList = null;
    } finally {
      isLoadingDevicesStore = false;
      isLoadingDevices = false;
    }
  }

  async function handleSetOutputDevice(device: string | null) {
    const previous = $appSettings.outputDevice;
    appSettings.setOutputDevice(device);
    try {
      await nativeAudioSetOutputDevice(device);
    } catch (e) {
      console.warn('[AudioSection] Failed to set output device:', e);
      appSettings.setOutputDevice(previous);
    }
  }

  async function handleToggleReplayGain() {
    const next = !$appSettings.replayGainEnabled;
    appSettings.setReplayGainEnabled(next);
    if ($appSettings.audioBackend === 'html5') {
      // html5 replay gain is applied synchronously via WebAudio
      html5SetReplayGainEnabled(next);
      return;
    }
    try {
      await nativeAudioSetReplayGainEnabled(next);
    } catch (e) {
      console.warn('[AudioSection] Failed to set replay gain:', e);
      appSettings.setReplayGainEnabled(!next);
    }
  }

  function handleRefresh() {
    nativeAudioStop();
    window.location.reload();
  }

  function formatEqGain(gain: number): string {
    const rounded = Math.round(gain * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
  }

  // eq band detail panel
  let selectedBandIndex: number | null = null;

  function toggleBandDetail(i: number) {
    selectedBandIndex = selectedBandIndex === i ? null : i;
  }

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

  // filter types where gain has no effect => slider is dimmed
  const GAINLESS_FILTERS = new Set<FilterType>(['lowPass', 'highPass', 'bandPass', 'notch', 'allPass']);

  // groups for the filter type picker in the band detail panel
  const FILTER_TYPE_GROUPS: { label: string; types: FilterType[] }[] = [
    { label: 'Gain', types: ['peaking', 'lowShelf', 'highShelf'] },
    { label: 'Filter', types: ['lowPass', 'highPass', 'bandPass', 'notch', 'allPass'] },
  ];

  // default band values
  const BAND_DEFAULTS: { gain: number; q: number; filterType: FilterType; enabled: boolean }[] = [
    { gain: 0, q: 0.707, filterType: 'lowShelf', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 1.41, filterType: 'peaking', enabled: true },
    { gain: 0, q: 0.707, filterType: 'highShelf', enabled: true },
  ];

  function resetBand(i: number) {
    const d = BAND_DEFAULTS[i];
    if (!d) return;
    equalizer.setBandGain(i, d.gain);
    equalizer.setBandQ(i, d.q);
    equalizer.setBandFilterType(i, d.filterType);
    equalizer.setBandEnabled(i, d.enabled);
  }

  function handleInfoClick(e: Event, device: AudioDeviceInfo) {
    e.stopPropagation();
    if (infoPopoverDevice?.id === device.id) {
      infoPopoverDevice = null;
    } else {
      infoPopoverDevice = device;
    }
  }

  function getDeviceIcon(device: AudioDeviceInfo): 'speaker' | 'headphone' {
    const type = device.device_type.toLowerCase();
    const name = device.name.toLowerCase();
    if (type.includes('headphone') || type.includes('headset') || name.includes('headphone') || name.includes('headset')) {
      return 'headphone';
    }
    return 'speaker';
  }

  onMount(async () => {
    if (!outputDeviceDisabled) {
      try {
        deviceList = await nativeAudioGetDeviceInfo();
      } catch (e) {
        console.warn('[AudioSection] Failed to load cached device info:', e);
      }
    }
  });
</script>

<svelte:window on:mousedown={handleDeviceDropdownOutside} />

<section class="settings-section" aria-labelledby="audio-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.audio', { default: 'Audio' })}</span>
      <span class="accordion-subtitle">{$_('settings.audioSubtitle', { default: 'Configure output devices, replay gain, and equalizer' })}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <!-- Output Driver -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.outputDriver', { default: 'Output driver' })}</span>
          <span class="setting-description">{$_('settings.outputDriverDesc', { default: 'Select the backend for audio playback' })}</span>
          <div class="segmented-pill" style="margin-top: 6px;">
            <button class="segment-btn" class:active={$appSettings.audioBackend === 'auto'} on:click={() => appSettings.setAudioBackend('auto')}>{$_('settings.auto', { default: 'Auto' })}</button>
            <button class="segment-btn" class:active={$appSettings.audioBackend === 'native'} on:click={() => appSettings.setAudioBackend('native')}>{$_('settings.native', { default: 'Native' })}</button>
            <button class="segment-btn" class:active={$appSettings.audioBackend === 'html5'} on:click={() => appSettings.setAudioBackend('html5')}>{$_('settings.html5', { default: 'HTML5' })}</button>
          </div>
          {#if showRefreshNotice}
            <div class="refresh-notice">
              <Icon name="info" size="xs" />
              <span>{$_('settings.restartRequired', { default: 'Audio backend change requires restart' })}</span>
              <button class="refresh-btn" on:click={handleRefresh}>
                <Icon name="refresh" size="sm" />{$_('settings.refresh', { default: 'Refresh' })}
              </button>
            </div>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- Output Device -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.outputDevice', { default: 'Output device' })}</span>
          <span class="setting-description">{$_('settings.outputDeviceDesc', { default: 'Select audio output device' })}</span>
          <div class="device-dropdown-wrapper" role="listbox" aria-label="Output device" aria-disabled={outputDeviceDisabled}>
            <div class="custom-dropdown" class:disabled={outputDeviceDisabled} bind:this={deviceDropdownRef}>
              <button
                class="dropdown-selected"
                on:click={handleDeviceDropdownToggle}
                disabled={outputDeviceDisabled}
                aria-expanded={deviceDropdownOpen}
              >
                {#if $appSettings.outputDevice}
                  {($appSettings.outputDevice.length > 43) ? $appSettings.outputDevice.slice(0, 43) + '...' : $appSettings.outputDevice}
                {:else}
                  {$_('settings.defaultDevice', { default: 'System default' })}
                {/if}
                <svg class="dropdown-chevron" class:rotated={deviceDropdownOpen} viewBox="0 0 24 24" width="14" height="14">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
              </button>
              {#if deviceDropdownOpen}
                <div class="dropdown-menu" on:keydown={handleDeviceDropdownKeydown} role="listbox">
                  {#if isLoadingDevices}
                    <div class="dropdown-item loading-item">
                      <Icon name="loader" size="sm" />
                      <span>{$_('settings.loadingDevices', { default: 'Loading devices...' })}</span>
                    </div>
                  {:else if deviceList && deviceList.devices && deviceList.devices.length > 0}
                    <button
                      class="dropdown-item"
                      class:selected={!$appSettings.outputDevice}
                      on:click={() => handleDeviceSelect(null)}
                      role="option"
                      aria-selected={!$appSettings.outputDevice}
                    >
                      <Icon name="speaker" size="xs" />
                      <span class="device-item-name">{$_('settings.systemDefault', { default: 'System default' })}</span>
                    </button>
                    {#each deviceList.devices as device (device.id)}
                      <div class="dropdown-item-wrapper">
                        <button
                          class="dropdown-item"
                          class:selected={$appSettings.outputDevice === device.id}
                          on:click={() => handleDeviceSelect(device)}
                          role="option"
                          aria-selected={$appSettings.outputDevice === device.id}
                        >
                          <Icon name={getDeviceIcon(device)} size="xs" />
                          <span class="device-item-name">{device.extended[0] ?? device.name}</span>
                          <span
                            class="device-info-button"
                            class:active={infoPopoverDevice?.id === device.id}
                            on:click={(e) => handleInfoClick(e, device)}
                            role="button"
                            aria-label="Device info"
                            tabindex="0"
                            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleInfoClick(e, device); }}
                          >i</span>
                          {#if infoPopoverDevice?.id === device.id}
                            <div class="device-info-popover" role="tooltip">
                              <div class="device-info-primary">{device.extended[0] ?? device.name}</div>
                              {#if device.driver}<div class="device-info-row"><span class="device-info-label">Driver</span><span>{device.driver}</span></div>{/if}
                              {#if device.manufacturer}<div class="device-info-row"><span class="device-info-label">Manufacturer</span><span>{device.manufacturer}</span></div>{/if}
                              <div class="device-info-row"><span class="device-info-label">Interface</span><span>{device.interface_type}</span></div>
                              <div class="device-info-row"><span class="device-info-label">Type</span><span>{device.device_type}</span></div>
                              {#if device.address}<div class="device-info-row"><span class="device-info-label">Address</span><span>{device.address}</span></div>{/if}
                              <div class="device-info-id">{device.id}</div>
                            </div>
                          {/if}
                        </button>
                      </div>
                    {/each}
                  {:else}
                    <div class="dropdown-item empty-item">
                      <span>{$_('settings.noDevices', { default: 'No devices found' })}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Replay Gain -->
        <div class="inner-section">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.replayGain', { default: 'Replay Gain' })}</span>
              <span class="setting-description">{$_('settings.replayGainDesc', { default: 'Normalize playback volume across tracks' })}</span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.replayGainEnabled}
              on:click={handleToggleReplayGain}
              role="switch"
              aria-checked={$appSettings.replayGainEnabled}
              aria-label="Toggle Replay Gain"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Crossfade -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.crossfade', { default: 'Crossfade' })}</span>
          <span class="setting-description">{$_('settings.crossfadeDesc', { default: 'Transition between tracks by fading out the current song and fading in the next' })}</span>
          <div class="crossfade-slider">
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={$appSettings.crossfadeSeconds}
              style="--eq-fill: {($appSettings.crossfadeSeconds / 12 * 100).toFixed(1)}%"
              on:input={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                appSettings.setCrossfadeSeconds(val);
              }}
              aria-label="Crossfade duration"
            />
            <span style="font-size: 0.85rem; color: var(--text-secondary); width: 32px; text-align: right; font-weight: 500;">
              {$appSettings.crossfadeSeconds === 0 ? $_('settings.off', { default: 'Off' }) : `${$appSettings.crossfadeSeconds}s`}
            </span>
          </div>
        </div>

        <!-- Equalizer -->
        <div class="inner-section">
          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.equalizer', { default: 'Equalizer' })}</span>
              <span class="setting-description">{$_('settings.equalizerDesc', { default: 'Adjust frequency response' })}</span>
            </div>
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
          {#if $equalizer.enabled}
            <div class="eq-controls">
              <div class="eq-bands">
                {#each $equalizer.bands as band, i}
                  <div class="eq-band">
                    <button
                      class="eq-band-label eq-band-label-btn"
                      class:active={selectedBandIndex === i}
                      class:bypassed={!band.enabled}
                      on:click={() => toggleBandDetail(i)}
                      title="Edit {band.label} band settings"
                      aria-expanded={selectedBandIndex === i}
                      aria-label="{band.label}: {FILTER_TYPE_LABELS[band.filterType]}, Q {band.q.toFixed(2)}{band.enabled ? '' : ' (bypassed)'}"
                    >
                      {band.label}
                    </button>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={band.gain}
                      disabled={!band.enabled || GAINLESS_FILTERS.has(band.filterType)}
                      style="--eq-fill: {((band.gain + 12) / 24 * 100).toFixed(1)}%"
                      on:input={(e) => {
                        const val = parseFloat(e.currentTarget.value);
                        equalizer.setBandGain(i, val);
                      }}
                      aria-label="{band.frequency} band"
                    />
                    <span class="eq-band-value">
                      {GAINLESS_FILTERS.has(band.filterType) ? 'Q ' + band.q.toFixed(1) : formatEqGain(band.gain)}
                    </span>
                  </div>
                {/each}
              </div>

              {#if selectedBandIndex !== null}
                {@const selBand = $equalizer.bands[selectedBandIndex]}
                {@const gainless = GAINLESS_FILTERS.has(selBand.filterType)}
                <div class="eq-band-detail" role="region" aria-label="Band detail for {selBand.label}">
                  <div class="eq-band-detail-header">
                    <div class="eq-detail-title-group">
                      <span class="setting-title">{selBand.label}</span>
                      <span class="eq-detail-subtitle">
                        {#if gainless}
                          {FILTER_TYPE_LABELS[selBand.filterType]} · Q {selBand.q.toFixed(2)}
                        {:else}
                          {selBand.gain > 0 ? '+' : ''}{selBand.gain.toFixed(1)} dB · Q {selBand.q.toFixed(2)}
                        {/if}
                      </span>
                    </div>
                    <div class="eq-detail-header-actions">
                      <button
                        class="btn-text-small eq-reset-band-btn"
                        on:click={() => resetBand(selectedBandIndex!)}
                        title="Reset this band to default"
                        aria-label="Reset {selBand.label} band to default"
                      >
                        Reset
                      </button>
                      <button
                        class="toggle-btn toggle-btn-sm"
                        class:active={selBand.enabled}
                        on:click={() => equalizer.setBandEnabled(selectedBandIndex!, !selBand.enabled)}
                        role="switch"
                        aria-checked={selBand.enabled}
                        aria-label="{selBand.enabled ? 'Bypass' : 'Enable'} {selBand.label} band"
                        title="{selBand.enabled ? 'Bypass' : 'Enable'} band"
                      >
                        <div class="toggle-handle"></div>
                      </button>
                      <button class="btn-text-small" on:click={() => selectedBandIndex = null} aria-label="Close band detail">✕</button>
                    </div>
                  </div>

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
                      aria-label="Q factor for {selBand.label}"
                      aria-valuemin="0.1"
                      aria-valuemax="10"
                      aria-valuenow={selBand.q}
                    />
                    <div class="eq-q-range-labels" aria-hidden="true">
                      <span>Wide</span>
                      <span>Narrow</span>
                    </div>
                  </div>

                  {#if gainless}
                    <p class="eq-gainless-note">Gain slider has no effect for {FILTER_TYPE_LABELS[selBand.filterType]} — adjust frequency and Q only.</p>
                  {/if}
                </div>
              {/if}

              <!-- preamp -->
              <div class="eq-band-detail-row eq-preamp-row">
                <label class="eq-detail-label" for="eq-preamp">
                  Preamp
                  <span class="eq-q-value">{$equalizer.preampDb > 0 ? '+' : ''}{$equalizer.preampDb.toFixed(1)} dB</span>
                </label>
                <input
                  id="eq-preamp"
                  type="range"
                  class="eq-q-slider"
                  min="-24"
                  max="6"
                  step="0.5"
                  value={$equalizer.preampDb}
                  on:input={(e) => equalizer.setPreampDb(parseFloat(e.currentTarget.value))}
                  aria-label="Preamp gain"
                  aria-valuemin="-24"
                  aria-valuemax="6"
                  aria-valuenow={$equalizer.preampDb}
                />
                <div class="eq-q-range-labels" aria-hidden="true">
                  <span>−24 dB</span>
                  <span>+6 dB</span>
                </div>
              </div>

              <div class="eq-presets">
                <span class="eq-presets-label">{$_('settings.presets', { default: 'Presets' })}</span>
                <div class="eq-preset-pills">
                  {#each EQ_PRESETS as preset}
                    <button
                      class="preset-pill"
                      class:active={$equalizer.currentPreset === preset.name}
                      on:click={() => { equalizer.applyPreset(preset.name); selectedBandIndex = null; }}
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>
