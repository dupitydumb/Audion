<script lang="ts">
  import { _ } from "svelte-i18n";
  import { appSettings } from "$lib/stores/settings";
  import {
    verifyListenbrainzToken,
    setListenbrainzToken,
    deleteListenbrainzToken,
    getLastfmAuthUrl,
    completeLastfmAuth,
    getLastfmStatus,
    disconnectLastfm
  } from "$lib/api/tauri";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  export let open: boolean = true;
  const dispatch = createEventDispatcher();

  // ListenBrainz state
  let lbTokenInput = "";
  let lbIsVerifying = false;
  let lbVerifyError = "";
  let lbVerifySuccess = false;

  // Last.fm state
  let lastfmTokenInput = "";
  let lastfmIsConnecting = false;
  let lastfmError = "";
  let lastfmSuccess = false;
  let unlistenDeepLink: UnlistenFn | null = null;

  onMount(async () => {
    try {
      const status = await getLastfmStatus();
      if (status.connected && status.username) {
        appSettings.setLastFmConnected(true, status.username);
      }
    } catch (e) {
      console.warn("Failed to check Last.fm status:", e);
    }

    try {
      unlistenDeepLink = await listen<string>("lastfm://auth-callback", async (event) => {
        const token = event.payload;
        if (token) {
          await handleCompleteLastfmAuth(token);
        }
      });
    } catch (e) {
      console.warn("Could not register Last.fm deep-link listener:", e);
    }
  });

  onDestroy(() => {
    if (unlistenDeepLink) {
      unlistenDeepLink();
    }
  });

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

  async function handleConnectLastfm() {
    lastfmError = "";
    lastfmIsConnecting = true;
    try {
      const url = await getLastfmAuthUrl();
      await openUrl(url);
    } catch (e) {
      lastfmError = String(e);
      lastfmIsConnecting = false;
    }
  }

  async function handleCompleteLastfmAuth(token: string) {
    if (!token.trim()) return;
    lastfmIsConnecting = true;
    lastfmError = "";
    try {
      const username = await completeLastfmAuth(token.trim());
      appSettings.setLastFmConnected(true, username);
      lastfmSuccess = true;
      lastfmTokenInput = "";
      setTimeout(() => { lastfmSuccess = false; }, 4000);
    } catch (e) {
      lastfmError = String(e);
    } finally {
      lastfmIsConnecting = false;
    }
  }

  async function handleDisconnectLastfm() {
    await disconnectLastfm();
    appSettings.setLastFmConnected(false, "");
    if ($appSettings.lastFmEnabled) appSettings.toggleLastFm();
  }
</script>

<section class="settings-section" aria-labelledby="scrobbling-heading">
  <div class="section-header-row">
    <h2 class="settings-section-title" id="scrobbling-heading">{$_('settings.scrobbling', { default: 'Scrobbling & Tracking' })}</h2>
    <p class="settings-section-desc">{$_('settings.scrobblingSubtitle', { default: 'Last.fm and ListenBrainz scrobbling & listening statistics' })}</p>
  </div>

  <div class="section-body">
    <!-- Last.fm -->
    <div class="settings-card" id="setting-lastfm" style="margin-bottom: var(--spacing-md, 16px);">
      <div class="toggle-container">
        <div class="toggle-info">
          <span class="setting-title">Last.fm</span>
          <span class="setting-description">{$_('settings.lastFmDesc', { default: 'Automatically scrobble your plays and live now-playing status to Last.fm' })}</span>
        </div>
        <button
          class="toggle-btn"
          class:active={$appSettings.lastFmEnabled}
          on:click={() => appSettings.toggleLastFm()}
          role="switch"
          aria-checked={$appSettings.lastFmEnabled}
          aria-label="Toggle Last.fm"
        >
          <div class="toggle-handle"></div>
        </button>
      </div>

      {#if $appSettings.lastFmEnabled}
        <div class="divider"></div>
        <div class="inner-section">
          {#if !$appSettings.lastFmConnected}
            <span class="setting-title" style="font-size: 0.85rem;">{$_('settings.lastFmAuth', { default: 'Account Connection' })}</span>
            <span class="setting-description" style="margin-bottom: 10px;">
              {$_('settings.lastFmAuthHelp', { default: 'Authorize Audion in your web browser. When approved, you will be redirected back automatically.' })}
            </span>
            <div style="display: flex; flex-wrap: wrap; gap: var(--spacing-sm, 8px); align-items: center; margin-top: 8px;">
              <button class="btn-primary-compact" on:click={handleConnectLastfm} disabled={lastfmIsConnecting}>
                {lastfmIsConnecting ? "Opening Browser..." : "Authorize on Last.fm ↗"}
              </button>
            </div>

            <!-- Manual Token Fallback -->
            <details style="margin-top: 12px; font-size: 0.75rem; color: var(--text-secondary);">
              <summary style="cursor: pointer; user-select: none;">
                {$_('settings.manualTokenFallback', { default: 'Browser didn\'t redirect? Paste token manually' })}
              </summary>
              <div class="lb-token-row" style="display: flex; gap: var(--spacing-sm, 8px); margin-top: 8px;">
                <input
                  type="text"
                  bind:value={lastfmTokenInput}
                  placeholder="Last.fm Auth Token"
                  class="input-compact"
                  style="flex: 1; min-width: 0;"
                  on:keydown={(e) => { if (e.key === 'Enter') handleCompleteLastfmAuth(lastfmTokenInput); }}
                />
                <button
                  class="btn-outline-compact"
                  on:click={() => handleCompleteLastfmAuth(lastfmTokenInput)}
                  disabled={lastfmIsConnecting || !lastfmTokenInput.trim()}
                >
                  {lastfmIsConnecting ? "..." : $_('settings.verify', { default: 'Verify' })}
                </button>
              </div>
            </details>

            {#if lastfmError}
              <p class="text-error" style="font-size: 0.75rem; margin-top: 8px; color: var(--error-color);">{lastfmError}</p>
            {/if}
          {:else}
            <div class="lb-status-row" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="pill-badge accent" style="font-size: 0.7rem;">✓ {$_('settings.connected', { default: 'Connected' })}</span>
                <span style="font-size: 0.8125rem;">{$_('settings.loggedInAs', { default: 'Logged in as' })} <strong>{$appSettings.lastFmUsername || 'User'}</strong></span>
              </div>
              <button class="btn-text-small" on:click={handleDisconnectLastfm} style="color: var(--error-color);">
                {$_('settings.remove', { default: 'Disconnect' })}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- ListenBrainz -->
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
            <div class="lb-token-row" style="display: flex; gap: var(--spacing-sm, 8px); margin-top: 6px;">
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

<style>
  .btn-primary-compact {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border: none;
    border-radius: var(--radius-sm, 4px);
    padding: 6px 14px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .btn-primary-compact:hover {
    opacity: 0.9;
  }
  .btn-primary-compact:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
