<script lang="ts">
    import { onMount } from "svelte";
    import {
        lyricsData,
        lyricsLoading,
        lyricsError,
        lyricsVisible,
        availableSources,
        selectedSource,
        initLyricsSync,
        destroyLyricsSync,
        fetchLyricsForTrack,
        switchLyricsSource,
        lyricsStore,
        type LyricsQueryOverride,
    } from "$lib/stores/lyrics";
    import { currentTrack } from "$lib/stores/player";
    import { isMobile } from "$lib/stores/mobile";
    import { addToast } from "$lib/stores/toast";
    import { importLyricsContent } from "$lib/stores/lyrics";
    import { LYRICS_SOURCES, type LyricsSource } from "$lib/lyrics";
    import LyricsView from "./LyricsView.svelte";

    // -------------------------------------------------------------------------
    // lyrics rendering (word/syllable sync, scroll, alignment) now lives in LyricsView.svelte
    // -------------------------------------------------------------------------

    /** sizing handoff to LyricsView . mobile gets smaller line/active sizes */
    $: lyricsViewStyle = $isMobile
        ? '--lyrics-font-size: 1.1rem; --lyrics-active-font-size: 1.2rem;'
        : '';

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
     $: isUnsynced = !!$lyricsData && (
        (($lyricsData.source as string) === 'embedded' && !($lyricsData as any).synced)
        || (!$lyricsData.hasWordSync && !$lyricsData.hasSyllableSync && !hasLineSync)
    );

    let sourceMenuOpen = false;
    function toggleSourceMenu()  { sourceMenuOpen = !sourceMenuOpen; }
    function closeSourceMenu()   { sourceMenuOpen = false; }

    // Close the menu whenever a search completes (loading -> done)
    $: if (!$lyricsLoading) sourceMenuOpen = false;

    function showPaxKeyToast(message: string) {
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:#c0392b; color:#fff; padding:10px 20px; border-radius:8px; z-index:10002; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.3); opacity:0; transition:0.3s; display:flex; align-items:center; gap:12px; white-space:nowrap;`;
        const text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(text);
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.style.opacity = '1');
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
    }

    let _appleKeyToastShown = false;
    $: if ($selectedSource === 'applejson' && !$lyricsLoading) {
        const key = localStorage.getItem('qobuz_pax_api_key')?.trim() ?? '';
        if (!key && !_appleKeyToastShown) {
            _appleKeyToastShown = true;
            showPaxKeyToast('It is advised that you install the Qobuz plugin and configure your Paxsenix key in its settings for reliable Apple Music lyrics.');
        }
    }

    async function handleSourceSelect(sourceId: string) {
        sourceMenuOpen = false;
        if ($lyricsData?.source === sourceId) return;

        if (sourceId === 'genius') {
            const key = localStorage.getItem('qobuz_pax_api_key')?.trim() ?? '';
            if (!key) {
                showPaxKeyToast('Genius lyrics require a Paxsenix API key. Add it in the Qobuz plugin settings.');
                return;
            }
        }

        if (sourceId === 'applejson') {
            const key = localStorage.getItem('qobuz_pax_api_key')?.trim() ?? '';
            if (!key) {
                showPaxKeyToast('It is advised that you install the Qobuz plugin and configure your Paxsenix key in its settings for reliable Apple Music lyrics.');
            }
        }

        selectedSource.set(sourceId);
        await switchLyricsSource(sourceId);
    }

    // ===============================================
    // delete a source's cached lyrics file (dropdown delete button)
    // ===============================================

    async function handleDeleteSource(sourceId: string, label: string, event: MouseEvent) {
        event.stopPropagation();
        const ok = await lyricsStore.deleteLyricsForSource(sourceId);
        if (ok) {
            addToast(`Deleted ${label} lyrics`, 'success');
        } else {
            addToast(`Failed to delete ${label} lyrics`, 'error');
        }
    }

    // =================================================
    // custom search query (shown on no lyrics found screen)
    // ==============================================
    /** the default query text derived from track metadata, e.g. Title - Artist */
    $: defaultQueryText = $currentTrack
        ? `${$currentTrack.title || "Unknown"} - ${$currentTrack.artist || "Unknown"}`
        : "";

    let customQueryInput = "";
    let customQueryChanged = false;
    let customQueryTrackPath: string | null = null;
    let customQueryDebounce: ReturnType<typeof setTimeout> | null = null;

    // reset the box to the default query whenever the track actually changes
    $: if ($currentTrack && $currentTrack.path !== customQueryTrackPath) {
        customQueryTrackPath = $currentTrack.path;
        customQueryInput = defaultQueryText;
        customQueryChanged = false;
    }

    function handleCustomQueryInput() {
        customQueryChanged = false;
        if (customQueryDebounce) clearTimeout(customQueryDebounce);
        customQueryDebounce = setTimeout(() => {
            const trimmed = customQueryInput.trim();
            customQueryChanged = trimmed.length > 0 && trimmed !== defaultQueryText.trim();
        }, 500);
    }

    /**
     * resolve $title / $artist / $album tokens into real metadata
     * then split on " - " (same shape as the default query text) to derive title/artist for the override
     * re walks the full auto-mode priority chain with this query
     */
    async function retryWithCustomQuery() {
        if (!$currentTrack) return;
        if (customQueryDebounce) clearTimeout(customQueryDebounce);

        const resolved = customQueryInput
            .replace(/\$title/gi, $currentTrack.title ?? "")
            .replace(/\$artist/gi, $currentTrack.artist ?? "")
            .replace(/\$album/gi, $currentTrack.album ?? "")
            .trim();

        if (!resolved) return;

        let title = resolved;
        let artist: string | undefined;
        const sepIdx = resolved.indexOf(" - ");
        if (sepIdx !== -1) {
            title = resolved.slice(0, sepIdx).trim();
            artist = resolved.slice(sepIdx + 3).trim();
        }

        customQueryChanged = false;
        const override: LyricsQueryOverride = { title, artist };
        await fetchLyricsForTrack(override);
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

{#if true}
    <aside class="lyrics-panel" class:mobile={$isMobile} class:closed={!$lyricsVisible}>

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
                                {#if $availableSources.includes('user')}
                                    {@const isActive = $lyricsData?.source === 'user'}
                                    {@const isCached = $availableSources.includes('user')}
                                    <li
                                        class="source-menu-item"
                                        class:active={isActive}
                                        role="option"
                                        aria-selected={isActive}
                                        tabindex="0"
                                        on:click={() => handleSourceSelect('user')}
                                        on:keydown={(e) => e.key === 'Enter' && handleSourceSelect('user')}
                                    >
                                        <span class="source-menu-label">Imported</span>
                                        <span class="source-menu-format">
                                            {#if $lyricsData?.source === 'user' && $lyricsData?.format}
                                                {$lyricsData.format.toUpperCase()}
                                            {/if}
                                        </span>
                                        {#if isActive}
                                            <svg class="source-menu-check" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                            </svg>
                                        {/if}
                                        <button
                                            class="source-menu-delete"
                                            disabled={!isCached}
                                            title={isCached ? 'Delete imported lyrics file' : 'No cached file'}
                                            aria-label="Delete Imported lyrics"
                                            on:click={(e) => handleDeleteSource('user', 'Imported', e)}
                                        >
                                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                                                <path d="M6 7h12v2H6zm2 3h2v9H8zm6 0h2v9h-2zM9 4h6l1 2H8z"/>
                                            </svg>
                                        </button>
                                    </li>
                                {/if}
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
                                        <button
                                            class="source-menu-delete"
                                            disabled={!isCached}
                                            title={isCached ? `Delete ${source.label} lyrics file` : 'No cached file'}
                                            aria-label={`Delete ${source.label} lyrics`}
                                            on:click={(e) => handleDeleteSource(source.id, source.label, e)}
                                        >
                                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                                                <path d="M6 7h12v2H6zm2 3h2v9H8zm6 0h2v9h-2zM9 4h6l1 2H8z"/>
                                            </svg>
                                        </button>
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
        {#if $lyricsLoading}
            <div class="lyrics-content">
                <div class="lyrics-status">
                    <div class="loading-spinner"></div>
                    <span>Searching for lyrics...</span>
                </div>
            </div>

        {:else if $lyricsError && !$lyricsData}
            <div class="lyrics-content">
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
                        <div class="custom-query-block">
                            <span class="custom-query-hint">Try a different query?</span>
                            <div class="custom-query-row">
                                <input
                                    type="text"
                                    class="custom-query-input"
                                    bind:value={customQueryInput}
                                    on:input={handleCustomQueryInput}
                                    on:keydown={(e) => e.key === 'Enter' && customQueryChanged && retryWithCustomQuery()}
                                    placeholder={defaultQueryText}
                                    aria-label="Custom lyrics search query"
                                />
                                {#if customQueryChanged}
                                    <button
                                        class="custom-query-retry"
                                        on:click={retryWithCustomQuery}
                                        title="Retry with this query"
                                        aria-label="Retry with this query"
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 01-5.65 4c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L14 11h7V4l-3.35 2.35z"/>
                                        </svg>
                                        Retry
                                    </button>
                                {/if}
                            </div>
                            <span class="custom-query-tip">Pro tip: use $title, $artist, or $album to keep the real metadata while customizing your query.</span>
                        </div>
                    {/if}

                    {#if showSourcePicker}
                        <div class="no-lyrics-sources">
                            <span class="no-lyrics-hint">Try a different source:</span>
                            <div class="no-lyrics-source-btns">
                                {#if $availableSources.includes('user')}
                                    <button class="source-try-btn" on:click={() => handleSourceSelect('user')}>
                                        Imported
                                    </button>
                                {/if}
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
            </div>

        {:else if $lyricsData && $lyricsData.lines.length > 0}
            <LyricsView style={lyricsViewStyle} />

        {:else if !$currentTrack}
            <div class="lyrics-content">
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
            </div>
        {/if}


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
                        {:else} · Unsynced
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
        transition: width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    min-width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    max-width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    opacity 0.25s ease,
                    border-left 0.3s ease;
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

    .lyrics-panel.closed {
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        opacity: 0;
        padding: 0;
        border-left: none;
        overflow: hidden;
        pointer-events: none;
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
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
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
        font-weight: var(--font-weight-semibold);
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
        min-width: 260px;
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
        padding: 8px 8px 8px 12px;
        border-radius: calc(var(--radius-md) - 2px);
        font-size: 0.82rem;
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .source-menu-item:hover { background: var(--bg-highlight); color: var(--text-primary); }
    .source-menu-item.active { color: var(--text-primary); font-weight: var(--font-weight-semibold); }

    .source-menu-label  { flex: 1; }

    .source-menu-format {
        font-size: 0.65rem;
        font-weight: var(--font-weight-bold);
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

    /* delete button . red, greyed out when there's no cached file */
    .source-menu-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        border-radius: var(--radius-full);
        color: #e05555;
        background: transparent;
        transition: all var(--transition-fast);
        margin-left: 2px;
    }
    .source-menu-delete:hover:not(:disabled) {
        background: rgba(224, 85, 85, 0.15);
        color: #ff4d4d;
    }
    .source-menu-delete:disabled {
        color: var(--text-subdued);
        opacity: 0.3;
        cursor: not-allowed;
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
    /*
     * this .lyrics-content is only used for the loading/error/no track fallback states below
     actual lyrics list has its own copy of this rule
     */
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
        font-size: var(--font-size-xs);
        opacity: 0.7;
    }

    .custom-query-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-top: var(--spacing-sm);
        width: 100%;
        max-width: 320px;
    }

    .custom-query-hint {
        font-size: 0.72rem;
        opacity: 0.6;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }

    .custom-query-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
    }

    .custom-query-input {
        flex: 1;
        min-width: 0;
        padding: 7px 12px;
        border-radius: var(--radius-full);
        border: 1px solid var(--border-color);
        background: var(--bg-highlight);
        color: var(--text-primary);
        font-size: 0.8rem;
        text-align: center;
        transition: all var(--transition-fast);
    }
    .custom-query-input::placeholder { color: var(--text-subdued); }
    .custom-query-input:focus {
        outline: none;
        border-color: var(--accent-primary);
        background: var(--bg-base);
    }

    .custom-query-retry {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
        padding: 7px 12px;
        border-radius: var(--radius-full);
        border: 1px solid var(--accent-primary);
        background: var(--accent-primary);
        color: #fff;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
        animation: menuIn 0.15s ease;
    }
    .custom-query-retry:hover { filter: brightness(1.1); }

    .custom-query-tip {
        font-size: 0.68rem;
        opacity: 0.5;
        text-align: center;
        line-height: 1.3;
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
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: all var(--transition-fast);
    }
    .source-try-btn:hover { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }


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

    /* .lyric-line sizing for mobile is handled via
    --lyrics-font-size/--lyrics-active-font-size custom properties passed to LyricsView
     * (see lyricsViewStyle) */
    .lyrics-panel.mobile .source-menu  { right: auto; left: 0; }

</style>
