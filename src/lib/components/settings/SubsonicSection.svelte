<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { slide } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";
  import {
    subsonicConfig,
    subsonicConnected,
    saveSubsonicConfig,
    testSubsonicConnection,
  } from "$lib/stores/subsonic";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // Local form state — synced from store on mount / store update
  let url = $subsonicConfig.url;
  let username = $subsonicConfig.username;
  let password = $subsonicConfig.password;
  let enabled = $subsonicConfig.enabled;

  // Re-sync if store changes externally (e.g. initSubsonic on startup)
  $: {
    url = $subsonicConfig.url;
    username = $subsonicConfig.username;
    password = $subsonicConfig.password;
    enabled = $subsonicConfig.enabled;
  }

  let testing = false;
  let saving = false;
  let result: { ok: boolean; message: string } | null = null;

  async function handleTest() {
    testing = true;
    result = null;
    try {
      const user = await testSubsonicConnection(url, username, password);
      result = {
        ok: true,
        message: `Connected as ${user.username}${user.server_version ? ` · server v${user.server_version}` : ""}`,
      };
    } catch (err: unknown) {
      result = { ok: false, message: String(err) };
    } finally {
      testing = false;
    }
  }

  async function handleSave() {
    saving = true;
    result = null;
    try {
      await saveSubsonicConfig(url, username, password, enabled);
      result = { ok: true, message: "Configuration saved" };
    } catch (err: unknown) {
      result = { ok: false, message: String(err) };
    } finally {
      saving = false;
    }
  }

  async function handleToggleEnabled() {
    enabled = !enabled;
    result = null;
    if (!enabled) {
      // Persist the disabled state immediately
      await saveSubsonicConfig(url, username, password, false);
    }
  }
</script>

<section class="settings-section" aria-labelledby="subsonic-heading">
  <button
    class="accordion-trigger"
    on:click={() => dispatch("toggle")}
    aria-expanded={open}
    id="subsonic-heading"
  >
    <Icon name="globe" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">Subsonic Server</span>
      <span class="accordion-subtitle">
        {#if $subsonicConnected}
          Connected · {$subsonicConfig.url}
        {:else}
          Stream from Navidrome, Airsonic, Jellyfin, and more
        {/if}
      </span>
    </div>
    <Icon
      name="chevron-down"
      size={16}
      className="accordion-chevron {open ? 'rotated' : ''}"
    />
  </button>

  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">

        <!-- Enable toggle -->
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">Enable Subsonic Integration</span>
            <span class="setting-description">
              Connect to any Subsonic-compatible server and browse or stream
              your music library directly in Audion.
            </span>
          </div>
          <button
            class="toggle-btn"
            class:active={enabled}
            on:click={handleToggleEnabled}
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle Subsonic integration"
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        {#if enabled}
          <div class="divider"></div>

          <!-- Server URL -->
          <div class="subsonic-field">
            <label class="setting-title" for="subsonic-url">Server URL</label>
            <span class="setting-description">
              Include port if needed, e.g. https://music.example.com or
              http://192.168.1.10:4533
            </span>
            <input
              id="subsonic-url"
              class="subsonic-input"
              type="url"
              placeholder="https://your-server.com"
              bind:value={url}
              autocomplete="off"
              spellcheck="false"
            />
          </div>

          <!-- Username -->
          <div class="subsonic-field">
            <label class="setting-title" for="subsonic-username">Username</label>
            <input
              id="subsonic-username"
              class="subsonic-input"
              type="text"
              placeholder="admin"
              bind:value={username}
              autocomplete="username"
            />
          </div>

          <!-- Password -->
          <div class="subsonic-field">
            <label class="setting-title" for="subsonic-password">Password</label>
            <input
              id="subsonic-password"
              class="subsonic-input"
              type="password"
              placeholder="••••••••"
              bind:value={password}
              autocomplete="current-password"
            />
          </div>

          <!-- Result banner -->
          {#if result}
            <div
              class="subsonic-banner"
              class:success={result.ok}
              class:error={!result.ok}
              role="status"
              aria-live="polite"
            >
              <Icon name={result.ok ? "check-circle" : "alert-circle"} size={15} />
              <span>{result.message}</span>
            </div>
          {/if}

          <!-- Actions -->
          <div class="subsonic-actions">
            <button
              class="btn-outline-compact"
              on:click={handleTest}
              disabled={testing || !url || !username || !password}
              aria-label="Test server connection"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            <button
              class="btn-outline-compact"
              on:click={handleSave}
              disabled={saving || !url || !username || !password}
              aria-label="Save Subsonic configuration"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        {/if}

      </div>
    </div>
  {/if}
</section>

<style>
  .subsonic-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }

  .subsonic-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .subsonic-input:focus {
    border-color: var(--accent-primary, #1db954);
  }

  .subsonic-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  .subsonic-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    margin-top: 10px;
  }

  .subsonic-banner.success {
    background: color-mix(in srgb, var(--accent-primary, #1db954) 15%, transparent);
    color: var(--accent-primary, #1db954);
  }

  .subsonic-banner.error {
    background: color-mix(in srgb, #ff6b6b 15%, transparent);
    color: #ff6b6b;
  }
</style>
