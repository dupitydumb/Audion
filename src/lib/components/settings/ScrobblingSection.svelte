<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import { verifyListenbrainzToken, setListenbrainzToken, deleteListenbrainzToken } from "$lib/api/tauri";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = true;
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

<section class="settings-section" aria-labelledby="scrobbling-heading">
  <div class="section-header-row">
    <h2 class="settings-section-title" id="scrobbling-heading">{$_('settings.scrobbling', { default: 'Scrobbling' })}</h2>
    <p class="settings-section-desc">{$_('settings.scrobblingSubtitle', { default: 'ListenBrainz scrobbling and listening history stats' })}</p>
  </div>

  <div class="section-body">
    <div class="settings-card" id="setting-listenbrainz">
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.listenBrainz', { default: 'ListenBrainz' })}</span>
            <span class="setting-description">{$_('settings.listenBrainzDesc', { default: 'Submit listening history to ListenBrainz and unlock music recommendations' })}</span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.listenBrainzEnabled}
            on:click={() => appSettings.toggleListenBrainz()}
            role="switch"
            aria-checked={$appSettings.listenBrainzEnabled}
            aria-label={$_('settings.toggleListenBrainz', { default: 'Toggle ListenBrainz' })}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        {#if $appSettings.listenBrainzEnabled}
          <div class="divider"></div>
          <div class="inner-section">
            {#if !$appSettings.listenBrainzTokenSet}
              <span class="setting-title" style="font-size: 0.85rem;">{$_('settings.userToken', { default: 'User Token' })}</span>
              <span class="setting-description" style="margin-bottom: 8px;">
                {$_('settings.listenBrainzTokenHelp', { default: 'Enter your ListenBrainz user token to authenticate scrobbles.' })}
              </span>
              <div class="lb-token-row" style="display: flex; gap: var(--spacing-sm); margin-top: 6px;">
                <input
                  type="password"
                  bind:value={lbTokenInput}
                  placeholder={$_('settings.userToken', { default: 'User Token' })}
                  class="input-compact"
                  style="flex: 1; min-width: 0;"
                  on:keydown={(e) => { if (e.key === 'Enter') handleVerifyLbToken(); }}
                />
                <button class="btn-outline-compact" on:click={handleVerifyLbToken} disabled={lbIsVerifying || !lbTokenInput.trim()}>
                  {lbIsVerifying ? "..." : $_('settings.verify', { default: 'Verify' })}
                </button>
              </div>
              {#if lbVerifyError}
                <p class="text-error" style="font-size: 0.75rem; margin-top: 6px; color: var(--error-color);">{lbVerifyError}</p>
              {/if}
              <div style="margin-top: 6px;">
                <a href="https://listenbrainz.org/profile/" target="_blank" rel="noreferrer" class="link-subtle" style="font-size: 0.75rem; color: var(--accent-primary);">
                  {$_('settings.getListenBrainzToken', { default: 'Get your token on listenbrainz.org ↗' })}
                </a>
              </div>
            {:else}
              <div class="lb-status-row" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="pill-badge accent" style="font-size: 0.7rem;">✓ {$_('settings.connected', { default: 'Connected' })}</span>
                  <span style="font-size: 0.8125rem;">{$_('settings.loggedInAs', { default: 'Logged in as' })} <strong>{$appSettings.listenBrainzUsername || 'User'}</strong></span>
                </div>
                <button class="btn-text-small" on:click={handleRemoveLbToken} style="color: var(--error-color);">
                  {$_('settings.remove', { default: 'Disconnect' })}
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
</section>

