<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { equalizer } from "$lib/stores/equalizer";
  import { nativeAudioStop, nativeAudioSetReplayGainEnabled, nativeAudioSetLimiterEnabled, nativeAudioListDevices, nativeAudioGetDeviceInfo, nativeAudioSetOutputDevice, type DeviceList, type AudioDeviceInfo } from "$lib/services/native-audio";
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

  // limiter is native/rodio-only - no WebAudio equivalent
  // +hidden entirely on the html5 backend
  async function handleToggleLimiter() {
    const next = !$appSettings.limiterEnabled;
    appSettings.setLimiterEnabled(next);
    try {
      await nativeAudioSetLimiterEnabled(next);
    } catch (e) {
      console.warn('[AudioSection] Failed to set limiter:', e);
      appSettings.setLimiterEnabled(!next);
    }
  }

  function handleRefresh() {
    nativeAudioStop();
    window.location.reload();
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

        {#if $appSettings.audioBackend !== 'html5'}
          <div class="divider"></div>

          <!-- limiter - native/rodio only, no html5 equivalent -->
          <div class="inner-section">
            <div class="toggle-container">
              <div class="toggle-info">
                <span class="setting-title">{$_('settings.limiter', { default: 'Safety Limiter' })}</span>
                <span class="setting-description">{$_('settings.limiterDesc', { default: 'Prevent clipping from Replay Gain and EQ boosts. Turning this off plays audio completely unprocessed, which can distort if Replay Gain or EQ push a track past full volume.' })}</span>
              </div>
              <button
                class="toggle-btn"
                class:active={$appSettings.limiterEnabled}
                on:click={handleToggleLimiter}
                role="switch"
                aria-checked={$appSettings.limiterEnabled}
                aria-label="Toggle Safety Limiter"
              >
                <div class="toggle-handle"></div>
              </button>
            </div>
          </div>
        {/if}

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

          <div class="eq-compact-preview" class:dimmed={!$equalizer.enabled}>
            <div class="eq-compact-bars" aria-hidden="true">
              {#each $equalizer.bands as band}
                <div
                  class="eq-compact-bar"
                  class:bypassed={!band.enabled}
                  style="--bar-h: {Math.max(4, ((band.gain + 12) / 24) * 100)}%"
                ></div>
              {/each}
            </div>
            <div class="eq-compact-info">
              <span>{$equalizer.currentPreset ?? 'Custom'}</span>
              <span class="eq-compact-band-count">{$equalizer.bands.length} bands</span>
            </div>
            <button class="btn-secondary-small" on:click={() => dispatch('openEqEditor')}>
              Customize Equalizer
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
