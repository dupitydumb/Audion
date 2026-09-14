<script lang="ts">
  import { _ } from "svelte-i18n";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();
</script>

<section class="settings-section" aria-labelledby="support-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="heart" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.support')}</span>
      <span class="accordion-subtitle">{$_('settings.supportSubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
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
            <Icon name="heart" size={32} />
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
