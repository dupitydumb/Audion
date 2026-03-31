<script lang="ts">
    import { fly } from "svelte/transition";
    import {
        isMiniPlayer,
        toggleMiniPlayer,
        setMiniPlayer,
    } from "$lib/stores/ui";
    import {
        currentTrack,
        isPlaying,
        togglePlay,
        nextTrack,
        previousTrack,
        progress,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";
    import {
        getAlbumArtSrc,
        getAlbum,
        getTrackCoverSrc,
        getAlbumCoverSrc,
        formatDuration,
    } from "$lib/api/tauri";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { isTauri } from "$lib/api/tauri";
    import {
        lyricsData,
        activeLine,
        lyricsLoading,
        initLyricsSync,
        destroyLyricsSync,
    } from "$lib/stores/lyrics";
    import { onMount } from "svelte";

    // ── Mode toggle (persisted) ──────────────────────────
    const STORAGE_KEY = "miniplayer_mode";
    let mode: "controls" | "lyrics" = "controls";
    try {
        const s = localStorage.getItem(STORAGE_KEY);
        if (s === "lyrics" || s === "controls") mode = s;
    } catch {}

    function toggleMode(e?: MouseEvent) {
        if (e) e.stopPropagation();
        mode = mode === "controls" ? "lyrics" : "controls";
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {}
    }

    // ── Album art ────────────────────────────────────────
    let albumArt: string | null = null;
    let imageLoadFailed = false;

    $: if ($currentTrack) loadTrackCover($currentTrack);
    else {
        albumArt = null;
        imageLoadFailed = false;
    }

    async function loadTrackCover(track: any) {
        imageLoadFailed = false;
        if (track.track_cover_path) albumArt = getTrackCoverSrc(track);
        else if (track.track_cover)
            albumArt = getAlbumArtSrc(track.track_cover);
        else if (track.cover_url) albumArt = track.cover_url;
        else if (track.album_id) await loadAlbumArt(track.album_id);
        else albumArt = null;
    }

    async function loadAlbumArt(albumId: number) {
        try {
            const album = await getAlbum(albumId);
            if (!album) {
                albumArt = null;
                return;
            }
            if (album.art_path) albumArt = getAlbumCoverSrc(album);
            else if (album.art_data) albumArt = getAlbumArtSrc(album.art_data);
            else albumArt = null;
        } catch {
            albumArt = null;
        }
    }

    // ── Lyrics ───────────────────────────────────────────
    $: currentLine =
        $lyricsData && $activeLine >= 0
            ? ($lyricsData.lines[$activeLine]?.text ?? "")
            : "";
    $: nextLine =
        $lyricsData && $activeLine >= 0
            ? ($lyricsData.lines[$activeLine + 1]?.text ?? "")
            : "";
    $: hasLyrics = !!($lyricsData && $lyricsData.lines.length > 0);

    // The remaining-time string
    $: remaining =
        $duration > 0
            ? "-" + formatDuration($duration - $currentTime)
            : "-0:00";

    // ── Seek ─────────────────────────────────────────────
    let seekEl: HTMLDivElement;
    let dragging = false;

    function onSeek(e: MouseEvent) {
        if (!seekEl) return;
        const r = seekEl.getBoundingClientRect();
        seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    }
    function onSeekDown(e: MouseEvent) {
        dragging = true;
        onSeek(e);
    }
    function onSeekMove(e: MouseEvent) {
        if (dragging) onSeek(e);
    }
    function onSeekUp() {
        dragging = false;
    }

    // ── Window actions ───────────────────────────────────
    async function handleClose() {
        await toggleMiniPlayer();
    }
    async function handleExpand() {
        await setMiniPlayer(false);
    }

    // ── Drag window ─────────────────────────────────────
    let winDrag = false;
    function onWinDown() {
        if (isTauri() && $isMiniPlayer) winDrag = true;
    }
    async function onWinMove() {
        if (!winDrag || !isTauri()) return;
        try {
            await getCurrentWindow().startDragging();
            winDrag = false;
        } catch {}
    }
    function onWinUp() {
        winDrag = false;
    }

    onMount(() => {
        // Force a re-run of lyrics sync for this instance
        destroyLyricsSync();
        initLyricsSync();
        return () => destroyLyricsSync();
    });
</script>

<svelte:window on:mousemove={onSeekMove} on:mouseup={onSeekUp} />

{#if $isMiniPlayer}
    <div
        class="pip"
        transition:fly={{ y: 12, duration: 250, opacity: 0 }}
        on:mousedown={onWinDown}
        on:mousemove={onWinMove}
        on:mouseup={onWinUp}
        role="region"
        aria-label="Mini player"
    >
        <!-- ══ ROW 1: art + info + buttons ═══════════════════ -->
        <div class="row-top">
            <!-- Album art -->
            <button
                class="art"
                on:click={handleExpand}
                title="Open full player"
                tabindex="-1"
            >
                {#if albumArt && !imageLoadFailed}
                    <img
                        src={albumArt}
                        alt="Cover"
                        decoding="async"
                        on:error={() => (imageLoadFailed = true)}
                    />
                {:else}
                    <div class="art-ph">
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="22"
                            height="22"
                        >
                            <path
                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                            />
                        </svg>
                    </div>
                {/if}
            </button>

            <!-- Track info -->
            <div class="info">
                <span
                    class="title"
                    title={$currentTrack?.title || "No track playing"}
                >
                    {$currentTrack?.title || "No track playing"}
                </span>
                <span class="artist">{$currentTrack?.artist || ""}</span>
            </div>

            <!-- Window buttons -->
            <div class="win-row">
                <!-- Mode toggle -->
                <button
                    class="pill"
                    class:pill-active={mode === "lyrics"}
                    on:click|stopPropagation={toggleMode}
                    title={mode === "controls"
                        ? "Show lyrics"
                        : "Show controls"}
                >
                    {#if mode === "controls"}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="10"
                            height="10"
                        >
                            <path
                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                            />
                        </svg>
                        Lyrics
                    {:else}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="10"
                            height="10"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        Controls
                    {/if}
                </button>

                <!-- Close -->
                <button
                    class="wbtn close"
                    on:click|stopPropagation={handleClose}
                    title="Close PIP"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="11"
                        height="11"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            </div>
        </div>

        <!-- ══ ROW 2 ═════════════════════════════════════════ -->
        {#if mode === "controls"}
            <!-- Seek row -->
            <div class="row-seek">
                <span class="t-label">{formatDuration($currentTime)}</span>
                <div
                    class="seek-track"
                    bind:this={seekEl}
                    on:mousedown={onSeekDown}
                    role="slider"
                    aria-label="Seek"
                    aria-valuenow={Math.round($progress * 100)}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    tabindex="0"
                >
                    <div
                        class="seek-fill"
                        style="width:{$progress * 100}%"
                    ></div>
                    <div
                        class="seek-thumb"
                        style="left:{$progress * 100}%"
                    ></div>
                </div>
                <span class="t-label">{remaining}</span>
            </div>

            <!-- Controls row -->
            <div class="row-ctrl">
                <button class="cbtn" on:click={previousTrack} title="Previous">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="17"
                        height="17"
                    >
                        <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                    </svg>
                </button>

                <button
                    class="pbtn"
                    on:click={togglePlay}
                    title={$isPlaying ? "Pause" : "Play"}
                >
                    {#if $isPlaying}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="19"
                            height="19"
                        >
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                    {:else}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="19"
                            height="19"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    {/if}
                </button>

                <button class="cbtn" on:click={nextTrack} title="Next">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="17"
                        height="17"
                    >
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                    </svg>
                </button>
            </div>
        {:else}
            <!-- Lyrics row (replaces seek + controls) -->
            <div class="row-lyrics">
                {#if $lyricsLoading}
                    <span class="ly-muted">Loading…</span>
                {:else if hasLyrics && currentLine}
                    {#key $activeLine}
                        <span class="ly-now">{currentLine}</span>
                    {/key}
                    {#if nextLine}
                        <span class="ly-next">{nextLine}</span>
                    {/if}
                {:else if hasLyrics}
                    <span class="ly-muted">♪</span>
                {:else}
                    <span class="ly-muted">No lyrics available</span>
                {/if}
            </div>

            <!-- Compact controls under lyrics -->
            <div class="row-ctrl compact" style="display: none;">
                <button class="cbtn" on:click={previousTrack} title="Previous">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="15"
                        height="15"
                    >
                        <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
                    </svg>
                </button>
                <button
                    class="pbtn sm"
                    on:click={togglePlay}
                    title={$isPlaying ? "Pause" : "Play"}
                >
                    {#if $isPlaying}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="16"
                            height="16"
                        >
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                    {:else}
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="16"
                            height="16"
                        >
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    {/if}
                </button>
                <button class="cbtn" on:click={nextTrack} title="Next">
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="15"
                        height="15"
                    >
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                    </svg>
                </button>
                <span class="t-label" style="margin-left:8px"
                    >{formatDuration($currentTime)} / {formatDuration(
                        $duration,
                    )}</span
                >
            </div>
        {/if}

        <!-- ══ Progress bar (always at very bottom) ══════════ -->
        <div class="bottom-bar">
            <div class="bottom-fill" style="width:{$progress * 100}%"></div>
        </div>
    </div>
{/if}

<style>
    /* ── Wrapper ───────────────────────────────────────── */
    .pip {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: linear-gradient(
            165deg,
            rgba(25, 25, 35, 0.96) 0%,
            rgba(15, 15, 22, 0.98) 100%
        );
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        overflow: hidden;
        z-index: 9999;
        cursor: grab;
        -webkit-app-region: drag;
        user-select: none;
        backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .pip:active {
        cursor: grabbing;
    }

    /* ── Row 1: art + info + buttons ──────────────────── */
    .row-top {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 14px 8px 14px;
        flex-shrink: 0;
        -webkit-app-region: no-drag;
    }

    /* Album art */
    .art {
        width: 58px;
        height: 58px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 0;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.03);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        transition:
            transform 0.2s cubic-bezier(0.2, 0, 0.2, 1),
            box-shadow 0.2s ease;
    }

    .art:hover {
        transform: scale(1.06);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.7);
        border-color: rgba(255, 255, 255, 0.2);
    }

    .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .art-ph {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.2);
    }

    /* Track info */
    .info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .title {
        font-size: 0.9rem;
        font-weight: 700;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: -0.01em;
    }

    .artist {
        font-size: 0.72rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Window buttons */
    .win-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .pill {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 0.65rem;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .pill:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.9);
        transform: translateY(-1px);
    }

    .pill-active {
        background: rgba(29, 185, 84, 0.15);
        border-color: rgba(29, 185, 84, 0.4);
        color: #1db154;
    }

    .pill-active:hover {
        background: rgba(29, 185, 84, 0.25);
        color: #1ed760;
    }

    .wbtn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .wbtn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
        transform: scale(1.05);
    }
    .wbtn.close:hover {
        background: rgba(255, 69, 58, 0.2);
        color: #ff453a;
    }

    /* ── Row 2: seek bar ───────────────────────────────── */
    .row-seek {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        flex-shrink: 0;
        -webkit-app-region: no-drag;
    }

    .t-label {
        font-size: 0.65rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.4);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .seek-track {
        flex: 1;
        height: 20px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .seek-track::before {
        content: "";
        position: absolute;
        inset: 8px 0;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        transition: all 0.2s ease;
    }

    .seek-track:hover::before {
        inset: 7px 0;
        background: rgba(255, 255, 255, 0.15);
    }

    .seek-fill {
        position: absolute;
        top: 8px;
        bottom: 8px;
        left: 0;
        background: #fff;
        border-radius: 4px;
        pointer-events: none;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .seek-track:hover .seek-fill {
        top: 7px;
        bottom: 7px;
        background: var(--accent-primary, #1db154);
    }

    .seek-thumb {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fff;
        pointer-events: none;
        opacity: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
        transition:
            opacity 0.2s ease,
            transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    .seek-track:hover .seek-thumb {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.1);
    }

    /* ── Row 3: playback controls ──────────────────────── */
    .row-ctrl {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 4px 14px 12px;
        flex-shrink: 0;
        -webkit-app-region: no-drag;
    }

    .row-ctrl.compact {
        justify-content: flex-start;
        padding: 6px 16px 12px;
        gap: 6px;
    }

    .cbtn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }

    .cbtn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        transform: scale(1.05);
    }
    .cbtn:active {
        transform: scale(0.9);
    }

    .pbtn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background: #fff;
        color: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    .pbtn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
    }
    .pbtn:active {
        transform: scale(0.9);
    }
    .pbtn.sm {
        width: 34px;
        height: 34px;
    }

    /* ── Lyrics rows ───────────────────────────────────── */
    .row-lyrics {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 5px;
        padding: 0 16px 4px;
        min-height: 0;
        overflow: hidden;
        -webkit-app-region: no-drag;
    }

    .ly-now {
        font-size: 0.85rem;
        font-weight: 700;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
        animation: lyfade 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes lyfade {
        from {
            opacity: 0;
            transform: translateY(6px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .ly-next {
        font-size: 0.7rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
    }

    .ly-muted {
        font-size: 0.72rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.25);
        font-style: italic;
    }

    /* ── Bottom accent bar ─────────────────────────────── */
    .bottom-bar {
        height: 3px;
        background: rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
    }

    .bottom-fill {
        height: 100%;
        background: linear-gradient(
            90deg,
            var(--accent-primary, #1db154),
            #1ed760
        );
        transition: width 0.1s linear;
    }
</style>
