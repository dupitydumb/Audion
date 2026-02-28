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
        if (cardHeight <= 0) console.error('[VirtualizedGrid] Invalid cardHeight:', cardHeight);
        if (cardWidth <= 0) console.error('[VirtualizedGrid] Invalid cardWidth:', cardWidth);
        if (containerWidth <= 0 || containerHeight <= 0)
            console.error('[VirtualizedGrid] Invalid container dimensions:', { containerWidth, containerHeight });
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

            for (let i = 0; i < items.length; i++) {
                try {
                    newMap.set(String(getItemKey(items[i])), i);
                } catch (err) {
                    console.error('[VirtualizedGrid] getItemKey failed at index', i, err);
                    newMap.set(`fallback-${i}`, i);
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
            const rowItems = items.slice(startIdx, Math.min(startIdx + columns, items.length));
            if (rowItems.length > 0) visibleRows.push({ rowIndex, items: rowItems });
        }

        virtualScrollState = { totalHeight, startRow, endRow, offsetY: startRow * ROW_HEIGHT, visibleRows };
    }

    // Shared event delegation (one listener for the whole grid)
    function resolveItem(e: MouseEvent): Item | null {
        let el = e.target as HTMLElement | null;
        while (el && el !== containerElement) {
            const key = el.getAttribute('data-item-key');
            if (key !== null) {
                const idx = itemIndexMap.get(key);
                if (idx !== undefined) return items[idx] ?? null;
                console.warn('[VirtualizedGrid] Key not found in index map:', key);
                return null;
            }
            el = el.parentElement;
        }
        return null;
    }

    function handleBodyClick(e: MouseEvent) {
        if (!onItemClick) return;
        const item = resolveItem(e);
        if (item) {
            try { onItemClick(item, e); }
            catch (err) { console.error('[VirtualizedGrid] onItemClick error:', err); }
        }
    }

    function handleBodyContextMenu(e: MouseEvent) {
        if (!onItemContextMenu) return;
        const item = resolveItem(e);
        if (item) {
            e.preventDefault();
            try { onItemContextMenu(item, e); }
            catch (err) { console.error('[VirtualizedGrid] onItemContextMenu error:', err); }
        }
    }

    function handleScroll(e: Event) {
        scrollTop = (e.target as HTMLElement).scrollTop;
    }

    // Infinite scroll
    let isLoadingMore = false;

    async function loadMoreIfNeeded() {
        if (!onLoadMore || isLoadingMore || !hasMore) return;
        if (scrollTop + containerHeight < virtualScrollState.totalHeight * 0.8) return;
        isLoadingMore = true;
        try {
            hasMore = await onLoadMore();
        } catch (err) {
            console.error('[VirtualizedGrid] loadMore error:', err);
        } finally {
            isLoadingMore = false;
        }
    }

    $: if (scrollTop > 0) loadMoreIfNeeded();

    // ResizeObserver
    let resizeObserver: ResizeObserver | undefined;

    onMount(() => {
        if (!containerElement) return;

        const update = () => {
            containerHeight = containerElement.clientHeight;
            containerWidth = containerElement.clientWidth;
        };
        update();

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(update);
            resizeObserver.observe(containerElement);
        } else {
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        resizeObserver = undefined;
        itemIndexMap.clear();
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
                            <div class="grid-card" data-item-key={getItemKey(item)}>
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