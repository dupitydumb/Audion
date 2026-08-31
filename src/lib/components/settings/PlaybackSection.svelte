<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="playback-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.playback')}</span>
      <span class="accordion-subtitle">{$_('settings.playbackSubtitle')}</span>
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
