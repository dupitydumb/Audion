<script lang="ts">
  export let id: string | undefined = undefined;
  export let label: string;
  export let description: string | undefined = undefined;
  export let disabled: boolean = false;
  export let disabledReason: string | undefined = undefined;
  export let danger: boolean = false;
</script>

<div
  class="setting-row"
  class:disabled
  class:danger
  {id}
>
  <div class="setting-row-info">
    <span class="setting-row-label">
      {label}
    </span>
    {#if description || (disabled && disabledReason)}
      <span class="setting-row-desc">
        {disabled && disabledReason ? disabledReason : description}
      </span>
    {/if}
  </div>
  <div class="setting-row-control">
    <slot />
  </div>
</div>

<style>
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-color);
    min-height: 52px;
    background: transparent;
    transition: background-color var(--transition-fast);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .setting-row.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .setting-row.danger .setting-row-label {
    color: var(--color-error, #ef4444);
  }

  .setting-row-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 60ch;
    flex: 1;
    min-width: 0;
  }

  .setting-row-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    margin: 0;
    user-select: text;
  }

  .setting-row-desc {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
    user-select: text;
  }

  .setting-row-control {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-height: 44px;
  }

  @media (max-width: 480px) {
    .setting-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
    }

    .setting-row-control {
      width: 100%;
      justify-content: flex-end;
      min-height: auto;
    }
  }
</style>

