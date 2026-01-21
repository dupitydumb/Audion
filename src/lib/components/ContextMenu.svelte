<script lang="ts">
    import { contextMenu, type ContextMenuItem } from "$lib/stores/ui";
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";

    import { tick } from "svelte";

    let menuElement: HTMLDivElement;
    let activeSubmenu: string | null = null;
    let adjustedX = 0;
    let adjustedY = 0;

    // Reactively update position when menu becomes visible or coordinates change
    $: if (
        $contextMenu.visible &&
        $contextMenu.x !== undefined &&
        $contextMenu.y !== undefined
    ) {
        updatePosition();
    }

    async function updatePosition() {
        // Wait for DOM to update so we can measure dimensions
        await tick();

        if (!menuElement) return;

        const { x, y } = $contextMenu;
        const { innerWidth, innerHeight } = window;
        const rect = menuElement.getBoundingClientRect();

        let newX = x;
        let newY = y;

        // Check right edge
        if (x + rect.width > innerWidth) {
            newX = innerWidth - rect.width - 8; // 8px padding
        }

        // Check bottom edge
        if (y + rect.height > innerHeight) {
            newY = innerHeight - rect.height - 8;
        }

        // Check left edge
        if (newX < 8) {
            newX = 8;
        }

        // Check top edge
        if (newY < 8) {
            newY = 8;
        }

        adjustedX = newX;
        adjustedY = newY;
    }

    // Close on click outside
    function handleClickOutside(event: MouseEvent) {
        if (
            $contextMenu.visible &&
            menuElement &&
            !menuElement.contains(event.target as Node)
        ) {
            contextMenu.update((m) => ({ ...m, visible: false }));
            activeSubmenu = null;
        }
    }

    // Close on any click (item selection)
    function handleItemClick(action: () => void) {
        action();
        contextMenu.update((m) => ({ ...m, visible: false }));
        activeSubmenu = null;
    }

    function handleSubmenuHover(label: string) {
        activeSubmenu = label;
    }

    function handleSubmenuLeave() {
        // Delay to allow moving to submenu
        setTimeout(() => {
            // Only clear if still no hover
        }, 100);
    }

    onMount(() => {
        window.addEventListener("click", handleClickOutside);
        return () => window.removeEventListener("click", handleClickOutside);
    });

    // Type guard for separator
    function isSeparator(
        item: ContextMenuItem | { type: "separator" },
    ): item is { type: "separator" } {
        return (
            "type" in item && item.type === "separator" && !("label" in item)
        );
    }
</script>

{#if $contextMenu.visible}
    <div
        class="context-menu"
        bind:this={menuElement}
        style="top: {adjustedY}px; left: {adjustedX}px;"
        transition:fade={{ duration: 100 }}
    >
        {#each $contextMenu.items as item}
            {#if isSeparator(item)}
                <div class="menu-separator"></div>
            {:else if item.submenu}
                <div
                    class="menu-item has-submenu"
                    class:active={activeSubmenu === item.label}
                    on:mouseenter={() => handleSubmenuHover(item.label)}
                    role="menuitem"
                    tabindex="0"
                >
                    <span>{item.label}</span>
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="14"
                        height="14"
                    >
                        <path
                            d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
                        />
                    </svg>
                    {#if activeSubmenu === item.label}
                        <div
                            class="submenu"
                            transition:fade={{ duration: 100 }}
                        >
                            {#each item.submenu as subitem}
                                <button
                                    class="menu-item"
                                    class:disabled={subitem.disabled}
                                    disabled={subitem.disabled}
                                    on:click|stopPropagation={() =>
                                        !subitem.disabled &&
                                        subitem.action &&
                                        handleItemClick(subitem.action)}
                                >
                                    {subitem.label}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {:else}
                <button
                    class="menu-item"
                    class:danger={item.danger}
                    class:disabled={item.disabled}
                    disabled={item.disabled}
                    on:click|stopPropagation={() =>
                        !item.disabled &&
                        item.action &&
                        handleItemClick(item.action)}
                >
                    {item.label}
                </button>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .context-menu {
        position: fixed;
        background-color: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--spacing-xs);
        min-width: 160px;
        box-shadow: var(--shadow-md);
        z-index: 9999;
        display: flex;
        flex-direction: column;
    }

    .menu-item {
        text-align: left;
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 0.875rem;
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
    }

    .menu-item:hover {
        background-color: var(--bg-highlight);
    }

    .menu-item.danger {
        color: var(--error-color);
    }

    .menu-item.danger:hover {
        background-color: rgba(241, 94, 108, 0.1);
    }

    .menu-item.disabled {
        color: var(--text-subdued);
        cursor: not-allowed;
    }

    .menu-item.disabled:hover {
        background-color: transparent;
    }

    .menu-separator {
        height: 1px;
        background-color: var(--border-color);
        margin: var(--spacing-xs) 0;
    }

    .menu-item.has-submenu {
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        cursor: default;
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 0.875rem;
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
    }

    .menu-item.has-submenu:hover,
    .menu-item.has-submenu.active {
        background-color: var(--bg-highlight);
    }

    .submenu {
        position: absolute;
        left: 100%;
        top: 0;
        min-width: 160px;
        max-height: 300px;
        overflow-y: auto;
        background-color: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--spacing-xs);
        box-shadow: var(--shadow-md);
        display: flex;
        flex-direction: column;
    }
</style>
