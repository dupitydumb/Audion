<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount, onDestroy } from "svelte";
    import {
        isMiniPlayer,
        toggleMiniPlayer,
        setMiniPlayer,
        resizeIslandWindow,
        isStatsForNerdsOpen,
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
        volume,
        setVolume,
    } from "$lib/stores/player";
    import { getAlbum, formatDuration, isTauri } from "$lib/api/tauri";
    import { resolveTrackCover } from "$lib/stores/library";
    import { customArtworks } from "$lib/stores/customArtwork";
    import { albumPalette } from "$lib/stores/palette";
    import { pickVibrantColor } from "$lib/stores/theme";
    import { getHtml5Analyser } from "$lib/services/html5-audio";
    import Icon from "$lib/components/Icon.svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";

    // ── Design Tokens & States (miniplayer.md §2 & §3) ────────
    type IslandState = "idle" | "compact" | "peek" | "expanded" | "hud";
    type DisplayMode = "floating" | "notch";

    const SIZES: Record<IslandState, { w: number; h: number; r: number }> = {
        idle: { w: 120, h: 32, r: 16 },
        compact: { w: 220, h: 40, r: 20 },
        peek: { w: 300, h: 44, r: 22 },
        expanded: { w: 380, h: 160, r: 36 },
        hud: { w: 260, h: 44, r: 22 },
    };

    let state: IslandState = "compact";
    let previousState: IslandState = "compact";
    let displayMode: DisplayMode = "floating";

    try {
        const savedMode = localStorage.getItem("island_display_mode");
        if (savedMode === "floating" || savedMode === "notch") {
            displayMode = savedMode;
        }
    } catch {}

    function toggleDisplayMode(e?: MouseEvent) {
        if (e) e.stopPropagation();
        displayMode = displayMode === "floating" ? "notch" : "floating";
        try {
            localStorage.setItem("island_display_mode", displayMode);
        } catch {}
        // Re-apply the hit region for the new pill margin-top
        resizeIslandWindow(state, displayMode);
    }

    // ── Dynamic Color from Album Art (miniplayer.md §8) ──────
    $: vibrantPick =
        $albumPalette && $albumPalette.length > 0
            ? pickVibrantColor($albumPalette)
            : null;
    $: islandAccent = vibrantPick || "#ff375f";

    // ── Album Cover Art ──────────────────────────────────────
    let albumArt: string | null = null;
    let imageLoadFailed = false;

    $: if ($currentTrack) {
        loadTrackCover($currentTrack, $customArtworks);
    } else {
        albumArt = null;
        imageLoadFailed = false;
    }

    async function loadTrackCover(track: any, _customs?: unknown) {
        imageLoadFailed = false;
        try {
            let src = resolveTrackCover(track);
            if (!src && track.album_id) {
                const album = await getAlbum(track.album_id);
                if ($currentTrack?.id !== track.id) return;
                src = resolveTrackCover(track, album);
            }
            albumArt = src;
        } catch {
            albumArt = null;
        }
    }

    // ── Peek on Track Change (miniplayer.md §5.4) ────────────
    let prevTrackId: number | null = null;
    let peekTimer: ReturnType<typeof setTimeout> | null = null;

    $: if ($currentTrack?.id !== prevTrackId) {
        if (prevTrackId !== null && $currentTrack && state === "compact") {
            triggerPeek();
        }
        prevTrackId = $currentTrack?.id ?? null;
    }

    function triggerPeek() {
        if (state === "expanded") return;
        state = "peek";
        resizeIslandWindow("peek", displayMode);
        if (peekTimer) clearTimeout(peekTimer);
        peekTimer = setTimeout(() => {
            if (state === "peek") {
                state = "compact";
                setTimeout(() => {
                    if (state === "compact") {
                        resizeIslandWindow("compact", displayMode);
                    }
                }, 480);
            }
        }, 2500);
    }

    // ── HUD Volume Feedback (miniplayer.md §5.11) ────────────
    let hudTimer: ReturnType<typeof setTimeout> | null = null;

    function triggerHud() {
        if (state !== "hud") {
            previousState = state;
        }
        state = "hud";
        resizeIslandWindow("hud", displayMode);
        if (hudTimer) clearTimeout(hudTimer);
        hudTimer = setTimeout(() => {
            if (state === "hud") {
                const targetState = previousState === "hud" ? "compact" : previousState;
                state = targetState;
                setTimeout(() => {
                    if (state === targetState) {
                        resizeIslandWindow(targetState, displayMode);
                    }
                }, 480);
            }
        }, 1500);
    }

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        const newVol = Math.max(0, Math.min(1, $volume + delta));
        setVolume(newVol);
        triggerHud();
    }

    // ── Audio Visualizer (miniplayer.md §5.6 & §14.7) ────────
    let barHeights = [4, 8, 5, 10];
    let animFrame: number;

    function updateVisualizer() {
        if ($isPlaying) {
            const analyser = getHtml5Analyser();
            if (analyser) {
                const data = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(data);
                const b1 = Math.max(3, (data[2] / 255) * 16);
                const b2 = Math.max(3, (data[6] / 255) * 16);
                const b3 = Math.max(3, (data[12] / 255) * 16);
                const b4 = Math.max(3, (data[20] / 255) * 16);
                barHeights[0] = barHeights[0] * 0.7 + b1 * 0.3;
                barHeights[1] = barHeights[1] * 0.7 + b2 * 0.3;
                barHeights[2] = barHeights[2] * 0.7 + b3 * 0.3;
                barHeights[3] = barHeights[3] * 0.7 + b4 * 0.3;
            } else {
                const t = Date.now() / 140;
                barHeights[0] = 4 + Math.sin(t * 1.3) * 5 + 5;
                barHeights[1] = 4 + Math.cos(t * 0.9) * 6 + 6;
                barHeights[2] = 4 + Math.sin(t * 1.6 + 1.2) * 5 + 5;
                barHeights[3] = 4 + Math.cos(t * 1.1 + 2.0) * 4 + 5;
            }
        } else {
            // Flatten to 2px dots when paused
            barHeights[0] = 2;
            barHeights[1] = 2;
            barHeights[2] = 2;
            barHeights[3] = 2;
        }
        barHeights = [...barHeights];
        animFrame = requestAnimationFrame(updateVisualizer);
    }

    // ── Seek Scrubber (miniplayer.md §5.7) ───────────────────
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
    function onSeekKeydown(e: KeyboardEvent) {
        if (!$duration || $duration <= 0) return;
        const step = 5 / $duration;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            seek(Math.max(0, $progress - step));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            seek(Math.min(1, $progress + step));
        } else if (e.key === "Home") {
            e.preventDefault();
            seek(0);
        } else if (e.key === "End") {
            e.preventDefault();
            seek(1);
        }
    }

    // ── Time remaining string ───────────────────────────────
    $: remaining =
        $duration > 0
            ? "-" + formatDuration($duration - $currentTime)
            : "-0:00";

    // ── Window & State Actions ──────────────────────────────
    function handlePillClick() {
        if (state === "compact" || state === "peek" || state === "idle") {
            handleExpand();
        }
    }

    function handleExpand() {
        if (state === "expanded") return;
        previousState = state;
        state = "expanded";
        resizeIslandWindow("expanded", displayMode);
    }

    function handleCollapse(e?: Event) {
        if (e) e.stopPropagation();
        if (state !== "expanded") return;
        const targetState = $currentTrack ? "compact" : "idle";
        state = targetState;
        setTimeout(() => {
            if (state === targetState) {
                resizeIslandWindow(targetState, displayMode);
            }
        }, 480);
    }

    function onWindowBlur() {
        if (state === "expanded") {
            handleCollapse();
        }
    }

    async function handleExpandToFull(e?: Event) {
        if (e) e.stopPropagation();
        await setMiniPlayer(false);
    }

    async function handleClose(e?: Event) {
        if (e) e.stopPropagation();
        await toggleMiniPlayer();
    }

    function onWindowKeydown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === "Escape") {
            e.preventDefault();
            if (state === "expanded") {
                handleCollapse();
            } else {
                handleClose();
            }
        } else if (e.key === " ") {
            e.preventDefault();
            togglePlay();
        } else if (e.key === "ArrowLeft" && state === "expanded") {
            if (!$duration) return;
            e.preventDefault();
            seek(Math.max(0, $progress - (5 / $duration)));
        } else if (e.key === "ArrowRight" && state === "expanded") {
            if (!$duration) return;
            e.preventDefault();
            seek(Math.min(1, $progress + (5 / $duration)));
        }
    }

    // ── Drag Window (Tauri) ─────────────────────────────────
    let winDrag = false;
    function onWinDown(e: MouseEvent) {
        // Only initiate window drag if not clicking interactive buttons
        if ((e.target as HTMLElement)?.closest("button, input, [role='slider']")) return;
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
        if (typeof document !== 'undefined') {
            document.documentElement.classList.add('pip');
            document.body.classList.add('pip');
        }
        resizeIslandWindow(state, displayMode);
        animFrame = requestAnimationFrame(updateVisualizer);
    });

    onDestroy(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('pip');
            document.body.classList.remove('pip');
        }
        if (animFrame) cancelAnimationFrame(animFrame);
        if (peekTimer) clearTimeout(peekTimer);
        if (hudTimer) clearTimeout(hudTimer);
    });
