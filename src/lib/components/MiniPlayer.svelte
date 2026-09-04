<script lang="ts">
    import { _ } from "svelte-i18n";
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
    import Icon from "$lib/components/Icon.svelte";
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
                data-tip={$_('player.openFullPlayer')}
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
                        <Icon name="music" size={22} />
                    </div>
                {/if}
            </button>

            <!-- Track info -->
            <div class="info">
                <span
                    class="title"
                    title={$currentTrack?.title || $_('player.noTrack')}
                >
                    {$currentTrack?.title || $_('player.noTrack')}
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
                    data-tip={mode === "controls"
                        ? $_('player.showLyrics')
                        : $_('player.showControls')}
                >
                    {#if mode === "controls"}
                        <Icon name="lyrics" size={10} />
                        {$_('player.lyrics')}
                    {:else}
                        <Icon name="play" size={10} />
                        {$_('player.controls')}
                    {/if}
                </button>

                <!-- Close -->
                <button
                    class="wbtn close"
                    on:click|stopPropagation={handleClose}
                    data-tip={$_('player.closePip')}
                >
                    <Icon name="x" size={11} />
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
                <button class="cbtn" on:click={previousTrack} data-tip={$_('player.previous')}>
                    <Icon name="skip-back" size={17} />
                </button>

                <button
                    class="pbtn"
                    on:click={togglePlay}
                    data-tip={$isPlaying ? $_('common.pause') : $_('common.play')}
                >
                    <Icon name={$isPlaying ? "pause" : "play"} size={19} />
                </button>

                <button class="cbtn" on:click={nextTrack} data-tip={$_('player.next')}>
                    <Icon name="skip-forward" size={17} />
                </button>
            </div>
        {:else}
            <!-- Lyrics row (replaces seek + controls) -->
            <div class="row-lyrics">
                {#if $lyricsLoading}
                    <span class="ly-muted">{$_('common.loading')}</span>
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
                    <span class="ly-muted">{$_('lyrics.unavailable')}</span>
                {/if}
            </div>

            <!-- Compact controls under lyrics -->
            <div class="row-ctrl compact" style="display: none;">
                <button class="cbtn" on:click={previousTrack} data-tip={$_('player.previous')}>
                    <Icon name="skip-back" size={15} />
                </button>
                <button
                    class="pbtn sm"
                    on:click={togglePlay}
                    data-tip={$isPlaying ? $_('common.pause') : $_('common.play')}
                >
                    <Icon name={$isPlaying ? "pause" : "play"} size={16} />
                </button>
                <button class="cbtn" on:click={nextTrack} data-tip={$_('player.next')}>
                    <Icon name="skip-forward" size={15} />
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
        font-weight: var(--font-weight-bold);
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: -0.01em;
    }

    .artist {
        font-size: 0.72rem;
        font-weight: var(--font-weight-medium);
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
        font-weight: var(--font-weight-semibold);
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
        background: color-mix(in srgb, var(--accent-primary), transparent 85%);
        border-color: color-mix(in srgb, var(--accent-primary), transparent 60%);
        color: var(--accent-primary);
    }

    .pill-active:hover {
        background: color-mix(in srgb, var(--accent-primary), transparent 75%);
        color: var(--accent-hover);
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
        font-weight: var(--font-weight-medium);
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
        font-weight: var(--font-weight-bold);
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
        font-weight: var(--font-weight-medium);
        color: rgba(255, 255, 255, 0.3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
    }

    .ly-muted {
        font-size: 0.72rem;
        font-weight: var(--font-weight-medium);
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

    /* ── Custom tooltip system (avoids OS-level window clipping) ──────── */
    [data-tip] {
        position: relative;
    }

    [data-tip]::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 5px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 20, 30, 0.97);
        color: rgba(255, 255, 255, 0.88);
        font-size: 0.62rem;
        font-weight: var(--font-weight-medium);
        white-space: nowrap;
        padding: 3px 7px;
        border-radius: 5px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.12s ease;
        z-index: 10001;
        border: 1px solid rgba(255, 255, 255, 0.07);
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
    }

    [data-tip]:hover::after {
        opacity: 1;
    }

    /* Top-row buttons: tooltip opens downward to stay inside the window */
    .row-top [data-tip]::after {
        bottom: auto;
        top: calc(100% + 5px);
    }
</style>
