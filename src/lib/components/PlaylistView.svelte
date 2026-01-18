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
        removePlaylistCover,
    } from "$lib/stores/playlistCovers";
    import { contextMenu } from "$lib/stores/ui";
    import { playTracks, addToQueue } from "$lib/stores/player";
    import type { Writable } from "svelte/store";

    import { confirm } from "$lib/stores/dialogs";

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
        try {
            const tracks = await getPlaylistTracks(id);
            if (tracks.length > 0) {
                playTracks(tracks, 0);
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

    function handleContextMenu(
        e: MouseEvent,
        playlist: { id: number; name: string },
    ) {
        e.preventDefault();

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
                        const newName = prompt(
                            "Enter new name:",
                            playlist.name,
                        );
                        if (
                            newName &&
                            newName.trim() &&
                            newName !== playlist.name
                        ) {
                            try {
                                await renamePlaylist(
                                    playlist.id,
                                    newName.trim(),
                                );
                                await loadPlaylists();
                            } catch (error) {
                                console.error(
                                    "Failed to rename playlist:",
                                    error,
                                );
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
                            const file = (e.target as HTMLInputElement)
                                .files?.[0];
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
                    action: () =>
                        handleDeletePlaylist(playlist.id, playlist.name),
                },
            ],
        });
    }

    // Explicitly type playlistCovers as a Writable<Record<string, string>>
    const typedPlaylistCovers: Writable<Record<string, string>> =
        playlistCovers;

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

    function getCoverSrc(playlist: { id: string; name: string }) {
        const custom =
            $typedPlaylistCovers && $typedPlaylistCovers[playlist.id];
        if (custom) return custom;
        return generateSvgCover(playlist.name || "Playlist", 512);
    }
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

    <div class="playlist-grid">
        {#each $playlists as playlist}
            <button
                class="playlist-card"
                on:click={() => goToPlaylistDetail(playlist.id)}
                on:contextmenu={(e) => handleContextMenu(e, playlist)}
            >
                <div class="playlist-cover">
                    <img
                        src={getCoverSrc({
                            id: String(playlist.id),
                            name: playlist.name,
                        })}
                        alt="Playlist cover"
                        loading="lazy"
                        decoding="async"
                    />
                </div>
                <div class="playlist-info">
                    <span class="playlist-name truncate">{playlist.name}</span>
                    <span class="playlist-type">Playlist</span>
                </div>
            </button>
        {:else}
            <div class="empty-state">
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="48"
                    height="48"
                >
                    <path
                        d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
                    />
                </svg>
                <h3>No playlists yet</h3>
                <p>Create your first playlist to organize your music</p>
            </div>
        {/each}
    </div>
</div>

<style>
    .playlist-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        padding: var(--spacing-md);
        overflow: hidden;
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

    .playlist-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--spacing-lg);
        padding: var(--spacing-md);
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        align-content: start;
    }

    .playlist-card {
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: background-color var(--transition-normal);
        text-align: left;
    }

    .playlist-card:hover {
        background-color: var(--bg-surface);
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
    }

    .playlist-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
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

    .playlist-type {
        font-size: 0.8125rem;
        color: var(--text-secondary);
    }

    .empty-state {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
    }

    .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: 0.875rem;
    }
</style>
