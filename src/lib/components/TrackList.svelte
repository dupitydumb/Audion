<script lang="ts">
    import type { Track } from "$lib/api/tauri";
    import {
        formatDuration,
        getAlbumArtSrc,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        deleteTrack,
    } from "$lib/api/tauri";
    import {
        playTracks,
        currentTrack,
        isPlaying,
        addToQueue,
    } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import {
        albums,
        playlists,
        loadPlaylists,
        loadLibrary,
    } from "$lib/stores/library";
    import { pluginStore } from "$lib/stores/plugin-store";
    import { goToAlbumDetail } from "$lib/stores/view";
    import {
        canDownload,
        downloadTrack,
        needsDownloadLocation,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";
    import { isOnline } from "$lib/stores/network";

    export let tracks: Track[] = [];
    export let title: string = "Tracks";
    export let showAlbum: boolean = true;
    export let isTidalAvailable: boolean = true;

    // Track images that failed to load
    let failedImages = new Set<string>();

    function isTrackUnavailable(track: Track): boolean {
        // Local tracks are always available
        if (!track.source_type || track.source_type === "local") return false;
        // Downloaded tracks are always available
        if (track.local_src) return false;

        // If offline and not downloaded/local, it's unavailable
        if (!$isOnline) return true;

        // Otherwise depends on plugin availability
        // Also check if we have a resolver for this source type
        if (!isTidalAvailable) return true;

        const runtime = pluginStore.getRuntime();
        if (!runtime) return true;
        return !runtime.streamResolvers.has(track.source_type);
    }

    // Filter out external tracks ONLY if we filter completely (old logic).
    // New logic: show all but mark unavailable.
    // However, the original filteredTracks logic was checking for resolver existence.
    // We should probably keep showing them but maybe mark them?
    // Let's modify filteredTracks to NOT filter based on resolvers,
    // but relies on the CSS class for visual indication.
    $: filteredTracks = tracks;

    // Create a map of album_id to album for quick lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

    // Sorting state
    type SortField = "title" | "album" | "duration" | null;
    let sortField: SortField = null;
    let sortDirection: "asc" | "desc" = "asc";

    function toggleSort(field: SortField) {
        if (sortField === field) {
            if (sortDirection === "asc") {
                sortDirection = "desc";
            } else {
                sortField = null;
                sortDirection = "asc";
            }
        } else {
            sortField = field;
            sortDirection = "asc";
        }
    }

    $: sortedTracks = (() => {
        if (!sortField) return filteredTracks;

        return [...filteredTracks].sort((a, b) => {
            let valA: any = "";
            let valB: any = "";

            switch (sortField) {
                case "title":
                    valA = (a.title || "").toLowerCase();
                    valB = (b.title || "").toLowerCase();
                    break;
                case "album":
                    valA = (a.album || "").toLowerCase();
                    valB = (b.album || "").toLowerCase();
                    break;
                case "duration":
                    valA = a.duration || 0;
                    valB = b.duration || 0;
                    break;
            }

            if (valA < valB) return sortDirection === "asc" ? -1 : 1;
            if (valA > valB) return sortDirection === "asc" ? 1 : -1;
            return 0;
        });
    })();

    function getTrackAlbumArt(track: Track): string | null {
        // For external tracks (Tidal, etc.), use cover_url directly
        if (track.cover_url) {
            return track.cover_url;
        }
        // For local tracks, get art from album
        if (!track.album_id) return null;
        const album = albumMap.get(track.album_id);
        return album ? getAlbumArtSrc(album.art_data) : null;
    }

    function handleTrackClick(index: number, track: Track) {
        if (isTrackUnavailable(track)) return;

        // Find the actual index in the filtered/sorted list
        const trackIndex = sortedTracks.findIndex((t) => t.id === track.id);
        if (trackIndex !== -1) {
            playTracks(sortedTracks, trackIndex);
        }
    }

    function handleTrackDoubleClick(index: number, track: Track) {
        if (isTrackUnavailable(track)) return;

        const trackIndex = sortedTracks.findIndex((t) => t.id === track.id);
        if (trackIndex !== -1) {
            playTracks(sortedTracks, trackIndex);
        }
    }

    export let playlistId: number | null = null;

    async function handleContextMenu(e: MouseEvent, index: number) {
        // Context menu still allowed for unavailable tracks? Probably yes (e.g. to delete)
        e.preventDefault();
        const track = sortedTracks[index];

        // Ensure playlists are loaded
        if ($playlists.length === 0) {
            await loadPlaylists();
        }

        // Build playlist submenu items
        const playlistItems = $playlists.map((playlist) => ({
            label: playlist.name,
            action: async () => {
                try {
                    await addTrackToPlaylist(playlist.id, track.id);
                } catch (error) {
                    console.error("Failed to add track to playlist:", error);
                }
            },
        }));

        const isUnavailable = isTrackUnavailable(track);

        const menuItems: any[] = [
            {
                label: "Play",
                action: () => {
                    const trackIndex = sortedTracks.findIndex(
                        (t) => t.id === track.id,
                    );
                    if (trackIndex !== -1) playTracks(sortedTracks, trackIndex);
                },
                disabled: isUnavailable,
            },
            { type: "separator" },
            {
                label: "Add to Queue",
                action: () => addToQueue([track]),
                disabled: isUnavailable,
            },
            { type: "separator" },
            {
                label: "Download",
                action: async () => {
                    if (needsDownloadLocation()) {
                        addToast(
                            "Please configure a download location in Settings first",
                            "error",
                        );
                        return;
                    }

                    addToast(`Downloading "${track.title}"...`, "info");
                    try {
                        await downloadTrack(track);
                        addToast(`Downloaded "${track.title}"`, "success");
                    } catch (error) {
                        console.error("Failed to download track:", error);
                        addToast(
                            `Failed to download "${track.title}"`,
                            "error",
                        );
                    }
                },
                disabled:
                    !canDownload(track) ||
                    (isUnavailable && !isTidalAvailable && !track.local_src), // Enable download if it's the only way to get it? No, if plugin off, can't download.
            },
            { type: "separator" },
            {
                label: "Add to Playlist",
                submenu:
                    playlistItems.length > 0
                        ? playlistItems
                        : [
                              {
                                  label: "No playlists",
                                  action: () => {},
                                  disabled: true,
                              },
                          ],
            },
        ];

        if (playlistId) {
            menuItems.push({
                label: "Remove from Playlist",
                action: async () => {
                    try {
                        await removeTrackFromPlaylist(playlistId, track.id);
                        tracks = tracks.filter((t) => t.id !== track.id);
                    } catch (error) {
                        console.error(
                            "Failed to remove track from playlist:",
                            error,
                        );
                    }
                },
            });
        }

        menuItems.push(
            { type: "separator" },
            {
                label: "Delete from Library",
                action: async () => {
                    try {
                        await deleteTrack(track.id);
                        // Refresh library to update album list (removes empty albums)
                        await loadLibrary();
                        // Also remove from local tracks array for immediate UI feedback
                        tracks = tracks.filter((t) => t.id !== track.id);
                    } catch (error) {
                        console.error("Failed to delete track:", error);
                    }
                },
            },
        );

        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: menuItems,
        });
    }
