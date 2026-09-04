<script lang="ts">
  import { _ } from "svelte-i18n";
  import { fade, fly } from "svelte/transition";
  import { get } from "svelte/store";
  import { currentTrack, addToQueue } from "$lib/stores/player";
  import { contextMenu, toggleFullScreen } from "$lib/stores/ui";
  import { likedTrackIds } from "$lib/stores/liked";
  import { playlists, loadLibrary } from "$lib/stores/library";
  import { confirm } from "$lib/stores/dialogs";
  import { addToast } from "$lib/stores/toast";
  import { wsStore } from "$lib/stores/websocket";
  import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
  import { formatArtists } from "$lib/utils/artists";
  import Icon from "$lib/components/Icon.svelte";
  import {
    sleepTimerActive,
    sleepTimerRemainingMs,
    SLEEP_TIMER_PRESETS,
    startSleepTimer,
    stopSleepTimer,
  } from "$lib/stores/sleepTimer";
  import {
    addTrackToPlaylist,
    deleteTrack,
  } from "$lib/api/tauri";

  export let showMobileMenu = false;
  export let showConnectPanel = false;
  export let albumArt: string | null = null;

  $: connectedDevices = $wsStore.devices.length;

  async function showTrackMenu(
    e: MouseEvent | PointerEvent,
    onlyAddToPlaylist = false,
  ) {
    const track = $currentTrack;
    if (!track) return;

    e.preventDefault();
    e.stopPropagation();

    const playlistItems = $playlists.map((playlist) => ({
      label: playlist.name,
      action: async () => {
        try {
          await addTrackToPlaylist(playlist.id, track.id);
          addToast($_('player.addedToPlaylist', { values: { name: playlist.name } }), "success");
        } catch (error) {
          console.error("Failed to add track to playlist:", error);
          addToast($_('player.addToPlaylistFailed'), "error");
        }
      },
    }));

    const menuItems: any[] = [
      {
        label: $_('contextMenu.addToQueue'),
        action: () => {
          addToQueue([track]);
          addToast($_('player.addedToQueue'), "success");
        },
      },
      { type: "separator" },
      {
        label: $_('contextMenu.addToPlaylist'),
        submenu:
          playlistItems.length > 0
            ? playlistItems
            : [
                {
                  label: $_('contextMenu.noPlaylists'),
                  action: () => {},
                  disabled: true,
                },
              ],
      },
      { type: "separator" },
      {
        label: $_('contextMenu.deleteFromLibrary'),
        danger: true,
        action: async () => {
          const confirmed = await confirm(
            $_('player.deleteTrackConfirm', { values: { title: track.title } }),
            {
              title: $_('player.deleteTrackTitle'),
              confirmLabel: $_('player.delete'),
              danger: true,
            },
          );

          if (!confirmed) return;

          try {
            await deleteTrack(track.id);
            await loadLibrary();
            toggleFullScreen(); // Close player if track is deleted
          } catch (error) {
            console.error("Failed to delete track:", error);
          }
        },
      },
    ];

    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: onlyAddToPlaylist
        ? [
            {
              label: $_('contextMenu.addToPlaylist'),
              submenu:
                playlistItems.length > 0
                  ? playlistItems
                  : [
                      {
                        label: $_('contextMenu.noPlaylists'),
                        action: () => {},
                        disabled: true,
                      },
                    ],
            },
          ]
        : menuItems,
    });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="mobile-menu-backdrop"
  on:click={() => (showMobileMenu = false)}
  transition:fade={{ duration: 200 }}
  role="presentation"
