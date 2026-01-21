<script lang="ts">
    import { currentView } from "$lib/stores/view";
    import { playlists, albums } from "$lib/stores/library";

    $: items = getBreadcrumbs($currentView);

    function getBreadcrumbs(view: any) {
        const base = [{ label: "Library", path: null }];

        switch (view.type) {
            case "tracks":
                return [...base, { label: "All Tracks", path: null }];
            case "albums":
                return [...base, { label: "Albums", path: null }];
            case "album-detail": {
                const album = $albums.find((a) => a.id === view.id);
                return [
                    ...base,
                    { label: "Albums", path: "albums" },
                    { label: album ? album.name : "Album", path: null },
                ];
            }
            case "artists":
                return [...base, { label: "Artists", path: null }];
            case "artist-detail":
                return [
                    ...base,
                    { label: "Artists", path: "artists" },
                    { label: view.name || "Unknown Artist", path: null },
                ];
            case "playlists":
                return [...base, { label: "Playlists", path: null }];
            case "playlist-detail": {
                const playlist = $playlists.find((p) => p.id === view.id);
                return [
                    ...base,
                    { label: "Playlists", path: "playlists" },
                    {
                        label: playlist ? playlist.name : "Playlist",
                        path: null,
                    },
                ];
            }
            case "plugins":
                return [
                    { label: "Settings", path: null },
                    { label: "Plugins", path: null },
                ];
            case "settings":
                return [{ label: "Settings", path: null }];
            default:
                return base;
        }
    }
</script>

<div class="breadcrumbs">
    {#each items as item, i}
        {#if i > 0}
            <span class="separator">/</span>
        {/if}
        <span class="item" class:last={i === items.length - 1}>
            {item.label}
        </span>
    {/each}
</div>

<style>
    .breadcrumbs {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-left: 12px;
        max-width: 300px;
    }

    .item {
        transition: color 0.2s;
    }

    .item.last {
        color: var(--text-primary);
        font-weight: 500;
    }

    .separator {
        color: var(--text-subdued);
        opacity: 0.5;
    }
</style>
