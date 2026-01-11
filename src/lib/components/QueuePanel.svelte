<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { isQueueVisible, toggleQueue } from "$lib/stores/ui";
    import {
        queue,
        queueIndex,
        currentTrack,
        isPlaying,
        playFromQueue,
        removeFromQueue,
        clearUpcoming,
    } from "$lib/stores/player";
    import { albums } from "$lib/stores/library";
    import { formatDuration, getAlbumArtSrc } from "$lib/api/tauri";

    import type { Track } from "$lib/api/tauri";

    // Create album map for art lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

    function getTrackArt(track: Track): string | null {
        if (!track) return null;
        if (track.cover_url) return track.cover_url;
        if (!track.album_id) return null;
        const album = albumMap.get(track.album_id);
        return album ? getAlbumArtSrc(album.art_data) : null;
    }

    // Separate queue into history and upcoming
    $: historyTracks = $queue.slice(0, $queueIndex);
    $: upcomingTracks = $queue.slice($queueIndex + 1);
    $: hasUpcoming = upcomingTracks.length > 0;

    function handlePlayTrack(index: number) {
        playFromQueue(index);
    }

    function handleRemove(index: number) {
        removeFromQueue(index);
    }

    let draggedIndex: number | null = null;
</script>

{#if $isQueueVisible}
    <aside class="queue-panel" transition:fly={{ x: 300, duration: 300 }}>
        <header class="queue-header">
            <h3>Queue</h3>
            <div class="header-actions">
                {#if hasUpcoming}
                    <button
                        class="clear-btn"
                        on:click={clearUpcoming}
                        title="Clear upcoming"
                    >
                        Clear
                    </button>
                {/if}
                <button
                    class="close-btn"
                    on:click={toggleQueue}
                    title="Close queue"
                    aria-label="Close queue"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            </div>
        </header>

        <div class="queue-content">
            {#if $currentTrack}
                <section class="queue-section">
                    <h4 class="section-title">Now Playing</h4>
                    <div class="now-playing">
                        <div class="queue-track current">
                            <div class="track-art">
                                {#if getTrackArt($currentTrack)}
                                    <img
                                        src={getTrackArt($currentTrack)}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                    />
                                {:else}
                                    <div class="art-placeholder">
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            width="16"
                                            height="16"
                                        >
                                            <path
                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                            />
                                        </svg>
                                    </div>
                                {/if}
                                {#if $isPlaying}
                                    <div class="playing-indicator">
                                        <span class="bar"></span>
                                        <span class="bar"></span>
                                        <span class="bar"></span>
                                    </div>
                                {/if}
                            </div>
                            <div class="track-info">
                                <span class="track-title truncate"
                                    >{$currentTrack.title ||
                                        "Unknown Title"}</span
                                >
                                <span class="track-artist truncate"
                                    >{$currentTrack.artist ||
                                        "Unknown Artist"}</span
                                >
                            </div>
                            <span class="track-duration"
                                >{formatDuration($currentTrack.duration)}</span
                            >
                        </div>
                    </div>
                </section>
            {/if}

            {#if upcomingTracks.length > 0}
                <section class="queue-section">
                    <h4 class="section-title">
                        Next Up
                        <span class="count">{upcomingTracks.length}</span>
                    </h4>
                    <div class="queue-list">
                        {#each upcomingTracks as track, i (`upcoming-${i}-${track.id}`)}
                            {@const actualIndex = $queueIndex + 1 + i}
                            <div
                                class="queue-track"
                                animate:flip={{ duration: 200 }}
                                draggable="true"
                            >
                                <button
                                    class="track-btn"
                                    on:click={() =>
                                        handlePlayTrack(actualIndex)}
                                >
                                    <div class="track-art">
                                        {#if getTrackArt(track)}
                                            <img
                                                src={getTrackArt(track)}
                                                alt=""
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        {:else}
                                            <div class="art-placeholder">
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                    width="16"
                                                    height="16"
                                                >
                                                    <path
                                                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                    />
                                                </svg>
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="track-info">
                                        <span class="track-title truncate"
                                            >{track.title ||
                                                "Unknown Title"}</span
                                        >
                                        <span class="track-artist truncate"
                                            >{track.artist ||
                                                "Unknown Artist"}</span
                                        >
                                    </div>
                                </button>
                                <span class="track-duration"
                                    >{formatDuration(track.duration)}</span
                                >
                                <button
                                    class="remove-btn"
                                    on:click={() => handleRemove(actualIndex)}
                                    title="Remove from queue"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                    >
                                        <path
                                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                                        />
                                    </svg>
                                </button>
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if historyTracks.length > 0}
                <section class="queue-section history">
                    <h4 class="section-title">
                        Recently Played
                        <span class="count">{historyTracks.length}</span>
                    </h4>
                    <div class="queue-list">
                        {#each historyTracks as track, i (track.id + "-history-" + i)}
                            <div class="queue-track past">
                                <button
                                    class="track-btn"
                                    on:click={() => handlePlayTrack(i)}
                                >
                                    <div class="track-art">
                                        {#if getTrackArt(track)}
                                            <img
                                                src={getTrackArt(track)}
                                                alt=""
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        {:else}
                                            <div class="art-placeholder">
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                    width="16"
                                                    height="16"
                                                >
                                                    <path
                                                        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                    />
                                                </svg>
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="track-info">
                                        <span class="track-title truncate"
                                            >{track.title ||
                                                "Unknown Title"}</span
                                        >
                                        <span class="track-artist truncate"
                                            >{track.artist ||
                                                "Unknown Artist"}</span
                                        >
                                    </div>
                                </button>
                                <span class="track-duration"
                                    >{formatDuration(track.duration)}</span
                                >
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if $queue.length === 0}
                <div class="empty-state">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="48"
                        height="48"
                    >
                        <path
                            d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
                        />
                    </svg>
                    <p>Queue is empty</p>
                    <span>Play some tracks to fill the queue</span>
                </div>
            {/if}
        </div>
    </aside>
{/if}

<style>
    .queue-panel {
        width: 350px;
        min-width: 300px;
        max-width: 400px;
        height: 100%;
        background: linear-gradient(
            180deg,
            var(--bg-elevated) 0%,
            var(--bg-base) 100%
        );
        border-left: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
    }

    .queue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .queue-header h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .clear-btn {
        font-size: 0.75rem;
        color: var(--text-secondary);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
    }

    .clear-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-full);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .queue-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
        padding-bottom: calc(var(--player-height) + var(--spacing-md));
    }

    .queue-section {
        margin-bottom: var(--spacing-lg);
    }

    .section-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-subdued);
        margin-bottom: var(--spacing-sm);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .section-title .count {
        background-color: var(--bg-surface);
        padding: 2px 6px;
        border-radius: var(--radius-full);
        font-size: 0.625rem;
    }

    .queue-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .queue-track {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs);
        border-radius: var(--radius-md);
        transition: background-color var(--transition-fast);
    }

    .queue-track:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .queue-track.current {
        background-color: var(--accent-subtle);
        padding: var(--spacing-sm);
    }

    .queue-track.past {
        opacity: 0.6;
    }

    .queue-track.past:hover {
        opacity: 1;
    }

    .track-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
        min-width: 0;
        text-align: left;
    }

    .track-art {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
    }

    .track-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        background-color: var(--bg-highlight);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .playing-indicator {
        position: absolute;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
    }

    .playing-indicator .bar {
        width: 3px;
        height: 12px;
        background-color: var(--accent-primary);
        animation: equalizer 0.8s ease-in-out infinite;
    }

    .playing-indicator .bar:nth-child(2) {
        animation-delay: 0.2s;
    }

    .playing-indicator .bar:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes equalizer {
        0%,
        100% {
            height: 4px;
        }
        50% {
            height: 14px;
        }
    }

    .track-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
    }

    .track-title {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .queue-track.current .track-title {
        color: var(--accent-primary);
    }

    .track-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .track-duration {
        font-size: 0.75rem;
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .remove-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-full);
        color: var(--text-subdued);
        opacity: 0;
        transition: all var(--transition-fast);
    }

    .queue-track:hover .remove-btn {
        opacity: 1;
    }

    .remove-btn:hover {
        color: var(--error-color);
        background-color: rgba(241, 94, 108, 0.1);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .empty-state p {
        font-size: 1rem;
        color: var(--text-secondary);
    }

    .empty-state span {
        font-size: 0.8125rem;
    }

    .history {
        opacity: 0.7;
    }

    .history:hover {
        opacity: 1;
    }
</style>
