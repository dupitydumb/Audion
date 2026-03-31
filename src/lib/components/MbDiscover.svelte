<script lang="ts">
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import {
        searchArtistsMb,
        searchReleasesMb,
        getArtistMusicBrainzInfo,
        getArtistDiscographyMb,
        getReleaseGroupTracksMb,
        getArtistTopTracksMb,
        getListenbrainzToken,
        type MbDiscoverArtist,
        type MbDiscoverRelease,
        type MbArtistInfo,
        type MbDiscographyItem,
        type MbTrack,
        type Track,
    } from "$lib/api/tauri";
    import { playTracks } from "$lib/stores/player";
    import { pluginStore } from "$lib/stores/plugin-store";
    import { addToast } from "$lib/stores/toast";
    import {
        goToArtistDetail,
        goToAlbumDetail,
        currentView,
    } from "$lib/stores/view";
    import {
        artists as libraryArtists,
        albums as libraryAlbums,
    } from "$lib/stores/library";
    import MediaCard from "./MediaCard.svelte";

    type Tab = "artists" | "releases";
    type SearchState = "idle" | "loading" | "done" | "error";

    let activeTab: Tab = "artists";
    let searchInput = "";
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let lastQuery = "";

    // Results
    let artistResults: MbDiscoverArtist[] = [];
    let releaseResults: MbDiscoverRelease[] = [];
    let searchState: SearchState = "idle";
    let errorMsg = "";

    // Inline detail panel (Artist)
    let detailArtist: MbDiscoverArtist | null = null;
    let detailInfo: MbArtistInfo | null = null;
    let detailDiscography: MbDiscographyItem[] = [];
    let detailLoading = false;

    // Inline detail panel (Release)
    let detailRelease: MbDiscoverRelease | null = null;
    let detailReleaseTracks: MbTrack[] = [];
    let detailReleaseLoading = false;

    // Navigation stack
    type ViewState =
        | { type: "artist"; artist: MbDiscoverArtist }
        | { type: "release"; release: MbDiscoverRelease };

    let navigationStack: ViewState[] = [];
    let detailArtistTracks: MbTrack[] = [];
    let detailArtistTracksLoading = false;

    // Local library lookup sets (lowercased)
    $: localArtistSet = new Set(
        $libraryArtists.map((a) => a.name.toLowerCase()),
    );
    $: localAlbumMap = new Map(
        $libraryAlbums.map((a) => [a.name.toLowerCase(), a.id]),
    );

    function debounceSearch() {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => executeSearch(), 500);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            if (searchTimer) clearTimeout(searchTimer);
            executeSearch();
        }
    }

    async function executeSearch() {
        const q = searchInput.trim();
        if (!q || q.length < 2) return;
        if (q === lastQuery) return;
        lastQuery = q;
        detailArtist = null;

        searchState = "loading";
        errorMsg = "";

        try {
            if (activeTab === "artists") {
                artistResults = await searchArtistsMb(q, 20);
            } else {
                releaseResults = await searchReleasesMb(q, 20);
            }
            searchState = "done";
        } catch (e) {
            errorMsg = String(e);
            searchState = "error";
        }
    }

    function switchTab(tab: Tab) {
        if (tab === activeTab) return;
        activeTab = tab;
        // If we have a query, re-search in the new tab
        lastQuery = "";
        if (searchInput.trim().length >= 2) {
            executeSearch();
        }
    }

    function isArtistInLibrary(name: string): boolean {
        return localArtistSet.has(name.toLowerCase());
    }

    function findLocalAlbumId(title: string): number | undefined {
        return localAlbumMap.get(title.toLowerCase());
    }

    function handleArtistClick(artist: MbDiscoverArtist) {
        if (isArtistInLibrary(artist.name)) {
            goToArtistDetail(artist.name);
        } else {
            pushNavigation({ type: "artist", artist });
        }
    }

    async function handleReleaseClick(release: MbDiscoverRelease) {
        const localId = findLocalAlbumId(release.title);
        if (localId !== undefined) {
            goToAlbumDetail(localId);
        } else {
            pushNavigation({ type: "release", release });
        }
    }

    function pushNavigation(view: ViewState) {
        navigationStack = [...navigationStack, view];
        loadView(view);
    }

    function popNavigation() {
        if (navigationStack.length > 1) {
            navigationStack = navigationStack.slice(0, -1);
            loadView(navigationStack[navigationStack.length - 1]);
        } else {
            closeDetail();
        }
    }

    function closeDetail() {
        detailArtist = null;
        detailRelease = null;
        navigationStack = [];
    }

    async function loadView(view: ViewState) {
        if (view.type === "artist") {
            await openArtistDetail(view.artist, false);
        } else {
            await openReleaseDetail(view.release, false);
        }
    }

    async function openReleaseDetail(release: MbDiscoverRelease, push = true) {
        detailArtist = null; // Close other panel
        detailRelease = release;
        detailReleaseTracks = [];
        detailReleaseLoading = true;

        if (push) navigationStack = [{ type: "release", release }];

        try {
            detailReleaseTracks = await getReleaseGroupTracksMb(release.mbid);
        } catch (e) {
            console.error("[MbDiscover] release tracks fetch error:", e);
        } finally {
            detailReleaseLoading = false;
        }
    }

    async function openArtistDetail(artist: MbDiscoverArtist, push = true) {
        detailRelease = null; // Close other panel
        detailArtist = artist;
        detailInfo = null;
        detailDiscography = [];
        detailArtistTracks = [];
        detailLoading = true;
        detailArtistTracksLoading = true;
        showAllReleaseTypes = false;

        if (push) navigationStack = [{ type: "artist", artist }];

        try {
            // Fetch info and discography in parallel
            const [info, disco] = await Promise.all([
                getArtistMusicBrainzInfo(artist.name),
                getArtistDiscographyMb(artist.name),
            ]);
            detailInfo = info;
            detailDiscography = disco;
        } catch (e) {
            console.error("[MbDiscover] artist detail error:", e);
        } finally {
            detailLoading = false;
        }

        try {
            detailArtistTracks = await getArtistTopTracksMb(artist.mbid);
        } catch (e) {
            console.error("[MbDiscover] artist tracks fetch error:", e);
        } finally {
            detailArtistTracksLoading = false;
        }
    }

    $: isTidalEnabled = $pluginStore.installed.some(
        (p) => p.name === "Tidal Search" && p.enabled,
    );

    let playingStreamId: string | null = null;

    async function playOnPlayback(track: MbTrack) {
        playingStreamId = track.mbid;
        try {
            const token = await getListenbrainzToken();
            const headers: Record<string, string> = {
                Accept: "application/json",
            };
            if (token) {
                headers["Authorization"] = `Token ${token}`;
            }

            const query = new URLSearchParams({
                recording_mbids: track.mbid,
                artist_name: track.artist,
                recording_name: track.title,
                inc: "metadata",
            });
            const resp = await fetch(
                `https://api.listenbrainz.org/1/metadata/lookup/?${query.toString()}`,
                { headers },
            );
            const data = await resp.json();
            const meta = data[track.mbid];

            let streamUrl = null;
            let sourceType = "external";

            if (meta) {
                const recRels = !Array.isArray(meta.recording?.rels)
                    ? meta.recording?.rels || {}
                    : {};
                const artistRels = !Array.isArray(
                    meta.artist?.artists?.[0]?.rels,
                )
                    ? meta.artist?.artists?.[0]?.rels || {}
                    : {};

                streamUrl =
                    recRels["free streaming"] ||
                    recRels["streaming"] ||
                    artistRels["free streaming"] ||
                    artistRels["streaming"];
            }

            if (!streamUrl) {
                addToast(
                    "No stream URL available in ListenBrainz metadata",
                    "error",
                );
                return;
            }

            if (streamUrl.includes("tidal.com")) sourceType = "tidal";
            else if (streamUrl.includes("spotify.com")) sourceType = "spotify";
            else if (
                streamUrl.includes("youtube.com") ||
                streamUrl.includes("youtu.be")
            )
                sourceType = "youtube";

            const audionTrack: Track = {
                id: -1,
                path: `plugin://${sourceType}`,
                title: track.title,
                artist: track.artist,
                album: detailRelease?.title || "Unknown Album",
                track_number: track.track_number,
                duration: Math.round((track.duration_ms || 0) / 1000),
                album_id: null,
                format: "STREAM",
                bitrate: 0,
                source_type: sourceType,
                external_id: streamUrl,
                cover_url: getReleaseCoverUrl(detailRelease?.mbid || ""),
                disc_number: track.disc_number,
            };
            playTracks([audionTrack], 0);
        } catch (e) {
            console.error("[MbDiscover] Metadata lookup error:", e);
            addToast("Failed to lookup ListenBrainz metadata", "error");
        } finally {
            playingStreamId = null;
        }
    }

    function artistInitial(name: string): string {
        return name.charAt(0).toUpperCase();
    }

    // Discography filtering — show Albums & Singles by default
    let showAllReleaseTypes = false;
    const PRIMARY_TYPES = ["album", "single"];

    function releaseTypeClass(rt: string): string {
        const lower = rt.toLowerCase();
        if (lower === "album") return "rt-album";
        if (lower === "single") return "rt-single";
        if (lower === "ep") return "rt-ep";
        if (lower === "live") return "rt-live";
        if (lower === "compilation") return "rt-compilation";
        if (lower === "soundtrack") return "rt-soundtrack";
        if (lower === "remix") return "rt-remix";
        return "rt-other";
    }

    $: filteredDiscography = showAllReleaseTypes
        ? detailDiscography
        : detailDiscography.filter((d) =>
              PRIMARY_TYPES.includes(d.release_type.toLowerCase()),
          );

    $: hiddenCount = detailDiscography.length - filteredDiscography.length;

    function getReleaseCoverUrl(mbid: string): string {
        return `https://coverartarchive.org/release-group/${mbid}/front-250`;
    }

    function handleImageError(e: Event) {
        const target = e.target as HTMLImageElement;
        if (target && target.style) {
            target.style.display = "none";
        }
    }
    onMount(() => {
        if ($currentView.type === "discover" && $currentView.query) {
            searchInput = $currentView.query;
            activeTab = "releases";
            executeSearch();
        }
    });
