<script lang="ts">
    import { onMount } from "svelte";
    import {
        getAlbumCoverSrc,
        getTrackCoverSrc,
        formatDuration,
        type Track,
        type Album,
        type TrackWithCount,
        type AlbumWithCount,
    } from "$lib/api/tauri";
    import { playTrack, playTracks } from "$lib/stores/player";
    import {
        albums as libraryAlbums,
        tracks as libraryTracks,
    } from "$lib/stores/library";
    import {
        topTracks,
        topAlbums,
        recentlyPlayed,
        loadActivityData,
    } from "$lib/stores/activity";
    import { likedCount } from "$lib/stores/liked";
    import {
        goToAlbumDetail,
        goToArtistDetail,
        goToLikedSongs,
    } from "$lib/stores/view";
    import { isStatsWrappedOpen } from "$lib/stores/ui";

    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const currentMonthName =
        monthNames[new Date().getHours() < 24 ? new Date().getMonth() : 0];

    // Greeting based on time of day
    let greeting = "Good evening";
    const hour = new Date().getHours();
    if (hour < 12) greeting = "Good morning";
    else if (hour < 18) greeting = "Good afternoon";

    onMount(() => {
        loadActivityData();
    });

    // Quick play: top albums or first 6 library albums
    $: quickPlayAlbums =
        $topAlbums.length > 0
            ? $topAlbums.slice(0, 6).map((ta) => ta.album)
            : $libraryAlbums.slice(0, 6);

    function handleQuickPlay(album: Album) {
        goToAlbumDetail(album.id);
    }

    function handlePlayTrack(track: Track, index: number, trackList: Track[]) {
        playTracks(trackList, index);
    }

    function handleRowKeydown(
        e: KeyboardEvent,
        track: Track,
        index: number,
        trackList: Track[],
    ) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handlePlayTrack(track, index, trackList);
        }
    }

    function handleContainerClick(e: MouseEvent, callback: () => void) {
        const target = e.target as HTMLElement;
        if (target.closest(".link") || target.closest("button")) {
            return;
        }
        callback();
    }
</script>

