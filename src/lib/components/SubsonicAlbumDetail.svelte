<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import TrackList from '$lib/components/track-list/TrackList.svelte';
  import {
    subsonicGetAlbum,
    subsonicGetStreamUrl,
    subsonicGetCoverUrl,
  } from '$lib/stores/subsonic';
  import { subsonicSongToTrack } from '$lib/services/subsonic-track-mapper';
  import { playTracks } from '$lib/stores/player';
  import { goBack } from '$lib/stores/view';
  import type { Track } from '$lib/api/tauri';

  export let id: string | undefined;
  export let name: string | undefined = undefined;

  let tracks: Track[] = [];
  let albumName = name ?? '';
  let albumArtist = '';
  let coverUrl: string | null = null;
  let loading = true;
  let error = '';

  $: totalDuration = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);

  function formatTotal(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  onMount(() => { if (id) load(id); });

  async function load(albumId: string) {
    loading = true;
    error = '';
    try {
      const album = await subsonicGetAlbum(albumId);
      albumName = album.name ?? name ?? '';
      albumArtist = album.artist ?? '';

      // Cover art
      if (album.cover_art) {
        try { coverUrl = await subsonicGetCoverUrl(album.cover_art, 300); } catch {}
      }

      // Resolve stream URLs in parallel
      const songs = album.songs ?? [];
      const urls = await Promise.allSettled(songs.map(s => subsonicGetStreamUrl(s.id)));
      tracks = songs.map((s, i) => {
        const url = urls[i].status === 'fulfilled' ? urls[i].value : '';
        return subsonicSongToTrack(s, url, coverUrl);
      });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function playAll() {
    if (tracks.length) playTracks(tracks, 0);
  }
</script>

<div class="album-detail">
  <!-- Header -->
  <div class="detail-header">
    <button class="back-btn" on:click={goBack} aria-label="Back">
      <Icon name="arrow-left" size={18} />
    </button>

    <div class="header-art">
      {#if coverUrl}
        <img src={coverUrl} alt={albumName} class="cover-img" />
      {:else}
        <div class="cover-placeholder">
          <Icon name="disc" size={48} />
        </div>
      {/if}
    </div>

    <div class="header-meta">
      <p class="meta-type">Album</p>
      <h1 class="meta-title">{albumName}</h1>
      {#if albumArtist}
        <p class="meta-artist">{albumArtist}</p>
      {/if}
      <p class="meta-info">
        {tracks.length} tracks
        {#if totalDuration} · {formatTotal(totalDuration)}{/if}
      </p>
      <div class="header-actions">
        <button class="play-all-btn" on:click={playAll} disabled={loading || tracks.length === 0}>
          <Icon name="play" size={16} />
          Play All
        </button>
      </div>
    </div>
  </div>

  <!-- Track list -->
  <div class="track-section">
    {#if loading}
      <div class="loading-msg">Loading tracks…</div>
    {:else if error}
      <div class="error-msg">
        <Icon name="alert-circle" size={15} />
        {error}
      </div>
    {:else if tracks.length === 0}
      <div class="empty-msg">No tracks in this album.</div>
    {:else}
      <TrackList
        {tracks}
        showAlbum={false}
        scrollKey="subsonic-album-{id}"
      />
    {/if}
  </div>
</div>

<style>
  .album-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  /* ── Header ── */
  .detail-header {
    display: flex;
    align-items: flex-end;
    gap: 20px;
    padding: 20px 24px 16px;
    background: linear-gradient(to bottom, var(--bg-elevated), var(--bg-primary));
    flex-shrink: 0;
  }

  .back-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    padding: 6px;
    border-radius: 50%;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 4px;
  }
  .back-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }

  .header-art {
    width: 160px;
    height: 160px;
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }

  .cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }

  .header-meta {
    flex: 1;
    min-width: 0;
    padding-bottom: 4px;
  }

  .meta-type {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 6px;
  }

  .meta-title {
    font-size: 1.75rem;
    font-weight: 800;
    margin: 0 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }

  .meta-artist {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta-info {
    font-size: 0.8rem;
    color: var(--text-secondary);
    opacity: 0.7;
    margin: 0 0 14px;
  }

  .header-actions {
    display: flex;
    gap: 10px;
  }

  .play-all-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 20px;
    background: var(--accent-primary, #1db954);
    color: var(--text-on-accent, #fff);
    border: none;
    border-radius: 24px;
    font-size: 0.875rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
  }
  .play-all-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.02); }
  .play-all-btn:disabled { opacity: 0.4; cursor: default; }

  /* ── Track list ── */
  .track-section {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .loading-msg, .empty-msg {
    padding: 32px 16px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: center;
  }

  .error-msg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px;
    color: #ff6b6b;
    font-size: 0.875rem;
  }
</style>
