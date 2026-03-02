<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import {
        playlists,
        loadPlaylists,
        trackCount,
        albumCount,
        artistCount,
        loadAlbumsAndArtists,
    } from "$lib/stores/library";
    import {
        currentView,
        goToHome,
        goToTracks,
        goToAlbums,
        goToArtists,
        goToPlaylists,
        goToPlaylistDetail,
        goToPlugins,
        goToSettings,
        goToLikedSongs,
    } from "$lib/stores/view";
    import {
        isSettingsOpen as isSettingsOpenUI,
        toggleSettings as toggleSettingsUI,
        contextMenu,
    } from "$lib/stores/ui";
    import { appSettings } from "$lib/stores/settings";
    import { likedCount } from "$lib/stores/liked";
    import {
        selectMusicFolder,
        addFolder,
        rescanMusic,
        deletePlaylist,
        createPlaylist,
        type Playlist,
        getPlaylistTracks,
        renamePlaylist,
    } from "$lib/api/tauri";
    import { progressiveScan } from "$lib/stores/progressiveScan";
    import { confirm } from "$lib/stores/dialogs";
    import {
        playTracks,
        addToQueue,
        currentTrack,
        isPlaying,
        togglePlay,
    } from "$lib/stores/player";
    import { playlistCovers, setPlaylistCover } from "$lib/stores/playlistCovers";
    import { uiSlotManager } from "$lib/plugins/ui-slots";

    import { updates } from "$lib/stores/updates";
    import UpdatePopup from "./UpdatePopup.svelte";

    import { currentPlaylistId } from "$lib/stores/player";

    const dispatch = createEventDispatcher();

    function navigateAndClose(fn: () => void) {
        fn();
        dispatch("navigate");
    }

    let isScanning = false;
    let scanStatus = "Scanning...";
    let scanError: string | null = null;
    let showUpdatePopup = false;

    // Playlist collapse state
    let playlistsExpanded = true;
    let playlistHeaderHovered = false;

    // Per-item hover state for overlay
    let hoveredPlaylistId: number | null = null;

    // Marquee
    const MARQUEE_GAP = 48;
    let marqueeActive: Record<number, boolean> = {};
    let marqueeOverflows: Record<number, boolean> = {};
    let marqueeDurations: Record<number, string> = {};
    let nameEls = new Map<number, HTMLSpanElement>();

    function registerNameEl(node: HTMLSpanElement, id: number) {
        nameEls.set(id, node);
        return { destroy() { nameEls.delete(id); } };
    }

    function measureOverflow(id: number) {
        requestAnimationFrame(() => {
            const el = nameEls.get(id);
            const overflows = el ? el.scrollWidth > el.clientWidth : false;
            marqueeDurations = { ...marqueeDurations, [id]: overflows ? `${Math.max(3, (el!.scrollWidth + MARQUEE_GAP) / 55).toFixed(1)}s` : "0s" };
            marqueeOverflows = { ...marqueeOverflows, [id]: overflows };
        });
    }

    function handleItemMouseEnter(id: number) {
        hoveredPlaylistId = id;
        marqueeActive = { ...marqueeActive, [id]: true };
        measureOverflow(id);
    }

    function handleItemMouseLeave(id: number) {
        hoveredPlaylistId = null;
        marqueeActive = { ...marqueeActive, [id]: false };
        const { [id]: _o, ...restO } = marqueeOverflows;
        marqueeOverflows = restO;
        const { [id]: _d, ...restD } = marqueeDurations;
        marqueeDurations = restD;
    }

    // Inline rename state
    let renamingPlaylistId: number | null = null;
    let renameValue = "";

    // Inline create state
    let creatingPlaylist = false;
    let createValue = "";

    function startCreatePlaylist() {
        creatingPlaylist = true;
        createValue = "";
        setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('.create-input');
            if (input) { input.focus(); }
        }, 50);
    }

    function cancelCreate() {
        creatingPlaylist = false;
        createValue = "";
    }

    async function saveCreate() {
        const trimmed = createValue.trim();
        if (trimmed) {
            try {
                await createPlaylist(trimmed);
                await loadPlaylists();
                playlistsExpanded = true;
            } catch (error) {
                console.error("Failed to create playlist:", error);
            }
        }
        creatingPlaylist = false;
        createValue = "";
    }

    function handleCreateKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") { e.preventDefault(); saveCreate(); }
        if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
    }

    function handleAllPlaylistsContextMenu(e: MouseEvent) {
        e.preventDefault();
        contextMenu.set({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "New Playlist", action: () => startCreatePlaylist() },
            ],
        });
    }

    function startRename(playlist: Playlist) {
        renamingPlaylistId = playlist.id;
        renameValue = playlist.name;
        // Focus the input after DOM update
        setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('.rename-input');
            if (input) { input.focus(); input.select(); }
        }, 50);
    }

    function cancelRename() {
        renamingPlaylistId = null;
        renameValue = "";
    }

    async function saveRename(id: number) {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== $playlists.find(p => p.id === id)?.name) {
            try {
                await renamePlaylist(id, trimmed);
                await loadPlaylists();
            } catch (error) {
                console.error("Failed to rename playlist:", error);
            }
        }
        renamingPlaylistId = null;
        renameValue = "";
    }

    function handleRenameKeydown(e: KeyboardEvent, id: number) {
        if (e.key === "Enter") { e.preventDefault(); saveRename(id); }
        if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
    }

    // Slot containers
    let slotTop: HTMLDivElement;
    let slotBottom: HTMLDivElement;

    import { addToast } from "$lib/stores/toast";

    // Track counts for each playlist
    let playlistTrackCounts = new Map<number, number>();

    // Extract store values at top level for reactivity
    $: currentPlaylistIdValue = $currentPlaylistId;
    $: isPlayingValue = $isPlaying;

    // Helper function to check if a playlist is currently playing
    function isPlaylistPlaying(
        playlistId: number,
        currentId: number | null,
        playing: boolean,
    ): boolean {
        return currentId === playlistId && playing;
    }

    // Load track counts for all playlists
    async function loadPlaylistTrackCounts() {
        const counts = new Map<number, number>();
        for (const playlist of $playlists) {
            try {
                const tracks = await getPlaylistTracks(playlist.id);
                counts.set(playlist.id, tracks.length);
            } catch (error) {
                console.error(
                    `Failed to get track count for playlist ${playlist.id}:`,
                    error,
                );
                counts.set(playlist.id, 0);
            }
        }
        playlistTrackCounts = counts;
    }

    // Reload track counts when playlists change
    $: if ($playlists.length > 0) {
        loadPlaylistTrackCounts();
    }

    async function handleAddFolder() {
        try {
            const path = await selectMusicFolder();
            if (path) {
                isScanning = true;
                scanStatus = "Scanning...";
                scanError = null;

                // Progressive scan: clear existing, stream new tracks in batches
                await progressiveScan.startScan(true);

                // Add folder then full rescan
                await addFolder(path);
                const result = await rescanMusic();

                if (result.errors.length > 0) {
                    console.warn("Scan errors:", result.errors);
                }

                console.log(
                    `Scan complete: ${result.tracks_added} added, ${result.tracks_updated} updated, ${result.tracks_deleted} deleted`,
                );

                // Tracks already loaded progressively — just fetch albums/artists
                await loadAlbumsAndArtists();
                await loadPlaylists();

                // success toast
                const parts = [];
                if (result.tracks_added > 0)
                    parts.push(`${result.tracks_added} added`);
                if (result.tracks_updated > 0)
                    parts.push(`${result.tracks_updated} updated`);
                if (result.tracks_deleted > 0)
                    parts.push(`${result.tracks_deleted} deleted`);

                const message =
                    parts.length > 0
                        ? `Library scan complete: ${parts.join(", ")}`
                        : "Library scan complete";

                addToast(message, "success", 4000);
            }
        } catch (error) {
            scanError = error instanceof Error ? error.message : String(error);
            console.error("Scan failed:", error);
            addToast("Failed to scan music folder", "error");
        } finally {
            isScanning = false;
            progressiveScan.reset();
        }
    }

    async function handlePlayPlaylist(id: number) {
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
            if (
                $currentView.type === "playlist-detail" &&
                $currentView.id === id
            ) {
                goToTracks(); // Navigate away if deleted
            }
        } catch (error) {
            console.error("Failed to delete playlist:", error);
        }
    }

    function handlePlaylistContextMenu(e: MouseEvent, playlist: Playlist) {
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
                    action: () => startRename(playlist),
                },
                {
                    label: "Change Cover",
                    action: () => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement)
                                .files?.[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                    setPlaylistCover(playlist.id, reader.result as string);
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

    function isActive(viewType: string): boolean {
        return (
            $currentView.type === viewType ||
            ($currentView.type === "album-detail" && viewType === "albums") ||
            ($currentView.type === "artist-detail" && viewType === "artists")
        );
    }

    function togglePlaylists() {
        playlistsExpanded = !playlistsExpanded;
    }

    onMount(() => {
        loadPlaylists();
        updates.checkUpdate();

        // Register UI slots
        if (slotTop) uiSlotManager.registerContainer("sidebar:top", slotTop);
        if (slotBottom)
            uiSlotManager.registerContainer("sidebar:bottom", slotBottom);

        return () => {
            uiSlotManager.unregisterContainer("sidebar:top");
            uiSlotManager.unregisterContainer("sidebar:bottom");
        };
    });
</script>

<aside class="sidebar">
    <div class="sidebar-header">
        <div class="logo">
            <img src="/logo.png" alt="Audion Logo" width="32" height="32" />
            <span class="logo-text">Audion</span>
            {#if $updates.hasUpdate}
                <div
                    class="update-badge"
                    title="View update details"
                    on:click={() => (showUpdatePopup = true)}
                    role="button"
                    tabindex="0"
                    on:keydown={(e) =>
                        e.key === "Enter" && (showUpdatePopup = true)}
                >
                    Update
                </div>
            {/if}
        </div>
    </div>

    <nav class="sidebar-nav">
        <!-- Plugin slot: Top -->
        <div class="plugin-slot" bind:this={slotTop}></div>

        <section class="nav-section">
            <h3 class="nav-section-title">Library</h3>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("home")}
                        on:click={() => navigateAndClose(goToHome)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                        </svg>
                        <span>Home</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("liked-songs")}
                        on:click={() => navigateAndClose(goToLikedSongs)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                            />
                        </svg>
                        <span>Liked Songs</span>
                        <span class="nav-count">{$likedCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("tracks")}
                        on:click={() => navigateAndClose(goToTracks)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
                            />
                        </svg>
                        <span>All Tracks</span>
                        <span class="nav-count">{$trackCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("albums")}
                        on:click={() => navigateAndClose(goToAlbums)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
                            />
                        </svg>
                        <span>Albums</span>
                        <span class="nav-count">{$albumCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("artists")}
                        on:click={() => navigateAndClose(goToArtists)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                            />
                        </svg>
                        <span>Artists</span>
                        <span class="nav-count">{$artistCount}</span>
                    </button>
                </li>
            </ul>
        </section>

        <section class="nav-section">
            <div class="nav-section-header playlists-header">
                <h3 class="nav-section-title">Playlists</h3>
                <button
                    class="collapse-btn"
                    on:click={togglePlaylists}
                    aria-label={playlistsExpanded ? "Collapse playlists" : "Expand playlists"}
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="28"
                        height="28"
                        class="collapse-arrow"
                        class:rotated={!playlistsExpanded}
                    >
                        <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
                    </svg>
                </button>
            </div>

            <ul class="nav-list">
                <li>
                    <button class="nav-item" class:active={isActive("playlists")} on:click={() => navigateAndClose(goToPlaylists)} on:contextmenu={handleAllPlaylistsContextMenu}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M19 9H5V7h14v2zm0 4H5v-2h14v2zm-8 4H5v-2h6v2zm8-2v2h-2v2h-2v-2h-2v-2h2v-2h2v2h2z" /></svg>
                        <span>All Playlists</span>
                        <span class="nav-count">{$playlists.length}</span>
                    </button>
                </li>
            </ul>

            <!-- Inline create new playlist -->
            {#if creatingPlaylist}
                <div class="nav-item playlist-item rename-mode create-mode">
                    <div class="playlist-thumb-placeholder create-thumb">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                        </svg>
                    </div>
                    <div class="rename-body">
                        <input
                            class="rename-input create-input"
                            type="text"
                            placeholder="Playlist name"
                            bind:value={createValue}
                            on:keydown={handleCreateKeydown}
                            on:click|stopPropagation
                        />
                        <div class="rename-actions">
                            <button class="rename-cancel" on:click|stopPropagation={cancelCreate}>Cancel</button>
                            <button class="rename-save" on:click|stopPropagation={saveCreate}>Create</button>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Collapsible playlist list -->
            <div class="playlist-collapse-wrapper" class:collapsed={!playlistsExpanded}>
                <ul class="nav-list playlist-inner-list">
                    {#each $playlists as playlist (playlist.id)}
                        <li>
                            {#if renamingPlaylistId === playlist.id}
                                <!-- Inline rename mode -->
                                <div class="nav-item playlist-item rename-mode">
                                    <div class="playlist-icon-wrap">
                                        {#if $playlistCovers[playlist.id]}
                                            <img
                                                src={$playlistCovers[playlist.id]}
                                                alt={playlist.name}
                                                class="playlist-thumb"
                                            />
                                        {:else}
                                            <div class="playlist-thumb-placeholder">
                                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                                                    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
                                                </svg>
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="rename-body">
                                        <input
                                            class="rename-input"
                                            type="text"
                                            bind:value={renameValue}
                                            on:keydown={(e) => handleRenameKeydown(e, playlist.id)}
                                            on:click|stopPropagation
                                        />
                                        <div class="rename-actions">
                                            <button class="rename-cancel" on:click|stopPropagation={cancelRename}>Cancel</button>
                                            <button class="rename-save" on:click|stopPropagation={() => saveRename(playlist.id)}>Save</button>
                                        </div>
                                    </div>
                                </div>
                            {:else}
                                {@const isNowPlaying = isPlaylistPlaying(playlist.id, currentPlaylistIdValue, isPlayingValue)}
                                {@const isPaused = !isPlayingValue && currentPlaylistIdValue === playlist.id}
                                {@const isHovered = hoveredPlaylistId === playlist.id}
                                {@const nameOverflows = marqueeOverflows[playlist.id] ?? false}
                                {@const nameDuration = marqueeDurations[playlist.id] ?? "0s"}
                                <button
                                    class="nav-item playlist-item"
                                    class:active={$currentView.type === "playlist-detail" &&
                                        $currentView.id !== undefined &&
                                        playlist.id !== undefined &&
                                        $currentView.id === playlist.id}
                                    class:playing={isNowPlaying}
                                    class:paused={isPaused}
                                    on:click={() => navigateAndClose(() => goToPlaylistDetail(playlist.id))}
                                    on:contextmenu={(e) => handlePlaylistContextMenu(e, playlist)}
                                    on:mouseenter={() => handleItemMouseEnter(playlist.id)}
                                    on:mouseleave={() => handleItemMouseLeave(playlist.id)}
                                >
                                    <!-- Thumbnail with interactive overlay -->
                                    <div
                                        class="playlist-icon-wrap"
                                        on:click|stopPropagation={() => {
                                            if (isNowPlaying || isPaused) {
                                                togglePlay();
                                            } else {
                                                handlePlayPlaylist(playlist.id);
                                            }
                                        }}
                                        role="button"
                                        tabindex="-1"
                                        aria-label={isNowPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
                                    >
                                        {#if $playlistCovers[playlist.id]}
                                            <img
                                                src={$playlistCovers[playlist.id]}
                                                alt={playlist.name}
                                                class="playlist-thumb"
                                            />
                                        {:else}
                                            <div class="playlist-thumb-placeholder">
                                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                                                    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
                                                </svg>
                                            </div>
                                        {/if}

                                        <!-- Playing: dancing bars, hover shows pause -->
                                        {#if isNowPlaying}
                                            <div class="thumb-overlay" class:show-icon={isHovered}>
                                                {#if isHovered}
                                                    <!-- pause icon -->
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                                    </svg>
                                                {:else}
                                                    <div class="thumb-bars">
                                                        <span class="tbar"></span>
                                                        <span class="tbar"></span>
                                                        <span class="tbar"></span>
                                                    </div>
                                                {/if}
                                            </div>

                                        <!-- Paused: always show overlay with resume icon, but dim on hover -->
                                        {:else if isPaused}
                                            <div class="thumb-overlay show-icon paused-overlay">
                                                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>

                                        <!-- Idle: show play icon on hover -->
                                        {:else if isHovered}
                                            <div class="thumb-overlay show-icon">
                                                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                        {/if}
                                    </div>

                                    <!-- Name with marquee -->
                                    <div class="playlist-name-track" class:animate={isHovered && nameOverflows}>
                                        <span
                                            class="playlist-name-text"
                                            class:accent={isNowPlaying || isPaused}
                                            class:pl-marquee={isHovered && nameOverflows}
                                            style="--marquee-duration: {nameDuration};"
                                            use:registerNameEl={playlist.id}
                                        >{playlist.name}</span>
                                        {#if isHovered && nameOverflows}
                                            <span
                                                class="playlist-name-text pl-marquee"
                                                class:accent={isNowPlaying || isPaused}
                                                aria-hidden="true"
                                                style="--marquee-duration: {nameDuration};"
                                            >{playlist.name}</span>
                                        {/if}
                                    </div>

                                    {#if playlistTrackCounts.has(playlist.id)}
                                        <span class="nav-count">{playlistTrackCounts.get(playlist.id)}</span>
                                    {/if}
                                </button>
                            {/if}
                        </li>
                    {/each}
                </ul>
            </div>
        </section>

        <section class="nav-section">
            <h3 class="nav-section-title">Settings</h3>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("plugins")}
                        on:click={() => navigateAndClose(goToPlugins)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                            />
                        </svg>
                        <span>Plugins</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("settings")}
                        on:click={() => navigateAndClose(goToSettings)}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
                            />
                        </svg>
                        <span>Settings</span>
                    </button>
                </li>
            </ul>
        </section>

        {#if $appSettings.showDiscord}
            <section class="nav-section">
                <h3 class="nav-section-title">Community</h3>
                <ul class="nav-list">
                    <li>
                        <a
                            href="https://discord.gg/27XRVQsBd9"
                            target="_blank"
                            class="nav-item discord-item"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="24"
                                height="24"
                            >
                                <path
                                    d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0 a.074.074 0 0 1 .078.01c.118.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z"
                                />
                            </svg>
                            <span>Join Discord</span>
                        </a>
                    </li>
                </ul>
            </section>
        {/if}
    </nav>

    <div class="sidebar-footer">
        <!-- Plugin slot: Bottom -->
        <div class="plugin-slot" bind:this={slotBottom}></div>

        <button
            class="add-folder-btn"
            on:click={handleAddFolder}
            disabled={isScanning}
        >
            {#if isScanning}
                <svg
                    class="animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    width="20"
                    height="20"
                >
                    <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke-width="2"
                        opacity="0.25"
                    />
                    <path
                        d="M12 2a10 10 0 0 1 10 10"
                        stroke-width="2"
                        stroke-linecap="round"
                    />
                </svg>
                <span>{scanStatus}</span>
            {:else}
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                >
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
                <span>Add Music Folder</span>
            {/if}
        </button>
        {#if scanError}
            <p class="scan-error">{scanError}</p>
        {/if}
    </div>
</aside>

{#if showUpdatePopup && $updates.latestRelease}
    <UpdatePopup
        release={$updates.latestRelease}
        on:close={() => (showUpdatePopup = false)}
    />
{/if}

<style>
    .sidebar {
        width: var(--sidebar-width);
        height: 100%;
        background-color: var(--bg-base);
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-color);
    }

    .sidebar-header {
        padding: var(--spacing-md);
        padding-top: var(--spacing-lg);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .logo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--accent-primary);
    }

    .logo-text {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.5px;
    }

    .update-badge {
        font-size: 0.6rem;
        font-weight: 800;
        color: var(--accent-primary);
        background-color: var(--accent-subtle);
        border: 1px solid var(--accent-primary);
        padding: 1px 8px;
        border-radius: 12px;
        margin-left: var(--spacing-sm);
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 2px;
        transition: all 0.2s ease;
        animation: glow 3s infinite ease-in-out;
    }

    .update-badge:hover {
        background-color: var(--accent-primary);
        color: var(--bg-base);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px var(--accent-subtle);
    }

    @keyframes glow {
        0%,
        100% {
            box-shadow: 0 0 2px transparent;
        }
        50% {
            box-shadow: 0 0 8px var(--accent-subtle);
        }
    }

    .sidebar-nav {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        padding: var(--spacing-md);
    }

    .nav-section {
        margin-bottom: var(--spacing-xl);
    }

    /* ── Playlist section header ── */
    .nav-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        /* match nav-item horizontal padding so content lines up */
        padding: 0 var(--spacing-md);
        margin-bottom: var(--spacing-md);
        min-height: 20px;
    }

    .nav-section-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-subdued);
        margin: 0;
        padding: 0;
        padding-left: var(--spacing-md);
    }

    .playlists-header .nav-section-title {
        padding-left: 0;
    }

    /* Always-visible collapse arrow */
    .collapse-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        /* large tap target */
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 4px;
        color: var(--text-subdued);
        background: none;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        /* only colour transitions, never background */
        transition: color 0.15s ease;
        /* pull it right to align with .nav-count */
        margin-right: -16px;
    }

    .collapse-btn:hover {
        color: var(--text-primary);
        /* intentionally no background-color change */
    }

    .collapse-arrow {
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        transform: rotate(0deg);
    }

    .collapse-arrow.rotated {
        transform: rotate(180deg);
    }

    /* ── Collapsible wrapper ── */
    .playlist-collapse-wrapper {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.25s ease;
        opacity: 1;
        overflow: hidden;
    }

    .playlist-collapse-wrapper.collapsed {
        grid-template-rows: 0fr;
        opacity: 0;
    }

    .playlist-inner-list {
        overflow: hidden;
        min-height: 0;
    }

    /* ── Nav items ── */
    .nav-list {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        width: 100%;
        padding: 12px var(--spacing-md);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        transition: all var(--transition-fast);
        text-align: left;
        font-size: 0.9375rem;
        position: relative;
    }

    .nav-item:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .nav-item.active {
        color: var(--text-primary);
        background-color: var(--bg-surface);
        font-weight: 500;
    }



    .nav-item svg {
        flex-shrink: 0;
        opacity: 0.7;
    }

    .nav-item.active svg {
        opacity: 1;
        color: var(--accent-primary);
    }

    .nav-count {
        margin-left: auto;
        font-size: 0.75rem;
        color: var(--text-subdued);
    }

    .playlist-item {
        padding-left: var(--spacing-md);
        padding-top: 6px;
        padding-bottom: 6px;
    }

    /* Playlist icon wrapper */
    .playlist-icon-wrap {
        position: relative;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 4px;
        overflow: hidden;
        cursor: pointer;
    }

    .playlist-thumb {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        object-fit: cover;
        display: block;
        opacity: 0.85;
        transition: opacity 0.15s ease;
    }

    .nav-item:hover .playlist-thumb,
    .nav-item.active .playlist-thumb {
        opacity: 1;
    }

    .playlist-thumb-placeholder {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background-color: var(--bg-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    /* Overlay. dark bg , icon/bars centred */
    .thumb-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.0);
        transition: background 0.15s ease;
        border-radius: 4px;
        color: white;
    }

    /* When showing a static icon, darken background */
    .thumb-overlay.show-icon {
        background: rgba(0, 0, 0, 0.5);
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
    }

    /* Paused overlay is always visible but lighter */
    .thumb-overlay.paused-overlay {
        background: rgba(0, 0, 0, 0.38);
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
    }

    /* Dancing bars inside overlay (playing, not hovered) */
    .thumb-bars {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 18px;
    }

    .tbar {
        width: 3px;
        background-color: var(--accent-primary);
        border-radius: 2px;
        animation: pl-eq 0.8s ease-in-out infinite;
    }

    .tbar:nth-child(2) { animation-delay: 0.2s; }
    .tbar:nth-child(3) { animation-delay: 0.4s; }

    @keyframes pl-eq {
        0%, 100% { height: 4px; }
        50% { height: 16px; }
    }

    /* Card background highlight for playing/paused */
    .nav-item.playing,
    .nav-item.paused {
        background-color: var(--accent-subtle);
        color: var(--text-primary);
    }

    .nav-item.playing .nav-count,
    .nav-item.paused .nav-count {
        color: var(--accent-primary);
        font-weight: 600;
    }

    /* ── Playlist name marquee ── */
    .playlist-name-track {
        display: flex;
        flex-direction: row;
        flex: 1;
        min-width: 0;
        overflow: hidden;
    }

    .playlist-name-track.animate {
        -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 90%, transparent 100%);
        mask-image: linear-gradient(to right, transparent 0%, black 5%, black 90%, transparent 100%);
    }

    .playlist-name-text {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
        max-width: 100%;
        transition: color 0.15s ease;
    }

    .nav-item:hover .playlist-name-text {
        color: var(--text-primary);
    }

    .playlist-name-text.accent {
        color: var(--accent-primary);
    }

    .pl-marquee {
        overflow: visible;
        text-overflow: clip;
        max-width: none;
        padding-right: 48px;
        animation: pl-marquee-scroll var(--marquee-duration) linear infinite;
    }

    @keyframes pl-marquee-scroll {
        from { transform: translateX(0); }
        to   { transform: translateX(-100%); }
    }

    /* Footer */
    .sidebar-footer {
        padding: var(--spacing-md);
        border-top: 1px solid var(--border-color);
    }

    .add-folder-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-surface);
        color: var(--text-primary);
        border-radius: var(--radius-md);
        font-weight: 500;
        transition: all var(--transition-fast);
    }

    .add-folder-btn:hover:not(:disabled) {
        background-color: var(--bg-highlight);
    }

    .add-folder-btn:disabled {
        opacity: 0.7;
        cursor: wait;
    }

    .scan-error {
        margin-top: var(--spacing-sm);
        font-size: 0.75rem;
        color: var(--error-color);
        text-align: center;
    }

    .plugin-slot {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
    }

    .animate-spin {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Mobile: sidebar fills its container (the drawer) */
    @media (max-width: 768px) {
        .sidebar { width: 100%; border-right: none; height: 100%; }
        .sidebar-header { padding-top: var(--spacing-md); }
        .nav-item { padding: 14px var(--spacing-md); min-height: 48px; }
    }

    .create-thumb {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        color: var(--accent-primary);
        background-color: var(--accent-subtle);
    }
    .rename-mode {
        flex-direction: row;
        align-items: flex-start;
        cursor: default;
        padding-top: 10px;
        padding-bottom: 10px;
        /* expand vertically to fit input + buttons */
        height: auto;
    }

    .rename-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-width: 0;
    }

    .rename-input {
        width: 100%;
        background: var(--bg-highlight, rgba(255,255,255,0.08));
        border: 1px solid var(--accent-primary);
        border-radius: var(--radius-sm, 4px);
        color: var(--text-primary);
        font-size: 0.9375rem;
        padding: 5px 8px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s ease;
    }

    .rename-input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 25%, transparent);
    }

    .rename-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
    }

    .rename-cancel,
    .rename-save {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 4px 12px;
        border-radius: var(--radius-sm, 4px);
        border: none;
        cursor: pointer;
        transition: opacity 0.15s ease, background-color 0.15s ease;
        letter-spacing: 0.02em;
    }

    .rename-cancel {
        background: var(--bg-surface);
        color: var(--text-secondary);
    }

    .rename-cancel:hover {
        background: var(--bg-highlight);
        color: var(--text-primary);
    }

    .rename-save {
        background: var(--accent-primary);
        color: var(--bg-base);
    }

    .rename-save:hover {
        opacity: 0.85;
    }

</style>