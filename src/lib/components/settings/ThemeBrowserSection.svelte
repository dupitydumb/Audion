<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { theme, parseSkinPackage } from "$lib/stores/theme";
  import { browser } from "$app/environment";
  import { isTauri, saveLocalSkin } from "$lib/api/tauri";
  import { refreshLocalSkins } from "$lib/stores/skins";
  import { _ } from "svelte-i18n";

  export let open: boolean = false;
  export let embedded: boolean = false;
  const dispatch = createEventDispatcher();

  const INDEX_URL = 'https://raw.githubusercontent.com/dupitydumb/audion-theme/main/index.json';
  const RAW_BASE  = 'https://raw.githubusercontent.com/dupitydumb/audion-theme/main/';

  type ThemeCard = {
    id: string;
    file: string;
    name: string;
    author?: string;
    description?: string;
    accentColor: string;
    previewColors?: string[];
    hasEffect?: boolean;
    hasCss?: boolean;
    schemesCount?: number;
  };

  let state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  let themes: ThemeCard[] = [];
  let error = '';
  let installing: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
  let installError: Record<string, string> = {};

  let lastInstalledId: string = '';
  try { lastInstalledId = localStorage.getItem('tb_last_installed') ?? ''; } catch {}

  async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadThemes() {
    state = 'loading';
    error = '';
    try {
      const res = await fetchWithTimeout(INDEX_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      themes = data.themes || [];
      state = 'loaded';
    } catch (e: any) {
      error = e?.name === 'AbortError' ? 'Request timed out.' : String(e?.message || e);
      state = 'error';
    }
  }

  async function installTheme(card: ThemeCard) {
    installing = { ...installing, [card.id]: 'loading' };
    installError = { ...installError, [card.id]: '' };
    try {
      const res = await fetchWithTimeout(RAW_BASE + card.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const raw = JSON.parse(text);
      const pkg = parseSkinPackage(raw);
      theme.applyPackage(pkg);
      if (pkg.customJs) {
        theme.setAllowCustomJs(true);
      }

      // Save to local skins directory in desktop app and refresh local store
      if (isTauri()) {
        try {
          const filename = card.file.endsWith('.audionskin') ? card.file : `${card.id}.audionskin`;
          await saveLocalSkin(filename, text);
          await refreshLocalSkins();
        } catch (saveErr) {
          console.warn('[ThemeBrowser] Could not save skin locally:', saveErr);
        }
      }

      lastInstalledId = card.id;
      try { localStorage.setItem('tb_last_installed', card.id); } catch {}
      installing = { ...installing, [card.id]: 'done' };
      setTimeout(() => { installing = { ...installing, [card.id]: 'idle' }; }, 2500);
    } catch (e: any) {
      installError = { ...installError, [card.id]: String(e?.message || e) };
      installing = { ...installing, [card.id]: 'error' };
      setTimeout(() => { installing = { ...installing, [card.id]: 'idle' }; }, 3500);
    }
  }

  async function openSubmit() {
    if (!browser) return;
    const url = 'https://dupitydumb.github.io/audion-theme/submit.html';
    if (isTauri()) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
      } catch {}
    }
    window.open(url, '_blank');
  }

  // Auto-load when section opens
  $: if (open && state === 'idle') loadThemes();
</script>

