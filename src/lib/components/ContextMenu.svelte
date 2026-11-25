<script lang="ts">
    import { contextMenu, type ContextMenuItem } from "$lib/stores/ui";
    import { fade } from "svelte/transition";
    import { onMount, onDestroy, tick } from "svelte";
    import { isMobile, registerBackHandler } from "$lib/stores/mobile";
    import Icon from "$lib/components/Icon.svelte";

    let menuElement: HTMLDivElement;
    let activeSubmenu: string | null = null;
    let adjustedX = 0;
    let adjustedY = 0;

    // Mobile swipe-to-dismiss state
    let dragY = 0;
    let isDraggingSheet = false;
    let touchStartY = 0;
    let touchStartX = 0;
    let forceHandleDrag = false;

    let unregisterBack: (() => void) | null = null;
    $: if ($contextMenu.visible && !unregisterBack) {
        unregisterBack = registerBackHandler(() => {
            closeMenu();
            return true;
        });
    } else if (!$contextMenu.visible && unregisterBack) {
        unregisterBack();
        unregisterBack = null;
    }

    // Reactively update position when menu becomes visible or coordinates change
    $: if (
        $contextMenu.visible &&
        $contextMenu.x !== undefined &&
        $contextMenu.y !== undefined
    ) {
        updatePosition();
    }

    async function updatePosition() {
      await tick();
      if (!menuElement) return;
  
      const { x, y } = $contextMenu;
      const { innerWidth, innerHeight } = window;
      const rect = menuElement.getBoundingClientRect();
  
      let newX = x + rect.width > innerWidth ? innerWidth - rect.width - 8 : x;
      let newY = y + rect.height > innerHeight ? innerHeight - rect.height - 8 : y;
  
      adjustedX = Math.max(8, newX);
      adjustedY = Math.max(8, newY);
    }

    // Close on click outside
    function handleClickOutside(event: MouseEvent) {
      if ($contextMenu.visible && menuElement && !menuElement.contains(event.target as Node)) {
        closeMenu();
      }
    }

    // Close on any click (item selection)
    function handleItemClick(action: () => void) {
        action();
        closeMenu();
    }

    function closeMenu() {
        dragY = 0;
        isDraggingSheet = false;
        contextMenu.update((m) => ({ ...m, visible: false }));
        activeSubmenu = null;
    }

    function handleSubmenuHover(label: string | null) {
        activeSubmenu = label;
    }

    function handleSheetTouchStart(e: TouchEvent, fromHandle = false) {
        if (!$isMobile || e.touches.length !== 1) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        dragY = 0;
        forceHandleDrag = fromHandle;
        isDraggingSheet = true;
    }

    function handleSheetTouchMove(e: TouchEvent) {
        if (!$isMobile || !isDraggingSheet || e.touches.length !== 1) return;
        if (!forceHandleDrag && menuElement && menuElement.scrollTop > 1) {
            dragY = 0;
            return;
        }
        const dy = e.touches[0].clientY - touchStartY;
        const dx = e.touches[0].clientX - touchStartX;
        if (dragY === 0 && (Math.abs(dx) > Math.abs(dy) || dy < 6)) {
            return;
        }
        dragY = Math.max(0, dy);
    }

    function handleSheetTouchEnd() {
        if (!isDraggingSheet) return;
        isDraggingSheet = false;
        forceHandleDrag = false;
        if (dragY > 70) {
            closeMenu();
            return;
        }
        dragY = 0;
    }
  
    onMount(() => {
        window.addEventListener("click", handleClickOutside);
        return () => window.removeEventListener("click", handleClickOutside);
    });

    onDestroy(() => {
        if (unregisterBack) {
            unregisterBack();
            unregisterBack = null;
        }
    });
  
    function isSeparator(item: ContextMenuItem | { type: "separator" }): item is { type: "separator" } {
      return item.type === "separator";
    }
</script>

