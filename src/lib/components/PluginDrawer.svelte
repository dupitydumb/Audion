<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount, onDestroy } from "svelte";
    import { fly, fade } from "svelte/transition";
    import { pluginDrawerOpen } from "$lib/stores/plugin-drawer";
    import { uiSlotManager } from "$lib/plugins/ui-slots";
    import Icon from "$lib/components/Icon.svelte";

    let slotContainer: HTMLDivElement;
    let hasContent = false;

    function close() {
        pluginDrawerOpen.set(false);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
    }

    function registerSlot(node: HTMLElement) {
        uiSlotManager.registerContainer("playerbar:menu", node);
        return {
            destroy() {
                uiSlotManager.unregisterContainer("playerbar:menu");
            },
        };
    }

    // Reactively check if there are slot items
    $: hasContent =
        $pluginDrawerOpen &&
        uiSlotManager.getSlotContent("playerbar:menu").length > 0;

    // Lock body scroll while open
    $: if (typeof document !== "undefined") {
        document.body.style.overflow = $pluginDrawerOpen ? "hidden" : "";
    }

    onMount(() => {
        window.addEventListener("keydown", handleKeydown);
        return () => window.removeEventListener("keydown", handleKeydown);
    });
</script>

{#if $pluginDrawerOpen}
    <!-- Backdrop -->
    <div
        class="drawer-backdrop"
        on:click={close}
        on:keydown={(e) => e.key === "Enter" && close()}
        role="button"
        tabindex="-1"
        aria-label="Close plugin actions"
        transition:fade={{ duration: 200 }}
    ></div>

    <!-- Drawer panel -->
    <div
        class="plugin-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Plugin Actions"
        transition:fly={{ x: 320, duration: 280, opacity: 1 }}
    >
        <div class="drawer-header">
            <div class="drawer-title-row">
                <Icon name="plugin" size={18} className="drawer-icon" />
                <h2 class="drawer-title">{$_('pluginDrawer.title')}</h2>
            </div>
            <button
                class="close-btn"
                on:click={close}
                title={$_('pluginDrawer.closeTitle')}
                aria-label="Close"
            >
                <Icon name="x" size={20} />
            </button>
        </div>

        <div class="drawer-body">
            <!-- Slot container — plugins inject their UI here -->
            <div
                class="slot-container"
                use:registerSlot
                bind:this={slotContainer}
            ></div>

            <!-- Empty state -->
            {#if uiSlotManager.getSlotContent("playerbar:menu").length === 0}
                <div class="empty-state">
                    <Icon name="plugin" size={40} className="empty-icon" />
                    <p class="empty-title">{$_('pluginDrawer.noActions')}</p>
                    <p class="empty-sub">
                        {$_('pluginDrawer.noActionsHint')}
                    </p>
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    .drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        z-index: 1090;
        cursor: pointer;
    }

    .plugin-drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 320px;
        max-width: 90vw;
        background-color: var(--bg-surface);
        border-left: 1px solid var(--border-color);
        box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
        z-index: 1100;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px var(--spacing-lg, 20px) 16px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
        gap: var(--spacing-md, 12px);
    }

    .drawer-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }

    .drawer-icon {
        color: var(--accent-primary);
        flex-shrink: 0;
    }

    .drawer-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.01em;
    }

    .close-btn {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm, 6px);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .close-btn:hover {
        color: var(--text-primary);
        background-color: var(--bg-highlight);
    }

    .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md, 12px);
        -webkit-overflow-scrolling: touch;
    }

    .slot-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs, 6px);
    }

    /* Slot items from plugins should fill width nicely */
    .slot-container :global(*) {
        width: 100%;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px var(--spacing-lg, 20px);
        gap: var(--spacing-sm, 8px);
        text-align: center;
    }

    .empty-icon {
        color: var(--text-subdued);
        opacity: 0.4;
        margin-bottom: 8px;
    }

    .empty-title {
        font-size: 0.9375rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        margin: 0;
    }

    .empty-sub {
        font-size: var(--font-size-sm);
        color: var(--text-subdued);
        margin: 0;
        max-width: 220px;
        line-height: var(--line-height-normal);
    }

    /* Mobile: slide up from bottom instead */
    :global(html.layout-mobile) .plugin-drawer {
        top: auto;
        right: 0;
        left: 0;
        bottom: 0;
        width: 100%;
        max-width: 100%;
        border-left: none;
        border-top: 1px solid var(--border-color);
        border-radius: var(--radius-lg, 12px) var(--radius-lg, 12px) 0 0;
        max-height: 70vh;
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
    }
</style>
