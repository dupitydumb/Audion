<script lang="ts">
    import {
        searchResults,
        searchQuery,
        clearSearch,
    } from "$lib/stores/search";
    import {
        goToAlbumDetail,
        goToArtistDetail,
        goToPlaylistDetail,
    } from "$lib/stores/view";
    import { playTracks, addToQueue } from "$lib/stores/player";
    import {
        getAlbumArtSrc,
        getTrackCoverSrc,
        getAlbumCoverSrc,
        addTrackToPlaylist,
        deleteTrack,
        deleteAlbum,
    } from "$lib/api/tauri";
    import {
        albums,
        tracks as allTracks,
        playlists,
        loadPlaylists,
        loadLibrary,
        getAlbumCoverFromTracks,
    } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { pluginStore } from "$lib/stores/plugin-store";
    import { playlistCovers } from "$lib/stores/playlistCovers";
    import { confirm } from "$lib/stores/dialogs";

    // Helper functions for playlist covers
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

    function getPlaylistCover(playlist: { id: number; name: string }): string {
        const custom = $playlistCovers && $playlistCovers[playlist.id];
        if (custom) return custom;
        return generateSvgCover(playlist.name || "Playlist");
    }

    // Create album map for track art lookup
    $: albumMap = new Map($albums.map((a) => [a.id, a]));

    // Get track art with proper priority
    function getTrackArt(track: {
        track_cover_path?: string | null;
        track_cover?: string | null;
        cover_url?: string | null;
        album_id?: number | null;
    }): string | null {
        // Priority 1: Track's file-based cover
        if (track.track_cover_path) {
            return getTrackCoverSrc(track as any);
        }
        // Priority 2: Track's base64 cover - old, for migration and as fallback
        if (track.track_cover) {
            return getAlbumArtSrc(track.track_cover);
        }
        // Priority 2: External track cover URL
        if (track.cover_url) {
            return track.cover_url;
        }
        // Priority 4 & 5: Album art (file-based or base64)
        if (!track.album_id) return null;
        const album = albumMap.get(track.album_id);
        if (!album) return null;

        // Priority 4: Album's file-based art
        if (album.art_path) {
            return getAlbumCoverSrc(album);
        }
        // Priority 5: Album's base64 art - old
        return album.art_data ? getAlbumArtSrc(album.art_data) : null;
    }

    // Get album cover with proper priority
    function getAlbumCover(album: {
        id: number;
        art_path?: string | null;
        art_data?: string | null;
    }): string | null {
        return getAlbumCoverFromTracks(album.id);
    }

    function handleTrackClick(index: number) {
        playTracks($searchResults.tracks, index);
    }

    function handleAlbumClick(albumId: number) {
        clearSearch();
        goToAlbumDetail(albumId);
    }

    function handleArtistClick(artistName: string) {
        clearSearch();
        goToArtistDetail(artistName);
    }

    function handlePlaylistClick(playlistId: number) {
        clearSearch();
        goToPlaylistDetail(playlistId);
    }

    function getArtistInitial(name: string): string {
        return name.charAt(0).toUpperCase();
    }

    async function handleTrackContextMenu(
        e: MouseEvent,
        track: any,
        index: number,
    ) {
        e.preventDefault();

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
                    action: () => {
                        playTracks($searchResults.tracks, index);
                    },
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
                    label: "Go to Album",
                    action: () => {
                        if (track.album_id) {
                            handleAlbumClick(track.album_id);
                        }
                    },
                    disabled: !track.album_id,
                },
                {
                    label: "Go to Artist",
                    action: () => {
                        if (track.artist) {
                            handleArtistClick(track.artist);
                        }
                    },
                    disabled: !track.artist,
                },
                { type: "separator" },
                {
                    label: "Delete from Library",
                    danger: true,
                    action: async () => {
                        const confirmed = await confirm(
                            `Are you sure you want to delete "${track.title}" from your library? This will also remove the file from your computer.`,
                            {
                                title: "Delete Track",
                                confirmLabel: "Delete",
                                danger: true,
                            },
                        );

                        if (!confirmed) return;

                        try {
                            if (track.id) {
                                await deleteTrack(track.id);
                                // Refresh library or simple remove from search results not easy without re-search
                                // but we should at least trigger library reload
                                loadLibrary();
                            }
                        } catch (error) {
                            console.error("Failed to delete track:", error);
                        }
                    },
                    // Only for local tracks essentially, but backend handles safety?
                    // Let's assume yes or user will see error.
                    // Actually checking source might be good.
                    disabled:
                        track.source_type && track.source_type !== "local",
                },
            ],
        });
    }

    function handleAlbumContextMenu(e: MouseEvent, album: any) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Open Album",
                    action: () => handleAlbumClick(album.id),
                },
                { type: "separator" },
                {
                    label: "Go to Artist",
                    action: () => {
                        if (album.artist) {
                            handleArtistClick(album.artist);
                        }
                    },
                    disabled: !album.artist,
                },
                { type: "separator" },
                {
                    label: "Delete Album",
                    danger: true,
                    action: async () => {
                        const confirmed = await confirm(
                            `Are you sure you want to delete the album "${album.name}"? This will delete all songs in this album from your computer.`,
                            {
                                title: "Delete Album",
                                confirmLabel: "Delete",
                                danger: true,
                            },
                        );

                        if (!confirmed) return;

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

    function handleArtistContextMenu(e: MouseEvent, artist: any) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Open Artist",
                    action: () => handleArtistClick(artist.name),
                },
            ],
        });
    }
