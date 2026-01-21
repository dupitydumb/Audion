<script lang="ts">
    import { onMount } from "svelte";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { goBack, goForward, navigationHistory } from "$lib/stores/view";
    import {
        searchQuery,
        clearSearch,
        searchResults,
    } from "$lib/stores/search";
    import MenuBar from "./MenuBar.svelte";
    import Breadcrumbs from "./Breadcrumbs.svelte";

    const appWindow = getCurrentWindow();
    let isMaximized = false;

    function minimize() {
        appWindow.minimize();
    }

    async function toggleMaximize() {
        await appWindow.toggleMaximize();
        isMaximized = await appWindow.isMaximized();
    }

    function close() {
        appWindow.close();
    }

    let searchInput = "";
    let searchDebounceTimer: ReturnType<typeof setTimeout>;
    let searchInputEl: HTMLInputElement;

    let canGoBack = false;
    let canGoForward = false;

    function handleSearchInput(e: Event) {
        const target = e.target as HTMLInputElement;
        searchInput = target.value;

        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            searchQuery.set(searchInput);
        }, 200);
    }

    function handleClearSearch() {
        searchInput = "";
        clearSearch();
        searchInputEl?.focus();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            handleClearSearch();
            searchInputEl?.blur();
        }
    }

    function handleGlobalKeydown(e: KeyboardEvent) {
        // Ignore if active element is an input or textarea (except for specific shortcuts)
        const tagName = document.activeElement?.tagName.toLowerCase();
        const isInput = tagName === "input" || tagName === "textarea";

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            searchInputEl?.focus();
            searchInputEl?.select();
        }

        if (e.altKey && e.key === "ArrowLeft") {
            e.preventDefault();
            goBack();
        }

        if (e.altKey && e.key === "ArrowRight") {
            e.preventDefault();
            goForward();
        }
    }

    onMount(() => {
        // Initial maximize state
        appWindow.isMaximized().then((m) => (isMaximized = m));

        // Listen for resize to update maximize state
        const unlistenResize = appWindow.onResized(async () => {
            isMaximized = await appWindow.isMaximized();
        });

        const unsubscribeSearch = searchQuery.subscribe((value) => {
            if (value === "" && searchInput !== "") {
                searchInput = "";
            }
        });

        const unsubscribeNav = navigationHistory.subscribe((history) => {
            canGoBack = history.canGoBack;
            canGoForward = history.canGoForward;
        });

        window.addEventListener("keydown", handleGlobalKeydown);

        return () => {
            unsubscribeSearch();
            unsubscribeNav();
            window.removeEventListener("keydown", handleGlobalKeydown);
            unlistenResize.then((f) => f());
        };
    });
</script>

