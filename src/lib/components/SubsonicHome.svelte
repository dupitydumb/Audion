<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import TrackList from '$lib/components/track-list/TrackList.svelte';
  import {
    subsonicGetRandomSongs,
    subsonicGetAlbumList,
    subsonicGetIndexes,
    subsonicGetStreamUrl,
    subsonicGetCoverUrl,
    type SubsonicSong,
    type SubsonicAlbumSummary,
    type SubsonicArtist,
  } from '$lib/stores/subsonic';
  import { subsonicSongToTrack } from '$lib/services/subsonic-track-mapper';
  import { goToSubsonicAlbum, goToSubsonicArtist } from '$lib/stores/view';
  import type { Track } from '$lib/api/tauri';

  type Tab = 'songs' | 'albums' | 'artists';
  let activeTab: Tab = 'songs';

  // ── Songs ────────────────────────────────────────────────────────────────────
  let songs: SubsonicSong[] = [];
  let songTracks: Track[] = [];
  let songCoverCache = new Map<string, string | null>();
  let songsLoading = false;
  let songsError = '';

  // ── Albums ───────────────────────────────────────────────────────────────────
  let albums: SubsonicAlbumSummary[] = [];
  let albumCovers = new Map<string, string | null>();
  let albumsLoading = false;
  let albumsError = '';

  // ── Artists ──────────────────────────────────────────────────────────────────
  let artists: SubsonicArtist[] = [];
  let artistsLoading = false;
  let artistsError = '';

  // ── Playback state for TrackList ──────────────────────────────────────────────
  // TrackList reads currentTrack/isPlaying internally — no props needed

  // ── Load on mount ─────────────────────────────────────────────────────────────
  onMount(() => {
    loadSongs();
    loadAlbums();
    loadArtists();
  });

  async function loadSongs() {
    songsLoading = true;
    songsError = '';
    // Retry once on transient network error
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        songs = await subsonicGetRandomSongs(200);
        const resolved = await Promise.allSettled(
          songs.map(s => subsonicGetStreamUrl(s.id))
        );
        songTracks = songs.map((s, i) => {
          const url = resolved[i].status === 'fulfilled' ? resolved[i].value : '';
          return subsonicSongToTrack(s, url, null);
        });
        loadSongCovers();
        songsError = '';
        break;
      } catch (e) {
        if (attempt === 1) songsError = String(e);
        else await new Promise(r => setTimeout(r, 1500));
      }
    }
    songsLoading = false;
  }

  async function loadSongCovers() {
    // Batch: 20 at a time so we don't hammer the server
    const batch = 20;
    for (let i = 0; i < songs.length; i += batch) {
      const slice = songs.slice(i, i + batch);
      await Promise.allSettled(
        slice.map(async s => {
          if (!s.cover_art) return;
          try {
            const url = await subsonicGetCoverUrl(s.cover_art, 100);
            songCoverCache.set(s.id, url);
          } catch {}
        })
      );
      // Refresh covers — rebuild track array with updated cover_url
      songTracks = songTracks.map(t => {
        const cover = songCoverCache.get(String(t.external_id));
        return cover != null ? { ...t, cover_url: cover } : t;
      });
    }
  }

  async function loadAlbums() {
    albumsLoading = true;
    albumsError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        albums = await subsonicGetAlbumList('alphabeticalByName', 500);
        loadAlbumCovers();
        albumsError = '';
        break;
      } catch (e) {
        if (attempt === 1) albumsError = String(e);
        else await new Promise(r => setTimeout(r, 1500));
      }
    }
    albumsLoading = false;
  }

  async function loadAlbumCovers() {
    const batch = 20;
    for (let i = 0; i < albums.length; i += batch) {
      const slice = albums.slice(i, i + batch);
      await Promise.allSettled(
        slice.map(async a => {
          if (!a.cover_art) return;
          try {
            const url = await subsonicGetCoverUrl(a.cover_art, 200);
            albumCovers.set(a.id, url);
            albumCovers = new Map(albumCovers); // trigger reactivity
          } catch {}
        })
      );
    }
  }

  async function loadArtists() {
    artistsLoading = true;
    artistsError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        artists = await subsonicGetIndexes();
        artistsError = '';
        break;
      } catch (e) {
        if (attempt === 1) artistsError = String(e);
        else await new Promise(r => setTimeout(r, 1500));
      }
    }
    artistsLoading = false;
  }

  function refresh() {
    if (activeTab === 'songs') loadSongs();
    else if (activeTab === 'albums') loadAlbums();
    else loadArtists();
  }
</script>