{#if embedded}
  <!-- Embedded mode: seamlessly integrated into parent section without duplicate cards -->
  <div class="tb-container embedded">
    <div class="tb-toolbar">
      <button class="btn-refresh" on:click={loadThemes} disabled={state === 'loading'} title={$_('settings.refresh', { default: 'Refresh' })}>
        <Icon name="refresh" size={14} className={state === 'loading' ? 'spinning' : ''} />
      </button>
      <span class="tb-count">
        {#if state === 'loaded'}
          {themes.length} {themes.length === 1 ? $_('settings.searchThemes', { default: 'theme' }) : $_('settings.searchThemesPlural', { default: 'themes' })} available
        {:else if state === 'loading'}
          Loading community skins…
        {/if}
      </span>
      <button class="btn-submit" on:click={openSubmit}>
        {$_('settings.submitTheme', { default: 'Submit a theme' })}
      </button>
    </div>

    {#if state === 'loading'}
      <div class="tb-loading">
        <div class="spinner"></div>
        <span>{$_('settings.loadingThemes', { default: 'Loading community skins…' })}</span>
      </div>
    {:else if state === 'error'}
      <div class="tb-error">
        <Icon name="alert-circle" size={18} />
        <span>{error}</span>
        <button class="btn-retry" on:click={loadThemes}>{$_('settings.retry', { default: 'Retry' })}</button>
      </div>
    {:else if state === 'loaded'}
      {#if themes.length === 0}
        <div class="tb-empty">{$_('settings.noThemesFound', { default: 'No themes found.' })}</div>
      {:else}
        <div class="tb-list">
          {#each themes as card (card.id)}
            {@const status = installing[card.id] ?? 'idle'}
            {@const isCurrent = $theme.skinName === card.name}
            {@const colors = card.previewColors ?? [card.accentColor, '#181818', card.accentColor, '#f0f0f0']}
            {@const bgBase = colors[0] ?? '#121212'}
            {@const sidebarBg = colors[1] ?? '#0c0c0c'}
            {@const accent = card.accentColor}
            {@const textPrimary = colors[3] ?? '#f0f0f0'}

            <div class="tb-row" class:active-theme={isCurrent}>
              <!-- Authentic Color Palette Swatches (Hairlines, not fake mockup boxes) -->
              <div class="tb-palette-swatch" title="Base, Surface, Accent, Text">
                <span class="swatch-bar" style="background: {bgBase};"></span>
                <span class="swatch-bar" style="background: {sidebarBg};"></span>
                <span class="swatch-bar" style="background: {accent};"></span>
                <span class="swatch-bar" style="background: {textPrimary};"></span>
              </div>

              <!-- Theme Information -->
              <div class="tb-meta">
                <div class="tb-title-line">
                  <span class="tb-name">{card.name}</span>
                  {#if card.hasCss}
                    <span class="tb-tag">CSS</span>
                  {/if}
                  {#if card.hasEffect}
                    <span class="tb-tag fx">FX</span>
                  {/if}
                  {#if card.schemesCount && card.schemesCount > 1}
                    <span class="tb-tag">{card.schemesCount} Schemes</span>
                  {/if}
                  {#if isCurrent}
                    <span class="tb-tag active">Active</span>
                  {/if}
                </div>
                <div class="tb-sub-line">
                  {#if card.author}
                    <span class="tb-author">by {card.author}</span>
                  {/if}
                  {#if card.description}
                    <span class="tb-desc">· {card.description}</span>
                  {/if}
                </div>
                {#if installError[card.id]}
                  <div class="tb-err-msg">{installError[card.id]}</div>
                {/if}
              </div>

              <!-- Single Direct Action -->
              <button
                class="btn-install"
                class:done={status === 'done' || isCurrent}
                class:loading={status === 'loading'}
                disabled={status === 'loading'}
                on:click={() => installTheme(card)}
              >
                {#if status === 'loading'}
                  <span class="spin-sm"></span>
                {:else if status === 'done' || isCurrent}
                  <Icon name="check" size={13} />
                  <span>{$_('settings.applied', { default: 'Applied' })}</span>
                {:else}
                  <Icon name="download" size={13} />
                  <span>{$_('settings.install', { default: 'Install' })}</span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{:else}
  <!-- Standalone mode -->
  <section class="settings-section" aria-labelledby="theme-browser-heading">
    <div class="section-header-row">
      <h2 class="settings-section-title" id="theme-browser-heading">{$_('settings.themeBrowser', { default: 'Community Skins' })}</h2>
      <p class="settings-section-desc">{$_('settings.themeBrowserSubtitle', { default: 'Browse and install community skins' })}</p>
    </div>

    <div class="section-body">
      <div class="settings-card tb-card">
        <div class="tb-toolbar standalone">
          <button class="btn-refresh" on:click={loadThemes} disabled={state === 'loading'} title={$_('settings.refresh', { default: 'Refresh' })}>
            <Icon name="refresh" size={14} className={state === 'loading' ? 'spinning' : ''} />
          </button>
          <span class="tb-count">
            {#if state === 'loaded'}
              {themes.length} {themes.length === 1 ? $_('settings.searchThemes', { default: 'theme' }) : $_('settings.searchThemesPlural', { default: 'themes' })} available
            {:else if state === 'loading'}
              Loading community skins…
            {/if}
          </span>
          <button class="btn-submit" on:click={openSubmit}>
            {$_('settings.submitTheme', { default: 'Submit a theme' })}
          </button>
        </div>

        {#if state === 'loading'}
          <div class="tb-loading">
            <div class="spinner"></div>
            <span>{$_('settings.loadingThemes', { default: 'Loading community skins…' })}</span>
          </div>
        {:else if state === 'error'}
          <div class="tb-error">
            <Icon name="alert-circle" size={18} />
            <span>{error}</span>
            <button class="btn-retry" on:click={loadThemes}>{$_('settings.retry', { default: 'Retry' })}</button>
          </div>
        {:else if state === 'loaded'}
          {#if themes.length === 0}
            <div class="tb-empty">{$_('settings.noThemesFound', { default: 'No themes found.' })}</div>
          {:else}
            <div class="tb-list standalone">
              {#each themes as card (card.id)}
                {@const status = installing[card.id] ?? 'idle'}
                {@const isCurrent = $theme.skinName === card.name}
                {@const colors = card.previewColors ?? [card.accentColor, '#181818', card.accentColor, '#f0f0f0']}
                {@const bgBase = colors[0] ?? '#121212'}
                {@const sidebarBg = colors[1] ?? '#0c0c0c'}
                {@const accent = card.accentColor}
                {@const textPrimary = colors[3] ?? '#f0f0f0'}

                <div class="tb-row" class:active-theme={isCurrent}>
                  <div class="tb-palette-swatch" title="Base, Surface, Accent, Text">
                    <span class="swatch-bar" style="background: {bgBase};"></span>
                    <span class="swatch-bar" style="background: {sidebarBg};"></span>
                    <span class="swatch-bar" style="background: {accent};"></span>
                    <span class="swatch-bar" style="background: {textPrimary};"></span>
                  </div>

                  <div class="tb-meta">
                    <div class="tb-title-line">
                      <span class="tb-name">{card.name}</span>
                      {#if card.hasCss}
                        <span class="tb-tag">CSS</span>
                      {/if}
                      {#if card.hasEffect}
                        <span class="tb-tag fx">FX</span>
                      {/if}
                      {#if card.schemesCount && card.schemesCount > 1}
                        <span class="tb-tag">{card.schemesCount} Schemes</span>
                      {/if}
                      {#if isCurrent}
                        <span class="tb-tag active">Active</span>
                      {/if}
                    </div>
                    <div class="tb-sub-line">
                      {#if card.author}
                        <span class="tb-author">by {card.author}</span>
                      {/if}
                      {#if card.description}
                        <span class="tb-desc">· {card.description}</span>
                      {/if}
                    </div>
                    {#if installError[card.id]}
                      <div class="tb-err-msg">{installError[card.id]}</div>
                    {/if}
                  </div>

                  <button
                    class="btn-install"
                    class:done={status === 'done' || isCurrent}
                    class:loading={status === 'loading'}
                    disabled={status === 'loading'}
                    on:click={() => installTheme(card)}
                  >
                    {#if status === 'loading'}
                      <span class="spin-sm"></span>
                    {:else if status === 'done' || isCurrent}
                      <Icon name="check" size={13} />
                      <span>{$_('settings.applied', { default: 'Applied' })}</span>
                    {:else}
                      <Icon name="download" size={13} />
                      <span>{$_('settings.install', { default: 'Install' })}</span>
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .tb-container.embedded {
    width: 100%;
    margin-top: 4px;
  }

  .tb-card {
    padding: 0;
    overflow: hidden;
  }

  .tb-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0 12px 0;
    border-bottom: 1px solid var(--border-color);
  }

  .tb-toolbar.standalone {
    padding: 12px 16px;
  }

  .btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-subdued);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }

  .btn-refresh:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .btn-refresh:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(.spinning) {
    animation: spin 0.8s linear infinite;
  }

  .tb-count {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--text-subdued);
  }

  .btn-submit {
    font-size: 0.8125rem;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
  }

  .btn-submit:hover {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .tb-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px 16px;
    color: var(--text-subdued);
    font-size: 0.875rem;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .tb-error {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 0;
    color: var(--text-subdued);
    font-size: 0.875rem;
    flex-wrap: wrap;
  }

  .btn-retry {
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.8rem;
  }

  .btn-retry:hover {
    background: var(--bg-highlight);
  }

  .tb-empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--text-subdued);
    font-size: 0.875rem;
  }

  /* List of themes with hairlines, NOT boxes inside boxes */
  .tb-list {
    display: flex;
    flex-direction: column;
  }

  .tb-list.standalone .tb-row {
    padding: 12px 16px;
  }

  .tb-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
    transition: background-color var(--transition-fast);
  }

  .tb-row:last-child {
    border-bottom: none;
  }

  .tb-row:hover {
    background: var(--bg-highlight);
  }

  .tb-row.active-theme {
    background: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.05);
  }

  /* 4-Stripe Color Swatch Preview (Clean, truthful, no fake UI mockups) */
  .tb-palette-swatch {
    width: 48px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    display: flex;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .swatch-bar {
    flex: 1;
    height: 100%;
  }

  .tb-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tb-title-line {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tb-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .tb-tag {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  }

  .tb-tag.fx {
    border-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.35);
    color: var(--accent-primary);
  }

  .tb-tag.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--text-on-accent, #ffffff);
    font-weight: 600;
  }

  .tb-sub-line {
    font-size: 0.75rem;
    color: var(--text-subdued);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-author {
    color: var(--text-secondary);
  }

  .tb-desc {
    color: var(--text-subdued);
  }

  .tb-err-msg {
    font-size: 0.75rem;
    color: var(--error-color, #f87171);
    margin-top: 2px;
  }

  .btn-install {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: var(--accent-primary);
    color: var(--text-on-accent, #ffffff);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast), background-color var(--transition-fast);
  }

  .btn-install:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-install:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-install.done {
    background: transparent;
    border-color: var(--border-color);
    color: var(--text-primary);
  }

  .spin-sm {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, currentColor 35%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  :global(html.layout-mobile) .tb-toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }

  :global(html.layout-mobile) .btn-refresh {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .btn-submit,
  :global(html.layout-mobile) .btn-retry {
    min-height: 44px;
    padding: 8px 12px;
  }

  :global(html.layout-mobile) .tb-row {
    flex-wrap: wrap;
    gap: 10px;
  }

  :global(html.layout-mobile) .tb-palette-swatch {
    width: 40px;
    height: 28px;
  }

  :global(html.layout-mobile) .tb-meta {
    flex: 1 1 160px;
  }

  :global(html.layout-mobile) .btn-install {
    width: 100%;
    min-height: 44px;
    justify-content: center;
    padding: 8px 12px;
    font-size: 0.8125rem;
  }
</style>