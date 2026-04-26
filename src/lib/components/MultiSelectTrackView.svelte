<script lang="ts">
    import { onMount } from "svelte";
    import TrackList from "./TrackList.svelte";
    import { tracks as allTracks } from "$lib/stores/library";
    import { multiSelect } from "$lib/stores/multiselect";
    import { goToPlaylistDetail } from "$lib/stores/view";
    import { loadPlaylists, playlists } from "$lib/stores/library";
    import { addTracksToPlaylist } from "$lib/services/playlistHelpers";
    import { addToast } from "$lib/stores/toast";
    import { isMobile } from "$lib/stores/mobile";
    import { searchQuery, clearSearch } from "$lib/stores/search";

    export let playlistId: number;

    $: playlist = $playlists.find((p) => p.id === playlistId);
    $: selectedCount = $multiSelect.selectedTrackIds.size;

    let isAdding = false;

    // Mobile search for filtering tracks
    let filterInput = '';
    let filterTimer: ReturnType<typeof setTimeout>;
    $: filteredTracks = filterInput.trim()
        ? $allTracks.filter(t =>
            t.title?.toLowerCase().includes(filterInput.toLowerCase()) ||
            t.artist?.toLowerCase().includes(filterInput.toLowerCase()) ||
            t.album?.toLowerCase().includes(filterInput.toLowerCase())
          )
        : $allTracks;

    function handleFilterInput() {
        // No-op: reactive binding handles it
    }

    function clearFilter() {
        filterInput = '';
    }

    onMount(() => {
        // Activate multi-select mode
        multiSelect.activate(playlistId);

        return () => {
            // Cleanup on unmount
            multiSelect.deactivate();
        };
    });

    function handleCancel() {
        multiSelect.deactivate();
        goToPlaylistDetail(playlistId, playlist?.name ?? '');
    }

    async function handleAddToPlaylist() {
        if (selectedCount === 0) {
            addToast("Please select at least one track", "error");
            return;
        }

        isAdding = true;

        try {
            const trackIds = Array.from($multiSelect.selectedTrackIds);
            const result = await addTracksToPlaylist(playlistId, trackIds);

            if (result.success > 0) {
                addToast(
                    `Added ${result.success} track${result.success !== 1 ? "s" : ""} to playlist`,
                    "success"
                );
            }

            if (result.failed > 0) {
                addToast(
                    `Failed to add ${result.failed} track${result.failed !== 1 ? "s" : ""}`,
                    "error"
                );
            }

            // Reload playlists to update the UI
            await loadPlaylists();

            // Return to playlist detail
            multiSelect.deactivate();
            goToPlaylistDetail(playlistId, playlist?.name ?? '');
        } catch (error) {
            console.error("Failed to add tracks:", error);
            addToast("Failed to add tracks to playlist", "error");
        } finally {
            isAdding = false;
        }
    }

    function handleSelectAll() {
        multiSelect.selectAll(filteredTracks.map(t => t.id));
    }

    function handleClearAll() {
        multiSelect.clearSelections();
    }
</script>

