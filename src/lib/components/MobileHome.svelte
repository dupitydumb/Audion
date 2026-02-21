<script lang="ts">
    import { onMount } from "svelte";
    import {
        tracks,
        albums,
        artists,
        getAlbumCoverFromTracks,
        loadAlbumsAndArtists,
        loadPlaylists,
    } from "$lib/stores/library";
    import {
        getAlbumArtSrc,
        getTrackCoverSrc,
        selectMusicFolder,
        addFolder,
        rescanMusic,
        getDefaultMusicDirs,
        type Album,
        type Artist,
        type Track,
    } from "$lib/api/tauri";
    import { playTracks } from "$lib/stores/player";
    import {
        goToAlbumDetail,
        goToArtistDetail,
        goToSettings,
        goToLikedSongs,
    } from "$lib/stores/view";
    import { isStatsWrappedOpen } from "$lib/stores/ui";
    import { progressiveScan, isScanning } from "$lib/stores/progressiveScan";
    import { addToast } from "$lib/stores/toast";
    import { isMobile } from "$lib/stores/mobile";
    import { getLikedTracks } from "$lib/api/tauri";
    import { likedTrackIds } from "$lib/stores/liked";
    import {
        topTracks,
        topAlbums,
        recentlyPlayed,
        loadActivityData,
        isLoadingActivity,
    } from "$lib/stores/activity";

    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const currentMonthName = monthNames[new Date().getMonth()];

    onMount(() => {
        loadActivityData();
    });

    // Greeting based on time of day
    function getGreeting(): string {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 18) return "Good afternoon";
        return "Good evening";
    }

    // Recently added tracks (first 20)
    $: recentTracks = $tracks.slice(0, 20);

    // Albums for display (first 20)
    $: displayAlbums = $albums.slice(0, 20);

    // Artists for display (first 20)
    $: displayArtists = $artists.slice(0, 20);

    // Quick play grid - top albums or first 6 library albums
    $: quickPlayAlbums =
        $topAlbums.length > 0
            ? $topAlbums.slice(0, 6).map((ta) => ta.album)
            : $albums.slice(0, 6);

    function getAlbumArt(album: Album): string | null {
        return getAlbumCoverFromTracks(album.id);
    }

    function getTrackArt(track: Track): string | null {
        if (track.track_cover_path) return getTrackCoverSrc(track);
        if (track.track_cover) return getAlbumArtSrc(track.track_cover);
        if (track.cover_url) return track.cover_url;
        return null;
    }

    function handlePlayTrack(index: number) {
        playTracks(recentTracks, index);
    }

    // Liked tracks
    let likedTracks: Track[] = [];

    $: if ($likedTrackIds) {
        loadLiked();
    }

    async function loadLiked() {
        try {
            const all = await getLikedTracks();
            // Show recent likes first (reverse) and limit to 20
            likedTracks = [...all].reverse().slice(0, 20);
        } catch (e) {
            console.error("Failed to load liked tracks", e);
        }
    }

    function handlePlayLiked(index: number) {
        playTracks(likedTracks, index);
    }

    function handlePlayRecentlyPlayed(index: number) {
        playTracks($recentlyPlayed, index);
    }

    function handlePlayTopTrack(index: number) {
        const trackList = $topTracks.map((t) => t.track);
        playTracks(trackList, index);
    }

    function handleKeydown(e: KeyboardEvent, callback: () => void) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            callback();
        }
    }

    async function handleAddFolder() {
        try {
            if ($isMobile) {
                // On mobile (Android): scan default music directories automatically
                const dirs = await getDefaultMusicDirs();
                if (dirs.length === 0) {
                    addToast("No music folders found on this device", "error");
                    return;
                }

                await progressiveScan.startScan(true);

                for (const dir of dirs) {
                    try {
                        await addFolder(dir);
                    } catch (e) {
                        console.warn(`Failed to add folder ${dir}:`, e);
                    }
                }

                const result = await rescanMusic();

                if (result.errors.length > 0) {
                    console.warn("Scan errors:", result.errors);
                }

                await loadAlbumsAndArtists();
                await loadPlaylists();

                const parts = [];
                if (result.tracks_added > 0)
                    parts.push(`${result.tracks_added} added`);
                if (result.tracks_updated > 0)
                    parts.push(`${result.tracks_updated} updated`);
                if (result.tracks_deleted > 0)
                    parts.push(`${result.tracks_deleted} deleted`);

                const message =
                    parts.length > 0
                        ? `Scan complete: ${parts.join(", ")}`
                        : "Scan complete — no tracks found";

                addToast(message, "success", 4000);
            } else {
                // On desktop: use folder picker dialog
                const path = await selectMusicFolder();
                if (path) {
                    await progressiveScan.startScan(true);
                    await addFolder(path);
                    const result = await rescanMusic();

                    if (result.errors.length > 0) {
                        console.warn("Scan errors:", result.errors);
                    }

                    await loadAlbumsAndArtists();
                    await loadPlaylists();

                    const parts = [];
                    if (result.tracks_added > 0)
                        parts.push(`${result.tracks_added} added`);
                    if (result.tracks_updated > 0)
                        parts.push(`${result.tracks_updated} updated`);
                    if (result.tracks_deleted > 0)
                        parts.push(`${result.tracks_deleted} deleted`);

                    const message =
                        parts.length > 0
                            ? `Scan complete: ${parts.join(", ")}`
                            : "Scan complete — no new tracks found";

                    addToast(message, "success", 4000);
                }
            }
        } catch (error) {
            console.error("Scan failed:", error);
            addToast("Failed to scan music folder", "error");
        } finally {
            progressiveScan.reset();
        }
    }
    function handleContainerClick(e: MouseEvent, callback: () => void) {
        const target = e.target as HTMLElement;
        if (target.closest(".link") || target.closest("button")) {
            return;
        }
        callback();
    }
