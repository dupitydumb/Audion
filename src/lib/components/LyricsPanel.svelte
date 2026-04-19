<script lang="ts">
    import { onMount } from "svelte";
    import { derived } from "svelte/store";
    import {
        lyricsData,
        lyricsLoading,
        lyricsError,
        lyricsVisible,
        activeLine,
        availableSources,
        selectedSource,
        initLyricsSync,
        destroyLyricsSync,
        fetchLyricsForTrack,
        switchLyricsSource,
        wordSyncState,
    } from "$lib/stores/lyrics";
    import {
        currentTrack,
        currentTime,
        duration,
        seek,
    } from "$lib/stores/player";
    import { isMobile } from "$lib/stores/mobile";
    import { addToast } from "$lib/stores/toast";
    import { importLyricsContent } from "$lib/stores/lyrics";
    import { LYRICS_SOURCES, type LyricsSource, type WordTiming } from "$lib/lyrics";

    // -------------------------------------------------------------------------
    // Smooth scroll
    // -------------------------------------------------------------------------

    let lyricsContainer: HTMLDivElement;
    let lineElements: HTMLDivElement[] = [];
    let scrollAnimationId: number | null = null;
    let prevActiveLine = -1;

    function easeOutExpo(t: number): number {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    $: if (
        !isUnsynced &&
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
        const targetScroll = element.offsetTop - containerHeight / 2 + element.clientHeight / 2;

        const startScroll = lyricsContainer.scrollTop;
        const distance = targetScroll - startScroll;
        const duration = 550;
        let startTime: number | null = null;

        function step(timestamp: number) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            lyricsContainer.scrollTop = startScroll + distance * easeOutExpo(progress);
            if (progress < 1) {
                scrollAnimationId = requestAnimationFrame(step);
            } else {
                scrollAnimationId = null;
            }
        }

        scrollAnimationId = requestAnimationFrame(step);
    }

    // -------------------------------------------------------------------------
    // Word / syllable progress helpers
    // -------------------------------------------------------------------------

    /**
     * Word state for the active line only: 'past' | 'highlighted' | 'future'.
     * Only called when rendering the active line's word spans.
     */
    function getWordState(wordIdx: number, activeWordIdx: number): string {
        if (wordIdx < activeWordIdx)  return 'past';
        if (wordIdx === activeWordIdx) return 'highlighted';
        return 'future';
    }

    /**
     * Syllable progress (0-100) for the active word on the active line.
     * Only called for split words on the active line.
     */
    function getSyllableProgress(syllableIdx: number, ws: typeof $wordSyncState): number {
        if (syllableIdx < ws.activeSyllableIdx)   return 100;
        if (syllableIdx === ws.activeSyllableIdx) return ws.syllableProgress;
        return 0;
    }

    /**
     * Background word state for the active line: 'past' | 'highlighted' | 'future'.
     */
    function getBgWordState(wordIdx: number, ws: typeof $wordSyncState): string {
        if (wordIdx < ws.bgActiveWordIdx)   return 'past';
        if (wordIdx === ws.bgActiveWordIdx) return 'highlighted';
        return 'future';
    }

    /**
     * Background syllable progress (0-100) for the active bg word on the active line.
     */
    function getBgSyllableProgress(syllableIdx: number, ws: typeof $wordSyncState): number {
        if (syllableIdx < ws.bgActiveSyllableIdx)   return 100;
        if (syllableIdx === ws.bgActiveSyllableIdx) return ws.bgSyllableProgress;
        return 0;
    }

    // -------------------------------------------------------------------------
    // Seeking
    // -------------------------------------------------------------------------

    function handleLineClick(lineTime: number) {
        const dur = $duration;
        if (dur && dur > 0) seek(Math.max(0, Math.min(1, lineTime / dur)));
    }

    // -------------------------------------------------------------------------
    // Source picker
    // -------------------------------------------------------------------------

    const ALL_SOURCE_LABELS: Record<string, string> = {
        user:     'Imported',
        embedded: 'Embedded',
        ...Object.fromEntries(LYRICS_SOURCES.map((s: LyricsSource) => [s.id, s.label])),
    };

    $: showSourcePicker = LYRICS_SOURCES.length > 1 || $availableSources.includes('embedded');
    $: activeSourceLabel  = $lyricsData
        ? (ALL_SOURCE_LABELS[$lyricsData.source] ?? $lyricsData.source)
        : ($selectedSource ? (ALL_SOURCE_LABELS[$selectedSource] ?? $selectedSource) : '');

    /**
     * True when the result has timestamped lines but no word or syllable sync.
     * Derived from existing data
     */
    $: hasLineSync = !!$lyricsData
        && !$lyricsData.hasWordSync
        && !$lyricsData.hasSyllableSync
        && $lyricsData.lines.some(l => l.time > 0);

    /**
     * True when displaying unsynced embedded tag lyrics . no timestamps at all.
     * In this mode we suppress active/past/distance classes and auto-scroll.
     */
    $: isUnsynced = !!$lyricsData
        && ($lyricsData.source as string) === 'embedded'
        && !($lyricsData as any).synced;

    let sourceMenuOpen = false;
    function toggleSourceMenu()  { sourceMenuOpen = !sourceMenuOpen; }
    function closeSourceMenu()   { sourceMenuOpen = false; }

    // Close the menu whenever a search completes (loading -> done)
    $: if (!$lyricsLoading) sourceMenuOpen = false;

    async function handleSourceSelect(sourceId: string) {
        sourceMenuOpen = false;
        if ($lyricsData?.source === sourceId) return;
        selectedSource.set(sourceId);
        await switchLyricsSource(sourceId);
    }

    // -------------------------------------------------------------------------
    // Import (.lrc, .ttml, .srt)
    // -------------------------------------------------------------------------

    /** Formats the file input accepts. */
    const IMPORT_ACCEPT = ".lrc,.ttml,.xml,.srt,.json";

    async function handleImportLyrics() {
        const input = document.createElement("input");
        input.type    = "file";
        input.accept  = IMPORT_ACCEPT;
        input.style.display = "none";
        document.body.appendChild(input);
        input.click();
        await new Promise(resolve => { input.onchange = resolve; });
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target?.result as string;
            // Determine format from file extension
            const ext = file.name.split('.').pop()?.toLowerCase() ?? 'lrc';
            const format: 'lrc' | 'ttml' | 'srt' | 'json' =
                (ext === 'ttml' || ext === 'xml') ? 'ttml' :
                ext === 'srt' ? 'srt' :
                ext === 'json' ? 'json' :
                'lrc';
            await importLyricsContent(content, format);
        };
        reader.readAsText(file);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    onMount(() => {
        initLyricsSync();
        return () => destroyLyricsSync();
    });
