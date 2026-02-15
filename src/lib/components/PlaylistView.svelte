<script lang="ts">
    import { playlists, loadPlaylists } from "$lib/stores/library";
    import { goToPlaylistDetail } from "$lib/stores/view";
    import {
        createPlaylist,
        getPlaylistTracks,
        deletePlaylist,
        renamePlaylist,
    } from "$lib/api/tauri";
    import {
        playlistCovers,
        setPlaylistCover,
    } from "$lib/stores/playlistCovers";
    import { contextMenu } from "$lib/stores/ui";
    import { playTracks, addToQueue, currentPlaylistId, isPlaying, togglePlay } from "$lib/stores/player";
    import type { Writable } from "svelte/store";
    import { confirm } from "$lib/stores/dialogs";
    import VirtualizedGrid from "./Virtualizedgrid.svelte";

    type Playlist = { id: number; name: string };

    // playlistCovers
    const typedPlaylistCovers: Writable<Record<string, string>> = playlistCovers;

    // Extract store values
    $: playingPlaylistId = $currentPlaylistId;
    $: playing = $isPlaying;
    
    // Determine if this playlist is the current one and paused
    function isPlaylistPaused(id: number): boolean {
        return playingPlaylistId === id && !playing;
    }

    function handlePauseClick(e: MouseEvent) {
        e.stopPropagation();
        togglePlay();
    }

    async function handleDeletePlaylist(id: number, name: string) {
        if (
            !(await confirm(`Delete playlist "${name}"?`, {
                title: "Delete Playlist",
                confirmLabel: "Delete",
                danger: true,
            }))
        )
            return;

        try {
            await deletePlaylist(id);
            await loadPlaylists();
        } catch (error) {
            console.error("Failed to delete playlist:", error);
        }
    }

    async function handlePlayPlaylist(id: number) {
        // If paused, resume playback
        if (isPlaylistPaused(id)) {
            togglePlay();
            return;
        }

        // Don't restart if already playing
        if (playingPlaylistId === id && playing) {
            return;
        }

        try {
            const tracks = await getPlaylistTracks(id);
            if (tracks.length > 0) {
                const playlist = $playlists.find(p => p.id === id);
                playTracks(tracks, 0, {
                    type: 'playlist',
                    playlistId: id,
                    displayName: playlist?.name ?? 'Playlist'
                });
            }
        } catch (error) {
            console.error("Failed to play playlist:", error);
        }
    }

    async function handleAddToQueue(id: number) {
        try {
            const tracks = await getPlaylistTracks(id);
            if (tracks.length > 0) {
                addToQueue(tracks);
            }
        } catch (error) {
            console.error("Failed to add playlist to queue:", error);
        }
    }

    async function handlePlaylistClick(playlist: Playlist, e: MouseEvent) {
        const target = e.target as HTMLElement;
        
        // Check if play button was clicked
        const playButton = target.closest('.play-button');
        if (playButton) {
            e.stopPropagation();
            await handlePlayPlaylist(playlist.id);
            return;
        }

        // Otherwise navigate to playlist detail
        goToPlaylistDetail(playlist.id);
    }

    async function handlePlaylistContextMenu(playlist: Playlist, e: MouseEvent) {
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: "Play",
                    action: () => handlePlayPlaylist(playlist.id),
                },
                {
                    label: "Add to Queue",
                    action: () => handleAddToQueue(playlist.id),
                },
                { type: "separator" },
                {
                    label: "Rename",
                    action: async () => {
                        const newName = prompt("Enter new name:", playlist.name);
                        if (newName && newName.trim() && newName !== playlist.name) {
                            try {
                                await renamePlaylist(playlist.id, newName.trim());
                                await loadPlaylists();
                            } catch (error) {
                                console.error("Failed to rename playlist:", error);
                            }
                        }
                    },
                },
                {
                    label: "Change Cover",
                    action: () => {
                        // Trigger a file input click - tricky without a hidden input for each card
                        // Maybe we can use a shared open dialog?
                        // For now, let's skip or implement a shared input.
                        // Actually, let's reuse the logic from PlaylistDetail but adapting it is hard without the input element.
                        // Let's just create a dynamic input or use the one from the detail view concept.
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                    const result = reader.result as string;
                                    setPlaylistCover(playlist.id, result);
                                };
                                reader.readAsDataURL(file);
                            }
                        };
                        input.click();
                    },
                },
                { type: "separator" },
                {
                    label: "Delete Playlist",
                    action: () => handleDeletePlaylist(playlist.id, playlist.name),
                },
            ],
        });
    }

    function initialsFromName(name: string) {
        if (!name) return "PL";
        const parts = name.trim().split(/\s+/);
        const picked = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
        return picked.join("") || name.slice(0, 2).toUpperCase();
    }

    function hashToColor(str: string) {
        let h = 0;
        for (let i = 0; i < str.length; i++)
            h = (h << 5) - h + str.charCodeAt(i);
        const hue = Math.abs(h) % 360;
        return `hsl(${hue} 30% 30%)`;
    }

    function generateSvgCover(name: string, size = 512) {
        const initials = initialsFromName(name);
        const bg = hashToColor(name || "playlist");
        const svg =
            `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
            `<rect width='100%' height='100%' fill='${bg}'/>` +
            `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Inter, system-ui, sans-serif' font-size='${Math.floor(size / 3)}' fill='white' font-weight='700'>${initials}</text>` +
            `</svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    }

    function getCoverSrc(playlist: Playlist) {
        const custom = $typedPlaylistCovers && $typedPlaylistCovers[playlist.id];
        if (custom) return custom;
        return generateSvgCover(playlist.name || "Playlist", 512);
    }

    // Handle image error - fallback to generated cover
    function handleImageError(e: Event, playlist: Playlist) {
        const img = e.target as HTMLImageElement;
        img.src = generateSvgCover(playlist.name || "Playlist", 512);
    }

    // Create playlist form
    let newPlaylistName = "";
    let isCreating = false;
    let showCreateForm = false;

    async function handleCreatePlaylist() {
        if (!newPlaylistName.trim()) return;

        isCreating = true;
        try {
            await createPlaylist(newPlaylistName.trim());
            await loadPlaylists();
            newPlaylistName = "";
            showCreateForm = false;
        } catch (error) {
            console.error("Failed to create playlist:", error);
        } finally {
            isCreating = false;
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            handleCreatePlaylist();
        } else if (e.key === "Escape") {
            showCreateForm = false;
            newPlaylistName = "";
        }
    }

    const emptyState = {
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>`,
        title: "No playlists yet",
        description: "Create your first playlist to organize your music"
    };
