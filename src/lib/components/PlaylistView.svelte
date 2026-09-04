<script lang="ts">
    import { _ } from "svelte-i18n";
    import { playlists, loadPlaylists } from "$lib/stores/library";
    import { goToPlaylistDetail } from "$lib/stores/view";
    import type { Playlist } from "$lib/api/tauri";
    import {
        createPlaylist,
        getPlaylistTracks,
        deletePlaylist,
        renamePlaylist,
        beginFolderImport,
        pickFolder,
    } from "$lib/api/tauri";
    import { playlistCovers } from "$lib/stores/playlistCovers";
    import { contextMenu } from "$lib/stores/ui";
    import { buildPlaylistContextMenu } from "$lib/menus/contextMenus";
    import { confirm } from "$lib/stores/dialogs";
    import {
        playTracks,
        addToQueue,
        currentPlaylistId,
        isPlaying,
        togglePlay,
    } from "$lib/stores/player";
    import type { Writable } from "svelte/store";
    import {
        pinnedItems,
        isPinned,
    } from "$lib/stores/pinned";
    import VirtualizedGrid from "./Virtualizedgrid.svelte";
    import MediaCard from "./MediaCard.svelte";
    import { onDestroy } from "svelte";
    import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
    import { progressiveScan } from "$lib/stores/progressiveScan"

    let currentScrollTop = getScroll("playlists");

    onDestroy(() => {
        saveScroll("playlists", currentScrollTop);
    });


    // playlistCovers
    const typedPlaylistCovers: Writable<Record<string, string>> =
        playlistCovers;

    // Playback state
    $: playingPlaylistId = $currentPlaylistId;
    $: playing = $isPlaying;
    $: pausedPlaylistId = !playing ? playingPlaylistId : null;

    async function handlePlayPlaylist(id: number) {
        if (pausedPlaylistId === id) {
            togglePlay();
            return;
        }
        if (playingPlaylistId === id && playing) return;
        try {
            const tracks = await getPlaylistTracks(id);
            if (tracks.length > 0) {
                const playlist = $playlists.find((p) => p.id === id);
                playTracks(tracks, 0, {
                    type: "playlist",
                    playlistId: id,
                    displayName: playlist?.name ?? "Playlist",
                });
            }
        } catch (err) {
            console.error("Failed to play playlist:", err);
        }
    }

    async function handleAddToQueue(id: number) {
        try {
            const tracks = await getPlaylistTracks(id);
            if (tracks.length > 0) addToQueue(tracks);
        } catch (err) {
            console.error("Failed to add playlist to queue:", err);
        }
    }

    async function handleDeletePlaylist(id: number, name: string) {
        if (
            !(await confirm(
                $_("playlists.deleteConfirm", { values: { name } }),
                {
                    title: $_("playlists.deletePlaylist"),
                    confirmLabel: $_("playlists.delete"),
                    danger: true,
                },
            ))
        )
            return;
        try {
            await deletePlaylist(id);
            await loadPlaylists();
        } catch (err) {
            console.error("Failed to delete playlist:", err);
        }
    }

    // Rename
    let renamingPlaylist: Playlist | null = null;
    let renameValue = "";
    let isRenaming = false;

    function startRename(playlist: Playlist) {
        renamingPlaylist = playlist;
        renameValue = playlist.name;
    }

    function cancelRename() {
        renamingPlaylist = null;
        renameValue = "";
    }

    async function commitRename() {
        if (!renamingPlaylist || !renameValue.trim()) return;
        if (renameValue.trim() === renamingPlaylist.name) {
            cancelRename();
            return;
        }
        isRenaming = true;
        try {
            await renamePlaylist(renamingPlaylist.id, renameValue.trim());
            await loadPlaylists();
            cancelRename();
        } catch (err) {
            console.error("Failed to rename playlist:", err);
        } finally {
            isRenaming = false;
        }
    }

    function handleRenameKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") commitRename();
        else if (e.key === "Escape") cancelRename();
    }

    // Navigation
    function handlePlaylistClick(playlist: Playlist, e: MouseEvent) {
        if ((e.target as HTMLElement).closest("[data-mediacard-play]")) return;
        goToPlaylistDetail(playlist.id, playlist.name);
    }

    function handlePlaylistContextMenu(playlist: Playlist, e: MouseEvent) {
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildPlaylistContextMenu({
                playlist,
                variant: "grid",
                onPlay: () => handlePlayPlaylist(playlist.id),
                onAddToQueue: () => handleAddToQueue(playlist.id),
                onRename: () => startRename(playlist),
                onDelete: () => handleDeletePlaylist(playlist.id, playlist.name),
                t: $_,
            }),
        });
    }

    // Cover helpers
    function initialsFromName(name: string): string {
        if (!name) return "PL";
        const parts = name.trim().split(/\s+/);
        return (
            parts
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("") || name.slice(0, 2).toUpperCase()
        );
    }

    function hashToColor(str: string): string {
        let h = 0;
        for (let i = 0; i < str.length; i++)
            h = (h << 5) - h + str.charCodeAt(i);
        return `hsl(${Math.abs(h) % 360} 30% 30%)`;
    }

    function generateSvgCover(name: string, size = 512): string {
        const initials = initialsFromName(name);
        const bg = hashToColor(name || "playlist");
        const svg =
            `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
            `<rect width='100%' height='100%' fill='${bg}'/>` +
            `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Inter, system-ui, sans-serif' font-size='${Math.floor(size / 3)}' fill='white' font-weight='700'>${initials}</text>` +
            `</svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    }

    function getCoverSrc(playlist: Playlist): string {
        return (
            $typedPlaylistCovers?.[playlist.id] ??
            playlist.cover_url ??
            generateSvgCover(playlist.name || "Playlist", 512)
        );
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
        } catch (err) {
            console.error("Failed to create playlist:", err);
        } finally {
            isCreating = false;
        }
    }

    function handleCreateKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            handleCreatePlaylist();
        } else if (e.key === "Escape") {
            showCreateForm = false;
            newPlaylistName = "";
        }
    }

    async function handleImportFolder() {
        try {
            const path = await pickFolder();
            if (!path) return;

            // 1. Register listeners before the backend can fire events
            await progressiveScan.prepareImport();

            // 2. invoke the backend
            const playlistId = await beginFolderImport(path);

            // 3. playlist ID into store state (listeners already live)
            await progressiveScan.startImport(playlistId);

            // Wait for scan to finish, with a timeout in case the
            // complete event is never received (e.g. backend crash, reload mid-scan).
            await new Promise<void>((resolve) => {
                const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

                const timer = setTimeout(() => {
                    console.warn('[handleImportFolder] Scan completion timed out — forcing resolution');
                    unsub();
                    resolve();
                }, TIMEOUT_MS);

                const unsub = progressiveScan.subscribe(state => {
                    if (!state.isScanning) {
                        clearTimeout(timer);
                        unsub();
                        resolve();
                    }
                });
            });

            await loadPlaylists();
        } catch (err) {
            console.error('Failed to import folder as playlist:', err);
        } finally {
            progressiveScan.reset();
        }
    }

    // Sorting
    $: sortedPlaylists = [...$playlists].sort((a, b) => {
        const aPinned = isPinned("playlist", a.id, $pinnedItems);
        const bPinned = isPinned("playlist", b.id, $pinnedItems);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
    });

    $: emptyState = {
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>`,
        title: $_("playlists.emptyTitle"),
        description: $_("playlists.emptyDescription"),
    };
