<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import {
        playlists,
        loadPlaylists,
        trackCount,
        albumCount,
        artistCount,
        loadAlbumsAndArtists,
        getTrackAlbumCover,
        getAlbumCoverFromTracks,
        playlistTrackCounts,
    } from "$lib/stores/library";
    import { getAlbum, getIsLinux } from "$lib/api/tauri";
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
        goToListenBrainz,
        goToDiscover,
        goToSubsonic,
    } from "$lib/stores/view";
    import { subsonicConnected } from "$lib/stores/subsonic";
    import {
        isSettingsOpen as isSettingsOpenUI,
        toggleSettings as toggleSettingsUI,
        contextMenu,
        appBootTransitionActive,
    } from "$lib/stores/ui";
    import { buildPlaylistContextMenu } from "$lib/menus/contextMenus";
    import { appSettings } from "$lib/stores/settings";
    import { likedCount } from "$lib/stores/liked";
    import {
        pickFolder,
        addFolder,
        rescanMusic,
        deletePlaylist,
        type Playlist,
        getPlaylistTracks,
    } from "$lib/api/tauri";
    import { playlistCovers } from "$lib/stores/playlistCovers";
    import Icon from "$lib/components/Icon.svelte";
    import { progressiveScan } from "$lib/stores/progressiveScan";
    import { confirm } from "$lib/stores/dialogs";
    import {
        playTracks,
        addToQueue,
        currentTrack,
        isPlaying,
        queue,
    } from "$lib/stores/player";
    import { uiSlotManager } from "$lib/plugins/ui-slots";

    import { updates } from "$lib/stores/updates";
    import { isInspectorOpen } from "$lib/stores/inspector";
    import {
        checkForOtaUpdate,
        consumePendingUpdateNotes,
        otaState,
        isOtaEnabled,
        supportsOta,
        startOtaDownload,
        installOtaNow,
        deferOtaInstallToClose,
        skipOtaVersion,
        registerOtaExitHandler,
        type PendingUpdateNotes,
    } from "$lib/stores/otaUpdate";
    import UpdatePopup from "./UpdatePopup.svelte";
    import SyncStatus from "./SyncStatus.svelte";
    import LibraryWatcherStatus from "./LibraryWatcherStatus.svelte";

    import { currentPlaylistId } from "$lib/stores/player";
    import {
        pinnedItems,
        isPinned,
    } from "$lib/stores/pinned";
    import { setCustomArtwork } from "$lib/stores/customArtwork";
    import { _ } from "svelte-i18n";

    const dispatch = createEventDispatcher();

    function navigateAndClose(fn: () => void) {
        fn();
        dispatch("navigate");
        // Blur so spacebar shortcuts aren't captured by the clicked nav button
        (document.activeElement as HTMLElement | null)?.blur();
    }

    let isScanning = false;
    let scanStatus = $_("common.scanning");
    let scanError: string | null = null;
    let showUpdatePopup = false;
    let popupRelease: any = null;
    let popupMode: "github" | "ota" = "github";
    let lastOtaPhase = "idle";

    function otaNotesToRelease(notes: PendingUpdateNotes | null) {
        if (!notes) return null;
        return {
            tag_name: notes.version,
            name: `Version ${notes.version}`,
            body: notes.body ?? null,
            published_at: notes.date ?? "",
            assets: [],
        };
    }

    // auto (re)open the popup on: first detecting an update
    // and when a background download finishes
    $: {
        const phase = $otaState.phase;
        if (phase !== lastOtaPhase) {
            if (phase === "available" || phase === "ready") {
                popupMode = "ota";
                popupRelease = otaNotesToRelease($otaState.notes);
                showUpdatePopup = true;
            }
            lastOtaPhase = phase;
        }
    }

    // Slot containers
    let slotTop: HTMLDivElement;
    let slotBottom: HTMLDivElement;

    import { addToast } from "$lib/stores/toast";
    import { addTracksToPlaylist } from "$lib/services/playlistHelpers";

    // Sidebar draggable resizing & responsive breakpoint state
    const DEFAULT_WIDTH = 280;
    const MIN_WIDTH = 180;
    const MAX_WIDTH = 460;
    const COLLAPSE_THRESHOLD = 120;
    const COLLAPSED_WIDTH = 64;
    const STORAGE_KEY = "audion_sidebar_width";
    const COMPACT_BREAKPOINT = 1024;
    const INSPECTOR_SAFETY_BREAKPOINT = 1200;

    let sidebarWidth = DEFAULT_WIDTH;
    let lastExpandedWidth = DEFAULT_WIDTH;
    let isResizing = false;
    let isCollapsed = false;
    let isAutoCollapsed = false;
    let dragOverPlaylistId: number | null = null;

    function applyWidth(width: number, save = false) {
        if (width < COLLAPSE_THRESHOLD) {
            sidebarWidth = COLLAPSED_WIDTH;
            isCollapsed = true;
        } else {
            sidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
            lastExpandedWidth = sidebarWidth;
            isCollapsed = false;
        }

        if (typeof document !== "undefined") {
            document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
        }

        if (save && typeof localStorage !== "undefined" && !isAutoCollapsed) {
            try {
                localStorage.setItem(STORAGE_KEY, (isCollapsed ? lastExpandedWidth : sidebarWidth).toString());
            } catch (e) {
                console.warn("Failed to persist audion_sidebar_width:", e);
            }
        }
    }

    function toggleCollapse() {
        if (isCollapsed) {
            isAutoCollapsed = false;
            applyWidth(lastExpandedWidth >= MIN_WIDTH ? lastExpandedWidth : DEFAULT_WIDTH, true);
        } else {
            if (sidebarWidth >= MIN_WIDTH) {
                lastExpandedWidth = sidebarWidth;
            }
            isAutoCollapsed = false;
            applyWidth(COLLAPSED_WIDTH, true);
        }
    }

    function resetWidth() {
        if (isCollapsed) {
            isAutoCollapsed = false;
            applyWidth(lastExpandedWidth >= MIN_WIDTH ? lastExpandedWidth : DEFAULT_WIDTH, true);
        } else if (sidebarWidth === DEFAULT_WIDTH) {
            toggleCollapse();
        } else {
            applyWidth(DEFAULT_WIDTH, true);
        }
    }

    function checkResponsiveCollapse() {
        if (typeof window === "undefined") return;
        const currentWidth = window.innerWidth;
        if (currentWidth <= 768) return; // handled by mobile layout

        const shouldAutoCollapse =
            currentWidth <= COMPACT_BREAKPOINT ||
            ($isInspectorOpen && currentWidth <= INSPECTOR_SAFETY_BREAKPOINT);

        if (shouldAutoCollapse) {
            if (!isCollapsed) {
                if (sidebarWidth >= MIN_WIDTH) {
                    lastExpandedWidth = sidebarWidth;
                }
                isAutoCollapsed = true;
                applyWidth(COLLAPSED_WIDTH, false);
            }
        } else {
            if (isAutoCollapsed && isCollapsed) {
                isAutoCollapsed = false;
                applyWidth(lastExpandedWidth >= MIN_WIDTH ? lastExpandedWidth : DEFAULT_WIDTH, false);
            }
        }
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    function handleWindowResize() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            checkResponsiveCollapse();
        }, 50);
    }

    $: if ($isInspectorOpen !== undefined) {
        checkResponsiveCollapse();
    }

    function startResize(e: MouseEvent) {
        if (e.button !== 0) return;
        e.preventDefault();
        isResizing = true;
        if (typeof document !== "undefined") {
            document.body.classList.add("resizing-sidebar");
        }

        function onMouseMove(ev: MouseEvent) {
            applyWidth(ev.clientX, false);
        }

        function onMouseUp() {
            isResizing = false;
            if (typeof document !== "undefined") {
                document.body.classList.remove("resizing-sidebar");
            }
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            applyWidth(sidebarWidth, true);
        }

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }

    function handleSplitterKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            resetWidth();
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (isCollapsed) return;
            const target = sidebarWidth - 20;
            applyWidth(target < MIN_WIDTH ? COLLAPSED_WIDTH : target, true);
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (isCollapsed) {
                applyWidth(lastExpandedWidth >= MIN_WIDTH ? lastExpandedWidth : MIN_WIDTH, true);
            } else {
                applyWidth(Math.min(MAX_WIDTH, sidebarWidth + 20), true);
            }
        }
    }

    function handlePlaylistDragOver(e: DragEvent, playlist: Playlist) {
        if (!e.dataTransfer) return;
        if (!e.dataTransfer.types.includes("application/json")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (dragOverPlaylistId !== playlist.id) {
            dragOverPlaylistId = playlist.id;
        }
    }

    function handlePlaylistDragLeave(e: DragEvent, playlist: Playlist) {
        const currentTarget = e.currentTarget as HTMLElement | null;
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!currentTarget || !relatedTarget || !currentTarget.contains(relatedTarget)) {
            if (dragOverPlaylistId === playlist.id) {
                dragOverPlaylistId = null;
            }
        }
    }

    async function handlePlaylistDrop(e: DragEvent, playlist: Playlist) {
        e.preventDefault();
        dragOverPlaylistId = null;
        if (!e.dataTransfer) return;

        let trackIds: number[] = [];

        // 1. Try application/json
        try {
            const jsonStr = e.dataTransfer.getData("application/json");
            if (jsonStr) {
                const parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed)) {
                    trackIds = parsed.map(Number).filter((n) => !isNaN(n));
                } else if (parsed && Array.isArray(parsed.trackIds)) {
                    trackIds = parsed.trackIds.map(Number).filter((n: any) => !isNaN(n));
                } else if (parsed && typeof parsed.trackId === "number") {
                    trackIds = [parsed.trackId];
                } else if (parsed && typeof parsed.id === "number") {
                    trackIds = [parsed.id];
                }
            }
        } catch (err) {
            console.warn("Could not parse application/json drop data:", err);
        }

        // 2. Fallback to text/plain
        if (trackIds.length === 0) {
            try {
                const textStr = e.dataTransfer.getData("text/plain");
                if (textStr) {
                    const parsed = JSON.parse(textStr);
                    if (Array.isArray(parsed)) {
                        trackIds = parsed.map(Number).filter((n) => !isNaN(n));
                    } else if (parsed && Array.isArray(parsed.trackIds)) {
                        trackIds = parsed.trackIds.map(Number).filter((n: any) => !isNaN(n));
                    } else if (typeof parsed === "number" && !isNaN(parsed)) {
                        trackIds = [parsed];
                    }
                }
            } catch {
                const textStr = e.dataTransfer.getData("text/plain");
                if (textStr) {
                    const parts = textStr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
                    if (parts.length > 0) {
                        trackIds = parts;
                    }
                }
            }
        }

        if (trackIds.length === 0) return;

        try {
            const result = await addTracksToPlaylist(playlist.id, trackIds);
            if (result.success > 0) {
                addToast(
                    $_("playlist.addedTracks", { values: { count: result.success } }),
                    "success"
                );
                await loadPlaylists();
                if (typeof window !== "undefined") {
                    window.dispatchEvent(
                        new CustomEvent("audion:playlist-updated", {
                            detail: { playlistId: playlist.id },
                        })
                    );
                }
            }
            if (result.failed > 0) {
                addToast(
                    $_("playlist.failedTracks", { values: { count: result.failed } }),
                    "error"
                );
            }
        } catch (err) {
            console.error("Failed to add dropped tracks to playlist:", err);
            addToast(
                $_("playlist.addTracksFailed"),
                "error"
            );
        }
    }

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

    function handleImageError(e: Event, playlist: Playlist) {
        const img = e.target as HTMLImageElement;
        img.src = generateSvgCover(playlist.name || "Playlist", 512);
    }

    async function handleAddFolder() {
        try {
            const path = await pickFolder();
            if (path) {
                isScanning = true;
                scanStatus = $_("common.scanning");
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
                    `Scan complete: ${result.tracks_added} added, ${result.tracks_updated} updated, ${result.tracks_duplicates} duplicates skipped, ${result.tracks_failed} failed, ${result.tracks_deleted} deleted`,
                );

                // Tracks already loaded progressively — just fetch albums/artists
                await loadAlbumsAndArtists();
                await loadPlaylists();

                // success toast
                const parts = [];
                if (result.tracks_added > 0)
                    parts.push(
                        $_("scanStatus.tracksAdded", {
                            values: { count: result.tracks_added },
                        }),
                    );
                if (result.tracks_updated > 0)
                    parts.push(
                        $_("scanStatus.tracksUpdated", {
                            values: { count: result.tracks_updated },
                        }),
                    );
                if (result.tracks_duplicates > 0)
                    parts.push(
                        $_("scanStatus.tracksDuplicates", {
                            values: { count: result.tracks_duplicates },
                        }),
                    );
                if (result.tracks_failed > 0)
                    parts.push(
                        $_("scanStatus.tracksFailed", {
                            values: { count: result.tracks_failed },
                        }),
                    );
                if (result.tracks_deleted > 0)
                    parts.push(
                        $_("scanStatus.tracksDeleted", {
                            values: { count: result.tracks_deleted },
                        }),
                    );

                const message =
                    parts.length > 0
                        ? $_("menu.scanComplete", { values: { parts: parts.join(", ") } })
                        : $_("menu.scanCompleteSimple");

                addToast(
                    message,
                    result.tracks_failed > 0 ? "warning" : "success",
                    result.tracks_failed > 0 ? 7000 : 4000,
                );
            }
        } catch (error) {
            scanError = error instanceof Error ? error.message : String(error);
            console.error("Scan failed:", error);
            addToast(
                $_("sidebar.scanFailed"),
                "error",
            );
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
                    displayName:
                        playlist?.name ??
                        $_("common.playlist"),
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
            !(await confirm(
                $_("playlist.deleteConfirm", { values: { name } }),
                {
                    title: $_("playlist.deletePlaylist"),
                    confirmLabel: $_("playlist.delete"),
                    danger: true,
                },
            ))
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
            items: buildPlaylistContextMenu({
                playlist,
                variant: "sidebar",
                onPlay: () => handlePlayPlaylist(playlist.id),
                onAddToQueue: () => handleAddToQueue(playlist.id),
                // no onRename: factory falls back to inline prompt + renamePlaylist
                onDelete: () => handleDeletePlaylist(playlist.id, playlist.name),
                t: $_,
            }),
        });
    }

    // Playlist pinning logic
    $: sortedPlaylists = [...$playlists].sort((a, b) => {
        const aPinned = isPinned("playlist", a.id, $pinnedItems);
        const bPinned = isPinned("playlist", b.id, $pinnedItems);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
    });

    function isActive(viewType: string): boolean {
        return (
            $currentView.type === viewType ||
            ($currentView.type === "album-detail" && viewType === "albums") ||
            ($currentView.type === "artist-detail" && viewType === "artists")
        );
    }

    onMount(() => {
        const pending = consumePendingUpdateNotes();
        if (pending) {
            // just relaunched after an OTA update => show what changed
            // plain notes only, no ota action buttons
            popupMode = "github";
            popupRelease = otaNotesToRelease(pending);
            showUpdatePopup = true;
        } else if (isOtaEnabled() && supportsOta()) {
            checkForOtaUpdate();
        } else {
            // OTA disabled or unsupported platform => fall back to the
            // normal gitHub release
            updates.checkUpdate();
        }
        loadPlaylists();

        try {
            const savedWidth = localStorage.getItem(STORAGE_KEY);
            if (savedWidth !== null) {
                const parsed = parseInt(savedWidth, 10);
                if (!isNaN(parsed) && parsed >= MIN_WIDTH) {
                    lastExpandedWidth = parsed;
                    sidebarWidth = parsed;
                }
            }
        } catch (e) {
            console.warn("Failed to load audion_sidebar_width:", e);
        }
        checkResponsiveCollapse();

        // listen for the OS close-request
        // install to app-close
        // refer otaupdates.ts for details
        let unlistenOtaExit: (() => void) | undefined;
        registerOtaExitHandler().then((unlisten) => {
            unlistenOtaExit = unlisten;
        });

        // Register UI slots
        if (slotTop) uiSlotManager.registerContainer("sidebar:top", slotTop);
        if (slotBottom)
            uiSlotManager.registerContainer("sidebar:bottom", slotBottom);

        return () => {
            uiSlotManager.unregisterContainer("sidebar:top");
            uiSlotManager.unregisterContainer("sidebar:bottom");
            unlistenOtaExit?.();
        };
    });
    function openOtaPopup() {
        popupMode = "ota";
        popupRelease = otaNotesToRelease($otaState.notes);
        showUpdatePopup = true;
    }

    function openGithubPopup() {
        popupMode = "github";
        popupRelease = $updates.latestRelease;
        showUpdatePopup = true;
    }

    function handlePopupClose() {
        showUpdatePopup = false;
    }

    function handlePopupDownload() {
        startOtaDownload();
    }

    function handlePopupSkip() {
        skipOtaVersion();
        showUpdatePopup = false;
    }

    function handlePopupRestart() {
        installOtaNow();
    }

    function handlePopupLater() {
        deferOtaInstallToClose();
    }
