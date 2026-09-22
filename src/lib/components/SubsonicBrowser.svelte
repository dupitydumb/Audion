<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import {
    subsonicGetIndexes,
    subsonicGetArtist,
    subsonicGetAlbum,
    subsonicGetStreamUrl,
    type SubsonicArtist,
    type SubsonicArtistDetail,
    type SubsonicAlbumSummary,
    type SubsonicSong,
  } from '$lib/stores/subsonic';

  type Panel = 'artists' | 'albums' | 'songs';

  let panel: Panel = 'artists';
  let loading = false;
  let error = '';

  let artists: SubsonicArtist[] = [];
  let selectedArtist: SubsonicArtistDetail | null = null;
  let selectedAlbumSongs: SubsonicSong[] = [];
  let selectedAlbumName = '';

  // simple single-song preview player
  let currentAudio: HTMLAudioElement | null = null;
  let playingId = '';

  onMount(fetchArtists);

  async function fetchArtists() {
    loading = true;
    error = '';
    try {
      artists = await subsonicGetIndexes();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function openArtist(artist: SubsonicArtist) {
    loading = true;
    error = '';
    try {
      selectedArtist = await subsonicGetArtist(artist.id);
      panel = 'albums';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function openAlbum(album: SubsonicAlbumSummary) {
    loading = true;
    error = '';
    try {
      const full = await subsonicGetAlbum(album.id);
      selectedAlbumSongs = full.songs;
      selectedAlbumName = album.name;
      panel = 'songs';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function toggleSong(song: SubsonicSong) {
    if (playingId === song.id) {
      currentAudio?.pause();
      currentAudio = null;
      playingId = '';
      return;
    }
    try {
      const url = await subsonicGetStreamUrl(song.id);
      currentAudio?.pause();
      currentAudio = new Audio(url);
      playingId = song.id;
      currentAudio.play();
      currentAudio.onended = () => { playingId = ''; currentAudio = null; };
    } catch (e) {
      error = String(e);
    }
  }

  function back() {
    currentAudio?.pause();
    currentAudio = null;
    playingId = '';
    if (panel === 'songs') { panel = 'albums'; selectedAlbumSongs = []; }
    else if (panel === 'albums') { panel = 'artists'; selectedArtist = null; }
  }

  function fmt(sec?: number | null): string {
    if (!sec) return '';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
</script>

<div class="subsonic-browser">
  <div class="sb-header">
    {#if panel !== 'artists'}
      <button class="icon-btn" on:click={back} aria-label="Back">
        <Icon name="chevron-left" size={18} />
      </button>
    {/if}
    <span class="sb-title">
      {#if panel === 'artists'}Subsonic Library
      {:else if panel === 'albums'}{selectedArtist?.name ?? ''}
      {:else}{selectedAlbumName}
      {/if}
    </span>
    {#if panel === 'artists'}
      <button class="icon-btn" on:click={fetchArtists} aria-label="Refresh" title="Refresh">
        <Icon name="refresh-cw" size={15} />
      </button>
    {/if}
  </div>

  {#if error}
    <div class="sb-error">
      <Icon name="alert-circle" size={15} />
      <span>{error}</span>
    </div>
  {/if}

  {#if loading}
    <div class="sb-msg">Loading…</div>
  {:else if panel === 'artists'}
    {#if artists.length === 0}
      <div class="sb-empty">
        <Icon name="server" size={36} />
        <p>No artists found. Check your server URL and credentials in<br/>
          <strong>Settings → Subsonic Server</strong>.</p>
      </div>
    {:else}
      <ul class="sb-list">
        {#each artists as artist}
          <li>
            <button class="sb-row" on:click={() => openArtist(artist)}>
              <span class="sb-name">{artist.name}</span>
              {#if artist.album_count}
                <span class="sb-meta">{artist.album_count} albums</span>
              {/if}
              <Icon name="chevron-right" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if panel === 'albums' && selectedArtist}
    {#if selectedArtist.albums.length === 0}
      <div class="sb-msg">No albums found.</div>
    {:else}
      <ul class="sb-list">
        {#each selectedArtist.albums as album}
          <li>
            <button class="sb-row" on:click={() => openAlbum(album)}>
              <span class="sb-name">{album.name}</span>
              <span class="sb-meta">
                {#if album.year}{album.year} · {/if}
                {#if album.song_count}{album.song_count} tracks{/if}
              </span>
              <Icon name="chevron-right" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if panel === 'songs'}
    {#if selectedAlbumSongs.length === 0}
      <div class="sb-msg">No tracks found.</div>
    {:else}
      <ul class="sb-list">
        {#each selectedAlbumSongs as song, i}
          <li>
            <button class="sb-row song-row" on:click={() => toggleSong(song)}
              class:playing={playingId === song.id}>
              <span class="sb-num">{song.track ?? i + 1}</span>
              <span class="sb-name">{song.title}</span>
              {#if song.duration}
                <span class="sb-meta">{fmt(song.duration)}</span>
              {/if}
              <Icon name={playingId === song.id ? 'pause' : 'play'} size={13} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .subsonic-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .sb-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .sb-title {
    flex: 1;
    font-weight: 600;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 4px;
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }

  .sb-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: color-mix(in srgb, #ff6b6b 12%, transparent);
    color: #ff6b6b;
    font-size: 0.8125rem;
    flex-shrink: 0;
  }

  .sb-msg {
    padding: 20px 16px;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .sb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 48px 24px;
    color: var(--text-secondary);
    text-align: center;
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .sb-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .sb-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-primary);
    text-align: left;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
    transition: background 0.1s;
  }
  .sb-row:hover { background: var(--bg-elevated); }
  .sb-row.playing { color: var(--accent-primary, #1db954); }

  .sb-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
  }

  .sb-meta {
    font-size: 0.75rem;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .sb-num {
    width: 22px;
    text-align: right;
    font-size: 0.75rem;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .song-row :global(svg) { opacity: 0; transition: opacity 0.1s; }
  .song-row:hover :global(svg),
  .song-row.playing :global(svg) { opacity: 1; }
</style>
