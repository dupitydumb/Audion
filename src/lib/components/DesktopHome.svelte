<script lang="ts">
    import { onMount } from "svelte";
    import { formatDuration, type Track, type Album, type Playlist, getPlaylistTracks, getTracksByAlbum } from "$lib/api/tauri";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import {
        playTracks,
        currentAlbumId,
        currentTrackId,
        currentPlaylistId,
        isPlaying,
        togglePlay,
    } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import {
        albums as libraryAlbums,
        playlists as libraryPlaylists,
        getAlbumCoverFromTracks,
        getTrackAlbumCover,
    } from "$lib/stores/library";
    import {
        topTracks,
        topAlbums,
        recentlyPlayed,
        continueListening,
        recentlyAddedAlbums,
        statsSummary,
        loadActivityData,
    } from "$lib/stores/activity";
    import { goToAlbumDetail, goToArtistDetail, goToPlaylistDetail } from "$lib/stores/view";
    import { isStatsWrappedOpen } from "$lib/stores/ui";
    import MediaCard from "./MediaCard.svelte";
    import { onDestroy } from "svelte";
    import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
    import { fetchAllLatestCharts, type ChartData } from "$lib/api/audion-api";
    import { _, locale } from "svelte-i18n";
    import { pinnedItems } from "$lib/stores/pinned";
    import { playlistCovers } from "$lib/stores/playlistCovers";
    import { homeLayout, toggleSection, reorderSection } from "$lib/stores/homeLayout";
    import { buildAlbumContextMenu, buildTrackContextMenu, isTrackUnavailable } from "$lib/menus/contextMenus";
    import QuickPlayGrid from "./desktophome/QuickPlayGrid.svelte";
    import StatsWidget from "./desktophome/StatsWidget.svelte";
    import CustomizeMenu from "./desktophome/CustomizeMenu.svelte";
    import TopTracks from "./desktophome/TopTracks.svelte";
    import TopAlbums from "./desktophome/TopAlbums.svelte";
    import ChartsSection from "./desktophome/ChartsSection.svelte";

    let homeEl: HTMLDivElement;
    let scrollRestored = false;
    let currentScrollTop = 0;

    onDestroy(() => {
        saveScroll("home", currentScrollTop);
    });

    $: currentMonthName = new Intl.DateTimeFormat($locale || 'en', { month: 'long' }).format(new Date());

    let greetingKey = "goodEvening";
    const hour = new Date().getHours();
    if (hour < 12) greetingKey = "goodMorning";
    else if (hour < 18) greetingKey = "goodAfternoon";

    let showCustomizeMenu = false;

    let charts: ChartData[] = [];
    let loadingCharts = true;

    onMount(async () => {
        loadActivityData();
        const saved = getScroll("home");
        if (saved > 0 && homeEl) {
            homeEl.scrollTop = saved;
        }
        scrollRestored = true;
        try {
            charts = await fetchAllLatestCharts();
        } finally {
            loadingCharts = false;
        }
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

    // Pinned Items
    $: pinnedAlbums = $pinnedItems.albums
        .map(id => $libraryAlbums.find(a => a.id === id))
        .filter((a): a is Album => !!a);

    $: pinnedPlaylists = $pinnedItems.playlists
        .map(id => $libraryPlaylists.find(p => p.id === id))
        .filter((p): p is Playlist => !!p);

    $: pinnedItemsList = [
        ...pinnedAlbums.map(album => ({ type: 'album' as const, id: album.id, data: album })),
        ...pinnedPlaylists.map(playlist => ({ type: 'playlist' as const, id: playlist.id, data: playlist }))
    ];

    async function playPlaylist(playlist: Playlist) {
        if ($currentPlaylistId === playlist.id && $isPlaying) {
            togglePlay();
            return;
        }
        try {
            const tracks = await getPlaylistTracks(playlist.id);
            if (tracks.length > 0) {
                playTracks(tracks, 0, {
                    type: "playlist",
                    playlistId: playlist.id,
                    displayName: playlist.name,
                });
            }
        } catch (err) {
            console.error("Failed to play playlist:", err);
        }
    }

    function initialsFromName(name: string): string {
        if (!name) return "PL";
        const parts = name.trim().split(/\s+/);
        return (
            parts
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("") || name.slice(0, 2).toUpperCase()
        );
    }

    function hashToColor(str: string): string {
        let h = 0;
        for (let i = 0; i < str.length; i++)
            h = (h << 5) - h + str.charCodeAt(i);
        return `hsl(${Math.abs(h) % 360} 30% 30%)`;
    }

    function generateSvgCover(name: string, size = 512): string {
        const initials = initialsFromName(name);
        const bg = hashToColor(name || "playlist");
        const svg =
            `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
            `<rect width='100%' height='100%' fill='${bg}'/>` +
            `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Inter, system-ui, sans-serif' font-size='${Math.floor(size / 3)}' fill='white' font-weight='700'>${initials}</text>` +
            `</svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    }

    function getPlaylistCover(playlist: Playlist): string {
        return (
            $playlistCovers?.[playlist.id] ??
            playlist.cover_url ??
            generateSvgCover(playlist.name || "Playlist", 512)
        );
    }

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

    function playRecentTrack(track: Track, index: number) {
        playTracks($recentlyPlayed, index);
    }

    function playContinueListeningTrack(track: Track, index: number) {
        playTracks($continueListening, index);
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
            items: buildAlbumContextMenu({
                album,
                showPlay: true,
                showGoToArtist: true,
                showPin: false,
                onPlay: playAlbum,
                t: $_,
            }),
        });
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
            items: buildTrackContextMenu({
                track,
                trackIndex: index,
                sortedTracks: trackList,
                isUnavailable: isTrackUnavailable(track),
                variant: "home",
                t: $_,
            }),
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
        <h1 class="greeting">{$_(`home.${greetingKey}`)}</h1>
        <div class="home-header-actions">
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
                <span>{currentMonthName} {$_('home.recap')}</span>
            </button>
            <button
                class="customize-home-btn"
                on:click={() => showCustomizeMenu = !showCustomizeMenu}
                aria-label="Customize Home Layout"
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
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>Customize</span>
            </button>
        </div>
    </header>

    {#if showCustomizeMenu}
        <CustomizeMenu on:close={() => showCustomizeMenu = false} />
    {/if}

    {#each $homeLayout as section (section.id)}
        {#if section.visible}
            {#if section.id === 'stats'}
                {#if $statsSummary && $statsSummary.total_plays > 0}
                    <StatsWidget statsSummary={$statsSummary} />
                {/if}
            {:else if section.id === 'pinned'}
                <!-- Pinned Items -->
                {#if pinnedItemsList.length > 0}
                    <section class="home-section">
                        <h2 class="section-title">{$_('home.pinned')}</h2>
                        <div class="carousel-row">
                            {#each pinnedItemsList as item}
                                {@const isAlbum = item.type === 'album'}
                                {@const isNowPlaying = isAlbum
                                    ? playingAlbumId === item.id && playing
                                    : $currentPlaylistId === item.id && playing}
                                {@const isPaused = isAlbum
                                    ? pausedAlbumId === item.id
                                    : $currentPlaylistId === item.id && !playing}
                                <div class="carousel-card-wrapper" role="listitem">
                                    <MediaCard
                                        {isNowPlaying}
                                        {isPaused}
                                        isPinned={true}
                                        playTooltip={isAlbum ? "Play album" : "Play playlist"}
                                        resumeTooltip={isAlbum ? "Resume album" : "Resume playlist"}
                                        pauseTooltip="Pause"
                                        primaryText={item.data.name}
                                        ariaLabel={item.data.name}
                                        on:play={() => isAlbum ? playAlbum(item.data) : playPlaylist(item.data)}
                                        on:pause={togglePlay}
                                        on:click={() => isAlbum ? goToAlbumDetail(item.id) : goToPlaylistDetail(item.id, item.data.name)}
                                    >
                                        <svelte:fragment slot="secondary" let:isActive>
                                            {#if isAlbum}
                                                <ArtistLinks
                                                    artist={item.data.artist}
                                                    artists={item.data.artists}
                                                    chipClass="text-inner secondary-link"
                                                    marquee
                                                    marqueeTrigger="external"
                                                    marqueeActive={isActive}
                                                    resetKey={item.id}
                                                    on:select={(e) => goToArtistDetail(e.detail)}
                                                />
                                            {:else}
                                                Playlist
                                            {/if}
                                        </svelte:fragment>
                                        <svelte:fragment slot="cover">
                                            {#if isAlbum}
                                                {#if getAlbumCoverFromTracks(item.id)}
                                                    <img
                                                        src={getAlbumCoverFromTracks(item.id)}
                                                        alt={item.data.name}
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                {:else}
                                                    <div class="cover-placeholder">
                                                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                                                        </svg>
                                                    </div>
                                                {/if}
                                            {:else}
                                                <img
                                                    src={getPlaylistCover(item.data)}
                                                    alt={item.data.name}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            {/if}
                                        </svelte:fragment>
                                    </MediaCard>
                                </div>
                            {/each}
                        </div>
                    </section>
                {/if}
            {:else if section.id === 'quickplay'}
                {#if quickPlayAlbums.length > 0}
                    <QuickPlayGrid
                        albums={quickPlayAlbums}
                        {playingAlbumId}
                        {playing}
                        {pausedAlbumId}
                        {playAlbum}
                        {albumContextMenu}
                    />
                {/if}
            {:else if section.id === 'recent'}
                <!-- Recently Played -->
                {#if $recentlyPlayed.length > 0}
                    <section class="home-section">
                        <h2 class="section-title">{$_('home.jumpBackIn')}</h2>
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
                                        ariaLabel={track.title || "Unknown"}
                                        on:play={() => playRecentTrack(track, i)}
                                        on:pause={togglePlay}
                                    >
                                        <svelte:fragment slot="secondary" let:isActive>
                                            <ArtistLinks
                                                artist={track.artist}
                                                artists={track.artists}
                                                chipClass="text-inner secondary-link"
                                                marquee
                                                marqueeTrigger="external"
                                                marqueeActive={isActive}
                                                resetKey={track.id}
                                                on:select={(e) => goToArtistDetail(e.detail)}
                                            />
                                        </svelte:fragment>
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
            {:else if section.id === 'continue'}
                <!-- Continue Listening -->
                {#if $continueListening.length > 0}
                    <section class="home-section">
                        <h2 class="section-title">{$_('home.continueListening')}</h2>
                        <div class="carousel-row">
                            {#each $continueListening.slice(0, 10) as track, i}
                                {@const isNowPlaying = playingTrackId === track.id && playing}
                                {@const isPaused = pausedTrackId === track.id}
                                <div
                                    class="carousel-card-wrapper"
                                    role="listitem"
                                    on:contextmenu={(e) =>
                                        trackContextMenu(
                                            track,
                                            i,
                                            $continueListening.slice(0, 10),
                                            e,
                                        )}
                                >
                                    <MediaCard
                                        {isNowPlaying}
                                        {isPaused}
                                        playTooltip="Play"
                                        resumeTooltip="Resume"
                                        pauseTooltip="Pause"
                                        primaryText={track.album || "Unknown Album"}
                                        secondaryText={track.title || "Unknown Track"}
                                        ariaLabel={track.album || "Unknown Album"}
                                        on:play={() => playContinueListeningTrack(track, i)}
                                        on:pause={togglePlay}
                                        on:click={() => track.album_id && goToAlbumDetail(track.album_id)}
                                    >
                                        <svelte:fragment slot="cover">
                                            {#if getTrackAlbumCover(track.id)}
                                                <img
                                                    src={getTrackAlbumCover(track.id)}
                                                    alt={track.album}
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
            {:else if section.id === 'added'}
                <!-- Recently Added Albums -->
                {#if $recentlyAddedAlbums.length > 0}
                    <section class="home-section">
                        <h2 class="section-title">{$_('home.recentlyAdded')}</h2>
                        <div class="carousel-row">
                            {#each $recentlyAddedAlbums.slice(0, 10) as album}
                                {@const isNowPlaying = playingAlbumId === album.id && playing}
                                {@const isPaused = pausedAlbumId === album.id}
                                <div class="carousel-card-wrapper" role="listitem">
                                    <MediaCard
                                        {isNowPlaying}
                                        {isPaused}
                                        playTooltip="Play"
                                        resumeTooltip="Resume"
                                        pauseTooltip="Pause"
                                        primaryText={album.name}
                                        ariaLabel={album.name}
                                        on:play={() => playAlbum(album)}
                                        on:pause={togglePlay}
                                        on:click={() => goToAlbumDetail(album.id)}
                                    >
                                        <svelte:fragment slot="secondary" let:isActive>
                                            <ArtistLinks
                                                artist={album.artist}
                                                artists={album.artists}
                                                chipClass="text-inner secondary-link"
                                                marquee
                                                marqueeTrigger="external"
                                                marqueeActive={isActive}
                                                resetKey={album.id}
                                                on:select={(e) => goToArtistDetail(e.detail)}
                                            />
                                        </svelte:fragment>
                                        <svelte:fragment slot="cover">
                                            {#if getAlbumCoverFromTracks(album.id)}
                                                <img
                                                    src={getAlbumCoverFromTracks(album.id)}
                                                    alt={album.name}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            {:else}
                                                <div class="cover-placeholder">
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
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
            {:else if section.id === 'topTracks'}
                {#if $topTracks.length > 0}
                    <TopTracks
                        topTracks={$topTracks}
                        {playingTrackId}
                        {pausedTrackId}
                        {playing}
                    />
                {/if}
            {:else if section.id === 'topAlbums'}
                {#if $topAlbums.length > 0}
                    <TopAlbums
                        topAlbums={$topAlbums}
                        {playingAlbumId}
                        {pausedAlbumId}
                        {playing}
                    />
                {/if}
            {:else if section.id === 'charts'}
                {#if !loadingCharts && charts.length > 0}
                    <ChartsSection
                        {charts}
                        {playingTrackId}
                        {playing}
                    />
                {/if}
            {/if}
        {/if}
    {/each}
</div>

<style>
    .desktop-home {
        padding: 24px 32px;
        overflow-y: auto;
        overflow-x: hidden;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 24px;
    }



    .home-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }

    .home-header-actions {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .greeting {
        font-size: 2rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.02em;
    }

    .recap-launch-btn, .customize-home-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 16px;
        border-radius: 20px;
        color: var(--text-primary);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .recap-launch-btn:hover, .customize-home-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        transform: translateY(-1px);
        border-color: var(--accent-primary);
    }

    .recap-launch-btn svg, .customize-home-btn svg {
        color: var(--accent-primary);
    }





    /* ── Quick Play Grid ── */


    /* Section */
    .home-section {
        margin-bottom: 32px;
    }

    .section-title {
        font-size: 1.4rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 16px 0;
    }

    /* Carousel Row */
    .carousel-row {
        display: flex;
        gap: 16px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
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

</style>