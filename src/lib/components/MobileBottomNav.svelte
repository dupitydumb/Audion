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
    } from "$lib/stores/view";
    import { clearSearch } from "$lib/stores/search";
    import { currentTrack } from "$lib/stores/player";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import { pluginDrawerOpen } from "$lib/stores/plugin-drawer";
    import { onMount } from "svelte";
    import Icon from "$lib/components/Icon.svelte";

    type MobileTab = "home" | "library" | "plugins";

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

    function deriveActiveTab(viewType: string): MobileTab {
        if (viewType === "home") return "home";
        if (viewType === "plugins" || viewType === "settings") return "plugins";
        return "library";
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

<nav class="bottom-nav" class:has-player={!!$currentTrack}>
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
        class:active={activeTab === "plugins"}
        on:click={() => handleTabClick("plugins")}
    >
        <Icon name="plugin" size={24} className="nav-icon" />
        <span>{$_('sidebar.plugins')}</span>
    </button>

    <!-- Plugin actions drawer trigger -->
    <button
        class="nav-item"
        class:active={$pluginDrawerOpen}
        on:click={() => pluginDrawerOpen.set(true)}
    >
        <Icon name="zap" size={24} className="nav-icon" />
        <span>{$_('nav.actions')}</span>
    </button>

    <!-- Plugin slot for bottom nav extensions -->
    <div class="plugin-slot" bind:this={pluginSlot}></div>
</nav>

<style>
    .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        height: calc(60px + env(safe-area-inset-bottom));
        background-color: var(--bg-base);
        border-top: 1px solid var(--border-color);
        display: flex;
        justify-content: space-around;
        align-items: flex-start;
        padding-top: 6px;
        padding-bottom: env(safe-area-inset-bottom);
        z-index: 1000;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }

    .nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
        text-align: center;
        font-size: 10px;
        font-weight: var(--font-weight-medium);
        gap: 2px;
        padding: 4px 12px;
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
        background: none;
        border: none;
        cursor: pointer;
        min-width: 64px;
        min-height: 48px;
        -webkit-tap-highlight-color: transparent;
    }

    .nav-item:active {
        transform: scale(0.92);
    }

    .nav-item.active {
        color: var(--text-primary);
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
