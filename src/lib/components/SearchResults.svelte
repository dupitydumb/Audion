<script context="module" lang="ts">
    export type SectionKey = "tracks" | "albums" | "artists" | "playlists";
</script>

<script lang="ts">
    import {
        searchResults,
        searchQuery,
        clearSearch,
    } from "$lib/stores/search";
    import { formatArtists } from "$lib/utils/artists";
    import {
        goToAlbumDetail,
        goToArtistDetail,
        goToPlaylistDetail,
    } from "$lib/stores/view";
    import { playTracks } from "$lib/stores/player";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import {
        getAlbumArtSrc,
        getTrackCoverSrc,
        getAlbumCoverSrc,
        formatDuration,
    } from "$lib/api/tauri";
    import {
        albums,
        getAlbumCoverFromTracks,
    } from "$lib/stores/library";
    import { contextMenu } from "$lib/stores/ui";
    import { playlistCovers } from "$lib/stores/playlistCovers";
    import {
        buildTrackContextMenu,
        buildAlbumContextMenu,
        buildArtistContextMenu,
        isTrackUnavailable,
    } from "$lib/menus/contextMenus";
    import { _ } from "svelte-i18n";

    import EmptyState from "./EmptyState.svelte";

    // Props from MainView
    export let sectionOrder: SectionKey[];
    export let hiddenSections: Set<SectionKey>;

    // per-section visible counts (reset when search results change)
    let visibleTracks = 10;
    let visibleAlbums = 6;
    let visibleArtists = 6;
    let visiblePlaylists = 6;
    let hoveredTrackIndex: number | null = null;

    $: $searchResults, resetVisible();
    function resetVisible() {
        visibleTracks = 10;
        visibleAlbums = 6;
        visibleArtists = 6;
        visiblePlaylists = 6;
    }

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

    function handlePlaylistClick(playlistId: number, name: string) {
        clearSearch();
        goToPlaylistDetail(playlistId, name);
    }

    function getArtistInitial(name: string): string {
        return name.charAt(0).toUpperCase();
    }

    function handleTrackContextMenu(
        e: MouseEvent,
        track: any,
        index: number,
    ) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildTrackContextMenu({
                track,
                trackIndex: index,
                sortedTracks: $searchResults.tracks,
                isUnavailable: isTrackUnavailable(track),
                variant: 'full',
                t: $_,
            }),
        });
    }

    function handleAlbumContextMenu(e: MouseEvent, album: any) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildAlbumContextMenu({
                album,
                showPlay: false,
                showPin: true,
                showGoToArtist: true,
                showDelete: true,
                t: $_,
            }),
        });
    }

    function handleArtistContextMenu(e: MouseEvent, artist: any) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildArtistContextMenu({
                artist,
                showPlay: false,
                t: $_,
            }),
        });
    }
</script>

