<script lang="ts">
  import { _ } from "svelte-i18n";
  import { showShortcutsHelp } from "$lib/stores/shortcuts";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="shortcuts-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <line x1="12" y1="22" x2="12" y2="9" />
      <path d="M2 9h20" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.shortcuts')}</span>
      <span class="accordion-subtitle">{$_('settings.shortcutsSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.enableShortcuts')}</span>
            <span class="setting-description">{$_('settings.enableShortcutsDesc')}</span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.shortcutsEnabled}
            on:click={() => appSettings.setShortcutsEnabled(!$appSettings.shortcutsEnabled)}
            role="switch"
            aria-checked={$appSettings.shortcutsEnabled}
            aria-label={$_('settings.toggleShortcuts')}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        <div class="divider"></div>

        <div class="inner-section">
          <div class="card-title-group compact">
            <h3 class="setting-title">{$_('settings.customizeShortcuts')}</h3>
            <span class="setting-description">{$_('settings.customizeShortcutsDesc')}</span>
          </div>

          <div class="button-group-row">
            <button class="btn-outline-compact" on:click={() => showShortcutsHelp()} disabled={!$appSettings.shortcutsEnabled}>
              {$_('settings.editShortcuts')}
            </button>
          </div>

          <div class="shortcut-hint">
            <span class="setting-description">
              {$appSettings.shortcutsEnabled
                ? $_('settings.shortcutsHint')
                : $_('settings.shortcutsDisabledHint')}
            </span>
            <span class="key-combo">
              <kbd class="key">Shift</kbd>
              <span class="key-plus">+</span>
              <kbd class="key">/</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
