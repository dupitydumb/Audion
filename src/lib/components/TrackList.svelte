<script lang="ts">
    import type { Track } from "$lib/api/tauri";
    import {
        formatDuration,
        getAlbumArtSrc,
        addTrackToPlaylist,
        deleteTrack,
    } from "$lib/api/tauri";
    import {
        playTracks,
        currentTrack,
        isPlaying,
        addToQueue,
    } from "$lib/stores/player";
    import { contextMenu } from "$lib/stores/ui";
    import { albums, playlists, loadPlaylists } from "$lib/stores/library";
    import { pluginStore } from "$lib/stores/plugin-store";

    export let tracks: Track[] = [];
    export let title: string = "Tracks";
    export let showAlbum: boolean = true;

    // Filter out external tracks if their source plugin isn't enabled
    $: filteredTracks = tracks.filter((track) => {
        // Local tracks are always shown
        if (!track.source_type || track.source_type === "local") {
            return true;
        }
        // External tracks: check if a resolver is registered
        const runtime = pluginStore.getRuntime();
        if (!runtime) return false;
        return runtime.streamResolvers.has(track.source_type);
    });

    // Create a map of album_id to album for quick lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

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

    function handleTrackClick(index: number) {
        playTracks(filteredTracks, index);
    }

    function handleTrackDoubleClick(index: number) {
        playTracks(filteredTracks, index);
    }

    async function handleContextMenu(e: MouseEvent, index: number) {
        e.preventDefault();
        const track = tracks[index];

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

        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Play",
                    action: () => playTracks(filteredTracks, index),
                },
                { type: "separator" },
                {
                    label: "Add to Queue",
                    action: () => addToQueue([track]),
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
                { type: "separator" },
                {
                    label: "Delete from Library",
                    action: async () => {
                        try {
                            await deleteTrack(track.id);
                            // Remove from local tracks array
                            tracks = tracks.filter((t) => t.id !== track.id);
                        } catch (error) {
                            console.error("Failed to delete track:", error);
                        }
                    },
                },
            ],
        });
    }
</script>

<div class="track-list">
    <header class="list-header">
        <span class="col-num">#</span>
        <span class="col-cover"></span>
        <span class="col-title">Title</span>
        {#if showAlbum}
            <span class="col-album">Album</span>
        {/if}
        <span class="col-duration">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                    d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
                />
            </svg>
        </span>
    </header>

    <div class="list-body">
        {#each filteredTracks as track, index}
            {@const albumArt = getTrackAlbumArt(track)}
            <button
                class="track-row"
                class:playing={$currentTrack?.id === track.id}
                on:click={() => handleTrackClick(index)}
                on:dblclick={() => handleTrackDoubleClick(index)}
                on:contextmenu={(e) => handleContextMenu(e, index)}
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
                        {#if albumArt}
                            <img
                                src={albumArt}
                                alt="Album cover"
                                class="cover-image"
                                loading="lazy"
                                decoding="async"
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
                        {#if track.source_type && track.source_type !== "local"}
                            <span class="quality-tag stream-tag">S</span>
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
                    <span class="col-album truncate">{track.album || "-"}</span>
                {/if}
                <span class="col-duration"
                    >{formatDuration(track.duration)}</span
                >
            </button>
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
        z-index: 1;
    }

    .list-header.no-album {
        grid-template-columns: 40px 48px 1fr 80px;
    }

    .list-body {
        flex: 1;
        overflow-y: auto;
        padding-bottom: calc(var(--player-height) + var(--spacing-md));
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

    .quality-tag.stream-tag {
        color: var(--accent-primary);
        border-color: var(--accent-primary);
        background-color: color-mix(
            in srgb,
            var(--accent-primary),
            transparent 85%
        );
    }

    .track-artist {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .col-album {
        font-size: 0.875rem;
        color: var(--text-secondary);
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
</style>
