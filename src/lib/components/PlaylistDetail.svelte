<script lang="ts">
    import { onMount } from "svelte";
    import type { Track, Playlist } from "$lib/api/tauri";
    import {
        getPlaylistTracks,
        deletePlaylist,
        renamePlaylist,
        formatDuration,
    } from "$lib/api/tauri";
    import { confirm } from "$lib/stores/dialogs";
    import { contextMenu } from "$lib/stores/ui";
    import { playTracks, addToQueue } from "$lib/stores/player";
    import { goToPlaylists } from "$lib/stores/view";
    import { loadPlaylists, playlists } from "$lib/stores/library";
    import TrackList from "./TrackList.svelte";
    import {
        playlistCovers,
        setPlaylistCover,
        removePlaylistCover,
    } from "$lib/stores/playlistCovers";
    import {
        canDownload,
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";

    export let playlistId: number;

    let playlist: Playlist | null = null;
    let tracks: Track[] = [];
    let loading = true;
    let isEditing = false;
    let editName = "";
    let coverInput: HTMLInputElement;

    function initialsFromName(name: string) {
        if (!name) return "PL";
        const parts = name.trim().split(/\s+/);
        const picked = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
        return picked.join("") || name.slice(0, 2).toUpperCase();
    }

    function hashToColor(str: string) {
        let h = 0;
        for (let i = 0; i < str.length; i++)
            h = (h << 5) - h + str.charCodeAt(i);
        const hue = Math.abs(h) % 360;
        return `hsl(${hue} 30% 30%)`;
    }

    function generateSvgCover(name: string, size = 512) {
        const initials = initialsFromName(name);
        const bg = hashToColor(name || "playlist");
        const svg =
            `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
            `<rect width='100%' height='100%' fill='${bg}'/>` +
            `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Inter, system-ui, sans-serif' font-size='${Math.floor(size / 3)}' fill='white' font-weight='700'>${initials}</text>` +
            `</svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    }

    function getCoverSrc() {
        if (!playlist) return generateSvgCover("Playlist");
        const custom = $playlistCovers && $playlistCovers[playlist.id];
        if (custom) return custom;
        return generateSvgCover(playlist.name || "Playlist");
    }

    function handleCoverFile(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input?.files?.[0];
        if (!file || !playlist) return;
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            if (result && playlist) setPlaylistCover(playlist.id, result);
        };
        reader.readAsDataURL(file);
    }

    $: totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    $: playlist = $playlists.find((p) => p.id === playlistId) || null;

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
            // Refresh playlist tracks to update local_src status
            loadPlaylistData();
        } catch (error) {
            console.error("Download failed:", error);
            addToast("Download failed unexpectedly", "error");
        } finally {
            isDownloading = false;
            downloadProgress = "";
        }
    }

    async function loadPlaylistData() {
        loading = true;
        try {
            tracks = await getPlaylistTracks(playlistId);
        } catch (error) {
            console.error("Failed to load playlist:", error);
        } finally {
            loading = false;
        }
    }

    function handlePlayAll() {
        if (tracks.length > 0) {
            playTracks(tracks, 0);
        }
    }

    async function handleDelete() {
        if (
            !(await confirm(`Delete playlist "${playlist?.name}"?`, {
                title: "Delete Playlist",
                confirmLabel: "Delete",
                danger: true,
            }))
        )
            return;

        try {
            await deletePlaylist(playlistId);
            await loadPlaylists();
            goToPlaylists();
        } catch (error) {
            console.error("Failed to delete playlist:", error);
        }
    }

    function startEditing() {
        editName = playlist?.name || "";
        isEditing = true;
    }

    async function handleRename() {
        if (!editName.trim() || !playlist) return;

        try {
            await renamePlaylist(playlistId, editName.trim());
            await loadPlaylists();
            isEditing = false;
        } catch (error) {
            console.error("Failed to rename playlist:", error);
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            handleRename();
        } else if (e.key === "Escape") {
            isEditing = false;
        }
    }

    function handleHeaderContextMenu(e: MouseEvent) {
        e.preventDefault();
        if (!playlist) return;

        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Play",
                    action: handlePlayAll,
                    disabled: tracks.length === 0,
                },
                {
                    label: "Add to Queue",
                    action: () => {
                        if (tracks.length > 0) addToQueue(tracks);
                    },
                    disabled: tracks.length === 0,
                },
                { type: "separator" },
                {
                    label: "Rename",
                    action: startEditing,
                },
                {
                    label: "Change Cover",
                    action: () => coverInput?.click(),
                },
                { type: "separator" },
                {
                    label: "Delete Playlist",
                    action: handleDelete,
                },
            ],
        });
    }

    onMount(() => {
        loadPlaylistData();
    });

    // Reload when playlistId changes
    $: playlistId, loadPlaylistData();
</script>

<div class="playlist-detail">
    {#if loading}
        <div class="loading">
            <div class="spinner"></div>
            <span>Loading playlist...</span>
        </div>
    {:else if playlist}
        <header
            class="playlist-header"
            on:contextmenu={handleHeaderContextMenu}
        >
            <button class="back-btn" on:click={goToPlaylists}>
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
            <div class="playlist-cover">
                <img src={getCoverSrc()} alt="Playlist cover" />
                <input
                    type="file"
                    accept="image/*"
                    bind:this={coverInput}
                    on:change={(e) => handleCoverFile(e)}
                    style="display:none"
                />
            </div>
            <div class="playlist-info">
                <span class="playlist-type">Playlist</span>
                {#if isEditing}
                    <input
                        type="text"
                        bind:value={editName}
                        on:keydown={handleKeyDown}
                        on:blur={handleRename}
                        class="edit-input"
                        autofocus
                    />
                {:else}
                    <h1 class="playlist-title" on:dblclick={startEditing}>
                        {playlist.name}
                    </h1>
                {/if}
                <div class="playlist-meta">
                    <span>{tracks.length} songs</span>
                    <span class="separator">•</span>
                    <span>{formatDuration(totalDuration)}</span>
                </div>
                <div class="playlist-actions">
                    <button
                        class="btn-primary play-all-btn"
                        on:click={handlePlayAll}
                        disabled={tracks.length === 0}
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

                    {#if hasDownloadable || allDownloaded}
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

                    <button
                        class="btn-secondary"
                        on:click={() => coverInput?.click()}
                        title="Change cover"
                    >
                        Change Cover
                    </button>
                    {#if $playlistCovers && playlist && $playlistCovers[playlist.id]}
                        <button
                            class="icon-btn"
                            on:click={() => removePlaylistCover(playlist.id)}
                            title="Remove cover"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="20"
                                height="20"
                            >
                                <path
                                    d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                                />
                            </svg>
                        </button>
                    {/if}
                    <button
                        class="icon-btn"
                        on:click={startEditing}
                        title="Rename"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="20"
                            height="20"
                        >
                            <path
                                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                            />
                        </svg>
                    </button>
                    <button
                        class="icon-btn"
                        on:click={handleDelete}
                        title="Delete"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="20"
                            height="20"
                        >
                            <path
                                d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                            />
                        </svg>
                    </button>
                </div>
            </div>
        </header>

        <div class="playlist-tracks">
            {#if tracks.length > 0}
                <TrackList bind:tracks showAlbum={true} {playlistId} />
            {:else}
                <div class="empty-state">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="48"
                        height="48"
                    >
                        <path
                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                        />
                    </svg>
                    <h3>This playlist is empty</h3>
                    <p>Add songs from your library</p>
                </div>
            {/if}
        </div>
    {:else}
        <div class="not-found">
            <h2>Playlist not found</h2>
            <button class="btn-secondary" on:click={goToPlaylists}
                >Back to Playlists</button
            >
        </div>
    {/if}
</div>

<style>
    .playlist-detail {
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

    .playlist-header {
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

    .playlist-cover {
        width: 232px;
        height: 232px;
        border-radius: var(--radius-sm);
        background: linear-gradient(
            135deg,
            var(--bg-highlight) 0%,
            var(--bg-surface) 100%
        );
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--text-subdued);
        box-shadow: var(--shadow-lg);
    }

    .playlist-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .playlist-info {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-width: 0;
    }

    .playlist-type {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-primary);
    }

    .playlist-title {
        font-size: 3rem;
        font-weight: 700;
        line-height: 1.1;
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
        cursor: text;
    }

    .edit-input {
        font-size: 3rem;
        font-weight: 700;
        background-color: var(--bg-surface);
        border: 2px solid var(--accent-primary);
        border-radius: var(--radius-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        margin: var(--spacing-sm) 0;
        width: 100%;
    }

    .playlist-meta {
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

    .playlist-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .play-all-btn {
        font-size: 1rem;
        padding: var(--spacing-sm) var(--spacing-xl);
    }

    .playlist-tracks {
        flex: 1;
        overflow-y: auto;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--spacing-sm);
        color: var(--text-subdued);
        text-align: center;
    }

    .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: 0.875rem;
    }

    .btn-secondary.downloaded {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
        cursor: default;
    }

    .btn-secondary.downloaded:hover {
        transform: none;
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