<div class="titlebar">
    <div class="titlebar-left">
        <div class="left-controls">
            <!-- Menu Dropdown -->
            <MenuBar />

            <!-- Navigation -->
            <div class="nav-group">
                <button
                    class="nav-btn"
                    on:click={goBack}
                    disabled={!canGoBack}
                    title="Go back (Alt+Left)"
                    aria-label="Go Back"
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                <button
                    class="nav-btn"
                    on:click={goForward}
                    disabled={!canGoForward}
                    title="Go forward (Alt+Right)"
                    aria-label="Go Forward"
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            </div>

            <!-- Breadcrumbs -->
            <div class="breadcrumbs-wrapper">
                <Breadcrumbs />
            </div>
        </div>
        <!-- Left Drag Region -->
        <div class="drag-region" data-tauri-drag-region></div>
    </div>

    <!-- Center Search Bar -->
    <div class="titlebar-center">
        <div class="search-input-wrapper">
            <svg
                class="search-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="18"
                height="18"
            >
                <path
                    d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                />
            </svg>
            <input
                type="text"
                class="search-input"
                placeholder="Search..."
                bind:value={searchInput}
                bind:this={searchInputEl}
                on:input={handleSearchInput}
                on:keydown={handleKeydown}
                spellcheck="false"
                title="Search (Ctrl+F)"
            />
            {#if searchInput}
                {#if $searchResults.hasResults}
                    <span class="search-count">
                        {$searchResults.tracks.length +
                            $searchResults.albums.length +
                            $searchResults.artists.length +
                            $searchResults.playlists.length} results
                    </span>
                {/if}
                <button
                    class="clear-search"
                    on:click={handleClearSearch}
                    title="Clear search (Esc)"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="16"
                        height="16"
                    >
                        <path
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </svg>
                </button>
            {/if}
        </div>
    </div>

    <div class="titlebar-right">
        <!-- Right Drag Region -->
        <div class="drag-region" data-tauri-drag-region></div>
        <div class="window-controls">
            <button class="win-btn" on:click={minimize} aria-label="Minimize">
                <svg
                    width="10"
                    height="1"
                    viewBox="0 0 10 1"
                    fill="currentColor"
                    ><rect width="10" height="1" rx="0.5" /></svg
                >
            </button>
            <button
                class="win-btn"
                on:click={toggleMaximize}
                aria-label="Maximize"
            >
                {#if isMaximized}
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1"
                        ><rect
                            x="1.5"
                            y="1.5"
                            width="7"
                            height="7"
                            rx="1"
                            transform="rotate(180 5 5)"
                        />
                        <path d="M3 3v-2h6v6h-2" stroke-width="1" />
                    </svg>
                {:else}
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1"
                        ><rect
                            x="1.5"
                            y="1.5"
                            width="7"
                            height="7"
                            rx="1"
                        /></svg
                    >
                {/if}
            </button>
            <button
                class="win-btn close-btn"
                on:click={close}
                aria-label="Close"
            >
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"><path d="M1 1l8 8M9 1L1 9" /></svg
                >
            </button>
        </div>
    </div>
</div>

<style>
    .titlebar {
        height: 48px;
        background: var(--bg-base);
        display: grid;
        grid-template-columns: 1fr minmax(auto, 400px) 1fr;
        align-items: center;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 50;
        user-select: none;
        -webkit-user-select: none;
        border-bottom: 1px solid var(--border-color);
    }

    .titlebar-left,
    .titlebar-right {
        display: flex;
        align-items: center;
        height: 100%;
        min-width: 0;
    }

    .titlebar-right {
        justify-content: flex-end;
    }

    .titlebar-center {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 0 8px;
    }

    .left-controls {
        display: flex;
        align-items: center;
        padding-left: 8px;
        height: 100%;
        flex-shrink: 0;
        z-index: 51;
        /* Ensure it sits above drag region if needed, but drag region is separate sibing */
    }

    .nav-group {
        display: flex;
        align-items: center;
        margin-left: 4px;
        margin-right: 8px; /* Spacing for breadcrumbs */
    }

    .nav-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 4px;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
    }

    .nav-btn:hover:not(:disabled) {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .nav-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .breadcrumbs-wrapper {
        display: flex;
        align-items: center;
        border-left: 1px solid var(--border-color);
        height: 20px; /* Separator height */
        padding-left: 4px;
    }

    /* Drag Regions */
    .drag-region {
        flex-grow: 1;
        height: 100%;
        min-width: 16px;
    }

    /* Search Bar */
    .search-input-wrapper {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        background-color: var(--bg-elevated);
        border-radius: var(--radius-full);
        padding: 0 12px;
        height: 32px;
        width: 100%;
        transition: background-color 0.2s;
        border: 1px solid transparent;
    }

    .search-input-wrapper:focus-within {
        background-color: var(--bg-surface);
        border-color: var(--accent-subtle);
    }

    .search-icon {
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .search-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: var(--text-primary);
        font-size: 0.875rem;
        min-width: 0;
        height: 100%;
        user-select: text;
        -webkit-user-select: text;
    }

    .search-input::placeholder {
        color: var(--text-subdued);
    }

    .search-count {
        font-size: 0.75rem;
        color: var(--text-subdued);
        white-space: nowrap;
        margin-right: 4px;
    }

    .clear-search {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        transform: scale(0.9);
        opacity: 0.7;
    }

    .clear-search:hover {
        color: var(--text-primary);
        transform: scale(1);
        opacity: 1;
    }

    .window-controls {
        display: flex;
        height: 100%;
        flex-shrink: 0;
        z-index: 51;
    }

    .win-btn {
        width: 46px;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        transition:
            background-color 0.2s,
            color 0.2s;
    }

    .win-btn:hover {
        background-color: var(--bg-highlight);
        color: var(--text-primary);
    }

    .close-btn:hover {
        background-color: #e81123;
        color: white;
    }
</style>
