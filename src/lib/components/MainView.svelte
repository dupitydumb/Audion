<script lang="ts">
    import {
        currentView,
        goToTracks,
        goToAlbums,
        goToArtists,
        goToPlaylists,
    } from "$lib/stores/view";
    import {
        tracks,
        albums,
        artists,
        addTrackToLibrary,
    } from "$lib/stores/library";
    import { isScanning } from "$lib/stores/progressiveScan"; // we Only need isScanning flag
    import {
        searchQuery,
        searchResults,
        clearSearch,
    } from "$lib/stores/search";
    import { isMobile } from "$lib/stores/mobile";
    import MobileHome from "./MobileHome.svelte";
    import DesktopHome from "./DesktopHome.svelte";
    import LikedSongs from "./LikedSongs.svelte";

    import TrackList from "./TrackList.svelte";
    import AlbumGrid from "./AlbumGrid.svelte";
    import AlbumDetail from "./AlbumDetail.svelte";
    import ArtistGrid from "./ArtistGrid.svelte";
    import ArtistDetail from "./ArtistDetail.svelte";
    import PlaylistView from "./PlaylistView.svelte";
    import PlaylistDetail from "./PlaylistDetail.svelte";
    import MultiSelectTrackView from "./MultiSelectTrackView.svelte";
    import SearchResults from "./SearchResults.svelte";

    import PluginManager from "./PluginManager.svelte";
    import Settings from "./Settings.svelte";

    import { tick, onMount } from "svelte";
    import { fade, fly } from "svelte/transition";
    import { onDestroy } from "svelte";
    import { getCurrentWebview } from "@tauri-apps/api/webview";

    import { confirm } from "$lib/stores/dialogs";
    import { get } from "svelte/store";
    import { importAudioFile, importAudioBytes } from "$lib/api/tauri";
    // Note: we prefer using the OS file path when available from the drag event.

    $: isSearching = $searchQuery.length > 0;
    $: isLibraryView = ["tracks", "albums", "artists", "playlists"].includes(
        $currentView.type,
    );
    import GlobalShortcuts from "./GlobalShortcuts.svelte";
    import type { SectionKey } from "./SearchResults.svelte";

    const SECTION_LABELS: Record<SectionKey, string> = {
        tracks: "Tracks",
        albums: "Albums",
        artists: "Artists",
        playlists: "Playlists",
    };

    let sectionOrder: SectionKey[] = ["tracks", "albums", "artists", "playlists"];
    let hiddenSections = new Set<SectionKey>();

    function moveSection(key: SectionKey, direction: -1 | 1) {
        const idx = sectionOrder.indexOf(key);
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= sectionOrder.length) return;
        const next = [...sectionOrder];
        [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
        sectionOrder = next;
    }

    function toggleSection(key: SectionKey) {
        const next = new Set(hiddenSections);
        next.has(key) ? next.delete(key) : next.add(key);
        hiddenSections = next;
    }

    // Mobile search bar state
    let mobileSearchInput = "";
    let mobileSearchInputEl: HTMLInputElement;
    let mobileSearchTimer: ReturnType<typeof setTimeout>;
    let mobileSearchVisible = false;

    function handleMobileSearchInput() {
        clearTimeout(mobileSearchTimer);
        mobileSearchTimer = setTimeout(() => {
            searchQuery.set(mobileSearchInput);
        }, 200);
    }

    function openMobileSearch() {
        mobileSearchVisible = true;
        tick().then(() => mobileSearchInputEl?.focus());
    }

    function closeMobileSearch() {
        mobileSearchVisible = false;
        mobileSearchInput = "";
        clearSearch();
    }

    // Drag & Drop logic
    let isDragging = false;
    let dragCounter = 0;
    let dropError = "";

    function isAudioFile(file: File) {
        return (
            file.type.startsWith("audio/") ||
            /\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(file.name)
        );
    }

    async function handleDrop(event: any) {
        try {
            if (event && typeof event.preventDefault === "function")
                event.preventDefault();
        } catch (e) {}

        isDragging = false;
        dragCounter = 0;
        dropError = "";

        // Normalize files: support DataTransferFile (File objects) and synthetic { name, path } objects
        let incomingFiles: any[] = [];
        try {
            if (event?.dataTransfer?.files) {
                // FileList or Array-like
                incomingFiles = Array.from(event.dataTransfer.files as any);
            } else if (Array.isArray(event?.dataTransfer?.files)) {
                incomingFiles = event.dataTransfer.files;
            } else if (Array.isArray(event?.dataTransfer)) {
                incomingFiles = event.dataTransfer;
            } else if (event?.dataTransfer && event.dataTransfer.paths) {
                incomingFiles = event.dataTransfer.paths.map((p: string) => ({
                    name: p.split(/[\\/]/).pop(),
                    path: p,
                }));
            } else if (event?.dataTransfer && event.dataTransfer.filesPaths) {
                incomingFiles = event.dataTransfer.filesPaths.map(
                    (p: string) => ({ name: p.split(/[\\/]/).pop(), path: p }),
                );
            } else if (Array.isArray(event)) {
                incomingFiles = event;
            } else if (event && event.payload && event.payload.paths) {
                incomingFiles = event.payload.paths.map((p: string) => ({
                    name: p.split(/[\\/]/).pop(),
                    path: p,
                }));
            }
        } catch (e) {
            console.warn("Failed to normalize drop payload", e);
        }

        if (!incomingFiles.length) {
            dropError = "No audio files detected.";
            return;
        }

        for (const file of incomingFiles) {
            // If file is a plain path object
            const maybePath: string | undefined =
                (file as any).path ||
                (file as any).filesystemPath ||
                ((file as any).name && /[:\\/]/.test((file as any).name))
                    ? (file as any).name
                    : undefined;

            // If item is a real File-like object, it may have .name and .arrayBuffer()
            if (maybePath) {
                // Use backend import by path
                try {
                    console.log("[DND] importing by path:", maybePath);
                    const result = await importAudioFile(maybePath, false);
                    if (result === "duplicate") {
                        const overwrite = await confirm(
                            `File '${(file as any).name}' already exists. Overwrite?`,
                            { confirmLabel: "Overwrite", cancelLabel: "Skip" },
                        );
                        if (overwrite) {
                            const r2 = await importAudioFile(maybePath, true);
                            if (typeof r2 === "object") {
                                console.log("Imported (overwritten)", r2.title);
                                addTrackToLibrary(r2);
                            } else {
                                dropError = `Failed to import ${(file as any).name || maybePath}: ${r2}`;
                            }
                        }
                    } else if (typeof result === "object") {
                        console.log("Imported", result.title);
                        addTrackToLibrary(result);
                    } else {
                        dropError = `Failed to import ${(file as any).name || maybePath}: ${result}`;
                    }
                } catch (e) {
                    dropError = `Failed to import ${(file as any).name || maybePath}: ${e}`;
                }
            } else if ((file as any).arrayBuffer) {
                // Browser File: read bytes and call importAudioBytes
                try {
                    const arrayBuffer = await (file as File).arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++)
                        binary += String.fromCharCode(bytes[i]);
                    const base64Data = btoa(binary);
                    const result = await importAudioBytes(
                        (file as any).name || "unknown",
                        base64Data,
                        false,
                    );
                    if (result === "duplicate") {
                        const overwrite = await confirm(
                            `File '${(file as any).name}' already exists. Overwrite?`,
                            { confirmLabel: "Overwrite", cancelLabel: "Skip" },
                        );
                        if (overwrite) {
                            const r2 = await importAudioBytes(
                                (file as any).name || "unknown",
                                base64Data,
                                true,
                            );
                            if (typeof r2 === "object") {
                                console.log(
                                    "Imported bytes (overwritten)",
                                    r2.title,
                                );
                                addTrackToLibrary(r2);
                            } else {
                                dropError = `Failed to import ${(file as any).name}: ${r2}`;
                            }
                        }
                    } else if (typeof result === "object") {
                        console.log("Imported bytes", result.title);
                        addTrackToLibrary(result);
                    } else {
                        dropError = `Failed to import ${(file as any).name}: ${result}`;
                    }
                } catch (e) {
                    dropError = `Failed to read ${(file as any).name}: ${e}`;
                }
            } else {
                console.warn("Unsupported drop item", file);
            }
        }
    }

    function hasFiles(dt: DataTransfer | null | undefined) {
        try {
            if (!dt) return false;
            // Some browsers expose types as DOMStringList
            const types = dt.types as any;
            if (!types) return false;
            // Common check: 'Files' type present
            for (let i = 0; i < types.length; i++) {
                const t = String(types[i] || "").toLowerCase();
                if (
                    t === "files" ||
                    t === "application/x-moz-file" ||
                    t === "file"
                )
                    return true;
            }
        } catch (e) {
            // ignore
        }
        return false;
    }

    // Add native capture-phase listeners to help when webview swallows events
    onMount(() => {
        const nativeEnter = (e: DragEvent) => {
            console.log(
                "[DND] native dragenter",
                e.type,
                e.dataTransfer?.types,
            );
            try {
                if (hasFiles(e.dataTransfer)) {
                    e.preventDefault();
                    handleDragEnter(e);
                }
            } catch (err) {}
        };
        const nativeOver = (e: DragEvent) => {
            // show logs to verify dragover
            console.log("[DND] native dragover", e.type, e.dataTransfer?.types);
            try {
                if (hasFiles(e.dataTransfer)) {
                    e.preventDefault();
                    handleDragOver(e);
                    e.dataTransfer!.dropEffect = "copy";
                }
            } catch (err) {}
        };
        const nativeLeave = (e: DragEvent) => {
            console.log(
                "[DND] native dragleave",
                e.type,
                e.dataTransfer?.types,
            );
            try {
                if (hasFiles(e.dataTransfer)) {
                    e.preventDefault();
                    handleDragLeave(e);
                }
            } catch (err) {}
        };
        const nativeDrop = (e: DragEvent) => {
            console.log("[DND] native drop", e.type, e.dataTransfer?.types);
            try {
                if (hasFiles(e.dataTransfer)) {
                    e.preventDefault();
                    handleDrop(e);
                }
            } catch (err) {}
        };

        window.addEventListener("dragenter", nativeEnter, true);
        window.addEventListener("dragover", nativeOver, true);
        window.addEventListener("dragleave", nativeLeave, true);
        window.addEventListener("drop", nativeDrop, true);

        // Register Tauri webview drag-drop event listener (desktop webview)
        let unlistenWebview: (() => void) | null = null;

        (async () => {
            try {
                const webview = await getCurrentWebview();
                unlistenWebview = await webview.onDragDropEvent(
                    async (event) => {
                        // payload types: 'over' | 'drop' | 'cancel'
                        console.log(
                            "[DND] webview onDragDropEvent",
                            event.payload.type,
                            event.payload,
                        );
                        const p: any = event.payload;
                        if (p.type === "over") {
                            // The user is hovering files over the webview
                            isDragging = true;
                        } else if (p.type === "drop") {
                            isDragging = false;
                            // event.payload.paths is an array of absolute file paths
                            const paths: string[] = p.paths || [];
                            for (const fp of paths) {
                                try {
                                    console.log("[DND] webview drop path:", fp);
                                    const result = await importAudioFile(
                                        fp,
                                        false,
                                    );
                                    if (result === "duplicate") {
                                        const name =
                                            fp.split(/[\\/]/).pop() || fp;
                                        const overwrite = await confirm(
                                            `File '${name}' already exists. Overwrite?`,
                                            {
                                                confirmLabel: "Overwrite",
                                                cancelLabel: "Skip",
                                            },
                                        );
                                        if (overwrite) {
                                            const r2 = await importAudioFile(
                                                fp,
                                                true,
                                            );
                                            if (typeof r2 === "object")
                                                addTrackToLibrary(r2);
                                        }
                                    } else if (typeof result === "object") {
                                        console.log(
                                            "Imported (webview)",
                                            result.title,
                                        );
                                        addTrackToLibrary(result);
                                    } else {
                                        console.warn(
                                            "Import result",
                                            result,
                                            fp,
                                        );
                                    }
                                } catch (e) {
                                    console.error(
                                        "[DND] importAudioFile failed for",
                                        fp,
                                        e,
                                    );
                                }
                            }
                        } else {
                            // cancel
                            isDragging = false;
                        }
                    },
                );
            } catch (e) {
                // Ignore if not running in Tauri or API unavailable
                console.warn(
                    "[DND] getCurrentWebview.onDragDropEvent not available",
                    e,
                );
            }
        })();

        return () => {
            window.removeEventListener("dragenter", nativeEnter, true);
            window.removeEventListener("dragover", nativeOver, true);
            window.removeEventListener("dragleave", nativeLeave, true);
            window.removeEventListener("drop", nativeDrop, true);
            if (unlistenWebview) {
                try {
                    unlistenWebview();
                } catch (e) {}
            }
        };
    });

    function handleDragOver(event: DragEvent) {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if (!isDragging) isDragging = true;
    }

    function handleDragEnter(event: DragEvent) {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragCounter++;
        isDragging = true;
    }

    function handleDragLeave(event: DragEvent) {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            isDragging = false;
        }
    }
