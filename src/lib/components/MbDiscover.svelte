<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import {
        getListenbrainzToken,
        formatDuration,
        addExternalTrack,
        getTrackById,
        type Track,
    } from "$lib/api/tauri";
    import {
        globalProviders,
        providersStore,
        type MetadataTrackItem,
        type MetadataAlbumItem,
        type MetadataArtistItem,
    } from "$lib/plugins/providers";
    import { playTracks, currentTrack, isPlaying } from "$lib/stores/player";
    import { addToast } from "$lib/stores/toast";
    import {
        goToArtistDetail,
        goToAlbumDetail,
        currentView,
    } from "$lib/stores/view";
    import {
        artists as libraryArtists,
        albums as libraryAlbums,
        addExternalTrackToLibrary,
    } from "$lib/stores/library";
    import { isMobile, registerBackHandler } from "$lib/stores/mobile";
    import MediaCard from "./MediaCard.svelte";
    import Icon from "$lib/components/Icon.svelte";

    type Tab = "all" | "tracks" | "albums" | "artists";
    type SearchState = "idle" | "loading" | "done" | "error";

    let activeTab: Tab = "all";
    let searchInput = "";
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let lastQuery = "";
    let selectedProviderId = "all";

    // Results
    let trackResults: MetadataTrackItem[] = [];
    let albumResults: MetadataAlbumItem[] = [];
    let artistResults: MetadataArtistItem[] = [];
    let searchState: SearchState = "idle";
    let errorMsg = "";

    // Navigation Stack for in-Discover browsing: Song > Album > Artist
    interface NavSearch {
        type: "search";
        title?: string;
    }
    interface NavAlbum {
        type: "album";
        albumId: string;
        providerId?: string;
        title?: string;
        artist?: string;
        cover_url?: string;
        album?: MetadataAlbumItem;
    }
    interface NavArtist {
        type: "artist";
        artistId: string;
        providerId?: string;
        artistName?: string;
        avatar_url?: string;
        artist?: MetadataArtistItem;
    }
    type NavItem = NavSearch | NavAlbum | NavArtist;

    let navStack: NavItem[] = [{ type: "search", title: "Search" }];
    $: currentNav = navStack[navStack.length - 1] || { type: "search" };

    // Detail States
    let currentAlbumDetail: MetadataAlbumItem | null = null;
    let albumLoading = false;
    let currentArtistDetail: MetadataArtistItem | null = null;
    let artistLoading = false;
    let showAllReleaseTypes = false;

    // Playback state
    let loadingStreamId: string | null = null;

    // Save-to-library state
    // Tracks which discover items have been saved (by external_id/id/title key)
    let savedDiscoverKeys = new Set<string>();
    let savingId: string | null = null;
    let isSavingAlbum = false;

    $: isCurrentAlbumSaved =
        !!currentAlbumDetail &&
        (findLocalAlbumId(currentAlbumDetail.title) !== undefined ||
            (currentAlbumDetail.tracks?.length
                ? currentAlbumDetail.tracks.every((t) => isTrackSaved(t))
                : false));

    function discoverTrackKey(track: MetadataTrackItem): string {
        return track.external_id || track.id || track.title;
    }

    function isTrackSaved(track: MetadataTrackItem): boolean {
        return savedDiscoverKeys.has(discoverTrackKey(track));
    }

    async function saveTrackToLibrary(
        track: MetadataTrackItem,
        fallbackAlbum?: string,
        fallbackCover?: string,
        fallbackArtist?: string,
    ) {
        const key = discoverTrackKey(track);
        if (savingId === key) return;
        savingId = key;

        // Optimistic UI
        savedDiscoverKeys.add(key);
        savedDiscoverKeys = new Set(savedDiscoverKeys);

        try {
            const sourceType =
                track.source_type ||
                (track.provider_id === "musicbrainz"
                    ? "musicbrainz"
                    : track.provider_id || "plugin");

            const finalAlbum = track.album || fallbackAlbum || undefined;
            const finalCover = track.cover_url || fallbackCover || undefined;
            const finalArtist = track.artist || fallbackArtist || "Unknown Artist";

            const dbId = await addExternalTrack({
                title: track.title,
                artist: finalArtist,
                album: finalAlbum,
                duration: track.duration ?? undefined,
                cover_url: finalCover,
                source_type: sourceType,
                external_id: track.external_id || track.id,
                track_number: track.track_number ?? undefined,
                disc_number: track.disc_number ?? undefined,
                stream_url: track.preview_url || undefined,
            });

            // Fetch the authoritative track record from SQLite DB
            // This contains the real album_id and date_added generated on insert
            const savedTrack = await getTrackById(dbId);
            if (savedTrack) {
                if (!savedTrack.cover_url && finalCover) {
                    savedTrack.cover_url = finalCover;
                }
                addExternalTrackToLibrary(savedTrack);
            } else {
                const libraryTrack = toAudionTrack(
                    track,
                    fallbackAlbum,
                    fallbackCover,
                    fallbackArtist,
                );
                addExternalTrackToLibrary({ ...libraryTrack, id: dbId });
            }

            addToast("Saved to library", "success");
        } catch (e) {
            console.error("[Discover] saveTrackToLibrary failed:", e);
            savedDiscoverKeys.delete(key);
            savedDiscoverKeys = new Set(savedDiscoverKeys);
            addToast("Failed to save track", "error");
        } finally {
            savingId = null;
        }
    }

    async function saveAlbumToLibrary(album: MetadataAlbumItem) {
        if (!album || !album.tracks || album.tracks.length === 0) {
            addToast("No tracks in album to save", "error");
            return;
        }
        if (isSavingAlbum) return;
        isSavingAlbum = true;

        try {
            let savedCount = 0;
            for (const track of album.tracks) {
                await saveTrackToLibrary(
                    track,
                    album.title,
                    album.cover_url,
                    album.artist,
                );
                savedCount++;
            }
            addToast(`Saved "${album.title}" (${savedCount} tracks)`, "success");
        } catch (e) {
            console.error("[Discover] saveAlbumToLibrary failed:", e);
            addToast("Failed to save some tracks from album", "error");
        } finally {
            isSavingAlbum = false;
        }
    }

    // Active providers
    $: activeMetadataProviders = $providersStore.filter(
        (p) => p.type === "metadata" && p.enabled,
    );
    $: activeStreamProviders = $providersStore.filter(
        (p) => p.type === "stream" && p.enabled,
    );

    // Local library lookup sets (lowercased)
    $: localArtistSet = new Set(
        $libraryArtists.map((a) => a.name.toLowerCase()),
    );
    $: localAlbumMap = new Map(
        $libraryAlbums.map((a) => [a.name.toLowerCase(), a.id]),
    );

    function isArtistInLibrary(name?: string): boolean {
        if (!name) return false;
        return localArtistSet.has(name.toLowerCase());
    }

    function findLocalAlbumId(title?: string): number | undefined {
        if (!title) return undefined;
        return localAlbumMap.get(title.toLowerCase());
    }

    function debounceSearch() {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => executeSearch(), 450);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            if (searchTimer) clearTimeout(searchTimer);
            executeSearch();
        }
    }

    function handleSongRowKeydown(e: KeyboardEvent, onPlay: () => void) {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlay();
        }
    }

    async function executeSearch() {
        const q = searchInput.trim();
        if (!q || q.length < 2) return;
        lastQuery = q;

        // Reset to search view when initiating a new search
        navStack = [{ type: "search", title: "Search" }];
        searchState = "loading";
        errorMsg = "";

        try {
            const searchType =
                activeTab === "tracks"
                    ? "track"
                    : activeTab === "albums"
                      ? "album"
                      : activeTab === "artists"
                        ? "artist"
                        : "all";

            const res = await globalProviders.searchProviderMetadata(
                selectedProviderId,
                q,
                searchType,
                1,
            );

            trackResults = res.tracks || [];
            albumResults = res.albums || [];
            artistResults = res.artists || [];
            searchState = "done";
        } catch (e) {
            console.error("[Discover] Search failed:", e);
            errorMsg = String(e);
            searchState = "error";
        }
    }

    function switchTab(tab: Tab) {
        if (tab === activeTab) return;
        activeTab = tab;
        if (searchInput.trim().length >= 2) {
            executeSearch();
        }
    }

    function handleProviderChange(e: Event) {
        const target = e.target as HTMLSelectElement;
        selectedProviderId = target.value;
        if (searchInput.trim().length >= 2) {
            executeSearch();
        }
    }

    // Navigation methods
    function pushNav(item: NavItem) {
        navStack = [...navStack, item];
        if (item.type === "album") {
            loadAlbum(item);
        } else if (item.type === "artist") {
            loadArtist(item);
        }
    }

    function popNav() {
        if (navStack.length > 1) {
            navStack = navStack.slice(0, -1);
            const top = navStack[navStack.length - 1];
            if (top.type === "album") {
                loadAlbum(top);
            } else if (top.type === "artist") {
                loadArtist(top);
            }
        }
    }

    function goToBreadcrumb(index: number) {
        if (index < navStack.length - 1) {
            navStack = navStack.slice(0, index + 1);
            const top = navStack[navStack.length - 1];
            if (top.type === "album") {
                loadAlbum(top);
            } else if (top.type === "artist") {
                loadArtist(top);
            }
        }
    }

    function navigateToAlbum(
        albumId?: string,
        title?: string,
        artist?: string,
        providerId?: string,
        coverUrl?: string,
    ) {
        if (!albumId && !title) return;
        const id = albumId || `title-${encodeURIComponent(title || "")}`;
        pushNav({
            type: "album",
            albumId: id,
            providerId,
            title: title || "Album",
            artist,
            cover_url: coverUrl,
        });
    }

    function navigateToArtist(
        artistId?: string,
        artistName?: string,
        providerId?: string,
        avatarUrl?: string,
    ) {
        if (!artistId && !artistName) return;
        const id = artistId || `name-${encodeURIComponent(artistName || "")}`;
        pushNav({
            type: "artist",
            artistId: id,
            providerId,
            artistName: artistName || "Artist",
            avatar_url: avatarUrl,
        });
    }

    async function loadAlbum(entry: NavAlbum) {
        currentAlbumDetail = null;
        albumLoading = true;
        try {
            const data = await globalProviders.getAlbum(
                entry.albumId,
                entry.providerId,
            );
            if (data) {
                currentAlbumDetail = {
                    ...data,
                    title: data.title || entry.title || "Unknown Album",
                    artist: data.artist || entry.artist || "Unknown Artist",
                    cover_url: data.cover_url || entry.cover_url,
                };
            } else {
                // Fallback shell
                currentAlbumDetail = {
                    id: entry.albumId,
                    title: entry.title || "Unknown Album",
                    artist: entry.artist || "Unknown Artist",
                    cover_url: entry.cover_url,
                    tracks: [],
                };
            }
        } catch (e) {
            console.error("[Discover] loadAlbum error:", e);
            currentAlbumDetail = {
                id: entry.albumId,
                title: entry.title || "Unknown Album",
                artist: entry.artist || "Unknown Artist",
                cover_url: entry.cover_url,
                tracks: [],
            };
        } finally {
            albumLoading = false;
        }
    }

    async function loadArtist(entry: NavArtist) {
        currentArtistDetail = null;
        artistLoading = true;
        showAllReleaseTypes = false;
        try {
            const data = await globalProviders.getArtist(
                entry.artistId,
                entry.providerId,
                entry.artistName,
            );
            if (data) {
                currentArtistDetail = {
                    ...data,
                    name: data.name || entry.artistName || "Unknown Artist",
                    avatar_url: data.avatar_url || entry.avatar_url,
                };
            } else {
                currentArtistDetail = {
                    id: entry.artistId,
                    name: entry.artistName || "Unknown Artist",
                    avatar_url: entry.avatar_url,
                    tracks: [],
                    albums: [],
                };
            }
        } catch (e) {
            console.error("[Discover] loadArtist error:", e);
            currentArtistDetail = {
                id: entry.artistId,
                name: entry.artistName || "Unknown Artist",
                avatar_url: entry.avatar_url,
                tracks: [],
                albums: [],
            };
        } finally {
            artistLoading = false;
        }
    }

    function hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    function toAudionTrack(
        track: MetadataTrackItem,
        fallbackAlbum?: string,
        fallbackCover?: string,
        fallbackArtist?: string,
    ): Track {
        let durationSec = track.duration || 0;
        if (durationSec > 10000) durationSec = Math.round(durationSec / 1000);

        const safeId =
            -(
                Math.abs(
                    hashString(
                        String(track.id || track.external_id || track.title),
                    ),
                ) % 9000000
            ) - 1000000;

        const sourceType =
            track.source_type ||
            (track.provider_id === "musicbrainz"
                ? "musicbrainz"
                : track.provider_id || "plugin");

        const path =
            track.preview_url ||
            (track.external_id ? `${sourceType}://${track.external_id}` : "") ||
            `plugin://${sourceType}`;

        const chosenArtist = track.artist || fallbackArtist || "Unknown Artist";
        const chosenAlbum = track.album || fallbackAlbum || "Unknown Album";
        const chosenCover = track.cover_url || fallbackCover || null;

        return {
            id: safeId,
            path,
            title: track.title || "Unknown Title",
            artist: chosenArtist,
            artists: chosenArtist ? [chosenArtist] : [],
            album: chosenAlbum,
            track_number: track.track_number ?? null,
            duration: durationSec || null,
            album_id: null,
            format: track.format || "STREAM",
            bitrate: track.bitrate || 0,
            source_type: sourceType,
            external_id: track.external_id || track.id,
            cover_url: chosenCover,
            disc_number: track.disc_number ?? null,
            date_added: new Date().toISOString(),
        };
    }

    async function playSong(
        track: MetadataTrackItem,
        contextTracks?: MetadataTrackItem[],
        fallbackAlbum?: string,
        fallbackCover?: string,
    ) {
        loadingStreamId = track.id || track.external_id || track.title;
        try {
            // Check if track is a MusicBrainz recording without external stream provider
            if (
                (track.source_type === "musicbrainz" ||
                    track.provider_id === "musicbrainz") &&
                activeStreamProviders.length === 0
            ) {
                await playViaListenBrainz(track);
                return;
            }

            const queue =
                contextTracks && contextTracks.length > 0
                    ? contextTracks.map((t) =>
                          toAudionTrack(t, fallbackAlbum, fallbackCover),
                      )
                    : [toAudionTrack(track, fallbackAlbum, fallbackCover)];

            const startIdx = Math.max(
                0,
                queue.findIndex(
                    (t) =>
                        t.external_id === (track.external_id || track.id) ||
                        t.title === track.title,
                ),
            );

            playTracks(queue, startIdx >= 0 ? startIdx : 0);
        } catch (e) {
            console.error("[Discover] playSong failed:", e);
            addToast($_("discover.metadataLookupFailed"), "error");
        } finally {
            loadingStreamId = null;
        }
    }

    async function playViaListenBrainz(track: MetadataTrackItem) {
        try {
            const token = await getListenbrainzToken();
            const headers: Record<string, string> = {
                Accept: "application/json",
            };
            if (token) headers["Authorization"] = `Token ${token}`;

            const mbid = track.external_id || track.id;
            const query = new URLSearchParams({
                recording_mbids: mbid,
                artist_name: track.artist,
                recording_name: track.title,
                inc: "metadata",
            });

            const resp = await fetch(
                `https://api.listenbrainz.org/1/metadata/lookup/?${query.toString()}`,
                { headers },
            );
            const data = await resp.json();
            const meta = data[mbid];

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
                addToast($_("discover.noStreamUrl"), "error");
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
                album: track.album || "Unknown Album",
                track_number: track.track_number ?? 1,
                duration: track.duration || 0,
                album_id: null,
                format: "STREAM",
                bitrate: 0,
                source_type: sourceType,
                external_id: streamUrl,
                cover_url: track.cover_url || null,
                disc_number: track.disc_number ?? 1,
            };
            playTracks([audionTrack], 0);
        } catch (e) {
            console.error("[Discover] ListenBrainz playback error:", e);
            addToast($_("discover.metadataLookupFailed"), "error");
        }
    }

    function isCurrentTrackPlaying(track: MetadataTrackItem): boolean {
        if (!$currentTrack || !$isPlaying) return false;
        return (
            $currentTrack.title === track.title &&
            ($currentTrack.artist === track.artist ||
                $currentTrack.external_id === (track.external_id || track.id))
        );
    }

    function artistInitial(name: string): string {
        return (name || "?").charAt(0).toUpperCase();
    }

    // Discography filter
    const PRIMARY_TYPES = ["album", "single", "ep"];
    $: filteredDiscography = currentArtistDetail?.albums
        ? showAllReleaseTypes
            ? currentArtistDetail.albums
            : currentArtistDetail.albums.filter((a) =>
                  PRIMARY_TYPES.includes(
                      (a.release_type || "album").toLowerCase(),
                  ),
              )
        : [];

    onMount(() => {
        if ($currentView.type === "discover" && $currentView.query) {
            searchInput = $currentView.query;
            activeTab = "all";
            executeSearch();
        }
        const unregisterBack = registerBackHandler(() => {
            if (navStack.length > 1) {
                popNav();
                return true;
            }
            return false;
        });
        return unregisterBack;
    });
