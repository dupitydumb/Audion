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
        fetchLyricsForTrack,
    } from "$lib/stores/lyrics";
    import {
        currentTrack,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";
    import { isMobile } from "$lib/stores/mobile";
    import { addToast } from "$lib/stores/toast";

    let lyricsContainer: HTMLDivElement;
    let lineElements: HTMLDivElement[] = [];
    let scrollAnimationId: number | null = null;
    let prevActiveLine = -1;

    function easeOutExpo(t: number): number {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

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

    // Apple Music-style smooth scroll with custom easing
    $: if (
        $activeLine >= 0 &&
        lineElements[$activeLine] &&
        lyricsContainer &&
        $activeLine !== prevActiveLine
    ) {
        prevActiveLine = $activeLine;
        smoothScrollToActive();
    }

    function smoothScrollToActive() {
        if (!lyricsContainer) return;
        const element = lineElements[prevActiveLine];
        if (!element) return;

        // Cancel any ongoing scroll animation
        if (scrollAnimationId) {
            cancelAnimationFrame(scrollAnimationId);
        }

        const containerHeight = lyricsContainer.clientHeight;
        const elementTop = element.offsetTop;
        const elementHeight = element.clientHeight;
        const targetScroll =
            elementTop - containerHeight / 2 + elementHeight / 2;

        const startScroll = lyricsContainer.scrollTop;
        const distance = targetScroll - startScroll;
        const duration = 550;
        let startTime: number | null = null;

        function step(timestamp: number) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutExpo(progress);

            lyricsContainer.scrollTop = startScroll + distance * eased;

            if (progress < 1) {
                scrollAnimationId = requestAnimationFrame(step);
            } else {
                scrollAnimationId = null;
            }
        }

        scrollAnimationId = requestAnimationFrame(step);
    }

    // Seek to a specific lyric line time
    function handleLineClick(lineTime: number) {
        const dur = $duration;
        if (dur && dur > 0) {
            const position = lineTime / dur;
            seek(Math.max(0, Math.min(1, position)));
        }
    }

    // Import LRC file handler
    async function handleImportLrc() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".lrc";
        input.style.display = "none";
        document.body.appendChild(input);
        input.click();
        await new Promise((resolve) => {
            input.onchange = resolve;
        });
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = async (e) => {
                const lrcContent = e.target?.result as string;
                await importLrcContent(lrcContent);
            };
            reader.readAsText(file);
        }
        document.body.removeChild(input);
    }

    async function importLrcContent(lrcContent: string) {
        // Save to cache for current track
        if (!$currentTrack) {
            addToast("No track selected for lyrics import.", "error");
            return;
        }
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("save_lrc_file", {
                musicPath: $currentTrack.path,
                lrcContent,
            });
            // Reload lyrics
            await fetchLyricsForTrack();
            addToast("Lyrics imported successfully!", "success");
        } catch (e) {
            addToast("Failed to import lyrics.", "error");
        }
    }

    onMount(() => {
        initLyricsSync();
        return () => destroyLyricsSync();
    });
</script>