<div class="subsonic-home">
  <!-- Tab bar -->
  <div class="tab-bar">
    <button
      class="tab-btn"
      class:active={activeTab === 'songs'}
      on:click={() => (activeTab = 'songs')}
    >
      <Icon name="music" size={15} />
      Songs
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'albums'}
      on:click={() => (activeTab = 'albums')}
    >
      <Icon name="disc" size={15} />
      Albums
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'artists'}
      on:click={() => (activeTab = 'artists')}
    >
      <Icon name="user" size={15} />
      Artists
    </button>
    <div class="tab-spacer" />
    <button class="icon-btn" on:click={refresh} title="Refresh">
      <Icon name="refresh-cw" size={15} />
    </button>
  </div>

  <!-- Content -->
  <div class="tab-content">

    <!-- Songs tab -->
    {#if activeTab === 'songs'}
      {#if songsLoading}
        <div class="loading-msg">Loading songs…</div>
      {:else if songsError}
        <div class="error-msg">
          <Icon name="alert-circle" size={15} />
          {songsError}
        </div>
      {:else if songTracks.length === 0}
        <div class="empty-msg">No songs found.</div>
      {:else}
        <TrackList
          tracks={songTracks}
          showAlbum={true}
          scrollKey="subsonic-songs"
        />
      {/if}

    <!-- Albums tab -->
    {:else if activeTab === 'albums'}
      {#if albumsLoading}
        <div class="loading-msg">Loading albums…</div>
      {:else if albumsError}
        <div class="error-msg">
          <Icon name="alert-circle" size={15} />
          {albumsError}
        </div>
      {:else if albums.length === 0}
        <div class="empty-msg">No albums found.</div>
      {:else}
        <div class="album-grid">
          {#each albums as album (album.id)}
            <button
              class="album-card"
              on:click={() => goToSubsonicAlbum(album.id, album.name)}
            >
              <div class="card-cover">
                {#if albumCovers.get(album.id)}
                  <img
                    src={albumCovers.get(album.id)}
                    alt={album.name}
                    class="cover-img"
                    loading="lazy"
                  />
                {:else}
                  <div class="cover-placeholder">
                    <Icon name="disc" size={32} />
                  </div>
                {/if}
                <div class="card-play-overlay">
                  <Icon name="play" size={20} />
                </div>
              </div>
              <div class="card-info">
                <span class="card-title">{album.name}</span>
                {#if album.artist}
                  <span class="card-sub">{album.artist}</span>
                {/if}
                {#if album.year}
                  <span class="card-year">{album.year}</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}

    <!-- Artists tab -->
    {:else if activeTab === 'artists'}
      {#if artistsLoading}
        <div class="loading-msg">Loading artists…</div>
      {:else if artistsError}
        <div class="error-msg">
          <Icon name="alert-circle" size={15} />
          {artistsError}
        </div>
      {:else if artists.length === 0}
        <div class="empty-msg">No artists found.</div>
      {:else}
        <ul class="artist-list">
          {#each artists as artist (artist.id)}
            <li>
              <button
                class="artist-row"
                on:click={() => goToSubsonicArtist(artist.id, artist.name)}
              >
                <div class="artist-avatar">
                  <Icon name="user" size={18} />
                </div>
                <span class="artist-name">{artist.name}</span>
                {#if artist.album_count}
                  <span class="artist-meta">{artist.album_count} albums</span>
                {/if}
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

  </div>
</div>

<style>
  .subsonic-home {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  /* ── Tab bar ── */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 10px 16px 0;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--text-primary); }
  .tab-btn.active {
    color: var(--accent-primary, #1db954);
    border-bottom-color: var(--accent-primary, #1db954);
  }

  .tab-spacer { flex: 1; }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 6px;
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }

  /* ── Content area ── */
  .tab-content {
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

  /* ── Album grid ── */
  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
    padding: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .album-card {
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0;
    border-radius: 8px;
    transition: transform 0.15s;
  }
  .album-card:hover { transform: translateY(-2px); }
  .album-card:hover .card-play-overlay { opacity: 1; }

  .card-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-elevated);
    margin-bottom: 8px;
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
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }

  .card-play-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    color: #fff;
    border-radius: 6px;
  }

  .card-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px;
  }

  .card-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-sub {
    font-size: 0.75rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-year {
    font-size: 0.7rem;
    color: var(--text-secondary);
    opacity: 0.7;
  }

  /* ── Artist list ── */
  .artist-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .artist-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
    cursor: pointer;
    color: var(--text-primary);
    text-align: left;
    transition: background 0.1s;
  }
  .artist-row:hover { background: var(--bg-elevated); }

  .artist-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .artist-name {
    flex: 1;
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artist-meta {
    font-size: 0.75rem;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
</style>
