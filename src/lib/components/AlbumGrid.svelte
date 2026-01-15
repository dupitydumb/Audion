<script lang="ts">
    import type { Album } from "$lib/api/tauri";
    import { getAlbumArtSrc } from "$lib/api/tauri";
    import { goToAlbumDetail } from "$lib/stores/view";
    import { tracks as allTracks, loadLibrary } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { deleteAlbum } from "$lib/api/tauri";
    import { addToQueue, playTracks } from "$lib/stores/player";

    export let albums: Album[] = [];

    // Get album cover - use track's cover_url for external tracks (same as TrackList)
    function getAlbumCover(album: Album): string | null {
        // First check if album has embedded art
        if (album.art_data) {
            return getAlbumArtSrc(album.art_data);
        }

        // Fallback: find a track with cover_url for this album
        const albumTrack = $allTracks.find(
            (t) => t.album_id === album.id && t.cover_url,
        );
        return albumTrack?.cover_url || null;
    }

    function handleAlbumClick(album: Album) {
        goToAlbumDetail(album.id);
    }

    function handleContextMenu(e: MouseEvent, album: Album) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Play",
                    action: () => {
                        // We need tracks to play.
                        // Since we don't have them here, we might need to fetch them or let the player store handle it if we had a "playAlbum" action.
                        // But playTracks takes Track[].
                        // Let's defer this or fetch simply.
                        // Actually easier: just navigate to it and auto-play? Or fetch.
                        // Let's implement fetch.
                        // For now let's just supporting Delete as requested.
                        handleAlbumClick(album);
                    },
                },
                { type: "separator" },
                {
                    label: "Delete Album",
                    danger: true,
                    action: async () => {
                        try {
                            await deleteAlbum(album.id);
                            await loadLibrary();
                        } catch (error) {
                            console.error("Failed to delete album:", error);
                        }
                    },
                },
            ],
        });
    }
</script>

<div class="album-grid">
    {#each albums as album}
        {@const coverSrc = getAlbumCover(album)}
        <button
            class="album-card"
            on:click={() => handleAlbumClick(album)}
            on:contextmenu={(e) => handleContextMenu(e, album)}
        >
            <div class="album-art">
                {#if coverSrc}
                    <img
                        src={coverSrc}
                        alt={album.name}
                        loading="lazy"
                        decoding="async"
                    />
                {:else}
                    <div class="album-art-placeholder">
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
                {/if}
                <div class="play-overlay">
                    <div class="play-button">
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            </div>
            <div class="album-info">
                <span class="album-name truncate">{album.name}</span>
                <span class="album-artist truncate"
                    >{album.artist || "Unknown Artist"}</span
                >
            </div>
        </button>
    {:else}
        <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                />
            </svg>
            <h3>No albums found</h3>
            <p>Add a music folder to see your albums</p>
        </div>
    {/each}
</div>

<style>
    .album-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--spacing-lg);
        padding: var(--spacing-md);
    }

    .album-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: left;
    }

    .album-card:hover {
        background-color: var(--bg-surface);
    }

    .album-art {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background-color: var(--bg-surface);
        margin-bottom: var(--spacing-md);
        box-shadow: var(--shadow-md);
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .album-art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background: linear-gradient(
            135deg,
            var(--bg-surface) 0%,
            var(--bg-highlight) 100%
        );
    }

    .play-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity var(--transition-fast);
    }

    .album-card:hover .play-overlay {
        opacity: 1;
    }

    .play-button {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-full);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translateY(8px);
        transition: transform var(--transition-fast);
        box-shadow: var(--shadow-lg);
    }

    .album-card:hover .play-button {
        transform: translateY(0);
    }

    .album-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .album-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .album-artist {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .empty-state {
        grid-column: 1 / -1;
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