</script>

<div class="track-list">
    <header class="list-header" class:no-album={!showAlbum}>
        <!-- ... existing header ... -->
        <button class="col-header col-num" on:click={() => toggleSort(null)}>
            {#if sortField === null}
                <span class="sort-icon">#</span>
            {:else}
                #
            {/if}
        </button>
        <span class="col-header col-cover"></span>
        <button
            class="col-header col-title"
            on:click={() => toggleSort("title")}
        >
            Title
            {#if sortField === "title"}
                <span class="sort-icon"
                    >{sortDirection === "asc" ? "▲" : "▼"}</span
                >
            {/if}
        </button>
        {#if showAlbum}
            <button
                class="col-header col-album"
                on:click={() => toggleSort("album")}
            >
                Album
                {#if sortField === "album"}
                    <span class="sort-icon"
                        >{sortDirection === "asc" ? "▲" : "▼"}</span
                    >
                {/if}
            </button>
        {/if}
        <button
            class="col-header col-duration"
            on:click={() => toggleSort("duration")}
        >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                    d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
                />
            </svg>
            {#if sortField === "duration"}
                <span class="sort-icon"
                    >{sortDirection === "asc" ? "▲" : "▼"}</span
                >
            {/if}
        </button>
    </header>

    <div class="list-body">
        {#each sortedTracks as track, index}
            {@const albumArt = getTrackAlbumArt(track)}
            {@const unavailable = isTrackUnavailable(track)}
            <div
                class="track-row"
                class:playing={$currentTrack?.id === track.id}
                class:unavailable
                on:click={() => handleTrackClick(index, track)}
                on:dblclick={() => handleTrackDoubleClick(index, track)}
                on:contextmenu={(e) => handleContextMenu(e, index)}
                on:keydown={(e) =>
                    e.key === "Enter" && handleTrackClick(index, track)}
                role="button"
                tabindex="0"
            >
                <span class="col-num">
                    {#if $currentTrack?.id === track.id && $isPlaying}
                        <svg
                            class="playing-icon"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="14"
                            height="14"
                        >
                            <path
                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                            />
                        </svg>
                    {:else}
                        {index + 1}
                    {/if}
                </span>
                <span class="col-cover">
                    <div class="cover-wrapper">
                        {#if albumArt && !failedImages.has(albumArt)}
                            <img
                                src={albumArt}
                                alt="Album cover"
                                class="cover-image"
                                loading="lazy"
                                decoding="async"
                                on:error={() => {
                                    failedImages.add(albumArt);
                                    failedImages = failedImages;
                                }}
                            />
                        {:else}
                            <div class="cover-placeholder">
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
                        <div class="cover-play-overlay">
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="18"
                                height="18"
                            >
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    </div>
                </span>
                <span class="col-title">
                    <div class="title-row">
                        <span class="track-name truncate"
                            >{track.title || "Unknown Title"}</span
                        >

                        {#if !track.source_type || track.source_type === "local" || track.local_src}
                            <span class="downloaded-icon" title="Downloaded">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="14"
                                    height="14"
                                >
                                    <path
                                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                                    />
                                </svg>
                            </span>
                        {/if}

                        {#if track.format}
                            {@const formatUpper = track.format.toUpperCase()}
                            {@const displayFormat =
                                formatUpper.includes("HI_RES") ||
                                formatUpper.includes("HIRES")
                                    ? "HI-RES"
                                    : formatUpper.includes("LOSSLESS")
                                      ? "LOSSLESS"
                                      : formatUpper.replace("MPEG", "MP3")}
                            <span
                                class="quality-tag"
                                class:high-quality={formatUpper.includes(
                                    "FLAC",
                                ) ||
                                    formatUpper.includes("WAV") ||
                                    formatUpper.includes("HI_RES") ||
                                    formatUpper.includes("HIRES") ||
                                    (track.bitrate && track.bitrate >= 320)}
                            >
                                {displayFormat}
                            </span>
                        {/if}
                    </div>
                    <span class="track-artist truncate"
                        >{track.artist || "Unknown Artist"}</span
                    >
                </span>
                {#if showAlbum}
                    <button
                        class="col-album truncate"
                        on:click|stopPropagation={() => {
                            if (track.album_id) {
                                goToAlbumDetail(track.album_id);
                            }
                        }}
                        disabled={!track.album_id}>{track.album || "-"}</button
                    >
                {/if}
                <span class="col-duration"
                    >{formatDuration(track.duration)}</span
                >
            </div>
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
                <h3>No tracks found</h3>
                <p>Add a music folder to get started</p>
            </div>
        {/each}
    </div>
</div>

<style>
    .track-list {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .list-header {
        display: grid;
        grid-template-columns: 40px 48px 1fr 1fr 80px;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        padding-left: var(--spacing-lg);
        border-bottom: 1px solid var(--border-color);
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-subdued);
        position: sticky;
        top: 0;
        background-color: var(--bg-base);
        background-color: var(--bg-base);
        z-index: 1;
    }

    .col-header {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: color var(--transition-fast);
        user-select: none;
    }

    .col-header:hover {
        color: var(--text-primary);
    }

    .col-header.col-num {
        justify-content: center;
    }

    .col-header.col-title {
        justify-content: flex-start;
    }

    .col-header.col-album {
        justify-content: flex-start;
    }

    .col-header.col-duration {
        justify-content: flex-end;
    }

    .sort-icon {
        color: var(--accent-primary);
        font-size: 0.75rem;
    }

    .list-header.no-album {
        grid-template-columns: 40px 48px 1fr 80px;
    }

    .list-body {
        flex: 1;
        overflow-y: auto;
    }

    .track-row {
        display: grid;
        grid-template-columns: 40px 48px 1fr 1fr 80px;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        padding-left: var(--spacing-lg);
        align-items: center;
        border-radius: var(--radius-md);
        transition: all var(--transition-fast);
        width: 100%;
        text-align: left;
        min-height: 56px;
    }

    .track-row:hover {
        background-color: rgba(255, 255, 255, 0.1);
        cursor: pointer;
    }

    .track-row.playing {
        background-color: var(--bg-surface);
    }

    .track-row.playing .track-name {
        color: var(--accent-primary);
    }

    .col-num {
        text-align: center;
        color: var(--text-subdued);
        font-size: 0.875rem;
    }

    .track-row:hover .col-num:not(:has(.playing-icon)) {
        color: var(--text-primary);
    }

    .col-cover {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .cover-image {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        object-fit: cover;
    }

    .cover-placeholder {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-sm);
        background-color: var(--bg-highlight);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .cover-wrapper {
        position: relative;
        width: 40px;
        height: 40px;
    }

    .cover-play-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.6);
        border-radius: var(--radius-sm);
        opacity: 0;
        transition: opacity var(--transition-fast);
        color: var(--text-primary);
    }

    .track-row:hover .cover-play-overlay {
        opacity: 1;
    }

    .track-row.playing .cover-play-overlay {
        opacity: 0;
    }

    .playing-icon {
        color: var(--accent-primary);
        animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }

    .col-title {
        display: flex;
        flex-direction: column;
        min-width: 0;
        justify-content: center;
    }

    .title-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
    }

    .track-name {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .quality-tag {
        font-size: 0.6rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        background-color: var(--bg-highlight);
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        white-space: nowrap;
        flex-shrink: 0;
        opacity: 0.7;
        transition: opacity var(--transition-fast);
    }

    .track-row:hover .quality-tag {
        opacity: 1;
    }

    .quality-tag.high-quality {
        color: var(--accent-primary);
        border-color: var(--accent-primary);
        background-color: rgba(29, 185, 84, 0.15);
    }

    .track-artist {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .track-artist:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .col-album {
        font-size: 0.875rem;
        color: var(--text-secondary);
        text-align: left;
    }

    .col-album:hover {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .col-duration {
        text-align: right;
        font-size: 0.875rem;
        color: var(--text-subdued);
        display: flex;
        align-items: center;
        justify-content: flex-end;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: 0.875rem;
    }

    .track-row.unavailable {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .track-row.unavailable:hover {
        background-color: transparent;
    }

    .downloaded-icon {
        color: var(--accent-primary);
        display: flex;
        align-items: center;
        margin-left: var(--spacing-xs);
        flex-shrink: 0;
    }
</style>
