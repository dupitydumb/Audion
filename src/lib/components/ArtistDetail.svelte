<script lang="ts">
    import { onMount } from "svelte";
    import type { Album, Track } from "$lib/api/tauri";
    import {
        getAlbumsByArtist,
        getTracksByArtist,
        formatDuration,
        getArtistMusicBrainzInfo,
        getSimilarArtistsMb,
        getArtistDiscographyMb,
        type MbArtistInfo,
        type MbSimilarArtist,
        type MbDiscographyItem,
    } from "$lib/api/tauri";
    import { playTracks, currentTrack, isPlaying, togglePlay } from "$lib/stores/player";
    import {
        goToArtists,
        goToAlbumDetail,
        goToArtistDetail,
        activeHeroKey,
    } from "$lib/stores/view";
    import AlbumGrid from "./AlbumGrid.svelte";
    import TrackList from "./track-list/TrackList.svelte";
    import MediaCard from "./MediaCard.svelte";
    import SkeletonCard from "$lib/components/common/SkeletonCard.svelte";
    import { extractPalette } from "$lib/stores/palette";
    import { likedTrackIds, toggleLikeTrack } from "$lib/stores/liked";
    import { getAlbumCoverFromTracks } from "$lib/stores/library";
    import {
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";
    import { contextMenu } from "$lib/stores/ui";
    import { buildArtistContextMenu } from "$lib/menus/contextMenus";
    import { _, locale } from "svelte-i18n";
    import { isMobile } from "$lib/stores/mobile";
    import Icon from "$lib/components/Icon.svelte";

    export let artistName: string;

    let albums: Album[] = [];
    let tracks: Track[] = [];
    let loading = true;
    let activeTab: "albums" | "tracks" | "about" = "albums";

    // MusicBrainz artist info
    let mbInfo: MbArtistInfo | null = null;
    let mbLoading = false;
    let mbError: string | null = null;
    let mbFetched = false;

    // Similar artists from MB
    let similarArtists: MbSimilarArtist[] = [];
    let similarLoading = false;
    let similarFetched = false;

    // MusicBrainz discography
    let discography: MbDiscographyItem[] = [];
    let discoLoading = false;
    let discoFetched = false;
    let showAllDiscoTypes = false;
    let failedCovers = new Set<string>();

    const DISCO_PRIMARY = ["album", "single"];

    function discoTypeClass(rt: string): string {
        const l = rt.toLowerCase();
        if (l === "album") return "rt-album";
        if (l === "single") return "rt-single";
        if (l === "ep") return "rt-ep";
        if (l === "live") return "rt-live";
        if (l === "compilation") return "rt-compilation";
        if (l === "soundtrack") return "rt-soundtrack";
        if (l === "remix") return "rt-remix";
        return "rt-other";
    }

    $: filteredDisco = showAllDiscoTypes
        ? discography
        : discography.filter((d) =>
              DISCO_PRIMARY.includes(d.release_type.toLowerCase()),
          );
    $: hiddenDiscoCount = discography.length - filteredDisco.length;

    function handleCoverError(mbid: string) {
        failedCovers.add(mbid);
        failedCovers = failedCovers; // trigger reactivity
    }

    async function loadMbInfo() {
        if (mbFetched || mbLoading) return;
        mbLoading = true;
        mbError = null;
        try {
            mbInfo = await getArtistMusicBrainzInfo(artistName);
        } catch (e: any) {
            mbError = e?.toString?.() || "Failed to load artist info";
        } finally {
            mbLoading = false;
            mbFetched = true;
        }
    }

    async function loadSimilarArtists() {
        if (similarFetched || similarLoading) return;
        similarLoading = true;
        try {
            similarArtists = await getSimilarArtistsMb(artistName);
        } catch (e) {
            console.warn("[ArtistDetail] Similar artists fetch failed:", e);
        } finally {
            similarLoading = false;
            similarFetched = true;
        }
    }

    async function loadDiscography() {
        if (discoFetched || discoLoading) return;
        discoLoading = true;
        try {
            discography = await getArtistDiscographyMb(artistName);
        } catch (e) {
            console.warn("[ArtistDetail] Discography fetch failed:", e);
        } finally {
            discoLoading = false;
            discoFetched = true;
        }
    }

    function handleAboutTab() {
        activeTab = "about";
        // Fire all three in parallel — each self-guards against double-fetching
        loadMbInfo();
        loadSimilarArtists();
        loadDiscography();
    }

    $: totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    async function loadArtistData() {
        loading = true;
        try {
            const [albumData, trackData] = await Promise.all([
                getAlbumsByArtist(artistName),
                getTracksByArtist(artistName),
            ]);
            albums = albumData;
            tracks = trackData;
        } catch (error) {
            console.error("Failed to load artist:", error);
        } finally {
            loading = false;
        }
    }

    function handlePlayAll() {
        if (tracks.length > 0) {
            playTracks(tracks, 0, {
                type: "artist",
                artistName: artistName,
                displayName: artistName,
            });
        }
    }

    function getArtistInitial(name: string): string {
        return name.charAt(0).toUpperCase();
    }

    // Download state
    let isDownloading = false;
    let downloadProgress = "";

    // Artist picture handling
    let artistPictureUrl: string | null = null;
    let failedImage = false;

    // Get artist picture URL from Tidal search
    async function getArtistPicture(name: string) {
        console.log("[ArtistDetail] getArtistPicture called for:", name);

        if (!name) {
            console.log("[ArtistDetail] No artist name provided");
            return;
        }

        try {
            console.log("[ArtistDetail] Checking for tidalSearchPlugin...");
            const plugin = (window as any).tidalSearchPlugin;
            console.log("[ArtistDetail] Plugin available:", !!plugin);

            if (!plugin) {
                console.log("[ArtistDetail] Plugin not available yet");
                return;
            }

            console.log("[ArtistDetail] Calling searchArtistPictureForRPC...");
            // Call Tidal search plugin to get artist image
            const result = await plugin.searchArtistPictureForRPC(name);
            console.log("[ArtistDetail] Result from plugin:", result);

            if (result) {
                artistPictureUrl = result;
                failedImage = false;
            }
        } catch (error) {
            console.log(
                "[ArtistDetail] Failed to fetch artist picture:",
                error,
            );
        }
    }

    function handleImageError() {
        failedImage = true;
    }

    onMount(() => {
        loadArtistData();
        getArtistPicture(artistName);
    });

    // Reload when artistName changes
    $: if (artistName) {
        loadArtistData();
        getArtistPicture(artistName);
        // Reset MB info so it gets re-fetched for the new artist
        mbInfo = null;
        mbFetched = false;
        mbError = null;
        similarArtists = [];
        similarFetched = false;
        discography = [];
        discoFetched = false;
        showAllDiscoTypes = false;
        failedCovers = new Set();
        heroAccentColor = null;
        heroIsLight = false;
        if (activeTab === "about") {
            loadMbInfo();
            loadSimilarArtists();
            loadDiscography();
        }
    }

    $: hasDownloadable = hasDownloadableTracks(tracks);

    async function handleDownloadAll() {
        if (isDownloading) return;

        if (needsDownloadLocation()) {
            addToast(
                "Please configure a download location in Settings first",
                "error",
            );
            return;
        }

        isDownloading = true;
        downloadProgress = "Starting...";

        try {
            const result = await downloadTracks(
                tracks,
                (progress: DownloadProgress) => {
                    downloadProgress = `${progress.current}/${progress.total}`;
                },
            );

            showDownloadResult(result);
        } catch (error) {
            console.error("Download failed:", error);
            addToast("Download failed unexpectedly", "error");
        } finally {
            isDownloading = false;
            downloadProgress = "";
        }
    }

    function handleContextMenu(e: MouseEvent, anchorRect?: DOMRect) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: anchorRect ? anchorRect.left : e.clientX,
            y: anchorRect ? anchorRect.bottom : e.clientY,
            items: buildArtistContextMenu({
                artist: { name: artistName },
                showPlay: true,
                onPlay: handlePlayAll,
                t: $_,
            }),
        });
    }

    function openHeaderMenu(e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        handleContextMenu(e, rect);
    }

    // Dynamic Ambient Hero Banner Palette
    let heroAccentColor: string | null = null;
    let heroIsLight = false;
    let heroPaletteRequestId = 0;

    function checkIsLight(hex: string, lum?: number): boolean {
        if (typeof lum === "number") {
            return lum > 0.45;
        }
        const clean = hex.replace("#", "");
        if (clean.length !== 6) return false;
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        const l = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        return l > 0.45;
    }

    $: artistCoverUrl =
        artistPictureUrl && !failedImage
            ? artistPictureUrl
            : albums.length > 0
              ? getAlbumCoverFromTracks(albums[0].id)
              : null;

    async function updateHeroPalette(coverUrl: string | null) {
        const thisRequestId = ++heroPaletteRequestId;
        if (!coverUrl) {
            heroAccentColor = null;
            heroIsLight = false;
            return;
        }
        try {
            const palette = await extractPalette(coverUrl);
            if (thisRequestId !== heroPaletteRequestId) return;
            if (palette && palette.length > 0) {
                heroAccentColor = palette[0].hex;
                heroIsLight = checkIsLight(palette[0].hex, palette[0].luminance) || !palette[0].isDark;
            } else {
                heroAccentColor = null;
                heroIsLight = false;
            }
        } catch (e) {
            if (thisRequestId !== heroPaletteRequestId) return;
            console.warn("[ArtistDetail] extractPalette failed:", e);
            heroAccentColor = null;
            heroIsLight = false;
        }
    }

    $: updateHeroPalette(artistCoverUrl);

    // Sticky Action Toolbar on Scroll
    let headerElement: HTMLElement | undefined = undefined;
    let isScrolledPastHero = false;

    function handleScroll(e: Event) {
        const target = e.currentTarget as HTMLElement;
        if (target && typeof target.scrollTop === "number") {
            const heroHeight = headerElement ? Math.max(120, headerElement.offsetHeight - 56) : 180;
            isScrolledPastHero = target.scrollTop >= heroHeight;
        }
    }

    $: isThisArtistPlaying =
        $isPlaying && tracks.some((t) => t.id === $currentTrack?.id);

    function handlePlayPause() {
        if (isThisArtistPlaying) {
            togglePlay();
        } else {
            handlePlayAll();
        }
    }

    $: isArtistLiked =
        tracks.length > 0 && tracks.every((t) => $likedTrackIds.has(t.id));

    async function handleToggleLike() {
        if (tracks.length === 0) return;
        const shouldLike = !isArtistLiked;
        for (const t of tracks) {
            if ($likedTrackIds.has(t.id) !== shouldLike) {
                await toggleLikeTrack(t);
            }
        }
    }
