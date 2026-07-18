<script lang="ts">
    import type { Album } from "$lib/api/tauri";
    import type { AlbumWithCount } from "$lib/api/tauri";
    import { playTracks, togglePlay } from "$lib/stores/player";
    import { getTracksByAlbum } from "$lib/api/tauri";
    import { contextMenu } from "$lib/stores/ui";
    import { getAlbumCoverFromTracks } from "$lib/stores/library";
    import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import MarqueeText from "$lib/components/MarqueeText.svelte";
    import { _ } from "svelte-i18n";

    export let topAlbums: AlbumWithCount[];
    export let playingAlbumId: number | null;
    export let pausedAlbumId: number | null;
    export let playing: boolean;

    let hoveredAlbumId: number | null = null;

    async function playAlbum(album: Album) {
        if (playingAlbumId === album.id) {
            togglePlay();
            return;
        }
        try {
            const tracks = await getTracksByAlbum(album.id);
            if (tracks.length > 0) {
                playTracks(tracks, 0, {
                    type: "album",
                    albumId: album.id,
                    displayName: album.name,
                });
            }
        } catch (err) {
            console.error("Failed to play album:", err);
        }
    }

    function albumContextMenu(album: Album, e: MouseEvent) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play", action: () => playAlbum(album) },
                { label: "Go to Album", action: () => goToAlbumDetail(album.id) },
                { label: "Go to Artist", action: () => goToArtistDetail((album.artists && album.artists[0]) || album.artist || "") },
            ],
        });
    }

    function handleContainerClick(e: MouseEvent, callback: () => void) {
        if (
            (e.target as HTMLElement).closest(".link") ||
            (e.target as HTMLElement).closest("button")
        ) return;
        callback();
    }

    function handleKeyActivate(e: KeyboardEvent, action: () => void) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            action();
        }
    }
</script>

<section class="home-section">
    <h2 class="section-title">{$_('home.mostPlayedAlbums')}</h2>
    <div class="top-tracks-list">
        {#each topAlbums.slice(0, 10) as { album, play_count }, i}
            {@const isNowPlaying = playingAlbumId === album.id && playing}
            {@const isPaused = pausedAlbumId === album.id}
            <div
                class="top-track-row"
                class:now-playing={isNowPlaying}
                class:paused={isPaused}
                role="button"
                tabindex="0"
                on:click={(e) => handleContainerClick(e, () => goToAlbumDetail(album.id))}
                on:keydown={(e) => handleKeyActivate(e, () => goToAlbumDetail(album.id))}
                on:contextmenu={(e) => albumContextMenu(album, e)}
                on:mouseenter={() => (hoveredAlbumId = album.id)}
                on:mouseleave={() => (hoveredAlbumId = null)}
            >
                <span class="top-track-rank">
                    {#if isNowPlaying}
                        <span class="equalizer" aria-label="Now playing">
                            <span class="bar"></span>
                            <span class="bar"></span>
                            <span class="bar"></span>
                        </span>
                    {:else}
                        {i + 1}
                    {/if}
                </span>
                <div class="top-track-art">
                    {#if getAlbumCoverFromTracks(album.id)}
                        <img src={getAlbumCoverFromTracks(album.id)} alt={album.name} loading="lazy" decoding="async" />
                    {:else}
                        <div class="top-track-art-placeholder">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                            </svg>
                        </div>
                    {/if}
                </div>
                <div class="top-track-info">
                    <MarqueeText
                        trigger="external"
                        active={hoveredAlbumId === album.id}
                        resetKey={album.id}
                        containerClass="top-track-title-track"
                    >
                        <span class="top-track-title" class:accent={isNowPlaying || isPaused}>{album.name}</span>
                    </MarqueeText>
                    <span class="top-track-artist">
                        <ArtistLinks
                            artist={album.artist}
                            artists={album.artists}
                            chipClass="link"
                            marquee
                            marqueeTrigger="external"
                            marqueeActive={hoveredAlbumId === album.id}
                            resetKey={album.id}
                            on:select={(e) => goToArtistDetail(e.detail)}
                        />
                    </span>
                </div>
                <span class="top-track-plays">{play_count} plays</span>
            </div>
        {/each}
    </div>
</section>

<style>
    .home-section { margin-bottom: 32px; }

    .section-title {
        font-size: 1.4rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 16px 0;
    }

    .top-track-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        text-align: left;
        width: 100%;
    }

    .top-track-row:hover {
        background: var(--surface-hover, rgba(255, 255, 255, 0.1));
        transform: translateX(4px);
    }

    .top-track-row.now-playing,
    .top-track-row.paused { background: var(--accent-subtle); }

    .top-track-row.now-playing:hover,
    .top-track-row.paused:hover {
        background: var(--accent-subtle);
        opacity: 0.95;
        transform: translateX(4px);
    }

    .top-track-rank {
        width: 32px;
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-bold);
        color: var(--text-subdued);
        text-align: center;
        flex-shrink: 0;
        font-family: "JetBrains Mono", monospace;
        opacity: 0.5;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .top-track-row:hover .top-track-rank { color: var(--accent-primary); opacity: 1; }
    .top-track-row.now-playing .top-track-rank,
    .top-track-row.paused .top-track-rank { opacity: 1; }

    .equalizer {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 16px;
    }

    .equalizer .bar {
        width: 3px;
        background-color: var(--accent-primary);
        border-radius: 2px;
        animation: equalizer 0.8s ease-in-out infinite;
    }

    .equalizer .bar:nth-child(2) { animation-delay: 0.2s; }
    .equalizer .bar:nth-child(3) { animation-delay: 0.4s; }

    @keyframes equalizer {
        0%, 100% { height: 4px; }
        50% { height: 14px; }
    }

    .top-track-art {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
    }

    .top-track-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .top-track-art-placeholder {
        width: 100%;
        height: 100%;
        background: var(--surface-elevated, rgba(255, 255, 255, 0.06));
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .top-track-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
    }

    .top-track-title {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .top-track-title.accent { color: var(--accent-primary); }

    .top-track-artist {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
    }

    .top-track-artist.link:hover {
        text-decoration: underline;
        color: var(--text-primary);
    }

    .top-track-plays {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
        flex-shrink: 0;
    }
</style>
