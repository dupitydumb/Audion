<script lang="ts">
    import { onMount } from "svelte";
    import { formatDuration, type Track, type Album } from "$lib/api/tauri";
    import {
        playTracks,
        addToQueue,
        currentAlbumId,
        currentTrackId,
        isPlaying,
        togglePlay,
    } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import {
        albums as libraryAlbums,
        getAlbumCoverFromTracks,
        getTrackAlbumCover,
    } from "$lib/stores/library";
    import {
        topTracks,
        topAlbums,
        recentlyPlayed,
        loadActivityData,
    } from "$lib/stores/activity";
    import { goToAlbumDetail, goToArtistDetail } from "$lib/stores/view";
    import { isStatsWrappedOpen } from "$lib/stores/ui";
    import { getTracksByAlbum } from "$lib/api/tauri";
    import MediaCard from "./MediaCard.svelte";
    import { onDestroy } from "svelte";
    import { saveScroll, getScroll } from "$lib/stores/scrollMemory";

    let homeEl: HTMLDivElement;
    let scrollRestored = false;
    let currentScrollTop = 0;

    onDestroy(() => {
        saveScroll("home", currentScrollTop);
    });

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
    const currentMonthName = monthNames[new Date().getMonth()];

    let greeting = "Good evening";
    const hour = new Date().getHours();
    if (hour < 12) greeting = "Good morning";
    else if (hour < 18) greeting = "Good afternoon";

    onMount(() => {
        loadActivityData();
        const saved = getScroll("home");
        if (saved > 0 && homeEl) {
            homeEl.scrollTop = saved;
        }
        scrollRestored = true;
    });

    // Playback state
    $: playingAlbumId = $currentAlbumId;
    $: playingTrackId = $currentTrackId;
    $: playing = $isPlaying;
    $: pausedAlbumId = !playing ? playingAlbumId : null;
    $: pausedTrackId = !playing ? playingTrackId : null;

    // Derived lists
    $: quickPlayAlbums =
        $topAlbums.length > 0
            ? $topAlbums.slice(0, 6).map((ta) => ta.album)
            : $libraryAlbums.slice(0, 6);

    $: topTrackList = $topTracks.map((t) => t.track);

    // Quick-play card: play button clicks play the album,
    // clicks anywhere else on the card navigate to album detail.
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

    function handleQuickPlayCardClick(album: Album, e: MouseEvent) {
        // Play button is handled via stopPropagation — anything else navigates
        goToAlbumDetail(album.id);
    }

    function playRecentTrack(track: Track, index: number) {
        playTracks($recentlyPlayed, index);
    }

    function playTopTrack(track: Track, index: number) {
        playTracks(topTrackList, index);
    }

    // Interaction helpers
    function handleContainerClick(e: MouseEvent, callback: () => void) {
        if (
            (e.target as HTMLElement).closest(".link") ||
            (e.target as HTMLElement).closest("button")
        )
            return;
        callback();
    }

    function handleKeyActivate(e: KeyboardEvent, action: () => void) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            action();
        }
    }

    // Context menus
    function albumContextMenu(album: Album, e: MouseEvent) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play", action: () => playAlbum(album) },
                {
                    label: "Go to Album",
                    action: () => goToAlbumDetail(album.id),
                },
                {
                    label: "Go to Artist",
                    action: () => goToArtistDetail(album.artist || ""),
                },
            ],
        });
    }

    // ── Marquee
    const MARQUEE_GAP = 64;

    let marqueeActive: Record<number, boolean> = {};
    let marqueeOverflows: Record<number, { name: boolean; artist: boolean }> =
        {};
    let marqueeDurations: Record<number, { name: string; artist: string }> = {};

    let nameEls = new Map<number, HTMLSpanElement>();
    let artistEls = new Map<number, HTMLButtonElement>();

    function measureQPOverflow(albumId: number) {
        if (marqueeOverflows[albumId]) return; // already measured — use cache
        requestAnimationFrame(() => {
            const nameEl = nameEls.get(albumId);
            const artistEl = artistEls.get(albumId);
            const nameOverflows = nameEl
                ? nameEl.scrollWidth > nameEl.clientWidth
                : false;
            const artistOverflows = artistEl
                ? artistEl.scrollWidth > artistEl.clientWidth
                : false;
            marqueeDurations = {
                ...marqueeDurations,
                [albumId]: {
                    name:
                        nameEl && nameOverflows
                            ? `${Math.max(4, (nameEl.scrollWidth + MARQUEE_GAP) / 60).toFixed(1)}s`
                            : "0s",
                    artist:
                        artistEl && artistOverflows
                            ? `${Math.max(4, (artistEl.scrollWidth + MARQUEE_GAP) / 60).toFixed(1)}s`
                            : "0s",
                },
            };
            marqueeOverflows = {
                ...marqueeOverflows,
                [albumId]: { name: nameOverflows, artist: artistOverflows },
            };
        });
    }

    function handleQPMouseEnter(albumId: number) {
        marqueeActive = { ...marqueeActive, [albumId]: true };
        measureQPOverflow(albumId);
    }

    function handleQPMouseLeave(albumId: number) {
        marqueeActive = { ...marqueeActive, [albumId]: false };
        // Clear cached overflow on leave so layout changes
        const { [albumId]: _o, ...restO } = marqueeOverflows;
        marqueeOverflows = restO;
        const { [albumId]: _d, ...restD } = marqueeDurations;
        marqueeDurations = restD;
    }

    function registerNameEl(node: HTMLSpanElement, albumId: number) {
        nameEls.set(albumId, node);
        return {
            destroy() {
                nameEls.delete(albumId);
            },
        };
    }

    function registerArtistEl(node: HTMLButtonElement, albumId: number) {
        artistEls.set(albumId, node);
        return {
            destroy() {
                artistEls.delete(albumId);
            },
        };
    }

    function trackContextMenu(
        track: Track,
        index: number,
        trackList: Track[],
        e: MouseEvent,
    ) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play", action: () => playTracks(trackList, index) },
                { label: "Add to Queue", action: () => addToQueue([track]) },
                { type: "separator" },
                {
                    label: "Go to Artist",
                    action: () => goToArtistDetail(track.artist || ""),
                },
                {
                    label: "Go to Album",
                    action: () => {
                        if (track.album_id) goToAlbumDetail(track.album_id);
                    },
                    disabled: !track.album_id,
                },
            ],
        });
    }
