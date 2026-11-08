<script lang="ts">
  import { _ } from "svelte-i18n";
  import Icon from "$lib/components/Icon.svelte";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  export let title: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ toggle: boolean }>();

  function handleToggle() {
    open = !open;
    dispatch("toggle", open);
  }
</script>

<div class="advanced-group">
  <button
    type="button"
    class="advanced-trigger"
    on:click={handleToggle}
    aria-expanded={open}
  >
    <Icon
      name="chevron-right"
      size={14}
      className="advanced-chevron {open ? 'rotated' : ''}"
    />
    <span class="advanced-title">
      {title ?? $_('settings.advanced', { default: 'Advanced' })}
    </span>
  </button>

  {#if open}
    <div class="advanced-body" transition:slide|local={{ duration: 180 }}>
      <slot />
    </div>
  {/if}
</div>

<style>
  .advanced-group {
    margin-top: 16px;
    width: 100%;
  }

  .advanced-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: none;
    border: none;
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--transition-fast), background-color var(--transition-fast);
    user-select: none;
  }

  .advanced-trigger:hover {
    color: var(--text-primary);
    background-color: var(--bg-surface);
  }

  .advanced-trigger:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .advanced-trigger :global(.advanced-chevron) {
    transition: transform 0.18s ease;
  }

  .advanced-trigger :global(.advanced-chevron.rotated) {
    transform: rotate(90deg);
  }

  .advanced-body {
    margin-top: 8px;
  }
</style>

