<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { verifyListenbrainzToken, setListenbrainzToken, deleteListenbrainzToken } from "$lib/api/tauri";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  let lbTokenInput = "";
  let lbIsVerifying = false;
  let lbVerifyError = "";
  let lbVerifySuccess = false;

  async function handleVerifyLbToken() {
    if (!lbTokenInput.trim()) return;
    lbIsVerifying = true;
    lbVerifyError = "";
    lbVerifySuccess = false;
    try {
      const username = await verifyListenbrainzToken(lbTokenInput.trim());
      await setListenbrainzToken(lbTokenInput.trim());
      appSettings.setListenBrainzTokenSet(true, username);
      lbVerifySuccess = true;
      lbTokenInput = "";
      setTimeout(() => { lbVerifySuccess = false; }, 4000);
    } catch (e) {
      lbVerifyError = String(e);
    } finally {
      lbIsVerifying = false;
    }
  }

  async function handleRemoveLbToken() {
    await deleteListenbrainzToken();
    appSettings.setListenBrainzTokenSet(false, "");
    if ($appSettings.listenBrainzEnabled) appSettings.toggleListenBrainz();
  }
</script>

<section class="settings-section" aria-labelledby="community-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="users" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.community')}</span>
      <span class="accordion-subtitle">{$_('settings.communitySubtitle')}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
    <div class="toggle-container">
      <div class="toggle-info">
        <span class="setting-title">{$_('settings.listenBrainz')}</span>
        <span class="setting-description">{$_('settings.listenBrainzDesc')}</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$appSettings.listenBrainzEnabled}
        on:click={() => appSettings.toggleListenBrainz()}
        role="switch"
        aria-checked={$appSettings.listenBrainzEnabled}
        aria-label="Toggle ListenBrainz"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    {#if $appSettings.listenBrainzEnabled}
      <div class="divider"></div>
      <div class="inner-section">
        {#if !$appSettings.listenBrainzTokenSet}
          <div class="lb-token-row" style="display: flex; gap: var(--spacing-sm);">
            <input
              type="password"
              bind:value={lbTokenInput}
              placeholder={$_('settings.userToken')}
              class="input-compact"
              style="flex: 1; min-width: 0;"
            />
            <button class="btn-outline-compact" on:click={handleVerifyLbToken} disabled={lbIsVerifying}>
              {lbIsVerifying ? "..." : $_('settings.verify')}
            </button>
          </div>
          {#if lbVerifyError}<p class="text-error" style="font-size: 0.7rem; margin-top: 4px;">{lbVerifyError}</p>{/if}
        {:else}
          <div class="lb-status-row" style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.8125rem;">{$_('settings.loggedInAs')} <strong>{$appSettings.listenBrainzUsername || 'User'}</strong></span>
            <button class="btn-text-small" on:click={handleRemoveLbToken}>{$_('settings.remove')}</button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="divider"></div>

    <div class="toggle-container">
      <div class="toggle-info">
        <span class="setting-title">{$_('settings.discordButton')}</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$appSettings.showDiscord}
        on:click={() => appSettings.setShowDiscord(!$appSettings.showDiscord)}
        role="switch"
        aria-checked={$appSettings.showDiscord}
        aria-label="Toggle Discord Button"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <div class="divider"></div>

    <div class="toggle-container">
      <div class="toggle-info">
        <span class="setting-title">{$_('settings.resonateButton')}</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$appSettings.showResonate}
        on:click={() => appSettings.setShowResonate(!$appSettings.showResonate)}
        role="switch"
        aria-checked={$appSettings.showResonate}
        aria-label="Toggle Resonate Button"
      >
        <div class="toggle-handle"></div>
      </button>
    </div>

    <div class="button-group-row" style="margin-top: var(--spacing-sm); gap: var(--spacing-sm);">
      <a href="https://discord.gg/27XRVQsBd9" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1; text-align: center;">{$_('settings.openDiscord')}</a>
      <a href="https://resonate.audionplayer.com?ref=audion" target="_blank" rel="noreferrer" class="btn-outline-compact" style="flex: 1; text-align: center;">{$_('settings.openResonate')}</a>
    </div>
    </div>
  </div>
  {/if}
</section>
