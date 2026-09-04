<!--
    LyricsView.svelte

    the actual lyrics rendering core: word/syllable-level sync, background
    vocals, opposite-turn (featured artist) alignment, the legacy/dynamic
    alignment toggle, section labels, proximity blur/scale grading, and
    smooth auto-scroll

    what this component does not own, on purpose (callers differ here):
      1) chrome: background, borders, header, source picker, footer
                 callers wrap this in whatever chrome (or none) fits their context
      2) Loading / error / no lyrics states
        each caller's fallback UI is different
        callers check $lyricsData themselves and only render <LyricsView> when there's data to show

    sizing is intentionally not a hardcoded prop/variant
    callers set css custom properties on whatever element wraps <LyricsView>
    (or pass them straight through via the 'style' prop below

    props:
    1) transparent    : skip the content padding/mask meant for a panel sitting inside a card
    2) reducedMotion   : disable transform/transition heavy effects
                          (proximity blur/scale, active line scale, section
                          label beams, switching mode animation
    3) style           : forwarded as is onto the root element; the
                          intended way for a caller to set sizing custom
                          properties
-->
<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        lyricsData,
        activeLine,
        activeLines,
        wordSyncState,
        getLineSyncState,
        lyricsRenderMode,
        lyricsAlignment,
        type LineSyncState,
    } from "$lib/stores/lyrics";
    import { currentTime, duration, seek } from "$lib/stores/player";

    export let transparent = false;
    export let reducedMotion = false;
    export let style = "";

    // -------------------------------------------------------------------------
    // unsynced detection (no timestamps at all => suppress active/scroll/blur)
    // -------------------------------------------------------------------------

    $: hasLineSync = !!$lyricsData
        && !$lyricsData.hasWordSync
        && !$lyricsData.hasSyllableSync
        && $lyricsData.lines.some(l => l.time > 0);

    $: isUnsynced = !!$lyricsData && (
        (($lyricsData.source as string) === 'embedded' && !($lyricsData as any).synced)
        || (!$lyricsData.hasWordSync && !$lyricsData.hasSyllableSync && !hasLineSync)
    );

    // -------------------------------------------------------------------------
    // smooth scroll
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

        if (scrollAnimationId) {
            cancelAnimationFrame(scrollAnimationId);
        }

        const containerHeight = lyricsContainer.clientHeight;
        const targetScroll = element.offsetTop - containerHeight / 2 + element.clientHeight / 2;

        const startScroll = lyricsContainer.scrollTop;
        const distance = targetScroll - startScroll;
        const scrollDuration = 550;
        let startTime: number | null = null;

        function step(timestamp: number) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / scrollDuration, 1);
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
    // legacy/dynamic mode switch transition window
    // -------------------------------------------------------------------------
    /*
     * .primary-words/.bg-vocal only get transition+will-change while this is true
     * that is , only during the transition window
     * wasteful to leave on all the lines, all the time
     * the window is closed again right after the CSS transition duration elapses
     */
    let isSwitchingMode = false;
    let prevRenderMode = $lyricsRenderMode;
    let switchModeTimeout: ReturnType<typeof setTimeout> | null = null;

    $: if ($lyricsRenderMode !== prevRenderMode) {
        prevRenderMode = $lyricsRenderMode;
        if (!reducedMotion) {
            isSwitchingMode = true;
            if (switchModeTimeout) clearTimeout(switchModeTimeout);
            // Matches the 1s transition-duration below, plus a small buffer.
            switchModeTimeout = setTimeout(() => { isSwitchingMode = false; }, 1050);
        }
    }

    onDestroy(() => {
        if (switchModeTimeout) clearTimeout(switchModeTimeout);
    });

    // -------------------------------------------------------------------------
    // word / syllable progress helpers
    // -------------------------------------------------------------------------

    /** word state for the active line only */
    function getWordState(wordIdx: number, activeWordIdx: number): string {
        if (wordIdx < activeWordIdx)  return 'past';
        if (wordIdx === activeWordIdx) return 'highlighted';
        return 'future';
    }

    /** Background word state for a given line's sync state. */
    function getBgWordState(wordIdx: number, ws: LineSyncState): string {
        if (wordIdx < ws.bgActiveWordIdx)   return 'past';
        if (wordIdx === ws.bgActiveWordIdx) return 'highlighted';
        return 'future';
    }

    // -------------------------------------------------------------------------
    // seeking
    // -------------------------------------------------------------------------

    function handleLineClick(lineTime: number) {
        const dur = $duration;
        if (dur && dur > 0) seek(Math.max(0, Math.min(1, lineTime / dur)));
    }

    // -------------------------------------------------------------------------
    // section labels
    // -------------------------------------------------------------------------

    /**
     * whether the section starting at line index i is the one currently playing
     * this stays true for the whole block and hence does the beam
     */
    function isSectionActive(i: number, lines: NonNullable<typeof $lyricsData>["lines"]): boolean {
        const start = lines[i].time;
        if ($currentTime < start) return false;
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].structure !== lines[i].structure) {
                return $currentTime < lines[j].time;
            }
        }
        return true;
    }
