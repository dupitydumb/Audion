<script lang="ts">
  import { slide } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { theme } from "$lib/stores/theme";
  import { parseThemePackage } from "$lib/stores/theme";
  import { browser } from "$app/environment";

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
    previewColors: string[];
  };

  let state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  let themes: ThemeCard[] = [];
  let error = '';
  let installing: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
  let installError: Record<string, string> = {};

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
    themes = [];
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
      installing = { ...installing, [card.id]: 'done' };
      setTimeout(() => { installing = { ...installing, [card.id]: 'idle' }; }, 2500);
    } catch (e: any) {
      installError = { ...installError, [card.id]: String(e?.message || e) };
      installing = { ...installing, [card.id]: 'error' };
      setTimeout(() => { installing = { ...installing, [card.id]: 'idle' }; }, 3500);
    }
  }

  function openSubmit() {
    if (!browser) return;
    window.open('https://dupitydumb.github.io/audion-theme/submit.html', '_blank');
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
                <div class="tb-theme-card">
                  <!-- color swatch -->
                  <div class="tb-swatch">
                    {#each (card.previewColors?.slice(0,3) ?? [card.accentColor,'#222','#eee']) as c}
                      <div class="tb-swatch-seg" style="background:{c}"></div>
                    {/each}
                  </div>
                  <div class="tb-info">
                    <div class="tb-name">
                      <span class="tb-dot" style="background:{card.accentColor}"></span>
                      {card.name}
                    </div>
                    {#if card.author}<div class="tb-author">by {card.author}</div>{/if}
                    {#if card.description}<div class="tb-desc">{card.description}</div>{/if}
                    {#if installError[card.id]}
                      <div class="tb-err-msg">{installError[card.id]}</div>
                    {/if}
                  </div>
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
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-color);
    transition: background var(--transition-fast);
  }
  .tb-theme-card:last-child { border-bottom: none; }
  .tb-theme-card:hover { background: var(--bg-elevated); }

  .tb-swatch {
    display: flex;
    flex-shrink: 0;
    width: 48px; height: 32px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }
  .tb-swatch-seg { flex: 1; }

  .tb-info { flex: 1; min-width: 0; }
  .tb-name {
    font-size: 0.9rem; font-weight: 600;
    display: flex; align-items: center; gap: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tb-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
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
