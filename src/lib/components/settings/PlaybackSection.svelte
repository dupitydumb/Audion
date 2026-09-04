<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="playback-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="play" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.playback')}</span>
      <span class="accordion-subtitle">{$_('settings.playbackSubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.autoplay')}</span>
            <span class="setting-description">{$_('settings.autoplayDesc')}</span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.autoplay}
            on:click={() => appSettings.setAutoplay(!$appSettings.autoplay)}
            role="switch"
            aria-checked={$appSettings.autoplay}
            aria-label="Toggle Autoplay"
          >
            <div class="toggle-handle"></div>
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