</script>

<svelte:window on:resize={handleWindowResize} />

<aside
    class="sidebar"
    class:collapsed={isCollapsed}
    class:resizing={isResizing}
    style="--sidebar-width: {sidebarWidth}px; width: {sidebarWidth}px;"
>
    <div class="sidebar-header">
        <div class="logo">
            <img src="/logo.png" alt="Audion Logo" width="32" height="32" style="view-transition-name: {(getIsLinux() || !$appBootTransitionActive) ? 'none' : 'app-logo-icon'};" />
            <span class="logo-text" style="view-transition-name: {(getIsLinux() || !$appBootTransitionActive) ? 'none' : 'app-logo-text'};">Audion</span>
            <div class="header-status-indicators">
                <SyncStatus />
                <LibraryWatcherStatus />
            </div>
            {#if $otaState.phase === "ready"}
                <div
                    class="update-badge restart-badge"
                    title={$_("sidebar.updateInstalledTooltip")}
                    on:click={openOtaPopup}
                    role="button"
                    tabindex="0"
                    on:keydown={(e) => e.key === "Enter" && openOtaPopup()}
                >
                    {$_('sidebar.restart')}
                </div>
            {:else if $otaState.phase === "downloading"}
                <div
                    class="update-badge"
                    title={$_("sidebar.downloadingUpdateTooltip")}
                    on:click={openOtaPopup}
                    role="button"
                    tabindex="0"
                    on:keydown={(e) => e.key === "Enter" && openOtaPopup()}
                >
                    {$otaState.progress}%
                </div>
            {:else if $otaState.phase === "available"}
                <div
                    class="update-badge"
                    title={$_("sidebar.viewUpdateDetails")}
                    on:click={openOtaPopup}
                    role="button"
                    tabindex="0"
                    on:keydown={(e) => e.key === "Enter" && openOtaPopup()}
                >
                    {$_("sidebar.update")}
                </div>
            {:else if $updates.hasUpdate}
                <div
                    class="update-badge"
                    title={$_("sidebar.viewUpdateDetails")}
                    on:click={openGithubPopup}
                    role="button"
                    tabindex="0"
                    on:keydown={(e) =>
                        e.key === "Enter" && openGithubPopup()}
                >
                    {$_("sidebar.update")}
                </div>
            {/if}
        </div>

        <button
            class="sidebar-toggle-btn"
            on:click={toggleCollapse}
            title={isCollapsed ? $_("sidebar.expand", { default: "Expand sidebar" }) : $_("sidebar.collapse", { default: "Collapse sidebar" })}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
            <Icon name={isCollapsed ? "chevron-right" : "chevron-left"} size={16} />
        </button>
    </div>

    <nav class="sidebar-nav">
        <!-- Plugin slot: Top -->
        <div class="plugin-slot" bind:this={slotTop}></div>

        <section class="nav-section">
            <h3 class="nav-section-title">{$_('sidebar.library')}</h3>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("home")}
                        title={$_('sidebar.home')}
                        on:click={() => navigateAndClose(goToHome)}
                    >
                        <Icon name="home" size={24} />
                        <span>{$_('sidebar.home')}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("liked-songs")}
                        title={$_('sidebar.likedSongs')}
                        on:click={() => navigateAndClose(goToLikedSongs)}
                    >
                        <Icon name="heart" size={24} />
                        <span>{$_('sidebar.likedSongs')}</span>
                        <span class="nav-count">{$likedCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("discover")}
                        title={$_('sidebar.discover')}
                        on:click={() => navigateAndClose(goToDiscover)}
                    >
                        <Icon name="compass" size={24} />
                        <span>{$_('sidebar.discover')}</span>
                    </button>
                </li>
                {#if $appSettings.listenBrainzEnabled && $appSettings.listenBrainzTokenSet}
                    <li>
                        <button
                            class="nav-item"
                            class:active={isActive("listenbrainz")}
                            title={$_('sidebar.recommendations')}
                            on:click={() => navigateAndClose(goToListenBrainz)}
                        >
                            <Icon name="sparkles" size={24} />
                            <span>{$_('sidebar.recommendations')}</span>
                        </button>
                    </li>
                {/if}
                {#if $subsonicConnected}
                    <li>
                        <button
                            class="nav-item"
                            class:active={isActive("subsonic")}
                            title={$_('sidebar.subsonic', { default: 'Subsonic' })}
                            on:click={() => navigateAndClose(goToSubsonic)}
                        >
                            <Icon name="radio" size={24} />
                            <span>{$_('sidebar.subsonic', { default: 'Subsonic' })}</span>
                        </button>
                    </li>
                {/if}
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("tracks")}
                        title={$_('sidebar.allTracks')}
                        on:click={() => navigateAndClose(goToTracks)}
                    >
                        <Icon name="music" size={24} />
                        <span>{$_('sidebar.allTracks')}</span>
                        <span class="nav-count">{$trackCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("albums")}
                        title={$_('sidebar.albums')}
                        on:click={() => navigateAndClose(goToAlbums)}
                    >
                        <Icon name="disc-3" size={24} />
                        <span>{$_('sidebar.albums')}</span>
                        <span class="nav-count">{$albumCount}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("artists")}
                        title={$_('sidebar.artists')}
                        on:click={() => navigateAndClose(goToArtists)}
                    >
                        <Icon name="user" size={24} />
                        <span>{$_('sidebar.artists')}</span>
                        <span class="nav-count">{$artistCount}</span>
                    </button>
                </li>
            </ul>
        </section>

        <section class="nav-section">
            <div class="nav-section-header">
                <h3 class="nav-section-title">{$_('sidebar.playlists')}</h3>
            </div>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("playlists")}
                        title={$_('sidebar.allPlaylists')}
                        on:click={() => navigateAndClose(goToPlaylists)}
                    >
                        <Icon name="list-music" size={24} />
                        <span>{$_('sidebar.allPlaylists')}</span>
                        <span class="nav-count">{$playlists.length}</span>
                    </button>
                </li>
                {#each sortedPlaylists as playlist (playlist.id)}
                    <li>
                        <button
                            class="nav-item playlist-item"
                            class:active={$currentView.type ===
                                "playlist-detail" &&
                                $currentView.id !== undefined &&
                                playlist.id !== undefined &&
                                $currentView.id === playlist.id}
                            class:playing={isPlaylistPlaying(
                                playlist.id,
                                currentPlaylistIdValue,
                                isPlayingValue,
                            )}
                            class:drag-over={dragOverPlaylistId === playlist.id}
                            title={playlist.name}
                            on:click={() =>
                                navigateAndClose(() =>
                                    goToPlaylistDetail(playlist.id, playlist.name),
                                )}
                            on:contextmenu={(e) =>
                                handlePlaylistContextMenu(e, playlist)}
                            on:dragover={(e) =>
                                handlePlaylistDragOver(e, playlist)}
                            on:dragleave={(e) =>
                                handlePlaylistDragLeave(e, playlist)}
                            on:drop={(e) =>
                                handlePlaylistDrop(e, playlist)}
                        >
                            {#if isPlaylistPlaying(playlist.id, currentPlaylistIdValue, isPlayingValue)}
                                <div class="playing-indicator">
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                    <span class="bar"></span>
                                </div>
                            {:else}
                                <div class="playlist-icon-container">
                                    {#if $playlistCovers && $playlistCovers[playlist.id]}
                                        <img
                                            src={$playlistCovers[playlist.id]}
                                            alt=""
                                            class="sidebar-playlist-art"
                                            on:error={(e) =>
                                                handleImageError(e, playlist)}
                                        />
                                    {:else if playlist.cover_url}
                                        <img
                                            src={playlist.cover_url}
                                            alt=""
                                            class="sidebar-playlist-art"
                                            on:error={(e) =>
                                                handleImageError(e, playlist)}
                                        />
                                    {:else}
                                        <Icon name="list-music" size={24} />
                                    {/if}
                                </div>
                            {/if}
                            <span class="playlist-name">
                                {playlist.name}
                            </span>
                            {#if isPinned("playlist", playlist.id, $pinnedItems)}
                                <span
                                    class="pinned-indicator-sidebar"
                                    title={$_("home.pinned")}
                                >
                                    <Icon name="pin" size={12} />
                                </span>
                            {/if}
                            {#if $playlistTrackCounts[playlist.id] !== undefined}
                                <span class="nav-count"
                                    >{$playlistTrackCounts[
                                        playlist.id
                                    ]}</span
                                >
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        </section>

        <section class="nav-section">
            <h3 class="nav-section-title">{$_('sidebar.settings')}</h3>
            <ul class="nav-list">
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("plugins")}
                        title={$_('sidebar.plugins')}
                        on:click={() => navigateAndClose(goToPlugins)}
                    >
                        <Icon name="plugin" size={24} />
                        <span>{$_('sidebar.plugins')}</span>
                    </button>
                </li>
                <li>
                    <button
                        class="nav-item"
                        class:active={isActive("settings")}
                        title={$_('sidebar.settings')}
                        on:click={() => navigateAndClose(goToSettings)}
                    >
                        <Icon name="settings" size={24} />
                        <span>{$_('sidebar.settings')}</span>
                    </button>
                </li>
            </ul>
        </section>

        {#if $appSettings.showDiscord || $appSettings.showResonate || $appSettings.showKofi || $appSettings.showPatreon}
        <section class="nav-section">
            <h3 class="nav-section-title">{$_('sidebar.community')}</h3>
            <ul class="nav-list">
                {#if $appSettings.showDiscord}
                    <li>
                        <a
                            href="https://discord.gg/27XRVQsBd9"
                            target="_blank"
                            class="nav-item discord-item"
                            title={$_('sidebar.joinDiscord')}
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
                            <span>{$_('sidebar.joinDiscord')}</span>
                        </a>
                    </li>
                {/if}
                {#if $appSettings.showResonate}
                    <li>
                        <a
                            href="https://resonate.audionplayer.com?ref=audion"
                            target="_blank"
                            class="nav-item resonate-item"
                            title={$_('sidebar.resonate')}
                        >
                            <img src="/resonate.png" alt="Resonate" class="resonate-icon" />
                            <span>{$_('sidebar.resonate')}</span>
                        </a>
                    </li>
                {/if}
                {#if $appSettings.showKofi}
                    <li>
                        <a
                            href="https://ko-fi.com/N4N5UMNR1"
                            target="_blank"
                            class="nav-item kofi-item"
                            title={$_('sidebar.kofi', { default: 'Ko-fi' })}
                        >
                            <img src="/kofi.avif" alt="Ko-fi" class="kofi-icon" />
                            <span>{$_('sidebar.kofi', { default: 'Ko-fi' })}</span>
                        </a>
                    </li>
                {/if}
                {#if $appSettings.showPatreon}
                    <li>
                        <a
                            href="https://www.patreon.com/AudionPlayer"
                            target="_blank"
                            class="nav-item patreon-item"
                            title={$_('sidebar.patreon', { default: 'Patreon' })}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                width="24"
                                height="24"
                            >
                                <path
                                    d="M22.957 7.21c-.004-3.064-2.39-5.575-5.271-6.19-3.4-.724-7.38.52-9.426 3.42-2.32 3.29-2.32 7.79 0 11.08 2.046 2.9 6.026 4.144 9.426 3.42 2.881-.615 5.267-3.126 5.271-6.19zm-7.794 6.74c-2.41.002-4.364-1.95-4.366-4.362 0-2.41 1.952-4.364 4.362-4.366 2.41-.002 4.365 1.95 4.366 4.362.002 2.413-1.95 4.366-4.362 4.366zM0 24h4.72V0H0v24z"
                                />
                            </svg>
                            <span>{$_('sidebar.patreon', { default: 'Patreon' })}</span>
                        </a>
                    </li>
                {/if}
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
            title={$_('sidebar.addMusicFolder')}
        >
            {#if isScanning}
                <Icon name="loader" size={20} />
                <span>{scanStatus}</span>
            {:else}
                <Icon name="plus" size={20} />
                <span>{$_('sidebar.addMusicFolder')}</span>
            {/if}
        </button>
        {#if scanError}
            <p class="scan-error">{scanError}</p>
        {/if}
    </div>

    <div
        class="sidebar-splitter"
        on:mousedown={startResize}
        on:dblclick={resetWidth}
        on:keydown={handleSplitterKeydown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={sidebarWidth}
        aria-valuemin={64}
        aria-valuemax={460}
        tabindex="0"
    ></div>
</aside>

{#if showUpdatePopup && popupRelease}
    <UpdatePopup
        release={popupRelease}
        mode={popupMode}
        otaPhase={$otaState.phase === "downloading" || $otaState.phase === "ready"
            ? $otaState.phase
            : "available"}
        otaProgress={$otaState.progress}
        on:close={handlePopupClose}
        on:download={handlePopupDownload}
        on:skip={handlePopupSkip}
        on:restart={handlePopupRestart}
        on:later={handlePopupLater}
    />
{/if}

<style>
    .sidebar {
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        max-width: var(--sidebar-width);
        height: 100%;
        background-color: var(--sidebar-bg, var(--bg-base));
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-color);
        position: relative;
        flex-shrink: 0;
        box-sizing: border-box;
    }

    .sidebar:not(.resizing) {
        transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .sidebar.resizing {
        transition: none !important;
        user-select: none;
    }

    .sidebar-splitter {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 50;
        background: transparent;
        transition: background-color var(--transition-fast);
        outline: none;
    }

    .sidebar-splitter:hover,
    .sidebar-splitter:focus-visible,
    :global(body.resizing-sidebar) .sidebar-splitter {
        background-color: var(--accent-primary);
    }

    :global(html.layout-mobile) .sidebar-splitter {
        display: none !important;
    }

    /* Collapsed rail (64px) */
    .sidebar.collapsed {
        width: 64px !important;
        min-width: 64px !important;
        max-width: 64px !important;
    }

    .sidebar.collapsed .sidebar-header {
        padding: var(--spacing-sm) 4px;
        padding-top: var(--spacing-md);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
    }

    .sidebar.collapsed .logo {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
    }

    .sidebar.collapsed .logo img {
        display: block;
        margin: 0 auto;
    }

    .sidebar.collapsed .header-status-indicators {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    }

    .sidebar.collapsed .logo-text,
    .sidebar.collapsed .update-badge,
    .sidebar.collapsed .nav-section-title,
    .sidebar.collapsed .nav-item > span:not(.playlist-icon-container):not(.playing-indicator),
    .sidebar.collapsed .playlist-name,
    .sidebar.collapsed .pinned-indicator-sidebar,
    .sidebar.collapsed .nav-count,
    .sidebar.collapsed .add-folder-btn > span,
    .sidebar.collapsed .scan-error {
        display: none !important;
    }

    .sidebar.collapsed .sidebar-nav {
        padding: var(--spacing-xs);
    }

    .sidebar.collapsed .nav-section {
        margin-bottom: var(--spacing-md);
    }

    .sidebar.collapsed .nav-item {
        justify-content: center;
        padding: 10px 0;
        gap: 0;
    }

    .sidebar.collapsed .sidebar-footer {
        padding: var(--spacing-xs);
    }

    .sidebar.collapsed .add-folder-btn {
        padding: 10px 0;
        justify-content: center;
    }

    /* Playlist drag-over visual highlight */
    .playlist-item.drag-over {
        background-color: var(--accent-subtle) !important;
        outline: 2px dashed var(--accent-primary);
        outline-offset: -2px;
        color: var(--accent-primary) !important;
        box-shadow: 0 0 8px var(--accent-subtle);
    }

    .sidebar-header {
        padding: var(--spacing-md);
        padding-top: var(--spacing-lg);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-xs);
    }

    .header-status-indicators {
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }

    .sidebar-toggle-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: var(--radius-sm);
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
        margin-left: auto;
    }

    .sidebar-toggle-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .sidebar.collapsed .sidebar-toggle-btn {
        margin-left: 0;
        width: 28px;
        height: 28px;
    }

    .logo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--accent-primary);
        user-select: none;
        -webkit-user-select: none;
    }

    .logo-text {
        font-size: 1.5rem;
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.5px;
        user-select: none;
        -webkit-user-select: none;
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
        color: var(--text-on-accent, #fff);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px var(--accent-subtle);
    }

    .restart-badge {
        background-color: color-mix(in srgb, var(--accent-primary), transparent 75%);
        border-color: var(--accent-primary);
        color: var(--accent-primary);
    }

    .restart-badge:hover {
        background-color: var(--accent-primary);
        color: var(--text-on-accent, #fff);
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

    .nav-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .nav-section-title {
        font-size: 0.6875rem;
        font-weight: var(--font-weight-bold);
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
        position: relative;
        user-select: none;
        -webkit-user-select: none;
    }

    .nav-item:hover {
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.1);
    }

    .nav-item.active {
        color: var(--text-primary);
        background-color: var(--bg-surface);
        font-weight: var(--font-weight-medium);
    }

    .nav-item.playing {
        background-color: var(--accent-subtle);
        color: var(--text-primary);
    }

    .nav-item svg,
    .nav-item img {
        flex-shrink: 0;
        opacity: 0.7;
    }

    .resonate-icon,
    .kofi-icon {
        width: 24px;
        height: 24px;
        object-fit: contain;
    }

    .kofi-icon {
        border-radius: 4px;
    }

    .discord-item:hover svg {
        color: #5865f2;
        opacity: 1;
    }

    .kofi-item:hover .kofi-icon {
        opacity: 1;
    }

    .patreon-item:hover svg {
        color: #f96854;
        opacity: 1;
    }

    .nav-item.active svg {
        opacity: 1;
        color: var(--accent-primary);
    }

    .nav-count {
        margin-left: auto;
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
    }

    .playlist-item {
        padding-left: var(--spacing-md);
    }

    .playing-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
    }

    .playing-indicator .bar {
        width: 3px;
        height: 12px;
        background-color: var(--accent-primary);
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
            height: 4px;
        }
        50% {
            height: 14px;
        }
    }

    .nav-item.playing .nav-count {
        color: var(--accent-primary);
        font-weight: var(--font-weight-semibold);
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
        font-weight: var(--font-weight-medium);
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
        font-size: var(--font-size-xs);
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

    .playlist-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--font-size-sm);
    }

    .pinned-indicator-sidebar {
        color: var(--accent-primary);
        display: flex;
        align-items: center;
        margin-left: var(--spacing-xs);
        opacity: 0.8;
    }

    .playlist-item:hover .pinned-indicator-sidebar {
        opacity: 1;
    }

    /* Mobile: sidebar fills its container (the drawer) */
    :global(html.layout-mobile) .sidebar {
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        border-right: none;
        height: 100%;
    }

    :global(html.layout-mobile) .sidebar-header {
        padding-top: var(--spacing-md);
    }

    :global(html.layout-mobile) .nav-item {
        padding: 14px var(--spacing-md);
        min-height: 48px;
    }
    .playlist-icon-container {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        border-radius: 4px;
    }

    .sidebar-playlist-art {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
</style>
