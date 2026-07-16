<script lang="ts">
    import { homeLayout, toggleSection } from "$lib/stores/homeLayout";
    import { createEventDispatcher } from "svelte";
    import { _ } from "svelte-i18n";

    const dispatch = createEventDispatcher<{ close: void }>();

    let dragItemIndex: number | null = null;
    let dragTargetIndex: number | null = null;
    let itemRects: { top: number; bottom: number }[] = [];
    let sectionsListEl: HTMLElement;

    function getSectionDisplayName(id: string): string {
        switch (id) {
            case 'stats': return $_('home.sections.stats');
            case 'pinned': return $_('home.sections.pinned');
            case 'quickplay': return $_('home.sections.quickplay');
            case 'recent': return $_('home.sections.recent');
            case 'continue': return $_('home.sections.continue');
            case 'added': return $_('home.sections.added');
            case 'topTracks': return $_('home.sections.topTracks');
            case 'topAlbums': return $_('home.sections.topAlbums');
            case 'charts': return $_('home.sections.charts');
            default: return id;
        }
    }

    function startDrag(index: number, e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        dragItemIndex = index;
        dragTargetIndex = index;

        if (sectionsListEl) {
            const children = sectionsListEl.children;
            itemRects = [];
            for (let i = 0; i < children.length; i++) {
                const r = children[i].getBoundingClientRect();
                itemRects.push({ top: r.top, bottom: r.bottom });
            }
        }

        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd);
    }

    function onDragMove(e: PointerEvent) {
        if (dragItemIndex === null) return;
        e.preventDefault();

        let target = dragItemIndex;
        for (let i = 0; i < itemRects.length; i++) {
            if (e.clientY < (itemRects[i].top + itemRects[i].bottom) / 2) {
                target = i;
                break;
            }
            target = i;
        }

        if (target !== dragTargetIndex) {
            if (dragTargetIndex !== null) {
                const items = [...$homeLayout];
                const [moved] = items.splice(dragItemIndex, 1);
                items.splice(target, 0, moved);
                homeLayout.set(items);
                dragItemIndex = target;
                if (sectionsListEl) {
                    const children = sectionsListEl.children;
                    itemRects = [];
                    for (let i = 0; i < children.length; i++) {
                        const r = children[i].getBoundingClientRect();
                        itemRects.push({ top: r.top, bottom: r.bottom });
                    }
                }
            }
            dragTargetIndex = target;
        }
    }

    function onDragEnd() {
        document.removeEventListener('pointermove', onDragMove);
        document.removeEventListener('pointerup', onDragEnd);
        dragItemIndex = null;
        dragTargetIndex = null;
        itemRects = [];
    }
</script>

<div class="customize-overlay" on:click={() => dispatch('close')}></div>
<div class="customize-menu" role="dialog" aria-modal="true" aria-label="Customize Home Layout">
    <div class="customize-header">
        <h3>{$_('home.customizeTitle')}</h3>
        <button class="close-btn" on:click={() => dispatch('close')}>&times;</button>
    </div>
    <div class="customize-body">
        <p class="customize-instructions">{$_('home.customizeHint')}</p>
        <div class="sections-list" bind:this={sectionsListEl}>
            {#each $homeLayout as section, i (section.id)}
                <div
                    class="section-item"
                    class:dragging={dragItemIndex === i}
                >
                    <span
                        class="drag-handle"
                        role="button"
                        tabindex="0"
                        on:pointerdown={(e) => startDrag(i, e)}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">
                            <circle cx="9" cy="5" r="1" fill="currentColor"></circle>
                            <circle cx="9" cy="12" r="1" fill="currentColor"></circle>
                            <circle cx="9" cy="19" r="1" fill="currentColor"></circle>
                            <circle cx="15" cy="5" r="1" fill="currentColor"></circle>
                            <circle cx="15" cy="12" r="1" fill="currentColor"></circle>
                            <circle cx="15" cy="19" r="1" fill="currentColor"></circle>
                        </svg>
                    </span>
                    <span class="section-name">{getSectionDisplayName(section.id)}</span>
                    <label class="switch-container">
                        <input
                            type="checkbox"
                            checked={section.visible}
                            on:change={() => toggleSection(section.id)}
                        />
                        <span class="slider"></span>
                    </label>
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .customize-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        z-index: 999;
    }

    .customize-menu {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 420px;
        max-width: 90vw;
        background: #181818;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .customize-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding-bottom: 12px;
    }

    .customize-header h3 {
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    .customize-header .close-btn {
        background: none;
        border: none;
        font-size: 1.5rem;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }

    .customize-header .close-btn:hover {
        color: var(--text-primary);
    }

    .customize-instructions {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin: 0 0 8px 0;
        line-height: 1.4;
    }

    .sections-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 360px;
        overflow-y: auto;
        padding-right: 4px;
    }

    .section-item {
        display: flex;
        align-items: center;
        gap: 12px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 12px 16px;
        cursor: grab;
        transition: all 0.2s ease;
    }

    .section-item:active {
        cursor: grabbing;
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.1);
    }

    .section-item.dragging {
        opacity: 0.4;
        background: rgba(255, 255, 255, 0.1);
        border-color: var(--accent-primary, #1db954);
        transform: scale(0.97);
    }

    .drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        user-select: none;
        touch-action: none;
        cursor: grab;
    }

    .drag-handle:active {
        cursor: grabbing;
    }

    .section-name {
        flex-grow: 1;
        font-weight: 500;
        color: var(--text-primary);
        font-size: var(--font-size-base);
        user-select: none;
    }

    .switch-container {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
    }

    .switch-container input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.1);
        transition: .3s;
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 2px;
        bottom: 2px;
        background-color: white;
        transition: .3s;
        border-radius: 50%;
    }

    input:checked + .slider {
        background-color: var(--accent-primary, #1db954);
    }

    input:checked + .slider:before {
        transform: translateX(20px);
    }
</style>
