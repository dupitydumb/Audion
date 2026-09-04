<script lang="ts">
  import { _ } from "svelte-i18n";
  import {
    getArtistSplitRules,
    setArtistSplitRules,
    getAlbumArtistMode,
    setAlbumArtistMode,
    rescanMusic,
    type ArtistSplitRules,
    type AlbumArtistMode,
  } from "$lib/api/tauri";
  import { loadLibrary } from "$lib/stores/library";
  import { progressiveScan } from "$lib/stores/progressiveScan";
  import Icon from "$lib/components/Icon.svelte";
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // current, editable state
  let delimiters: string[] = [];
  let albumArtistMode: AlbumArtistMode = "first_track";
  let newDelimiter = "";
  let loaded = false;

  // snapshot taken on load and after a successful rescan
  // used to decide whether the library needs a rescan
  // changing either setting only affects future scans (see get_or_create_album / resplit_all_track_artists on the backend)
  let initialDelimiters: string[] = [];
  let initialAlbumArtistMode: AlbumArtistMode = "first_track";

  $: rescanNeeded =
    loaded &&
    (albumArtistMode !== initialAlbumArtistMode ||
      JSON.stringify(delimiters) !== JSON.stringify(initialDelimiters));

  let isRescanning = false;
  let rescanMessage = "";
  let rescanSuccess = true;

  onMount(async () => {
    try {
      const [rules, mode] = await Promise.all([
        getArtistSplitRules(),
        getAlbumArtistMode(),
      ]);
      delimiters = [...rules.delimiters];
      albumArtistMode = mode;
      initialDelimiters = [...rules.delimiters];
      initialAlbumArtistMode = mode;
    } catch (e) {
      console.error("[ArtistsSection] Failed to load artist settings:", e);
    } finally {
      loaded = true;
    }
  });

  async function persistDelimiters() {
    try {
      await setArtistSplitRules({ delimiters });
    } catch (e) {
      console.error("[ArtistsSection] Failed to save split rules:", e);
    }
  }

  function addDelimiter() {
    const trimmed = newDelimiter.trim();
    if (!trimmed || delimiters.includes(trimmed)) return;
    delimiters = [...delimiters, trimmed];
    newDelimiter = "";
    persistDelimiters();
  }

  function removeDelimiter(index: number) {
    delimiters = delimiters.filter((_, i) => i !== index);
    persistDelimiters();
  }

  function moveDelimiter(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= delimiters.length) return;
    const next = [...delimiters];
    [next[index], next[target]] = [next[target], next[index]];
    delimiters = next;
    persistDelimiters();
  }

  async function selectAlbumArtistMode(mode: AlbumArtistMode) {
    if (mode === albumArtistMode) return;
    albumArtistMode = mode;
    try {
      await setAlbumArtistMode(mode);
    } catch (e) {
      console.error("[ArtistsSection] Failed to save album artist mode:", e);
    }
  }

  async function handleRescan() {
    if (isRescanning) return;
    isRescanning = true;
    rescanMessage = "";
    try {
      await progressiveScan.startScan(true);
      await rescanMusic();
      await loadLibrary();
      rescanSuccess = true;
      rescanMessage = $_('settings.artistRescanDone', { default: 'Library rescanned' });
      initialDelimiters = [...delimiters];
      initialAlbumArtistMode = albumArtistMode;
    } catch (e) {
      rescanSuccess = false;
      rescanMessage = `${$_('settings.artistRescanFailed', { default: 'Rescan failed' })}: ${e}`;
      console.error("[ArtistsSection] Rescan failed:", e);
      try {
        await loadLibrary();
      } catch (reloadError) {
        console.error("[ArtistsSection] Failed to reload library after rescan failure:", reloadError);
      }
    } finally {
      isRescanning = false;
      setTimeout(() => { rescanMessage = ""; }, 5000);
    }
  }
</script>

