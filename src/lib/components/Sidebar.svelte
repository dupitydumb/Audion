<script lang="ts">
    import { onMount } from "svelte";
    import {
        playlists,
        loadPlaylists,
        trackCount,
        albumCount,
        artistCount,
    } from "$lib/stores/library";
    import {
        currentView,
        goToTracks,
        goToAlbums,
        goToArtists,
        goToPlaylists,
        goToPlaylistDetail,
        goToPlugins,
        goToSettings,
    } from "$lib/stores/view";
    import {
        isSettingsOpen as isSettingsOpenUI,
        toggleSettings as toggleSettingsUI,
        contextMenu,
    } from "$lib/stores/ui";
    import { appSettings } from "$lib/stores/settings";
    import {
        selectMusicFolder,
        addFolder,
        rescanMusic,
        deletePlaylist,
        type Playlist,
        getPlaylistTracks,
        renamePlaylist,
    } from "$lib/api/tauri";
    import { confirm } from "$lib/stores/dialogs";
    import { playTracks, addToQueue } from "$lib/stores/player";
    import { setPlaylistCover } from "$lib/stores/playlistCovers";
    import { loadLibrary } from "$lib/stores/library";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import MenuBar from "./MenuBar.svelte";
    import { updates } from "$lib/stores/updates";
    import UpdatePopup from "./UpdatePopup.svelte";

    let isScanning = false;
    let scanStatus = "Scanning...";
    let scanError: string | null = null;
    let showUpdatePopup = false;

    // Slot containers
    let slotTop: HTMLDivElement;
    let slotBottom: HTMLDivElement;

    async function handleAddFolder() {
        try {
            const path = await selectMusicFolder();
            if (path) {
                isScanning = true;
                scanStatus = "Rescanning Library...";
                scanError = null;

                // Add folder then full rescan to ensure consistency
                await addFolder(path);
                const result = await rescanMusic();

                if (result.errors.length > 0) {
                    console.warn("Scan errors:", result.errors);
                }

                // Reload library after scan
                await loadLibrary();
                await loadPlaylists();
            }
        } catch (error) {
            scanError = error instanceof Error ? error.message : String(error);
            console.error("Scan failed:", error);
        } finally {
            isScanning = false;
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

    function isActive(viewType: string): boolean {
        return (
            $currentView.type === viewType ||
            ($currentView.type === "album-detail" && viewType === "albums") ||
            ($currentView.type === "artist-detail" && viewType === "artists")
        );
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
        <MenuBar />
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
                        class:active={isActive("tracks")}
                        on:click={goToTracks}
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
                        on:click={goToAlbums}
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
                        on:click={goToArtists}
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
            <div class="nav-section-header">
                <h3 class="nav-section-title">Playlists</h3>
            </div>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("playlists")}
                        on:click={goToPlaylists}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="24"
                            height="24"
                        >
                            <path
                                d="M19 9H5V7h14v2zm0 4H5v-2h14v2zm-8 4H5v-2h6v2zm8-2v2h-2v2h-2v-2h-2v-2h2v-2h2v2h2z"
                            />
                        </svg>
                        <span>All Playlists</span>
                        <span class="nav-count">{$playlists.length}</span>
                    </button>
                </li>
                {#each $playlists as playlist}
                    <li>
                        <button
                            class="nav-item playlist-item"
                            class:active={$currentView.type ===
                                "playlist-detail" &&
                                $currentView.id !== undefined &&
                                playlist.id !== undefined &&
                                $currentView.id === playlist.id}
                            on:click={() => goToPlaylistDetail(playlist.id)}
                            on:contextmenu={(e) =>
                                handlePlaylistContextMenu(e, playlist)}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="24"
                                height="24"
                            >
                                <path
                                    d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"
                                />
                            </svg>
                            <span class="truncate">{playlist.name}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        </section>

        <section class="nav-section">
            <h3 class="nav-section-title">Settings</h3>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("plugins")}
                        on:click={goToPlugins}
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
                        on:click={goToSettings}
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
                                    d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.118.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z"
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
        padding: var(--spacing-md);
    }

    .nav-section {
        margin-bottom: var(--spacing-xl);
    }

    .nav-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .nav-section-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-subdued);
        margin-bottom: var(--spacing-md);
        padding-left: var(--spacing-md);
    }

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
    }

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
</style>