</script>

{#if $lyricsData && $lyricsData.lines.length > 0}
    <div
        class="lyrics-content"
        class:transparent
        class:unsynced={isUnsynced}
        class:reduced-motion={reducedMotion}
        bind:this={lyricsContainer}
        {style}
    >
        <div class="lyrics-lines" class:unsynced={isUnsynced} class:mode-dynamic={$lyricsRenderMode === 'dynamic'} class:switching-mode={isSwitchingMode}>
            {#each $lyricsData.lines as line, i}
                {@const isActive    = $activeLines.includes(i)}
                {@const distance = Math.abs(i - $activeLine)}
                {@const clampedDist = isActive ? 0 : Math.min(distance, 6)}
                {@const ws = getLineSyncState($wordSyncState, i)}
                {@const hasPrimary  = !!(line.words && line.words.length > 0)}
                {@const hasBgWords   = !!(line.background_words && line.background_words.length > 0)}
                {@const hasBgContent = hasBgWords || !!(line.background_text)}

                <!--
                    section label = rendered above the first line of each new section
                -->
                {#if line.structure && (i === 0 || line.structure !== $lyricsData.lines[i - 1].structure)}
                    <div
                        class="section-label-row"
                        class:label-active={!isUnsynced && $lyricsRenderMode === 'dynamic' && isSectionActive(i, $lyricsData.lines)}
                        aria-hidden="true"
                    >
                        <span class="label-beam label-beam-left"></span>
                        <span class="section-label">{line.structure}</span>
                        <span class="label-beam label-beam-right"></span>
                    </div>
                {/if}

                <div
                    class="lyric-line"
                    class:active={!isUnsynced && isActive}
                    class:past={!isUnsynced && !isActive && (line.endTime !== undefined ? line.endTime <= $currentTime : i < $activeLine)}
                    class:near={!isUnsynced && !isActive && distance === 1}
                    class:mid={!isUnsynced && !isActive && distance === 2}
                    class:far={!isUnsynced && !isActive && distance >= 3}
                    class:opposite={!!line.opposite_turn && !line.is_background}
                    class:opposite-bg={!!line.opposite_turn && !!line.is_background}
                    class:background-line={!line.opposite_turn && !!line.is_background}
                    class:dyn-left={$lyricsRenderMode === 'dynamic' && !line.opposite_turn && $lyricsAlignment.line[i] === 'left'}
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
                        primary vocal
                        word spans are only rendered on the active line
                        past and future lines fall through to plain text

                        three paths on the active line:
                          1) split word   => individual .lyric-syllable spans
                          2) whole word   => single .lyric-word span with state class
                          3) no word data => plain text
                    -->
                    <span class="primary-words">
                        {#if hasPrimary && isActive && line.words}
                            {#each line.words as word, wIdx}
                                {@const wState = getWordState(wIdx, ws.activeWordIdx)}
                                {#if word.is_split && word.syllables && word.syllables.length > 0}
                                    <span class="lyric-word split-word"
                                        >{#each word.syllables as syl, sIdx
                                            }<span
                                                class="lyric-syllable"
                                                class:past={wState === 'past' || (wState === 'highlighted' && sIdx < ws.activeSyllableIdx)}
                                                class:highlighted={wState === 'highlighted' && sIdx === ws.activeSyllableIdx}
                                                style={wState === 'highlighted' && sIdx === ws.activeSyllableIdx ? `--syl-progress: ${ws.syllableProgress}%` : ''}
                                            >{syl.text}</span
                                            >{/each}</span
                                    >{#if wIdx < line.words.length - 1}{" "}{/if}
                                {:else}
                                    <span
                                        class="lyric-word {wState}"
                                        style={wState === 'highlighted' ? `--word-progress: ${ws.wordProgress}%` : ''}
                                    >{word.word}</span>{#if wIdx < line.words.length - 1}{" "}{/if}
                                {/if}
                            {/each}
                        {:else}
                            {line.text}
                        {/if}
                    </span>

                    <!--
                        background vocal overlay
                        rendered when this line carries simultaneous BG words
                        word spans only on the active line
                        non active lines render background_text as plain text
                    -->
                    {#if hasBgContent}
                        <span class="bg-vocal" aria-label="background vocals">
                            {#if isActive && line.background_words && line.background_words.length > 0}
                                {#each line.background_words as bgWord, bgIdx}
                                    {@const bgState = getBgWordState(bgIdx, ws)}
                                    {#if bgWord.is_split && bgWord.syllables && bgWord.syllables.length > 0}
                                        <span class="lyric-word split-word"
                                            >{#each bgWord.syllables as syl, sIdx
                                                }<span
                                                    class="lyric-syllable"
                                                    class:past={bgState === 'past' || (bgState === 'highlighted' && sIdx < ws.bgActiveSyllableIdx)}
                                                    class:highlighted={bgState === 'highlighted' && sIdx === ws.bgActiveSyllableIdx}
                                                    style={bgState === 'highlighted' && sIdx === ws.bgActiveSyllableIdx ? `--syl-progress: ${ws.bgSyllableProgress}%` : ''}
                                                >{syl.text}</span
                                                >{/each}</span
                                        >{#if bgIdx < line.background_words.length - 1}{" "}{/if}
                                    {:else}
                                        <span
                                            class="lyric-word {bgState}"
                                            style={bgState === 'highlighted' ? `--word-progress: ${ws.bgWordProgress}%` : ''}
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
    </div>
{/if}

<style>
    /* ------------------------------------------------------------------ */
    /* content area                                                         */
    /* ------------------------------------------------------------------ */
    /*
     * all sizing below reads CSS custom properties with defaults matching LyricsPanel's original look
     * callers override by setting these on
     * whatever wraps <LyricsView> (or via the 'style' prop)
     */
    .lyrics-content {
        flex: 1;
        overflow-y: auto;
        overflow-anchor: none;
        padding: var(--lyrics-content-padding, var(--spacing-xl) var(--spacing-md));
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

    /* transparent: fullscreen contexts already sit over their own backdrop
     * (MeshGradientBg etc.) */
    .lyrics-content.transparent {
        padding: var(--lyrics-content-padding, 0);
    }

    /* unsynced embedded lyrics => no mask fade, starts at top */
    .lyrics-content.unsynced {
        mask-image: none;
        -webkit-mask-image: none;
    }

    /* reducedMotion: skip mask-image */
    .lyrics-content.reduced-motion {
        mask-image: none;
        -webkit-mask-image: none;
    }

    /* unsynced: no bottom padding (no centering needed), lines fully visible */
    .lyrics-lines.unsynced {
        padding-bottom: var(--spacing-lg);
    }

    /* all lines in unsynced mode: full opacity, no blur, no scale, active color */
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
    /* section label  (verse, bridge , chorus etc)                   */
    /* ------------------------------------------------------------------ */
    .section-label-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 16px 0 4px;
        user-select: none;
        pointer-events: none;
    }

    .section-label {
        font-size: 0.65rem;
        font-weight: var(--font-weight-bold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subdued);
        opacity: 0.5;
        white-space: nowrap;
        transform: scale(1);
        transition:
            transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275),
            opacity 0.4s ease,
            color 0.4s ease,
            text-shadow 0.4s ease;
    }
    .reduced-motion .section-label { transition: none; }

    .label-beam {
        flex: 1 1 auto;
        max-width: var(--label-beam-max-width, 140px);
        height: 3px;
        /* only the section currently playing should
           show a beam */
        opacity: 0;
        transform: scaleX(0);
        transition:
            transform 0.6s cubic-bezier(0.16, 1, 0.3, 1),
            opacity 0.5s ease;
    }
    .reduced-motion .label-beam { transition: none; }
    .label-beam-left {
        transform-origin: right center;
        /* rectangular blade with the outer tip pointed */
        clip-path: polygon(
            100% 0%,
            100% 100%,
            12% 100%,
            0% 50%,
            12% 0%
        );
        background: linear-gradient(
            to left,
            var(--text-secondary) 0%,
            var(--text-subdued) 35%,
            var(--text-subdued) 65%,
            transparent 100%
        );
    }
    .label-beam-right {
        transform-origin: left center;
        clip-path: polygon(
            0% 0%,
            0% 100%,
            88% 100%,
            100% 50%,
            88% 0%
        );
        background: linear-gradient(
            to right,
            var(--text-secondary) 0%,
            var(--text-subdued) 35%,
            var(--text-subdued) 65%,
            transparent 100%
        );
    }

    .section-label-row.label-active .section-label {
        transform: scale(1.15);
        opacity: 0.85;
        color: var(--text-secondary);
    }
    .section-label-row.label-active .label-beam {
        opacity: 0.55;
        transform: scaleX(1);
    }

    :global([data-theme="dark"]) .section-label-row.label-active .section-label {
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.2);
    }
    :global([data-theme="dark"]) .section-label-row.label-active .label-beam {
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.35));
    }

    /* ------------------------------------------------------------------ */
    /* lyric lines                                                          */
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
        font-size: var(--lyrics-font-size, 1.15rem);
        font-weight: var(--font-weight-bold);
        line-height: 1.6;
        color: var(--lyrics-inactive);
        padding: var(--lyrics-line-padding, 12px 0);
        letter-spacing: -0.01em;
        white-space: pre-wrap;
        overflow-wrap: break-word;
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
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
    }
    .lyric-line:hover { color: var(--text-secondary); filter: blur(0px); opacity: 1; }

    /* reducedMotion: keep color/opacity grading , drop blur/transform/text-shadow */
    .reduced-motion .lyric-line,
    .reduced-motion .lyric-line.near,
    .reduced-motion .lyric-line.mid,
    .reduced-motion .lyric-line.far,
    .reduced-motion .lyric-line.active,
    .reduced-motion .lyric-line.past.near,
    .reduced-motion .lyric-line.past.mid,
    .reduced-motion .lyric-line.past.far {
        transition: color 0.4s ease, opacity 0.4s ease;
        filter: none;
        transform: none;
        text-shadow: none;
    }

    .lyric-line.near { color: var(--lyrics-near);  filter: blur(0.3px);  opacity: 0.85; transform: scale(0.98); }
    .lyric-line.mid  { color: var(--lyrics-mid);   filter: blur(1px);    opacity: 0.65; transform: scale(0.96); }
    .lyric-line.far  {
        color: var(--lyrics-far);
        filter: blur(calc(var(--line-distance) * 0.5px));
        opacity: calc(0.55 - var(--line-distance) * 0.05);
        transform: scale(0.95);
    }

    .lyric-line.active {
        color: var(--text-primary);
        font-size: var(--lyrics-active-font-size, var(--lyrics-font-size, 1.15rem));
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

    :global([data-theme="dark"]) .reduced-motion .lyric-line.active {
        text-shadow: none;
    }

    .lyric-line.past.near { color: var(--lyrics-past-near); opacity: 0.75; filter: blur(0.6px); transform: scale(0.97); }
    .lyric-line.past.mid  { color: var(--lyrics-past-mid);  opacity: 0.55; filter: blur(1.2px); transform: scale(0.95); }
    .lyric-line.past.far  { color: var(--lyrics-past-far);  opacity: calc(0.45 - var(--line-distance) * 0.05); filter: blur(calc(var(--line-distance) * 0.6px)); transform: scale(0.94); }

    /* ------------------------------------------------------------------ */
    /* opposite turn (secondary vocalist)                       */
    /* ------------------------------------------------------------------ */
    .lyric-line.opposite {
        align-items: flex-end;
        text-align: right;
        transform-origin: right center;
        font-style: italic;
    }

    .lyric-line.opposite-bg {
        align-items: flex-end;
        text-align: right;
        transform-origin: right center;
        font-style: italic;
        font-size: calc(var(--lyrics-font-size, 1.15rem) * 0.91);
        opacity: calc((1 - var(--line-distance) * 0.1) * 0.75);
    }
    .lyric-line.opposite-bg.active { opacity: 0.8; }

    .lyric-line.background-line {
        font-size: 0.85em;
        font-weight: var(--font-weight-semibold);
        opacity: calc((1 - var(--line-distance) * 0.1) * 0.8);
    }
    .lyric-line.background-line.active { opacity: 0.85; }
    .lyric-line.background-line.past   { opacity: calc(0.55 - var(--line-distance) * 0.05); }

    /* ------------------------------------------------------------------ */
    /* dynamic mode  (structure aware alignment)                          */
    /* ------------------------------------------------------------------ */
    .lyrics-lines.mode-dynamic .lyric-line:not(.opposite):not(.opposite-bg) {
        text-align: center;
        transform-origin: center center;
    }
    .lyrics-lines.mode-dynamic .lyric-line:not(.opposite):not(.opposite-bg) .primary-words,
    .lyrics-lines.mode-dynamic .lyric-line:not(.opposite):not(.opposite-bg) .bg-vocal {
        left: 50%;
        transform: translateX(-50%);
    }
    .lyrics-lines.mode-dynamic .lyric-line.dyn-left:not(.opposite):not(.opposite-bg) {
        text-align: left;
        transform-origin: left center;
    }
    .lyrics-lines.mode-dynamic .lyric-line.dyn-left:not(.opposite):not(.opposite-bg) .primary-words,
    .lyrics-lines.mode-dynamic .lyric-line.dyn-left:not(.opposite):not(.opposite-bg) .bg-vocal {
        left: 0;
        transform: translateX(0);
    }

    /* ------------------------------------------------------------------ */
    /* word sync => non split words                                          */
    /* ------------------------------------------------------------------ */
    .lyric-word {
        display: inline;
        color: transparent;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        transition: text-shadow 0.2s ease;
    }

    /* italic overhang fix => italic ink slants past and gets clipped without this */
    .lyric-line.opposite .lyric-word,
    .lyric-line.opposite-bg .lyric-word {
        padding-right: 0.15em;
        margin-right: -0.15em;
        background-size: calc(100% + 0.15em) 100%;
    }

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

    .lyric-line.word-sync .lyric-word.past {
        background-image: linear-gradient(
            to right, var(--text-primary) 0%, var(--text-primary) 100%
        );
    }

    .lyric-line.word-sync .lyric-word.future {
        background-image: linear-gradient(
            to right, var(--lyrics-inactive) 0%, var(--lyrics-inactive) 100%
        );
    }

    /* ------------------------------------------------------------------ */
    /* syllable sync => split words                                          */
    /* ------------------------------------------------------------------ */
    .lyric-word.split-word {
        background: none;
        -webkit-text-fill-color: inherit;
        color: inherit;
        transition: none;
        display: inline;
    }

    .lyric-syllable {
        display: inline;
        color: transparent;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .lyric-line.opposite .lyric-syllable,
    .lyric-line.opposite-bg .lyric-syllable {
        padding-right: 0.15em;
        margin-right: -0.15em;
        background-size: calc(100% + 0.15em) 100%;
    }

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

    .lyric-line.word-sync .lyric-syllable.past {
        background-image: linear-gradient(
            to right, var(--text-primary) 0%, var(--text-primary) 100%
        );
    }

    .lyric-line.word-sync .lyric-syllable:not(.past):not(.highlighted) {
        background-image: linear-gradient(
            to right, var(--lyrics-inactive) 0%, var(--lyrics-inactive) 100%
        );
    }

    /* ------------------------------------------------------------------ */
    /* primary words wrapper                                               */
    /* ------------------------------------------------------------------ */
    .primary-words {
        display: block;
        position: relative;
        left: 0;
        transform: translateX(0);
    }
    .lyrics-lines.switching-mode .primary-words {
        will-change: left, transform;
        transition: left 1s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                    transform 1s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    /* ------------------------------------------------------------------ */
    /* background vocal overlay                                            */
    /* ------------------------------------------------------------------ */
    .bg-vocal {
        display: block;
        font-size: 0.78em;
        font-style: italic;
        opacity: 0.55;
        margin-top: 1px;
        letter-spacing: 0;
        font-weight: var(--font-weight-semibold);
        position: relative;
        left: 0;
        transform: translateX(0);
    }
    .lyrics-lines.switching-mode .bg-vocal {
        will-change: left, transform;
        transition: left 1s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                    transform 1s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .lyric-line.active .bg-vocal { opacity: 0.7; }
</style>