</script>

<div class="playlist-view">
    <header class="view-header">
        <h1>Playlists</h1>
        <button
            class="btn-secondary"
            on:click={() => (showCreateForm = !showCreateForm)}
        >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            New Playlist
        </button>
    </header>

    {#if showCreateForm}
        <div class="create-form animate-slide-up">
            <input
                type="text"
                bind:value={newPlaylistName}
                on:keydown={handleKeyDown}
                placeholder="Playlist name..."
                autofocus
            />
            <button
                class="btn-primary"
                on:click={handleCreatePlaylist}
                disabled={isCreating || !newPlaylistName.trim()}
            >
                {isCreating ? "Creating..." : "Create"}
            </button>
            <button
                class="btn-secondary"
                on:click={() => {
                    showCreateForm = false;
                    newPlaylistName = "";
                }}
            >
                Cancel
            </button>
        </div>
    {/if}

    <VirtualizedGrid
        items={$playlists}
        onItemClick={handlePlaylistClick}
        onItemContextMenu={handlePlaylistContextMenu}
        emptyStateConfig={emptyState}
        let:item={playlist}
    >
        <div
            class="playlist-card"
            class:now-playing={playingPlaylistId === playlist.id && playing}
            class:paused={isPlaylistPaused(playlist.id)}
        >
            <div class="playlist-cover">
                <img
                    src={getCoverSrc(playlist)}
                    alt="Playlist cover"
                    loading="lazy"
                    decoding="async"
                    on:error={(e) => handleImageError(e, playlist)}
                />
                {#if playingPlaylistId === playlist.id && playing}
                    <div class="now-playing-badge">
                        Now Playing
                    </div>
                {:else if isPlaylistPaused(playlist.id)}
                    <div class="now-playing-badge paused-badge">
                        Paused
                    </div>
                {/if}
                
                {#if playingPlaylistId === playlist.id && playing}
                    <div class="playing-indicator-container">
                        <div class="playing-indicator">
                            <span class="bar"></span>
                            <span class="bar"></span>
                            <span class="bar"></span>
                        </div>
                        <button 
                            class="pause-button-overlay"
                            on:click={handlePauseClick}
                            aria-label="Pause"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                        </button>
                    </div>
                {/if}
                <!-- Darkening overlay when hovering the playlist cover -->
                <div class="playlist-cover-overlay" class:is-playing={playingPlaylistId === playlist.id && playing}>
                    {#if !(playingPlaylistId === playlist.id && playing)}
                        <div class="play-button">
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="24"
                                height="24"
                                aria-hidden="true"
                            >
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    {/if}
                </div>
            </div>
            <div class="playlist-info">
                <span class="playlist-name truncate">{playlist.name}</span>
                <span class="playlist-type">Playlist</span>
            </div>
        </div>
    </VirtualizedGrid>
</div>

<style>
    .playlist-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: var(--spacing-md);
        padding-bottom: 0;
    }

    .view-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-lg);
        flex-shrink: 0;
    }

    .view-header h1 {
        font-size: 2rem;
        font-weight: 700;
    }

    .create-form {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-lg);
        padding: var(--spacing-md);
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        flex-shrink: 0;
    }

    .create-form input {
        flex: 1;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-surface);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-color);
    }

    .create-form input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .playlist-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: left;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .playlist-card:hover {
        background-color: var(--bg-surface);
    }

    .playlist-card.now-playing {
        background-color: var(--accent-subtle);
    }

    .playlist-card.now-playing:hover {
        background-color: var(--accent-subtle);
        opacity: 0.95;
    }

    /* Paused state*/
    .playlist-card.paused {
        background-color: var(--accent-subtle);
    }

    .playlist-card.paused:hover {
        background-color: var(--accent-subtle);
        opacity: 0.95;
    }

    .playlist-cover {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background-color: var(--bg-surface);
        margin-bottom: var(--spacing-md);
        box-shadow: var(--shadow-md);
        isolation: isolate;
        flex-shrink: 0;
        max-height: calc(100% - 60px);
    }

    .playlist-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .now-playing-badge {
        position: absolute;
        top: var(--spacing-sm);
        left: var(--spacing-sm);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;
        pointer-events: none;
        z-index: 2;
    }

    .now-playing-badge.paused-badge {
        background-color: var(--text-secondary);
    }

    .playlist-cover-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity var(--transition-fast);
        pointer-events: none;
    }

    /* overlay when hovering the playlist-cover */
    .playlist-cover:hover .playlist-cover-overlay {
        opacity: 1;
        pointer-events: auto;
    }

    .playlist-cover-overlay.is-playing {
        opacity: 0;
        background: transparent;
    }

    .playlist-cover:hover .playlist-cover-overlay.is-playing {
        opacity: 1;
        background: rgba(0, 0, 0, 0.5);
    }

    /* Playing indicator*/
    .playing-indicator-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 3;
        pointer-events: auto;
    }

    .playing-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 48px;
        height: 48px;
        background-color: var(--accent-primary);
        border-radius: var(--radius-full);
        box-shadow: var(--shadow-lg);
        cursor: pointer;
        transition: transform var(--transition-fast);
        position: relative;
    }

    .playing-indicator:hover {
        transform: scale(1.05);
    }

    .playing-indicator .bar {
        width: 4px;
        height: 16px;
        background-color: var(--bg-base);
        border-radius: 2px;
        animation: equalizer 0.8s ease-in-out infinite;
    }

    .playing-indicator .bar:nth-child(2) {
        animation-delay: 0.2s;
    }

    .playing-indicator .bar:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes equalizer {
        0%,
        100% {
            height: 6px;
        }
        50% {
            height: 20px;
        }
    }

    /* Pause button overlay*/
    .pause-button-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--accent-primary);
        border-radius: var(--radius-full);
        opacity: 0;
        transition: opacity var(--transition-fast);
        color: var(--bg-base);
        border: none;
        padding: 0;
        cursor: pointer;
    }

    /* tooltip for pause button */
    .pause-button-overlay::after {
        content: "Pause";
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        background-color: var(--bg-surface);
        color: var(--text-primary);
        font-size: 0.75rem;
        border-radius: var(--radius-sm);
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--transition-fast);
        box-shadow: var(--shadow-md);
        z-index: 1000;
    }

    .playing-indicator-container:hover .pause-button-overlay {
        opacity: 1;
    }

    .pause-button-overlay:hover::after {
        opacity: 1;
    }

    .play-button {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-full);
        background-color: var(--accent-primary);
        color: var(--bg-base);
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translateY(8px);
        transition: transform var(--transition-fast), scale var(--transition-fast);
        box-shadow: var(--shadow-lg);
        will-change: transform, scale;
        cursor: pointer;
        position: relative;
    }

    .play-button::after {
        content: 'Play playlist';
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        background-color: var(--bg-surface);
        color: var(--text-primary);
        font-size: 0.75rem;
        border-radius: var(--radius-sm);
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--transition-fast);
        box-shadow: var(--shadow-md);
        z-index: 1000;
    }
    
    .playlist-card.paused .play-button::after {
        content: "Resume playlist";
    }

    .play-button:hover::after {
        opacity: 1;
    }

    .playlist-card:hover .play-button {
        transform: translateY(0);
    }

    .play-button:hover {
        transform: translateY(0) scale(1.05);
    }

    .playlist-info {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .playlist-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .playlist-card.now-playing .playlist-name {
        color: var(--accent-primary);
    }

    .playlist-card.paused .playlist-name {
        color: var(--accent-primary);
    }

    .playlist-type {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .playlist-card.now-playing .playlist-type {
        color: var(--accent-primary);
        opacity: 0.8;
    }

    .playlist-card.paused .playlist-type {
        color: var(--accent-primary);
        opacity: 0.8;
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Mobile ── */
    @media (max-width: 768px) {
        .playlist-card {
            padding: var(--spacing-sm);
        }

        .playlist-cover {
            margin-bottom: var(--spacing-sm);
        }

        .playlist-name {
            font-size: 0.8125rem;
        }

        .playlist-type {
            font-size: 0.75rem;
        }

        .play-overlay {
            display: none;
        }

        .now-playing-badge {
            font-size: 0.625rem;
            padding: 2px 6px;
        }
    }
</style>