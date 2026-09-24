<script lang="ts">
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { theme } from "$lib/stores/theme";
  import { parseThemePackage } from "$lib/stores/theme";
  import { browser } from "$app/environment";
  import { isTauri } from "$lib/api/tauri";

  export let open: boolean = false;
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
  };

  let state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  let themes: ThemeCard[] = [];
  let error = '';
  let installing: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
  let installError: Record<string, string> = {};

  // Persist last installed theme id so we can show a badge
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
    // Don't clear themes[] until we have new data — avoids flash of empty grid
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
      const pkg = parseThemePackage(raw);
      theme.applyPackage(pkg);
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

<section class="settings-section" aria-labelledby="theme-browser-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="monitor" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">Theme Browser</span>
      <span class="accordion-subtitle">Browse and install community themes</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>

  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card tb-card">

        <!-- toolbar -->
        <div class="tb-toolbar">
          <button class="btn-refresh" on:click={loadThemes} disabled={state === 'loading'} title="Refresh">
            <Icon name="refresh" size={14} />
          </button>
          <span class="tb-count">
            {#if state === 'loaded'}{themes.length} theme{themes.length === 1 ? '' : 's'}{/if}
          </span>
          <button class="btn-submit" on:click={openSubmit}>
            Submit a theme
          </button>
        </div>

        <!-- states -->
        {#if state === 'loading'}
          <div class="tb-loading">
            <div class="spinner"></div>
            Loading themes…
          </div>

        {:else if state === 'error'}
          <div class="tb-error">
            <Icon name="alert-circle" size={20} />
            <span>{error}</span>
            <button class="btn-retry" on:click={loadThemes}>Retry</button>
          </div>

        {:else if state === 'loaded'}
          {#if themes.length === 0}
            <div class="tb-empty">No themes found.</div>
          {:else}
            <div class="tb-grid">
              {#each themes as card (card.id)}
                {@const status = installing[card.id] ?? 'idle'}
                {@const isLast = card.id === lastInstalledId}
                {@const colors = card.previewColors ?? [card.accentColor, '#181818', card.accentColor, '#f0f0f0']}
                {@const bgBase = colors[0] ?? '#121212'}
                {@const sidebarBg = colors[1] ?? '#0c0c0c'}
                {@const accent = card.accentColor}
                {@const textPrimary = colors[3] ?? '#f0f0f0'}

                <div class="tb-theme-card">
                  <!-- Mini App UI Preview Mockup -->
                  <div class="tb-mockup" style="background: {bgBase};">
                    <!-- Mini Sidebar -->
                    <div class="tb-mock-sidebar" style="background: {sidebarBg}; border-right: 1px solid rgba(255,255,255,0.07);">
                      <div class="tb-mock-dot" style="background: {accent};"></div>
                      <div class="tb-mock-line-sm" style="background: {textPrimary}; opacity: 0.35;"></div>
                      <div class="tb-mock-line-sm" style="background: {textPrimary}; opacity: 0.2;"></div>
                    </div>

                    <!-- Mini Main Content -->
                    <div class="tb-mock-main">
                      <div class="tb-mock-topbar">
                        <div class="tb-mock-line-md" style="background: {textPrimary}; opacity: 0.7;"></div>
                        {#if card.hasEffect}
                          <span class="tb-mock-fx-badge" style="color: {accent}; border-color: {accent};">FX</span>
                        {/if}
                      </div>
                      <div class="tb-mock-content">
                        <div class="tb-mock-card" style="background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.08);">
                          <div class="tb-mock-card-accent" style="background: {accent};"></div>
                        </div>
                        <div class="tb-mock-card" style="background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.06);"></div>
                      </div>
                    </div>

                    <!-- Mini Player Bar -->
                    <div class="tb-mock-player" style="background: {sidebarBg}; border-top: 1px solid rgba(255,255,255,0.08);">
                      <div class="tb-mock-track">
                        <div class="tb-mock-thumb" style="background: {accent};"></div>
                        <div class="tb-mock-title" style="background: {textPrimary}; opacity: 0.5;"></div>
                      </div>
                      <div class="tb-mock-playbtn" style="background: {accent};"></div>
                      <div class="tb-mock-progress" style="background: rgba(255,255,255,0.15);">
                        <div class="tb-mock-progress-bar" style="background: {accent}; width: 45%;"></div>
                      </div>
                    </div>
                  </div>

                  <!-- Theme Info -->
                  <div class="tb-info">
                    <div class="tb-name">
                      <span class="tb-dot" style="background:{card.accentColor}"></span>
                      {card.name}
                      {#if card.hasEffect}
                        <span class="tb-fx-pill">Effect</span>
                      {/if}
                      {#if isLast}<span class="tb-badge">Active</span>{/if}
                    </div>
                    {#if card.author}<div class="tb-author">by {card.author}</div>{/if}
                    {#if card.description}<div class="tb-desc">{card.description}</div>{/if}
                    {#if installError[card.id]}
                      <div class="tb-err-msg">{installError[card.id]}</div>
                    {/if}
                  </div>

                  <!-- Install Action -->
                  <button
                    class="btn-install"
                    class:done={status === 'done'}
                    class:loading={status === 'loading'}
                    disabled={status === 'loading'}
                    on:click={() => installTheme(card)}
                  >
                    {#if status === 'loading'}
                      <span class="spin-sm"></span>
                    {:else if status === 'done'}
                      <Icon name="check" size={13} /> Applied
                    {:else}
                      Install
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

      </div>
    </div>
  {/if}
</section>

<style>
  .tb-card { padding: 0; overflow: hidden; }

  .tb-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-color);
  }
  .btn-refresh {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-subdued);
    cursor: pointer;
  }
  .btn-refresh:hover { background: var(--bg-highlight); color: var(--text-primary); }
  .btn-refresh:disabled { opacity: 0.4; cursor: not-allowed; }
  .tb-count { flex: 1; font-size: 0.8rem; color: var(--text-subdued); }
  .btn-submit {
    font-size: 0.8rem;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-subdued);
    cursor: pointer;
  }
  .btn-submit:hover { background: var(--bg-highlight); color: var(--text-primary); }

  .tb-loading {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 40px 20px;
    color: var(--text-subdued);
    font-size: 0.875rem;
  }
  .spinner {
    width: 22px; height: 22px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .tb-error {
    display: flex; align-items: center; gap: 10px;
    padding: 20px 16px;
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
  .btn-retry:hover { background: var(--bg-highlight); }

  .tb-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-subdued);
    font-size: 0.875rem;
  }

  .tb-grid {
    display: flex;
    flex-direction: column;
  }
  .tb-theme-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color);
    transition: background var(--transition-fast);
  }
  .tb-theme-card:last-child { border-bottom: none; }
  .tb-theme-card:hover { background: var(--bg-elevated); }

  /* Realistic Mini App Mockup */
  .tb-mockup {
    position: relative;
    width: 90px;
    height: 58px;
    border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    overflow: hidden;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 24px 1fr;
    grid-template-rows: 1fr 14px;
  }

  .tb-mock-sidebar {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 5px;
  }
  .tb-mock-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .tb-mock-line-sm {
    width: 12px;
    height: 2px;
    border-radius: 1px;
  }

  .tb-mock-main {
    grid-row: 1;
    grid-column: 2;
    display: flex;
    flex-direction: column;
    padding: 4px 5px;
    gap: 4px;
    overflow: hidden;
  }
  .tb-mock-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tb-mock-line-md {
    width: 24px;
    height: 3px;
    border-radius: 1px;
  }
  .tb-mock-fx-badge {
    font-size: 7px;
    line-height: 1;
    padding: 1px 2px;
    border-radius: 2px;
    border: 1px solid;
    font-weight: 700;
  }

  .tb-mock-content {
    display: flex;
    gap: 3px;
    flex: 1;
  }
  .tb-mock-card {
    flex: 1;
    border-radius: 3px;
    border: 1px solid;
    position: relative;
    overflow: hidden;
  }
  .tb-mock-card-accent {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 5px;
    height: 5px;
    border-radius: 1px;
  }

  .tb-mock-player {
    grid-row: 2;
    grid-column: 1 / span 2;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
  }
  .tb-mock-track {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .tb-mock-thumb {
    width: 7px;
    height: 7px;
    border-radius: 1px;
  }
  .tb-mock-title {
    width: 12px;
    height: 2px;
    border-radius: 1px;
  }
  .tb-mock-playbtn {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tb-mock-progress {
    flex: 1;
    height: 2px;
    border-radius: 1px;
    overflow: hidden;
  }
  .tb-mock-progress-bar {
    height: 100%;
    border-radius: 1px;
  }

  .tb-info { flex: 1; min-width: 0; }
  .tb-name {
    font-size: 0.9rem; font-weight: 600;
    display: flex; align-items: center; gap: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tb-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .tb-fx-pill {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: var(--text-secondary);
    letter-spacing: 0.3px;
  }
  .tb-badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--accent-primary);
    color: #fff;
    flex-shrink: 0;
  }
  .tb-author { font-size: 0.78rem; color: var(--text-subdued); }
  .tb-desc {
    font-size: 0.8rem; color: var(--text-subdued);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tb-err-msg { font-size: 0.75rem; color: #f87171; margin-top: 2px; }

  .btn-install {
    flex-shrink: 0;
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 12px;
    border-radius: 6px;
    border: none;
    background: var(--accent-primary);
    color: #fff;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast);
    min-width: 68px; justify-content: center;
  }
  .btn-install:hover:not(:disabled) { opacity: 0.85; }
  .btn-install:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-install.done { background: #22c55e; }

  .spin-sm {
    width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
</style>
