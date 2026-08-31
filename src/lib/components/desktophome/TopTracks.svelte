<script lang="ts">
    import { formatDuration, type Track } from "$lib/api/tauri";
    import type { TrackWithCount } from "$lib/api/tauri";
    import { playTracks, togglePlay, addToQueue } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import { getTrackAlbumCover } from "$lib/stores/library";
    import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";
    import { _ } from "svelte-i18n";

    export let topTracks: TrackWithCount[];
    export let playingTrackId: number | null;
    export let pausedTrackId: number | null;
    export let playing: boolean;

    $: topTrackList = topTracks.map(t => t.track);

    function playTopTrack(track: Track, index: number) {
        playTracks(topTrackList, index);
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

    function trackContextMenu(track: Track, index: number, trackList: Track[], e: MouseEvent) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: $_('contextMenu.play'), action: () => playTracks(trackList, index) },
                { label: $_('contextMenu.addToQueue'), action: () => addToQueue([track]) },
                { type: "separator" },
                { label: $_('contextMenu.goToArtist'), action: () => goToArtistDetail(track.artist || "") },
                {
                    label: $_('contextMenu.goToAlbum'),
                    action: () => { if (track.album_id) goToAlbumDetail(track.album_id); },
                    disabled: !track.album_id,
                },
            ],
        });
    }
</script>

<section class="home-section">
    <h2 class="section-title">{$_('home.yourTopSongs')}</h2>
    <div class="top-tracks-list">
        {#each topTracks.slice(0, 10) as { track, play_count }, i}
            {@const isNowPlaying = playingTrackId === track.id && playing}
            {@const isPaused = pausedTrackId === track.id}
            <div
                class="top-track-row"
                class:now-playing={isNowPlaying}
                class:paused={isPaused}
                role="button"
                tabindex="0"
                on:click={(e) => handleContainerClick(e, () => playTopTrack(track, i))}
                on:keydown={(e) => handleKeyActivate(e, () => playTopTrack(track, i))}
                on:contextmenu={(e) => trackContextMenu(track, i, topTrackList, e)}
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
                    {#if getTrackAlbumCover(track.id)}
                        <img src={getTrackAlbumCover(track.id)} alt={track.title} loading="lazy" decoding="async" />
                    {:else}
                        <div class="top-track-art-placeholder">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                        </div>
                    {/if}
                </div>
                <div class="top-track-info">
                    <span class="top-track-title" class:accent={isNowPlaying || isPaused}>{track.title || $_('common.unknown')}</span>
                    <button
                        class="top-track-artist link"
                        on:click|stopPropagation={() => goToArtistDetail(track.artist || "")}
                        title={$_('contextMenu.goToArtist')}
                    >
                        {track.artist || $_('common.unknown')}
                    </button>
                </div>
                <span class="top-track-plays">{$_('home.playsCount', { values: { count: play_count } })}</span>
                <span class="top-track-duration">{formatDuration(track.duration)}</span>
            </div>
        {/each}
    </div>
</section>

<style>
    .home-section {
        margin-bottom: 32px;
    }

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
    .top-track-row.paused {
        background: var(--accent-subtle);
    }

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

    .top-track-row:hover .top-track-rank {
        color: var(--accent-primary);
        opacity: 1;
    }

    .top-track-row.now-playing .top-track-rank,
    .top-track-row.paused .top-track-rank {
        opacity: 1;
    }

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
        overflow: hidden;
        text-overflow: ellipsis;
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

    .top-track-duration {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
        width: 48px;
        text-align: right;
        flex-shrink: 0;
    }
</style>
