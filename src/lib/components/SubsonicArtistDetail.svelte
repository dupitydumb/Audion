<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { subsonicGetArtist, subsonicGetCoverUrl } from '$lib/stores/subsonic';
  import { goBack, goToSubsonicAlbum } from '$lib/stores/view';
  import type { SubsonicAlbumSummary } from '$lib/stores/subsonic';

  export let id: string | undefined;
  export let name: string | undefined = undefined;

  let artistName = name ?? '';
  let albums: SubsonicAlbumSummary[] = [];
  let albumCovers = new Map<string, string | null>();
  let loading = true;
  let error = '';

  onMount(() => { if (id) load(id); });

  async function load(artistId: string) {
    loading = true;
    error = '';
    try {
      const detail = await subsonicGetArtist(artistId);
      artistName = detail.name ?? name ?? '';
      albums = detail.albums ?? [];
      loadCovers();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function loadCovers() {
    const batch = 20;
    for (let i = 0; i < albums.length; i += batch) {
      const slice = albums.slice(i, i + batch);
      await Promise.allSettled(
        slice.map(async a => {
          if (!a.cover_art) return;
          try {
            const url = await subsonicGetCoverUrl(a.cover_art, 200);
            albumCovers.set(a.id, url);
            albumCovers = new Map(albumCovers);
          } catch {}
        })
      );
    }
  }
</script>

<div class="artist-detail">
  <!-- Header -->
  <div class="detail-header">
    <button class="back-btn" on:click={goBack} aria-label="Back">
      <Icon name="arrow-left" size={18} />
    </button>
    <div class="header-meta">
      <p class="meta-type">Artist</p>
      <h1 class="meta-title">{artistName}</h1>
      {#if !loading}
        <p class="meta-info">{albums.length} albums</p>
      {/if}
    </div>
  </div>

  <!-- Albums -->
  <div class="content">
    {#if loading}
      <div class="loading-msg">Loading albums…</div>
    {:else if error}
      <div class="error-msg">
        <Icon name="alert-circle" size={15} />
        {error}
      </div>
    {:else if albums.length === 0}
      <div class="empty-msg">No albums found.</div>
    {:else}
      <h2 class="section-heading">Albums</h2>
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
              {#if album.year}
                <span class="card-year">{album.year}</span>
              {/if}
              {#if album.song_count}
                <span class="card-sub">{album.song_count} tracks</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .artist-detail {
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
    align-items: center;
    gap: 16px;
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
  }
  .back-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }

  .header-meta { flex: 1; min-width: 0; }

  .meta-type {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 4px;
  }

  .meta-title {
    font-size: 1.75rem;
    font-weight: 800;
    margin: 0 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }

  .meta-info {
    font-size: 0.8rem;
    color: var(--text-secondary);
    opacity: 0.7;
    margin: 0;
  }

  /* ── Content ── */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
  }

  .section-heading {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 8px 0 16px;
  }

  .loading-msg, .empty-msg {
    padding: 32px 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: center;
  }

  .error-msg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 0;
    color: #ff6b6b;
    font-size: 0.875rem;
  }

  /* ── Album grid ── */
  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
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

  .card-year, .card-sub {
    font-size: 0.75rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