</script>

<div class="artist-detail" on:scroll={handleScroll}>
    {#if loading}
        <div class="artist-skeleton" aria-busy="true" aria-label={$_('artist.loading')}>
            <header class="artist-header skeleton-hero">
                <div class="skeleton-avatar-box">
                    <div class="shimmer-wave"></div>
                </div>
                <div class="skeleton-hero-info">
                    <div class="skeleton-badge shimmer-box"></div>
                    <div class="skeleton-title shimmer-box"></div>
                    <div class="skeleton-meta shimmer-box"></div>
                    <div class="skeleton-actions">
                        <div class="skeleton-btn shimmer-box"></div>
                    </div>
                </div>
            </header>
            <div class="skeleton-tabs">
                <div class="skeleton-tab shimmer-box"></div>
                <div class="skeleton-tab shimmer-box"></div>
                <div class="skeleton-tab shimmer-box"></div>
            </div>
            <div class="skeleton-cards-grid">
                {#each Array(8) as _}
                    <SkeletonCard variant="square" />
                {/each}
            </div>
        </div>
    {:else}
        <!-- Sticky 56px Top Bar -->
        <div
            class="sticky-action-bar"
            class:visible={isScrolledPastHero}
            aria-label="Artist navigation and actions"
        >
            <div class="sticky-left">
                <button
                    class="top-bar-btn"
                    on:click={goToArtists}
                    aria-label={$_("common.back")}
                    title={$_("common.back")}
                >
                    <Icon name="arrow-left" size={22} />
                </button>
                <div class="sticky-meta" class:revealed={isScrolledPastHero}>
                    <span class="sticky-title">{artistName}</span>
                </div>
            </div>
            <div class="sticky-right">
                <button
                    class="top-bar-btn sticky-reveal"
                    class:revealed={isScrolledPastHero}
                    class:liked={isArtistLiked}
                    on:click={handleToggleLike}
                    aria-label={isArtistLiked ? $_("liked.unlike") : $_("liked.like")}
                    title={isArtistLiked ? $_("liked.unlike") : $_("liked.like")}
                >
                    <Icon name={isArtistLiked ? "heart-filled" : "heart"} size={18} />
                </button>
                <button
                    class="sticky-play-btn sticky-reveal"
                    class:revealed={isScrolledPastHero}
                    on:click={handlePlayPause}
                    aria-label={isThisArtistPlaying ? $_("common.pause") : $_("artist.playAll")}
                    title={isThisArtistPlaying ? $_("common.pause") : $_("artist.playAll")}
                >
                    <Icon name={isThisArtistPlaying ? "pause" : "play"} size={18} />
                </button>
                <button
                    class="top-bar-btn"
                    on:click|stopPropagation={openHeaderMenu}
                    aria-label={$_("common.more")}
                    title={$_("common.more")}
                >
                    <Icon name={$isMobile ? "more-vertical" : "more-horizontal"} size={20} />
                </button>
            </div>
        </div>

        <header
            class="artist-header"
            class:light-hero={heroIsLight}
            style="--hero-accent-color: {heroAccentColor || 'var(--bg-surface)'};"
            on:contextmenu={handleContextMenu}
            role="banner"
            bind:this={headerElement}
        >
            <div
                class="artist-avatar"
                style:view-transition-name={$activeHeroKey === `artist:${artistName}` ? "active-hero-art" : "none"}
            >
                {#if artistPictureUrl && !failedImage}
                    <img
                        src={artistPictureUrl}
                        alt={artistName}
                        class="artist-picture"
                        on:error={handleImageError}
                    />
                {:else}
                    <span class="artist-initial"
                        >{getArtistInitial(artistName)}</span
                    >
                {/if}
            </div>
            <div class="artist-info">
                <span class="artist-type">{$_('artist.type')}</span>
                <h1 class="artist-name">{artistName}</h1>
                <div class="artist-meta">
                    <span>{$_('artist.albums', { values: { count: albums.length } })}</span>
                    <span class="separator">•</span>
                    <span>{$_('artist.songs', { values: { count: tracks.length } })}</span>
                    <span class="separator">•</span>
                    <span>{formatDuration(totalDuration)}</span>
                </div>
                <div class="artist-actions">
                    <button
                        class="btn-primary play-all-btn"
                        on:click={handlePlayAll}
                    >
                        <Icon name="play" size={24} />
                        {$_('artist.playAll')}
                    </button>

                    {#if hasDownloadable}
                        <button
                            class="btn-secondary download-btn"
                            on:click={handleDownloadAll}
                            disabled={isDownloading}
                        >
                            {#if isDownloading}
                                <div class="spinner-sm"></div>
                                <span>{downloadProgress}</span>
                            {:else}
                                <Icon name="download" size={24} />
                                <span>{$_('artist.downloadAll')}</span>
                            {/if}
                        </button>
                    {/if}
                </div>
            </div>
        </header>

        <div class="tabs">
            <button
                class="tab"
                class:active={activeTab === "albums"}
                on:click={() => (activeTab = "albums")}
            >
                {$_('artist.tabAlbums')}
            </button>
            <button
                class="tab"
                class:active={activeTab === "tracks"}
                on:click={() => (activeTab = "tracks")}
            >
                {$_('artist.tabTracks')}
            </button>
            <button
                class="tab"
                class:active={activeTab === "about"}
                on:click={handleAboutTab}
            >
                {$_('artist.tabAbout')}
            </button>
        </div>

        <div class="artist-content">
            {#if activeTab === "albums"}
                <AlbumGrid {albums} externalScroll={true} />
            {:else if activeTab === "tracks"}
                <TrackList
                    {tracks}
                    showAlbum={true}
                    externalScroll={true}
                    playbackContext={{
                        type: "artist",
                        artistName,
                        displayName: artistName,
                    }}
                />
            {:else}
                <!-- About tab: MusicBrainz info -->
                <div class="about-panel">
                    {#if mbLoading}
                        <div class="about-loading">
                            <div class="spinner"></div>
                            <span>{$_('artist.lookingUp')}</span>
                        </div>
                    {:else if mbError}
                        <p class="about-error">{mbError}</p>
                    {:else if mbInfo}
                        {#if mbInfo.genres.length > 0}
                            <section class="about-section">
                                <h3 class="about-heading">{$_('artist.genres')}</h3>
                                <div class="genre-pills">
                                    {#each mbInfo.genres as genre}
                                        <span class="genre-pill">{genre}</span>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        {#if mbInfo.bio}
                            <section class="about-section">
                                <h3 class="about-heading">{$_('artist.about')}</h3>
                                <p class="about-bio">{mbInfo.bio}</p>
                            </section>
                        {/if}

                        {#if mbInfo.wikipedia_url}
                            <a
                                class="wiki-link"
                                href={mbInfo.wikipedia_url}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Icon name="external-link" size={16} />
                                {$_('artist.readOnWikipedia')}
                            </a>
                        {/if}

                        {#if mbInfo.disambiguation}
                            <p class="about-disambiguation">
                                ({mbInfo.disambiguation})
                            </p>
                        {/if}

                        <p class="mb-attribution">{$_('artist.dataFromMusicBrainz')}</p>
                    {:else}
                        <div class="about-empty">
                            <p>{$_('artist.noInfoFound')}</p>
                        </div>
                    {/if}

                    <!-- ── Similar / Related Artists ── -->
                    <section class="about-section">
                        <h3 class="about-heading">{$_('artist.relatedArtists')}</h3>
                        {#if similarLoading}
                            <div class="about-loading">
                                <div class="spinner"></div>
                                <span>{$_('artist.lookingUpRelated')}</span>
                            </div>
                        {:else if similarArtists.length > 0}
                            <div class="similar-list">
                                {#each similarArtists as a}
                                    <MediaCard
                                        variant="round"
                                        primaryText={a.name}
                                        secondaryText={a.relation_type}
                                        isPinned={false}
                                        on:click={() =>
                                            goToArtistDetail(a.name)}
                                    >
                                        <svelte:fragment slot="cover">
                                            <div class="artist-initial-sm">
                                                {a.name.charAt(0).toUpperCase()}
                                            </div>
                                        </svelte:fragment>
                                        <svelte:fragment slot="extra-info">
                                            {#if a.in_library}
                                                <span
                                                    class="in-library-dot"
                                                    title="In your library"
                                                    >•</span
                                                >
                                            {/if}
                                        </svelte:fragment>
                                    </MediaCard>
                                {/each}
                            </div>
                        {:else if similarFetched}
                            <p class="about-empty-sm">
                                {$_('artist.noRelatedFound')}
                            </p>
                        {/if}
                    </section>

                    <!-- ── Discography ── -->
                    <section class="about-section">
                        <div class="disco-section-header">
                            <h3 class="about-heading">
                                {$_('artist.discography')}
                            </h3>
                            {#if discoFetched && (hiddenDiscoCount > 0 || showAllDiscoTypes)}
                                <button
                                    class="disco-toggle-btn"
                                    on:click={() =>
                                        (showAllDiscoTypes =
                                            !showAllDiscoTypes)}
                                >
                                    {showAllDiscoTypes
                                        ? $_('artist.albumsAndSingles')
                                        : $_('artist.showAll', { values: { count: discography.length } })}
                                </button>
                            {/if}
                        </div>
                        {#if discoLoading}
                            <div class="disco-grid">
                                {#each Array(6) as _}
                                    <SkeletonCard variant="square" />
                                {/each}
                            </div>
                        {:else if filteredDisco.length > 0}
                            <div class="disco-grid">
                                {#each filteredDisco as item (item.mbid)}
                                    <MediaCard
                                        primaryText={item.title}
                                        secondaryText={item.year
                                            ? `${item.release_type} • ${item.year}`
                                            : item.release_type}
                                        ariaLabel={item.title}
                                    >
                                        <svelte:fragment slot="cover">
                                            {#if !failedCovers.has(item.mbid)}
                                                <img
                                                    class="disco-cover"
                                                    src={item.cover_url}
                                                    alt={item.title}
                                                    loading="lazy"
                                                    on:error={() =>
                                                        handleCoverError(
                                                            item.mbid,
                                                        )}
                                                />
                                            {:else}
                                                <div
                                                    class="disco-cover-placeholder {discoTypeClass(
                                                        item.release_type,
                                                    )}"
                                                >
                                                    {#if item.release_type.toLowerCase() === "album"}
                                                        <Icon name="disc" size={28} />
                                                    {:else if item.release_type.toLowerCase() === "single"}
                                                        <Icon name="music" size={28} />
                                                    {:else if item.release_type.toLowerCase() === "ep"}
                                                        <Icon name="disc" size={28} />
                                                    {:else if item.release_type.toLowerCase() === "live"}
                                                        <Icon name="mic-2" size={28} />
                                                    {:else if item.release_type.toLowerCase() === "compilation"}
                                                        <Icon name="library" size={28} />
                                                    {:else if item.release_type.toLowerCase() === "soundtrack"}
                                                        <Icon name="disc-3" size={28} />
                                                    {:else}
                                                        <Icon name="disc" size={28} />
                                                    {/if}
                                                </div>
                                            {/if}
                                        </svelte:fragment>
                                    </MediaCard>
                                {/each}
                            </div>
                        {:else if discoFetched}
                            <p class="about-empty-sm">{$_('artist.noDiscography')}</p>
                        {/if}
                    </section>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .artist-detail {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        position: relative;
    }

    .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--spacing-md);
        color: var(--text-secondary);
    }

    .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--bg-highlight);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .artist-header {
        position: relative;
        display: flex;
        gap: var(--spacing-lg);
        padding: calc(56px + var(--spacing-md)) var(--spacing-lg) var(--spacing-lg);
        background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--hero-accent-color, var(--bg-surface)) 74%, var(--bg-surface) 26%) 0%,
            color-mix(in srgb, var(--hero-accent-color, var(--bg-surface)) 36%, var(--bg-base) 64%) 58%,
            var(--bg-base) 100%
        );
        overflow: hidden;
        transition: background 0.4s ease;
        flex-shrink: 0;
    }

    .artist-header > * {
        position: relative;
        z-index: 2;
    }

    .artist-header::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
            circle at 22% 35%,
            color-mix(in srgb, var(--hero-accent-color, transparent) 60%, transparent) 0%,
            transparent 72%
        );
        opacity: 0.95;
        transition: opacity 0.4s ease;
    }

    .artist-header::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
            180deg,
            rgba(0, 0, 0, 0.28) 0%,
            rgba(0, 0, 0, 0.52) 100%
        );
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 1;
    }

    .artist-header.light-hero::after {
        opacity: 1;
    }

    /* ── Sticky Action Toolbar on Scroll (56px) ── */
    .sticky-action-bar {
        position: sticky;
        top: 0;
        z-index: var(--z-sticky, 100);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--spacing-sm);
        height: 56px;
        margin-bottom: -56px;
        background: transparent;
        border-bottom: 1px solid transparent;
        transition: background-color 0.22s ease,
                    border-color 0.22s ease;
        flex-shrink: 0;
    }

    .sticky-action-bar.visible {
        background: color-mix(in srgb, var(--bg-base) 90%, transparent);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom-color: var(--border-subtle, var(--border-color));
    }

    .sticky-left,
    .sticky-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .sticky-left {
        min-width: 0;
        flex: 1;
    }

    .top-bar-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        border-radius: var(--radius-full);
        background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: background-color var(--transition-fast), color var(--transition-fast);
    }

    .sticky-action-bar.visible .top-bar-btn {
        background: transparent;
    }

    .top-bar-btn:hover {
        background: var(--surface-subtle-hover, rgba(255, 255, 255, 0.12));
    }

    .top-bar-btn.liked {
        color: var(--accent-primary);
    }

    .sticky-reveal {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform var(--transition-fast);
    }

    .sticky-reveal.revealed {
        opacity: 1;
        pointer-events: auto;
    }

    .sticky-play-btn {
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        border-radius: var(--radius-full);
        background: var(--accent-primary);
        color: var(--text-on-accent, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform var(--transition-fast), opacity 0.2s ease;
    }

    .sticky-play-btn:hover {
        transform: scale(1.06);
        filter: brightness(1.1);
    }

    .sticky-meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        opacity: 0;
        transition: opacity 0.2s ease;
        padding: 0 var(--spacing-xs);
    }

    .sticky-meta.revealed {
        opacity: 1;
    }

    .sticky-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ── Skeleton Shimmer Loader ── */
    .artist-skeleton {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;
    }

    .skeleton-hero {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, var(--bg-base) 100%);
        pointer-events: none;
    }

    .skeleton-avatar-box {
        width: 200px;
        height: 200px;
        border-radius: var(--radius-full);
        background: rgba(255, 255, 255, 0.05);
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
    }

    .skeleton-hero-info {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: var(--spacing-md);
        flex: 1;
        min-width: 0;
    }

    .skeleton-badge {
        width: 60px;
        height: 14px;
        border-radius: var(--radius-sm);
    }

    .skeleton-title {
        width: 50%;
        max-width: 350px;
        height: 40px;
        border-radius: var(--radius-sm);
    }

    .skeleton-meta {
        width: 35%;
        max-width: 240px;
        height: 18px;
        border-radius: var(--radius-sm);
    }

    .skeleton-actions {
        display: flex;
        gap: var(--spacing-md);
        margin-top: var(--spacing-sm);
    }

    .skeleton-btn {
        width: 110px;
        height: 40px;
        border-radius: var(--radius-full);
    }

    .skeleton-tabs {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
    }

    .skeleton-tab {
        width: 80px;
        height: 24px;
        border-radius: var(--radius-sm);
    }

    .skeleton-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--spacing-lg);
        padding: var(--spacing-lg);
        overflow-y: auto;
        flex: 1;
    }

    .shimmer-box {
        position: relative;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
    }

    .shimmer-box::after,
    .skeleton-avatar-box .shimmer-wave {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.04) 30%,
            rgba(255, 255, 255, 0.12) 50%,
            rgba(255, 255, 255, 0.04) 70%,
            transparent 100%
        );
        animation: skeleton-shimmer 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    @keyframes skeleton-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    .artist-header {
        position: relative;
    }

    .back-btn {
        position: absolute;
        top: var(--spacing-md);
        left: var(--spacing-md);
        width: 32px;
        height: 32px;
        border-radius: var(--radius-full);
        background-color: rgba(0, 0, 0, 0.5);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all var(--transition-fast);
    }

    .back-btn:hover {
        background-color: rgba(0, 0, 0, 0.7);
        transform: scale(1.1);
    }

    .artist-avatar {
        width: 200px;
        height: 200px;
        border-radius: var(--radius-full);
        background: linear-gradient(
            135deg,
            var(--accent-primary) 0%,
            #1a1a1a 100%
        );
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-lg);
    }

    .artist-initial {
        font-size: 4rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
    }

    .artist-picture {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--radius-full);
    }

    .artist-info {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: flex-start;
        min-width: 0;
        flex: 1;
    }

    .artist-type {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        color: var(--text-primary);
    }

    .artist-name {
        font-size: 3rem;
        font-weight: var(--font-weight-bold);
        line-height: 1.1;
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
    }

    .artist-meta {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        margin-bottom: var(--spacing-lg);
    }

    .separator {
        color: var(--text-subdued);
    }

    .artist-actions {
        display: flex;
        gap: var(--spacing-md);
    }

    .play-all-btn {
        font-size: var(--font-size-md);
        padding: var(--spacing-sm) var(--spacing-xl);
    }

    .tabs {
        display: flex;
        gap: var(--spacing-md);
        padding: 0 var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-base);
        position: sticky;
        top: 56px;
        z-index: calc(var(--z-sticky, 100) - 1);
        flex-shrink: 0;
    }

    .tab {
        padding: var(--spacing-md);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition: all var(--transition-fast);
    }

    .tab:hover {
        color: var(--text-primary);
    }

    .tab.active {
        color: var(--text-primary);
        border-bottom-color: var(--accent-primary);
    }

    .artist-content {
        flex: 1 0 auto;
    }

    .btn-secondary {
        background-color: transparent;
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        transition: all var(--transition-fast);
        padding: var(--spacing-sm) var(--spacing-xl);
        border-radius: var(--radius-full);
        font-size: var(--font-size-md);
    }

    .btn-secondary:hover:not(:disabled) {
        border-color: var(--text-primary);
        transform: scale(1.05);
    }

    .btn-secondary:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }

    .spinner-sm {
        width: 16px;
        height: 16px;
        border: 2px solid var(--bg-highlight);
        border-top-color: var(--text-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    /* ── About / MusicBrainz panel ── */
    .about-panel {
        padding: var(--spacing-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
    }

    .about-loading {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        color: var(--text-secondary);
        padding: var(--spacing-xl) 0;
    }

    .about-error {
        color: var(--color-error, #f87171);
        font-size: var(--font-size-base);
    }

    .about-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .about-heading {
        font-size: 0.7rem;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--text-subdued);
        margin: 0;
    }

    .genre-pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
    }

    .genre-pill {
        background: rgba(var(--accent-primary-rgb, 30 215 96) / 0.12);
        border: 1px solid rgba(var(--accent-primary-rgb, 30 215 96) / 0.3);
        color: var(--accent-primary);
        padding: var(--spacing-xs) var(--spacing-md);
        border-radius: var(--radius-full);
        font-size: 0.8rem;
        font-weight: var(--font-weight-semibold);
    }

    .about-bio {
        font-size: 0.9rem;
        line-height: 1.7;
        color: var(--text-secondary);
        margin: 0;
    }

    .wiki-link {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: 0.8rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-full);
        padding: var(--spacing-xs) var(--spacing-md);
        width: fit-content;
        text-decoration: none;
        transition: all var(--transition-fast);
    }

    .wiki-link:hover {
        color: var(--text-primary);
        border-color: var(--text-primary);
    }

    .about-disambiguation {
        font-size: 0.8rem;
        color: var(--text-subdued);
        font-style: italic;
        margin: 0;
    }

    .mb-attribution {
        font-size: 0.65rem;
        color: var(--text-subdued);
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.5;
        margin: 0;
    }

    .about-empty {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        padding: var(--spacing-xl) 0;
    }

    .about-empty-sm {
        font-size: 0.8rem;
        color: var(--text-subdued);
        margin: 0;
    }

    /* ── Similar artists ── */
    .similar-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--spacing-sm);
    }

    .artist-initial-sm {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        background: var(--bg-highlight);
    }

    .in-library-dot {
        color: var(--accent-primary);
        font-size: 1.2rem;
        line-height: 1;
        flex-shrink: 0;
    }

    /* ── Discography ── */
    .disco-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
    }

    .disco-section-header .about-heading {
        margin-bottom: 0;
    }

    .disco-toggle-btn {
        background: var(--bg-highlight);
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-full);
        padding: var(--spacing-xs) var(--spacing-md);
        font-size: 0.72rem;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
    }

    .disco-toggle-btn:hover {
        background: var(--accent-subtle);
        color: var(--accent-primary);
        border-color: var(--accent-primary);
    }

    .disco-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: var(--spacing-sm);
    }

    .disco-cover-wrap {
        width: 100%;
        aspect-ratio: 1;
        overflow: hidden;
        background: var(--bg-surface);
    }

    .disco-cover {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .disco-cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background: var(--bg-surface);
    }

    .disco-cover-placeholder.rt-album {
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.08);
    }
    .disco-cover-placeholder.rt-single {
        color: #22c55e;
        background: rgba(34, 197, 94, 0.08);
    }
    .disco-cover-placeholder.rt-ep {
        color: #a855f7;
        background: rgba(168, 85, 247, 0.08);
    }
    .disco-cover-placeholder.rt-live {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.08);
    }
    .disco-cover-placeholder.rt-compilation {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.08);
    }
    .disco-cover-placeholder.rt-soundtrack {
        color: #ec4899;
        background: rgba(236, 72, 153, 0.08);
    }
    .disco-cover-placeholder.rt-remix {
        color: #06b6d4;
        background: rgba(6, 182, 212, 0.08);
    }
    .disco-cover-placeholder.rt-other {
        color: #6b7280;
        background: rgba(107, 114, 128, 0.08);
    }

    /* ── Mobile ── */
    :global(html.layout-mobile) .artist-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: calc(56px + var(--spacing-sm)) var(--spacing-md) var(--spacing-md);
        gap: var(--spacing-md);
    }

    :global(html.layout-mobile) .skeleton-cards-grid,
    :global(html.layout-mobile) .similar-list,
    :global(html.layout-mobile) .disco-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }

    :global(html.layout-mobile) .skeleton-cards-grid {
        padding: var(--spacing-md);
    }

    :global(html.layout-mobile) .artist-avatar {
        width: 120px;
        height: 120px;
    }

    :global(html.layout-mobile) .artist-initial {
        font-size: 2.5rem;
    }

    :global(html.layout-mobile) .artist-info {
        align-items: center;
    }

    :global(html.layout-mobile) .artist-name {
        font-size: 1.5rem;
        word-break: break-word;
    }

    :global(html.layout-mobile) .artist-meta {
        flex-wrap: wrap;
        margin-bottom: var(--spacing-md);
    }

    :global(html.layout-mobile) .artist-actions {
        flex-wrap: wrap;
        justify-content: center;
    }

    :global(html.layout-mobile) .play-all-btn,
    :global(html.layout-mobile) .btn-secondary {
        padding: var(--spacing-sm) var(--spacing-lg);
        font-size: var(--font-size-base);
        min-height: 44px;
    }

    :global(html.layout-mobile) .tabs {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
    }

    :global(html.layout-mobile) .tab {
        min-height: 44px;
        white-space: nowrap;
    }
</style>
