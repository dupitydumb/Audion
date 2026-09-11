<script lang="ts">
  import { _ } from "svelte-i18n";
  import { showShortcutsHelp } from "$lib/stores/shortcuts";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="shortcuts-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="keyboard" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.shortcuts')}</span>
      <span class="accordion-subtitle">{$_('settings.shortcutsSubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
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
