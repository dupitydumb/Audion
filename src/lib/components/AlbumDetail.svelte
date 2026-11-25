<script lang="ts">
    import { onMount } from "svelte";
    import type { Album, Track } from "$lib/api/tauri";
    import {
        getAlbum,
        getTracksByAlbum,
        getAlbumArtSrc,
        getAlbumCoverSrc,
        getTrackCoverSrc,
        formatDuration,
        getReleaseMbInfo,
        convertFileSrc,
        type MbReleaseInfo,
    } from "$lib/api/tauri";
    import { playTracks, currentTrack, isPlaying, togglePlay } from "$lib/stores/player";
    import { goToAlbums, goToArtistDetail, activeHeroKey } from "$lib/stores/view";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import { getAlbumCoverFromTracks } from "$lib/stores/library";
    import { extractPalette } from "$lib/stores/palette";
    import { likedTrackIds, toggleLikeTrack } from "$lib/stores/liked";
    import TrackList from "./track-list/TrackList.svelte";
    import {
        downloadTracks,
        hasDownloadableTracks,
        needsDownloadLocation,
        showDownloadResult,
        type DownloadProgress,
    } from "$lib/services/downloadService";
    import { addToast } from "$lib/stores/toast";
    import { goto } from "$app/navigation";
    import { _, locale } from "svelte-i18n";
    import { isMobile } from "$lib/stores/mobile";
    import Icon from "$lib/components/Icon.svelte";

    export let albumId: number;

    let album: Album | null = null;
    let tracks: Track[] = [];
    let groupedTracks: { disc: number; tracks: Track[] }[] = [];
    let loading = true;

    // MusicBrainz release info
    let mbRelease: MbReleaseInfo | null = null;
    let mbReleaseLoading = false;

    $: totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    function groupTracksByDisc(tracks: Track[]) {
        const groups = new Map<number, Track[]>();

        tracks.forEach((track) => {
            const disc = track.disc_number || 1;
            if (!groups.has(disc)) {
                groups.set(disc, []);
            }
            groups.get(disc)?.push(track);
        });

        return Array.from(groups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([disc, tracks]) => ({ disc, tracks }));
    }

    async function loadAlbumData() {
        loading = true;
        mbRelease = null;
        try {
            const [albumData, trackData] = await Promise.all([
                getAlbum(albumId),
                getTracksByAlbum(albumId),
            ]);
            album = albumData;
            // Sort by disc number, then track number for proper album order
            tracks = trackData.sort((a, b) => {
                const discA = a.disc_number || 1;
                const discB = b.disc_number || 1;
                if (discA !== discB) return discA - discB;
                return (a.track_number || 0) - (b.track_number || 0);
            });
            groupedTracks = groupTracksByDisc(tracks);
            // Background MB fetch — don't await so it doesn't block the UI
            if (album) fetchMbRelease(album.name, album.artist || "");
        } catch (error) {
            console.error("Failed to load album:", error);
        } finally {
            loading = false;
        }
    }

    async function fetchMbRelease(name: string, artist: string) {
        if (!name) return;
        mbReleaseLoading = true;
        try {
            mbRelease = await getReleaseMbInfo(name, artist);
        } catch (e) {
            console.warn("[AlbumDetail] MB release fetch failed:", e);
        } finally {
            mbReleaseLoading = false;
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
                $_("playlist.configureDownloadLocation"),
                "error",
            );
            // Optionally redirect to settings
            return;
        }

        isDownloading = true;
        downloadProgress = $_("playlist.downloadStarting");

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
            addToast(
                $_("playlist.downloadFailed"),
                "error",
            );
        } finally {
            isDownloading = false;
            downloadProgress = "";
        }
    }

    function handlePlayAll() {
        if (tracks.length > 0 && album) {
            playTracks(tracks, 0, {
                type: "album",
                albumId: album.id,
                displayName: album.name,
            });
        }
    }

    onMount(() => {
        loadAlbumData();
    });

    // Reload when albumId changes
    $: albumId, loadAlbumData();

    import { contextMenu } from "$lib/stores/ui";
    import { buildAlbumContextMenu } from "$lib/menus/contextMenus";

    function handleContextMenu(e: MouseEvent, anchorRect?: DOMRect) {
        if (!album) return;
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: anchorRect ? anchorRect.left : e.clientX,
            y: anchorRect ? anchorRect.bottom : e.clientY,
            items: buildAlbumContextMenu({
                album,
                showPlay: true,
                showGoToArtist: true,
                showDelete: true,
                onPlay: handlePlayAll,
                onAfterDelete: () => goToAlbums(),
                t: $_,
            }),
        });
    }

    function openHeaderMenu(e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        handleContextMenu(e, rect);
    }

    // Dynamic Ambient Hero Banner Palette
    let heroAccentColor: string | null = null;
    let heroIsLight = false;
    let heroPaletteRequestId = 0;

    function checkIsLight(hex: string, lum?: number): boolean {
        if (typeof lum === "number") {
            return lum > 0.45;
        }
        const clean = hex.replace("#", "");
        if (clean.length !== 6) return false;
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        const l = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        return l > 0.45;
    }

    $: albumCoverUrl = album
        ? getAlbumCoverFromTracks(album.id) ||
          (album.cover_art_path ? convertFileSrc(album.cover_art_path) : null)
        : null;

    async function updateHeroPalette(coverUrl: string | null) {
        const thisRequestId = ++heroPaletteRequestId;
        if (!coverUrl) {
            heroAccentColor = null;
            heroIsLight = false;
            return;
        }
        try {
            const palette = await extractPalette(coverUrl);
            if (thisRequestId !== heroPaletteRequestId) return;
            if (palette && palette.length > 0) {
                heroAccentColor = palette[0].hex;
                heroIsLight = checkIsLight(palette[0].hex, palette[0].luminance) || !palette[0].isDark;
            } else {
                heroAccentColor = null;
                heroIsLight = false;
            }
        } catch (e) {
            if (thisRequestId !== heroPaletteRequestId) return;
            console.warn("[AlbumDetail] extractPalette failed:", e);
            heroAccentColor = null;
            heroIsLight = false;
        }
    }

    $: updateHeroPalette(albumCoverUrl);

    // Sticky Action Toolbar on Scroll
    let headerElement: HTMLElement | undefined = undefined;
    let isScrolledPastHero = false;

    function handleScroll(e: Event) {
        const target = e.currentTarget as HTMLElement;
        if (target && typeof target.scrollTop === "number") {
            const heroHeight = headerElement ? Math.max(120, headerElement.offsetHeight - 56) : 180;
            isScrolledPastHero = target.scrollTop >= heroHeight;
        }
    }

    $: isThisAlbumPlaying =
        $isPlaying && tracks.some((t) => t.id === $currentTrack?.id);

    function handlePlayPause() {
        if (isThisAlbumPlaying) {
            togglePlay();
        } else {
            handlePlayAll();
        }
    }

    $: isAlbumLiked =
        tracks.length > 0 && tracks.every((t) => $likedTrackIds.has(t.id));

    async function handleToggleLike() {
        if (tracks.length === 0) return;
        const shouldLike = !isAlbumLiked;
        for (const t of tracks) {
            if ($likedTrackIds.has(t.id) !== shouldLike) {
                await toggleLikeTrack(t);
            }
        }
    }
