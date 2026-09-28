<script lang="ts">
    import type { ChartData, AudionApiTrack } from "$lib/api/audion-api";
    import type { Track } from "$lib/api/tauri";
    import { playTracks } from "$lib/stores/player";
    import { _ } from "svelte-i18n";

    export let charts: ChartData[];
    export let playingTrackId: number | string | null;
    export let playing: boolean;

    function playApiTrack(apiTrack: AudionApiTrack, chartItems: AudionApiTrack[]) {
        const tracks = chartItems.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album || '',
            album_id: null,
            duration: (t.durationMs || 0) / 1000,
            path: t.tidalId ? `tidal://${t.tidalId}` : '',
            cover_url: t.coverUrl,
            source_type: 'tidal',
            external_id: t.tidalId
        } as unknown as Track));

        const index = chartItems.findIndex(t => t.id === apiTrack.id);
        playTracks(tracks, index);
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

<div class="charts-container">
    {#each charts as chart}
        <section class="home-section chart-section">
            <div class="section-header">
                <h2 class="section-title">{chart.displayName}</h2>
                <button class="view-all-link">{$_('home.viewAll')}</button>
            </div>
            <div class="chart-list">
                {#if chart.items}
                    {#each chart.items.slice(0, 5) as item, i}
                        {@const isNowPlaying = String(playingTrackId) === String(item.id) && playing}
                        <div
                            class="chart-row"
                            class:active={isNowPlaying}
                            role="button"
                            tabindex="0"
                            on:click={(e) => handleContainerClick(e, () => playApiTrack(item, chart.items))}
                            on:keydown={(e) => handleKeyActivate(e, () => playApiTrack(item, chart.items))}
                        >
                            <span class="chart-rank">{i + 1}</span>
                            <div class="chart-art">
                                {#if item.coverUrl}
                                    <img src={item.coverUrl} alt={item.title} loading="lazy" />
                                {:else}
                                    <div class="art-placeholder">🎵</div>
                                {/if}
                            </div>
                            <div class="chart-info">
                                <span class="chart-title">{item.title}</span>
                                <span class="chart-artist">{item.artist}</span>
                            </div>
                            {#if isNowPlaying}
                                <div class="playing-indicator">
                                    <div class="bar"></div>
                                    <div class="bar"></div>
                                    <div class="bar"></div>
                                </div>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </section>
    {/each}
</div>

<style>
    .charts-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 24px;
        margin-top: 32px;
    }

    .chart-section {
        background: var(--bg-elevated);
        padding: 20px;
        border-radius: 12px;
        border: 1px solid var(--border-color);
    }

    .home-section {
        margin-bottom: 32px;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
    }

    .section-title {
        font-size: 1.4rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 16px 0;
    }

    .view-all-link {
        background: none;
        border: none;
        color: var(--text-subdued);
        font-size: 0.8rem;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
    }

    .view-all-link:hover {
        color: var(--text-primary);
        text-decoration: underline;
    }

    .chart-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .chart-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s;
    }

    .chart-row:hover {
        background: rgba(255, 255, 255, 0.07);
    }

    .chart-row.active {
        background: rgba(30, 215, 96, 0.1);
    }

    .chart-rank {
        width: 20px;
        font-size: 0.9rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-subdued);
        text-align: center;
    }

    .chart-art {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        overflow: hidden;
        background: var(--bg-elevated);
    }

    .chart-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
    }

    .chart-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }

    .chart-title {
        font-size: 0.9rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .chart-artist {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .playing-indicator {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 12px;
    }

    .playing-indicator .bar {
        width: 2px;
        height: 100%;
        background: var(--accent-primary);
        animation: eq 0.8s infinite ease-in-out;
    }

    @keyframes eq {
        0%, 100% { height: 30%; }
        50% { height: 100%; }
    }
</style>