</script>

<div class="discover-root">
    <!-- Header -->
    <header class="discover-header">
        <div class="header-row">
            <div class="header-title-group">
                <div>
                    <h1>{$_("sidebar.discover")}</h1>
                    <p class="header-subtitle">
                        {$_("discover.subtitle")}
                    </p>
                </div>
            </div>

            <!-- Provider Connection Status Bar -->
            <div class="provider-status-bar">
                <div class="provider-badge stream-status">
                    {#if activeStreamProviders.length > 0}
                        <span class="status-dot online"></span>
                        <span class="provider-text">
                            {$_("discover.streamingVia")}:
                            <strong>{activeStreamProviders[0].name}</strong>
                            {#if activeStreamProviders.length > 1}
                                <span class="provider-extra"
                                    >+{activeStreamProviders.length - 1}</span
                                >
                            {/if}
                        </span>
                    {:else}
                        <span class="status-dot offline"></span>
                        <span class="provider-text warning">
                            {$_("discover.noStreamProvider")}
                        </span>
                    {/if}
                </div>
            </div>
        </div>

        <!-- Search Bar with Provider Selector -->
        <div class="search-composite">
            <div class="search-bar">
                <Icon name="search" size={20} className="search-icon" />
                <input
                    type="text"
                    class="search-input"
                    placeholder={$_("discover.searchPlaceholder")}
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
                            trackResults = [];
                            albumResults = [];
                            artistResults = [];
                            searchState = "idle";
                            navStack = [{ type: "search", title: "Search" }];
                        }}
                    >
                        <Icon name="x" size={18} />
                    </button>
                {/if}
            </div>

            <!-- Metadata Provider Filter Dropdown -->
            <div class="provider-select-wrapper">
                <Icon name="server" size={16} className="select-icon" />
                <select
                    class="provider-select"
                    value={selectedProviderId}
                    on:change={handleProviderChange}
                    aria-label={$_("discover.provider")}
                >
                    <option value="all">{$_("discover.allProviders")}</option
                    >
                    {#each activeMetadataProviders as mp}
                        <option value={mp.id}>{mp.name}</option>
                    {/each}
                </select>
            </div>
        </div>

        <!-- Tabs & Breadcrumbs Bar -->
        {#if currentNav.type === "search"}
            <div class="tab-bar">
                <button
                    class="tab"
                    class:active={activeTab === "all"}
                    on:click={() => switchTab("all")}
                >
                    <Icon name="grid" size={16} />
                    {$_("discover.tabAll")}
                </button>
                <button
                    class="tab"
                    class:active={activeTab === "tracks"}
                    on:click={() => switchTab("tracks")}
                >
                    <Icon name="music" size={16} />
                    {$_("discover.tabSongs")}
                    {#if trackResults.length > 0}
                        <span class="tab-badge">{trackResults.length}</span>
                    {/if}
                </button>
                <button
                    class="tab"
                    class:active={activeTab === "albums"}
                    on:click={() => switchTab("albums")}
                >
                    <Icon name="disc" size={16} />
                    {$_("discover.tabReleases")}
                    {#if albumResults.length > 0}
                        <span class="tab-badge">{albumResults.length}</span>
                    {/if}
                </button>
                <button
                    class="tab"
                    class:active={activeTab === "artists"}
                    on:click={() => switchTab("artists")}
                >
                    <Icon name="users" size={16} />
                    {$_("discover.tabArtists")}
                    {#if artistResults.length > 0}
                        <span class="tab-badge">{artistResults.length}</span>
                    {/if}
                </button>
            </div>
        {:else}
            <!-- Breadcrumb Navigation Bar -->
            <div class="breadcrumb-bar" in:fade={{ duration: 150 }}>
                <button
                    class="back-nav-btn"
                    on:click={popNav}
                    title={$_("discover.back")}
                >
                    <Icon name="arrow-left" size={18} />
                    <span>{$_("discover.back")}</span>
                </button>
                <div class="breadcrumb-trail">
                    {#each navStack as item, idx}
                        {#if idx > 0}
                            <span class="breadcrumb-sep">/</span>
                        {/if}
                        <button
                            class="breadcrumb-item"
                            class:active={idx === navStack.length - 1}
                            on:click={() => goToBreadcrumb(idx)}
                        >
                            {#if item.type === "search"}
                                {$_("sidebar.discover")}
                            {:else if item.type === "album"}
                                <Icon name="disc" size={14} />
                                <span>{item.title || "Album"}</span>
                            {:else if item.type === "artist"}
                                <Icon name="user" size={14} />
                                <span>{item.artistName || "Artist"}</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
    </header>

    <!-- Content Area -->
    <div class="discover-content">
        <!-- 1. SEARCH RESULTS VIEW -->
        {#if currentNav.type === "search"}
            {#if searchState === "idle"}
                <div class="empty-state" in:fade={{ duration: 200 }}>
                    <Icon name="globe" size={64} />
                    <p>{$_("discover.emptyTitle")}</p>
                    <span class="hint">{$_("discover.emptyHint")}</span>
                </div>
            {:else if searchState === "loading"}
                <div class="loading-state" in:fade={{ duration: 150 }}>
                    <div class="spinner"></div>
                    <p>{$_("discover.searching")}</p>
                </div>
            {:else if searchState === "error"}
                <div class="error-state" in:fade={{ duration: 200 }}>
                    <Icon name="alert-circle" size={48} />
                    <p>{$_("discover.searchFailedTitle")}</p>
                    <span class="hint">{errorMsg}</span>
                </div>
            {:else if searchState === "done"}
                <!-- Check if no results across any type -->
                {#if trackResults.length === 0 && albumResults.length === 0 && artistResults.length === 0}
                    <div class="no-results" in:fade={{ duration: 200 }}>
                        <p>
                            {$_("main.noResultsFound")} "<strong>{lastQuery}</strong
                            >"
                        </p>
                        <span class="hint"
                            >{$_("discover.tryDifferentKeyword")}</span
                        >
                    </div>
                {:else}
                    <!-- OVERVIEW (ALL) TAB -->
                    {#if activeTab === "all"}
                        <!-- SONGS SECTION -->
                        {#if trackResults.length > 0}
                            <section class="section-block">
                                <div class="section-header">
                                    <h2>{$_("discover.tabSongs")}</h2>
                                    <button
                                        class="view-all-link"
                                        on:click={() => switchTab("tracks")}
                                    >
                                        {$_("discover.showAllCount", {
                                            values: {
                                                count: trackResults.length,
                                            },
                                        })}
                                        <Icon name="arrow-right" size={14} />
                                    </button>
                                </div>
                                <div class="song-table">
                                    {#each trackResults.slice(0, 5) as track, idx}
                                        <div
                                            class="song-row"
                                            class:playing={isCurrentTrackPlaying(
                                                track,
                                            )}
                                            role="button"
                                            tabindex="0"
                                            on:click={(e) => {
                                                if ($isMobile && !(e.target as HTMLElement).closest("button, .song-col-art")) {
                                                    playSong(track, trackResults);
                                                }
                                            }}
                                            on:keydown={(e) =>
                                                handleSongRowKeydown(e, () =>
                                                    playSong(track, trackResults),
                                                )}
                                            on:dblclick={() =>
                                                playSong(track, trackResults)}
                                        >
                                            <div class="song-col-play">
                                                <button
                                                    class="play-icon-btn"
                                                    on:click={() =>
                                                        playSong(
                                                            track,
                                                            trackResults,
                                                        )}
                                                    title={$_("discover.play")}
                                                >
                                                    {#if loadingStreamId === (track.id || track.external_id || track.title)}
                                                        <div
                                                            class="spinner-tiny"
                                                        ></div>
                                                    {:else if isCurrentTrackPlaying(track)}
                                                        <Icon
                                                            name="pause"
                                                            size={16}
                                                        />
                                                    {:else}
                                                        <Icon
                                                            name="play"
                                                            size={16}
                                                        />
                                                    {/if}
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                class="song-col-art"
                                                aria-label={track.album || $_("discover.tabReleases")}
                                                on:click|stopPropagation={() =>
                                                    navigateToAlbum(
                                                        track.album_id,
                                                        track.album,
                                                        track.artist,
                                                        track.provider_id,
                                                        track.cover_url,
                                                    )}
                                            >
                                                {#if track.cover_url}
                                                    <img
                                                        src={track.cover_url}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                {:else}
                                                    <div
                                                        class="art-placeholder"
                                                    >
                                                        <Icon
                                                            name="music"
                                                            size={16}
                                                        />
                                                    </div>
                                                {/if}
                                            </button>
                                            <div class="song-col-info">
                                                <span class="song-title"
                                                    >{track.title}</span
                                                >
                                                <button
                                                    class="song-artist link-btn"
                                                    on:click={() =>
                                                        navigateToArtist(
                                                            track.artist_id,
                                                            track.artist,
                                                            track.provider_id,
                                                        )}
                                                >
                                                    {track.artist}
                                                </button>
                                            </div>
                                            <div class="song-col-album">
                                                {#if track.album}
                                                    <button
                                                        class="link-btn truncate"
                                                        on:click={() =>
                                                            navigateToAlbum(
                                                                track.album_id,
                                                                track.album,
                                                                track.artist,
                                                                track.provider_id,
                                                                track.cover_url,
                                                            )}
                                                    >
                                                        {track.album}
                                                    </button>
                                                {:else}
                                                    <span class="dim">-</span>
                                                {/if}
                                            </div>
                                            <div class="song-col-love">
                                                <button
                                                    class="love-btn"
                                                    class:saved={isTrackSaved(track)}
                                                    on:click|stopPropagation={() => saveTrackToLibrary(track)}
                                                    title={isTrackSaved(track) ? "In library" : "Save to library"}
                                                    aria-label={isTrackSaved(track) ? "In library" : "Save to library"}
                                                >
                                                    {#if savingId === discoverTrackKey(track)}
                                                        <div class="spinner-tiny"></div>
                                                    {:else}
                                                        <Icon name={isTrackSaved(track) ? "heart-filled" : "heart"} size={14} />
                                                    {/if}
                                                </button>
                                            </div>
                                            <div class="song-col-dur">
                                                {track.duration
                                                    ? formatDuration(
                                                          track.duration,
                                                      )
                                                    : "--:--"}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <!-- ALBUMS SECTION -->
                        {#if albumResults.length > 0}
                            <section class="section-block">
                                <div class="section-header">
                                    <h2>{$_("discover.tabReleases")}</h2>
                                    <button
                                        class="view-all-link"
                                        on:click={() => switchTab("albums")}
                                    >
                                        {$_("discover.showAllCount", {
                                            values: {
                                                count: albumResults.length,
                                            },
                                        })}
                                        <Icon name="arrow-right" size={14} />
                                    </button>
                                </div>
                                <div class="card-grid">
                                    {#each albumResults.slice(0, 6) as album}
                                        <div class="card-wrapper">
                                            <MediaCard
                                                primaryText={album.title}
                                                secondaryText={album.artist}
                                                isNowPlaying={findLocalAlbumId(
                                                    album.title,
                                                ) !== undefined}
                                                on:click={() =>
                                                    navigateToAlbum(
                                                        album.id,
                                                        album.title,
                                                        album.artist,
                                                        album.provider_id,
                                                        album.cover_url,
                                                    )}
                                                on:play={() =>
                                                    navigateToAlbum(
                                                        album.id,
                                                        album.title,
                                                        album.artist,
                                                        album.provider_id,
                                                        album.cover_url,
                                                    )}
                                            >
                                                <div
                                                    slot="cover"
                                                    class="release-cover"
                                                >
                                                    {#if album.cover_url}
                                                        <img
                                                            src={album.cover_url}
                                                            alt=""
                                                            loading="lazy"
                                                        />
                                                    {:else}
                                                        <Icon
                                                            name="disc"
                                                            size={36}
                                                        />
                                                    {/if}
                                                </div>
                                                <div
                                                    slot="extra-info"
                                                    class="card-meta"
                                                >
                                                    {#if album.year}
                                                        <span class="meta-chip"
                                                            >{album.year}</span
                                                        >
                                                    {/if}
                                                    {#if album.release_type}
                                                        <span
                                                            class="meta-chip type-chip"
                                                            >{album.release_type}</span
                                                        >
                                                    {/if}
                                                </div>
                                            </MediaCard>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <!-- ARTISTS SECTION -->
                        {#if artistResults.length > 0}
                            <section class="section-block">
                                <div class="section-header">
                                    <h2>{$_("discover.tabArtists")}</h2>
                                    <button
                                        class="view-all-link"
                                        on:click={() => switchTab("artists")}
                                    >
                                        {$_("discover.showAllCount", {
                                            values: {
                                                count: artistResults.length,
                                            },
                                        })}
                                        <Icon name="arrow-right" size={14} />
                                    </button>
                                </div>
                                <div class="card-grid">
                                    {#each artistResults.slice(0, 6) as artist}
                                        <div class="card-wrapper">
                                            <MediaCard
                                                variant="round"
                                                primaryText={artist.name}
                                                secondaryText={artist.disambiguation ||
                                                    artist.country ||
                                                    ""}
                                                isNowPlaying={isArtistInLibrary(
                                                    artist.name,
                                                )}
                                                on:click={() =>
                                                    navigateToArtist(
                                                        artist.id,
                                                        artist.name,
                                                        artist.provider_id,
                                                        artist.avatar_url,
                                                    )}
                                                on:play={() =>
                                                    navigateToArtist(
                                                        artist.id,
                                                        artist.name,
                                                        artist.provider_id,
                                                        artist.avatar_url,
                                                    )}
                                            >
                                                <div
                                                    slot="cover"
                                                    class="artist-avatar"
                                                >
                                                    {#if artist.avatar_url}
                                                        <img
                                                            src={artist.avatar_url}
                                                            alt=""
                                                            loading="lazy"
                                                        />
                                                    {:else}
                                                        <span
                                                            >{artistInitial(
                                                                artist.name,
                                                            )}</span
                                                        >
                                                    {/if}
                                                </div>
                                                <div
                                                    slot="extra-info"
                                                    class="card-meta"
                                                >
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
                                                </div>
                                            </MediaCard>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        <!-- SONGS ONLY TAB -->
                    {:else if activeTab === "tracks"}
                        {#if trackResults.length === 0}
                            <div class="no-results">
                                <p>
                                    {$_("discover.noTracksFoundFor")} "<strong
                                        >{lastQuery}</strong
                                    >"
                                </p>
                            </div>
                        {:else}
                            <div class="song-table full-table">
                                {#each trackResults as track}
                                    <div
                                        class="song-row"
                                        class:playing={isCurrentTrackPlaying(
                                            track,
                                        )}
                                        role="button"
                                        tabindex="0"
                                        on:click={(e) => {
                                            if ($isMobile && !(e.target as HTMLElement).closest("button, .song-col-art")) {
                                                playSong(track, trackResults);
                                            }
                                        }}
                                        on:keydown={(e) =>
                                            handleSongRowKeydown(e, () =>
                                                playSong(track, trackResults),
                                            )}
                                        on:dblclick={() =>
                                            playSong(track, trackResults)}
                                    >
                                        <div class="song-col-play">
                                            <button
                                                class="play-icon-btn"
                                                on:click={() =>
                                                    playSong(
                                                        track,
                                                        trackResults,
                                                    )}
                                                title={$_("discover.play")}
                                            >
                                                {#if loadingStreamId === (track.id || track.external_id || track.title)}
                                                    <div
                                                        class="spinner-tiny"
                                                    ></div>
                                                {:else if isCurrentTrackPlaying(track)}
                                                    <Icon
                                                        name="pause"
                                                        size={16}
                                                    />
                                                {:else}
                                                    <Icon
                                                        name="play"
                                                        size={16}
                                                    />
                                                {/if}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            class="song-col-art"
                                            aria-label={track.album || $_("discover.tabReleases")}
                                            on:click|stopPropagation={() =>
                                                navigateToAlbum(
                                                    track.album_id,
                                                    track.album,
                                                    track.artist,
                                                    track.provider_id,
                                                    track.cover_url,
                                                )}
                                        >
                                            {#if track.cover_url}
                                                <img
                                                    src={track.cover_url}
                                                    alt=""
                                                    loading="lazy"
                                                />
                                            {:else}
                                                <div class="art-placeholder">
                                                    <Icon
                                                        name="music"
                                                        size={16}
                                                    />
                                                </div>
                                            {/if}
                                        </button>
                                        <div class="song-col-info">
                                            <span class="song-title"
                                                >{track.title}</span
                                            >
                                            <button
                                                class="song-artist link-btn"
                                                on:click={() =>
                                                    navigateToArtist(
                                                        track.artist_id,
                                                        track.artist,
                                                        track.provider_id,
                                                    )}
                                            >
                                                {track.artist}
                                            </button>
                                        </div>
                                        <div class="song-col-album">
                                            {#if track.album}
                                                <button
                                                    class="link-btn truncate"
                                                    on:click={() =>
                                                        navigateToAlbum(
                                                            track.album_id,
                                                            track.album,
                                                            track.artist,
                                                            track.provider_id,
                                                            track.cover_url,
                                                        )}
                                                >
                                                    {track.album}
                                                </button>
                                            {:else}
                                                <span class="dim">-</span>
                                            {/if}
                                        </div>
                                        <div class="song-col-love">
                                            <button
                                                class="love-btn"
                                                class:saved={isTrackSaved(track)}
                                                on:click|stopPropagation={() =>
                                                    saveTrackToLibrary(
                                                        track,
                                                        track.album,
                                                        track.cover_url || currentArtistDetail?.avatar_url,
                                                        track.artist || currentArtistDetail?.name,
                                                    )}
                                                title={isTrackSaved(track) ? "In library" : "Save to library"}
                                                aria-label={isTrackSaved(track) ? "In library" : "Save to library"}
                                            >
                                                {#if savingId === discoverTrackKey(track)}
                                                    <div class="spinner-tiny"></div>
                                                {:else}
                                                    <Icon name={isTrackSaved(track) ? "heart-filled" : "heart"} size={14} />
                                                {/if}
                                            </button>
                                        </div>
                                        <div class="song-col-dur">
                                            {track.duration
                                                ? formatDuration(track.duration)
                                                : "--:--"}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- ALBUMS ONLY TAB -->
                    {:else if activeTab === "albums"}
                        {#if albumResults.length === 0}
                            <div class="no-results">
                                <p>
                                    {$_("discover.noReleasesFoundFor")} "<strong
                                        >{lastQuery}</strong
                                    >"
                                </p>
                            </div>
                        {:else}
                            <div class="card-grid">
                                {#each albumResults as album}
                                    <div class="card-wrapper">
                                        <MediaCard
                                            primaryText={album.title}
                                            secondaryText={album.artist}
                                            isNowPlaying={findLocalAlbumId(
                                                album.title,
                                            ) !== undefined}
                                            on:click={() =>
                                                navigateToAlbum(
                                                    album.id,
                                                    album.title,
                                                    album.artist,
                                                    album.provider_id,
                                                    album.cover_url,
                                                )}
                                            on:play={() =>
                                                navigateToAlbum(
                                                    album.id,
                                                    album.title,
                                                    album.artist,
                                                    album.provider_id,
                                                    album.cover_url,
                                                )}
                                        >
                                            <div
                                                slot="cover"
                                                class="release-cover"
                                            >
                                                {#if album.cover_url}
                                                    <img
                                                        src={album.cover_url}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                {:else}
                                                    <Icon
                                                        name="disc"
                                                        size={36}
                                                    />
                                                {/if}
                                            </div>
                                            <div
                                                slot="extra-info"
                                                class="card-meta"
                                            >
                                                {#if album.year}
                                                    <span class="meta-chip"
                                                        >{album.year}</span
                                                    >
                                                {/if}
                                                {#if album.release_type}
                                                    <span
                                                        class="meta-chip type-chip"
                                                        >{album.release_type}</span
                                                    >
                                                {/if}
                                            </div>
                                        </MediaCard>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- ARTISTS ONLY TAB -->
                    {:else if activeTab === "artists"}
                        {#if artistResults.length === 0}
                            <div class="no-results">
                                <p>
                                    {$_("discover.noArtistsFoundFor")} "<strong
                                        >{lastQuery}</strong
                                    >"
                                </p>
                            </div>
                        {:else}
                            <div class="card-grid">
                                {#each artistResults as artist}
                                    <div class="card-wrapper">
                                        <MediaCard
                                            variant="round"
                                            primaryText={artist.name}
                                            secondaryText={artist.disambiguation ||
                                                artist.country ||
                                                ""}
                                            isNowPlaying={isArtistInLibrary(
                                                artist.name,
                                            )}
                                            on:click={() =>
                                                navigateToArtist(
                                                    artist.id,
                                                    artist.name,
                                                    artist.provider_id,
                                                    artist.avatar_url,
                                                )}
                                            on:play={() =>
                                                navigateToArtist(
                                                    artist.id,
                                                    artist.name,
                                                    artist.provider_id,
                                                    artist.avatar_url,
                                                )}
                                        >
                                            <div
                                                slot="cover"
                                                class="artist-avatar"
                                            >
                                                {#if artist.avatar_url}
                                                    <img
                                                        src={artist.avatar_url}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                {:else}
                                                    <span
                                                        >{artistInitial(
                                                            artist.name,
                                                        )}</span
                                                    >
                                                {/if}
                                            </div>
                                            <div
                                                slot="extra-info"
                                                class="card-meta"
                                            >
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
                                            </div>
                                        </MediaCard>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                {/if}
            {/if}

            <!-- 2. ALBUM DETAIL VIEW (Song > Album > Artist) -->
        {:else if currentNav.type === "album"}
            <div class="detail-page" in:fade={{ duration: 180 }}>
                {#if albumLoading}
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>{$_("discover.fetchingTracklist")}</p>
                    </div>
                {:else if currentAlbumDetail}
                    <!-- Album Header Banner -->
                    <div class="hero-header album-hero">
                        <div class="hero-cover album-cover-lg">
                            {#if currentAlbumDetail.cover_url}
                                <img
                                    src={currentAlbumDetail.cover_url}
                                    alt={currentAlbumDetail.title}
                                />
                            {:else}
                                <div class="cover-fallback">
                                    <Icon name="disc" size={64} />
                                </div>
                            {/if}
                        </div>
                        <div class="hero-info">
                            <span class="hero-eyebrow">
                                {currentAlbumDetail.release_type || "ALBUM"}
                                {#if findLocalAlbumId(currentAlbumDetail.title) !== undefined}
                                    <span class="library-badge">
                                        <Icon name="check" size={12} />
                                        {$_("discover.inLibrary")}
                                    </span>
                                {/if}
                            </span>
                            <h1 class="hero-title">
                                {currentAlbumDetail.title}
                            </h1>
                            <div class="hero-meta-line">
                                <button
                                    class="artist-pill-btn"
                                    on:click={() =>
                                        navigateToArtist(
                                            currentAlbumDetail?.artist_id,
                                            currentAlbumDetail?.artist,
                                            currentAlbumDetail?.provider_id,
                                        )}
                                >
                                    <Icon name="user" size={14} />
                                    <span>{currentAlbumDetail.artist}</span>
                                    <Icon name="chevron-right" size={14} />
                                </button>
                                {#if currentAlbumDetail.year}
                                    <span class="meta-dot">•</span>
                                    <span>{currentAlbumDetail.year}</span>
                                {/if}
                                {#if currentAlbumDetail.tracks && currentAlbumDetail.tracks.length > 0}
                                    <span class="meta-dot">•</span>
                                    <span
                                        >{currentAlbumDetail.tracks
                                            .length} songs</span
                                    >
                                {/if}
                            </div>

                            <!-- Actions -->
                            <div class="hero-actions">
                                {#if currentAlbumDetail.tracks && currentAlbumDetail.tracks.length > 0}
                                    <button
                                        class="btn-primary"
                                        on:click={() =>
                                            currentAlbumDetail?.tracks &&
                                            playSong(
                                                currentAlbumDetail.tracks[0],
                                                currentAlbumDetail.tracks,
                                                currentAlbumDetail.title,
                                                currentAlbumDetail.cover_url,
                                            )}
                                    >
                                        <Icon name="play" size={18} />
                                        {$_("discover.playAll")}
                                    </button>
                                    <button
                                        class="btn-secondary"
                                        on:click={() =>
                                            currentAlbumDetail &&
                                            saveAlbumToLibrary(currentAlbumDetail)}
                                        disabled={isSavingAlbum}
                                        title={isCurrentAlbumSaved ? "Album saved in library" : "Save all tracks in album to library"}
                                    >
                                        {#if isSavingAlbum}
                                            <div class="spinner-tiny"></div>
                                            <span>Saving album...</span>
                                        {:else if isCurrentAlbumSaved}
                                            <Icon name="heart-filled" size={16} />
                                            <span>In library</span>
                                        {:else}
                                            <Icon name="heart" size={16} />
                                            <span>Save Album</span>
                                        {/if}
                                    </button>
                                {/if}
                                {#if findLocalAlbumId(currentAlbumDetail.title) !== undefined}
                                    <button
                                        class="btn-secondary"
                                        on:click={() => {
                                            const id = findLocalAlbumId(
                                                currentAlbumDetail?.title,
                                            );
                                            if (id !== undefined)
                                                goToAlbumDetail(id);
                                        }}
                                    >
                                        <Icon name="library" size={16} />
                                        {$_("main.goToAlbum")}
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- Album Tracklist -->
                    <div class="detail-tracklist-section">
                        <h3>{$_("common.tracks")}</h3>
                        {#if currentAlbumDetail.tracks && currentAlbumDetail.tracks.length > 0}
                            <div class="song-table full-table">
                                {#each currentAlbumDetail.tracks as track, idx}
                                    <div
                                        class="song-row"
                                        class:playing={isCurrentTrackPlaying(
                                            track,
                                        )}
                                        role="button"
                                        tabindex="0"
                                        on:click={(e) => {
                                            if ($isMobile && !(e.target as HTMLElement).closest("button, .song-col-art") && currentAlbumDetail?.tracks) {
                                                playSong(
                                                    track,
                                                    currentAlbumDetail.tracks,
                                                    currentAlbumDetail.title,
                                                    currentAlbumDetail.cover_url,
                                                );
                                            }
                                        }}
                                        on:keydown={(e) =>
                                            handleSongRowKeydown(e, () => {
                                                if (currentAlbumDetail?.tracks) {
                                                    playSong(
                                                        track,
                                                        currentAlbumDetail.tracks,
                                                        currentAlbumDetail.title,
                                                        currentAlbumDetail.cover_url,
                                                    );
                                                }
                                            })}
                                        on:dblclick={() =>
                                            currentAlbumDetail?.tracks &&
                                            playSong(
                                                track,
                                                currentAlbumDetail.tracks,
                                                currentAlbumDetail.title,
                                                currentAlbumDetail.cover_url,
                                            )}
                                    >
                                        <div class="song-col-num">
                                            {track.track_number || idx + 1}
                                        </div>
                                        <div class="song-col-play">
                                            <button
                                                class="play-icon-btn"
                                                on:click={() =>
                                                    currentAlbumDetail?.tracks &&
                                                    playSong(
                                                        track,
                                                        currentAlbumDetail.tracks,
                                                        currentAlbumDetail.title,
                                                        currentAlbumDetail.cover_url,
                                                    )}
                                                title={$_("discover.play")}
                                            >
                                                {#if loadingStreamId === (track.id || track.external_id || track.title)}
                                                    <div
                                                        class="spinner-tiny"
                                                    ></div>
                                                {:else if isCurrentTrackPlaying(track)}
                                                    <Icon
                                                        name="pause"
                                                        size={16}
                                                    />
                                                {:else}
                                                    <Icon
                                                        name="play"
                                                        size={16}
                                                    />
                                                {/if}
                                            </button>
                                        </div>
                                        <div class="song-col-info">
                                            <span class="song-title"
                                                >{track.title}</span
                                            >
                                            <button
                                                class="song-artist link-btn"
                                                on:click={() =>
                                                    navigateToArtist(
                                                        track.artist_id ||
                                                            currentAlbumDetail?.artist_id,
                                                        track.artist ||
                                                            currentAlbumDetail?.artist,
                                                        track.provider_id ||
                                                            currentAlbumDetail?.provider_id,
                                                    )}
                                            >
                                                {track.artist ||
                                                    currentAlbumDetail.artist}
                                            </button>
                                        </div>
                                        <div class="song-col-love">
                                            <button
                                                class="love-btn"
                                                class:saved={isTrackSaved(track)}
                                                on:click|stopPropagation={() =>
                                                    saveTrackToLibrary(
                                                        track,
                                                        currentAlbumDetail?.title,
                                                        currentAlbumDetail?.cover_url,
                                                        currentAlbumDetail?.artist,
                                                    )}
                                                title={isTrackSaved(track) ? "In library" : "Save to library"}
                                                aria-label={isTrackSaved(track) ? "In library" : "Save to library"}
                                            >
                                                {#if savingId === discoverTrackKey(track)}
                                                    <div class="spinner-tiny"></div>
                                                {:else}
                                                    <Icon name={isTrackSaved(track) ? "heart-filled" : "heart"} size={14} />
                                                {/if}
                                            </button>
                                        </div>
                                        <div class="song-col-dur">
                                            {track.duration
                                                ? formatDuration(track.duration)
                                                : "--:--"}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <p class="hint">
                                {$_("discover.noTracksForRelease")}
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- 3. ARTIST DETAIL VIEW (Song > Album > Artist) -->
        {:else if currentNav.type === "artist"}
            <div class="detail-page" in:fade={{ duration: 180 }}>
                {#if artistLoading}
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>{$_("discover.loadingArtistInfo")}</p>
                    </div>
                {:else if currentArtistDetail}
                    <!-- Artist Header Banner -->
                    <div class="hero-header artist-hero">
                        <div class="hero-avatar">
                            {#if currentArtistDetail.avatar_url}
                                <img
                                    src={currentArtistDetail.avatar_url}
                                    alt={currentArtistDetail.name}
                                />
                            {:else}
                                <div class="avatar-fallback">
                                    <span
                                        >{artistInitial(
                                            currentArtistDetail.name,
                                        )}</span
                                    >
                                </div>
                            {/if}
                        </div>
                        <div class="hero-info">
                            <span class="hero-eyebrow">
                                {$_("discover.tabArtists")}
                                {#if isArtistInLibrary(currentArtistDetail.name)}
                                    <span class="library-badge">
                                        <Icon name="check" size={12} />
                                        {$_("discover.inLibrary")}
                                    </span>
                                {/if}
                            </span>
                            <h1 class="hero-title">
                                {currentArtistDetail.name}
                            </h1>
                            <div class="hero-meta-line">
                                {#if currentArtistDetail.country}
                                    <span class="meta-item">
                                        <Icon name="globe" size={14} />
                                        {currentArtistDetail.country}
                                    </span>
                                    <span class="meta-dot">•</span>
                                {/if}
                                {#if currentArtistDetail.active_years}
                                    <span class="meta-item">
                                        <Icon name="clock" size={14} />
                                        {currentArtistDetail.active_years}
                                    </span>
                                {/if}
                            </div>

                            {#if currentArtistDetail.genres && currentArtistDetail.genres.length > 0}
                                <div class="genre-pills hero-genres">
                                    {#each currentArtistDetail.genres as g}
                                        <span class="genre-pill">{g}</span>
                                    {/each}
                                </div>
                            {/if}

                            <div class="hero-actions">
                                {#if currentArtistDetail.tracks && currentArtistDetail.tracks.length > 0}
                                    <button
                                        class="btn-primary"
                                        on:click={() =>
                                            currentArtistDetail?.tracks &&
                                            playSong(
                                                currentArtistDetail.tracks[0],
                                                currentArtistDetail.tracks,
                                                undefined,
                                                currentArtistDetail.avatar_url,
                                            )}
                                    >
                                        <Icon name="play" size={18} />
                                        {$_("discover.play")}
                                        {$_("discover.topSongs")}
                                    </button>
                                {/if}
                                {#if isArtistInLibrary(currentArtistDetail.name)}
                                    <button
                                        class="btn-secondary"
                                        on:click={() =>
                                            currentArtistDetail?.name &&
                                            goToArtistDetail(
                                                currentArtistDetail.name,
                                            )}
                                    >
                                        <Icon name="library" size={16} />
                                        {$_("artist.goToArtist")}
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- Biography Section if available -->
                    {#if currentArtistDetail.bio}
                        <section class="bio-section">
                            <h3>{$_("discover.biography")}</h3>
                            <p class="bio-text">{currentArtistDetail.bio}</p>
                            {#if currentArtistDetail.wikipedia_url}
                                <a
                                    class="wiki-link"
                                    href={currentArtistDetail.wikipedia_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {$_("discover.readMoreOnWikipedia")}
                                    <Icon name="external-link" size={13} />
                                </a>
                            {/if}
                        </section>
                    {/if}

                    <!-- Top Tracks Section -->
                    {#if currentArtistDetail.tracks && currentArtistDetail.tracks.length > 0}
                        <section class="section-block">
                            <div class="section-header">
                                <h3>{$_("discover.topSongs")}</h3>
                            </div>
                            <div class="song-table full-table">
                                {#each currentArtistDetail.tracks.slice(0, 10) as track, idx}
                                    <div
                                        class="song-row"
                                        class:playing={isCurrentTrackPlaying(
                                            track,
                                        )}
                                        role="button"
                                        tabindex="0"
                                        on:click={(e) => {
                                            if ($isMobile && !(e.target as HTMLElement).closest("button, .song-col-art") && currentArtistDetail?.tracks) {
                                                playSong(
                                                    track,
                                                    currentArtistDetail.tracks,
                                                );
                                            }
                                        }}
                                        on:keydown={(e) =>
                                            handleSongRowKeydown(e, () => {
                                                if (currentArtistDetail?.tracks) {
                                                    playSong(
                                                        track,
                                                        currentArtistDetail.tracks,
                                                    );
                                                }
                                            })}
                                        on:dblclick={() =>
                                            currentArtistDetail?.tracks &&
                                            playSong(
                                                track,
                                                currentArtistDetail.tracks,
                                            )}
                                    >
                                        <div class="song-col-num">{idx + 1}</div>
                                        <div class="song-col-play">
                                            <button
                                                class="play-icon-btn"
                                                on:click={() =>
                                                    currentArtistDetail?.tracks &&
                                                    playSong(
                                                        track,
                                                        currentArtistDetail.tracks,
                                                    )}
                                                title={$_("discover.play")}
                                            >
                                                {#if loadingStreamId === (track.id || track.external_id || track.title)}
                                                    <div
                                                        class="spinner-tiny"
                                                    ></div>
                                                {:else if isCurrentTrackPlaying(track)}
                                                    <Icon
                                                        name="pause"
                                                        size={16}
                                                    />
                                                {:else}
                                                    <Icon
                                                        name="play"
                                                        size={16}
                                                    />
                                                {/if}
                                            </button>
                                        </div>
                                        <div class="song-col-info">
                                            <span class="song-title"
                                                >{track.title}</span
                                            >
                                            <span class="song-artist dim"
                                                >{track.artist}</span
                                            >
                                        </div>
                                        <div class="song-col-album">
                                            {#if track.album}
                                                <button
                                                    class="link-btn truncate"
                                                    on:click={() =>
                                                        navigateToAlbum(
                                                            track.album_id,
                                                            track.album,
                                                            track.artist,
                                                            track.provider_id,
                                                        )}
                                                >
                                                    {track.album}
                                                </button>
                                            {:else}
                                                <span class="dim">-</span>
                                            {/if}
                                        </div>
                                        <div class="song-col-love">
                                            <button
                                                class="love-btn"
                                                class:saved={isTrackSaved(track)}
                                                on:click|stopPropagation={() =>
                                                    saveTrackToLibrary(
                                                        track,
                                                        track.album,
                                                        track.cover_url || currentArtistDetail?.avatar_url,
                                                        track.artist || currentArtistDetail?.name,
                                                    )}
                                                title={isTrackSaved(track) ? "In library" : "Save to library"}
                                                aria-label={isTrackSaved(track) ? "In library" : "Save to library"}
                                            >
                                                {#if savingId === discoverTrackKey(track)}
                                                    <div class="spinner-tiny"></div>
                                                {:else}
                                                    <Icon name={isTrackSaved(track) ? "heart-filled" : "heart"} size={14} />
                                                {/if}
                                            </button>
                                        </div>
                                        <div class="song-col-dur">
                                            {track.duration
                                                ? formatDuration(track.duration)
                                                : "--:--"}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {/if}

                    <!-- Discography Section -->
                    {#if currentArtistDetail.albums && currentArtistDetail.albums.length > 0}
                        <section class="section-block">
                            <div class="section-header">
                                <h3>{$_("discover.discography")}</h3>
                                {#if currentArtistDetail.albums.length > filteredDiscography.length || showAllReleaseTypes}
                                    <button
                                        class="filter-toggle-btn"
                                        on:click={() =>
                                            (showAllReleaseTypes =
                                                !showAllReleaseTypes)}
                                    >
                                        {showAllReleaseTypes
                                            ? $_("discover.albumsAndSinglesOnly")
                                            : $_("discover.showAllCount", {
                                                  values: {
                                                      count: currentArtistDetail
                                                          .albums.length,
                                                  },
                                              })}
                                    </button>
                                {/if}
                            </div>
                            <div class="card-grid">
                                {#each filteredDiscography as album}
                                    <div class="card-wrapper">
                                        <MediaCard
                                            primaryText={album.title}
                                            secondaryText={album.year
                                                ? String(album.year)
                                                : album.release_type || ""}
                                            on:click={() =>
                                                navigateToAlbum(
                                                    album.id,
                                                    album.title,
                                                    album.artist ||
                                                        currentArtistDetail?.name,
                                                    album.provider_id,
                                                    album.cover_url,
                                                )}
                                            on:play={() =>
                                                navigateToAlbum(
                                                    album.id,
                                                    album.title,
                                                    album.artist ||
                                                        currentArtistDetail?.name,
                                                    album.provider_id,
                                                    album.cover_url,
                                                )}
                                        >
                                            <div
                                                slot="cover"
                                                class="release-cover"
                                            >
                                                {#if album.cover_url}
                                                    <img
                                                        src={album.cover_url}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                {:else}
                                                    <Icon
                                                        name="disc"
                                                        size={36}
                                                    />
                                                {/if}
                                            </div>
                                            <div
                                                slot="extra-info"
                                                class="card-meta"
                                            >
                                                {#if album.release_type}
                                                    <span
                                                        class="meta-chip type-chip"
                                                        >{album.release_type}</span
                                                    >
                                                {/if}
                                            </div>
                                        </MediaCard>
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {/if}
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    /* ── Root Layout ── */
    .discover-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        position: relative;
        background: transparent;
    }

    .discover-header {
        flex-shrink: 0;
        padding: var(--spacing-lg) var(--spacing-xl) var(--spacing-sm);
        background: transparent;
    }

    .header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-md);
        gap: 16px;
    }

    .header-title-group {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .discover-header h1 {
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.01em;
        margin: 0;
        color: var(--text-primary);
    }

    .header-subtitle {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin: 2px 0 0;
    }

    /* ── Provider Status Bar ── */
    .provider-status-bar {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .provider-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: var(--radius-full);
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .status-dot.online {
        background: var(--accent-primary);
    }

    .status-dot.offline {
        background: var(--accent-warning);
    }

    .provider-extra {
        color: var(--accent-primary);
        font-weight: bold;
        margin-left: 2px;
    }

    .provider-text.warning {
        color: var(--text-subdued);
    }

    /* ── Search Composite ── */
    .search-composite {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: var(--spacing-md);
    }

    .search-bar {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        min-height: 42px;
        padding: 0 14px;
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .search-bar:focus-within {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--accent-subtle);
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
        font-size: var(--font-size-md);
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
    }

    .clear-btn:hover {
        color: var(--text-primary);
    }

    .provider-select-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        min-height: 42px;
        padding: 0 12px;
    }

    .provider-select-wrapper:focus-within {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px var(--accent-subtle);
    }

    .select-icon {
        color: var(--accent-primary);
        margin-right: 6px;
        pointer-events: none;
    }

    .provider-select {
        background: transparent;
        border: none;
        color: var(--text-primary);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        padding: 10px 6px;
        cursor: pointer;
        outline: none;
    }

    .provider-select option {
        background: var(--bg-elevated);
        color: var(--text-primary);
    }

    /* ── Tab Bar ── */
    .tab-bar {
        display: flex;
        gap: var(--spacing-xs);
        border-top: 1px solid transparent;
    }

    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 42px;
        padding: 8px var(--spacing-md) 10px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
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

    .tab-badge {
        font-size: var(--font-size-xs);
        background: var(--bg-highlight);
        color: var(--text-secondary);
        padding: 1px 6px;
        border-radius: var(--radius-full);
    }

    /* ── Breadcrumb Bar ── */
    .breadcrumb-bar {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 8px 0 10px;
    }

    .back-nav-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast);
    }

    .back-nav-btn:hover {
        background: var(--bg-highlight);
        border-color: var(--accent-primary);
    }

    .breadcrumb-trail {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow-x: auto;
    }

    .breadcrumb-sep {
        color: var(--text-subdued);
        font-size: var(--font-size-sm);
    }

    .breadcrumb-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        padding: 3px 6px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
    }

    .breadcrumb-item:hover {
        color: var(--text-primary);
        background: var(--bg-highlight);
    }

    .breadcrumb-item.active {
        color: var(--accent-primary);
        font-weight: var(--font-weight-semibold);
    }

    /* ── Content Area ── */
    .discover-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-lg) var(--spacing-xl) 60px;
    }

    /* ── States ── */
    .empty-state,
    .loading-state,
    .error-state,
    .no-results {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 80px 20px;
        color: var(--text-secondary);
    }

    .empty-state p,
    .loading-state p,
    .error-state p,
    .no-results p {
        font-size: var(--font-size-lg);
        margin: 16px 0 6px;
        color: var(--text-primary);
    }

    .hint {
        font-size: var(--font-size-base);
        color: var(--text-subdued);
    }

    .spinner {
        width: 34px;
        height: 34px;
        border: 3px solid var(--border-color);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    .spinner-tiny {
        width: 14px;
        height: 14px;
        border: 2px solid var(--border-color);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Sections & Tables ── */
    .section-block {
        margin-bottom: var(--spacing-xl);
    }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-md);
    }

    .section-header h2,
    .section-header h3 {
        font-size: 1.4rem;
        font-weight: var(--font-weight-bold);
        margin: 0;
        color: var(--text-primary);
    }

    .view-all-link,
    .filter-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--accent-primary);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
    }

    .view-all-link:hover,
    .filter-toggle-btn:hover {
        text-decoration: underline;
    }

    /* ── Song Table (Song > Album > Artist Navigation) ── */
    .song-table {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        overflow: hidden;
    }

    .song-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 14px;
        border-bottom: 1px solid var(--border-color);
        transition: background var(--transition-fast);
        user-select: none;
    }

    .song-row:last-child {
        border-bottom: none;
    }

    .song-row:hover {
        background: var(--bg-highlight);
    }

    .song-row:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: -2px;
        background: var(--bg-highlight);
    }

    .song-row.playing {
        background: var(--accent-subtle);
    }

    .song-col-num {
        width: 28px;
        text-align: center;
        font-size: var(--font-size-sm);
        color: var(--text-subdued);
    }

    .song-col-play {
        width: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .play-icon-btn {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
            background var(--transition-fast),
            transform var(--transition-fast);
    }

    .play-icon-btn:hover {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: var(--text-on-accent, #000);
        transform: scale(1.06);
    }

    .song-col-art {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        display: block;
    }

    .song-col-art:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: 2px;
    }

    .song-col-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        background: var(--bg-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .song-col-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .song-title {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .song-artist {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        text-align: left;
    }

    .link-btn {
        background: none;
        border: none;
        padding: 0;
        font-family: inherit;
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
    }

    .link-btn:hover {
        color: var(--accent-primary);
        text-decoration: underline;
    }

    .song-col-album {
        flex: 0.8;
        min-width: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }

    .song-col-dur {
        width: 50px;
        text-align: right;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }

    /* ── Save-to-Library Heart Button ── */
    .song-col-love {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        flex-shrink: 0;
    }

    .love-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-subdued);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast), transform var(--transition-fast);
        opacity: 0;
    }

    .song-row:hover .love-btn,
    .song-row:focus-within .love-btn,
    .love-btn:focus-visible {
        opacity: 1;
    }

    .love-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: 1px;
    }

    .love-btn:hover {
        color: var(--accent-primary);
        transform: scale(1.2);
    }

    .love-btn.saved {
        color: var(--accent-primary);
        opacity: 1;
    }

    .truncate {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .dim {
        color: var(--text-subdued);
    }

    /* ── Card Grid ── */
    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--spacing-lg);
    }

    .card-wrapper {
        display: contents;
    }

    .card-wrapper > :global(*) {
        cursor: pointer;
    }

    .release-cover {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-surface);
        color: var(--text-subdued);
    }

    .release-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .artist-avatar {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2.5rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-on-accent, #000);
        background: linear-gradient(
            135deg,
            var(--accent-primary) 0%,
            color-mix(in srgb, var(--accent-primary) 55%, var(--bg-elevated)) 100%
        );
    }

    .artist-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
    }

    .card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
    }

    .meta-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        background: var(--bg-surface);
        color: var(--text-secondary);
    }

    .type-chip {
        background: var(--accent-subtle);
        color: var(--accent-primary);
        font-weight: var(--font-weight-semibold);
    }

    /* ── Detail Page (Album & Artist) ── */
    .detail-page {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
    }

    .hero-header {
        display: flex;
        gap: var(--spacing-lg);
        align-items: flex-end;
        padding: 24px;
        border-radius: var(--radius-lg);
        background: linear-gradient(
            180deg,
            var(--bg-surface) 0%,
            var(--bg-base) 100%
        );
    }

    .hero-cover,
    .hero-avatar {
        width: 200px;
        height: 200px;
        border-radius: var(--radius-md);
        overflow: hidden;
        flex-shrink: 0;
        box-shadow: var(--shadow-lg);
    }

    .hero-cover img,
    .hero-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .hero-avatar {
        border-radius: 50%;
    }

    .cover-fallback,
    .avatar-fallback {
        width: 100%;
        height: 100%;
        background: var(--bg-highlight);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .avatar-fallback {
        font-size: 3.5rem;
        color: var(--text-on-accent, #000);
        background: linear-gradient(
            135deg,
            var(--accent-primary) 0%,
            color-mix(in srgb, var(--accent-primary) 55%, var(--bg-elevated)) 100%
        );
    }

    .hero-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .hero-eyebrow {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .library-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-xs);
        background: var(--accent-subtle);
        color: var(--accent-primary);
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-weight: var(--font-weight-medium);
        letter-spacing: normal;
        text-transform: none;
    }

    .hero-title {
        font-size: 3rem;
        font-weight: var(--font-weight-bold);
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
        line-height: 1.1;
    }

    .hero-meta-line {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        flex-wrap: wrap;
    }

    .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .artist-pill-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: var(--radius-full);
        background: var(--bg-highlight);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast);
    }

    .artist-pill-btn:hover {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: var(--text-on-accent, #000);
    }

    .meta-dot {
        color: var(--text-subdued);
    }

    .genre-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .genre-pill {
        padding: 2px 10px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
    }

    .hero-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
    }

    .hero-actions :global(.btn-primary:disabled),
    .hero-actions :global(.btn-secondary:disabled) {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    /* ── Biography Section ── */
    .bio-section {
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: 20px;
    }

    .bio-section h3 {
        margin: 0 0 10px;
        font-size: var(--font-size-lg);
        color: var(--text-primary);
    }

    .bio-text {
        font-size: var(--font-size-base);
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 0 0 12px;
    }

    .wiki-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-base);
        color: var(--accent-primary);
        text-decoration: none;
    }

    .wiki-link:hover {
        text-decoration: underline;
    }

    /* ── Mobile ── */
    :global(html.layout-mobile) .discover-header {
        padding: var(--spacing-md) var(--spacing-md) 0;
    }

    :global(html.layout-mobile) .header-row {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-sm);
    }

    :global(html.layout-mobile) .discover-header h1 {
        font-size: var(--font-size-xl);
    }

    :global(html.layout-mobile) .search-composite {
        flex-direction: column;
        align-items: stretch;
        gap: var(--spacing-sm);
    }

    :global(html.layout-mobile) .search-composite select {
        width: 100%;
    }

    :global(html.layout-mobile) .discover-content {
        padding: var(--spacing-md);
    }

    :global(html.layout-mobile) .tab-bar {
        overflow-x: auto;
        white-space: nowrap;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
        scrollbar-width: none;
    }

    :global(html.layout-mobile) .tab-bar::-webkit-scrollbar {
        display: none;
    }

    :global(html.layout-mobile) .tab {
        min-height: 44px;
        padding: 10px var(--spacing-md);
    }

    :global(html.layout-mobile) .back-nav-btn,
    :global(html.layout-mobile) .clear-btn {
        min-width: 44px;
        min-height: 44px;
        justify-content: center;
    }

    :global(html.layout-mobile) .breadcrumb-item {
        min-height: 44px;
        min-width: 44px;
        padding: 8px 10px;
    }

    :global(html.layout-mobile) .play-icon-btn,
    :global(html.layout-mobile) .love-btn {
        opacity: 1;
        min-width: 44px;
        min-height: 44px;
    }

    :global(html.layout-mobile) .song-col-album,
    :global(html.layout-mobile) .song-col-dur,
    :global(html.layout-mobile) .song-col-num {
        display: none;
    }

    :global(html.layout-mobile) .song-row {
        gap: 10px;
        min-height: 52px;
        padding: 8px 10px;
    }

    :global(html.layout-mobile) .card-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }

    :global(html.layout-mobile) .hero-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: var(--spacing-md);
        gap: var(--spacing-md);
    }

    :global(html.layout-mobile) .hero-cover,
    :global(html.layout-mobile) .hero-avatar {
        width: 160px;
        height: 160px;
    }

    :global(html.layout-mobile) .hero-meta-line {
        justify-content: center;
    }

    :global(html.layout-mobile) .hero-title {
        font-size: var(--font-size-2xl);
    }

    :global(html.layout-mobile) .header-subtitle {
        font-size: var(--font-size-xs);
    }

    /* ── Focus-Visible for D-Pad & Keyboard ── */
    .tab:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: -2px;
        color: var(--text-primary);
        background: var(--bg-elevated);
        border-radius: var(--radius-sm);
    }

    .back-nav-btn:focus-visible,
    .breadcrumb-item:focus-visible,
    .view-all-link:focus-visible,
    .filter-toggle-btn:focus-visible,
    .link-btn:focus-visible,
    .artist-pill-btn:focus-visible,
    .clear-btn:focus-visible,
    .wiki-link:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: 2px;
    }

    .play-icon-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: 1px;
    }

    /* ── Landscape Tablet & Smart TV Overrides ── */
    :global(html.layout-wide-mobile) .header-row,
    :global(html.layout-tv) .header-row {
        flex-direction: row;
        align-items: center;
    }

    :global(html.layout-wide-mobile) .search-composite,
    :global(html.layout-tv) .search-composite {
        flex-direction: row;
        align-items: center;
    }

    :global(html.layout-wide-mobile) .search-composite select,
    :global(html.layout-tv) .search-composite select {
        width: auto;
    }

    :global(html.layout-wide-mobile) .song-col-album,
    :global(html.layout-wide-mobile) .song-col-dur,
    :global(html.layout-wide-mobile) .song-col-num,
    :global(html.layout-tv) .song-col-album,
    :global(html.layout-tv) .song-col-dur,
    :global(html.layout-tv) .song-col-num {
        display: block;
    }

    :global(html.layout-wide-mobile) .card-grid {
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--spacing-md);
    }

    :global(html.layout-tv) .card-grid {
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--spacing-lg);
    }

    :global(html.layout-wide-mobile) .hero-header,
    :global(html.layout-tv) .hero-header {
        flex-direction: row;
        align-items: flex-end;
        text-align: left;
        padding: 24px;
        gap: var(--spacing-lg);
    }

    :global(html.layout-wide-mobile) .hero-meta-line,
    :global(html.layout-tv) .hero-meta-line {
        justify-content: flex-start;
    }

    :global(html.layout-tv) .hero-cover,
    :global(html.layout-tv) .hero-avatar {
        width: 200px;
        height: 200px;
    }

    :global(html.layout-tv) .discover-header,
    :global(html.layout-tv) .discover-content {
        padding-left: max(var(--spacing-xl), var(--tv-overscan-x, 24px));
        padding-right: max(var(--spacing-xl), var(--tv-overscan-x, 24px));
    }
</style>
