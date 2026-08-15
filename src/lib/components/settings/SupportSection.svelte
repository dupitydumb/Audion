<script lang="ts">
  import { _ } from "svelte-i18n";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="support-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.support')}</span>
      <span class="accordion-subtitle">{$_('settings.supportSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card support-card-premium">
        <div class="premium-card-badge">{$_('settings.donate')}</div>
        <div class="support-content">
          <div class="support-text">
            <h3 class="support-title">{$_('settings.supportAudion')}</h3>
            <p class="support-description">{$_('settings.supportDesc')}</p>
          </div>
          <div class="support-icon-large">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        </div>
        <div class="support-grid">
          <a
            href="https://ko-fi.com/N4N5UMNR1"
            target="_blank"
            rel="noreferrer"
            class="support-platform-card kofi"
          >
            <span class="platform-name">Ko-fi</span>
            <span class="platform-tag">{$_('settings.kofiTag')}</span>
          </a>
          <a
            href="https://www.patreon.com/AudionPlayer"
            target="_blank"
            rel="noreferrer"
            class="support-platform-card patreon"
          >
            <span class="platform-name">Patreon</span>
            <span class="platform-tag">{$_('settings.patreonTag')}</span>
          </a>
        </div>
      </div>
    </div>
  {/if}
</section>
