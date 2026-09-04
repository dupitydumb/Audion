<script lang="ts">
    import { _ } from "svelte-i18n";
    import { onMount, onDestroy } from "svelte";
    import { fly, fade } from "svelte/transition";
    import { pluginDrawerOpen } from "$lib/stores/plugin-drawer";
    import { uiSlotManager } from "$lib/plugins/ui-slots";

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
                <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="18"
                    height="18"
                    class="drawer-icon"
                >
                    <path
                        d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                    />
                </svg>
                <h2 class="drawer-title">{$_('pluginDrawer.title')}</h2>
            </div>
            <button
                class="close-btn"
                on:click={close}
                title={$_('pluginDrawer.closeTitle')}
                aria-label="Close"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    width="20"
                    height="20"
                >
                    <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" />
                </svg>
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
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="40"
                        height="40"
                        class="empty-icon"
                    >
                        <path
                            d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"
                        />
                    </svg>
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
