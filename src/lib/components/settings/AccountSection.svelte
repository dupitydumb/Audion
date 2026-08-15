<script lang="ts">
  import { _ } from "svelte-i18n";
  import { authState, isLoggedIn, isSupporter, showLoginModal, loginModalMode, logout, customServerStatus, disconnectCustomServer } from "$lib/stores/sync";
  import { appSettings } from "$lib/stores/settings";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  $: accountDisplayName =
    $authState.name?.trim() ||
    ($authState.email ? $authState.email.split("@")[0] : "User");
  $: accountEmail = $authState.email || "No email";
  $: accountInitial = (accountDisplayName || "U").charAt(0).toUpperCase();

  import { confirm } from "$lib/stores/dialogs";

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

<section class="settings-section" aria-labelledby="account-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.account')}</span>
      <span class="accordion-subtitle">{$_('settings.accountSubtitle')}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        {#if $customServerStatus.connected}
          <div class="account-profile-row">
            <div class="avatar avatar-placeholder">S</div>
            <div class="account-details">
              <span class="setting-title">{$_('settings.selfHostedServer')}</span>
              <span class="setting-description">{$_('settings.urlLabel')} {$customServerStatus.url}</span>
              <span class="setting-description">{$_('settings.userLabel')} {$customServerStatus.user || $_('common.unknown')}</span>
            </div>
            <button
              class="btn-outline-compact"
              on:click={async () => {
                const ok = await confirm(
                  $_('settings.disconnectServerConfirm'),
                  { title: $_('settings.disconnectServerTitle') },
                );
                if (ok) disconnectCustomServer();
              }}
              aria-label="Disconnect Server"
            >{$_('settings.disconnect')}</button>
          </div>

          <div class="divider"></div>

          <div class="toggle-container">
            <div class="toggle-info">
              <span class="setting-title">{$_('settings.streamServerTracks')}</span>
              <span class="setting-description">{$_('settings.streamServerTracksDesc')}</span>
              <span class="setting-description" style="color: var(--accent-warning, #ffae42); margin-top: 4px;">
                {$_('settings.streamHtml5Warning')}
              </span>
            </div>
            <button
              class="toggle-btn"
              class:active={$appSettings.streamServerTracks}
              on:click={() => appSettings.setStreamServerTracks(!$appSettings.streamServerTracks)}
              role="switch"
              aria-checked={$appSettings.streamServerTracks}
              aria-label="Toggle Stream Server Tracks"
            >
              <div class="toggle-handle"></div>
            </button>
          </div>
        {:else if $isLoggedIn}
          <div class="account-profile-row">
            {#if $authState.avatar_url}
              <img
                src={$authState.avatar_url}
                alt="Profile"
                class="avatar"
                referrerpolicy="no-referrer"
                crossorigin="anonymous"
              />
            {:else}
              <div class="avatar avatar-placeholder">{accountInitial}</div>
            {/if}
            <div class="account-details">
              <span class="setting-title">{accountDisplayName}</span>
              <span class="setting-description">{accountEmail}</span>
              <span class="setting-description">
                {#if $isSupporter}
                  {$_('settings.supporterUntil')}
                  {#if $authState.supporter_until}
                    {formatSupporterUntil($authState.supporter_until)}
                  {:else}
                    {$_('settings.activeSubscription')}
                  {/if}
                {:else}
                  {$_('settings.freePlan')}
                {/if}
              </span>
            </div>
            <button
              class="btn-outline-compact"
              on:click={async () => {
                const ok = await confirm(
                  "Are you sure you want to log out? Unsynced changes will be lost.",
                  { title: $_('settings.logout') },
                );
                if (ok) logout();
              }}
              aria-label={$_('settings.logout')}
            >{$_('settings.logout')}</button>
          </div>
        {:else}
          <div class="account-options-grid">
            <div class="account-option-card">
              <div class="option-header">
                <div class="option-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <h3 class="option-title">{$_('settings.cloudSync')}</h3>
              </div>
              <p class="option-description">
                {$_('settings.cloudSyncDesc')}
              </p>
              <button
                class="btn-outline-compact btn-full-width"
                style="margin-top: auto;"
                on:click={() => { loginModalMode.set("oauth"); showLoginModal.set(true); }}
                aria-label={$_('settings.signIn')}
              >{$_('settings.signIn')}</button>
            </div>

            <div class="account-option-card">
              <div class="option-header">
                <div class="option-icon accent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                </div>
                <h3 class="option-title">{$_('settings.customServer')}</h3>
              </div>
              <p class="option-description">
                {$_('settings.customServerDesc')}
              </p>
              <button
                class="btn-outline-compact btn-full-width"
                style="margin-top: auto;"
                on:click={() => { loginModalMode.set("custom_server"); showLoginModal.set(true); }}
                aria-label={$_('settings.connectServer')}
              >{$_('settings.connectServer')}</button>
            </div>
          </div>

          <div class="docker-guide-banner">
            <div class="docker-guide-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                <path d="M22 12.5a8.25 8.25 0 0 1-16.5 0c0-2.5 1.5-4.5 4-5.5h2.5c2.5 1 4 3 4 5.5z" />
                <path d="M12 2v5" />
                <path d="M7.5 4.5l3.5 2.5" />
                <path d="M16.5 4.5L13 7" />
              </svg>
            </div>
            <div class="docker-guide-info">
              <span class="setting-title" style="margin: 0; font-size: 0.9375rem;">{$_('settings.runOwnServer')}</span>
              <span class="setting-description" style="margin: 2px 0 6px 0; font-size: 0.8125rem;">
                {$_('settings.runOwnServerDesc')}
              </span>
              <a
                href="https://github.com/dupitydumb/audion-server-docker"
                target="_blank"
                rel="noreferrer"
                class="docker-guide-link"
              >
                {$_('settings.dockerSetupGuide')}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-left: 4px; display: inline-block; vertical-align: middle;">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
