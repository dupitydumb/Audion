<script lang="ts">
    import { isWatcherActive } from "$lib/stores/libraryWatcher";
    import Icon from "$lib/components/Icon.svelte";
    import { _ } from "svelte-i18n";
</script>

{#if $isWatcherActive}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="watcher-status" title={$_('sidebar.libraryWatcherActive', { default: 'Updating library…' })}>
        <Icon name="refresh" size={16} className="icon spinning" />
    </div>
{/if}

<style>
    .watcher-status {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
        border-radius: 8px;
        background: transparent;
    }

    .icon {
        width: 15px;
        height: 15px;
        color: var(--text-subdued);
    }

    .spinning {
        animation: spin 1s linear infinite;
        color: var(--accent-primary) !important;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>