</script>

<div class="playlist-view">
    <header class="view-header">
        <h1>{$_("sidebar.playlists")}</h1>
        <div class="header-actions">
            <button
                class="btn-secondary"
                on:click={handleImportFolder}
            >
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                {$_("playlists.importFolder")}
            </button>
            <button
            class="btn-secondary"
            on:click={() => (showCreateForm = !showCreateForm)}
            aria-expanded={showCreateForm}
            aria-controls="create-form"
        >
            <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="20"
                height="20"
                aria-hidden="true"
            >
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            {$_("playlists.newPlaylist")}
        </button>
        </div>
    </header>

    {#if showCreateForm}
        <div
            class="create-form animate-slide-up"
            id="create-form"
            role="form"
            aria-label="Create new playlist"
        >
            <input
                type="text"
                bind:value={newPlaylistName}
                on:keydown={handleCreateKeyDown}
                placeholder={$_("playlists.playlistNamePlaceholder")}
                aria-label="Playlist name"
            />
            <button
                class="btn-primary"
                on:click={handleCreatePlaylist}
                disabled={isCreating || !newPlaylistName.trim()}
            >
                {isCreating
                    ? $_("playlists.creating")
                    : $_("common.create")}
            </button>
            <button
                class="btn-secondary"
                on:click={() => {
                    showCreateForm = false;
                    newPlaylistName = "";
                }}
            >
                {$_("common.cancel")}
            </button>
        </div>
    {/if}

    {#if renamingPlaylist}
        <div
            class="create-form animate-slide-up"
            role="form"
            aria-label="Rename playlist"
        >
            <span class="rename-label"
                >{$_("playlists.renaming", { values: { name: renamingPlaylist.name } })}</span
            >
            <input
                type="text"
                bind:value={renameValue}
                on:keydown={handleRenameKeyDown}
                placeholder={$_("playlists.newNamePlaceholder")}
                aria-label="New playlist name"
            />
            <button
                class="btn-primary"
                on:click={commitRename}
                disabled={isRenaming || !renameValue.trim()}
            >
                {isRenaming
                    ? $_("common.saving")
                    : $_("common.rename")}
            </button>
            <button class="btn-secondary" on:click={cancelRename}
                >{$_("common.cancel")}</button
            >
        </div>
    {/if}

    <VirtualizedGrid
        items={sortedPlaylists}
        bind:currentScrollTop
        initialScrollTop={currentScrollTop}
        onItemClick={handlePlaylistClick}
        onItemContextMenu={handlePlaylistContextMenu}
        emptyStateConfig={emptyState}
        let:item={playlist}
    >
        {@const cover = getCoverSrc(playlist)}
        {@const isNowPlaying = playingPlaylistId === playlist.id && playing}
        {@const isPaused = pausedPlaylistId === playlist.id}

        <MediaCard
            {isNowPlaying}
            {isPaused}
            isPinned={isPinned("playlist", playlist.id, $pinnedItems)}
            playTooltip={$_("common.playPlaylist")}
            resumeTooltip={$_("common.resumePlaylist")}
            pauseTooltip={$_("common.pause")}
            ariaLabel={playlist.name}
            primaryText={playlist.name}
            secondaryText={$_("common.playlist")}
            on:play={() => handlePlayPlaylist(playlist.id)}
            on:pause={togglePlay}
        >
            <svelte:fragment slot="cover">
                <img
                    src={cover}
                    alt={playlist.name}
                    loading="lazy"
                    decoding="async"
                    on:error={(e) => handleImageError(e, playlist)}
                />
            </svelte:fragment>
        </MediaCard>
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
        font-weight: var(--font-weight-bold);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .create-form {
        display: flex;
        align-items: center;
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
        color: var(--text-primary);
    }

    .create-form input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .rename-label {
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        white-space: nowrap;
        flex-shrink: 0;
    }

    :global(html.layout-mobile) .rename-label {
        display: none;
    }
</style>