{#if $contextMenu.visible}
    <!-- Backdrop for mobile -->
    {#if $isMobile}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="context-menu-backdrop"
            on:click={closeMenu}
            transition:fade={{ duration: 200 }}
            role="presentation"
        ></div>
    {/if}

    <div
        class="context-menu"
        bind:this={menuElement}
        style={$isMobile
            ? (dragY > 0 ? `transform: translate3d(0, ${dragY}px, 0); transition: none;` : "")
            : `top: ${adjustedY}px; left: ${adjustedX}px;`}
        on:touchstart={(e) => handleSheetTouchStart(e, false)}
        on:touchmove={handleSheetTouchMove}
        on:touchend={handleSheetTouchEnd}
        on:touchcancel={handleSheetTouchEnd}
        transition:fade={{ duration: 100 }}
    >
        {#if $isMobile}
            <div
                class="mobile-handle-zone"
                on:touchstart|stopPropagation={(e) => handleSheetTouchStart(e, true)}
                on:touchmove|stopPropagation={handleSheetTouchMove}
                on:touchend|stopPropagation={handleSheetTouchEnd}
                on:touchcancel|stopPropagation={handleSheetTouchEnd}
                role="presentation"
            >
                <div class="mobile-handle"></div>
            </div>
        {/if}

        {#each $contextMenu.items as item}
            {#if isSeparator(item)}
                <div class="menu-separator"></div>
            {:else if item.submenu}
                <div
                    class="menu-item has-submenu"
                    class:active={activeSubmenu === item.label}
                    on:mouseenter={() =>
                        !$isMobile && handleSubmenuHover(item.label)}
                    on:mouseleave={() => !$isMobile && handleSubmenuHover(null)}    
                    on:click={() =>
                        $isMobile &&
                        handleSubmenuHover(
                            item.label === activeSubmenu ? null : item.label,
                        )}
                    on:keydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSubmenuHover(
                                item.label === activeSubmenu ? null : item.label,
                            );
                        }
                    }}
                    role="menuitem"
                    tabindex="0"
                >
                    <span class="menu-item-icon">
                        {#if item.icon}
                            <Icon name={item.icon} size={14} />
                        {/if}
                    </span>
                    <span class="menu-item-label">{item.label}</span>
                    <Icon
                        name={$isMobile && activeSubmenu === item.label ? "chevron-down" : "chevron-right"}
                        size={14}
                    />
                    {#if activeSubmenu === item.label}
                        <div
                            class="submenu"
                            transition:fade={{ duration: 100 }}
                        >
                            {#each item.submenu as subitem}
                                {#if subitem.type !== 'separator'}
                                    <button
                                        class="menu-item"
                                        class:disabled={subitem.disabled}
                                        disabled={subitem.disabled}
                                        on:click|stopPropagation={() =>
                                            !subitem.disabled &&
                                            subitem.action &&
                                            handleItemClick(subitem.action)}
                                    >
                                        <span class="menu-item-icon">
                                            {#if subitem.icon}
                                                <Icon name={subitem.icon} size={14} />
                                            {/if}
                                        </span>
                                        <span class="menu-item-label">{subitem.label}</span>
                                    </button>
                                {/if}
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
                    <span class="menu-item-icon">
                        {#if item.icon}
                            <Icon name={item.icon} size={14} />
                        {/if}
                    </span>
                    <span class="menu-item-label">{item.label}</span>
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
        z-index: var(--z-sheet, 3000);
        display: flex;
        flex-direction: column;
    }

    .menu-item {
        text-align: left;
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-base);
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
    }

    .menu-item-icon {
        width: 14px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subdued);
    }

    .menu-item-label {
        flex: 1;
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
        font-size: var(--font-size-base);
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);
        gap: var(--spacing-sm);
        width: 100%;
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

    /* ── Mobile ── */
    :global(html.layout-mobile) .context-menu-backdrop {
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(2px);
        z-index: var(--z-sheet, 3000);
    }

    :global(html.layout-mobile) .context-menu {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        top: auto;
        width: 100%;
        min-width: 100%;
        max-width: 100%;
        max-height: 75dvh;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-top-left-radius: 16px;
        border-top-right-radius: 16px;
        padding: var(--spacing-sm);
        padding-bottom: calc(16px + var(--safe-area-bottom, 0px));
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
        border: none;
        border-top: 1px solid var(--border-color);
        z-index: var(--z-sheet, 3000);
        transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    :global(html.layout-mobile) .mobile-handle-zone {
        padding: 8px 0 12px;
        display: flex;
        justify-content: center;
        cursor: grab;
        flex-shrink: 0;
    }

    :global(html.layout-mobile) .mobile-handle {
        width: 40px;
        height: 4px;
        background-color: var(--bg-highlight);
        border-radius: var(--radius-full);
    }

    :global(html.layout-mobile) .menu-item,
    :global(html.layout-mobile) .menu-item.has-submenu {
        padding: var(--spacing-md);
        font-size: var(--font-size-md);
        min-height: 48px;
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        border-radius: var(--radius-md);
    }

    :global(html.layout-mobile) .menu-item.has-submenu {
        flex-wrap: wrap;
    }

    :global(html.layout-mobile) .menu-item-icon {
        width: 18px;
    }

    :global(html.layout-mobile) .submenu {
        position: static;
        width: 100%;
        flex-basis: 100%;
        margin-top: var(--spacing-xs);
        margin-left: 0;
        padding: 0 0 0 var(--spacing-md);
        border: none;
        background-color: transparent;
        box-shadow: none;
        max-height: none;
    }
</style>
