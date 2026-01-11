<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import { derived } from "svelte/store";
    import { isFullScreen, toggleFullScreen } from "$lib/stores/ui";
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
    import { lyricsData, activeLine } from "$lib/stores/lyrics";
    import { getAlbumArtSrc, getAlbum, formatDuration } from "$lib/api/tauri";
    import { onMount, tick } from "svelte";

    let albumArt: string | null = null;
    let lyricsContainer: HTMLDivElement;

    // Combined reactive state for word-by-word sync
    const wordSyncState = derived(
        [lyricsData, currentTime, activeLine],
        ([$lyrics, $time, $activeLineIdx]) => {
            if (!$lyrics || $activeLineIdx < 0) {
                return { activeWordIdx: -1, progress: 0 };
            }

            const line = $lyrics.lines[$activeLineIdx];
            if (!line?.words || line.words.length === 0) {
                return { activeWordIdx: -1, progress: 0 };
            }

            // Find the word that's currently active
            let activeWordIdx = -1;
            for (let i = 0; i < line.words.length; i++) {
                const word = line.words[i];
                if ($time >= word.time && $time <= word.endTime) {
                    activeWordIdx = i;
                    break;
                }
                if ($time >= word.time) {
                    const nextWord = line.words[i + 1];
                    if (!nextWord || $time < nextWord.time) {
                        activeWordIdx = i;
                    }
                }
            }

            // Calculate progress for active word
            let progress = 0;
            if (activeWordIdx >= 0) {
                const word = line.words[activeWordIdx];
                const wordStart = word.time;
                const wordEnd = word.endTime;
                const duration = wordEnd - wordStart;

                if (duration > 0) {
                    const elapsed = $time - wordStart;
                    progress = Math.min(
                        100,
                        Math.max(0, (elapsed / duration) * 100),
                    );
                } else {
                    progress = 100;
                }
            }

            return { activeWordIdx, progress };
        },
    );

    // Get word state: 'past', 'highlighted', or 'future'
    function getWordState(
        lineIdx: number,
        wordIdx: number,
        currentActiveLine: number,
        currentActiveWord: number,
    ): string {
        if (lineIdx < currentActiveLine) return "past";
        if (lineIdx > currentActiveLine) return "future";
        if (wordIdx < currentActiveWord) return "past";
        if (wordIdx === currentActiveWord) return "highlighted";
        return "future";
    }

    // Load album art
    // Load album art
    $: if ($currentTrack) {
        if ($currentTrack.cover_url) {
            albumArt = $currentTrack.cover_url;
        } else if ($currentTrack.album_id) {
            loadAlbumArt($currentTrack.album_id);
        } else {
            albumArt = null;
        }
    } else {
        albumArt = null;
    }

    async function loadAlbumArt(albumId: number) {
        try {
            const album = await getAlbum(albumId);
            albumArt = album ? getAlbumArtSrc(album.art_data) : null;
        } catch {
            albumArt = null;
        }
    }

    // Auto-scroll lyrics
    $: if ($activeLine !== -1 && lyricsContainer) {
        scrollToCurrentLine();
    }

    async function scrollToCurrentLine() {
        await tick();
        if (!lyricsContainer) return;

        const activeLine = lyricsContainer.querySelector(".lyric-line.active");
        if (activeLine) {
            activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }

    function handleSeek(e: MouseEvent) {
        const bar = e.currentTarget as HTMLDivElement;
        const rect = bar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        seek(Math.max(0, Math.min(1, pos)));
    }
</script>

{#if $isFullScreen}
    <div class="fullscreen-player" transition:fade={{ duration: 300 }}>
        <!-- Background with blur -->
        <div
            class="background-layer"
            style="background-image: url({albumArt || ''})"
        ></div>
        <div class="backdrop-layer"></div>

        <button class="close-btn" on:click={toggleFullScreen}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                <path
                    d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                />
            </svg>
        </button>

        <div class="player-content">
            <!-- Left Panel: Art & Controls -->
            <div class="left-panel">
                <div
                    class="art-container"
                    in:fly={{ y: 20, duration: 500, delay: 100 }}
                >
                    {#if albumArt}
                        <img src={albumArt} alt="Album Art" decoding="async" />
                    {:else}
                        <div class="art-placeholder">
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="64"
                                height="64"
                            >
                                <path
                                    d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                                />
                            </svg>
                        </div>
                    {/if}
                </div>

                <div class="track-info">
                    <h1 class="track-title">
                        {$currentTrack?.title || "Unknown Title"}
                    </h1>
                    <h2 class="track-artist">
                        {$currentTrack?.artist || "Unknown Artist"}
                    </h2>
                </div>

                <div class="player-controls">
                    <div class="progress-bar-container">
                        <span class="time">{formatDuration($currentTime)}</span>
                        <div class="progress-bar" on:click={handleSeek}>
                            <div
                                class="progress-fill"
                                style="width: {$progress * 100}%"
                            ></div>
                        </div>
                        <span class="time">{formatDuration($duration)}</span>
                    </div>

                    <div class="buttons">
                        <button class="icon-btn large" on:click={previousTrack}>
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="32"
                                height="32"
                            >
                                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                            </svg>
                        </button>
                        <button class="play-btn large" on:click={togglePlay}>
                            {#if $isPlaying}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="40"
                                    height="40"
                                >
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                </svg>
                            {:else}
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    width="40"
                                    height="40"
                                >
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            {/if}
                        </button>
                        <button class="icon-btn large" on:click={nextTrack}>
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="32"
                                height="32"
                            >
                                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Right Panel: Lyrics -->
            <div class="right-panel">
                <div class="lyrics-container" bind:this={lyricsContainer}>
                    {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
                        {#each $lyricsData.lines as line, i}
                            {@const distance = Math.abs(i - $activeLine)}
                            {@const hasWordSync =
                                line.words && line.words.length > 0}
                            {@const isActiveLine = i === $activeLine}
                            <p
                                class="lyric-line"
                                class:active={isActiveLine}
                                class:near={distance === 1}
                                class:mid={distance === 2}
                                class:far={distance >= 3}
                                class:passed={i < $activeLine}
                                class:word-sync={hasWordSync && isActiveLine}
                            >
                                {#if hasWordSync && line.words}
                                    {#each line.words as word, wordIdx}
                                        {@const wordState = getWordState(
                                            i,
                                            wordIdx,
                                            $activeLine,
                                            $wordSyncState.activeWordIdx,
                                        )}
                                        {@const wordProgress =
                                            isActiveLine &&
                                            wordIdx ===
                                                $wordSyncState.activeWordIdx
                                                ? $wordSyncState.progress
                                                : 0}
                                        <span
                                            class="lyric-word {wordState}"
                                            style="--word-progress: {wordProgress}%;"
                                            >{word.word}</span
                                        >{#if wordIdx < line.words.length - 1}{" "}{/if}
                                    {/each}
                                {:else}
                                    {line.text}
                                {/if}
                            </p>
                        {/each}
                    {:else}
                        <div class="no-lyrics">
                            <p>No lyrics available</p>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .fullscreen-player {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2000;
        background-color: var(--bg-base);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .background-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-size: cover;
        background-position: center;
        filter: blur(60px) brightness(0.4);
        transform: scale(1.1);
        z-index: -2;
    }

    .backdrop-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: -1;
    }

    .close-btn {
        position: absolute;
        top: var(--spacing-lg);
        right: var(--spacing-lg);
        color: var(--text-secondary);
        z-index: 10;
        opacity: 0.7;
        transition: opacity var(--transition-fast);
    }

    .close-btn:hover {
        opacity: 1;
        color: var(--text-primary);
    }

    .player-content {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        padding: var(--spacing-xl);
        gap: var(--spacing-md);
        max-width: 1600px;
        margin: 0 auto;
        width: 100%;
        height: 100%;
        max-height: 100vh;
        align-items: center;
        overflow: hidden;
    }

    .left-panel {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: var(--spacing-lg);
        padding-left: var(--spacing-xl);
        height: 100%;
        max-height: calc(100vh - var(--spacing-xl) * 2);
        overflow: hidden;
    }

    .art-container {
        width: 100%;
        max-width: min(400px, 45vh);
        aspect-ratio: 1;
        border-radius: var(--radius-lg);
        overflow: hidden;
        box-shadow: var(--shadow-lg);
        background-color: var(--bg-surface);
        flex-shrink: 0;
    }

    .art-container img {
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
        color: var(--text-subdued);
    }

    .track-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex-shrink: 0;
    }

    .track-title {
        font-size: clamp(1.5rem, 4vw, 2.5rem);
        font-weight: 800;
        line-height: 1.1;
    }

    .track-artist {
        font-size: clamp(1rem, 2vw, 1.25rem);
        color: var(--text-secondary);
        font-weight: 500;
    }

    .player-controls {
        width: 100%;
        max-width: min(400px, 45vh);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        flex-shrink: 0;
    }

    .progress-bar-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        width: 100%;
    }

    .progress-bar {
        flex: 1;
        height: 6px;
        background-color: rgba(255, 255, 255, 0.2);
        border-radius: var(--radius-full);
        cursor: pointer;
        position: relative;
    }

    .progress-fill {
        height: 100%;
        background-color: var(--text-primary);
        border-radius: var(--radius-full);
        transition: width 0.1s linear;
    }

    .progress-bar:hover .progress-fill {
        background-color: var(--accent-primary);
    }

    .buttons {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xl);
    }

    .icon-btn.large {
        width: 48px;
        height: 48px;
    }

    .play-btn.large {
        width: 64px;
        height: 64px;
        background-color: var(--text-primary);
        color: black;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform var(--transition-fast);
    }

    .play-btn.large:hover {
        transform: scale(1.05);
    }

    /* Right Panel (Lyrics) */
    .right-panel {
        height: 100%;
        max-height: 80vh;
        overflow: hidden;
        mask-image: linear-gradient(
            to bottom,
            transparent,
            black 15%,
            black 85%,
            transparent
        );
        -webkit-mask-image: linear-gradient(
            to bottom,
            transparent,
            black 15%,
            black 85%,
            transparent
        );
    }

    .lyrics-container {
        display: flex;
        flex-direction: column;
        padding: 40vh 0; /* buffer to center first/last lines */
        height: 100%;
        overflow-y: auto;
        -ms-overflow-style: none;
        scrollbar-width: none;
        gap: var(--spacing-sm);
    }

    .lyrics-container::-webkit-scrollbar {
        display: none;
    }

    .lyric-line {
        font-size: 1.75rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.4);
        padding: var(--spacing-sm) 0;
        transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
        filter: blur(0px);
        cursor: pointer;
        line-height: 1.4;
    }

    /* Distance-based blur effect like Apple Music */
    .lyric-line.near {
        color: rgba(255, 255, 255, 0.5);
        filter: blur(1px);
    }

    .lyric-line.mid {
        color: rgba(255, 255, 255, 0.35);
        filter: blur(2px);
    }

    .lyric-line.far {
        color: rgba(255, 255, 255, 0.25);
        filter: blur(3px);
    }

    .lyric-line.active {
        color: var(--text-primary);
        filter: blur(0px);
        text-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
    }

    .lyric-line.passed.near {
        color: rgba(255, 255, 255, 0.45);
        filter: blur(1.5px);
    }

    .lyric-line.passed.mid {
        color: rgba(255, 255, 255, 0.3);
        filter: blur(2.5px);
    }

    .lyric-line.passed.far {
        color: rgba(255, 255, 255, 0.2);
        filter: blur(3.5px);
    }

    /* Word highlighting - Apple Music style */
    .lyric-word {
        --word-progress: 0%;
        --highlight-color: #fff;
        --future-color: rgba(255, 255, 255, 0.35);
        display: inline;
        color: transparent;
        background-clip: text;
        -webkit-background-clip: text;
        background-size: 200% 100%;
        will-change: background-position;
    }

    .lyric-line.word-sync .lyric-word.highlighted {
        background-image: linear-gradient(
            to right,
            var(--highlight-color) 0%,
            var(--highlight-color) var(--word-progress),
            var(--future-color) var(--word-progress),
            var(--future-color) 100%
        );
    }

    .lyric-line.word-sync .lyric-word.past {
        background-image: linear-gradient(
            to right,
            var(--highlight-color) 0%,
            var(--highlight-color) 100%
        );
    }

    .lyric-line.word-sync .lyric-word.future {
        background-image: linear-gradient(
            to right,
            var(--future-color) 0%,
            var(--future-color) 100%
        );
    }

    /* Past lines - all words fully highlighted */
    .lyric-line.passed .lyric-word {
        background-image: linear-gradient(
            to right,
            var(--highlight-color) 0%,
            var(--highlight-color) 100%
        );
    }

    /* Future lines - all words dimmed */
    .lyric-line:not(.active):not(.passed) .lyric-word {
        background-image: linear-gradient(
            to right,
            var(--future-color) 0%,
            var(--future-color) 100%
        );
    }

    .no-lyrics {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        font-size: 1.5rem;
    }
</style>
