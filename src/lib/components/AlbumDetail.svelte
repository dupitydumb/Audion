<script lang="ts">
    import { onMount } from "svelte";
    import type { Album, Track } from "$lib/api/tauri";
    import {
        getAlbum,
        getTracksByAlbum,
        getAlbumArtSrc,
        formatDuration,
    } from "$lib/api/tauri";
    import { playTracks, currentTrack, isPlaying } from "$lib/stores/player";
    import { goToAlbums } from "$lib/stores/view";
    import { loadLibrary } from "$lib/stores/library";
    import TrackList from "./TrackList.svelte";
    import {
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";
    import { goto } from "$app/navigation";

    export let albumId: number;

    let album: Album | null = null;
    let tracks: Track[] = [];
    let loading = true;

    $: totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    async function loadAlbumData() {
        loading = true;
        try {
            const [albumData, trackData] = await Promise.all([
                getAlbum(albumId),
                getTracksByAlbum(albumId),
            ]);
            album = albumData;
            tracks = trackData;
        } catch (error) {
            console.error("Failed to load album:", error);
        } finally {
            loading = false;
        }
    }

    // Download state
    let isDownloading = false;
    let downloadProgress = "";

    // Check if we have downloadable tracks that are NOT yet downloaded
    $: downloadableTracks = tracks.filter((t) => {
        // Must be downloadable (streaming source) AND not have a local_src yet
        return hasDownloadableTracks([t]) && !t.local_src;
    });

    $: hasDownloadable = downloadableTracks.length > 0;

    // Check if everything that CAN be downloaded IS downloaded
    $: allDownloaded =
        tracks.length > 0 &&
        tracks.every((t) => {
            // If it's local, it's downloaded.
            if (!t.source_type || t.source_type === "local") return true;
            // If it's streaming, it must have local_src
            return !!t.local_src;
        });

    // Check if Tidal plugin is available (for hiding empty albums)
    import { pluginStore } from "$lib/stores/plugin-store";
    $: isTidalAvailable = $pluginStore.installed.some(
        (p) => p.name === "Tidal Search" && p.enabled,
    );
    $: shouldShowAlbum = tracks.length > 0 || isTidalAvailable;

    function formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    async function handleDownloadAll() {
        if (isDownloading) return;

        if (needsDownloadLocation()) {
            addToast(
                "Please configure a download location in Settings first",
                "error",
            );
            // Optionally redirect to settings
            return;
        }

        isDownloading = true;
        downloadProgress = "Starting...";

        try {
            const result = await downloadTracks(
                tracks,
                (progress: DownloadProgress) => {
                    const current = progress.current;
                    const total = progress.total;

                    if (progress.bytesTotal) {
                        const currentMB = formatBytes(
                            progress.bytesCurrent || 0,
                        );
                        const totalMB = formatBytes(progress.bytesTotal);
                        downloadProgress = `${current}/${total} (${currentMB}/${totalMB})`;
                    } else {
                        downloadProgress = `${current}/${total}`;
                    }
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

    function handlePlayAll() {
        if (tracks.length > 0) {
            playTracks(tracks, 0);
        }
    }

    onMount(() => {
        loadAlbumData();
    });

    // Reload when albumId changes
    $: albumId, loadAlbumData();

    import { contextMenu } from "$lib/stores/ui";
    import { deleteAlbum } from "$lib/api/tauri";

    function handleContextMenu(e: MouseEvent) {
        if (!album) return;
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Delete Album",
                    danger: true,
                    action: async () => {
                        try {
                            await deleteAlbum(album!.id);
                            await loadLibrary(); // Refresh library
                            goToAlbums(); // Go back to albums list
                        } catch (error) {
                            console.error("Failed to delete album:", error);
                        }
                    },
                },
            ],
        });
    }
</script>

<div class="album-detail">
    {#if loading}
        <div class="loading">
            <div class="spinner"></div>
            <span>Loading album...</span>
        </div>
    {:else if album && shouldShowAlbum}
        <header
            class="album-header"
            on:contextmenu={handleContextMenu}
            role="region"
            aria-label="Album Header"
        >
            <button
                class="back-btn"
                on:click={goToAlbums}
                aria-label="Back to Albums"
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
            <div class="album-cover">
                {#if album.art_data}
                    <img
                        src={getAlbumArtSrc(album.art_data)}
                        alt={album.name}
                        decoding="async"
                    />
                {:else if tracks.length > 0 && tracks[0].cover_url}
                    <!-- Fallback: use first track's cover_url (for external tracks) -->
                    <img
                        src={tracks[0].cover_url}
                        alt={album.name}
                        decoding="async"
                    />
                {:else}
                    <div class="album-cover-placeholder">
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="64"
                            height="64"
                        >
                            <path
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                            />
                        </svg>
                    </div>
                {/if}
            </div>
            <div class="album-info">
                <span class="album-type">Album</span>
                <h1 class="album-title">{album.name}</h1>
                <div class="album-meta">
                    <span class="album-artist"
                        >{album.artist || "Unknown Artist"}</span
                    >
                    <span class="separator">•</span>
                    <span>{tracks.length} songs</span>
                    <span class="separator">•</span>
                    <span>{formatDuration(totalDuration)}</span>
                </div>
                <div class="album-actions">
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
                        Play
                    </button>

                    {#if hasDownloadable}
                        <button
                            class="btn-secondary download-btn"
                            on:click={handleDownloadAll}
                            disabled={isDownloading ||
                                (!hasDownloadable && !allDownloaded) ||
                                allDownloaded}
                            class:downloaded={allDownloaded}
                        >
                            {#if isDownloading}
                                <div class="spinner-sm"></div>
                                <span>{downloadProgress}</span>
                            {:else if allDownloaded}
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
                                <span>Downloaded</span>
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
                                <span>Download</span>
                            {/if}
                        </button>
                    {/if}
                </div>
            </div>
        </header>

        <section class="track-list-section">
            <TrackList {tracks} {isTidalAvailable} showAlbum={false} />
        </section>
    {:else}
        <div class="not-found">
            <h2>Album not found</h2>
            <button class="btn-secondary" on:click={goToAlbums}
                >Back to Albums</button
            >
        </div>
    {/if}
</div>

<style>
    .album-detail {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .loading,
    .not-found {
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

    .album-header {
        display: flex;
        gap: var(--spacing-lg);
        padding: var(--spacing-lg);
        background: linear-gradient(
            180deg,
            var(--bg-surface) 0%,
            var(--bg-base) 100%
        );
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

    .album-cover {
        width: 232px;
        height: 232px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
        box-shadow: var(--shadow-lg);
    }

    .album-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .album-cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(
            135deg,
            var(--bg-surface) 0%,
            var(--bg-highlight) 100%
        );
        color: var(--text-subdued);
    }

    .album-info {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-width: 0;
    }

    .album-type {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-primary);
    }

    .album-title {
        font-size: 3rem;
        font-weight: 700;
        line-height: 1.1;
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
    }

    .album-meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-lg);
    }

    .album-artist {
        font-weight: 600;
        color: var(--text-primary);
    }

    .separator {
        color: var(--text-subdued);
    }

    .album-actions {
        display: flex;
        gap: var(--spacing-md);
    }

    .play-all-btn {
        font-size: 1rem;
        padding: var(--spacing-sm) var(--spacing-xl);
    }

    .album-tracks {
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

    .btn-secondary.downloaded {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
        cursor: default;
    }

    .btn-secondary.downloaded:hover {
        transform: none;
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
</style>
