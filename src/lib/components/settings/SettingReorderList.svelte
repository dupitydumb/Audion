<script context="module" lang="ts">
  export type ReorderItem = {
    id: string;
    label: string;
    hint?: string;
    enabled: boolean;
  };
</script>

<script lang="ts">
  import { _ } from "svelte-i18n";
  import Icon from "$lib/components/Icon.svelte";
  import SettingToggle from "./SettingToggle.svelte";
  import { createEventDispatcher } from "svelte";

  export let items: ReorderItem[] = [];
  export let title: string = "Source Priority";
  export let description: string = "Drag to reorder sources or toggle them on and off. Audion searches sources in this order.";

  const dispatch = createEventDispatcher<{
    change: { items: ReorderItem[]; raw: string };
    reset: void;
  }>();

  let draggedIdx: number | null = null;
  let dragOverIdx: number | null = null;

  function emitChange() {
    const raw = items
      .filter((i) => i.enabled)
      .map((i) => i.id)
      .join("/");
    dispatch("change", { items: [...items], raw });
  }

  function moveItem(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const updated = [...items];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    items = updated;
    emitChange();
  }

  function handleToggle(item: ReorderItem, checked: boolean) {
    item.enabled = checked;
    items = [...items];
    emitChange();
  }

  function handleDragStart(e: DragEvent, idx: number) {
    draggedIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", idx.toString());
    }
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    dragOverIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDragLeave(e: DragEvent, idx: number) {
    if (dragOverIdx === idx) {
      dragOverIdx = null;
    }
  }

  function handleDrop(e: DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== targetIdx) {
      moveItem(draggedIdx, targetIdx);
    }
    draggedIdx = null;
    dragOverIdx = null;
  }

  function handleDragEnd() {
    draggedIdx = null;
    dragOverIdx = null;
  }

  function handleReset() {
    dispatch("reset");
  }
</script>

<div class="reorder-container">
  <div class="reorder-header">
    <div class="reorder-header-info">
      <span class="reorder-title">{title}</span>
      <span class="reorder-desc">{description}</span>
    </div>
    <button
      type="button"
      class="reorder-reset-btn"
      on:click={handleReset}
      title={$_('settings.lyricsPriorityResetToDefault', { default: 'Reset to default order' })}
    >
      <Icon name="refresh" size={13} />
      <span>{$_('settings.resetToDefault', { default: 'Reset order' })}</span>
    </button>
  </div>

  <div class="reorder-list" role="list">
    {#each items as item, idx (item.id)}
      <div
        class="reorder-item"
        class:disabled={!item.enabled}
        class:dragging={draggedIdx === idx}
        class:drag-over={dragOverIdx === idx}
        role="listitem"
        on:dragover={(e) => handleDragOver(e, idx)}
        on:dragleave={(e) => handleDragLeave(e, idx)}
        on:drop={(e) => handleDrop(e, idx)}
      >
        <!-- Drag Handle -->
        <div
          class="drag-handle"
          draggable="true"
          on:dragstart={(e) => handleDragStart(e, idx)}
          on:dragend={handleDragEnd}
          title={$_('settings.dragToReorder', { default: 'Drag to reorder' })}
          aria-label={$_('settings.dragToReorder', { default: 'Drag to reorder' })}
        >
          <Icon name="drag-handle" size={16} />
        </div>

        <!-- Priority Rank Number -->
        <span class="item-rank">{idx + 1}</span>

        <!-- Info (Label + Hint) -->
        <div class="item-info">
          <div class="item-label-row">
            <span class="item-label">{item.label}</span>
            <span class="item-id-badge">{item.id}</span>
          </div>
          {#if item.hint}
            <span class="item-hint">{item.hint}</span>
          {/if}
        </div>

        <!-- Reorder Buttons (Accessibility) -->
        <div class="reorder-actions">
          <button
            type="button"
            class="arrow-btn"
            disabled={idx === 0}
            on:click={() => moveItem(idx, idx - 1)}
            aria-label={$_('settings.moveUp', { values: { item: item.label }, default: `Move ${item.label} up` })}
            title={$_('settings.moveUpShort', { default: 'Move up' })}
          >
            <Icon name="arrow-up" size={13} />
          </button>
          <button
            type="button"
            class="arrow-btn"
            disabled={idx === items.length - 1}
            on:click={() => moveItem(idx, idx + 1)}
            aria-label={$_('settings.moveDown', { values: { item: item.label }, default: `Move ${item.label} down` })}
            title={$_('settings.moveDownShort', { default: 'Move down' })}
          >
            <Icon name="arrow-down" size={13} />
          </button>
        </div>

        <!-- Enable / Disable Toggle -->
        <div class="item-toggle-wrap">
          <SettingToggle
            checked={item.enabled}
            label={$_('settings.toggleSource', { values: { name: item.label }, default: `Enable ${item.label}` })}
            on:change={(e) => handleToggle(item, e.detail)}
          />
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .reorder-container {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .reorder-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-color);
  }

  .reorder-header-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 60ch;
  }

  .reorder-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .reorder-desc {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .reorder-reset-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .reorder-reset-btn:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
    border-color: var(--border-color-hover, var(--text-secondary));
  }

  .reorder-list {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .reorder-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color);
    background: transparent;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
  }

  .reorder-item:last-child {
    border-bottom: none;
  }

  .reorder-item.disabled {
    opacity: 0.45;
  }

  .reorder-item.dragging {
    opacity: 0.25;
    background: var(--bg-highlight);
  }

  .reorder-item.drag-over {
    border-top: 2px solid var(--accent-primary);
    background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
    cursor: grab;
    padding: 4px;
    border-radius: 4px;
    user-select: none;
    transition: color var(--transition-fast);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .drag-handle:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
  }

  .item-rank {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-subdued);
    width: 18px;
    text-align: center;
    flex-shrink: 0;
  }

  .item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .item-label-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .item-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .item-id-badge {
    font-size: 11px;
    font-family: monospace;
    color: var(--text-subdued);
    background: var(--bg-base);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
  }

  .item-hint {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.3;
  }

  .reorder-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .arrow-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .arrow-btn:hover:not(:disabled) {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .arrow-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .item-toggle-wrap {
    flex-shrink: 0;
    margin-left: 4px;
  }
</style>

