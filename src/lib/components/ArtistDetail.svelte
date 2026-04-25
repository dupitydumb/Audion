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
    import { playTracks } from "$lib/stores/player";
    import {
        goToArtists,
        goToAlbumDetail,
        goToArtistDetail,
    } from "$lib/stores/view";
    import AlbumGrid from "./AlbumGrid.svelte";
    import TrackList from "./TrackList.svelte";
    import MediaCard from "./MediaCard.svelte";
    import {
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";
    import { contextMenu } from "$lib/stores/ui";
    import { confirm, prompt } from "$lib/stores/dialogs";
    import {
        pinnedItems,
        pinItem,
        unpinItem,
        isPinned
    } from "$lib/stores/pinned";
    import { setCustomArtwork } from "$lib/stores/customArtwork";
    import { _, locale } from "svelte-i18n";

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

    function handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        const pinned = isPinned("artist", artistName, $pinnedItems);
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: pinned ? $_('contextMenu.unpinFromTop') : $_('contextMenu.pinToTop'),
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 2L4.5 9L9 9L9 22L15 22L15 9L19.5 9L12 2Z"/></svg>`,
                    action: () => {
                        if (pinned) {
                            unpinItem("artist", artistName);
                        } else {
                            pinItem("artist", artistName);
                        }
                    },
                },
                { type: "separator" },
                {
                    label: $_('contextMenu.changeArtwork'),
                    submenu: [
                        {
                            label: $_('contextMenu.fromFile'),
                            action: () => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.onchange = (e) => {
                                    const file = (e.target as HTMLInputElement)
                                        .files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onload = () => {
                                            const result =
                                                reader.result as string;
                                            setCustomArtwork(
                                                "artist",
                                                artistName,
                                                result,
                                            );
                                            addToast(
                                                "Artist artwork updated",
                                                "success",
                                            );
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                };
                                input.click();
                            },
                        },
                        {
                            label: $_('contextMenu.fromUrl'),
                            action: async () => {
                                const url = await prompt("Enter image URL:", {
                                    title: "Change Artwork",
                                    placeholder:
                                        "https://example.com/image.jpg",
                                });
                                if (url && url.trim()) {
                                    setCustomArtwork(
                                        "artist",
                                        artistName,
                                        url.trim(),
                                    );
                                    addToast(
                                        "Artist artwork updated",
                                        "success",
                                    );
                                }
                            },
                        },
                    ],
                },
            ],
        });
    }
</script>

<div class="artist-detail">
    {#if loading}
        <div class="loading">
            <div class="spinner"></div>
            <span>{$_('artist.loading')}</span>
        </div>
    {:else}
        <header
            class="artist-header"
            on:contextmenu={handleContextMenu}
            role="banner"
        >
            <button
                class="back-btn"
                on:click={goToArtists}
                aria-label="Go back to artists"
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
            <div class="artist-avatar">
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
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
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
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="24"
                                    height="24"
                                >
                                    <path
                                        d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
                                    />
                                </svg>
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
                <AlbumGrid {albums} />
            {:else if activeTab === "tracks"}
                <TrackList
                    {tracks}
                    showAlbum={true}
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
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="16"
                                    height="16"
                                >
                                    <path
                                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z"
                                    />
                                </svg>
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
                            <div class="about-loading">
                                <div class="spinner"></div>
                                <span>{$_('artist.loadingDiscography')}</span>
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
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "single"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "ep"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "live"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "compilation"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"
                                                            /></svg
                                                        >
                                                    {:else if item.release_type.toLowerCase() === "soundtrack"}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"
                                                            /></svg
                                                        >
                                                    {:else}
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            fill="currentColor"
                                                            width="28"
                                                            height="28"
                                                            ><path
                                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                                            /></svg
                                                        >
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
        display: flex;
        gap: var(--spacing-lg);
        padding: var(--spacing-lg);
        background: linear-gradient(
            180deg,
            var(--bg-surface) 0%,
            var(--bg-base) 100%
        );
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
        font-weight: 700;
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
        min-width: 0;
    }

    .artist-type {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-primary);
    }

    .artist-name {
        font-size: 3rem;
        font-weight: 700;
        line-height: 1.1;
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
    }

    .artist-meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 0.875rem;
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
        font-size: 1rem;
        padding: var(--spacing-sm) var(--spacing-xl);
    }

    .tabs {
        display: flex;
        gap: var(--spacing-md);
        padding: 0 var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
    }

    .tab {
        padding: var(--spacing-md);
        font-size: 0.875rem;
        font-weight: 600;
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
        flex: 1;
        overflow-y: auto;
    }

    .btn-secondary {
        background-color: transparent;
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        transition: all var(--transition-fast);
        padding: var(--spacing-sm) var(--spacing-xl);
        border-radius: var(--radius-full);
        font-size: 1rem;
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
        font-size: 0.875rem;
    }

    .about-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .about-heading {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--text-subdued);
        margin: 0;
    }

    .genre-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .genre-pill {
        background: rgba(var(--accent-primary-rgb, 30 215 96) / 0.12);
        border: 1px solid rgba(var(--accent-primary-rgb, 30 215 96) / 0.3);
        color: var(--accent-primary);
        padding: 4px 14px;
        border-radius: var(--radius-full);
        font-size: 0.8rem;
        font-weight: 600;
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
        gap: 6px;
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-full);
        padding: 6px 16px;
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
        font-size: 0.875rem;
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
        font-weight: 700;
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
        padding: 4px 14px;
        font-size: 0.72rem;
        font-weight: 600;
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
    @media (max-width: 768px) {
        .artist-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: calc(var(--safe-area-top) + var(--spacing-md))
                var(--spacing-md) var(--spacing-md);
            gap: var(--spacing-md);
        }

        .back-btn {
            top: calc(var(--safe-area-top) + var(--spacing-sm));
            left: var(--spacing-sm);
        }

        .artist-avatar {
            width: 120px;
            height: 120px;
        }

        .artist-initial {
            font-size: 2.5rem;
        }

        .artist-info {
            align-items: center;
        }

        .artist-name {
            font-size: 1.5rem;
            word-break: break-word;
        }

        .artist-meta {
            flex-wrap: wrap;
            justify-content: center;
            margin-bottom: var(--spacing-md);
        }

        .artist-actions {
            flex-wrap: wrap;
            justify-content: center;
        }

        .play-all-btn,
        .btn-secondary {
            padding: var(--spacing-sm) var(--spacing-lg);
            font-size: 0.875rem;
            min-height: 44px;
        }

        .tabs {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }

        .tab {
            min-height: 44px;
            white-space: nowrap;
        }

        .artist-content {
            padding-bottom: calc(
                var(--mobile-bottom-inset) + var(--spacing-md)
            );
        }
    }
</style>