</script>

<div
    class="desktop-home"
    bind:this={homeEl}
    style="visibility: {scrollRestored || getScroll('home') === 0
        ? 'visible'
        : 'hidden'};"
    on:scroll={(e) => {
        currentScrollTop = (e.target as HTMLElement).scrollTop;
    }}
>
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
                aria-hidden="true"
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
                    {@const isNowPlaying =
                        playingAlbumId === album.id && playing}
                    {@const isPaused = pausedAlbumId === album.id}
                    {@const active = marqueeActive[album.id]}
                    {@const overflows = marqueeOverflows[album.id] ?? {
                        name: false,
                        artist: false,
                    }}
                    {@const durations = marqueeDurations[album.id] ?? {
                        name: "0s",
                        artist: "0s",
                    }}
                    <div
                        class="quick-play-card"
                        class:now-playing={isNowPlaying}
                        class:paused={isPaused}
                        role="button"
                        tabindex="0"
                        on:click={(e) => handleQuickPlayCardClick(album, e)}
                        on:keydown={(e) =>
                            handleKeyActivate(e, () =>
                                goToAlbumDetail(album.id),
                            )}
                        on:contextmenu={(e) => albumContextMenu(album, e)}
                    >
                        <div
                            class="quick-play-art"
                            role="button"
                            tabindex="-1"
                            aria-label={isNowPlaying
                                ? "Pause"
                                : isPaused
                                  ? "Resume"
                                  : "Play"}
                            on:click|stopPropagation={() => playAlbum(album)}
                            on:keydown|stopPropagation={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    playAlbum(album);
                                }
                            }}
                        >
                            {#if getAlbumCoverFromTracks(album.id)}
                                <img
                                    src={getAlbumCoverFromTracks(album.id)}
                                    alt={album.name}
                                    loading="lazy"
                                    decoding="async"
                                />
                            {:else}
                                <div class="quick-play-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="20"
                                        height="20"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                            <div
                                class="quick-play-hover-overlay"
                                aria-hidden="true"
                            >
                                {#if isNowPlaying}
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="18"
                                        height="18"
                                    >
                                        <path
                                            d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"
                                        />
                                    </svg>
                                {:else}
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="18"
                                        height="18"
                                    >
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                {/if}
                            </div>
                        </div>
                        <div
                            class="quick-play-text"
                            role="presentation"
                            on:mouseenter={() => handleQPMouseEnter(album.id)}
                            on:mouseleave={() => handleQPMouseLeave(album.id)}
                        >
                            <div
                                class="qp-text-track"
                                class:animate={active && overflows.name}
                            >
                                <span
                                    class="quick-play-name"
                                    class:accent={isNowPlaying || isPaused}
                                    class:qp-marquee={active && overflows.name}
                                    style="--marquee-duration: {durations.name};"
                                    use:registerNameEl={album.id}
                                    >{album.name}</span
                                >
                                {#if active && overflows.name}
                                    <span
                                        class="quick-play-name qp-marquee"
                                        class:accent={isNowPlaying || isPaused}
                                        aria-hidden="true"
                                        style="--marquee-duration: {durations.name};"
                                        >{album.name}</span
                                    >
                                {/if}
                            </div>
                            {#if album.artist}
                                <div
                                    class="qp-text-track"
                                    class:animate={active && overflows.artist}
                                >
                                    <button
                                        class="quick-play-artist"
                                        class:qp-marquee={active &&
                                            overflows.artist}
                                        style="--marquee-duration: {durations.artist};"
                                        on:click|stopPropagation={() =>
                                            goToArtistDetail(album.artist!)}
                                        title="Go to artist"
                                        use:registerArtistEl={album.id}
                                        >{album.artist}</button
                                    >
                                    {#if active && overflows.artist}
                                        <button
                                            class="quick-play-artist qp-marquee"
                                            aria-hidden="true"
                                            style="--marquee-duration: {durations.artist};"
                                            on:click|stopPropagation={() =>
                                                goToArtistDetail(album.artist!)}
                                            >{album.artist}</button
                                        >
                                    {/if}
                                </div>
                            {/if}
                        </div>
                        {#if isNowPlaying || isPaused}
                            <div class="quick-play-eq" aria-hidden="true">
                                <span class="eq-bar" class:paused={isPaused}
                                ></span>
                                <span class="eq-bar" class:paused={isPaused}
                                ></span>
                                <span class="eq-bar" class:paused={isPaused}
                                ></span>
                            </div>
                        {/if}
                    </div>
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
                    {@const isNowPlaying =
                        playingTrackId === track.id && playing}
                    {@const isPaused = pausedTrackId === track.id}
                    <div
                        class="carousel-card-wrapper"
                        role="listitem"
                        on:contextmenu={(e) =>
                            trackContextMenu(
                                track,
                                i,
                                $recentlyPlayed.slice(0, 10),
                                e,
                            )}
                    >
                        <MediaCard
                            {isNowPlaying}
                            {isPaused}
                            playTooltip="Play"
                            resumeTooltip="Resume"
                            pauseTooltip="Pause"
                            primaryText={track.title || "Unknown"}
                            secondaryText={track.artist || "Unknown"}
                            secondaryAction={track.artist
                                ? () => goToArtistDetail(track.artist!)
                                : null}
                            ariaLabel={track.title || "Unknown"}
                            on:play={() => playRecentTrack(track, i)}
                            on:pause={togglePlay}
                        >
                            <svelte:fragment slot="cover">
                                {#if getTrackAlbumCover(track.id)}
                                    <img
                                        src={getTrackAlbumCover(track.id)}
                                        alt={track.title}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                {:else}
                                    <div class="cover-placeholder">
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            width="24"
                                            height="24"
                                            aria-hidden="true"
                                        >
                                            <path
                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                            />
                                        </svg>
                                    </div>
                                {/if}
                            </svelte:fragment>
                        </MediaCard>
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
                    {@const isNowPlaying =
                        playingTrackId === track.id && playing}
                    {@const isPaused = pausedTrackId === track.id}
                    <div
                        class="top-track-row"
                        class:now-playing={isNowPlaying}
                        class:paused={isPaused}
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                playTopTrack(track, i),
                            )}
                        on:keydown={(e) =>
                            handleKeyActivate(e, () => playTopTrack(track, i))}
                        on:contextmenu={(e) =>
                            trackContextMenu(track, i, topTrackList, e)}
                    >
                        <span class="top-track-rank">
                            {#if isNowPlaying}
                                <span
                                    class="equalizer"
                                    aria-label="Now playing"
                                >
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                </span>
                            {:else if isPaused}
                                <span
                                    class="equalizer paused"
                                    aria-label="Paused"
                                >
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
                                <img
                                    src={getTrackAlbumCover(track.id)}
                                    alt={track.title}
                                    loading="lazy"
                                    decoding="async"
                                />
                            {:else}
                                <div class="top-track-art-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="top-track-info">
                            <span
                                class="top-track-title"
                                class:accent={isNowPlaying || isPaused}
                                >{track.title || "Unknown"}</span
                            >
                            <button
                                class="top-track-artist link"
                                on:click|stopPropagation={() =>
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
                    {@const isNowPlaying =
                        playingAlbumId === album.id && playing}
                    {@const isPaused = pausedAlbumId === album.id}
                    <div
                        class="top-track-row"
                        class:now-playing={isNowPlaying}
                        class:paused={isPaused}
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                goToAlbumDetail(album.id),
                            )}
                        on:keydown={(e) =>
                            handleKeyActivate(e, () =>
                                goToAlbumDetail(album.id),
                            )}
                        on:contextmenu={(e) => albumContextMenu(album, e)}
                    >
                        <span class="top-track-rank">
                            {#if isNowPlaying}
                                <span
                                    class="equalizer"
                                    aria-label="Now playing"
                                >
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                </span>
                            {:else if isPaused}
                                <span
                                    class="equalizer paused"
                                    aria-label="Paused"
                                >
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
                                <img
                                    src={getAlbumCoverFromTracks(album.id)}
                                    alt={album.name}
                                    loading="lazy"
                                    decoding="async"
                                />
                            {:else}
                                <div class="top-track-art-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="top-track-info">
                            <span
                                class="top-track-title"
                                class:accent={isNowPlaying || isPaused}
                                >{album.name}</span
                            >
                            <button
                                class="top-track-artist link"
                                on:click|stopPropagation={() =>
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
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xl);
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

    /* ── Quick Play Grid ── */
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

    .quick-play-card.now-playing,
    .quick-play-card.paused {
        background: var(--accent-subtle);
    }

    .quick-play-card.now-playing:hover,
    .quick-play-card.paused:hover {
        background: var(--accent-subtle);
        opacity: 0.95;
    }

    .quick-play-art {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        position: relative;
        cursor: pointer;
        border-radius: var(--radius-sm);
        overflow: hidden;
    }

    .quick-play-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
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

    .quick-play-hover-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity var(--transition-fast);
        background: rgba(0, 0, 0, 0.35);
        color: white;
        pointer-events: none;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
    }

    .quick-play-art:hover .quick-play-hover-overlay {
        opacity: 1;
    }

    .quick-play-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: 2px;
        overflow: hidden;
    }

    .qp-text-track {
        display: flex;
        flex-direction: row;
        overflow: hidden;
        position: relative;
    }

    .qp-text-track.animate {
        -webkit-mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 4%,
            black 92%,
            transparent 100%
        );
        mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 4%,
            black 92%,
            transparent 100%
        );
    }

    .quick-play-name {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
        max-width: 100%;
    }

    .quick-play-name.accent {
        color: var(--accent-primary);
    }

    .quick-play-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
        max-width: 100%;
        font-family: inherit;
    }

    .quick-play-artist:hover {
        text-decoration: underline;
        color: var(--text-primary);
    }

    .qp-marquee {
        overflow: visible;
        text-overflow: clip;
        max-width: none;
        padding-right: 64px;
        animation: qp-marquee-scroll var(--marquee-duration) linear infinite;
    }

    @keyframes qp-marquee-scroll {
        from {
            transform: translateX(0);
        }
        to {
            transform: translateX(-100%);
        }
    }

    .quick-play-eq {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        flex-shrink: 0;
        height: 20px;
        padding-right: 12px;
    }

    .eq-bar {
        width: 4px;
        background-color: var(--accent-primary);
        border-radius: 2px;
        animation: qp-equalizer 0.8s ease-in-out infinite;
    }

    .eq-bar.paused {
        animation-play-state: paused;
        height: 8px;
        background-color: var(--text-secondary);
    }

    .eq-bar:nth-child(2) {
        animation-delay: 0.2s;
    }
    .eq-bar:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes qp-equalizer {
        0%,
        100% {
            height: 4px;
        }
        50% {
            height: 18px;
        }
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

    .carousel-card-wrapper {
        width: 160px;
        flex-shrink: 0;
    }

    .cover-placeholder {
        width: 100%;
        height: 100%;
        background: var(--surface-elevated, rgba(255, 255, 255, 0.06));
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
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
        font-size: 1rem;
        font-weight: 700;
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

    .equalizer .bar:nth-child(2) {
        animation-delay: 0.2s;
    }
    .equalizer .bar:nth-child(3) {
        animation-delay: 0.4s;
    }

    .equalizer.paused .bar {
        animation-play-state: paused;
        height: 8px;
        background-color: var(--text-secondary);
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

    .top-track-title.accent {
        color: var(--accent-primary);
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
</style>