</script>

<div class="album-detail" on:scroll={handleScroll}>
    {#if loading}
        <div class="album-skeleton" aria-busy="true" aria-label={$_("album.loading")}>
            <header class="album-header skeleton-hero">
                <div
                    class="skeleton-cover-box"
                    style:view-transition-name={$activeHeroKey === `album:${albumId}` ? "active-hero-art" : "none"}
                >
                    <div class="shimmer-wave"></div>
                </div>
                <div class="skeleton-hero-info">
                    <div class="skeleton-badge shimmer-box"></div>
                    <div class="skeleton-title shimmer-box"></div>
                    <div class="skeleton-meta shimmer-box"></div>
                    <div class="skeleton-actions">
                        <div class="skeleton-btn shimmer-box"></div>
                    </div>
                </div>
            </header>
            <div class="skeleton-track-list">
                {#each Array(8) as _}
                    <div class="skeleton-track-row">
                        <div class="skeleton-num shimmer-box"></div>
                        <div class="skeleton-track-main">
                            <div class="skeleton-track-title shimmer-box"></div>
                            <div class="skeleton-track-sub shimmer-box"></div>
                        </div>
                        <div class="skeleton-dur shimmer-box"></div>
                    </div>
                {/each}
            </div>
        </div>
    {:else if album && shouldShowAlbum}
        <!-- Sticky 56px Top Bar -->
        <div
            class="sticky-action-bar"
            class:visible={isScrolledPastHero}
            aria-label="Album navigation and actions"
        >
            <div class="sticky-left">
                <button
                    class="top-bar-btn"
                    on:click={goToAlbums}
                    aria-label={$_("album.backToAlbums")}
                    title={$_("album.backToAlbums")}
                >
                    <Icon name="arrow-left" size={22} />
                </button>
                <div class="sticky-meta" class:revealed={isScrolledPastHero}>
                    <span class="sticky-title">{album.name}</span>
                    <span class="sticky-sep">•</span>
                    <span class="sticky-artist">{album.artist || $_("common.unknownArtist")}</span>
                </div>
            </div>
            <div class="sticky-right">
                <button
                    class="top-bar-btn sticky-reveal"
                    class:revealed={isScrolledPastHero}
                    class:liked={isAlbumLiked}
                    on:click={handleToggleLike}
                    aria-label={isAlbumLiked ? $_("liked.unlike") : $_("liked.like")}
                    title={isAlbumLiked ? $_("liked.unlike") : $_("liked.like")}
                >
                    <Icon name={isAlbumLiked ? "heart-filled" : "heart"} size={18} />
                </button>
                <button
                    class="sticky-play-btn sticky-reveal"
                    class:revealed={isScrolledPastHero}
                    on:click={handlePlayPause}
                    aria-label={isThisAlbumPlaying ? $_("common.pause") : $_("album.play")}
                    title={isThisAlbumPlaying ? $_("common.pause") : $_("album.play")}
                >
                    <Icon name={isThisAlbumPlaying ? "pause" : "play"} size={18} />
                </button>
                <button
                    class="top-bar-btn"
                    on:click|stopPropagation={openHeaderMenu}
                    aria-label={$_("common.more")}
                    title={$_("common.more")}
                >
                    <Icon name={$isMobile ? "more-vertical" : "more-horizontal"} size={20} />
                </button>
            </div>
        </div>

        <header
            class="album-header"
            class:light-hero={heroIsLight}
            style="--hero-accent-color: {heroAccentColor || 'var(--bg-surface)'};"
            on:contextmenu={handleContextMenu}
            aria-label="Album Header"
            bind:this={headerElement}
        >
            <div
                class="album-cover"
                style:view-transition-name={$activeHeroKey === `album:${album.id}` ? "active-hero-art" : "none"}
            >
                {#if getAlbumCoverFromTracks(album.id)}
                    <img
                        src={getAlbumCoverFromTracks(album.id)}
                        alt={album.name}
                        decoding="async"
                    />
                {:else}
                    <div class="album-cover-placeholder">
                        <Icon name="disc" size={64} />
                    </div>
                {/if}
            </div>
            <div class="album-info">
                <span class="album-type">{$_("album.type")}</span>
                <h1 class="album-title">{album.name}</h1>
                <div class="album-meta">
                    <ArtistLinks
                        artist={album.artist || $_("common.unknownArtist")}
                        artists={album.artists}
                        chipClass="album-artist link"
                        wrapClass="album-artist-links"
                        chipTitle={$_("contextMenu.goToArtist")}
                        on:select={(e) => goToArtistDetail(e.detail)}
                    />
                    <span class="separator">•</span>
                    <span
                        >{$_("album.songs", {
                            values: { count: tracks.length },
                        })}</span
                    >
                    <span class="separator">•</span>
                    <span>{formatDuration(totalDuration)}</span>
                </div>
                <div class="album-actions">
                    <button
                        class="btn-primary play-all-btn"
                        on:click={handlePlayAll}
                    >
                        <Icon name="play" size={24} />
                        {$_("album.play")}
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
                                <Icon name="download" size={24} />
                                <span>{$_("album.downloaded")}</span>
                            {:else}
                                <Icon name="download" size={24} />
                                <span>{$_("album.download")}</span>
                            {/if}
                        </button>
                    {/if}
                </div>
            </div>
        </header>

        <!-- MusicBrainz release info bar -->
        {#if mbReleaseLoading}
            <div class="mb-info-bar mb-info-loading">
                <span class="mb-info-spinner"></span>
                <span class="mb-info-hint"
                    >{$_("album.fetchingReleaseInfo")}</span
                >
            </div>
        {:else if mbRelease && (mbRelease.year || mbRelease.label || mbRelease.country || mbRelease.release_type)}
            <div class="mb-info-bar">
                {#if mbRelease.release_type}
                    <span class="mb-chip type-chip"
                        >{mbRelease.release_type}</span
                    >
                {/if}
                {#if mbRelease.year}
                    <span class="mb-chip">{mbRelease.year}</span>
                {/if}
                {#if mbRelease.label}
                    <span class="mb-chip">
                        <Icon name="tag" size={12} />
                        {mbRelease.label}
                    </span>
                {/if}
                {#if mbRelease.country}
                    <span class="mb-chip">{mbRelease.country}</span>
                {/if}
                <span class="mb-source-label">{$_("album.viaMusicBrainz")}</span
                >
            </div>
        {/if}

        <section class="track-list-section">
            {#if groupedTracks.length > 1}
                {#each groupedTracks as group, i}
                    <div class="disc-group">
                        <div class="disc-header">
                            <span class="disc-icon">
                                <Icon name="disc" size={16} />
                            </span>
                            <h3>
                                {$_("album.disc", {
                                    values: { number: group.disc },
                                })}
                            </h3>
                        </div>
                        <TrackList
                            tracks={group.tracks}
                            showAlbum={false}
                            externalScroll={true}
                            showMobileActionBar={i === 0}
                            playbackContext={{
                                type: "album",
                                albumId,
                                displayName: album?.name,
                            }}
                            queueTracks={tracks}
                        />
                    </div>
                {/each}
            {:else}
                <TrackList
                    {tracks}
                    showAlbum={false}
                    externalScroll={true}
                    playbackContext={{
                        type: "album",
                        albumId,
                        displayName: album?.name,
                    }}
                    queueTracks={tracks}
                />
            {/if}
        </section>
    {:else}
        <div class="not-found">
            <h2>{$_("album.notFound")}</h2>
            <button class="btn-secondary" on:click={goToAlbums}>
                {$_("album.backToAlbums")}
            </button>
        </div>
    {/if}
</div>

<style>
    .album-detail {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        position: relative;
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
        position: relative;
        display: flex;
        gap: var(--spacing-lg);
        padding: calc(56px + var(--spacing-md)) var(--spacing-lg) var(--spacing-lg);
        background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--hero-accent-color, var(--bg-surface)) 74%, var(--bg-surface) 26%) 0%,
            color-mix(in srgb, var(--hero-accent-color, var(--bg-surface)) 36%, var(--bg-base) 64%) 58%,
            var(--bg-base) 100%
        );
        overflow: hidden;
        transition: background 0.4s ease;
        flex-shrink: 0;
    }

    .album-header > * {
        position: relative;
        z-index: 2;
    }

    .album-header::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
            circle at 22% 35%,
            color-mix(in srgb, var(--hero-accent-color, transparent) 60%, transparent) 0%,
            transparent 72%
        );
        opacity: 0.95;
        transition: opacity 0.4s ease;
    }

    .album-header::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
            180deg,
            rgba(0, 0, 0, 0.28) 0%,
            rgba(0, 0, 0, 0.52) 100%
        );
        opacity: 0;
        transition: opacity 0.4s ease;
        z-index: 1;
    }

    .album-header.light-hero::after {
        opacity: 1;
    }

    /* ── Sticky Action Toolbar on Scroll (56px) ── */
    .sticky-action-bar {
        position: sticky;
        top: 0;
        z-index: var(--z-sticky, 100);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--spacing-sm);
        height: 56px;
        margin-bottom: -56px;
        background: transparent;
        border-bottom: 1px solid transparent;
        transition: background-color 0.22s ease,
                    border-color 0.22s ease;
        flex-shrink: 0;
    }

    .sticky-action-bar.visible {
        background: color-mix(in srgb, var(--bg-base) 90%, transparent);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-bottom-color: var(--border-subtle, var(--border-color));
    }

    .sticky-left,
    .sticky-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .sticky-left {
        min-width: 0;
        flex: 1;
    }

    .top-bar-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        border-radius: var(--radius-full);
        background: color-mix(in srgb, var(--bg-elevated) 72%, transparent);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: background-color var(--transition-fast), color var(--transition-fast), opacity 0.2s ease;
    }

    .sticky-action-bar.visible .top-bar-btn {
        background: transparent;
    }

    .top-bar-btn:hover {
        background: var(--surface-subtle-hover, rgba(255, 255, 255, 0.12));
    }

    .top-bar-btn.liked {
        color: var(--accent-primary);
    }

    .sticky-reveal {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform var(--transition-fast);
    }

    .sticky-reveal.revealed {
        opacity: 1;
        pointer-events: auto;
    }

    .sticky-play-btn {
        width: 40px;
        height: 40px;
        min-width: 40px;
        min-height: 40px;
        border-radius: var(--radius-full);
        background: var(--accent-primary);
        color: var(--text-on-accent, #fff);
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform var(--transition-fast), opacity 0.2s ease;
    }

    .sticky-play-btn:hover {
        transform: scale(1.06);
        filter: brightness(1.1);
    }

    .sticky-meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        opacity: 0;
        transition: opacity 0.2s ease;
        padding: 0 var(--spacing-xs);
    }

    .sticky-meta.revealed {
        opacity: 1;
    }

    .sticky-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .sticky-sep {
        color: var(--text-subdued);
        font-size: var(--font-size-xs);
        flex-shrink: 0;
    }

    .sticky-artist {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ── Skeleton Shimmer Loader ── */
    .album-skeleton {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;
    }

    .skeleton-hero {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, var(--bg-base) 100%);
        pointer-events: none;
    }

    .skeleton-cover-box {
        width: 232px;
        height: 232px;
        border-radius: var(--radius-sm);
        background: rgba(255, 255, 255, 0.05);
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
    }

    .skeleton-hero-info {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: var(--spacing-md);
        flex: 1;
        min-width: 0;
    }

    .skeleton-badge {
        width: 60px;
        height: 14px;
        border-radius: var(--radius-sm);
    }

    .skeleton-title {
        width: 55%;
        max-width: 380px;
        height: 40px;
        border-radius: var(--radius-sm);
    }

    .skeleton-meta {
        width: 35%;
        max-width: 240px;
        height: 18px;
        border-radius: var(--radius-sm);
    }

    .skeleton-actions {
        display: flex;
        gap: var(--spacing-md);
        margin-top: var(--spacing-sm);
    }

    .skeleton-btn {
        width: 110px;
        height: 40px;
        border-radius: var(--radius-full);
    }

    .skeleton-track-list {
        display: flex;
        flex-direction: column;
        padding: var(--spacing-md) var(--spacing-lg);
        gap: 8px;
    }

    .skeleton-track-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: 8px var(--spacing-sm);
        border-radius: var(--radius-sm);
    }

    .skeleton-num {
        width: 20px;
        height: 16px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
    }

    .skeleton-track-main {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
    }

    .skeleton-track-title {
        width: 40%;
        max-width: 260px;
        height: 15px;
        border-radius: var(--radius-sm);
    }

    .skeleton-track-sub {
        width: 25%;
        max-width: 160px;
        height: 12px;
        border-radius: var(--radius-sm);
    }

    .skeleton-dur {
        width: 36px;
        height: 14px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
    }

    .shimmer-box {
        position: relative;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
    }

    .shimmer-box::after,
    .skeleton-cover-box .shimmer-wave {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.04) 30%,
            rgba(255, 255, 255, 0.12) 50%,
            rgba(255, 255, 255, 0.04) 70%,
            transparent 100%
        );
        animation: skeleton-shimmer 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    @keyframes skeleton-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
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
        align-items: flex-start;
        min-width: 0;
        flex: 1;
    }

    .album-type {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        color: var(--text-primary);
    }

    .album-title {
        font-size: 3rem;
        font-weight: var(--font-weight-bold);
        line-height: 1.1;
        margin: var(--spacing-sm) 0;
        color: var(--text-primary);
    }

    .album-meta {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        margin-bottom: var(--spacing-lg);
    }

    .album-artist {
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
    }

    .album-artist:hover {
        text-decoration: underline;
    }

    .separator {
        color: var(--text-subdued);
    }

    .album-actions {
        display: flex;
        gap: var(--spacing-md);
    }

    .play-all-btn {
        font-size: var(--font-size-md);
        padding: var(--spacing-sm) var(--spacing-xl);
    }

    .track-list-section {
        flex: 1 0 auto;
    }

    /* multi-disc: each disc's TrackList is unconstrained, so its .list-body
       is an un-scrollable scroll container. Its overscroll-behavior: contain
       would swallow the wheel before it reaches this section, leaving only
       the disc headers scrollable. Restore chaining. */
    .track-list-section :global(.list-body) {
        overscroll-behavior-y: auto;
    }

    .btn-secondary {
        background-color: transparent;
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        transition: all var(--transition-fast);
        padding: var(--spacing-sm) var(--spacing-xl);
        border-radius: var(--radius-full);
        font-size: var(--font-size-md);
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

    .disc-group {
        margin-bottom: var(--spacing-lg);
    }

    .disc-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md) var(--spacing-xl);
        background: transparent;
        color: var(--text-primary);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        text-transform: none;
        letter-spacing: normal;
        border: none;
        margin-top: var(--spacing-lg);
        margin-bottom: var(--spacing-xs);
    }

    .disc-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        width: 24px; /* Align with track number width roughly */
    }

    .disc-icon {
        display: flex;
        align-items: center;
        opacity: 0.7;
    }

    .disc-header h3 {
        margin: 0;
        font-size: inherit;
        font-weight: inherit;
    }

    /* ── MusicBrainz info bar ── */
    .mb-info-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-lg);
        border-bottom: 1px solid var(--border-color);
        min-height: 38px;
    }

    .mb-info-loading {
        opacity: 0.5;
    }

    .mb-info-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.15);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        flex-shrink: 0;
    }

    .mb-info-hint {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
    }

    .mb-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-full);
        padding: var(--spacing-xs) 10px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .type-chip {
        background: rgba(var(--accent-primary-rgb, 30 215 96) / 0.1);
        border-color: rgba(var(--accent-primary-rgb, 30 215 96) / 0.3);
        color: var(--accent-primary);
    }

    .mb-source-label {
        font-size: 0.65rem;
        color: var(--text-subdued);
        opacity: 0.45;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-left: auto;
    }

    /* ── Mobile ── */
    :global(html.layout-mobile) .album-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: calc(56px + var(--spacing-sm)) var(--spacing-md) var(--spacing-md);
        gap: var(--spacing-md);
    }

    :global(html.layout-mobile) .sticky-sep,
    :global(html.layout-mobile) .sticky-artist {
        display: none;
    }

    :global(html.layout-mobile) .album-cover {
        width: 160px;
        height: 160px;
    }

    :global(html.layout-mobile) .album-info {
        align-items: center;
    }

    :global(html.layout-mobile) .album-title {
        font-size: 1.5rem;
        word-break: break-word;
    }

    :global(html.layout-mobile) .album-meta {
        flex-wrap: wrap;
        margin-bottom: var(--spacing-md);
    }

    :global(html.layout-mobile) .album-actions {
        flex-wrap: wrap;
        justify-content: center;
    }

    :global(html.layout-mobile) .play-all-btn,
    :global(html.layout-mobile) .btn-secondary {
        padding: var(--spacing-sm) var(--spacing-lg);
        font-size: var(--font-size-base);
        min-height: 44px;
    }
</style>
