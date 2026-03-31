<script lang="ts">
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
        <svg
            class="nav-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
        >
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
        <span>Home</span>
    </button>

    <button
        class="nav-item"
        class:active={activeTab === "library"}
        on:click={() => handleTabClick("library")}
    >
        <svg
            class="nav-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
        >
            <path
                d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z"
            />
        </svg>
        <span>Library</span>
    </button>

    <button
        class="nav-item"
        class:active={activeTab === "plugins"}
        on:click={() => handleTabClick("plugins")}
    >
        <svg
            class="nav-icon"
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

    <!-- Plugin actions drawer trigger -->
    <button
        class="nav-item"
        class:active={$pluginDrawerOpen}
        on:click={() => pluginDrawerOpen.set(true)}
    >
        <svg
            class="nav-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
        >
            <!-- Bolt / flash icon -->
            <path d="M7 2v11h3v9l7-12h-4l4-8z" />
        </svg>
        <span>Actions</span>
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
        font-weight: 500;
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
