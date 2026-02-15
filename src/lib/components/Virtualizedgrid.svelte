<script lang="ts" generics="T">
    import { onMount, onDestroy } from 'svelte';

    // Generic type T
    type Item = T;

    // Props
    export let items: Item[] = [];
    export let getItemKey: (item: Item) => string | number = (item: any) => item.id;
    export let onItemClick: ((item: Item, event: MouseEvent) => void) | undefined = undefined;
    export let onItemContextMenu: ((item: Item, event: MouseEvent) => void) | undefined = undefined;
    export let emptyStateConfig: {
        icon: string;
        title: string;
        description: string;
    } | undefined = undefined;

    // Virtual scrolling configuration
    export let cardWidthDesktop = 180;
    export let cardWidthMobile = 140;
    export let gridGapDesktop = 24;
    export let gridGapMobile = 8;
    export let cardHeightDesktop = 260;
    export let cardHeightMobile = 210;
    export let overscan = 2;
    export let padding = 'var(--spacing-md)';

    // Infinite scroll
    export let onLoadMore: (() => Promise<boolean>) | undefined = undefined;
    export let hasMore = true;

    // Responsive values
    let containerWidth = 800;
    let containerHeight = 600;
    let scrollTop = 0;
    let containerElement: HTMLDivElement;

    $: isMobileView = containerWidth > 0 && containerWidth < 600;
    $: cardWidth = isMobileView ? cardWidthMobile : cardWidthDesktop;
    $: gridGap = isMobileView ? gridGapMobile : gridGapDesktop;
    $: cardHeight = isMobileView ? cardHeightMobile : cardHeightDesktop;

    // Validate dimensions
    $: {
        if (cardHeight <= 0) {
            console.error('[VirtualizedGrid] Invalid cardHeight:', cardHeight, '- must be > 0');
        }
        if (cardWidth <= 0) {
            console.error('[VirtualizedGrid] Invalid cardWidth:', cardWidth, '- must be > 0');
        }
        if (containerWidth < 0 || containerHeight < 0) {
            console.error('[VirtualizedGrid] Invalid container dimensions:', { containerWidth, containerHeight });
        }
    }

    // Calculate columns based on container width
    $: columns = Math.max(1, Math.floor((containerWidth - (gridGap * 2) + gridGap) / (cardWidth + gridGap)));

    // Each row is cardHeight + gridGap
    $: ROW_HEIGHT = cardHeight > 0 ? cardHeight + gridGap : 1;

    // Group items into rows
    type ItemRow = {
        rowIndex: number;
        items: Item[];
    };

    // index map
    let itemIndexMap = new Map<string, number>();
    let lastItemsReference: Item[] | undefined = undefined;
    
    $: {
        // Only rebuild if items reference actually changed
        if (items !== lastItemsReference) {
            lastItemsReference = items;
            const newMap = new Map<string, number>();
            
            for (let idx = 0; idx < items.length; idx++) {
                try {
                    const key = String(getItemKey(items[idx]));
                    newMap.set(key, idx);
                } catch (error) {
                    console.error('[VirtualizedGrid] getItemKey failed for item at index', idx, error);
                    // fallback
                    newMap.set(`fallback-${idx}`, idx);
                }
            }
            
            itemIndexMap = newMap;
        }
    }

    let virtualScrollState = {
        totalHeight: 0,
        startRow: 0,
        endRow: 0,
        offsetY: 0,
        visibleRows: [] as ItemRow[],
    };

    // virtual scrolling
    $: {
        const totalRows = Math.ceil(items.length / columns);
        const totalHeight = totalRows * ROW_HEIGHT;
        
        const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + overscan);
        
        const visibleRows: ItemRow[] = [];
        for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
            const startIdx = rowIndex * columns;
            const endIdx = Math.min(startIdx + columns, items.length);
            const rowItems = items.slice(startIdx, endIdx);
            if (rowItems.length > 0) {
                visibleRows.push({ rowIndex, items: rowItems });
            }
        }
        
        const offsetY = startRow * ROW_HEIGHT;

        virtualScrollState = {
            totalHeight,
            startRow,
            endRow,
            offsetY,
            visibleRows,
        };
    }

    // Event handlers
    function handleBodyClick(e: MouseEvent) {
        if (!onItemClick) return;

        const target = e.target as HTMLElement;
        
        let element: HTMLElement | null = target;
        let itemKey: string | null = null;
        
        while (element && element !== containerElement) {
            itemKey = element.getAttribute('data-item-key');
            if (itemKey) break;
            element = element.parentElement;
        }
        
        if (!itemKey) return;

        // Use index map
        const itemIndex = itemIndexMap.get(itemKey);
        if (itemIndex === undefined) {
            console.warn('[VirtualizedGrid] Item key not found in index map:', itemKey);
            return;
        }
        
        const item = items[itemIndex];
        if (!item) {
            console.warn('[VirtualizedGrid] Item not found at index:', itemIndex);
            return;
        }

        try {
            onItemClick(item, e);
        } catch (error) {
            console.error('[VirtualizedGrid] onItemClick handler error:', error);
        }
    }

    function handleBodyContextMenu(e: MouseEvent) {
        if (!onItemContextMenu) return;

        const target = e.target as HTMLElement;
        
        let element: HTMLElement | null = target;
        let itemKey: string | null = null;
        
        while (element && element !== containerElement) {
            itemKey = element.getAttribute('data-item-key');
            if (itemKey) break;
            element = element.parentElement;
        }
        
        if (!itemKey) return;

        e.preventDefault();

        // Use index map
        const itemIndex = itemIndexMap.get(itemKey);
        if (itemIndex === undefined) {
            console.warn('[VirtualizedGrid] Item key not found in index map:', itemKey);
            return;
        }
        
        const item = items[itemIndex];
        if (!item) {
            console.warn('[VirtualizedGrid] Item not found at index:', itemIndex);
            return;
        }

        try {
            onItemContextMenu(item, e);
        } catch (error) {
            console.error('[VirtualizedGrid] onItemContextMenu handler error:', error);
        }
    }

    // Scroll handler
    function handleScroll(e: Event) {
        const target = e.target as HTMLElement;
        scrollTop = target.scrollTop;
    }

    // Infinite scroll
    let isLoadingMore = false;

    async function loadMoreIfNeeded() {
        if (!onLoadMore || isLoadingMore || !hasMore) return;

        const threshold = virtualScrollState.totalHeight * 0.8;
        if (scrollTop + containerHeight < threshold) return;

        isLoadingMore = true;
        try {
            const loaded = await onLoadMore();
            hasMore = loaded;
        } catch (error) {
            console.error('[VirtualizedGrid] Failed to load more items:', error);
            // Don't set hasMore to false on error - allow retry
        } finally {
            isLoadingMore = false;
        }
    }

    $: {
        if (scrollTop > 0) {
            loadMoreIfNeeded();
        }
    }

    // Resize observer
    let resizeObserver: ResizeObserver | undefined;

    onMount(() => {
        if (containerElement) {
            const updateDimensions = () => {
                containerHeight = containerElement.clientHeight;
                containerWidth = containerElement.clientWidth;
            };
            updateDimensions();

            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(updateDimensions);
                resizeObserver.observe(containerElement);
            } else {
                window.addEventListener("resize", updateDimensions);
                return () => {
                    window.removeEventListener("resize", updateDimensions);
                };
            }
        }
    });

    onDestroy(() => {
        if (containerElement) {
            // Clean up images
            const images = containerElement.querySelectorAll('img');
            images.forEach(img => {
                img.src = '';
            });
        }

        // Clear index map
        itemIndexMap.clear();

        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = undefined;
        }

        containerElement = undefined as any;
    });
