<script lang="ts" generics="T">
    import { onMount, onDestroy, tick } from 'svelte';
    import { isMobile } from '$lib/stores/mobile';
    import Icon from '$lib/components/Icon.svelte';
    import SkeletonCard from '$lib/components/common/SkeletonCard.svelte';

    // Generic type T
    type Item = T;

    // Props
    export let items: Item[] = [];
    export let loading: boolean = false;
    export let skeletonCount: number = 12;
    export let skeletonVariant: 'square' | 'round' = 'square';
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
    export let cardWidthMobile = 150;
    export let gridGapDesktop = 24;
    export let gridGapMobile = 12;
    export let cardHeightDesktop = 260;
    export let cardHeightMobile = 210;
    export let overscan = 2;
    export let padding = 'var(--spacing-md)';
    // Force a fixed column count when containerWidth < columnsBreakpoint (0 = disabled)
    export let columnsBreakpoint = 0;
    export let columnsBelow = 2;

    // Infinite scroll
    export let onLoadMore: (() => Promise<boolean>) | undefined = undefined;
    export let hasMore = true;

    // Scroll Memory
    export let initialScrollTop = 0;
    export let currentScrollTop = 0; // bind:currentScrollTop
    export let externalScroll = false;

    let scrollRestored = false;

    // Responsive values
    let containerWidth = 800;
    let containerHeight = 600;
    let scrollTop = 0;
    let containerElement: HTMLDivElement;
    let scrollParent: HTMLElement | null = null;

    $: isMobileView = $isMobile || (containerWidth > 0 && containerWidth < 600);
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

    // Calculate columns based on container width (compact phones in mobile layout always get 2 columns)
    $: autoColumns = Math.max(1, Math.floor((containerWidth + gridGap) / (cardWidth + gridGap)));
    $: effectiveBreakpoint = columnsBreakpoint > 0 ? columnsBreakpoint : ($isMobile ? 600 : 0);
    $: effectiveColumnsBelow = columnsBreakpoint > 0 ? columnsBelow : 2;
    $: columns = (effectiveBreakpoint > 0 && containerWidth < effectiveBreakpoint) ? effectiveColumnsBelow : autoColumns;

    // Dynamic width of cards to fit exactly 1fr stretching
    $: dynamicCardWidth = columns > 0 ? (containerWidth - (columns - 1) * gridGap) / columns : cardWidth;

    // Dynamically scale card height so 1:1 square cover + meta labels stay proportional
    $: dynamicCardHeight = Math.max(cardHeight, Math.round(dynamicCardWidth + (isMobileView ? 60 : 76)));

    // Each row is dynamicCardHeight + gridGap
    $: ROW_HEIGHT = dynamicCardHeight > 0 ? dynamicCardHeight + gridGap : 1;

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
        visibleRows: [] as any[],
    };

    let visibleItems: { item: T; index: number; key: string | number }[] = [];

    // virtual scrolling
    $: {
        const totalRows = Math.ceil(items.length / columns);
        const totalHeight = totalRows * ROW_HEIGHT;
        
        const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
        const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + overscan);
        
        const startIndex = startRow * columns;
        const endIndex = Math.min(items.length, endRow * columns);
        
        const list: typeof visibleItems = [];
        for (let i = startIndex; i < endIndex; i++) {
            const item = items[i];
            if (item) {
                list.push({
                    item,
                    index: i,
                    key: getItemKey(item),
                });
            }
        }
        visibleItems = list;
        virtualScrollState = { totalHeight, startRow, endRow, offsetY: 0, visibleRows: [] };
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
        if (externalScroll) return;
        scrollTop = (e.target as HTMLElement).scrollTop;
        currentScrollTop = scrollTop;
    }

    function findScrollParent(el: HTMLElement | null): HTMLElement | null {
        let cur = el?.parentElement ?? null;
        while (cur) {
            const style = window.getComputedStyle(cur);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }

    function updateExternalMetrics() {
        if (!externalScroll || !containerElement) return;
        if (!scrollParent) {
            scrollParent = findScrollParent(containerElement);
        }
        if (!scrollParent) {
            containerHeight = containerElement.clientHeight || window.innerHeight;
            scrollTop = 0;
            return;
        }
        const parentRect = scrollParent.getBoundingClientRect();
        const bodyRect = containerElement.getBoundingClientRect();
        const visibleTop = Math.max(0, parentRect.top - bodyRect.top);
        const visibleBottom = Math.max(0, Math.min(bodyRect.height, parentRect.bottom - bodyRect.top));
        scrollTop = visibleTop;
        containerHeight = Math.max(0, visibleBottom - visibleTop);
        currentScrollTop = scrollParent.scrollTop;
    }

    $: if (externalScroll && items.length >= 0) {
        tick().then(updateExternalMetrics);
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

    let allowStagger = true;

    onMount(() => {
        const staggerTimer = setTimeout(() => {
            allowStagger = false;
        }, 550);
        if (!containerElement) return;

        const update = () => {
            if (!containerElement) return;
            const style = window.getComputedStyle(containerElement);
            const paddingLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
            const paddingRight = style ? parseFloat(style.paddingRight) || 0 : 0;
            containerWidth = Math.max(0, containerElement.clientWidth - paddingLeft - paddingRight);
            if (externalScroll) {
                updateExternalMetrics();
            } else {
                containerHeight = Math.max(0, containerElement.clientHeight);
            }
        };

        if (externalScroll) {
            scrollParent = findScrollParent(containerElement);
            scrollParent?.addEventListener('scroll', updateExternalMetrics, { passive: true });
        }

        update();

        if (initialScrollTop > 0) {
            if (externalScroll && scrollParent) {
                scrollParent.scrollTop = initialScrollTop;
                updateExternalMetrics();
            } else {
                containerElement.scrollTop = initialScrollTop;
            }
        }
        scrollRestored = true;

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(update);
            resizeObserver.observe(containerElement);
            if (externalScroll && scrollParent) {
                resizeObserver.observe(scrollParent);
            }
        } else {
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }
    });

    onDestroy(() => {
        scrollParent?.removeEventListener('scroll', updateExternalMetrics);
        scrollParent = null;
        resizeObserver?.disconnect();
        resizeObserver = undefined;
        itemIndexMap.clear();
        containerElement = undefined as any;
    });
</script>

{#if loading}
    <div
        class="virtualized-grid-container skeleton-grid-container"
        style="padding: {padding};"
    >
        <div
            class="skeleton-grid-layout"
            style="
                display: grid;
                grid-template-columns: repeat({columns}, 1fr);
                gap: {gridGap}px;
                width: 100%;
            "
        >
            {#each Array(skeletonCount) as _}
                <div style="height: {dynamicCardHeight}px;">
                    <SkeletonCard variant={skeletonVariant} />
                </div>
            {/each}
        </div>
    </div>
{:else if items.length > 0}
    <div
        class="virtualized-grid-container"
        class:external-scroll={externalScroll}
        style="padding: {padding}; visibility: {scrollRestored || initialScrollTop === 0 ? 'visible' : 'hidden'};"
        on:scroll={handleScroll}
        on:click={handleBodyClick}
        on:contextmenu={handleBodyContextMenu}
        bind:this={containerElement}
    >
        <div
            class="virtual-spacer"
            style="height: {virtualScrollState.totalHeight}px;"
        >
            <div class="virtual-content">
                {#each visibleItems as {item, index, key} (key)}
                    {@const row = Math.floor(index / columns)}
                    {@const col = index % columns}
                    {@const top = row * ROW_HEIGHT}
                    {@const left = col * (dynamicCardWidth + gridGap)}
                    <div
                        class="grid-card"
                        data-item-key={key}
                        style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: {dynamicCardWidth}px;
                            height: {dynamicCardHeight}px;
                            transform: translate3d({left}px, {top}px, 0);
                            --stagger-delay: {Math.min((row + col) * 32, 240)}ms;
                        "
                    >
                        <div class="grid-card-inner" class:stagger-enter={allowStagger && index < 12}>
                            <slot {item} />
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
{:else if emptyStateConfig}
    <div class="empty-state">
        {#if emptyStateConfig.icon && emptyStateConfig.icon.includes('<svg')}
            {@html emptyStateConfig.icon}
        {:else if emptyStateConfig.icon}
            <Icon name={emptyStateConfig.icon} size={48} />
        {/if}
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

    .virtualized-grid-container.external-scroll {
        height: auto;
        overflow: visible;
    }

    .skeleton-grid-container {
        overflow: hidden;
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

    .grid-card {
        cursor: pointer;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transition: width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1),
                    height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
        will-change: transform, width, height;
    }

    .grid-card-inner {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .grid-card-inner.stagger-enter {
        animation: cardWaveIn 0.36s var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)) both;
        animation-delay: var(--stagger-delay, 0ms);
    }

    @keyframes cardWaveIn {
        from {
            opacity: 0;
            transform: translate3d(0, 16px, 0) scale(0.97);
        }
        to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .grid-card-inner.stagger-enter {
            animation: none !important;
        }
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
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .empty-state p {
        font-size: var(--font-size-base);
    }

    .empty-state :global(svg) {
        width: 48px;
        height: 48px;
        fill: currentColor;
    }
</style>