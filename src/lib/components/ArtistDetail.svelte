<script lang="ts">
    import { onMount } from "svelte";
    import type { Album, Track } from "$lib/api/tauri";
    import {
        getAlbumsByArtist,
        getTracksByArtist,
        formatDuration,
    } from "$lib/api/tauri";
    import { playTracks } from "$lib/stores/player";
    import { goToArtists, goToAlbumDetail } from "$lib/stores/view";
    import AlbumGrid from "./AlbumGrid.svelte";
    import TrackList from "./TrackList.svelte";
    import {
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";

    export let artistName: string;

    let albums: Album[] = [];
    let tracks: Track[] = [];
    let loading = true;
    let activeTab: "albums" | "tracks" = "albums";

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
</script>

<div class="artist-detail">
    {#if loading}
        <div class="loading">
            <div class="spinner"></div>
            <span>Loading artist...</span>
        </div>
    {:else}
        <header class="artist-header">
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
                <span class="artist-type">Artist</span>
                <h1 class="artist-name">{artistName}</h1>
                <div class="artist-meta">
                    <span>{albums.length} albums</span>
                    <span class="separator">•</span>
                    <span>{tracks.length} songs</span>
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
                        Play All
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
                                <span>Download All</span>
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
                Albums
            </button>
            <button
                class="tab"
                class:active={activeTab === "tracks"}
                on:click={() => (activeTab = "tracks")}
            >
                All Songs
            </button>
        </div>

        <div class="artist-content">
            {#if activeTab === "albums"}
                <AlbumGrid {albums} />
            {:else}
                <TrackList
                    {tracks}
                    showAlbum={true}
                    playbackContext={{
                        type: "artist",
                        artistName,
                        displayName: artistName,
                    }}
                />
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

    /* ── Mobile ── */
    @media (max-width: 768px) {
        .artist-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: var(--spacing-md);
            gap: var(--spacing-md);
        }

        .back-btn {
            top: var(--spacing-sm);
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
    }
</style>