<div class="multiselect-container" class:mobile={$isMobile}>
    <!-- Mobile: sticky header with title, search, and selection info -->
    {#if $isMobile}
        <div class="mobile-header">
            <div class="mobile-header-top">
                <button class="mobile-back-btn" on:click={handleCancel} aria-label="Go back">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                </button>
                <div class="mobile-header-info">
                    <h3 class="mobile-title">Add to <span class="playlist-highlight">{playlist?.name || "Playlist"}</span></h3>
                    <span class="mobile-subtitle">
                        {#if selectedCount > 0}
                            {selectedCount} selected
                        {:else}
                            Tap tracks to select
                        {/if}
                    </span>
                </div>
                <div class="mobile-header-actions">
                    {#if selectedCount > 0}
                        <button class="mobile-text-btn" on:click={handleClearAll}>Clear</button>
                    {:else}
                        <button class="mobile-text-btn" on:click={handleSelectAll}>All</button>
                    {/if}
                </div>
            </div>
            <div class="mobile-filter-bar">
                <svg class="filter-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                    type="text"
                    class="filter-input"
                    placeholder="Filter tracks..."
                    bind:value={filterInput}
                    on:input={handleFilterInput}
                    spellcheck="false"
                />
                {#if filterInput}
                    <button class="filter-clear" on:click={clearFilter} aria-label="Clear filter">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                {/if}
            </div>
        </div>
    {/if}

    <div class="tracklist-container">
        <TrackList 
            tracks={filteredTracks} 
            showAlbum={!$isMobile}
            multiSelectMode={true}
        />
    </div>

    <!-- Desktop: bottom action bar -->
    {#if !$isMobile}
    <div class="action-bar">
        <div class="action-bar-content">
            <div class="left-section">
                <h3 class="playlist-name">
                    Add to <span class="playlist-highlight">{playlist?.name || "Playlist"}</span>
                </h3>
                <div class="selection-info">
                    {#if selectedCount > 0}
                        <span class="selected-count">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                            {selectedCount} track{selectedCount !== 1 ? "s" : ""} selected
                        </span>
                        <button class="text-btn" on:click={handleClearAll}>
                            Clear all
                        </button>
                    {:else}
                        <span class="no-selection">No tracks selected</span>
                        <button class="text-btn" on:click={handleSelectAll}>
                            Select all
                        </button>
                    {/if}
                </div>
            </div>
            <div class="action-buttons">
                <button 
                    class="btn-secondary" 
                    on:click={handleCancel}
                    disabled={isAdding}
                >
                    Cancel
                </button>
                <button 
                    class="btn-primary" 
                    on:click={handleAddToPlaylist}
                    disabled={selectedCount === 0 || isAdding}
                >
                    {#if isAdding}
                        <div class="spinner-sm"></div>
                        Adding...
                    {:else}
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                        </svg>
                        Add to Playlist
                    {/if}
                </button>
            </div>
        </div>
    </div>
    {/if}

    <!-- Mobile: floating add button -->
    {#if $isMobile}
        <div class="mobile-fab-container">
            <button 
                class="mobile-fab"
                on:click={handleAddToPlaylist}
                disabled={selectedCount === 0 || isAdding}
            >
                {#if isAdding}
                    <div class="spinner-sm"></div>
                {:else}
                    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                {/if}
                <span>{isAdding ? 'Adding...' : `Add ${selectedCount > 0 ? selectedCount : ''} Song${selectedCount !== 1 ? 's' : ''}`}</span>
            </button>
        </div>
    {/if}
</div>

<style>
    .multiselect-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--bg-base);
    }

    .tracklist-container {
        flex: 1;
        overflow: hidden;
        min-height: 0;
    }

    /* ===== Desktop action bar ===== */
    .action-bar {
        border-top: 1px solid var(--border-color);
        background: linear-gradient(
            180deg,
            var(--bg-elevated) 0%,
            var(--bg-surface) 100%
        );
        padding: var(--spacing-lg);
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
    }

    .action-bar-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 1400px;
        margin: 0 auto;
        gap: var(--spacing-xl);
    }

    .left-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex: 1;
        min-width: 0;
    }

    .playlist-name {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
    }

    .playlist-highlight {
        color: var(--accent-primary);
        font-weight: 700;
    }

    .selection-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        font-size: 0.875rem;
    }

    .selected-count {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        color: var(--accent-primary);
        font-weight: 600;
    }

    .selected-count svg {
        flex-shrink: 0;
    }

    .no-selection {
        color: var(--text-subdued);
    }

    .text-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
        transition: color var(--transition-fast);
    }

    .text-btn:hover {
        color: var(--text-primary);
    }

    .action-buttons {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        flex-shrink: 0;
    }

    .btn-secondary,
    .btn-primary {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-lg);
        border-radius: var(--radius-full);
        font-size: 0.9375rem;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
    }

    .btn-secondary {
        background-color: transparent;
        border: 1px solid var(--border-color);
        color: var(--text-primary);
    }

    .btn-secondary:hover:not(:disabled) {
        border-color: var(--text-primary);
        background-color: var(--bg-highlight);
    }

    .btn-primary {
        background-color: var(--accent-primary);
        border: none;
        color: var(--bg-base);
    }

    .btn-primary:hover:not(:disabled) {
        background-color: var(--accent-hover);
        transform: scale(1.02);
    }

    .btn-primary:disabled,
    .btn-secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }

    .btn-primary svg {
        flex-shrink: 0;
    }

    .spinner-sm {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ===== Mobile styles ===== */
    .mobile-header {
        flex-shrink: 0;
        background-color: var(--bg-base);
        border-bottom: 1px solid var(--border-color);
    }

    .mobile-header-top {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-sm) 0;
    }

    .mobile-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-full);
        color: var(--text-primary);
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
    }

    .mobile-back-btn:active {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .mobile-header-info {
        flex: 1;
        min-width: 0;
    }

    .mobile-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .mobile-subtitle {
        font-size: 0.75rem;
        color: var(--text-secondary);
    }

    .mobile-header-actions {
        flex-shrink: 0;
    }

    .mobile-text-btn {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--accent-primary);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-full);
        -webkit-tap-highlight-color: transparent;
    }

    .mobile-text-btn:active {
        background-color: color-mix(in srgb, var(--accent-primary), transparent 85%);
    }

    .mobile-filter-bar {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm);
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: 0 var(--spacing-md);
        height: 36px;
    }

    .filter-icon {
        color: var(--text-subdued);
        flex-shrink: 0;
    }

    .filter-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: var(--text-primary);
        font-size: 0.8125rem;
        min-width: 0;
        height: 100%;
        user-select: text;
        -webkit-user-select: text;
    }

    .filter-input::placeholder {
        color: var(--text-subdued);
    }

    .filter-clear {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        padding: 4px;
        min-height: 28px;
        min-width: 28px;
        border-radius: var(--radius-full);
    }

    .filter-clear:active {
        color: var(--text-primary);
    }

    /* Mobile floating action button */
    .mobile-fab-container {
        position: fixed;
        bottom: calc(60px + env(safe-area-inset-bottom) + 12px);
        left: var(--spacing-md);
        right: var(--spacing-md);
        z-index: 950;
        pointer-events: none;
    }

    .mobile-fab {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        height: 52px;
        border-radius: var(--radius-full);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        font-size: 1rem;
        font-weight: 700;
        border: none;
        box-shadow: 0 4px 20px color-mix(in srgb, var(--accent-primary), transparent 60%), 0 2px 8px rgba(0, 0, 0, 0.3);
        pointer-events: auto;
        -webkit-tap-highlight-color: transparent;
        transition: all var(--transition-fast);
    }

    .mobile-fab:active:not(:disabled) {
        transform: scale(0.97);
        background-color: var(--accent-hover);
    }

    .mobile-fab:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        box-shadow: none;
    }

    .mobile-fab svg {
        flex-shrink: 0;
    }

    /* Mobile: pad the tracklist bottom so last items aren't behind the FAB */
    .multiselect-container.mobile .tracklist-container {
        padding-bottom: 0;
    }

    .multiselect-container.mobile .tracklist-container :global(.list-body) {
        padding-bottom: calc(60px + 52px + env(safe-area-inset-bottom) + 32px);
    }
</style>