</script>

<svelte:window
    on:mousemove={onSeekMove}
    on:mouseup={onSeekUp}
    on:keydown={onWindowKeydown}
    on:blur={onWindowBlur}
/>

{#if $isMiniPlayer}
    <!-- Stage: transparent window container (miniplayer.md §10 & §14.2) -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="stage"
        class:expanded={state === "expanded"}
        on:click={handleCollapse}
    >
        <!-- Island Pill: single pure-black morphing shape (miniplayer.md §1) -->
        <div
            class="pill"
            class:notch={displayMode === "notch"}
            class:expanded={state === "expanded"}
            class:compact={state === "compact"}
            class:peek={state === "peek"}
            class:hud={state === "hud"}
            class:idle={state === "idle"}
            style:width="{SIZES[state].w}px"
            style:height="{SIZES[state].h}px"
            style:border-radius="{displayMode === 'notch'
                ? `0px 0px ${SIZES[state].r}px ${SIZES[state].r}px`
                : `${SIZES[state].r}px`}"
            style:--accent="{islandAccent}"
            on:click|stopPropagation={handlePillClick}
            on:wheel={onWheel}
            on:mousedown={onWinDown}
            on:mousemove={onWinMove}
            on:mouseup={onWinUp}
            role="region"
            aria-label="Island Mini Player"
        >
            <!-- ══ STATE 1: IDLE ═════════════════════════════════ -->
            {#if state === "idle"}
                <div class="content-layer layer-idle">
                    <Icon name="music" size={14} />
                    <span class="idle-text">{$_('player.noTrack')}</span>
                </div>

            <!-- ══ STATE 2: COMPACT (220 × 40) ═══════════════════ -->
            {:else if state === "compact"}
                <div class="content-layer layer-compact">
                    <!-- Art 26px left (inside curve) -->
                    <div class="art-compact" class:paused={!$isPlaying}>
                        {#if albumArt && !imageLoadFailed}
                            <img src={albumArt} alt="Art" decoding="async" on:error={() => (imageLoadFailed = true)} />
                        {:else}
                            <div class="art-ph"><Icon name="music" size={13} /></div>
                        {/if}
                    </div>

                    <!-- Two-Line Micro Stack in Middle -->
                    <div class="compact-stack">
                        <span class="compact-title" title={$currentTrack?.title || $_('player.noTrack')}>
                            {$currentTrack?.title || $_('player.noTrack')}
                        </span>
                        {#if $currentTrack?.artist}
                            <span class="compact-artist" title={$currentTrack.artist}>
                                {$currentTrack.artist}
                            </span>
                        {/if}
                    </div>

                    <!-- 4 visualizer bars right -->
                    <div class="viz-compact">
                        {#each barHeights as h, i (i)}
                            <div class="vbar" style:height="{h}px"></div>
                        {/each}
                    </div>
                </div>

            <!-- ══ STATE 3: PEEK (300 × 44) ══════════════════════ -->
            {:else if state === "peek"}
                <div class="content-layer layer-peek">
                    <div class="art-compact peek-art" class:paused={!$isPlaying}>
                        {#if albumArt && !imageLoadFailed}
                            <img src={albumArt} alt="Art" decoding="async" on:error={() => (imageLoadFailed = true)} />
                        {:else}
                            <div class="art-ph"><Icon name="music" size={12} /></div>
                        {/if}
                    </div>

                    <div class="peek-text">
                        <span class="peek-title">{$currentTrack?.title || $_('player.noTrack')}</span>
                    </div>

                    <div class="viz-compact peek-viz">
                        {#each barHeights as h, i (i)}
                            <div class="vbar" style:height="{h}px"></div>
                        {/each}
                    </div>
                </div>

            <!-- ══ STATE 4: HUD VOLUME (260 × 44) ════════════════ -->
            {:else if state === "hud"}
                <div class="content-layer layer-hud">
                    <Icon name={$volume === 0 ? "volume-x" : "volume-2"} size={16} />
                    <div class="hud-track">
                        <div class="hud-fill" style="width: {$volume * 100}%"></div>
                    </div>
                    <span class="hud-value">{Math.round($volume * 100)}%</span>
                </div>

            <!-- ══ STATE 5: EXPANDED (380 × 156) ═════════════════ -->
            {:else if state === "expanded"}
                <div class="content-layer layer-expanded">
                    <!-- Top section: Art + Track info + Visualizer & Actions -->
                    <div class="exp-top">
                        <!-- Art 48px -->
                        <button
                            class="art-exp"
                            class:paused={!$isPlaying}
                            on:click={handleExpandToFull}
                            data-tip={$_('player.openFullPlayer')}
                            aria-label={$_('player.openFullPlayer')}
                        >
                            {#if albumArt && !imageLoadFailed}
                                <img src={albumArt} alt="Art" decoding="async" on:error={() => (imageLoadFailed = true)} />
                            {:else}
                                <div class="art-ph"><Icon name="music" size={22} /></div>
                            {/if}
                        </button>

                        <!-- Track info -->
                        <div class="exp-info">
                            <div class="marquee-wrapper">
                                <span class="exp-title" title={$currentTrack?.title || $_('player.noTrack')}>
                                    {$currentTrack?.title || $_('player.noTrack')}
                                </span>
                            </div>
                            <div class="marquee-wrapper">
                                <span class="exp-artist" title={$currentTrack?.artist || ""}>
                                    {$currentTrack?.artist || ""}
                                </span>
                            </div>
                        </div>

                        <!-- Top-Right: Visualizer + Ghost Actions -->
                        <div class="exp-top-actions">
                            <div class="viz-exp" aria-hidden="true">
                                {#each barHeights as h, i (i)}
                                    <div class="vbar exp-vbar" style:height="{Math.min(22, Math.max(3, h * 1.35))}px"></div>
                                {/each}
                            </div>

                            <button
                                class="action-btn"
                                on:click={(e) => { e.stopPropagation(); isStatsForNerdsOpen.update(v => !v); }}
                                data-tip="Stats for Nerds (Ctrl+I)"
                                aria-label="Stats for Nerds"
                            >
                                <Icon name="info" size={12} />
                            </button>

                            <button
                                class="action-btn"
                                on:click={toggleDisplayMode}
                                data-tip={displayMode === "floating" ? "Notch mode" : "Floating mode"}
                                aria-label="Toggle notch mode"
                            >
                                <Icon name={displayMode === "floating" ? "notch" : "floating"} size={12} />
                            </button>

                            <button
                                class="action-btn"
                                on:click={handleExpandToFull}
                                data-tip={$_('player.openFullPlayer')}
                                aria-label={$_('player.openFullPlayer')}
                            >
                                <Icon name="external-link" size={12} />
                            </button>

                            <button
                                class="action-btn close-btn"
                                on:click={handleCollapse}
                                data-tip="Collapse"
                                aria-label="Collapse"
                            >
                                <Icon name="x" size={12} />
                            </button>
                        </div>
                    </div>

                    <!-- Middle: Scrubber -->
                    <div class="exp-seek">
                        <span class="time-label">{formatDuration($currentTime)}</span>

                        <div
                            class="scrubber-track"
                            bind:this={seekEl}
                            on:mousedown={onSeekDown}
                            on:keydown={onSeekKeydown}
                            role="slider"
                            aria-label={$_('player.seek') || "Seek"}
                            aria-valuenow={Math.round($progress * 100)}
                            aria-valuemin="0"
                            aria-valuemax="100"
                            tabindex="0"
                        >
                            <div
                                class="scrubber-fill"
                                style="transform: scaleX({$progress})"
                            ></div>
                            <div
                                class="scrubber-thumb"
                                style="left: {$progress * 100}%"
                            ></div>
                        </div>

                        <span class="time-label">{remaining}</span>
                    </div>

                    <!-- Bottom: Transport Controls (Apple Dynamic Island solid filled glyphs) -->
                    <div class="exp-controls">
                        <button
                            class="ctrl-btn"
                            on:click={previousTrack}
                            aria-label={$_('player.previous')}
                            data-tip={$_('player.previous')}
                        >
                            <Icon name="skip-back" size={22} />
                        </button>

                        <button
                            class="ctrl-btn play-btn"
                            on:click={togglePlay}
                            aria-label={$isPlaying ? $_('common.pause') : $_('common.play')}
                            data-tip={$isPlaying ? $_('common.pause') : $_('common.play')}
                        >
                            <Icon name={$isPlaying ? "pause" : "play"} size={28} />
                        </button>

                        <button
                            class="ctrl-btn"
                            on:click={nextTrack}
                            aria-label={$_('player.next')}
                            data-tip={$_('player.next')}
                        >
                            <Icon name="skip-forward" size={22} />
                        </button>
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    /* ── STAGE (Transparent window container, miniplayer.md §10 & §14.2) ── */
    .stage {
        width: 100vw;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        user-select: none;
        overflow: hidden;
        position: fixed;
        inset: 0;
        background: transparent !important;
        box-shadow: none !important;
        border: none !important;
        outline: none !important;
        pointer-events: none;
    }

    .stage.expanded {
        pointer-events: auto;
    }

    /* ── THE PILL (Pure black, morphing shape, miniplayer.md §1 & §2) ── */
    .pill {
        background: #000000;
        margin-top: 8px;
        position: relative;
        overflow: hidden;
        cursor: default;
        box-sizing: border-box;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        pointer-events: auto;
        will-change: width, height, border-radius, box-shadow, margin-top;
        transition:
            width 480ms cubic-bezier(0.32, 0.72, 0, 1),
            height 480ms cubic-bezier(0.32, 0.72, 0, 1),
            border-radius 480ms cubic-bezier(0.32, 0.72, 0, 1),
            box-shadow 480ms cubic-bezier(0.32, 0.72, 0, 1),
            margin-top 480ms cubic-bezier(0.32, 0.72, 0, 1),
            transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* Compact hover feedback (miniplayer.md §5.9) */
    .pill.compact:hover,
    .pill.peek:hover {
        transform: scale(1.04);
        cursor: pointer;
    }

    /* Notch display mode (miniplayer.md §2.1) */
    .pill.notch {
        margin-top: 0px !important;
        border-top: none !important;
        box-shadow: inset 0 -1px 0 1px rgba(255, 255, 255, 0.06) !important;
    }

    /* Shadow tokens (miniplayer.md §3) */
    .pill.expanded {
        box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.08),
            0 12px 32px rgba(0, 0, 0, 0.35);
    }

    /* ── Content Layers: Blur-Scale Crossfade (miniplayer.md §4.3) ── */
    .content-layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        box-sizing: border-box;
        animation: contentFadeEnter 180ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }

    @keyframes contentFadeEnter {
        from {
            opacity: 0;
            transform: scale(0.96);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }

    /* ── IDLE STATE (120 × 32) ─────────────────────────── */
    .layer-idle {
        justify-content: center;
        gap: 8px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 11px;
        font-weight: 500;
    }

    /* ── COMPACT STATE (220 × 40, miniplayer.md §7) ────── */
    .layer-compact {
        justify-content: space-between;
        padding-left: 7px;
        padding-right: 14px;
    }

    /* Two-Line Micro Stack (Compact) */
    .compact-stack {
        flex: 1;
        min-width: 0;
        margin: 0 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1.5px;
        pointer-events: none;
        mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 12px), transparent 100%);
        -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 12px), transparent 100%);
    }

    .compact-title {
        color: #ffffff;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: -0.01em;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .compact-artist {
        color: rgba(255, 255, 255, 0.6);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: -0.005em;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .art-compact {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        overflow: hidden;
        flex-shrink: 0;
        background: #1c1c1e;
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* Artwork shrinks on pause (miniplayer.md §5.5) */
    .art-compact.paused {
        transform: scale(0.88);
    }

    .art-compact img {
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
        color: rgba(255, 255, 255, 0.3);
    }

    /* Visualizer (miniplayer.md §5.6) */
    .viz-compact {
        display: flex;
        align-items: center;
        gap: 3px;
        height: 16px;
    }

    .vbar {
        width: 3px;
        border-radius: 9999px;
        background: var(--accent, #ff375f);
        transition: height 60ms linear;
        min-height: 2px;
    }

    /* ── PEEK STATE (300 × 44, miniplayer.md §2 & §5.4) ── */
    .layer-peek {
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 10px;
    }

    .peek-art {
        width: 26px;
        height: 26px;
    }

    .peek-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .peek-title {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
    }

    /* ── HUD VOLUME STATE (260 × 44, miniplayer.md §5.11) ─ */
    .layer-hud {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 16px;
        color: #ffffff;
    }

    .hud-track {
        flex: 1;
        height: 4px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 9999px;
        overflow: hidden;
    }

    .hud-fill {
        height: 100%;
        background: var(--accent, #ff375f);
        border-radius: 9999px;
    }

    .hud-value {
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.6);
        width: 32px;
        text-align: right;
    }

    /* ── EXPANDED STATE (380 × 160, miniplayer.md §6) ──── */
    .layer-expanded {
        box-sizing: border-box;
        flex-direction: column;
        justify-content: space-between;
        padding: 16px;
        overflow: hidden;
    }

    .exp-top {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 48px;
    }

    .art-exp {
        width: 48px;
        height: 48px;
        border-radius: 10px;
        overflow: hidden;
        flex-shrink: 0;
        border: none;
        padding: 0;
        cursor: pointer;
        background: #1c1c1e;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .art-exp:hover {
        transform: scale(1.04);
    }

    .art-exp.paused {
        transform: scale(0.88);
    }

    .art-exp img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .exp-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        overflow: hidden;
    }

    .marquee-wrapper {
        width: 100%;
        overflow: hidden;
        white-space: nowrap;
        position: relative;
    }

    .exp-title {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: -0.01em;
        line-height: 1.25;
    }

    .exp-artist {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.25;
    }

    .exp-top-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        position: relative;
    }

    .viz-exp {
        display: flex;
        align-items: center;
        gap: 3.5px;
        height: 22px;
        margin-right: 2px;
        flex-shrink: 0;
    }

    .exp-vbar {
        width: 3.5px;
        min-height: 3px;
        border-radius: 9999px;
        background: var(--accent, #ff375f);
        filter: drop-shadow(0 0 5px var(--accent, #ff375f));
        transition: height 60ms linear;
    }

    .action-btn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease, background 150ms ease, color 150ms ease, transform 150ms ease;
    }

    .action-btn::after {
        content: "";
        position: absolute;
        inset: -10px;
    }

    /* Reveal subtle actions on hover */
    .pill:hover .action-btn {
        opacity: 0.8;
        pointer-events: auto;
    }

    .action-btn:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
        transform: scale(1.08);
    }

    .action-btn.close-btn:hover {
        background: rgba(255, 69, 58, 0.25);
        color: #ff453a;
    }

    /* Middle: Scrubber */
    .exp-seek {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        margin-top: 2px;
        margin-bottom: 2px;
    }

    .time-label {
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.4);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .scrubber-track {
        flex: 1;
        height: 18px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
    }

    .scrubber-track::before {
        content: "";
        position: absolute;
        inset: 7px 0;
        height: 4px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 9999px;
        transition: height 150ms ease, inset 150ms ease;
    }

    .scrubber-track:hover::before,
    .scrubber-track:focus-visible::before {
        inset: 6px 0;
        height: 6px;
    }

    .scrubber-fill {
        position: absolute;
        top: 7px;
        bottom: 7px;
        left: 0;
        right: 0;
        height: 4px;
        transform-origin: left center;
        background: var(--accent, #ff375f);
        border-radius: 9999px;
        pointer-events: none;
        transition: height 150ms ease, top 150ms ease, bottom 150ms ease;
    }

    .scrubber-track:hover .scrubber-fill,
    .scrubber-track:focus-visible .scrubber-fill {
        top: 6px;
        bottom: 6px;
        height: 6px;
    }

    .scrubber-thumb {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ffffff;
        pointer-events: none;
        opacity: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
        transition: opacity 150ms ease, transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .scrubber-track:hover .scrubber-thumb,
    .scrubber-track:focus-visible .scrubber-thumb {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.1);
    }

    /* Bottom: Transport Controls (Apple Dynamic Island style) */
    .exp-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 32px;
        width: 100%;
        margin-top: 2px;
    }

    .ctrl-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), background 150ms ease, opacity 150ms ease;
    }

    /* Solid filled glyphs for all three buttons (Apple Dynamic Island) */
    .ctrl-btn :global(svg) {
        fill: currentColor;
    }
    .ctrl-btn :global(svg polygon),
    .ctrl-btn :global(svg rect),
    .ctrl-btn :global(svg path) {
        fill: currentColor;
    }

    .ctrl-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        transform: scale(1.12);
    }

    .ctrl-btn:active {
        transform: scale(0.9);
        background: rgba(255, 255, 255, 0.16);
    }

    .play-btn {
        background: transparent;
        color: #ffffff;
        box-shadow: none;
    }

    .play-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        transform: scale(1.12);
        box-shadow: none;
    }

    .play-btn:active {
        transform: scale(0.9);
    }

    /* ── Focus Outline (WCAG AA & R-32) ────────────────── */
    .art-exp:focus-visible,
    .action-btn:focus-visible,
    .ctrl-btn:focus-visible,
    .scrubber-track:focus-visible {
        outline: 2px solid var(--accent, #ff375f);
        outline-offset: 2px;
    }

    /* ── Tooltips ──────────────────────────────────────── */
    [data-tip] {
        position: relative;
    }

    [data-tip]::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: #1c1c1e;
        color: #ffffff;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        padding: 4px 8px;
        border-radius: 6px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 120ms ease;
        z-index: 10001;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    [data-tip]:hover::after {
        opacity: 1;
    }

    .exp-top [data-tip]::after {
        bottom: auto;
        top: calc(100% + 6px);
    }

    /* ── Reduced Motion (miniplayer.md §11) ────────────── */
    @media (prefers-reduced-motion: reduce) {
        .pill {
            transition: none !important;
        }
        .content-layer {
            animation: none !important;
            filter: none !important;
            transform: none !important;
        }
        .art-compact,
        .art-exp {
            transition: none !important;
        }
    }
</style>
