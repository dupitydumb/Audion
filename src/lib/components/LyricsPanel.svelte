<script lang="ts">
    import { onMount } from "svelte";
    import { derived } from "svelte/store";
    import {
        lyricsData,
        lyricsLoading,
        lyricsError,
        lyricsVisible,
        activeLine,
        initLyricsSync,
        destroyLyricsSync,
    } from "$lib/stores/lyrics";
    import {
        currentTrack,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";

    let lyricsContainer: HTMLDivElement;
    let lineElements: HTMLDivElement[] = [];

    // Combined reactive state for word-by-word sync (single derived for efficiency)
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

            // Find the word that's currently active (within its start-end range)
            let activeWordIdx = -1;
            for (let i = 0; i < line.words.length; i++) {
                const word = line.words[i];
                // Word is active if current time is between its start and end time
                if ($time >= word.time && $time <= word.endTime) {
                    activeWordIdx = i;
                    break;
                }
                // Also mark as active if we're past this word but before next word starts
                // (handles gaps between words)
                if ($time >= word.time) {
                    const nextWord = line.words[i + 1];
                    if (!nextWord || $time < nextWord.time) {
                        activeWordIdx = i;
                    }
                }
            }

            // Calculate progress for active word using actual end time
            let progress = 0;
            if (activeWordIdx >= 0) {
                const word = line.words[activeWordIdx];
                const wordStart = word.time;
                const wordEnd = word.endTime; // Use actual end time from Musixmatch
                const duration = wordEnd - wordStart;

                if (duration > 0) {
                    const elapsed = $time - wordStart;
                    // Clamp to 100% when we reach the end time
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
        // Same line
        if (wordIdx < currentActiveWord) return "past";
        if (wordIdx === currentActiveWord) return "highlighted";
        return "future";
    }

    // Scroll to active line
    $: if ($activeLine >= 0 && lineElements[$activeLine] && lyricsContainer) {
        const element = lineElements[$activeLine];
        const containerHeight = lyricsContainer.clientHeight;
        const elementTop = element.offsetTop;
        const elementHeight = element.clientHeight;

        // Center the active line
        const scrollTo = elementTop - containerHeight / 2 + elementHeight / 2;
        lyricsContainer.scrollTo({
            top: scrollTo,
            behavior: "smooth",
        });
    }

    // Seek to a specific lyric line time
    function handleLineClick(lineTime: number) {
        const dur = $duration;
        if (dur && dur > 0) {
            const position = lineTime / dur;
            seek(Math.max(0, Math.min(1, position)));
        }
    }

    onMount(() => {
        initLyricsSync();
        return () => destroyLyricsSync();
    });
</script>

{#if $lyricsVisible}
    <aside class="lyrics-panel">
        <header class="lyrics-header">
            <h3>Lyrics</h3>
            <button
                class="close-btn"
                on:click={() => lyricsVisible.set(false)}
                title="Close lyrics panel"
                aria-label="Close lyrics panel"
            >
                <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="currentColor"
                >
                    <path
                        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                    />
                </svg>
            </button>
        </header>

        <div class="lyrics-content" bind:this={lyricsContainer}>
            {#if $lyricsLoading}
                <div class="lyrics-status">
                    <div class="loading-spinner"></div>
                    <span>Searching for lyrics...</span>
                </div>
            {:else if $lyricsError && !$lyricsData}
                <div class="lyrics-status">
                    <svg
                        viewBox="0 0 24 24"
                        width="48"
                        height="48"
                        fill="currentColor"
                    >
                        <path
                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                        />
                    </svg>
                    <span>No lyrics found</span>
                    {#if $currentTrack}
                        <span class="lyrics-track-info">
                            {$currentTrack.title || "Unknown"} - {$currentTrack.artist ||
                                "Unknown"}
                        </span>
                    {/if}
                </div>
            {:else if $lyricsData && $lyricsData.lines.length > 0}
                <div class="lyrics-lines">
                    {#each $lyricsData.lines as line, i}
                        {@const distance = Math.abs(i - $activeLine)}
                        {@const hasWordSync =
                            line.words && line.words.length > 0}
                        {@const isActiveLine = i === $activeLine}
                        <div
                            class="lyric-line"
                            class:active={isActiveLine}
                            class:near={distance === 1}
                            class:mid={distance === 2}
                            class:far={distance >= 3}
                            class:past={i < $activeLine}
                            class:word-sync={hasWordSync && isActiveLine}
                            bind:this={lineElements[i]}
                            on:click={() => handleLineClick(line.time)}
                            on:keydown={(e) =>
                                e.key === "Enter" && handleLineClick(line.time)}
                            role="button"
                            tabindex="0"
                        >
                            {#if hasWordSync && line.words}
                                {#each line.words as word, wordIdx}
                                    {@const wordState = getWordState(
                                        i,
                                        wordIdx,
                                        $activeLine,
                                        $wordSyncState.activeWordIdx,
                                    )}
                                    {@const progress =
                                        isActiveLine &&
                                        wordIdx === $wordSyncState.activeWordIdx
                                            ? $wordSyncState.progress
                                            : 0}
                                    <span
                                        class="lyric-word {wordState}"
                                        style="--word-progress: {progress}%;"
                                        >{word.word}</span
                                    >{#if wordIdx < line.words.length - 1}{" "}{/if}
                                {/each}
                            {:else}
                                {line.text}
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else if !$currentTrack}
                <div class="lyrics-status">
                    <svg
                        viewBox="0 0 24 24"
                        width="48"
                        height="48"
                        fill="currentColor"
                    >
                        <path
                            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                        />
                    </svg>
                    <span>Play a track to see lyrics</span>
                </div>
            {/if}
        </div>

        {#if $lyricsData}
            <footer class="lyrics-footer">
                <span class="lyrics-source">
                    Source: {$lyricsData.source === "cache"
                        ? "Cached"
                        : $lyricsData.source === "lrclib"
                          ? "LRCLIB"
                          : "Musixmatch"}
                </span>
            </footer>
        {/if}
    </aside>
{/if}

<style>
    .lyrics-panel {
        /* Theme-aware lyrics colors - light theme default */
        --lyrics-inactive: rgba(0, 0, 0, 0.4);
        --lyrics-near: rgba(0, 0, 0, 0.5);
        --lyrics-mid: rgba(0, 0, 0, 0.35);
        --lyrics-far: rgba(0, 0, 0, 0.25);
        --lyrics-past-near: rgba(0, 0, 0, 0.45);
        --lyrics-past-mid: rgba(0, 0, 0, 0.3);
        --lyrics-past-far: rgba(0, 0, 0, 0.2);

        width: 350px;
        min-width: 300px;
        max-width: 400px;
        height: 100%;
        min-height: 0;
        background: linear-gradient(
            180deg,
            var(--bg-elevated) 0%,
            var(--bg-base) 100%
        );
        border-left: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        animation: slideIn 0.3s ease;
    }

    /* Dark theme overrides */
    :global([data-theme="dark"]) .lyrics-panel {
        --lyrics-inactive: rgba(255, 255, 255, 0.4);
        --lyrics-near: rgba(255, 255, 255, 0.5);
        --lyrics-mid: rgba(255, 255, 255, 0.35);
        --lyrics-far: rgba(255, 255, 255, 0.25);
        --lyrics-past-near: rgba(255, 255, 255, 0.45);
        --lyrics-past-mid: rgba(255, 255, 255, 0.3);
        --lyrics-past-far: rgba(255, 255, 255, 0.2);
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(20px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    .lyrics-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .lyrics-header h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-full);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
        transform: scale(1.05);
    }

    .lyrics-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-xl) var(--spacing-md);
        scroll-behavior: smooth;
    }

    .lyrics-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--spacing-md);
        color: var(--text-subdued);
        text-align: center;
    }

    .loading-spinner {
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

    .lyrics-track-info {
        font-size: 0.75rem;
        opacity: 0.7;
        margin-top: var(--spacing-sm);
    }

    .lyrics-lines {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        padding-bottom: 50%;
        padding-top: var(--spacing-xl);
    }

    .lyric-line {
        font-size: 1.1rem;
        font-weight: 600;
        line-height: 1.5;
        color: var(--lyrics-inactive);
        transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
        cursor: pointer;
        filter: blur(0px);
    }

    /* Distance-based blur effect like Apple Music */
    .lyric-line.near {
        color: var(--lyrics-near);
    }

    .lyric-line.mid {
        color: var(--lyrics-mid);
    }

    .lyric-line.far {
        color: var(--lyrics-far);
    }

    .lyric-line.active {
        color: var(--text-primary);
        font-weight: 700;
        filter: blur(0px);
    }

    /* Style for parenthetical lyrics (background vocals) */
    .lyric-line :global(.parenthetical) {
        font-style: italic;
        opacity: 0.8;
    }

    .lyric-line.past.near {
        color: var(--lyrics-past-near);
        filter: blur(0.8px);
    }

    .lyric-line.past.mid {
        color: var(--lyrics-past-mid);
        filter: blur(1.2px);
    }

    .lyric-line.past.far {
        color: var(--lyrics-past-far);
        filter: blur(2px);
    }

    /* Word highlighting - Apple Music style */
    .lyric-word {
        --word-progress: 0%;
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
            var(--text-primary) 0%,
            var(--text-primary) calc(var(--word-progress) - 15%),
            var(--lyrics-inactive) calc(var(--word-progress) + 15%),
            var(--lyrics-inactive) 100%
        );
    }

    .lyric-line.word-sync .lyric-word.past {
        background-image: linear-gradient(
            to right,
            var(--text-primary) 0%,
            var(--text-primary) 100%
        );
    }

    .lyric-line.word-sync .lyric-word.future {
        background-image: linear-gradient(
            to right,
            var(--lyrics-inactive) 0%,
            var(--lyrics-inactive) 100%
        );
    }

    /* Past lines - all words fully highlighted */
    .lyric-line.past .lyric-word {
        background-image: linear-gradient(
            to right,
            var(--text-primary) 0%,
            var(--text-primary) 100%
        );
    }

    /* Future lines - all words dimmed */
    .lyric-line:not(.active):not(.past) .lyric-word {
        background-image: linear-gradient(
            to right,
            var(--lyrics-inactive) 0%,
            var(--lyrics-inactive) 100%
        );
    }

    .lyrics-footer {
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--border-color);
        flex-shrink: 0;
        opacity: 0.5;
        transition: opacity var(--transition-fast);
    }

    .lyrics-footer:hover {
        opacity: 1;
    }

    .lyrics-source {
        font-size: 0.65rem;
        color: var(--text-subdued);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
</style>