</script>

<div class="discover-root">
    <!-- Header -->
    <header class="discover-header">
        <div class="header-row">
            <div class="header-title-group">
                <svg
                    class="header-icon"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="28"
                    height="28"
                >
                    <path
                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
                    />
                </svg>
                <div>
                    <h1>Discover</h1>
                    <p class="header-subtitle">
                        Search MusicBrainz to find artists &amp; albums beyond
                        your library
                    </p>
                </div>
            </div>
        </div>

        <!-- Search bar -->
        <div class="search-bar">
            <svg
                class="search-icon"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
                type="text"
                class="search-input"
                placeholder="Search for artists, albums, songs…"
                bind:value={searchInput}
                on:input={debounceSearch}
                on:keydown={handleKeydown}
            />
            {#if searchInput}
                <button
                    class="clear-btn"
                    aria-label="Clear search"
                    on:click={() => {
                        searchInput = "";
                        lastQuery = "";
                        artistResults = [];
                        releaseResults = [];
                        searchState = "idle";
                        detailArtist = null;
                    }}
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        fill="currentColor"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            {/if}
        </div>

        <!-- Tabs -->
        <div class="tab-bar">
            <button
                class="tab"
                class:active={activeTab === "artists"}
                on:click={() => switchTab("artists")}
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                >
                    <path
                        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                    />
                </svg>
                Artists
            </button>
            <button
                class="tab"
                class:active={activeTab === "releases"}
                on:click={() => switchTab("releases")}
            >
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
                Albums &amp; Releases
            </button>
        </div>
    </header>

    <!-- Content area -->
    <div class="discover-content">
        {#if searchState === "idle"}
            <div class="empty-state" in:fade={{ duration: 200 }}>
                <svg
                    viewBox="0 0 24 24"
                    width="64"
                    height="64"
                    fill="currentColor"
                    opacity="0.15"
                >
                    <path
                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
                    />
                </svg>
                <p>Search the MusicBrainz database</p>
                <span class="hint"
                    >Type an artist name, album title, or keyword to get started</span
                >
            </div>
        {:else if searchState === "loading"}
            <div class="loading-state" in:fade={{ duration: 150 }}>
                <div class="spinner"></div>
                <p>Searching MusicBrainz…</p>
            </div>
        {:else if searchState === "error"}
            <div class="error-state" in:fade={{ duration: 200 }}>
                <svg
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="currentColor"
                    opacity="0.4"
                >
                    <path
                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                    />
                </svg>
                <p>Search failed</p>
                <span class="hint">{errorMsg}</span>
            </div>
        {:else if searchState === "done"}
            <!-- Artist results -->
            {#if activeTab === "artists"}
                {#if artistResults.length === 0}
                    <div class="no-results" in:fade={{ duration: 200 }}>
                        <p>
                            No artists found for "<strong>{lastQuery}</strong>"
                        </p>
                        <span class="hint"
                            >Try a different spelling or keyword</span
                        >
                    </div>
                {:else}
                    <div class="artist-grid" in:fade={{ duration: 200 }}>
                        {#each artistResults as artist (artist.mbid)}
                            <div
                                class="card-wrapper"
                                role="presentation"
                                on:click={() => handleArtistClick(artist)}
                                on:keydown={(e) =>
                                    e.key === "Enter" &&
                                    handleArtistClick(artist)}
                            >
                                <MediaCard
                                    variant="round"
                                    primaryText={artist.name}
                                    secondaryText={artist.disambiguation ||
                                        artist.artist_type ||
                                        ""}
                                    isNowPlaying={isArtistInLibrary(
                                        artist.name,
                                    )}
                                >
                                    <div slot="cover" class="artist-avatar">
                                        <span>{artistInitial(artist.name)}</span
                                        >
                                    </div>
                                    <div slot="extra-info" class="card-meta">
                                        {#if artist.country}
                                            <span class="meta-chip"
                                                >{artist.country}</span
                                            >
                                        {/if}
                                        {#if artist.active_years}
                                            <span class="meta-chip"
                                                >{artist.active_years}</span
                                            >
                                        {/if}
                                        {#if artist.genres.length > 0}
                                            <div class="genre-pills">
                                                {#each artist.genres.slice(0, 2) as genre}
                                                    <span class="genre-pill"
                                                        >{genre}</span
                                                    >
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                </MediaCard>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- Release results -->
            {:else if activeTab === "releases"}
                {#if releaseResults.length === 0}
                    <div class="no-results" in:fade={{ duration: 200 }}>
                        <p>
                            No releases found for "<strong>{lastQuery}</strong>"
                        </p>
                        <span class="hint"
                            >Try a different spelling or keyword</span
                        >
                    </div>
                {:else}
                    <div class="release-grid" in:fade={{ duration: 200 }}>
                        {#each releaseResults as release (release.mbid)}
                            <div
                                class="card-wrapper"
                                role="presentation"
                                on:click={() => handleReleaseClick(release)}
                                on:keydown={(e) =>
                                    e.key === "Enter" &&
                                    handleReleaseClick(release)}
                            >
                                <MediaCard
                                    primaryText={release.title}
                                    secondaryText={release.artist_name}
                                    isNowPlaying={findLocalAlbumId(
                                        release.title,
                                    ) !== undefined}
                                    secondaryAction={() =>
                                        goToArtistDetail(release.artist_name)}
                                >
                                    <div slot="cover" class="release-icon">
                                        <img
                                            src={getReleaseCoverUrl(
                                                release.mbid,
                                            )}
                                            alt={release.title}
                                            loading="lazy"
                                            on:error={(e) => {
                                                const target =
                                                    e.currentTarget as HTMLImageElement;
                                                target.style.display = "none";
                                                target.nextElementSibling?.classList.remove(
                                                    "hidden",
                                                );
                                            }}
                                        />
                                        <svg
                                            class="hidden"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            width="32"
                                            height="32"
                                        >
                                            <path
                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                            />
                                        </svg>
                                    </div>
                                    <div slot="extra-info" class="card-meta">
                                        {#if release.release_type}
                                            <span class="meta-chip type-chip"
                                                >{release.release_type}</span
                                            >
                                        {/if}
                                        {#if release.year}
                                            <span class="meta-chip"
                                                >{release.year}</span
                                            >
                                        {/if}
                                        {#if release.genres.length > 0}
                                            <div class="genre-pills">
                                                {#each release.genres.slice(0, 2) as genre}
                                                    <span class="genre-pill"
                                                        >{genre}</span
                                                    >
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                </MediaCard>
                            </div>
                        {/each}
                    </div>
                {/if}
            {/if}
        {/if}
    </div>

    <!-- Inline artist detail panel -->
    {#if detailArtist}
        <div class="detail-overlay" transition:fade={{ duration: 200 }}>
            <div class="detail-panel" in:fly={{ x: 300, duration: 300 }}>
                <header class="detail-header">
                    <button
                        class="back-btn"
                        aria-label="Close detail panel"
                        on:click={closeDetail}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
                            />
                        </svg>
                    </button>
                    <div class="detail-title-block">
                        <h2>{detailArtist.name}</h2>
                        {#if detailArtist.disambiguation}
                            <span class="detail-disambig"
                                >{detailArtist.disambiguation}</span
                            >
                        {/if}
                    </div>
                </header>

                {#if detailLoading}
                    <div class="detail-loading">
                        <div class="spinner"></div>
                        <p>Loading artist info…</p>
                    </div>
                {:else if detailInfo}
                    <div class="detail-body">
                        <!-- Bio -->
                        {#if detailInfo.bio}
                            <section class="detail-section">
                                <h3>Biography</h3>
                                <p class="bio-text">{detailInfo.bio}</p>
                                {#if detailInfo.wikipedia_url}
                                    <a
                                        class="wiki-link"
                                        href={detailInfo.wikipedia_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Read more on Wikipedia →
                                    </a>
                                {/if}
                            </section>
                        {/if}

                        <!-- Genres -->
                        {#if detailInfo.genres.length > 0}
                            <section class="detail-section">
                                <h3>Genres</h3>
                                <div class="genre-pills detail-genres">
                                    {#each detailInfo.genres as genre}
                                        <span class="genre-pill">{genre}</span>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <!-- Meta chips -->
                        <section class="detail-section">
                            <h3>Details</h3>
                            <div class="card-meta detail-meta">
                                {#if detailArtist.artist_type}
                                    <span class="meta-chip type-chip"
                                        >{detailArtist.artist_type}</span
                                    >
                                {/if}
                                {#if detailArtist.country}
                                    <span class="meta-chip"
                                        >🌍 {detailArtist.country}</span
                                    >
                                {/if}
                                {#if detailArtist.active_years}
                                    <span class="meta-chip"
                                        >📅 {detailArtist.active_years}</span
                                    >
                                {/if}
                            </div>
                        </section>

                        <!-- Tracks -->
                        <section class="detail-section">
                            <h3>Featured Tracks</h3>
                            {#if detailArtistTracksLoading}
                                <div class="tracks-loading">
                                    <div class="spinner-small"></div>
                                    <p>Fetching tracks…</p>
                                </div>
                            {:else if detailArtistTracks.length > 0}
                                <div class="tracks-list">
                                    {#each detailArtistTracks as track}
                                        <div class="track-row">
                                            <div class="track-info">
                                                <span class="track-number"
                                                    >{track.track_number}</span
                                                >
                                                <div class="track-names">
                                                    <span class="track-title"
                                                        >{track.title}</span
                                                    >
                                                    <span class="track-artist"
                                                        >{track.artist}</span
                                                    >
                                                </div>
                                            </div>
                                            <div class="track-actions">
                                                <button
                                                    class="tidal-btn"
                                                    class:loading={playingStreamId ===
                                                        track.mbid}
                                                    on:click={(e) => {
                                                        e.stopPropagation();
                                                        playOnPlayback(track);
                                                    }}
                                                    title="Play Stream"
                                                >
                                                    {#if playingStreamId === track.mbid}
                                                        <div
                                                            class="spinner-tiny"
                                                        ></div>
                                                    {:else}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            width="16"
                                                            height="16"
                                                            fill="currentColor"
                                                        >
                                                            <path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"
                                                            />
                                                        </svg>
                                                    {/if}
                                                    Play
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {:else}
                                <p class="no-tracks">No tracks found.</p>
                            {/if}
                        </section>

                        <!-- Discography -->
                        {#if detailDiscography.length > 0}
                            <section class="detail-section">
                                <div class="disco-header">
                                    <h3>Discography</h3>
                                    {#if hiddenCount > 0 || showAllReleaseTypes}
                                        <button
                                            class="disco-filter-btn"
                                            on:click={() =>
                                                (showAllReleaseTypes =
                                                    !showAllReleaseTypes)}
                                        >
                                            {showAllReleaseTypes
                                                ? "Albums & Singles only"
                                                : `Show all (${detailDiscography.length})`}
                                        </button>
                                    {/if}
                                </div>
                                <div class="disco-list">
                                    {#each filteredDiscography as item}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div
                                            class="disco-item"
                                            on:click={() =>
                                                pushNavigation({
                                                    type: "release",
                                                    release: {
                                                        mbid: item.mbid,
                                                        title: item.title,
                                                        artist_name:
                                                            detailArtist?.name ||
                                                            "Unknown Artist",
                                                        artist_mbid:
                                                            detailArtist?.mbid ??
                                                            null,
                                                        release_type:
                                                            item.release_type,
                                                        year: item.year || null,
                                                        country: null,
                                                        genres: [],
                                                    },
                                                })}
                                        >
                                            <div
                                                class="disco-type-icon {releaseTypeClass(
                                                    item.release_type,
                                                )}"
                                            >
                                                <img
                                                    src={getReleaseCoverUrl(
                                                        item.mbid,
                                                    )}
                                                    alt=""
                                                    loading="lazy"
                                                    on:error={(e) => {
                                                        const target =
                                                            e.currentTarget as HTMLImageElement;
                                                        target.style.display =
                                                            "none";
                                                        target.nextElementSibling?.classList.remove(
                                                            "hidden",
                                                        );
                                                    }}
                                                />
                                                <div
                                                    class="hidden icon-fallback"
                                                >
                                                    {#if item.release_type.toLowerCase() === "album"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "single"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "ep"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "live"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "compilation"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "soundtrack"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"
                                                            /></svg
                                                        >
                                                    {:else}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="18"
                                                            height="18"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                                            /></svg
                                                        >
                                                    {/if}
                                                </div>
                                            </div>
                                            <div class="disco-info">
                                                <span class="disco-title"
                                                    >{item.title}</span
                                                >
                                                <span class="disco-year"
                                                    >{item.year ?? "—"}</span
                                                >
                                            </div>
                                            <span
                                                class="disco-badge {releaseTypeClass(
                                                    item.release_type,
                                                )}">{item.release_type}</span
                                            >
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Inline release detail panel -->
    {#if detailRelease}
        <div class="detail-overlay" transition:fade={{ duration: 200 }}>
            <div class="detail-panel" in:fly={{ x: 300, duration: 300 }}>
                <header class="detail-header">
                    <button
                        class="back-btn"
                        aria-label="Close detail panel"
                        on:click={closeDetail}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
                            />
                        </svg>
                    </button>
                    <div class="detail-title-block">
                        <h2>{detailRelease.title}</h2>
                        <button
                            class="artist-link-btn"
                            on:click={() => {
                                if (
                                    detailRelease &&
                                    detailRelease.artist_mbid
                                ) {
                                    pushNavigation({
                                        type: "artist",
                                        artist: {
                                            mbid: detailRelease.artist_mbid,
                                            name: detailRelease.artist_name,
                                            genres: [],
                                            disambiguation: null,
                                            artist_type: null,
                                            country: null,
                                            active_years: null,
                                        },
                                    });
                                }
                            }}
                        >
                            {detailRelease.artist_name}
                        </button>
                    </div>
                </header>

                <div class="detail-body">
                    <div class="release-detail-header-block">
                        <div class="release-detail-cover">
                            <img
                                src={getReleaseCoverUrl(detailRelease.mbid)}
                                alt={detailRelease.title}
                                on:error={(e) => {
                                    const target =
                                        e.currentTarget as HTMLImageElement;
                                    target.style.display = "none";
                                    target.nextElementSibling?.classList.remove(
                                        "hidden",
                                    );
                                }}
                            />
                            <div class="hidden icon-fallback">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="48"
                                    height="48"
                                >
                                    <path
                                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                    />
                                </svg>
                            </div>
                        </div>
                        <div class="release-detail-info-block">
                            <div class="card-meta">
                                {#if detailRelease.release_type}
                                    <span class="meta-chip type-chip"
                                        >{detailRelease.release_type}</span
                                    >
                                {/if}
                                {#if detailRelease.year}
                                    <span class="meta-chip"
                                        >{detailRelease.year}</span
                                    >
                                {/if}
                            </div>
                            {#if detailRelease.genres.length > 0}
                                <div class="genre-pills">
                                    {#each detailRelease.genres as genre}
                                        <span class="genre-pill">{genre}</span>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>

                    <section class="detail-section">
                        <h3>Tracks</h3>
                        {#if detailReleaseLoading}
                            <div class="detail-loading">
                                <div class="spinner"></div>
                                <p>Fetching tracklist…</p>
                            </div>
                        {:else if detailReleaseTracks.length > 0}
                            <div class="mb-track-list">
                                {#each detailReleaseTracks as track}
                                    <div class="mb-track-item">
                                        <span class="track-num"
                                            >{track.track_number}</span
                                        >
                                        <div class="track-info">
                                            <span class="track-name"
                                                >{track.title}</span
                                            >
                                            <span class="track-artist"
                                                >{track.artist}</span
                                            >
                                        </div>
                                        <div class="track-actions">
                                            <button
                                                class="play-tidal-btn"
                                                title="Play Stream"
                                                on:click={(e) => {
                                                    e.stopPropagation();
                                                    playOnPlayback(track);
                                                }}
                                                disabled={playingStreamId ===
                                                    track.mbid}
                                            >
                                                {#if playingStreamId === track.mbid}
                                                    <div
                                                        class="spinner-xs"
                                                    ></div>
                                                {:else}
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                        width="18"
                                                        height="18"
                                                    >
                                                        <path
                                                            d="M8 5v14l11-7z"
                                                        />
                                                    </svg>
                                                {/if}
                                            </button>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <p class="hint">No tracks found for this release</p>
                        {/if}
                    </section>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    /* ─── Root layout ──────────────────────────────────────────────────────── */
    .discover-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        position: relative;
    }

    .discover-header {
        flex-shrink: 0;
        padding: var(--spacing-lg) var(--spacing-xl) 0;
    }

    .header-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: var(--spacing-md);
    }

    .header-title-group {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .header-icon {
        color: var(--accent-primary);
        flex-shrink: 0;
    }

    .discover-header h1 {
        font-size: 1.65rem;
        font-weight: 700;
        margin: 0;
        color: var(--text-primary);
    }

    .header-subtitle {
        font-size: 0.82rem;
        color: var(--text-secondary);
        margin: 2px 0 0;
    }

    /* ─── Search bar ───────────────────────────────────────────────────────── */
    .search-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: 10px 14px;
        margin-bottom: var(--spacing-md);
        transition: border-color var(--transition-fast);
    }

    .search-bar:focus-within {
        border-color: var(--accent-primary);
    }

    .search-icon {
        color: var(--text-secondary);
        flex-shrink: 0;
    }

    .search-input {
        flex: 1;
        background: none;
        border: none;
        color: var(--text-primary);
        font-size: 0.95rem;
        outline: none;
    }

    .search-input::placeholder {
        color: var(--text-subdued);
    }

    .clear-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 2px;
        display: flex;
        border-radius: var(--radius-full);
        transition: color var(--transition-fast);
    }

    .clear-btn:hover {
        color: var(--text-primary);
    }

    /* ─── Tabs ─────────────────────────────────────────────────────────────── */
    .tab-bar {
        display: flex;
        gap: var(--spacing-xs);
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 0;
    }

    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: var(--spacing-sm) var(--spacing-md) 10px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--text-secondary);
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition:
            color var(--transition-fast),
            border-color var(--transition-fast);
    }

    .tab:hover {
        color: var(--text-primary);
    }

    .tab.active {
        color: var(--accent-primary);
        border-bottom-color: var(--accent-primary);
    }

    /* ─── Content area ─────────────────────────────────────────────────────── */
    .discover-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg) var(--spacing-xl) var(--spacing-xl);
    }

    /* ─── States ───────────────────────────────────────────────────────────── */
    .empty-state,
    .loading-state,
    .error-state,
    .no-results {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 80px var(--spacing-md);
        color: var(--text-secondary);
    }

    .empty-state p,
    .loading-state p,
    .error-state p,
    .no-results p {
        font-size: 1rem;
        margin: var(--spacing-md) 0 var(--spacing-xs);
        color: var(--text-primary);
    }

    .hint {
        font-size: 0.82rem;
        color: var(--text-subdued);
    }

    .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--bg-highlight);
        border-top-color: var(--accent-primary);
        border-radius: var(--radius-full);
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ─── Results grid ─────────────────────────────────────────────────────── */
    .artist-grid,
    .release-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--spacing-md);
    }

    .card-wrapper {
        display: contents; /* Ensure grid layout is preserved */
    }

    /* Target the actual card inside the wrapper for the click area if display: contents isn't enough */
    .card-wrapper > :global(*) {
        cursor: pointer;
    }

    /* ─── Artist & Release cards ───────────────────────────────────────────── */
    .artist-avatar {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2.5rem;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(
            135deg,
            var(--accent-primary) 0%,
            #1a73e8 100%
        );
    }

    .release-icon {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: var(--bg-surface);
    }

    .card-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 4px;
        align-items: inherit;
    }

    .meta-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.72rem;
        background: var(--bg-surface);
        color: var(--text-secondary);
        width: fit-content;
    }

    .type-chip {
        background: var(--accent-subtle);
        color: var(--accent-primary);
        font-weight: 600;
    }

    .genre-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 2px;
        justify-content: inherit;
    }

    .genre-pill {
        padding: 1px 8px;
        border-radius: var(--radius-full);
        font-size: 0.68rem;
        background: var(--bg-surface);
        color: var(--text-secondary);
    }

    /* ─── Detail overlay ───────────────────────────────────────────────────── */
    .detail-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 50;
        display: flex;
        justify-content: flex-end;
    }

    .detail-panel {
        width: min(480px, 100%);
        height: 100%;
        background: var(--bg-elevated);
        border-left: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .detail-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .back-btn {
        background: none;
        border: none;
        padding: 8px;
        border-radius: var(--radius-full);
        color: var(--text-secondary);
        cursor: pointer;
        transition:
            background 0.2s,
            color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .back-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .artist-link-btn {
        background: none;
        border: none;
        color: var(--accent-primary);
        padding: 0;
        font-size: 0.9rem;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
    }

    .artist-link-btn:hover {
        text-decoration: underline;
    }

    .tracks-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 40px 20px;
        color: var(--text-secondary);
    }

    .tracks-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
    }

    .track-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: var(--bg-surface);
        border-radius: var(--radius-md);
        transition: background 0.2s;
    }

    .track-row:hover {
        background: var(--bg-hover);
    }

    .track-info {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .track-number {
        font-family: var(--font-mono);
        color: var(--text-tertiary);
        width: 24px;
        font-size: 0.85rem;
    }

    .track-names {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .track-title {
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-actions {
        flex-shrink: 0;
    }

    .tidal-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #00bfaf;
        color: white !important;
        border: none;
        padding: 4px 12px;
        border-radius: var(--radius-full);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition:
            transform 0.1s,
            opacity 0.2s;
    }

    .tidal-btn:hover {
        transform: scale(1.05);
        opacity: 0.9;
    }

    .tidal-btn.loading {
        opacity: 0.7;
        cursor: wait;
    }

    .spinner-small,
    .spinner-tiny {
        border: 2px solid var(--border-color);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    .spinner-small {
        width: 20px;
        height: 20px;
    }

    .spinner-tiny {
        width: 14px;
        height: 14px;
        border-width: 1.5px;
        border-top-color: white;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .disco-item {
        cursor: pointer;
        transition:
            background 0.2s,
            transform 0.2s;
    }

    .disco-item:hover {
        background: var(--bg-hover);
        transform: translateY(-2px);
    }

    .detail-title-block h2 {
        font-size: 1.2rem;
        font-weight: 700;
        margin: 0;
        color: var(--text-primary);
    }

    .detail-disambig {
        font-size: 0.78rem;
        color: var(--text-secondary);
    }

    .detail-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px var(--spacing-md);
        gap: var(--spacing-md);
        color: var(--text-secondary);
    }

    .detail-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg);
    }

    .detail-section {
        margin-bottom: 28px;
    }

    .detail-section h3 {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin: 0 0 10px;
    }

    .bio-text {
        font-size: 0.88rem;
        line-height: 1.6;
        color: var(--text-primary);
        margin: 0 0 10px;
    }

    .wiki-link {
        font-size: 0.82rem;
        color: var(--accent-primary);
        text-decoration: none;
    }

    .wiki-link:hover {
        text-decoration: underline;
    }

    .detail-genres {
        gap: 6px;
    }

    .detail-meta {
        gap: var(--spacing-sm);
    }

    /* ─── Discography inside detail ────────────────────────────────────────── */
    .disco-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
    }

    .disco-header h3 {
        margin: 0;
    }

    .disco-filter-btn {
        background: none;
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
        font-size: 0.72rem;
        padding: 3px 10px;
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition:
            color var(--transition-fast),
            border-color var(--transition-fast);
    }

    .disco-filter-btn:hover {
        color: var(--text-primary);
        border-color: var(--text-subdued);
    }

    .disco-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .disco-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        border-left: 3px solid transparent;
        transition: background var(--transition-fast);
    }

    .disco-item:hover {
        background: var(--bg-highlight);
    }

    /* Per-type left border accent — album uses the app accent */
    .disco-item.rt-album {
        border-left-color: var(--accent-primary);
    }
    .disco-item.rt-single {
        border-left-color: #e8a317;
    }
    .disco-item.rt-ep {
        border-left-color: #1a73e8;
    }
    .disco-item.rt-live {
        border-left-color: #e84040;
    }
    .disco-item.rt-compilation {
        border-left-color: #9b59b6;
    }
    .disco-item.rt-soundtrack {
        border-left-color: #e67e22;
    }
    .disco-item.rt-remix {
        border-left-color: #00bcd4;
    }
    .disco-item.rt-other {
        border-left-color: var(--text-subdued);
    }

    /* Type icon */
    .disco-type-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .disco-type-icon.rt-album {
        background: var(--accent-subtle);
        color: var(--accent-primary);
    }
    .disco-type-icon.rt-single {
        background: rgba(232, 163, 23, 0.12);
        color: #e8a317;
    }
    .disco-type-icon.rt-ep {
        background: rgba(26, 115, 232, 0.12);
        color: #1a73e8;
    }
    .disco-type-icon.rt-live {
        background: rgba(232, 64, 64, 0.12);
        color: #e84040;
    }
    .disco-type-icon.rt-compilation {
        background: rgba(155, 89, 182, 0.12);
        color: #9b59b6;
    }
    .disco-type-icon.rt-soundtrack {
        background: rgba(230, 126, 34, 0.12);
        color: #e67e22;
    }
    .disco-type-icon.rt-remix {
        background: rgba(0, 188, 212, 0.12);
        color: #00bcd4;
    }
    .disco-type-icon.rt-other {
        background: var(--bg-highlight);
        color: var(--text-subdued);
    }

    .release-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .release-icon svg.hidden,
    .disco-type-icon img[style*="display: none"] + .hidden,
    .hidden {
        display: none !important;
    }

    .disco-type-icon {
        position: relative;
        overflow: hidden;
    }

    .disco-type-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .icon-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .disco-title {
        font-size: 0.88rem;
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .disco-year {
        font-size: 0.73rem;
        color: var(--text-subdued);
    }

    /* Per-type badges — album uses the app accent */
    .disco-badge {
        flex-shrink: 0;
        padding: 2px 10px;
        border-radius: var(--radius-full);
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
    }

    .disco-badge.rt-album {
        background: var(--accent-subtle);
        color: var(--accent-primary);
    }
    .disco-badge.rt-single {
        background: rgba(232, 163, 23, 0.15);
        color: #e8a317;
    }
    .disco-badge.rt-ep {
        background: rgba(26, 115, 232, 0.15);
        color: #1a73e8;
    }
    .disco-badge.rt-live {
        background: rgba(232, 64, 64, 0.15);
        color: #e84040;
    }
    .disco-badge.rt-compilation {
        background: rgba(155, 89, 182, 0.15);
        color: #9b59b6;
    }
    .disco-badge.rt-soundtrack {
        background: rgba(230, 126, 34, 0.15);
        color: #e67e22;
    }
    .disco-badge.rt-remix {
        background: rgba(0, 188, 212, 0.15);
        color: #00bcd4;
    }
    .disco-badge.rt-other {
        background: var(--bg-highlight);
        color: var(--text-subdued);
    }

    /* ─── Responsive ───────────────────────────────────────────────────────── */
    @media (max-width: 600px) {
        .discover-header {
            padding: var(--spacing-md) var(--spacing-md) 0;
        }

        .discover-content {
            padding: var(--spacing-md);
        }

        .detail-panel {
            width: 100%;
        }
    }
    .release-detail-header-block {
        display: flex;
        gap: var(--spacing-lg);
        margin-bottom: var(--spacing-xl);
    }
    .release-detail-cover {
        width: 140px;
        height: 140px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--bg-highlight);
        flex-shrink: 0;
        box-shadow: var(--shadow-md);
    }
    .release-detail-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .release-detail-info-block {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--spacing-md);
    }
    .mb-track-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .mb-track-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        transition: background var(--transition-fast);
        gap: var(--spacing-md);
    }
    .mb-track-item:hover {
        background: var(--bg-surface);
    }
    .track-num {
        width: 24px;
        font-size: 0.82rem;
        color: var(--text-subdued);
        text-align: right;
    }
    .track-info {
        flex: 1;
        display: flex;
        min-width: 0;
        text-align: left;
    }
    .track-name {
        font-size: 0.92rem;
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .track-artist {
        font-size: 0.78rem;
        color: var(--text-secondary);
    }
    .play-tidal-btn {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-full);
        background: var(--bg-highlight);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all var(--transition-fast);
        border: none;
        cursor: pointer;
    }
    .play-tidal-btn:hover:not(:disabled) {
        background: var(--accent-primary);
        color: white;
        transform: scale(1.1);
    }
    .play-tidal-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .spinner-xs {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: currentColor;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
</style>