</script>

<!-- Close source menu when clicking anywhere outside it -->
<svelte:window on:click={closeSourceMenu} />

{#if $lyricsVisible}
    <aside class="lyrics-panel" class:mobile={$isMobile}>

        <!-- Header --------------------------------------------------------- -->
        <header class="lyrics-header">
            <h3>Lyrics</h3>

            <div class="header-actions">

                <!-- Source picker -->
                {#if showSourcePicker}
                    <div
                        class="source-picker"
                        role="none"
                        on:click|stopPropagation={toggleSourceMenu}
                    >
                        <button
                            class="source-pill"
                            class:open={sourceMenuOpen}
                            aria-haspopup="listbox"
                            aria-expanded={sourceMenuOpen}
                            title="Switch lyrics source"
                        >
                            <span class="source-pill-label">{activeSourceLabel}</span>
                            <svg class="source-pill-chevron" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                <path d="M7 10l5 5 5-5z"/>
                            </svg>
                        </button>

                        {#if sourceMenuOpen}
                            <ul class="source-menu" role="listbox" aria-label="Lyrics source">
                                {#if $availableSources.includes('embedded')}
                                    {@const isActive = $lyricsData?.source === 'embedded'}
                                    <li
                                        class="source-menu-item"
                                        class:active={isActive}
                                        role="option"
                                        aria-selected={isActive}
                                        tabindex="0"
                                        on:click={() => handleSourceSelect('embedded')}
                                        on:keydown={(e) => e.key === 'Enter' && handleSourceSelect('embedded')}
                                    >
                                        <span class="source-menu-label">Embedded</span>
                                        <span class="source-menu-format">
                                            {#if $lyricsData?.source === 'embedded' && $lyricsData?.format}
                                                {$lyricsData.format.toUpperCase()}
                                            {/if}
                                        </span>
                                        {#if isActive}
                                            <svg class="source-menu-check" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                            </svg>
                                        {/if}
                                    </li>
                                {/if}
                                {#each LYRICS_SOURCES as source}
                                    {@const isActive = $lyricsData?.source === source.id}
                                    {@const isCached = $availableSources.includes(source.id)}
                                    <li
                                        class="source-menu-item"
                                        class:active={isActive}
                                        role="option"
                                        aria-selected={isActive}
                                        tabindex="0"
                                        on:click={() => handleSourceSelect(source.id)}
                                        on:keydown={(e) => e.key === 'Enter' && handleSourceSelect(source.id)}
                                    >
                                        <span class="source-menu-label">{source.label}</span>
                                        <span class="source-menu-format">{source.format.toUpperCase()}</span>
                                        {#if isActive}
                                            <svg class="source-menu-check" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                            </svg>
                                        {:else if isCached}
                                            <span class="source-menu-cached" title="Cached">●</span>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </div>
                {/if}

                <!-- Import button -->
                <button
                    class="icon-btn"
                    title="Import lyrics (.lrc or .ttml)"
                    aria-label="Import lyrics file"
                    on:click={handleImportLyrics}
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

                <!-- Close -->
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

        <!-- Content -------------------------------------------------------- -->
        <div class="lyrics-content" class:unsynced={isUnsynced} bind:this={lyricsContainer}>

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

                    {#if showSourcePicker}
                        <div class="no-lyrics-sources">
                            <span class="no-lyrics-hint">Try a different source:</span>
                            <div class="no-lyrics-source-btns">
                                {#if $availableSources.includes('embedded')}
                                    <button class="source-try-btn" on:click={() => handleSourceSelect('embedded')}>
                                        Embedded
                                    </button>
                                {/if}
                                {#each LYRICS_SOURCES as source}
                                    <button
                                        class="source-try-btn"
                                        on:click={() => handleSourceSelect(source.id)}
                                    >{source.label}</button>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>

            {:else if $lyricsData && $lyricsData.lines.length > 0}
                <div class="lyrics-lines" class:unsynced={isUnsynced}>
                    {#each $lyricsData.lines as line, i}
                        {@const distance = Math.abs(i - $activeLine)}
                        {@const clampedDist = Math.min(distance, 6)}
                        {@const isActive    = i === $activeLine}
                        {@const hasPrimary  = !!(line.words && line.words.length > 0)}
                        {@const hasBgWords  = !!(line.background_words && line.background_words.length > 0)}

                        <!--
                            Section label . rendered above the first line of each new section.
                            Only present when lyrics carry structure data (Apple JSON source).
                            i===0 guard prevents an array-out-of-bounds on the previous line lookup.
                        -->
                        {#if line.structure && (i === 0 || line.structure !== $lyricsData.lines[i - 1].structure)}
                            <div class="section-label" aria-hidden="true">{line.structure}</div>
                        {/if}

                        <div
                            class="lyric-line"
                            class:active={!isUnsynced && isActive}
                            class:near={!isUnsynced && distance === 1}
                            class:mid={!isUnsynced && distance === 2}
                            class:far={!isUnsynced && distance >= 3}
                            class:past={!isUnsynced && i < $activeLine}
                            class:opposite={!!line.opposite_turn && !line.is_background}
                            class:opposite-bg={!!line.opposite_turn && !!line.is_background}
                            class:word-sync={hasPrimary && isActive}
                            style="--line-distance: {clampedDist};"
                            bind:this={lineElements[i]}
                            on:click={() => handleLineClick(line.time)}
                            on:keydown={(e) =>
                                e.key === "Enter" && handleLineClick(line.time)}
                            role="button"
                            tabindex="0"
                        >
                            <!--
                                Primary vocal.
                                Word spans are only rendered on the active line — past and future
                                lines fall through to plain text, saving DOM nodes and style recalcs.
                                CSS handles their color via .lyric-line.past .lyric-word etc.

                                Three paths on the active line:
                                  A) Split word   → individual .lyric-syllable spans (Option B)
                                  B) Whole word   → single .lyric-word span with state class
                                  C) No word data → plain text
                            -->
                            <span class="primary-words">
                                {#if hasPrimary && isActive && line.words}
                                    {#each line.words as word, wIdx}
                                        {@const wState = getWordState(wIdx, $wordSyncState.activeWordIdx)}
                                        {#if word.is_split && word.syllables && word.syllables.length > 0}
                                            <span class="lyric-word split-word"
                                                >{#each word.syllables as syl, sIdx
                                                    }<span
                                                        class="lyric-syllable"
                                                        class:past={wState === 'past' || (wState === 'highlighted' && sIdx < $wordSyncState.activeSyllableIdx)}
                                                        class:highlighted={wState === 'highlighted' && sIdx === $wordSyncState.activeSyllableIdx}
                                                        style={wState === 'highlighted' && sIdx === $wordSyncState.activeSyllableIdx ? `--syl-progress: ${$wordSyncState.syllableProgress}%` : ''}
                                                    >{syl.text}</span
                                                >{/each}</span
                                            >{#if wIdx < line.words.length - 1}{" "}{/if}
                                        {:else}
                                            <span
                                                class="lyric-word {wState}"
                                                style={wState === 'highlighted' ? `--word-progress: ${$wordSyncState.wordProgress}%` : ''}
                                            >{word.word}</span>{#if wIdx < line.words.length - 1}{" "}{/if}
                                        {/if}
                                    {/each}
                                {:else}
                                    {line.text}
                                {/if}
                            </span>

                            <!--
                                Background vocal overlay.
                                Rendered when this line carries simultaneous BG words
                                Has its own independent fill tracking via getBgProgress().
                            -->
                            <!--
                                Background vocal: word spans only on the active line.
                                Non-active lines render background_text as plain text.
                            -->
                            {#if hasBgWords}
                                <span class="bg-vocal" aria-label="background vocals">
                                    {#if isActive && line.background_words}
                                        {#each line.background_words as bgWord, bgIdx}
                                            {@const bgState = getBgWordState(bgIdx, $wordSyncState)}
                                            {#if bgWord.is_split && bgWord.syllables && bgWord.syllables.length > 0}
                                                <span class="lyric-word split-word"
                                                    >{#each bgWord.syllables as syl, sIdx
                                                        }<span
                                                            class="lyric-syllable"
                                                            class:past={bgState === 'past' || (bgState === 'highlighted' && sIdx < $wordSyncState.bgActiveSyllableIdx)}
                                                            class:highlighted={bgState === 'highlighted' && sIdx === $wordSyncState.bgActiveSyllableIdx}
                                                            style={bgState === 'highlighted' && sIdx === $wordSyncState.bgActiveSyllableIdx ? `--syl-progress: ${$wordSyncState.bgSyllableProgress}%` : ''}
                                                        >{syl.text}</span
                                                    >{/each}</span
                                                >{#if bgIdx < line.background_words.length - 1}{" "}{/if}
                                            {:else}
                                                <span
                                                    class="lyric-word {bgState}"
                                                    style={bgState === 'highlighted' ? `--word-progress: ${$wordSyncState.bgWordProgress}%` : ''}
                                                >{bgWord.word}</span>{#if bgIdx < line.background_words.length - 1}{" "}{/if}
                                            {/if}
                                        {/each}
                                    {:else}
                                        {line.background_text}
                                    {/if}
                                </span>
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

        <!-- Footer --------------------------------------------------------- -->
        {#if $lyricsData}
            <footer class="lyrics-footer">
                <span class="lyrics-source">
                    {#if ($lyricsData.source as string) === 'user'}
                        Imported · {$lyricsData.format.toUpperCase()}{#if $lyricsData.hasSyllableSync} · Syllable sync{:else if $lyricsData.hasWordSync} · Word sync{:else if hasLineSync} · Line sync{/if}
                    {:else if ($lyricsData.source as string) === 'embedded'}
                        Embedded tag · {($lyricsData as any).synced ? 'Line sync' : 'Unsynced'}
                    {:else}
                        {ALL_SOURCE_LABELS[$lyricsData.source] ?? $lyricsData.source}
                        · {$lyricsData.format.toUpperCase()}
                        {#if $lyricsData.hasSyllableSync} · Syllable sync
                        {:else if $lyricsData.hasWordSync} · Word sync
                        {:else if hasLineSync} · Line sync
                        {/if}
                    {/if}
                </span>
            </footer>
        {/if}

    </aside>
{/if}

<style>
    /* ------------------------------------------------------------------ */
    /* Panel shell                                                          */
    /* ------------------------------------------------------------------ */
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

    /* ------------------------------------------------------------------ */
    /* Header                                                               */
    /* ------------------------------------------------------------------ */
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

    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    /* ------------------------------------------------------------------ */
    /* Source picker                                                        */
    /* ------------------------------------------------------------------ */
    .source-picker { position: relative; }

    .source-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: var(--radius-full);
        background: var(--bg-highlight);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.3px;
        text-transform: uppercase;
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
    }

    .source-pill:hover,
    .source-pill.open {
        background: var(--bg-base);
        color: var(--text-primary);
        border-color: var(--accent-primary);
    }

    .source-pill-chevron {
        opacity: 0.6;
        transition: transform var(--transition-fast);
        flex-shrink: 0;
    }
    .source-pill.open .source-pill-chevron { transform: rotate(180deg); }

    .source-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 170px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        padding: 4px;
        z-index: 200;
        list-style: none;
        animation: menuIn 0.15s ease;
    }

    @keyframes menuIn {
        from { opacity: 0; transform: translateY(-4px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .source-menu-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: calc(var(--radius-md) - 2px);
        font-size: 0.82rem;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .source-menu-item:hover { background: var(--bg-highlight); color: var(--text-primary); }
    .source-menu-item.active { color: var(--text-primary); font-weight: 600; }

    .source-menu-label  { flex: 1; }

    .source-menu-format {
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: var(--text-subdued);
        background: var(--bg-highlight);
        border-radius: 3px;
        padding: 1px 4px;
        flex-shrink: 0;
    }

    .source-menu-check  { color: var(--accent-primary); flex-shrink: 0; }

    .source-menu-cached {
        font-size: 0.5rem;
        color: var(--accent-primary);
        opacity: 0.5;
        flex-shrink: 0;
    }

    /* ------------------------------------------------------------------ */
    /* Header icon buttons                                                  */
    /* ------------------------------------------------------------------ */
    .icon-btn,
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
    .icon-btn:hover,
    .close-btn:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
        transform: scale(1.05);
    }

    /* ------------------------------------------------------------------ */
    /* Content area                                                         */
    /* ------------------------------------------------------------------ */
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
            to bottom, transparent 0%, black 8%, black 90%, transparent 100%
        );
    }

    /* Unsynced embedded lyrics . no mask fade, starts at top */
    .lyrics-content.unsynced {
        mask-image: none;
        -webkit-mask-image: none;
    }

    /* ------------------------------------------------------------------ */
    /* Status states                                                        */
    /* ------------------------------------------------------------------ */
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

    .no-lyrics-sources {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        margin-top: var(--spacing-sm);
    }
    .no-lyrics-hint {
        font-size: 0.72rem;
        opacity: 0.6;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    .no-lyrics-source-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: center;
    }
    .source-try-btn {
        padding: 5px 12px;
        border-radius: var(--radius-full);
        border: 1px solid var(--border-color);
        background: var(--bg-highlight);
        color: var(--text-secondary);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .source-try-btn:hover { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }

    /* Unsynced: no bottom padding (no centering needed), lines fully visible */
    .lyrics-lines.unsynced {
        padding-bottom: var(--spacing-lg);
    }

    /* All lines in unsynced mode: full opacity, no blur, no scale, active color */
    .lyrics-lines.unsynced .lyric-line {
        color: var(--text-primary);
        opacity: 1;
        filter: none;
        transform: none;
        cursor: default;
    }
    .lyrics-lines.unsynced .lyric-line:hover {
        color: var(--text-primary);
        filter: none;
        opacity: 1;
    }

    /* ------------------------------------------------------------------ */
    /* Section label  (Apple Music JSON structure field)                   */
    /* ------------------------------------------------------------------ */
    .section-label {
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subdued);
        opacity: 0.5;
        padding: 16px 0 4px;
        user-select: none;
        pointer-events: none;
    }

    /* ------------------------------------------------------------------ */
    /* Lyric lines                                                          */
    /* ------------------------------------------------------------------ */
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
        /* Stack primary words and bg-vocal as block children */
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
    }
    .lyric-line:hover { color: var(--text-secondary); filter: blur(0px); opacity: 1; }

    .lyric-line.near { color: var(--lyrics-near);  filter: blur(0.3px);  opacity: 0.85; transform: scale(0.98); }
    .lyric-line.mid  { color: var(--lyrics-mid);   filter: blur(1px);    opacity: 0.65; transform: scale(0.96); }
    .lyric-line.far  {
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

    .lyric-line.past.near { color: var(--lyrics-past-near); opacity: 0.75; filter: blur(0.6px); transform: scale(0.97); }
    .lyric-line.past.mid  { color: var(--lyrics-past-mid);  opacity: 0.55; filter: blur(1.2px); transform: scale(0.95); }
    .lyric-line.past.far  { color: var(--lyrics-past-far);  opacity: calc(0.45 - var(--line-distance) * 0.05); filter: blur(calc(var(--line-distance) * 0.6px)); transform: scale(0.94); }

    /* ------------------------------------------------------------------ */
    /* Opposite turn . featured / secondary vocalist                       */
    /* ------------------------------------------------------------------ */
    /*
     * opposite_turn=true, is_background=false
     * Full-line delivery by the featured artist : right-aligned, italic.
     */
    .lyric-line.opposite {
        align-items: flex-end;
        text-align: right;
        transform-origin: right center;
        font-style: italic;
    }

    /*
     * opposite_turn=true, is_background=true
     * Featured artist singing background vocals : right-aligned, italic,
     * and slightly dimmer than a full opposite-turn line.
     */
    .lyric-line.opposite-bg {
        align-items: flex-end;
        text-align: right;
        transform-origin: right center;
        font-style: italic;
        font-size: 1.05rem;
        opacity: calc((1 - var(--line-distance) * 0.1) * 0.75);
    }
    .lyric-line.opposite-bg.active { opacity: 0.8; }

    /* ------------------------------------------------------------------ */
    /* Word sync . non-split words                                          */
    /* ------------------------------------------------------------------ */
    /*
     * Base .lyric-word is invisible by default  only rendered on the
     * active line (.word-sync). Past/future lines render as plain text so
     * no word spans exist there, saving DOM nodes and style recalcs.
     */
    .lyric-word {
        display: inline;
        color: transparent;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        transition: text-shadow 0.2s ease;
    }

    /* Active word being filled . feathered gradient edge (8% soft transition) */
    .lyric-line.word-sync .lyric-word.highlighted {
        background-image: linear-gradient(
            to right,
            var(--text-primary)     0%,
            var(--text-primary)     calc(var(--word-progress, 0%) - 4%),
            var(--lyrics-inactive)  calc(var(--word-progress, 0%) + 4%),
            var(--lyrics-inactive)  100%
        );
    }
    :global([data-theme="dark"]) .lyric-line.word-sync .lyric-word.highlighted {
        text-shadow: 0 0 12px rgba(255, 255, 255, 0.15);
    }

    /* Words already sung . fully lit */
    .lyric-line.word-sync .lyric-word.past {
        background-image: linear-gradient(
            to right, var(--text-primary) 0%, var(--text-primary) 100%
        );
    }

    /* Words not yet reached . dimmed */
    .lyric-line.word-sync .lyric-word.future {
        background-image: linear-gradient(
            to right, var(--lyrics-inactive) 0%, var(--lyrics-inactive) 100%
        );
    }

    /* ------------------------------------------------------------------ */
    /* Syllable sync . split words                             */
    /* ------------------------------------------------------------------ */
    /*
     * Transparent wrapper groups syllable spans for one visual word.
     * No fill of its own; resets -webkit-text-fill-color so child spans work.
     */
    .lyric-word.split-word {
        background: none;
        -webkit-text-fill-color: inherit;
        color: inherit;
        transition: none;
        display: inline;
    }

    /*
     * Base syllable span : invisible until given a state class.
     * Only exists inside .word-sync (active line only).
     */
    .lyric-syllable {
        display: inline;
        color: transparent;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    /* Active syllable feathered fill, matching the word-level feel */
    .lyric-line.word-sync .lyric-syllable.highlighted {
        background-image: linear-gradient(
            to right,
            var(--text-primary)     0%,
            var(--text-primary)     calc(var(--syl-progress, 0%) - 4%),
            var(--lyrics-inactive)  calc(var(--syl-progress, 0%) + 4%),
            var(--lyrics-inactive)  100%
        );
        transition: background-image 0.08s linear;
    }

    :global([data-theme="dark"]) .lyric-line.word-sync .lyric-syllable.highlighted {
        text-shadow: 0 0 12px rgba(255, 255, 255, 0.15);
    }

    /* Syllables already sung */
    .lyric-line.word-sync .lyric-syllable.past {
        background-image: linear-gradient(
            to right, var(--text-primary) 0%, var(--text-primary) 100%
        );
    }

    /* Syllables not yet reached */
    .lyric-line.word-sync .lyric-syllable:not(.past):not(.highlighted) {
        background-image: linear-gradient(
            to right, var(--lyrics-inactive) 0%, var(--lyrics-inactive) 100%
        );
    }

    /* ------------------------------------------------------------------ */
    /* Primary words wrapper                                               */
    /* ------------------------------------------------------------------ */
    /*
     * Block wrapper so flex column in .lyric-line stacks primary words
     * and bg-vocal as separate rows, while words remain inline within
     * their own row.
     */
    .primary-words {
        display: block;
    }

    /* ------------------------------------------------------------------ */
    /* Background vocal overlay                                            */
    /* ------------------------------------------------------------------ */
    /*
     * Rendered below the primary words when background_words is non-empty.
     * Smaller font, italic, reduced opacity subordinate to primary vocal.
     */
    .bg-vocal {
        display: block;
        font-size: 0.78em;
        font-style: italic;
        opacity: 0.55;
        margin-top: 1px;
        letter-spacing: 0;
        font-weight: 600; /* slightly lighter than parent 700/800 */
    }
    .lyric-line.active .bg-vocal { opacity: 0.7; }

    /* ------------------------------------------------------------------ */
    /* Footer                                                               */
    /* ------------------------------------------------------------------ */
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

    /* ------------------------------------------------------------------ */
    /* Mobile                                                               */
    /* ------------------------------------------------------------------ */
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
        padding-top: calc(var(--spacing-md) + var(--safe-area-top));
    }

    .lyrics-panel.mobile .close-btn {
        width: 44px;
        height: 44px;
    }

    .lyrics-panel.mobile .lyric-line {
        font-size: 1.1rem;
    }

    .lyrics-panel.mobile .lyric-line.active { font-size: 1.2rem; }
    .lyrics-panel.mobile .source-menu  { right: auto; left: 0; }

</style>