<div class="search-results">
    {#if !$searchResults.hasResults && $searchQuery}
        <EmptyState
            icon="search"
            title="No results found"
            description="Try searching for something else"
        />
    {:else}
        {#each sectionOrder as key (key)}
            {#if !hiddenSections.has(key)}
                {#if key === "tracks" && $searchResults.tracks.length > 0}
                    <section class="result-section">
                        <h2 class="section-title">
                            <button class="section-pill pill-inactive" aria-pressed="false" title="Tracks">
                                <span class="pill-label">Tracks</span>
                                <span class="pill-count">{$searchResults.tracks.length}</span>
                            </button>
                        </h2>
                        <div class="tracks-list">
                            {#each $searchResults.tracks.slice(0, visibleTracks) as track, index}
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
                                    on:mouseenter={() => (hoveredTrackIndex = index)}
                                    on:mouseleave={() => (hoveredTrackIndex = null)}
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
                                        <ArtistLinks
                                            artist={track.artist}
                                            artists={track.artists}
                                            chipClass="track-artist truncate link-text"
                                            marquee
                                            marqueeTrigger="external"
                                            marqueeActive={hoveredTrackIndex === index}
                                            resetKey={track.id}
                                            on:select={(e) => handleArtistClick(e.detail)}
                                        />
                                    </div>
                                    <button
                                        class="track-album truncate"
                                        on:click|stopPropagation={() =>
                                            track.album_id && handleAlbumClick(track.album_id)}
                                        disabled={!track.album_id}
                                        >{track.album || "-"}</button
                                    >
                                    <span class="track-duration"
                                        >{formatDuration(track.duration)}</span
                                    >
                                </div>
                            {/each}
                            {#if $searchResults.tracks.length > visibleTracks}
                                <button class="load-more" on:click={() => visibleTracks += 10}>
                                    {$_('search.loadMore', { values: { count: $searchResults.tracks.length - visibleTracks }, default: `Load more (${$searchResults.tracks.length - visibleTracks} left)` })}
                                </button>
                            {/if}
                        </div>
                    </section>

                {:else if key === "albums" && $searchResults.albums.length > 0}
                    <section class="result-section">
                        <h2 class="section-title">
                            <button class="section-pill pill-inactive" aria-pressed="false" title="Albums">
                                <span class="pill-label">Albums</span>
                                <span class="pill-count">{$searchResults.albums.length}</span>
                            </button>
                        </h2>
                        <div class="albums-grid">
                            {#each $searchResults.albums.slice(0, visibleAlbums) as album}
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
                                            on:click|stopPropagation={() =>
                                                handleArtistClick(
                                                    (album.artists && album.artists[0]) || album.artist || "Unknown Artist",
                                                )}
                                            >{formatArtists(album.artists) || album.artist || "Unknown Artist"}</button
                                        >
                                    </div>
                                </div>
                            {/each}
                        </div>
                        {#if $searchResults.albums.length > visibleAlbums}
                            <button class="load-more" on:click={() => visibleAlbums += 6}>
                                {$_('search.loadMore', { values: { count: $searchResults.albums.length - visibleAlbums }, default: `Load more (${$searchResults.albums.length - visibleAlbums} left)` })}
                            </button>
                        {/if}
                    </section>

                {:else if key === "artists" && $searchResults.artists.length > 0}
                    <section class="result-section">
                        <h2 class="section-title">
                            <button class="section-pill pill-inactive" aria-pressed="false" title="Artists">
                                <span class="pill-label">Artists</span>
                                <span class="pill-count">{$searchResults.artists.length}</span>
                            </button>
                        </h2>
                        <div class="artists-grid">
                            {#each $searchResults.artists.slice(0, visibleArtists) as artist}
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
                        {#if $searchResults.artists.length > visibleArtists}
                            <button class="load-more" on:click={() => visibleArtists += 6}>
                                {$_('search.loadMore', { values: { count: $searchResults.artists.length - visibleArtists }, default: `Load more (${$searchResults.artists.length - visibleArtists} left)` })}
                            </button>
                        {/if}
                    </section>

                {:else if key === "playlists" && $searchResults.playlists?.length > 0}
                    <section class="result-section">
                        <h2 class="section-title">
                            <button class="section-pill pill-inactive" aria-pressed="false" title="Playlists">
                                <span class="pill-label">Playlists</span>
                                <span class="pill-count">{$searchResults.playlists.length}</span>
                            </button>
                        </h2>
                        <div class="playlists-grid">
                            {#each $searchResults.playlists.slice(0, visiblePlaylists) as playlist}
                                {@const coverSrc = getPlaylistCover(playlist)}
                                <button
                                    class="playlist-card"
                                    on:click={() => handlePlaylistClick(playlist.id, playlist.name)}
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
                        {#if $searchResults.playlists.length > visiblePlaylists}
                            <button class="load-more" on:click={() => visiblePlaylists += 6}>
                                {$_('search.loadMore', { values: { count: $searchResults.playlists.length - visiblePlaylists }, default: `Load more (${$searchResults.playlists.length - visiblePlaylists} left)` })}
                            </button>
                        {/if}
                    </section>
                {/if}
            {/if}
        {/each}
    {/if}
</div>

<style>
    .search-results {
        padding: var(--spacing-md);
    }

    @media (max-width: 768px) {
        .search-results {
            padding-bottom: calc(
                var(--mobile-bottom-inset, 130px) + var(--spacing-md)
            );
        }
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
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .no-results p {
        font-size: var(--font-size-base);
    }

    .result-section {
        margin-bottom: var(--spacing-xl);
    }

    .section-title {
        font-size: 1.25rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
    }

    /* Section pill badge (themed) */
    .section-pill {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-full, 999px);
        background: var(--bg-surface);
        color: var(--text-secondary);
        border: 1px solid var(--border-color);
        font-weight: var(--font-weight-semibold);
        cursor: default;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        transition: background-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
        font-size: 0.95rem;
    }

    .section-pill:focus,
    .section-pill:hover {
        background: var(--bg-elevated);
        color: var(--text-primary);
        outline: none;
    }

    .section-pill.pill-active {
        background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)));
        color: var(--text-on-accent, #fff);
        border-color: transparent;
        box-shadow: var(--shadow-sm);
    }

    .pill-label {
        display: inline-block;
        line-height: 1;
    }

    .pill-count {
        display: inline-block;
        min-width: 24px;
        padding: var(--spacing-xs) var(--spacing-xs);
        border-radius: var(--radius-full);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: 0.8rem;
        text-align: center;
        font-weight: var(--font-weight-bold);
    }

    /* Remove native inner focus indicator / arrow on some browsers */
    .section-pill::-webkit-focus-inner {
        border: 0;
        padding: 0;
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
        gap: var(--spacing-xs);
        min-width: 0;
        flex: 1 1 0;
    }

    .track-title {
        font-size: 0.9375rem;
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
    }

    .track-artist {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }

    .track-album {
        flex: 1 1 0;
        min-width: 0;
        font-size: 0.875rem;
        color: var(--text-secondary);
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        line-height: 1.2;
        cursor: pointer;
    }

    .track-album:hover:not(:disabled) {
        color: var(--text-primary);
        text-decoration: underline;
        cursor: pointer;
    }

    .track-album:disabled {
        cursor: default;
    }

    .track-duration {
        flex-shrink: 0;
        font-size: 0.875rem;
        color: var(--text-subdued);
        min-width: 40px;
        text-align: right;
    }

    @media (max-width: 640px) {
        .track-album {
            display: none;
        }
    }

    .load-more {
        display: block;
        background: none;
        border: none;
        padding: var(--spacing-sm);
        font-size: var(--font-size-base);
        color: var(--text-subdued);
        cursor: pointer;
        text-align: left;
    }

    .load-more:hover {
        color: var(--text-secondary);
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
        gap: var(--spacing-xs);
    }

    .album-name {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .album-artist {
        font-size: var(--font-size-xs);
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
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
    }

    .artist-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        width: 100%;
    }

    .artist-name {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .artist-meta {
        font-size: var(--font-size-xs);
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
        gap: var(--spacing-xs);
        width: 100%;
    }

    .playlist-name {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
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