>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="mobile-menu-sheet"
    on:click|stopPropagation
    transition:fly={{ y: 300, duration: 300 }}
    role="dialog"
    tabindex="-1"
  >
    <div class="sheet-handle"></div>

    {#if $currentTrack}
      <div class="sheet-track-info">
        {#key $currentTrack.id}
          {#if albumArt}
            <img class="sheet-art" in:fly={{ x: 20, duration: 250 }} src={albumArt} alt="Cover" />
          {:else}
            <div class="sheet-art sheet-art-placeholder" in:fly={{ x: 20, duration: 250 }}>
              <Icon name="music" size={20} />
            </div>
          {/if}
        {/key}
        <div class="sheet-track-details">
          <span class="sheet-track-title">{$currentTrack.title || $_('player.unknownTitle')}</span>
          <span class="sheet-track-artist">{formatArtists($currentTrack.artists) || $currentTrack.artist || $_('common.unknownArtist')}</span>
        </div>
      </div>
    {/if}

    <div class="sheet-divider"></div>

    <!-- Go to Artist -->
    {#if $currentTrack?.artists && $currentTrack.artists.length > 1}
      {#each $currentTrack.artists as artistName (artistName)}
        <button
          class="sheet-item"
          on:click={() => {
            showMobileMenu = false;
            toggleFullScreen();
            goToArtistDetail(artistName);
          }}
        >
          <Icon name="user" size={22} />
          <span>Go to {artistName}</span>
        </button>
      {/each}
    {:else if $currentTrack?.artist}
      <button
        class="sheet-item"
        on:click={() => {
          showMobileMenu = false;
          toggleFullScreen();
          if ($currentTrack?.artist) goToArtistDetail($currentTrack.artist);
        }}
      >
        <Icon name="user" size={22} />
        <span>{$_('contextMenu.goToArtist')}</span>
      </button>
    {/if}

    <!-- Go to Album -->
    {#if $currentTrack?.album_id}
      <button
        class="sheet-item"
        on:click={() => {
          showMobileMenu = false;
          toggleFullScreen();
          if ($currentTrack?.album_id) goToAlbumDetail($currentTrack.album_id);
        }}
      >
        <Icon name="disc" size={22} />
        <span>{$_('contextMenu.goToAlbum')}</span>
      </button>
    {/if}

    <!-- Sleep Timer -->
    <div class="sheet-item-group">
      <div class="sheet-item-header">
        <Icon name="moon" size={22} />
        <span>{$_('player.sleepTimer')}</span>
        {#if $sleepTimerActive}
          <span class="sheet-timer-badge">
            {$_('player.minutesLeft', { values: { minutes: Math.ceil($sleepTimerRemainingMs / 60000) } })}
          </span>
        {/if}
      </div>
      <div class="sheet-timer-presets">
        {#each SLEEP_TIMER_PRESETS as minutes}
          <button
            class="sheet-timer-btn"
            on:click={() => { startSleepTimer(minutes); showMobileMenu = false; }}
          >
            {minutes}m
          </button>
        {/each}
        {#if $sleepTimerActive}
          <button
            class="sheet-timer-btn cancel"
            on:click={() => { stopSleepTimer(); showMobileMenu = false; }}
          >
            {$_('common.cancel')}
          </button>
        {/if}
      </div>
    </div>

    <!-- Connect to Device -->
    <button
      class="sheet-item"
      on:click={() => { showMobileMenu = false; showConnectPanel = true; }}
    >
      <Icon name="connect" size={22} />
      <span>{$_('connect.connectToDevice')}</span>
      {#if connectedDevices > 0}
        <span class="sheet-connected-badge">{connectedDevices}</span>
      {/if}
    </button>

    <!-- Add to Playlist -->
    <button
      class="sheet-item"
      on:click={(e) => { showMobileMenu = false; showTrackMenu(e, true); }}
    >
      <Icon name="list-music" size={22} />
      <span>{$_('contextMenu.addToPlaylist')}</span>
    </button>
  </div>
</div>

<style>
  .mobile-menu-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .mobile-menu-sheet {
    width: 100%;
    max-width: 480px;
    background: #282828;
    border-radius: 16px 16px 0 0;
    padding: 8px 0 calc(20px + env(safe-area-inset-bottom));
    max-height: 75vh;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .mobile-menu-sheet::-webkit-scrollbar {
    display: none;
  }

  .sheet-handle {
    width: 36px;
    height: 4px;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 2px;
    margin: 6px auto 12px;
  }

  .sheet-track-info {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 20px 12px;
  }

  .sheet-art {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .sheet-art-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #404040;
    color: rgba(255, 255, 255, 0.4);
    width: 44px;
    height: 44px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .sheet-track-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sheet-track-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sheet-track-artist {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .sheet-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 0 20px 4px;
  }

  .sheet-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 20px;
    background: none;
    border: none;
    color: #fff;
    font-size: 0.95rem;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s ease;
  }

  .sheet-item:active {
    background: rgba(255, 255, 255, 0.08);
  }

  .sheet-item svg {
    color: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  .sheet-item span {
    flex: 1;
    text-align: left;
  }

  .sheet-connected-badge {
    background: var(--accent-color, #1db954);
    color: #000;
    font-size: 0.7rem;
    font-weight: 700;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sheet-item-group {
    padding: 6px 20px 10px;
  }

  .sheet-item-header {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #fff;
    font-size: 0.95rem;
    margin-bottom: 10px;
  }

  .sheet-item-header svg {
    color: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  .sheet-timer-badge {
    margin-left: auto;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-color, #1db954);
  }

  .sheet-timer-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 36px;
  }

  .sheet-timer-btn {
    padding: 6px 16px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.15s ease;
    outline: none;
  }

  .sheet-timer-btn:active {
    background: rgba(255, 255, 255, 0.15);
  }

  .sheet-timer-btn.cancel {
    border-color: #e53935;
    color: #e53935;
  }
</style>