</script>

<div class="search-results">
    {#if !$searchResults.hasResults && $searchQuery}
        <div class="no-results">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                <path
                    d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                />
            </svg>
            <h3>No results found</h3>
            <p>Try searching for something else</p>
        </div>
    {:else}
        <!-- Tracks Section -->
        {#if $searchResults.tracks.length > 0}
            <section class="result-section">
                <h2 class="section-title">
                    Tracks ({$searchResults.tracks.length})
                </h2>
                <div class="tracks-list">
                    {#each $searchResults.tracks.slice(0, 10) as track, index}
                        {@const albumArt = getTrackArt(track)}
                        <div
                            class="track-item"
                            role="button"
                            tabindex="0"
                            on:click={() => handleTrackClick(index)}
                            on:keydown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    handleTrackClick(index);
                                }
                            }}
                            on:contextmenu={(e) =>
                                handleTrackContextMenu(e, track, index)}
                        >
                            <div class="track-art">
                                {#if albumArt}
                                    <img
                                        src={albumArt}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                    />
                                {:else}
                                    <div class="art-placeholder">
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
                            </div>
                            <div class="track-info">
                                <span class="track-title truncate"
                                    >{track.title || "Unknown Title"}</span
                                >
                                <button
                                    class="track-artist truncate link-text"
                                    on:click|stopPropagation={() => handleArtistClick(track.artist || "Unknown Artist")}
                                >{track.artist || "Unknown Artist"}</button>
                            </div>
                        </div>
                    {/each}
                    {#if $searchResults.tracks.length > 10}
                        <p class="more-results">
                            And {$searchResults.tracks.length - 10} more tracks...
                        </p>
                    {/if}
                </div>
            </section>
        {/if}

        <!-- Albums Section -->
        {#if $searchResults.albums.length > 0}
            <section class="result-section">
                <h2 class="section-title">
                    Albums ({$searchResults.albums.length})
                </h2>
                <div class="albums-grid">
                    {#each $searchResults.albums.slice(0, 6) as album}
                        {@const coverSrc = getAlbumCover(album)}
                        <div
                            class="album-card"
                            role="button"
                            tabindex="0"
                            on:click={() => handleAlbumClick(album.id)}
                            on:keydown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    handleAlbumClick(album.id);
                                }
                            }}
                            on:contextmenu={(e) =>
                                handleAlbumContextMenu(e, album)}
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
                                    <div class="art-placeholder">
                                        <svg
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
                                {/if}
                            </div>
                            <div class="album-info">
                                <span class="album-name truncate"
                                    >{album.name}</span
                                >
                                <button
                                    class="album-artist truncate link-text"
                                    on:click|stopPropagation={() => handleArtistClick(album.artist || "Unknown Artist")}
                                >{album.artist || "Unknown Artist"}</button>
                            </div>
                        </div>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Artists Section -->
        {#if $searchResults.artists.length > 0}
            <section class="result-section">
                <h2 class="section-title">
                    Artists ({$searchResults.artists.length})
                </h2>
                <div class="artists-grid">
                    {#each $searchResults.artists.slice(0, 6) as artist}
                        <button
                            class="artist-card"
                            on:click={() => handleArtistClick(artist.name)}
                            on:contextmenu={(e) =>
                                handleArtistContextMenu(e, artist)}
                        >
                            <div class="artist-avatar">
                                <span class="artist-initial"
                                    >{getArtistInitial(artist.name)}</span
                                >
                            </div>
                            <div class="artist-info">
                                <span class="artist-name truncate"
                                    >{artist.name}</span
                                >
                                <span class="artist-meta"
                                    >{artist.album_count} albums • {artist.track_count}
                                    songs</span
                                >
                            </div>
                        </button>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Playlists Section -->
        {#if $searchResults.playlists && $searchResults.playlists.length > 0}
            <section class="result-section">
                <h2 class="section-title">
                    Playlists ({$searchResults.playlists.length})
                </h2>
                <div class="playlists-grid">
                    {#each $searchResults.playlists.slice(0, 6) as playlist}
                        {@const coverSrc = getPlaylistCover(playlist)}
                        <button
                            class="playlist-card"
                            on:click={() => handlePlaylistClick(playlist.id)}
                        >
                            <div class="playlist-cover">
                                <img
                                    src={coverSrc}
                                    alt={playlist.name}
                                    loading="lazy"
                                    decoding="async"
                                />
                            </div>
                            <div class="playlist-info">
                                <span class="playlist-name truncate"
                                    >{playlist.name}</span
                                >
                            </div>
                        </button>
                    {/each}
                </div>
            </section>
        {/if}
    {/if}
</div>

<style>
    .search-results {
        padding: var(--spacing-md);
    }

    .no-results {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .no-results h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .no-results p {
        font-size: 0.875rem;
    }

    .result-section {
        margin-bottom: var(--spacing-xl);
    }

    .section-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
    }

    /* Tracks List */
    .tracks-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .track-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
        text-align: left;
    }

    .track-item:hover {
        background-color: var(--bg-elevated);
    }

    .track-art {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-xs);
        overflow: hidden;
        flex-shrink: 0;
    }

    .track-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--bg-surface);
        color: var(--text-subdued);
    }

    .track-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .track-title {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-primary);
    }

    .track-artist {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .more-results {
        font-size: 0.875rem;
        color: var(--text-subdued);
        padding: var(--spacing-sm);
    }

    /* Albums Grid */
    .albums-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--spacing-md);
    }

    .album-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm);
        transition: background-color var(--transition-normal);
        text-align: left;
    }

    .album-card:hover {
        background-color: var(--bg-surface);
    }

    .album-art {
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        margin-bottom: var(--spacing-sm);
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .album-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .album-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .album-artist {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    /* Artists Grid */
    .artists-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--spacing-md);
    }

    .artist-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .artist-card:hover {
        background-color: var(--bg-surface);
    }

    .artist-avatar {
        width: 80px;
        height: 80px;
        border-radius: var(--radius-full);
        background: linear-gradient(
            135deg,
            var(--accent-primary) 0%,
            #1a1a1a 100%
        );
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
    }

    .artist-initial {
        font-size: 2rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .artist-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
    }

    .artist-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .artist-meta {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Playlists Grid */
    .playlists-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--spacing-md);
    }

    .playlist-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm);
        transition: background-color var(--transition-normal);
        text-align: left;
    }

    .playlist-card:hover {
        background-color: var(--bg-surface);
    }

    .playlist-cover {
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        margin-bottom: var(--spacing-sm);
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
        gap: 2px;
        width: 100%;
    }

    .playlist-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }
    .link-text {
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: var(--text-secondary);
        max-width: fit-content;
    }

    .link-text:hover {
        text-decoration: underline;
        color: var(--text-primary);
    }
</style>