<section class="settings-section" aria-labelledby="artists-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M17 3.5a4 4 0 0 1 0 7.5" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.artists', { default: 'Artists' })}</span>
      <span class="accordion-subtitle">{$_('settings.artistsSubtitle', { default: 'Configure how multi-artist tags are split and how album artist is determined' })}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">
        <!-- delimiter rules -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.artistSplitRules', { default: 'Multi-artist splitting rules' })}</span>
          <span class="setting-description">{$_('settings.artistSplitRulesDesc', { default: 'Delimiters used to split a raw artist tag into individual artists, tried in order (top = highest priority). Escape a delimiter with a backslash (e.g. "Simon \\& Garfunkel") to keep it as one artist.' })}</span>

          <div class="delimiter-list">
            {#each delimiters as delim, i (delim)}
              <div class="delimiter-row">
                <span class="delimiter-priority">{i + 1}</span>
                <code class="delimiter-value">{delim}</code>
                <div class="delimiter-actions">
                  <button class="icon-btn" on:click={() => moveDelimiter(i, -1)} disabled={i === 0} aria-label="Move up">
                    <Icon name="chevron-up" size="xs" />
                  </button>
                  <button class="icon-btn" on:click={() => moveDelimiter(i, 1)} disabled={i === delimiters.length - 1} aria-label="Move down">
                    <Icon name="chevron-down" size="xs" />
                  </button>
                  <button class="icon-btn" on:click={() => removeDelimiter(i)} aria-label="Remove">
                    <Icon name="x" size="xs" />
                  </button>
                </div>
              </div>
            {/each}
            {#if delimiters.length === 0}
              <span class="setting-description">{$_('settings.artistSplitRulesEmpty', { default: 'No delimiters configured => artist tags will not be split.' })}</span>
            {/if}
          </div>

          <div class="delimiter-add-row">
            <input
              type="text"
              class="delimiter-input"
              placeholder={$_('settings.artistSplitRulesAddPlaceholder', { default: 'Add a delimiter, e.g. feat. or /' })}
              bind:value={newDelimiter}
              on:keydown={(e) => e.key === 'Enter' && addDelimiter()}
            />
            <button class="btn-outline-compact" on:click={addDelimiter} disabled={!newDelimiter.trim()}>
              {$_('settings.add', { default: 'Add' })}
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- album artist mode -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.albumArtistMode', { default: 'Album artist' })}</span>
          <span class="setting-description">{$_('settings.albumArtistModeDesc', { default: 'How each album\'s displayed artist is chosen when scanning' })}</span>
          <div class="segmented-pill" style="margin-top: 6px;">
            <button
              class="segment-btn"
              class:active={albumArtistMode === 'first_track'}
              on:click={() => selectAlbumArtistMode('first_track')}
            >
              {$_('settings.albumArtistFirstTrack', { default: "First track's artist" })}
            </button>
            <button
              class="segment-btn"
              class:active={albumArtistMode === 'tag_if_present'}
              on:click={() => selectAlbumArtistMode('tag_if_present')}
            >
              {$_('settings.albumArtistTag', { default: 'Album artist tag' })}
            </button>
          </div>
          <span class="setting-description" style="margin-top: 6px;">
            {albumArtistMode === 'tag_if_present'
              ? $_('settings.albumArtistTagDesc', { default: "Uses each file's Album Artist tag when present, falling back to the first track's artist otherwise." })
              : $_('settings.albumArtistFirstTrackDesc', { default: "Ignores the Album Artist tag entirely and always uses whichever track's artist was scanned first (current/default behavior)." })}
          </span>
        </div>

        {#if rescanNeeded}
          <div class="refresh-notice">
            <Icon name="info" size="xs" />
            <span>{$_('settings.rescanRequired', { default: 'Rescan your library to apply these changes' })}</span>
            <button class="refresh-btn" on:click={handleRescan} disabled={isRescanning}>
              <Icon name="refresh" size="sm" />
              {isRescanning
                ? $_('settings.rescanning', { default: 'Rescanning...' })
                : $_('settings.rescanLibrary', { default: 'Rescan library' })}
            </button>
          </div>
        {/if}
        {#if rescanMessage}
          <span class="setting-description" class:error-text={!rescanSuccess}>{rescanMessage}</span>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .delimiter-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }

  .delimiter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--surface-2, rgba(255, 255, 255, 0.04));
  }

  .delimiter-priority {
    font-size: 11px;
    opacity: 0.6;
    width: 16px;
    text-align: center;
  }

  .delimiter-value {
    flex: 1;
    font-family: inherit;
    background: none;
  }

  .delimiter-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    cursor: pointer;
    opacity: 0.7;
    border-radius: 6px;
  }

  .icon-btn:hover:not(:disabled) {
    opacity: 1;
    background: var(--surface-3, rgba(255, 255, 255, 0.08));
  }

  .icon-btn:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .delimiter-add-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .delimiter-input {
    flex: 1;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
    background: var(--surface-1, transparent);
    color: inherit;
  }

  .error-text {
    color: var(--error-color, #e5484d);
  }
</style>
