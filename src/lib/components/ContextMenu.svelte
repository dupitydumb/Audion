<script lang="ts">
    import { contextMenu, type ContextMenuItem } from "$lib/stores/ui";
    import { onMount, onDestroy, tick } from "svelte";
    import { isMobile, registerBackHandler } from "$lib/stores/mobile";
    import {
        modalBackdropTransition,
        popoverInTransition,
        popoverOutTransition,
        sheetInTransition,
        sheetOutTransition,
        submenuInTransition,
        submenuOutTransition,
    } from "$lib/motion";

    function sheetIn(node: Element) {
        return $isMobile ? sheetInTransition(node) : popoverInTransition(node);
    }

    function sheetOut(node: Element) {
        return $isMobile ? sheetOutTransition(node) : popoverOutTransition(node);
    }
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
      const { x, y } = $contextMenu;
      adjustedX = Math.max(8, x ?? 0);
      adjustedY = Math.max(8, y ?? 0);
      await tick();
      if (!menuElement) return;
  
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
        touchStartTime = Date.now();
        forceHandleDrag = fromHandle;
        isDraggingSheet = true;
    }

    let touchStartTime = 0;

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
        const elapsed = Date.now() - touchStartTime;
        const velocity = dragY / Math.max(1, elapsed);

        if (dragY > 70 || (dragY > 25 && velocity > 0.45)) {
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
            class:mobile-menu-backdrop={$isMobile}
            on:click={closeMenu}
            transition:modalBackdropTransition
            role="presentation"
        ></div>
    {/if}

    {#key $isMobile ? "mobile" : `${$contextMenu.x}-${$contextMenu.y}`}
    <div
        class="context-menu"
        class:mobile-menu-sheet={$isMobile}
        bind:this={menuElement}
        style={$isMobile
            ? (dragY > 0 ? `transform: translate3d(0, ${dragY}px, 0); transition: none;` : "transform: translate3d(0, 0, 0);")
            : `top: ${adjustedY}px; left: ${adjustedX}px;`}
        on:touchstart={(e) => handleSheetTouchStart(e, false)}
        on:touchmove={handleSheetTouchMove}
        on:touchend={handleSheetTouchEnd}
        on:touchcancel={handleSheetTouchEnd}
        in:sheetIn
        out:sheetOut
    >
        {#if $isMobile}
            <div
                class="sheet-handle-zone"
                on:touchstart|stopPropagation={(e) => handleSheetTouchStart(e, true)}
                on:touchmove|stopPropagation={handleSheetTouchMove}
                on:touchend|stopPropagation={handleSheetTouchEnd}
                on:touchcancel|stopPropagation={handleSheetTouchEnd}
                role="presentation"
            >
                <div class="sheet-handle"></div>
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
                            in:submenuInTransition
                            out:submenuOutTransition
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
    {/key}
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
        transform-origin: top left;
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

    /* ── Mobile (uses shared .mobile-menu-backdrop / .mobile-menu-sheet from app.css) ── */
    :global(html.layout-mobile) .context-menu.mobile-menu-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        top: auto;
        margin: 0 auto;
        min-width: 0;
        padding: 0 var(--spacing-sm) calc(16px + var(--safe-area-bottom, 0px));
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
        transition: background-color var(--transition-fast),
                    transform 120ms var(--ease-spring-snappy);
    }

    :global(html.layout-mobile) .menu-item:active {
        transform: scale(0.98);
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
