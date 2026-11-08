<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { equalizer } from "$lib/stores/equalizer";
  import {
    nativeAudioStop,
    nativeAudioSetReplayGainEnabled,
    nativeAudioSetLimiterEnabled,
    nativeAudioListDevices,
    nativeAudioGetDeviceInfo,
    nativeAudioSetOutputDevice,
    type DeviceList,
    type AudioDeviceInfo,
  } from "$lib/services/native-audio";
  import { html5SetReplayGainEnabled } from "$lib/services/html5-audio";
  import Icon from "$lib/components/Icon.svelte";
  import { onMount } from "svelte";
  import { createEventDispatcher } from "svelte";
  import SettingRow from "./SettingRow.svelte";
  import SettingToggle from "./SettingToggle.svelte";

  export let open: boolean = true;
  const dispatch = createEventDispatcher();

  // Audio Backend state
  let initialAudioBackend = $appSettings.audioBackend;
  let showRefreshNotice = false;
  $: showRefreshNotice = $appSettings.audioBackend !== initialAudioBackend;
  $: outputDeviceDisabled = $appSettings.audioBackend === 'html5';

  let deviceList: DeviceList | null = null;
  let isLoadingDevices = false;
  let deviceDropdownOpen = false;
  let deviceDropdownRef: HTMLDivElement | null = null;
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
      deviceDropdownOpen = false;
      infoPopoverDevice = null;
    }
  }

  function handleDeviceDropdownOutside(e: MouseEvent) {
    if (deviceDropdownRef && !deviceDropdownRef.contains(e.target as Node)) {
      deviceDropdownOpen = false;
      infoPopoverDevice = null;
    }
  }

  async function handleLoadDevices() {
    if (isLoadingDevices) return;
    isLoadingDevices = true;
    try {
      deviceList = await nativeAudioListDevices();
    } catch (e) {
      console.warn('[AudioSection] Failed to list devices:', e);
    } finally {
      isLoadingDevices = false;
    }
  }

  async function handleSetOutputDevice(deviceId: string | null) {
    try {
      await nativeAudioSetOutputDevice(deviceId);
      appSettings.setOutputDevice(deviceId);
    } catch (e) {
      console.warn('[AudioSection] Failed to set output device:', e);
    }
  }

  function handleToggleReplayGain(checked: boolean) {
    appSettings.setReplayGainEnabled(checked);
    if ($appSettings.audioBackend === 'html5') {
      html5SetReplayGainEnabled(checked);
    } else {
      nativeAudioSetReplayGainEnabled(checked).catch(e => {
        console.warn('[AudioSection] Failed to set replay gain:', e);
      });
    }
  }

  function handleToggleLimiter(checked: boolean) {
    appSettings.setLimiterEnabled(checked);
    if ($appSettings.audioBackend !== 'html5') {
      nativeAudioSetLimiterEnabled(checked).catch(e => {
        console.warn('[AudioSection] Failed to set limiter:', e);
      });
    }
  }

  function handleRefresh() {
    window.location.reload();
  }

  function handleInfoClick(e: Event | undefined, device: AudioDeviceInfo) {
    if (e && 'stopPropagation' in e) e.stopPropagation();
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
  <div class="settings-card">
    <!-- 1. Output Driver -->
    <SettingRow
      id="setting-output-driver"
      label={$_('settings.outputDriver', { default: 'Output driver' })}
      description={$_('settings.outputDriverDesc', { default: 'Select playback engine. Native uses direct OS audio buffers.' })}
    >
      <div class="driver-control-wrap">
        <div class="segmented-pill">
          <button
            type="button"
            class="segment-btn"
            class:active={$appSettings.audioBackend === 'auto'}
            on:click={() => appSettings.setAudioBackend('auto')}
          >
            {$_('settings.auto', { default: 'Auto' })}
          </button>
          <button
            type="button"
            class="segment-btn"
            class:active={$appSettings.audioBackend === 'native'}
            on:click={() => appSettings.setAudioBackend('native')}
          >
            {$_('settings.native', { default: 'Native' })}
          </button>
          <button
            type="button"
            class="segment-btn"
            class:active={$appSettings.audioBackend === 'html5'}
            on:click={() => appSettings.setAudioBackend('html5')}
          >
            {$_('settings.html5', { default: 'HTML5' })}
          </button>
        </div>
        {#if showRefreshNotice}
          <div class="refresh-notice">
            <Icon name="info" size="xs" />
            <span>{$_('settings.restartRequired', { default: 'Restart required' })}</span>
            <button type="button" class="refresh-btn" on:click={handleRefresh}>
              <Icon name="refresh" size="sm" />
              <span>{$_('settings.refresh', { default: 'Reload' })}</span>
            </button>
          </div>
        {/if}
      </div>
    </SettingRow>

    <!-- 2. Output Device -->
    <SettingRow
      id="setting-output-device"
      label={$_('settings.outputDevice', { default: 'Output device' })}
      description={$_('settings.outputDeviceDesc', { default: 'Choose speakers, headphones, or external sound card.' })}
      disabled={outputDeviceDisabled}
      disabledReason="Requires Native or Rodio driver"
    >
      <div class="device-dropdown-wrap" bind:this={deviceDropdownRef}>
        <button
          type="button"
          class="device-dropdown-trigger"
          class:open={deviceDropdownOpen}
          on:click={handleDeviceDropdownToggle}
          disabled={outputDeviceDisabled}
          aria-expanded={deviceDropdownOpen}
          aria-label={$_('settings.outputDevice', { default: 'Output device' })}
        >
          <span class="device-dropdown-label">
            {#if $appSettings.outputDevice}
              {($appSettings.outputDevice.length > 28) ? $appSettings.outputDevice.slice(0, 28) + '...' : $appSettings.outputDevice}
            {:else}
              {$_('settings.defaultDevice', { default: 'System default' })}
            {/if}
          </span>
          <span class="device-dropdown-chevron" class:rotated={deviceDropdownOpen}>
            <Icon name="chevron-down" size={12} />
          </span>
        </button>

        {#if deviceDropdownOpen}
          <div class="device-dropdown-menu" on:keydown={handleDeviceDropdownKeydown} role="listbox">
            {#if isLoadingDevices}
              <div class="device-dropdown-item loading-item">
                <Icon name="loader" size="sm" />
                <span>{$_('settings.loadingDevices', { default: 'Scanning audio devices...' })}</span>
              </div>
            {:else if deviceList && deviceList.devices && deviceList.devices.length > 0}
              <div
                class="device-dropdown-item"
                class:selected={!$appSettings.outputDevice}
                role="option"
                aria-selected={!$appSettings.outputDevice}
                tabindex="0"
                on:click={() => handleDeviceSelect(null)}
                on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDeviceSelect(null); }}
              >
                <Icon name="speaker" size="xs" />
                <span class="device-item-name">{$_('settings.systemDefault', { default: 'System default' })}</span>
              </div>
              {#each deviceList.devices as device (device.id)}
                <div
                  class="device-dropdown-item"
                  class:selected={$appSettings.outputDevice === device.id}
                  role="option"
                  aria-selected={$appSettings.outputDevice === device.id}
                  tabindex="0"
                  on:click={() => handleDeviceSelect(device)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDeviceSelect(device); }}
                >
                  <Icon name={getDeviceIcon(device)} size="xs" />
                  <span class="device-item-name">{device.extended[0] ?? device.name}</span>
                  <span
                    class="device-info-pill"
                    class:active={infoPopoverDevice?.id === device.id}
                    on:click={(e) => handleInfoClick(e, device)}
                    role="button"
                    tabindex="0"
                    aria-label="Device information"
                    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleInfoClick(e, device); }}
                  >i</span>
                  {#if infoPopoverDevice?.id === device.id}
                    <div class="device-info-popover" role="tooltip">
                      <div class="device-info-primary">{device.extended[0] ?? device.name}</div>
                      {#if device.driver}<div class="device-info-row"><span class="device-info-label">Driver</span><span>{device.driver}</span></div>{/if}
                      <div class="device-info-row"><span class="device-info-label">Interface</span><span>{device.interface_type}</span></div>
                      <div class="device-info-row"><span class="device-info-label">Type</span><span>{device.device_type}</span></div>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="device-dropdown-item empty-item">
                <span>{$_('settings.noDevices', { default: 'No devices found' })}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </SettingRow>

    <!-- 3. Crossfade -->
    <SettingRow
      id="setting-crossfade"
      label={$_('settings.crossfade', { default: 'Crossfade' })}
      description={$_('settings.crossfadeDesc', { default: 'Fade out smoothly as the next track begins.' })}
    >
      <div class="crossfade-control">
        <input
          type="range"
          min="0"
          max="12"
          step="1"
          class="setting-slider"
          value={$appSettings.crossfadeSeconds}
          on:input={(e) => {
            const val = parseInt(e.currentTarget.value, 10);
            appSettings.setCrossfadeSeconds(val);
          }}
          aria-label={$_('settings.crossfadeDuration', { default: 'Crossfade duration' })}
        />
        <span class="slider-value-display">
          {$appSettings.crossfadeSeconds === 0 ? $_('settings.off', { default: 'Off' }) : `${$appSettings.crossfadeSeconds} s`}
        </span>
      </div>
    </SettingRow>

    <!-- 4. ReplayGain -->
    <SettingRow
      id="setting-replay-gain"
      label={$_('settings.replayGain', { default: 'ReplayGain' })}
      description={$_('settings.replayGainDesc', { default: 'Normalizes track volume so loud and quiet songs sound consistent.' })}
    >
      <SettingToggle
        checked={$appSettings.replayGainEnabled}
        label={$_('settings.toggleReplayGain', { default: 'Toggle ReplayGain' })}
        on:change={(e) => handleToggleReplayGain(e.detail)}
      />
    </SettingRow>

    <!-- 5. Safety Limiter -->
    {#if $appSettings.audioBackend !== 'html5'}
      <SettingRow
        id="setting-limiter"
        label={$_('settings.limiter', { default: 'Safety Limiter' })}
        description={$_('settings.limiterDesc', { default: 'Prevents clipping and distortion from volume boosts and EQ gains.' })}
      >
        <SettingToggle
          checked={$appSettings.limiterEnabled}
          label={$_('settings.toggleLimiter', { default: 'Toggle Safety Limiter' })}
          on:change={(e) => handleToggleLimiter(e.detail)}
        />
      </SettingRow>
    {/if}

    <!-- 6. Equalizer -->
    <SettingRow
      id="setting-equalizer"
      label={$_('settings.equalizer', { default: 'Equalizer' })}
      description={$_('settings.equalizerDesc', { default: 'Fine-tune audio frequencies across customizable frequency bands.' })}
    >
      <div class="eq-control-group">
        <button
          type="button"
          class="btn-customize-eq"
          on:click={() => dispatch('openEqEditor')}
        >
          <Icon name="sliders" size={14} />
          <span>{$_('settings.customizeEqualizer', { default: 'Configure' })}</span>
        </button>
        <SettingToggle
          checked={$equalizer.enabled}
          label={$_('settings.toggleEqualizer', { default: 'Toggle Equalizer' })}
          on:change={(e) => equalizer.setEnabled(e.detail)}
        />
      </div>
    </SettingRow>
  </div>
</section>

<style>
  .settings-section {
    margin-bottom: var(--spacing-md, 16px);
  }

  .settings-card {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-color);
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .driver-control-wrap {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .segmented-pill {
    display: inline-flex;
    padding: 3px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    gap: 2px;
  }

  .segment-btn {
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .segment-btn:hover {
    color: var(--text-primary);
  }

  .segment-btn.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .refresh-notice {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-subdued);
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--bg-highlight);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
  }

  .device-dropdown-wrap {
    position: relative;
    width: 220px;
  }

  .device-dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .device-dropdown-trigger:hover:not(:disabled),
  .device-dropdown-trigger.open {
    border-color: var(--accent-primary);
  }

  .device-dropdown-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .device-dropdown-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .device-dropdown-chevron {
    color: var(--text-subdued);
    transition: transform var(--transition-fast);
    display: flex;
    align-items: center;
  }

  .device-dropdown-chevron.rotated {
    transform: rotate(180deg);
  }

  .device-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    max-height: 240px;
    overflow-y: auto;
    z-index: 100;
    padding: 4px;
  }

  .device-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
    position: relative;
  }

  .device-dropdown-item:hover,
  .device-dropdown-item:focus {
    background: var(--bg-highlight);
    color: var(--text-primary);
    outline: none;
  }

  .device-dropdown-item.selected {
    color: var(--accent-primary);
    font-weight: 500;
  }

  .device-item-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .device-info-pill {
    font-size: 11px;
    font-style: italic;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-surface);
    color: var(--text-subdued);
    border: 1px solid var(--border-color);
  }

  .device-info-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    width: 240px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    z-index: 150;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .device-info-primary {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .device-info-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
  }

  .crossfade-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .setting-slider {
    width: 140px;
    height: 6px;
    border-radius: 3px;
    appearance: none;
    background: var(--bg-highlight);
    outline: none;
    cursor: pointer;
  }

  .setting-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }

  .slider-value-display {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    min-width: 32px;
    text-align: right;
  }

  .eq-control-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .btn-customize-eq {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-customize-eq:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
</style>