{#if $lyricsVisible}
    <aside class="lyrics-panel" class:mobile={$isMobile}>
        <header class="lyrics-header">
            <h3>Lyrics</h3>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                <button
                    class="icon-btn"
                    title="Import LRC file"
                    aria-label="Import LRC file"
                    on:click={handleImportLrc}
                >
                    <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                    >
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7z" />
                        <path d="M5 18h14v2H5z" />
                    </svg>
                </button>
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
            </div>
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
                        {@const clampedDist = Math.min(distance, 6)}
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
                            style="--line-distance: {clampedDist};"
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
        mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            black 8%,
            black 90%,
            transparent 100%
        );
        -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            black 8%,
            black 90%,
            transparent 100%
        );
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
        gap: 2px;
        padding-bottom: 50%;
        padding-top: var(--spacing-lg);
    }

    .lyric-line {
        --line-distance: 6;
        font-size: 1.15rem;
        font-weight: 700;
        line-height: 1.6;
        color: var(--lyrics-inactive);
        padding: 12px 0;
        letter-spacing: -0.01em;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        /* Apple Music spring curve with slight overshoot */
        transition:
            transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275),
            color 0.4s cubic-bezier(0.25, 0.1, 0.25, 1),
            filter 0.45s cubic-bezier(0.25, 0.1, 0.25, 1),
            opacity 0.4s cubic-bezier(0.25, 0.1, 0.25, 1),
            text-shadow 0.45s ease;
        filter: blur(calc(var(--line-distance) * 0.5px));
        opacity: calc(1 - var(--line-distance) * 0.1);
        transform: scale(0.96) translateY(0);
        transform-origin: left center;
        cursor: pointer;
    }

    .lyric-line:hover {
        color: var(--text-secondary);
        filter: blur(0px);
        opacity: 1;
    }

    /* Distance-based depth — progressive blur & fade */
    .lyric-line.near {
        color: var(--lyrics-near);
        filter: blur(0.3px);
        opacity: 0.85;
        transform: scale(0.98);
    }

    .lyric-line.mid {
        color: var(--lyrics-mid);
        filter: blur(1px);
        opacity: 0.65;
        transform: scale(0.96);
    }

    .lyric-line.far {
        color: var(--lyrics-far);
        filter: blur(calc(var(--line-distance) * 0.5px));
        opacity: calc(0.55 - var(--line-distance) * 0.05);
        transform: scale(0.95);
    }

    /* Active line: scale up, glow, no blur */
    .lyric-line.active {
        color: var(--text-primary);
        font-weight: 800;
        filter: blur(0px);
        opacity: 1;
        transform: scale(1) translateY(0);
    }

    :global([data-theme="dark"]) .lyric-line.active {
        text-shadow:
            0 0 20px rgba(255, 255, 255, 0.15),
            0 0 40px rgba(255, 255, 255, 0.06);
    }

    /* Style for parenthetical lyrics (background vocals) */
    .lyric-line :global(.parenthetical) {
        font-style: italic;
        opacity: 0.8;
    }

    /* Passed lines mirror future but slightly more faded */
    .lyric-line.past.near {
        color: var(--lyrics-past-near);
        opacity: 0.75;
        filter: blur(0.6px);
        transform: scale(0.97);
    }

    .lyric-line.past.mid {
        color: var(--lyrics-past-mid);
        opacity: 0.55;
        filter: blur(1.2px);
        transform: scale(0.95);
    }

    .lyric-line.past.far {
        color: var(--lyrics-past-far);
        opacity: calc(0.45 - var(--line-distance) * 0.05);
        filter: blur(calc(var(--line-distance) * 0.6px));
        transform: scale(0.94);
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
        transition: text-shadow 0.2s ease;
    }

    /* Active word being filled — soft gradient edge (8% feather) */
    .lyric-line.word-sync .lyric-word.highlighted {
        background-image: linear-gradient(
            to right,
            var(--text-primary) 0%,
            var(--text-primary) calc(var(--word-progress) - 4%),
            var(--lyrics-inactive) calc(var(--word-progress) + 4%),
            var(--lyrics-inactive) 100%
        );
    }

    :global([data-theme="dark"]) .lyric-line.word-sync .lyric-word.highlighted {
        text-shadow: 0 0 12px rgba(255, 255, 255, 0.15);
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

    /* Mobile: full-screen overlay */
    .lyrics-panel.mobile {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        z-index: 150;
        border-left: none;
        border-radius: 0;
    }

    .lyrics-panel.mobile .lyrics-header {
        padding: var(--spacing-md);
        padding-top: calc(var(--spacing-md) + env(safe-area-inset-top, 0px));
    }

    .lyrics-panel.mobile .close-btn {
        width: 44px;
        height: 44px;
    }

    .lyrics-panel.mobile .lyric-line {
        font-size: 1.1rem;
    }

    .lyrics-panel.mobile .lyric-line.active {
        font-size: 1.2rem;
    }
</style>
