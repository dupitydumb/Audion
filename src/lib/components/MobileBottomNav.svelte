<script lang="ts">
    import { _ } from "svelte-i18n";
    import { mobileSearchOpen } from "$lib/stores/mobile";
    import {
        currentView,
        goToHome,
        goToTracks,
        goToAlbums,
        goToArtists,
        goToPlaylists,
        goToPlugins,
        goToDiscover,
    } from "$lib/stores/view";
    import { clearSearch } from "$lib/stores/search";
    import { currentTrack } from "$lib/stores/player";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import { onMount } from "svelte";
    import Icon from "$lib/components/Icon.svelte";

    type MobileTab = "home" | "library" | "discover" | "plugins";

    let pluginSlot: HTMLDivElement;

    // Track which library sub-view was last active
    let lastLibraryView: "tracks" | "albums" | "artists" | "playlists" =
        "tracks";

    $: {
        const type = $currentView.type;
        if (
            type === "tracks" ||
            type === "albums" ||
            type === "artists" ||
            type === "playlists"
        ) {
            lastLibraryView = type as typeof lastLibraryView;
        }
    }

    // Derive active tab from current state
    $: activeTab = deriveActiveTab($currentView.type);
    $: activeTabIndex = activeTab === "home" ? 0 : activeTab === "library" ? 1 : activeTab === "discover" ? 2 : activeTab === "plugins" ? 3 : -1;

    function deriveActiveTab(viewType: string): MobileTab | null {
        if (viewType === "home") return "home";
        if (viewType === "discover") return "discover";
        if (viewType === "plugins") return "plugins";
        if (viewType === "settings" || viewType === "listenbrainz") return null;
        if (
            viewType === "tracks" ||
            viewType === "tracks-multiselect" ||
            viewType === "albums" ||
            viewType === "album-detail" ||
            viewType === "artists" ||
            viewType === "artist-detail" ||
            viewType === "playlists" ||
            viewType === "playlist-detail" ||
            viewType === "liked-songs" ||
            viewType === "subsonic" ||
            viewType === "subsonic-album" ||
            viewType === "subsonic-artist"
        ) {
            return "library";
        }
        return null;
    }

    function handleTabClick(tab: MobileTab) {
        // Close search when switching tabs
        mobileSearchOpen.set(false);
        clearSearch();

        switch (tab) {
            case "home":
                goToHome();
                break;
            case "library":
                // Return to last active library sub-view
                switch (lastLibraryView) {
                    case "albums":
                        goToAlbums();
                        break;
                    case "artists":
                        goToArtists();
                        break;
                    case "playlists":
                        goToPlaylists();
                        break;
                    default:
                        goToTracks();
                        break;
                }
                break;
            case "plugins":
                goToPlugins();
                break;
            case "discover":
                goToDiscover();
                break;
        }
    }

    onMount(() => {
        if (pluginSlot) {
            uiSlotManager.registerContainer("mobile:bottomnav", pluginSlot);
        }
        return () => {
            uiSlotManager.unregisterContainer("mobile:bottomnav");
        };
    });
</script>

<nav class="bottom-nav" class:has-player={!!$currentTrack} style="--active-tab-idx: {activeTabIndex};">
    {#if activeTabIndex >= 0}
        <div class="active-pill-slider" aria-hidden="true"></div>
    {/if}
    <button
        class="nav-item"
        class:active={activeTab === "home"}
        on:click={() => handleTabClick("home")}
    >
        <Icon name="home" size={24} className="nav-icon" />
        <span>{$_('sidebar.home')}</span>
    </button>

    <button
        class="nav-item"
        class:active={activeTab === "library"}
        on:click={() => handleTabClick("library")}
    >
        <Icon name="library" size={24} className="nav-icon" />
        <span>{$_('sidebar.library')}</span>
    </button>

    <button
        class="nav-item"
        class:active={activeTab === "discover"}
        on:click={() => handleTabClick("discover")}
    >
        <Icon name="compass" size={24} className="nav-icon" />
        <span>{$_('sidebar.discover')}</span>
    </button>

    <button
        class="nav-item"
        class:active={activeTab === "plugins"}
        on:click={() => handleTabClick("plugins")}
    >
        <Icon name="plugin" size={24} className="nav-icon" />
        <span>{$_('sidebar.plugins')}</span>
    </button>

    <!-- Plugin slot for bottom nav extensions -->
    <div class="plugin-slot" bind:this={pluginSlot}></div>
</nav>

<style>
    .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        height: calc(var(--mobile-nav-height, 64px) + var(--safe-area-bottom, 0px));
        background-color: var(--bg-base);
        background: color-mix(in srgb, var(--bg-base) 88%, transparent);
        backdrop-filter: blur(28px) saturate(190%);
        -webkit-backdrop-filter: blur(28px) saturate(190%);
        border-top: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-md);
        display: flex;
        justify-content: stretch;
        align-items: flex-start;
        padding-top: 6px;
        padding-left: var(--tv-overscan-x, var(--safe-area-left, 0px));
        padding-right: var(--tv-overscan-x, var(--safe-area-right, 0px));
        padding-bottom: var(--safe-area-bottom, 0px);
        z-index: var(--z-bottom-nav, 1000);
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }

    .active-pill-slider {
        position: absolute;
        top: 8px;
        left: var(--safe-area-left, 0px);
        width: calc((100% - var(--safe-area-left, 0px) - var(--safe-area-right, 0px)) / 4);
        height: 28px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 0;
        pointer-events: none;
        transform: translate3d(calc(var(--active-tab-idx, 0) * 100%), 0, 0);
        transition: transform 0.32s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1));
        will-change: transform;
    }

    .active-pill-slider::after {
        content: "";
        width: 52px;
        height: 28px;
        background: var(--surface-subtle-hover);
        border-radius: var(--radius-full, 9999px);
    }

    @media (prefers-reduced-motion: reduce) {
        .active-pill-slider {
            transition: none !important;
        }
    }

    .nav-item {
        position: relative;
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        text-align: center;
        font-size: var(--font-size-xs, 12px);
        font-weight: var(--font-weight-medium);
        gap: 3px;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        transition: transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), color 150ms ease;
        background: none;
        border: none;
        cursor: pointer;
        min-height: 48px;
        -webkit-tap-highlight-color: transparent;
    }

    .nav-item span {
        display: block;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    .nav-item:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: -2px;
        color: var(--text-primary);
    }

    .nav-item:active {
        transform: scale(0.90);
    }

    .nav-item.active {
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
    }

    .nav-item.active :global(.nav-icon) {
        color: var(--text-primary);
    }

    .nav-icon {
        display: block;
        width: 24px;
        height: 24px;
    }

    .plugin-slot {
        display: none; /* Hidden by default, plugins can override */
    }
</style>