</script>

<svelte:window
    on:dragenter={handleDragEnter}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
/>

<main
    class="main-view"
    on:dragover={handleDragOver}
    on:dragenter={handleDragEnter}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
>
    {#if isDragging}
        <div class="drop-overlay" transition:fade={{ duration: 200 }}>
            <div
                class="drop-content"
                in:fly={{ y: 20, duration: 400, delay: 100 }}
            >
                <div class="drop-icon">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                </div>
                <div class="drop-text">Drop your music here</div>
                <div class="drop-subtext">MP3, FLAC, M4A, WAV, OGG</div>
            </div>
        </div>
    {/if}

    {#if dropError}
        <div class="drop-error" transition:fly={{ y: -20, duration: 300 }}>
            <div class="error-icon">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            </div>
            <div class="error-message">{dropError}</div>
            <button
                class="error-close"
                on:click={() => (dropError = "")}
                aria-label="Close error"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>
    {/if}
    <GlobalShortcuts />

    <!-- Mobile: Search bar + library sub-tabs (Spotify pill style) -->
    {#if $isMobile && isLibraryView}
        <div class="mobile-library-header">
            <div class="mobile-search-bar">
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
                    placeholder="Search your library..."
                    bind:value={mobileSearchInput}
                    bind:this={mobileSearchInputEl}
                    on:input={handleMobileSearchInput}
                    on:keydown={(e) =>
                        e.key === "Escape" && closeMobileSearch()}
                    spellcheck="false"
                />
                {#if mobileSearchInput}
                    <button
                        class="search-clear"
                        on:click={closeMobileSearch}
                        aria-label="Clear search"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="18"
                            height="18"
                        >
                            <path
                                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                            />
                        </svg>
                    </button>
                {/if}
            </div>
        </div>

        {#if !isSearching}
            <div class="mobile-library-tabs-wrapper">
                <div class="mobile-library-tabs">
                    <button
                        class="lib-tab"
                        class:active={$currentView.type === "tracks"}
                        on:click={goToTracks}
                    >
                        Songs
                    </button>
                    <button
                        class="lib-tab"
                        class:active={$currentView.type === "albums"}
                        on:click={goToAlbums}
                    >
                        Albums
                    </button>
                    <button
                        class="lib-tab"
                        class:active={$currentView.type === "artists"}
                        on:click={goToArtists}
                    >
                        Artists
                    </button>
                    <button
                        class="lib-tab"
                        class:active={$currentView.type === "playlists"}
                        on:click={goToPlaylists}
                    >
                        Playlists
                    </button>
                </div>
            </div>
        {/if}
    {/if}

    {#if isSearching}
        <div class="view-container">
            <header class="view-header search-view-header">
                <h1>Search Results</h1>
                {#if $searchResults.hasResults}
                    <div class="results-pills">
                        {#each sectionOrder as key, i (key)}
                            {@const hasResults =
                                (key === "tracks"    && $searchResults.tracks.length > 0) ||
                                (key === "albums"    && $searchResults.albums.length > 0) ||
                                (key === "artists"   && $searchResults.artists.length > 0) ||
                                (key === "playlists" && ($searchResults.playlists?.length ?? 0) > 0)}
                            {#if hasResults}
                                {@const count =
                                    key === "tracks"    ? $searchResults.tracks.length :
                                    key === "albums"    ? $searchResults.albums.length :
                                    key === "artists"   ? $searchResults.artists.length :
                                    ($searchResults.playlists?.length ?? 0)}
                                {@const visibleKeys = sectionOrder.filter(k =>
                                    (k === "tracks"    && $searchResults.tracks.length > 0) ||
                                    (k === "albums"    && $searchResults.albums.length > 0) ||
                                    (k === "artists"   && $searchResults.artists.length > 0) ||
                                    (k === "playlists" && ($searchResults.playlists?.length ?? 0) > 0)
                                )}
                                {@const visibleIdx = visibleKeys.indexOf(key)}
                                <div class="pill-wrapper">
                                        <!-- reorder arrows removed for simpler pill layout -->
                                    <button
                                        class="section-pill"
                                        class:pill-active={!hiddenSections.has(key)}
                                        class:pill-inactive={hiddenSections.has(key)}
                                        on:click={() => toggleSection(key)}
                                    >
                                        <span class="pill-label">{SECTION_LABELS[key]}</span>
                                        <span class="pill-count">{count}</span>
                                    </button>
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </header>
            <div class="view-content">
                <SearchResults {sectionOrder} {hiddenSections} />
            </div>
        </div>
    {:else if $currentView.type === "tracks"}
        <div class="view-container">
            <header class="view-header">
                <h1>All Tracks</h1>
                {#if $isScanning}
                    <div class="scan-status">
                        Scanning... {$tracks.length} tracks found
                    </div>
                {/if}
            </header>

            <div class="view-content">
                <TrackList tracks={$tracks} showAlbum={true} />
            </div>
        </div>
    {:else if $currentView.type === "tracks-multiselect" && $currentView.id}
        <div class="view-container no-padding">
            <MultiSelectTrackView playlistId={$currentView.id} />
        </div>
    {:else if $currentView.type === "albums"}
        <div class="view-container">
            <header class="view-header">
                <h1>Albums</h1>
            </header>
            <div class="view-content">
                <AlbumGrid albums={$albums} />
            </div>
        </div>
    {:else if $currentView.type === "album-detail" && $currentView.id}
        <div class="view-container no-padding">
            <AlbumDetail albumId={$currentView.id} />
        </div>
    {:else if $currentView.type === "artists"}
        <div class="view-container">
            <header class="view-header">
                <h1>Artists</h1>
            </header>
            <div class="view-content">
                <ArtistGrid artists={$artists} />
            </div>
        </div>
    {:else if $currentView.type === "artist-detail" && $currentView.name}
        <div class="view-container no-padding">
            <ArtistDetail artistName={$currentView.name} />
        </div>
    {:else if $currentView.type === "playlists"}
        <div class="view-container no-padding">
            <PlaylistView />
        </div>
    {:else if $currentView.type === "playlist-detail" && $currentView.id}
        <div class="view-container no-padding">
            <PlaylistDetail playlistId={$currentView.id} />
        </div>
    {:else if $currentView.type === "plugins"}
        <div class="view-container no-padding">
            <PluginManager />
        </div>
    {:else if $currentView.type === "settings"}
        <div class="view-container no-padding">
            <Settings />
        </div>
    {:else if $currentView.type === "home"}
        <div class="view-container no-padding">
            {#if $isMobile}
                <MobileHome />
            {:else}
                <DesktopHome />
            {/if}
        </div>
    {:else if $currentView.type === "liked-songs"}
        <div class="view-container no-padding">
            <LikedSongs />
        </div>
    {:else}
        <div class="view-container">
            <div class="empty-state">
                <h2>Select a view from the sidebar</h2>
            </div>
        </div>
    {/if}
</main>

<style>
    .main-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background-color: var(--bg-base);
        position: relative;
    }

    .drop-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        padding: var(--spacing-xl);
    }

    .drop-overlay::after {
        content: "";
        position: absolute;
        inset: var(--spacing-md);
        border: 2px dashed var(--accent-primary);
        border-radius: var(--radius-lg);
        opacity: 0.5;
        animation: border-dance 4s linear infinite;
    }

    @keyframes border-dance {
        0% {
            stroke-dashoffset: 0;
        }
        100% {
            stroke-dashoffset: 100;
        }
    }

    .drop-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
        color: var(--text-primary);
        text-align: center;
        z-index: 1001;
    }

    .drop-icon {
        width: 80px;
        height: 80px;
        color: var(--accent-primary);
        background: var(--accent-subtle);
        border-radius: var(--radius-lg);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: var(--spacing-sm);
    }

    .drop-icon svg {
        width: 40px;
        height: 40px;
    }

    .drop-text {
        font-size: 2rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }

    .drop-subtext {
        color: var(--text-secondary);
        font-size: 1rem;
        font-weight: 500;
    }

    .drop-error {
        position: fixed;
        top: var(--spacing-lg);
        left: 50%;
        transform: translateX(-50%);
        background: var(--bg-surface);
        color: var(--text-primary);
        padding: var(--spacing-md) var(--spacing-lg);
        border-radius: var(--radius-md);
        z-index: 2000;
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        box-shadow: var(--shadow-lg);
        border: 1px solid var(--border-color);
        border-left: 4px solid var(--error-color);
        min-width: 320px;
        max-width: 90vw;
    }

    .error-icon {
        color: var(--error-color);
        flex-shrink: 0;
    }

    .error-icon svg {
        width: 24px;
        height: 24px;
    }

    .error-message {
        flex: 1;
        font-weight: 500;
        font-size: 0.9375rem;
    }

    .error-close {
        color: var(--text-subdued);
        padding: 4px;
        border-radius: 4px;
        transition: all var(--transition-fast);
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        min-height: 32px;
    }

    .error-close:hover {
        color: var(--text-primary);
        background: rgba(255, 255, 255, 0.1);
    }

    .error-close svg {
        width: 18px;
        height: 18px;
    }

    .view-container {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    :global(.view-container.no-padding .view-content) {
        padding: 0;
    }

    .view-header {
        padding: var(--spacing-lg) var(--spacing-md);
        flex-shrink: 0;
    }

    .view-header h1 {
        font-size: 2rem;
        font-weight: 700;
    }

    .view-content {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }

    @media (max-width: 768px) {
        .view-content {
            padding-bottom: calc(
                var(--mobile-bottom-inset, 130px) + var(--spacing-md)
            );
        }
    }

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-subdued);
    }

    .scan-status {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-top: var(--spacing-xs);
    }

    .search-view-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-lg);
        flex-wrap: wrap;
    }

    .search-view-header h1 {
        line-height: 1;
        margin: 0;
    }

    .results-pills {
        display: flex;
        gap: var(--spacing-xs);
        flex-wrap: wrap;
        align-items: center;
    }

    .pill-wrapper {
        display: flex;
        align-items: center;
    }

    .section-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 4px;
        border-radius: var(--radius-full);
        border: 1px solid transparent;
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
    }

    .pill-active {
        background-color: var(--accent-primary);
        color: var(--text-primary);
        border-color: var(--accent-primary);
    }

    .pill-inactive {
        background-color: var(--bg-elevated);
        color: var(--text-subdued);
        border-color: var(--border-color);
        opacity: 0.6;
    }

    .pill-inactive:hover { opacity: 1; color: var(--text-secondary); }

    .pill-count {
        font-size: 0.75rem;
        opacity: 0.75;
        font-weight: 400;
        padding-right: 6px;
    }

    /* ===== Mobile Library Header (search + tabs) ===== */
    .mobile-library-header {
        flex-shrink: 0;
        padding: var(--spacing-md) var(--spacing-md) 0;
        background-color: var(--bg-base);
    }

    .mobile-search-bar {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        background-color: var(--bg-elevated);
        border-radius: var(--radius-md);
        padding: 0 var(--spacing-md);
        height: 40px;
    }

    .mobile-search-bar .search-icon {
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

    .search-clear {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        padding: 4px;
        min-height: 28px;
        min-width: 28px;
        border-radius: var(--radius-full);
        transition: color var(--transition-fast);
    }

    .search-clear:active {
        color: var(--text-primary);
    }

    .mobile-library-tabs-wrapper {
        flex-shrink: 0;
        padding: var(--spacing-md) var(--spacing-md) 0;
        background-color: var(--bg-base);
    }

    .mobile-library-tabs {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }

    .mobile-library-tabs::-webkit-scrollbar {
        display: none;
    }

    .lib-tab {
        flex-shrink: 0;
        padding: 8px 16px;
        border-radius: var(--radius-full);
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--text-primary);
        background-color: rgba(255, 255, 255, 0.07);
        border: none;
        cursor: pointer;
        transition: all var(--transition-fast);
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
    }

    .lib-tab.active {
        background-color: var(--accent-primary);
        color: var(--bg-base);
    }

    .lib-tab:active:not(.active) {
        background-color: rgba(255, 255, 255, 0.12);
    }

    /* Mobile view header adjustments */
    @media (max-width: 768px) {
        .view-header h1 {
            font-size: 1.25rem;
        }

        .view-header {
            padding: var(--spacing-md);
        }
    }
</style>