</script>

<div class="mobile-home">
    <!-- Header with greeting + settings gear -->
    <header class="home-header">
        <h1>{getGreeting()}</h1>
        <div class="header-actions">
            {#if $isScanning}
                <div class="scanning-indicator">
                    <div class="scanning-spinner"></div>
                    <span>Scanning…</span>
                </div>
            {:else}
                <button
                    class="add-music-btn"
                    on:click={handleAddFolder}
                    title="Add Music Folder"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="22"
                        height="22"
                    >
                        <path
                            d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM12.5 9.5v3H16v2h-3.5v3h-2v-3H7v-2h3.5v-3h2z"
                        />
                    </svg>
                </button>
            {/if}
            <button
                class="settings-btn"
                on:click={goToSettings}
                title="Settings"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                >
                    <path
                        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
                    />
                </svg>
            </button>
        </div>
    </header>

    <!-- Top Track Hero Section -->
    {#if $topTracks.length > 0}
        <section class="hero-section">
            <div
                class="hero-card"
                role="button"
                tabindex="0"
                on:click={(e) =>
                    handleContainerClick(e, () => handlePlayTopTrack(0))}
                on:keydown={(e) =>
                    handleKeydown(e, () => handlePlayTopTrack(0))}
            >
                <div class="hero-background">
                    {#if getTrackArt($topTracks[0].track)}
                        <img
                            src={getTrackArt($topTracks[0].track)}
                            alt=""
                            class="bg-blur"
                        />
                    {/if}
                    <div class="hero-overlay"></div>
                </div>

                <div class="hero-content">
                    <div class="hero-tag">YOUR #1 TRACK</div>
                    <div class="hero-main-info">
                        <div class="hero-art-container">
                            {#if getTrackArt($topTracks[0].track)}
                                <img
                                    src={getTrackArt($topTracks[0].track)}
                                    alt={$topTracks[0].track.title}
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
                                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="hero-text">
                            <h2 class="hero-title truncate-text">
                                {$topTracks[0].track.title}
                            </h2>
                            <p class="hero-artist truncate-text">
                                {$topTracks[0].track.artist}
                            </p>
                        </div>
                    </div>
                    <div class="hero-stats">
                        <span class="play-stat"
                            >{$topTracks[0].play_count} PLAYS</span
                        >
                        <div class="hero-play-btn">
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
            </div>
        </section>
    {/if}

    <!-- Quick Play Grid (Spotify-style 2-column compact cards) -->
    {#if quickPlayAlbums.length > 0}
        <div class="quick-play-grid">
            {#each quickPlayAlbums as album}
                <button
                    class="quick-play-card"
                    on:click={() => goToAlbumDetail(album.id)}
                >
                    <div class="quick-play-art">
                        {#if getAlbumArt(album)}
                            <img src={getAlbumArt(album)} alt={album.name} />
                        {:else}
                            <div class="art-placeholder-sm">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="16"
                                    height="16"
                                >
                                    <path
                                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                    />
                                </svg>
                            </div>
                        {/if}
                    </div>
                    <span class="quick-play-name truncate-text"
                        >{album.name}</span
                    >
                </button>
            {/each}
        </div>
    {/if}

    <!-- Wrapped Recap Card (Portrait/Premium style) -->
    <div class="recap-card-container">
        <button
            class="recap-card"
            on:click={() => isStatsWrappedOpen.set(true)}
        >
            <div class="recap-card-content">
                <span class="recap-label">MONTHLY</span>
                <h2 class="recap-title">{currentMonthName} Recap</h2>
                <p class="recap-text">Check out your music month in review</p>
                <div class="recap-pill">View Recap</div>
            </div>
            <div class="recap-card-decor">
                <svg
                    viewBox="0 0 100 100"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <circle
                        cx="80"
                        cy="20"
                        r="40"
                        fill="#1ed760"
                        fill-opacity="0.3"
                    />
                    <circle
                        cx="20"
                        cy="80"
                        r="30"
                        fill="#1ed760"
                        fill-opacity="0.1"
                    />
                </svg>
            </div>
        </button>
    </div>

    <!-- Jump Back In (Recently Played - Wide Cards) -->
    {#if $recentlyPlayed.length > 0}
        <section class="carousel-section wide-cards">
            <h2 class="section-title">Jump Back In</h2>
            <div class="carousel-container">
                {#each $recentlyPlayed as track, i}
                    <div
                        class="wide-card"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                handlePlayRecentlyPlayed(i),
                            )}
                        on:keydown={(e) =>
                            handleKeydown(e, () => handlePlayRecentlyPlayed(i))}
                    >
                        <div class="wide-card-art">
                            {#if getTrackArt(track)}
                                <img
                                    src={getTrackArt(track)}
                                    alt={track.title}
                                />
                            {:else}
                                <div class="art-placeholder-sm">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="20"
                                        height="20"
                                    >
                                        <path
                                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="wide-card-info">
                            <span class="card-title truncate-text"
                                >{track.title || "Unknown"}</span
                            >
                            <span class="card-subtitle truncate-text">
                                {track.artist || "Unknown Artist"}
                            </span>
                        </div>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Your Top Songs (List View) -->
    {#if $topTracks.length > 0}
        <section class="list-section">
            <h2 class="section-title">Your Top Songs</h2>
            <div class="top-songs-list">
                {#each $topTracks.slice(0, 4) as { track, play_count }, i}
                    <div
                        class="top-song-item"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                handlePlayTopTrack(i),
                            )}
                        on:keydown={(e) =>
                            handleKeydown(e, () => handlePlayTopTrack(i))}
                    >
                        <div class="song-rank">{i + 1}</div>
                        <div class="song-art">
                            {#if getTrackArt(track)}
                                <img
                                    src={getTrackArt(track)}
                                    alt={track.title}
                                />
                            {:else}
                                <div class="art-placeholder-xs">
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
                        <div class="song-info">
                            <span class="song-title truncate-text"
                                >{track.title || "Unknown"}</span
                            >
                            <span class="song-subtitle truncate-text"
                                >{track.artist || "Unknown Artist"}</span
                            >
                        </div>
                        <div class="song-count">{play_count}</div>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Most Played Albums (List View) -->
    {#if $topAlbums.length > 0}
        <section class="list-section">
            <h2 class="section-title">Most Played Albums</h2>
            <div class="top-songs-list">
                {#each $topAlbums.slice(0, 4) as { album, play_count }, i}
                    <div
                        class="top-song-item"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () =>
                                goToAlbumDetail(album.id),
                            )}
                        on:keydown={(e) =>
                            handleKeydown(e, () => goToAlbumDetail(album.id))}
                    >
                        <div class="song-rank">{i + 1}</div>
                        <div class="song-art">
                            {#if getAlbumArt(album)}
                                <img
                                    src={getAlbumArt(album)}
                                    alt={album.name}
                                />
                            {:else}
                                <div class="art-placeholder-xs">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="16"
                                        height="16"
                                    >
                                        <path
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        <div class="song-info">
                            <span class="song-title truncate-text"
                                >{album.name}</span
                            >
                            <span class="song-subtitle truncate-text">
                                {album.artist || "Unknown Artist"}
                            </span>
                        </div>
                        <div class="song-count">{play_count}</div>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Recently Added -->
    {#if recentTracks.length > 0}
        <section class="carousel-section">
            <h2 class="section-title">Recently Added</h2>
            <div class="carousel-container">
                {#each recentTracks as track, i}
                    <div
                        class="spotify-card"
                        role="button"
                        tabindex="0"
                        on:click={(e) =>
                            handleContainerClick(e, () => handlePlayTrack(i))}
                        on:keydown={(e) =>
                            handleKeydown(e, () => handlePlayTrack(i))}
                    >
                        <div class="card-art">
                            {#if getTrackArt(track)}
                                <img
                                    src={getTrackArt(track)}
                                    alt={track.title}
                                />
                            {:else}
                                <div class="art-placeholder">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        width="24"
                                        height="24"
                                    >
                                        <path
                                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                        />
                                    </svg>
                                </div>
                            {/if}
                            <div class="card-play-btn">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="20"
                                    height="20"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                        <span class="card-title truncate-text"
                            >{track.title || "Unknown"}</span
                        >
                        <button
                            class="card-subtitle truncate-text link"
                            on:click={() =>
                                goToArtistDetail(
                                    track.artist || "Unknown Artist",
                                )}
                        >
                            {track.artist || "Unknown Artist"}
                        </button>
                    </div>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Empty state if no content -->
    {#if $tracks.length === 0 && $albums.length === 0}
        <div class="empty-home">
            <svg viewBox="0 0 24 24" fill="currentColor" width="56" height="56">
                <path
                    d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM12.5 9.5v3H16v2h-3.5v3h-2v-3H7v-2h3.5v-3h2z"
                />
            </svg>
            <h2>Welcome to Audion</h2>
            <p>Add a music folder to start listening</p>
            {#if $isScanning}
                <div class="empty-scanning">
                    <div class="scanning-spinner large"></div>
                    <span>Scanning your music…</span>
                </div>
            {:else}
                <button class="empty-cta" on:click={handleAddFolder}>
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                    >
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                    Add Music Folder
                </button>
            {/if}
        </div>
    {/if}

    <!-- Bottom spacer for fixed nav + player -->
    <div class="bottom-spacer"></div>
</div>

<style>
    .mobile-home {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        background-color: var(--bg-base);
        -webkit-overflow-scrolling: touch;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }

    .home-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-lg) var(--spacing-md) var(--spacing-md);
    }

    .home-header h1 {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .add-music-btn {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: none;
        border: none;
        cursor: pointer;
        transition: all var(--transition-fast);
        -webkit-tap-highlight-color: transparent;
    }

    .add-music-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .add-music-btn:active {
        color: var(--accent-primary);
    }

    .scanning-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        color: var(--accent-primary);
        font-size: 0.75rem;
        font-weight: 500;
        padding: 0 var(--spacing-sm);
    }

    .scanning-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(29, 185, 84, 0.3);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    .scanning-spinner.large {
        width: 24px;
        height: 24px;
        border-width: 3px;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .settings-btn {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: none;
        border: none;
        cursor: pointer;
        transition: all var(--transition-fast);
        -webkit-tap-highlight-color: transparent;
    }

    .settings-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    /* ===== Liked Songs Banner ===== */
    .liked-songs-banner-container {
        padding: 0 var(--spacing-md) var(--spacing-lg);
    }

    .liked-songs-banner {
        width: 100%;
        display: flex;
        align-items: center;
        background: linear-gradient(135deg, #450af5, #8e44ad);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        border: none;
        cursor: pointer;
        text-align: left;
        color: white;
        transition: transform 0.2s ease;
        -webkit-tap-highlight-color: transparent;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .liked-songs-banner:active {
        transform: scale(0.98);
    }

    .liked-banner-content {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
    }

    .liked-banner-icon {
        width: 48px;
        height: 48px;
        background-color: rgba(255, 255, 255, 0.2);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
    }

    .liked-banner-text {
        display: flex;
        flex-direction: column;
    }

    .liked-banner-title {
        font-size: 1.1rem;
        font-weight: 700;
        line-height: 1.2;
    }

    .liked-banner-subtitle {
        font-size: 0.8rem;
        opacity: 0.8;
        font-weight: 500;
    }

    /* ===== Quick Play Grid (Spotify 2-col compact cards) ===== */
    .quick-play-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 0 var(--spacing-md) var(--spacing-lg);
    }

    .quick-play-card {
        display: flex;
        align-items: center;
        gap: 8px;
        background-color: rgba(255, 255, 255, 0.07);
        border-radius: var(--radius-sm);
        overflow: hidden;
        height: 56px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        border: none;
        padding: 0;
        text-align: left;
        color: var(--text-primary);
        -webkit-tap-highlight-color: transparent;
    }

    .quick-play-card:active {
        background-color: rgba(255, 255, 255, 0.12);
    }

    .quick-play-art {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        overflow: hidden;
    }

    .quick-play-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .quick-play-name {
        font-size: 0.8125rem;
        font-weight: 600;
        padding-right: 8px;
        flex: 1;
        min-width: 0;
    }

    /* ===== Carousel Section ===== */
    .carousel-section {
        margin-bottom: var(--spacing-lg);
    }

    .section-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
        padding: 0 var(--spacing-md);
        margin-bottom: var(--spacing-sm);
    }

    .carousel-container {
        display: flex;
        overflow-x: auto;
        gap: 12px;
        padding: 0 var(--spacing-md) var(--spacing-md);
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }

    .carousel-container::-webkit-scrollbar {
        display: none;
    }

    /* ===== Spotify Card ===== */
    .spotify-card {
        flex: 0 0 auto;
        width: 150px;
        scroll-snap-align: start;
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: 12px;
        transition: background-color 0.3s ease;
        cursor: pointer;
        border: none;
        text-align: left;
        color: var(--text-primary);
        -webkit-tap-highlight-color: transparent;
    }

    .spotify-card:active {
        background-color: var(--bg-surface);
    }

    .card-art {
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background-color: var(--bg-surface);
        margin-bottom: 8px;
        position: relative;
    }

    .card-art.round {
        border-radius: 50%;
    }

    .card-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .card-play-btn {
        position: absolute;
        bottom: 8px;
        right: 8px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background-color: var(--accent-primary);
        color: var(--bg-base);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    .spotify-card:active .card-play-btn {
        opacity: 1;
        transform: translateY(0);
    }

    .art-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background-color: var(--bg-surface);
    }

    .art-placeholder-sm {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background-color: var(--bg-surface);
    }

    .card-title {
        display: block;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 2px;
    }

    .card-subtitle {
        display: block;
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .truncate-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ===== Recap Card ===== */
    .recap-card-container {
        padding: 0 var(--spacing-md);
        margin-bottom: var(--spacing-lg);
    }

    .recap-card {
        width: 100%;
        background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
        border: 1px solid rgba(30, 215, 96, 0.3);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
        display: flex;
        justify-content: space-between;
        align-items: center;
        text-align: left;
        position: relative;
        overflow: hidden;
        cursor: pointer;
        color: white;
    }

    .recap-card:active {
        transform: scale(0.98);
    }

    .recap-card-content {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .recap-label {
        font-size: 0.7rem;
        font-weight: 800;
        color: #1ed760;
        letter-spacing: 1px;
    }

    .recap-title {
        font-size: 1.5rem;
        font-weight: 800;
        margin: 0;
    }

    .recap-text {
        font-size: 0.85rem;
        opacity: 0.7;
        margin: 0 0 12px 0;
    }

    .recap-pill {
        display: inline-block;
        background: #1ed760;
        color: black;
        padding: 6px 16px;
        border-radius: 20px;
        font-size: 0.85rem;
        font-weight: 700;
        width: fit-content;
    }

    .recap-card-decor {
        position: absolute;
        top: 0;
        right: 0;
        width: 120px;
        height: 120px;
        opacity: 0.5;
        z-index: 1;
    }

    /* ===== Empty State ===== */
    .empty-home {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        gap: var(--spacing-md);
        color: var(--text-subdued);
        text-align: center;
        min-height: 300px;
    }

    .empty-home h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-home p {
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    .empty-cta {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
        padding: 14px 28px;
        background-color: var(--accent-primary);
        color: var(--bg-base);
        font-size: 1rem;
        font-weight: 700;
        border: none;
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: all var(--transition-fast);
        -webkit-tap-highlight-color: transparent;
    }

    .empty-cta:active {
        transform: scale(0.97);
        background-color: var(--accent-hover);
    }

    .empty-cta svg {
        flex-shrink: 0;
    }

    .empty-scanning {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-lg);
        color: var(--accent-primary);
        font-size: 0.875rem;
        font-weight: 500;
    }

    /* ===== Bottom Spacer ===== */
    .bottom-spacer {
        height: calc(var(--mobile-bottom-inset, 130px) + var(--spacing-md));
    }
    .link {
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: var(--text-secondary);
        max-width: fit-content;
    }

    /* ===== New Wide Card Style ===== */
    .wide-card {
        flex: 0 0 auto;
        width: 240px;
        scroll-snap-align: start;
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px;
        transition: background-color 0.2s ease;
        -webkit-tap-highlight-color: transparent;
    }

    .wide-card:active {
        background-color: var(--bg-surface);
        transform: scale(0.98);
    }

    .wide-card-art {
        width: 64px;
        height: 64px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        flex-shrink: 0;
        background-color: var(--bg-surface);
    }

    .wide-card-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .wide-card-info {
        flex: 1;
        min-width: 0;
    }

    /* ===== New Top Songs List Style ===== */
    .list-section {
        margin-bottom: var(--spacing-lg);
    }

    .top-songs-list {
        display: flex;
        flex-direction: column;
        padding: 0 var(--spacing-md);
        gap: 4px;
    }

    .top-song-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px;
        border-radius: var(--radius-sm);
        transition: background-color 0.2s ease;
        -webkit-tap-highlight-color: transparent;
    }

    .top-song-item:active {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .song-rank {
        width: 24px;
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--text-subdued);
        text-align: center;
    }

    .song-art {
        width: 48px;
        height: 48px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background-color: var(--bg-surface);
    }

    .song-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .song-info {
        flex: 1;
        min-width: 0;
    }

    .song-title {
        display: block;
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .song-subtitle {
        display: block;
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .song-count {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--accent-primary);
        opacity: 0.8;
    }

    .art-placeholder-xs {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        background-color: var(--bg-surface);
    }

    /* ===== New Hero Card Style ===== */
    .hero-section {
        padding: 0 var(--spacing-md) var(--spacing-lg);
    }

    .hero-card {
        position: relative;
        width: 100%;
        height: 180px;
        border-radius: var(--radius-lg);
        overflow: hidden;
        background-color: #282828;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: var(--spacing-md);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        border: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    .hero-card:active {
        transform: scale(0.98);
    }

    .hero-background {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
    }

    .bg-blur {
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: blur(20px) brightness(0.6);
        transform: scale(1.2);
    }

    .hero-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(0, 0, 0, 0.8) 100%
        );
        z-index: 1;
    }

    .hero-content {
        position: relative;
        z-index: 2;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .hero-tag {
        font-size: 0.65rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        color: var(--accent-primary);
        background-color: rgba(29, 185, 84, 0.1);
        padding: 2px 8px;
        border-radius: var(--radius-full);
        width: fit-content;
    }

    .hero-main-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .hero-art-container {
        width: 64px;
        height: 64px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        flex-shrink: 0;
    }

    .hero-art-container img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .hero-text {
        flex: 1;
        min-width: 0;
    }

    .hero-title {
        font-size: 1.25rem;
        font-weight: 800;
        color: white;
        margin: 0;
        line-height: 1.2;
    }

    .hero-artist {
        font-size: 0.875rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.8);
        margin: 4px 0 0;
    }

    .hero-stats {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .play-stat {
        font-size: 0.75rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
    }

    .hero-play-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background-color: var(--accent-primary);
        color: black;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }

    .link:hover {
        text-decoration: underline;
        color: var(--text-primary);
    }
</style>
