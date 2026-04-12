<script lang="ts">
  import { fade, fly, slide } from "svelte/transition";
  import { wsStore, type RemoteDevice } from "$lib/stores/websocket";
  import { currentTrack, isPlaying, transferPlayback, sendRemoteCommand } from "$lib/stores/player";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  $: devices = $wsStore.devices;

  function close() {
    dispatch("close");
  }

  function handleTransfer(device: RemoteDevice) {
    if (device.playerState) {
      transferPlayback(device.playerState);
      close();
    }
  }

  function handleRemoteCommand(deviceId: string, command: string) {
    sendRemoteCommand(deviceId, command);
  }
</script>

<div class="connect-overlay" on:click|self={close} transition:fade={{ duration: 200 }}>
  <div class="connect-panel" in:fly={{ y: 20, duration: 300, opacity: 0 }} out:fly={{ y: 20, duration: 200, opacity: 0 }}>
    <header>
      <h2>Connect to a device</h2>
      <button class="close-btn" on:click={close} aria-label="Close">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div class="current-device">
      <div class="device-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
        </svg>
      </div>
      <div class="device-info">
        <span class="device-name">This Device</span>
        <span class="device-status">Listening locally</span>
      </div>
      {#if $isPlaying}
        <div class="playing-bars">
          <div class="bar"></div>
          <div class="bar"></div>
          <div class="bar"></div>
        </div>
      {/if}
    </div>

    <div class="divider">
      <span>Available Devices</span>
    </div>

    <div class="device-list">
      {#if devices.length === 0}
        <div class="empty-state">
          <p>No other devices found</p>
          <span>Open Audion on your phone or another computer to see them here.</span>
        </div>
      {:else}
        {#each devices as device}
          <div class="device-item" class:is-playing={device.playerState?.isPlaying}>
            <div class="device-icon-small">
              {#if device.deviceName.toLowerCase().includes("phone") || device.deviceName.toLowerCase().includes("android") || device.deviceName.toLowerCase().includes("iphone")}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
                </svg>
              {:else if device.deviceName.toLowerCase().includes("web") || device.deviceName.toLowerCase().includes("browser")}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.91-4.33-3.56zm2.95-8H5.08c.96-1.65 2.49-2.93 4.33-3.56-.6 1.11-1.06 2.31-1.38 3.56zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                </svg>
              {/if}
            </div>
            <div class="device-details">
              <span class="name">{device.deviceName}</span>
              {#if device.playerState?.track}
                <span class="now-playing">
                    {device.playerState.isPlaying ? "Playing:" : "Paused:"} {device.playerState.track.title}
                </span>
              {:else}
                <span class="device-status">Ready to play</span>
              {/if}
            </div>

            <div class="actions">
              {#if device.playerState?.track}
                <div class="remote-controls">
                  <button on:click={() => handleRemoteCommand(device.deviceId, 'previous')} title="Previous">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                  </button>
                  <button on:click={() => handleRemoteCommand(device.deviceId, device.playerState?.isPlaying ? 'pause' : 'play')} class="play-pause">
                    {#if device.playerState?.isPlaying}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    {:else}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    {/if}
                  </button>
                  <button on:click={() => handleRemoteCommand(device.deviceId, 'next')} title="Next">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                  </button>
                </div>

                <button class="transfer-btn" on:click={() => handleTransfer(device)}>
                  Play Here
                </button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="footer">
        <div class="sync-status" class:online={$wsStore.connected}>
            <div class="indicator"></div>
            {$wsStore.connected ? 'Real-time sync active' : 'Connecting to server...'}
        </div>
    </div>
  </div>
</div>

<style>
  .connect-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .connect-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    width: 420px;
    max-width: 90vw;
    padding: var(--spacing-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-full);
    display: flex;
    transition: all var(--transition-fast);
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .current-device {
    background: linear-gradient(135deg, var(--accent-subtle), rgba(var(--accent-primary-rgb), 0.05));
    border: 1px solid var(--accent-subtle);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  /* Fallback if rgb variable not present */
  .current-device {
    background: linear-gradient(135deg, var(--accent-subtle), rgba(29, 185, 84, 0.05));
  }

  .device-icon {
    width: 48px;
    height: 48px;
    background: var(--accent-subtle);
    color: var(--accent-primary);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .device-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .device-name {
    font-weight: 600;
    color: var(--text-primary);
  }

  .device-status {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .playing-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 16px;
  }

  .bar {
    width: 3px;
    background: var(--accent-primary);
    animation: bar-dance 1s infinite alternate;
  }

  @keyframes bar-dance {
    from { height: 4px; }
    to { height: 16px; }
  }

  .bar:nth-child(2) { animation-delay: 0.2s; }
  .bar:nth-child(3) { animation-delay: 0.4s; }

  .divider {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    color: var(--text-subdued);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border-color);
    opacity: 0.5;
  }

  .device-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    max-height: 300px;
    overflow-y: auto;
  }

  .empty-state {
    text-align: center;
    padding: var(--spacing-lg) var(--spacing-md);
  }

  .empty-state p {
    color: var(--text-primary);
    margin: 0 0 var(--spacing-xs) 0;
    font-weight: 600;
  }

  .empty-state span {
    font-size: 0.85rem;
    color: var(--text-subdued);
    line-height: 1.4;
  }

  .device-item {
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    transition: all var(--transition-fast);
  }

  .device-item:hover {
    background: var(--bg-highlight);
    border-color: var(--border-color);
  }

  .device-item.is-playing {
    border-color: var(--accent-subtle);
  }

  .device-icon-small {
    width: 36px;
    height: 36px;
    background: var(--bg-highlight);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .device-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-playing {
    font-size: 0.75rem;
    color: var(--accent-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .remote-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: var(--spacing-sm);
  }

  .remote-controls button {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: var(--spacing-xs);
    border-radius: var(--radius-sm);
    display: flex;
    transition: all var(--transition-fast);
  }

  .remote-controls button:hover {
    background: var(--accent-subtle);
    color: var(--accent-primary);
  }

  .remote-controls .play-pause {
    background: var(--accent-subtle);
    color: var(--accent-primary);
  }

  .transfer-btn {
    background: var(--accent-primary);
    color: var(--bg-base);
    border: none;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--transition-fast), background var(--transition-fast);
  }

  .transfer-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .footer {
      border-top: 1px solid var(--border-color);
      padding-top: var(--spacing-md);
      opacity: 0.8;
  }

  .sync-status {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 0.75rem;
      color: var(--text-subdued);
  }

  .sync-status .indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-subdued);
  }

  .sync-status.online {
      color: var(--accent-primary);
  }

  .sync-status.online .indicator {
      background: var(--accent-primary);
      box-shadow: 0 0 10px var(--accent-primary);
  }
</style>