</script>

{#if items.length > 0}
    <div
        class="virtualized-grid-container"
        style="padding: {padding};"
        on:scroll={handleScroll}
        on:click={handleBodyClick}
        on:contextmenu={handleBodyContextMenu}
        bind:this={containerElement}
    >
        <div
            class="virtual-spacer"
            style="height: {virtualScrollState.totalHeight}px;"
        >
            <div
                class="virtual-content"
                style="transform: translateY({virtualScrollState.offsetY}px);"
            >
                {#each virtualScrollState.visibleRows as row (row.rowIndex)}
                    <div 
                        class="grid-row" 
                        style="
                            height: {cardHeight}px;
                            margin-bottom: {gridGap}px;
                            grid-template-columns: repeat({columns}, 1fr);
                            gap: {gridGap}px;
                        "
                    >
                        {#each row.items as item (getItemKey(item))}
                            <div
                                class="grid-card"
                                data-item-key={getItemKey(item)}
                                role="button"
                                tabindex="0"
                            >
                                <slot {item} />
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>
        </div>
    </div>
{:else if emptyStateConfig}
    <div class="empty-state">
        {@html emptyStateConfig.icon}
        <h3>{emptyStateConfig.title}</h3>
        <p>{emptyStateConfig.description}</p>
    </div>
{/if}

<style>
    .virtualized-grid-container {
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        will-change: scroll-position;
        scroll-behavior: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
    }

    .virtual-spacer {
        position: relative;
        width: 100%;
    }

    .virtual-content {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        will-change: transform;
    }

    /* Each row is a container with its own grid */
    .grid-row {
        display: grid;
        width: 100%;
        box-sizing: border-box;
    }

    .grid-card {
        cursor: pointer;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-subdued);
        text-align: center;
        gap: var(--spacing-sm);
        height: 100%;
    }

    .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: 0.875rem;
    }

    .empty-state :global(svg) {
        width: 48px;
        height: 48px;
        fill: currentColor;
    }
</style>