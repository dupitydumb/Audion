<script lang="ts">
  import { _ } from "svelte-i18n";
  import { authState, isSupporter } from "$lib/stores/sync";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  function formatSupporterUntil(ts: number | null): string {
    if (ts === null) return $_('settings.activeSubscription');
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
</script>

<section class="settings-section" aria-labelledby="upgrade-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.upgrade')}</span>
      <span class="accordion-subtitle">{$_('settings.upgradeSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card upgrade-card">
        <div class="premium-card-badge">{$_('settings.unlock')}</div>
    {#if !$isSupporter}
      <div class="card-header-row">
        <div class="card-title-group">
          <h3 class="setting-title">{$_('settings.unlimitedSync')}</h3>
          <span class="setting-description">{$_('settings.unlimitedSyncDesc')}</span>
        </div>
        <div class="pill-badge accent">Support</div>
      </div>
      <a href="https://ko-fi.com/N4N5UMNR1" target="_blank" rel="noreferrer" class="btn-primary-compact" style="margin-top: var(--spacing-sm); text-align: center;">{$_('settings.supportOnKofi')}</a>
    {:else}
      <div class="card-header-row">
        <div class="card-title-group">
          <h3 class="setting-title">{$_('settings.supporterStatus')}</h3>
          <span class="setting-description">{$_('settings.proBenefitsActive')}</span>
        </div>
        <div class="pill-badge accent">{$_('settings.pro')}</div>
      </div>
      <p class="notice-text-sm" style="margin-top: var(--spacing-sm)">
        {#if $authState.supporter_until}
          {$_('settings.validUntil')} {formatSupporterUntil($authState.supporter_until)}
        {:else}
          {$_('settings.activePerpetual')}
        {/if}
      </p>
    {/if}
    </div>
  </div>
  {/if}
</section>
