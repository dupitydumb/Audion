<script lang="ts">
    import { onMount } from "svelte";
    import TrackList from "./TrackList.svelte";
    import { tracks as allTracks } from "$lib/stores/library";
    import { multiSelect } from "$lib/stores/multiselect";
    import { goToPlaylistDetail } from "$lib/stores/view";
    import { loadPlaylists, playlists } from "$lib/stores/library";
    import { addTracksToPlaylist } from "$lib/services/playlistHelpers";
    import { addToast } from "$lib/stores/toast";

    export let playlistId: number;

    $: playlist = $playlists.find((p) => p.id === playlistId);
    $: selectedCount = $multiSelect.selectedTrackIds.size;

    let isAdding = false;

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
        goToPlaylistDetail(playlistId);
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
            goToPlaylistDetail(playlistId);
        } catch (error) {
            console.error("Failed to add tracks:", error);
            addToast("Failed to add tracks to playlist", "error");
        } finally {
            isAdding = false;
        }
    }

    function handleSelectAll() {
        multiSelect.selectAll($allTracks.map(t => t.id));
    }

    function handleClearAll() {
        multiSelect.clearSelections();
    }
</script>

<div class="multiselect-container">
    <div class="tracklist-container">
        <TrackList 
            tracks={$allTracks} 
            showAlbum={true}
            multiSelectMode={true}
        />
    </div>

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
    }

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

    @media (max-width: 768px) {
        .action-bar-content {
            flex-direction: column;
            align-items: stretch;
            gap: var(--spacing-md);
        }

        .action-buttons {
            width: 100%;
        }

        .action-buttons button {
            flex: 1;
        }
    }
</style>