<div class="desktop-home">
    <!-- Greeting -->
    <header class="home-header">
        <h1 class="greeting">{greeting}</h1>
        <button
            class="recap-launch-btn"
            on:click={() => isStatsWrappedOpen.set(true)}
            aria-label="{currentMonthName} Recap"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="18"
                height="18"
            >
                <path
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                ></path>
            </svg>
            <span>{currentMonthName} Recap</span>
        </button>
    </header>

    <!-- Quick Play Grid -->
    {#if quickPlayAlbums.length > 0}
        <section class="quick-play-section">
            <div class="quick-play-grid">
                {#each quickPlayAlbums as album}
                    <button
                        class="quick-play-card"
                        on:click={() => handleQuickPlay(album)}
                    >
                        <div class="quick-play-art">
                            {#if getAlbumCoverSrc(album)}
                                <img
                                    src={getAlbumCoverSrc(album)}
                                    alt={album.name}
                                    decoding="async"
                                />
                            {:else}
                                <div class="quick-play-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="20"
                                        height="20"
                                    >
                                        <path
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <span class="quick-play-name">{album.name}</span>
                    </button>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Recently Played -->
    {#if $recentlyPlayed.length > 0}
        <section class="home-section">
            <h2 class="section-title">Jump Back In</h2>
            <div class="carousel-row">
                {#each $recentlyPlayed.slice(0, 10) as track, i}
                    <div
                        class="carousel-card"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                handlePlayTrack(track, i, $recentlyPlayed),
                            )}
                        on:keydown={(e) =>
                            handleRowKeydown(e, track, i, $recentlyPlayed)}
                    >
                        <div class="carousel-art">
                            {#if getTrackCoverSrc(track)}
                                <img
                                    src={getTrackCoverSrc(track)}
                                    alt={track.title}
                                    decoding="async"
                                />
                            {:else}
                                <div class="carousel-art-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="24"
                                        height="24"
                                    >
                                        <path
                                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                            <div class="carousel-play-overlay">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="24"
                                    height="24"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                        <span class="carousel-title"
                            >{track.title || "Unknown"}</span
                        >
                        <button
                            class="carousel-subtitle link"
                            on:click={() =>
                                goToArtistDetail(track.artist || "Unknown")}
                            title="Go to artist"
                        >
                            {track.artist || "Unknown"}
                        </button>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Top Tracks -->
    {#if $topTracks.length > 0}
        <section class="home-section">
            <h2 class="section-title">Your Top Songs</h2>
            <div class="top-tracks-list">
                {#each $topTracks.slice(0, 10) as { track, play_count }, i}
                    <div
                        class="top-track-row"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                handlePlayTrack(
                                    track,
                                    i,
                                    $topTracks.map((t) => t.track),
                                ),
                            )}
                        on:keydown={(e) =>
                            handleRowKeydown(
                                e,
                                track,
                                i,
                                $topTracks.map((t) => t.track),
                            )}
                    >
                        <span class="top-track-rank">{i + 1}</span>
                        <div class="top-track-art">
                            {#if getTrackCoverSrc(track)}
                                <img
                                    src={getTrackCoverSrc(track)}
                                    alt={track.title}
                                    decoding="async"
                                />
                            {:else}
                                <div class="top-track-art-placeholder">
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
                        <div class="top-track-info">
                            <span class="top-track-title"
                                >{track.title || "Unknown"}</span
                            >
                            <button
                                class="top-track-artist link"
                                on:click={() =>
                                    goToArtistDetail(track.artist || "")}
                                title="Go to artist"
                            >
                                {track.artist || "Unknown"}
                            </button>
                        </div>
                        <span class="top-track-plays">{play_count} plays</span>
                        <span class="top-track-duration"
                            >{formatDuration(track.duration)}</span
                        >
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Top Albums (List View) -->
    {#if $topAlbums.length > 0}
        <section class="home-section">
            <h2 class="section-title">Most Played Albums</h2>
            <div class="top-tracks-list">
                {#each $topAlbums.slice(0, 10) as { album, play_count }, i}
                    <div
                        class="top-track-row"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                goToAlbumDetail(album.id),
                            )}
                        on:keydown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                goToAlbumDetail(album.id);
                            }
                        }}
                    >
                        <span class="top-track-rank">{i + 1}</span>
                        <div class="top-track-art">
                            {#if getAlbumCoverSrc(album)}
                                <img
                                    src={getAlbumCoverSrc(album)}
                                    alt={album.name}
                                    decoding="async"
                                />
                            {:else}
                                <div class="top-track-art-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                    >
                                        <path
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="top-track-info">
                            <span class="top-track-title">{album.name}</span>
                            <button
                                class="top-track-artist link"
                                on:click={() =>
                                    goToArtistDetail(album.artist || "")}
                                title="Go to artist"
                            >
                                {album.artist || "Unknown Artist"}
                            </button>
                        </div>
                        <span class="top-track-plays">{play_count} plays</span>
                    </div>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    .desktop-home {
        padding: 24px 32px;
        overflow-y: auto;
        height: 100%;
    }

    .home-header {
        margin-bottom: 24px;
    }

    .greeting {
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    /* Quick Play Grid */
    .quick-play-section {
        margin-bottom: 32px;
    }

    .quick-play-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
    }

    .quick-play-card {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface-hover, rgba(255, 255, 255, 0.07));
        border: none;
        border-radius: 6px;
        padding: 0;
        cursor: pointer;
        overflow: hidden;
        transition: background 0.2s ease;
        text-align: left;
    }

    .quick-play-card:hover {
        background: var(--surface-active, rgba(255, 255, 255, 0.12));
    }

    .quick-play-art {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
    }

    .quick-play-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .quick-play-placeholder {
        width: 100%;
        height: 100%;
        background: var(--surface-elevated, rgba(255, 255, 255, 0.05));
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .quick-play-name {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-right: 12px;
    }

    /* Liked Songs Card */
    .liked-songs-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        background: linear-gradient(135deg, #450af5, #8e8ee5);
        border: none;
        border-radius: 8px;
        cursor: pointer;
        width: 280px;
        transition:
            transform 0.2s ease,
            box-shadow 0.2s ease;
        text-align: left;
    }

    .liked-songs-card:hover {
        transform: scale(1.02);
        box-shadow: 0 6px 20px rgba(69, 10, 245, 0.3);
    }

    .liked-songs-gradient {
        color: white;
        display: flex;
        align-items: center;
    }

    .liked-songs-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .liked-songs-title {
        font-size: 1rem;
        font-weight: 700;
        color: white;
    }

    .liked-songs-count {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.7);
    }

    /* Section */
    .home-section {
        margin-bottom: 32px;
    }

    .section-title {
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 16px 0;
    }

    /* Carousel Row */
    .carousel-row {
        display: flex;
        gap: 16px;
        overflow-x: auto;
        padding-bottom: 8px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }

    .carousel-row::-webkit-scrollbar {
        height: 6px;
    }

    .carousel-row::-webkit-scrollbar-track {
        background: transparent;
        border-radius: 3px;
    }

    .carousel-row::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
    }

    .carousel-row::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.35);
    }

    .carousel-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: var(--surface-hover, rgba(255, 255, 255, 0.04));
        border: none;
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
        min-width: 160px;
        max-width: 160px;
        transition: background 0.2s ease;
        text-align: left;
    }

    .carousel-card:hover {
        background: var(--surface-active, rgba(255, 255, 255, 0.1));
    }

    .carousel-art {
        width: 136px;
        height: 136px;
        border-radius: 6px;
        overflow: hidden;
        position: relative;
        flex-shrink: 0;
    }

    .carousel-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .carousel-art-placeholder {
        width: 100%;
        height: 100%;
        background: var(--surface-elevated, rgba(255, 255, 255, 0.06));
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .carousel-play-overlay {
        position: absolute;
        bottom: 8px;
        right: 8px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--accent-color, #1db954);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .carousel-card:hover .carousel-play-overlay {
        opacity: 1;
        transform: translateY(0);
    }

    .carousel-title {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .carousel-subtitle {
        font-size: 0.75rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .carousel-subtitle.link {
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
    }

    .carousel-subtitle.link:hover {
        text-decoration: underline;
        color: var(--text-primary);
    }

    .carousel-subtitle-container {
        display: flex;
        align-items: center;
        overflow: hidden;
        width: 100%;
        max-width: 100%;
        gap: 4px;
    }

    .carousel-subtitle-plays {
        font-size: 0.75rem;
        color: var(--text-subdued);
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* Top Tracks List */
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

    .top-track-rank {
        width: 32px;
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-subdued);
        text-align: center;
        flex-shrink: 0;
        font-family: "JetBrains Mono", monospace;
        opacity: 0.5;
    }

    .top-track-row:hover .top-track-rank {
        color: var(--accent-color, #1db954);
        opacity: 1;
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
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .top-track-artist {
        font-size: 0.75rem;
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
        font-size: 0.75rem;
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .top-track-duration {
        font-size: 0.75rem;
        color: var(--text-subdued);
        width: 48px;
        text-align: right;
        flex-shrink: 0;
    }
    .home-header {
        margin-bottom: var(--spacing-xl);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .greeting {
        font-size: 2rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.02em;
        margin: 0;
    }

    .recap-launch-btn {
        background: linear-gradient(135deg, #1ed760 0%, #17a34a 100%);
        color: black;
        border: none;
        padding: 8px 20px;
        border-radius: 20px;
        font-size: 0.9rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition:
            transform 0.2s,
            box-shadow 0.2s;
        box-shadow: 0 4px 12px rgba(30, 215, 96, 0.2);
    }

    .recap-launch-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(30, 215, 96, 0.3);
    }

    .recap-launch-btn:active {
        transform: translateY(0);
    }
</style>
