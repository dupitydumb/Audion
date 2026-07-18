<script lang="ts">
    import { goToAlbumDetail, goToArtistDetail } from "$lib/stores/view";
    import { getAlbumCoverFromTracks } from "$lib/stores/library";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import MarqueeText from "$lib/components/MarqueeText.svelte";
    import type { Album } from "$lib/api/tauri";

    export let albums: Album[] = [];
    export let playingAlbumId: number | null = null;
    export let playing: boolean;
    export let pausedAlbumId: number | null = null;
    export let playAlbum: (album: Album) => void;
    export let albumContextMenu: (album: Album, e: MouseEvent) => void;

    let marqueeActive: Record<number, boolean> = {};

    function handleQPMouseEnter(albumId: number) {
        marqueeActive = { ...marqueeActive, [albumId]: true };
    }

    function handleQPMouseLeave(albumId: number) {
        marqueeActive = { ...marqueeActive, [albumId]: false };
    }

    function handleKeyActivate(e: KeyboardEvent, action: () => void) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            action();
        }
    }
</script>

{#if albums.length > 0}
    <section class="quick-play-section">
        <div class="quick-play-grid">
            {#each albums as album}
                {@const isNowPlaying = playingAlbumId === album.id && playing}
                {@const isPaused = pausedAlbumId === album.id}
                <div
                    class="quick-play-card"
                    class:now-playing={isNowPlaying}
                    class:paused={isPaused}
                    role="button"
                    tabindex="0"
                    on:click={() => goToAlbumDetail(album.id)}
                    on:keydown={(e) => handleKeyActivate(e, () => goToAlbumDetail(album.id))}
                    on:contextmenu={(e) => albumContextMenu(album, e)}
                    on:mouseenter={() => handleQPMouseEnter(album.id)}
                    on:mouseleave={() => handleQPMouseLeave(album.id)}
                >
                    <div
                        class="quick-play-art"
                        role="button"
                        tabindex="-1"
                        aria-label={isNowPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
                        on:click|stopPropagation={() => playAlbum(album)}
                        on:keydown|stopPropagation={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playAlbum(album); }
                        }}
                    >
                        {#if getAlbumCoverFromTracks(album.id)}
                            <img src={getAlbumCoverFromTracks(album.id)} alt={album.name} loading="lazy" decoding="async" />
                        {:else}
                            <div class="quick-play-placeholder">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                                </svg>
                            </div>
                        {/if}
                        <div class="quick-play-hover-overlay" aria-hidden="true">
                            {#if isNowPlaying}
                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                            {:else}
                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
                            {/if}
                        </div>
                    </div>
                    <div class="quick-play-text" role="presentation">
                        <MarqueeText
                            trigger="external"
                            active={marqueeActive[album.id]}
                            resetKey={album.id}
                            containerClass="qp-text-track"
                        >
                            <span
                                class="quick-play-name"
                                class:accent={isNowPlaying || isPaused}
                                >{album.name}</span
                            >
                        </MarqueeText>
                        {#if album.artist || (album.artists && album.artists.length > 0)}
                            <div class="qp-text-track">
                                <ArtistLinks
                                    artist={album.artist}
                                    artists={album.artists}
                                    chipClass="quick-play-artist"
                                    marquee
                                    marqueeTrigger="external"
                                    marqueeActive={marqueeActive[album.id]}
                                    resetKey={album.id}
                                    on:select={(e) => goToArtistDetail(e.detail)}
                                />
                            </div>
                        {/if}
                    </div>
                    {#if isNowPlaying || isPaused}
                        <div class="quick-play-eq" aria-hidden="true">
                            <span class="eq-bar" class:paused={isPaused}></span>
                            <span class="eq-bar" class:paused={isPaused}></span>
                            <span class="eq-bar" class:paused={isPaused}></span>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </section>
{/if}

<style>
    .quick-play-section { margin-bottom: 32px; }
    .quick-play-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .quick-play-card { display: flex; align-items: center; gap: 12px; background: var(--surface-hover, rgba(255,255,255,0.07)); border: none; border-radius: 6px; padding: 0; cursor: pointer; overflow: hidden; transition: background 0.2s ease; text-align: left; }
    .quick-play-card:hover { background: var(--surface-active, rgba(255,255,255,0.12)); }
    .quick-play-card.now-playing, .quick-play-card.paused { background: var(--accent-subtle); }
    .quick-play-card.now-playing:hover, .quick-play-card.paused:hover { background: var(--accent-subtle); opacity: 0.95; }
    .quick-play-art { width: 56px; height: 56px; flex-shrink: 0; position: relative; cursor: pointer; border-radius: var(--radius-sm); overflow: hidden; }
    .quick-play-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .quick-play-placeholder { width: 100%; height: 100%; background: var(--surface-elevated, rgba(255,255,255,0.05)); display: flex; align-items: center; justify-content: center; color: var(--text-subdued); }
    .quick-play-hover-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity var(--transition-fast); background: rgba(0,0,0,0.35); color: white; pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6)); }
    .quick-play-art:hover .quick-play-hover-overlay { opacity: 1; }
    .quick-play-text { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 2px; overflow: hidden; }
    :global(.qp-text-track) { display: flex; flex-direction: row; }
    .quick-play-name { font-size: 0.85rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
    .quick-play-name.accent { color: var(--accent-primary); }
    :global(.quick-play-artist) { font-size: var(--font-size-xs); color: var(--text-secondary); background: none; border: none; padding: 0; text-align: left; cursor: pointer; white-space: nowrap; flex-shrink: 0; font-family: inherit; }
    :global(.quick-play-artist:hover) { text-decoration: underline; color: var(--text-primary); }
    .quick-play-eq { display: flex; align-items: flex-end; gap: 3px; flex-shrink: 0; height: 20px; padding-right: 12px; }
    .eq-bar { width: 4px; background-color: var(--accent-primary); border-radius: 2px; animation: qp-equalizer 0.8s ease-in-out infinite; }
    .eq-bar.paused { animation-play-state: paused; height: 8px; background-color: var(--text-secondary); }
    .eq-bar:nth-child(2) { animation-delay: 0.2s; }
    .eq-bar:nth-child(3) { animation-delay: 0.4s; }
    @keyframes qp-equalizer { 0%,100% { height: 4px; } 50% { height: 18px; } }
</style>
