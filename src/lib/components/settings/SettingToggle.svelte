<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let checked: boolean = false;
  export let label: string;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ change: boolean }>();

  function handleToggle() {
    if (disabled) return;
    checked = !checked;
    dispatch("change", checked);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleToggle();
    }
  }
</script>

<button
  type="button"
  class="setting-toggle-btn"
  class:active={checked}
  class:disabled
  on:click={handleToggle}
  on:keydown={handleKeydown}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  tabindex={disabled ? -1 : 0}
>
  <span class="setting-toggle-handle"></span>
</button>

<style>
  .setting-toggle-btn {
    position: relative;
    width: 44px;
    height: 24px;
    min-width: 44px;
    min-height: 24px;
    background-color: var(--bg-highlight, var(--surface-subtle, rgba(255, 255, 255, 0.15)));
    border-radius: 12px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    padding: 0;
    transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .setting-toggle-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .setting-toggle-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .setting-toggle-btn.active {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .setting-toggle-handle {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background-color: #ffffff;
    border-radius: 50%;
    transform-origin: left center;
    transition: transform 220ms var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)),
                background-color 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .setting-toggle-btn.active .setting-toggle-handle {
    animation: knob-on 220ms var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
    background-color: var(--text-on-accent, #000000);
  }

  .setting-toggle-btn:not(.active) .setting-toggle-handle {
    animation: knob-off 200ms var(--ease-spring-smooth, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
  }

  @keyframes knob-on {
    0% { transform: translateX(0) scaleX(1); }
    40% { transform: translateX(8px) scaleX(1.28); }
    100% { transform: translateX(20px) scaleX(1); }
  }

  @keyframes knob-off {
    0% { transform: translateX(20px) scaleX(1); }
    40% { transform: translateX(6px) scaleX(1.28); }
    100% { transform: translateX(0) scaleX(1); }
  }
</style>

