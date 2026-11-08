<script lang="ts">
  import { _ } from "svelte-i18n";
  import {
    sourcePriorityRaw,
    setSourcePriority,
    lyricsStore,
    lyricsRenderMode,
    PRIORITY_TOKENS,
    DELETABLE_PRIORITY_TOKENS,
    type LyricsRenderMode,
  } from "$lib/stores/lyrics";
  import { addToast } from "$lib/stores/toast";
  import { confirm } from "$lib/stores/dialogs";
  import { tick, onDestroy } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { appSettings } from "$lib/stores/settings";
  import SettingRow from "./SettingRow.svelte";
  import SettingToggle from "./SettingToggle.svelte";
  import SettingReorderList, { type ReorderItem } from "./SettingReorderList.svelte";
  import AdvancedGroup from "./AdvancedGroup.svelte";

  export let open: boolean = true;

  const defaultPriorityExample = PRIORITY_TOKENS.map((t) => t.id).join('/');
  const deleteExampleTokens = [DELETABLE_PRIORITY_TOKENS[0]?.id, DELETABLE_PRIORITY_TOKENS[1]?.id].filter(Boolean);

  const SOURCE_HINTS: Record<string, string> = {
    user: 'Local .lrc files imported or added manually',
    embedded: 'Lyrics embedded in audio file metadata tags',
    applejson: 'Apple Music synchronized syllables (requires Paxsenix API key)',
    musixmatch: 'Synchronized lyrics from Musixmatch catalog',
    lrclib: 'Community synchronized and plain LRC lyrics',
    genius: 'Plain text lyrics and annotations from Genius',
  };

  // ---------------------------------------------------------------------
  // Reorderable list state
  // ---------------------------------------------------------------------
  function parseItemsFromRaw(raw: string): ReorderItem[] {
    const tokens = raw ? raw.split('/').filter(Boolean) : [];
    const known = PRIORITY_TOKENS;
    const items: ReorderItem[] = [];

    if (tokens.length === 0) {
      return known.map((t) => ({
        id: t.id,
        label: t.label,
        hint: SOURCE_HINTS[t.id],
        enabled: true,
      }));
    }

    for (const tid of tokens) {
      const k = known.find((x) => x.id === tid);
      items.push({
        id: tid,
        label: k?.label ?? tid,
        hint: SOURCE_HINTS[tid],
        enabled: true,
      });
    }

    for (const k of known) {
      if (!tokens.includes(k.id)) {
        items.push({
          id: k.id,
          label: k.label,
          hint: SOURCE_HINTS[k.id],
          enabled: false,
        });
      }
    }

    return items;
  }

  let reorderItems: ReorderItem[] = parseItemsFromRaw($sourcePriorityRaw);

  $: if ($sourcePriorityRaw !== undefined) {
    reorderItems = parseItemsFromRaw($sourcePriorityRaw);
  }

  function handleReorderChange(e: CustomEvent<{ items: ReorderItem[]; raw: string }>) {
    const result = setSourcePriority(e.detail.raw);
    if (result === 'ok') {
      priorityError = '';
    } else if (result === 'missing_api_key') {
      priorityError = $_('settings.lyricsPriorityMissingApiKey', {
        default: 'Apple Music (applejson) needs a Paxsenix API key configured in Qobuz plugin settings before it can be used.',
      });
      addToast(priorityError, 'error');
    } else {
      priorityError = $_('settings.lyricsPriorityInvalidToast', { default: 'Invalid lyrics priority format' });
    }
  }

  function handleReorderReset() {
    setSourcePriority('');
    reorderItems = parseItemsFromRaw('');
    priorityError = '';
    addToast($_('settings.lyricsPriorityResetDone', { default: 'Lyrics sources reset to default order' }), 'success');
  }

  // ---------------------------------------------------------------------
  // lyrics: render mode (dynamic alignment)
  // ---------------------------------------------------------------------
  function handleRenderModeToggle(checked: boolean) {
    const mode: LyricsRenderMode = checked ? 'dynamic' : 'legacy';
    const canAnimate = typeof document !== 'undefined' && 'startViewTransition' in document;
    if (canAnimate) {
      (document as any).startViewTransition(async () => {
        lyricsRenderMode.set(mode);
        await tick();
      });
    } else {
      lyricsRenderMode.set(mode);
    }
  }

  // ---------------------------------------------------------------------
  // lyrics: manual priority text input (power users, inside Advanced)
  // ---------------------------------------------------------------------
  const PRIORITY_INPUT_DEBOUNCE_MS = 500;
  let priorityInput = $sourcePriorityRaw;
  let lastSyncedPriority = $sourcePriorityRaw;
  let priorityError = "";
  let priorityChanged = false;
  let priorityDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  $: if ($sourcePriorityRaw !== lastSyncedPriority) {
    priorityInput = $sourcePriorityRaw;
    lastSyncedPriority = $sourcePriorityRaw;
    priorityChanged = false;
  }

  function handlePriorityInput() {
    priorityError = "";
    clearTimeout(priorityDebounceTimer);
    priorityDebounceTimer = setTimeout(() => {
      priorityChanged = priorityInput.trim() !== $sourcePriorityRaw.trim();
    }, PRIORITY_INPUT_DEBOUNCE_MS);
  }

  function handlePrioritySave() {
    const trimmed = priorityInput.trim();
    const result = setSourcePriority(trimmed);
    if (result === 'ok') {
      clearTimeout(priorityDebounceTimer);
      priorityChanged = false;
      priorityError = "";
      addToast($_('settings.lyricsPrioritySaved', { default: 'Lyrics source priority saved' }), "success");
    } else if (result === 'missing_api_key') {
      priorityError = $_('settings.lyricsPriorityMissingApiKey', {
        default: 'Apple Music (applejson) needs a Paxsenix API key configured in the Qobuz plugin settings before it can be used in the priority order.',
      });
      addToast($_('settings.lyricsPriorityMissingApiKeyToast', { default: 'Add a Paxsenix API key before using Apple Music in the priority order' }), "error");
    } else {
      priorityError = $_('settings.lyricsPriorityInvalidFormat', {
        values: { example: 'apple/imported/genius' },
        default: 'Invalid format — lowercase letters and single "/" separators only, e.g. apple/imported/genius. Unknown tokens are also rejected.',
      });
      addToast($_('settings.lyricsPriorityInvalidToast', { default: 'Invalid lyrics priority format' }), "error");
    }
  }

  onDestroy(() => clearTimeout(priorityDebounceTimer));

  // ---------------------------------------------------------------------
  // lyrics: bulk delete by token
  // ---------------------------------------------------------------------
  let deleteToken = "";
  let isBulkDeletingLyrics = false;

  function tokenDisplayLabel(token: string): string {
    const t = token.trim().toLowerCase();
    if (!t) return "";
    if (t === "all") return $_('settings.lyricsTokenAll', { default: 'All' });
    const known = PRIORITY_TOKENS.find((p) => p.id === t);
    if (known) return known.label;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  $: deleteSourcesList = [
    ...DELETABLE_PRIORITY_TOKENS.map((t) => `${t.id} (${t.label})`),
    `all (${$_('settings.lyricsTokenAll', { default: 'All' })})`,
  ].join(' · ');

  async function handleBulkDeleteLyrics() {
    const token = deleteToken.trim().toLowerCase();
    if (!token) {
      addToast($_('settings.lyricsDeleteEmptyToken', { default: 'Type a source token first' }), "error");
      return;
    }

    if (token === "embedded") {
      addToast($_('settings.lyricsDeleteEmbeddedUnsupported', {
        default: 'Embedded lyrics live in the file itself and can\'t be deleted from here',
      }), "error");
      return;
    }

    const label = tokenDisplayLabel(token);
    const message =
      token === "all"
        ? $_('settings.lyricsDeleteAllConfirm', { default: 'Delete ALL cached lyrics — every source, including imported files — for every track in your library? This cannot be undone.' })
        : $_('settings.lyricsDeleteTokenConfirm', { values: { label }, default: `Delete all "${label}" lyrics for every track in your library? This cannot be undone.` });

    const ok = await confirm(message, {
      title: token === "all"
        ? $_('settings.lyricsDeleteAllConfirmTitle', { default: 'Delete All Lyrics' })
        : $_('settings.lyricsDeleteTokenConfirmTitle', { values: { label }, default: `Delete ${label} Lyrics` }),
      confirmLabel: $_('settings.lyricsDeleteConfirmLabel', { default: 'Delete' }),
      danger: true,
    });
    if (!ok) return;

    isBulkDeletingLyrics = true;
    try {
      const { matched, deleted } = await lyricsStore.deleteLyricsByToken(token);
      if (deleted > 0 && deleted === matched) {
        addToast(
          $_('settings.lyricsDeleteSuccess', { values: { count: deleted, label, plural: deleted === 1 ? '' : 's' }, default: `Deleted ${deleted} ${label} lyrics file${deleted === 1 ? "" : "s"}` }),
          "success",
        );
        deleteToken = "";
      } else if (deleted > 0) {
        addToast(
          $_('settings.lyricsDeletePartial', {
            values: { deleted, matched, label },
            default: `Deleted ${deleted} of ${matched} ${label} lyrics files — some couldn't be removed, check the app's storage permissions`,
          }),
          "error",
        );
      } else if (matched > 0) {
        addToast(
          $_('settings.lyricsDeleteFoundButFailed', {
            values: { count: matched, label },
            default: `Found ${matched} cached ${label} lyrics file${matched === 1 ? "" : "s"} but couldn't delete ${matched === 1 ? "it" : "them"} — check the app's storage permissions`,
          }),
          "error",
        );
      } else {
        addToast(
          $_('settings.lyricsDeleteNoneFound', { values: { label }, default: `No cached ${label} lyrics found to delete` }),
          "error",
        );
      }
    } catch (err) {
      console.error("[Settings] Bulk lyrics delete failed:", err);
      addToast($_('settings.lyricsDeleteFailed', { values: { label }, default: `Failed to delete ${label} lyrics` }), "error");
    } finally {
      isBulkDeletingLyrics = false;
    }
  }
</script>

<section class="settings-section" aria-labelledby="lyrics-heading">
  <div class="section-header-row">
    <h2 class="settings-section-title" id="lyrics-heading">
      {$_('settings.lyrics', { default: 'Lyrics' })}
    </h2>
    <p class="settings-section-desc">
      {$_('settings.lyricsSubtitle', { default: 'Display, fetch, and synchronize song lyrics' })}
    </p>
  </div>

  <div class="settings-card">
    <!-- Auto-fetch toggle row -->
    <SettingRow
      id="setting-lyrics-autofetch"
      label={$_('settings.lyricsAutoFetchTitle', { default: 'Auto-fetch lyrics' })}
      description={$_('settings.lyricsAutoFetchDesc', {
        default: 'Automatically fetch lyrics from online providers when a track starts playing.',
      })}
    >
      <SettingToggle
        checked={$appSettings.lyricsAutoFetch}
        label={$_('settings.lyricsAutoFetchToggleLabel', { default: 'Toggle automatic lyrics fetching' })}
        on:change={(e) => appSettings.setLyricsAutoFetch(e.detail)}
      />
    </SettingRow>

    <!-- Source Priority Reorderable List -->
    <div id="setting-lyrics-priority">
      <SettingReorderList
        items={reorderItems}
        title={$_('settings.lyricsPriorityTitle', { default: 'Auto-fetch source priority' })}
        description={$_('settings.lyricsPriorityReorderDesc', {
          default: 'Drag or use arrows to prioritize sources. Toggle off any source to exclude it from auto-fetching.',
        })}
        on:change={handleReorderChange}
        on:reset={handleReorderReset}
      />
    </div>

    <!-- Advanced Section (Dynamic Alignment, Raw syntax, Bulk Delete) -->
    <div class="lyrics-advanced-wrap">
      <AdvancedGroup>
        <div class="advanced-card">
          <!-- Dynamic alignment toggle row -->
          <SettingRow
            id="setting-lyrics-alignment"
            label={$_('settings.lyricsRenderModeTitle', { default: 'Dynamic alignment' })}
            description={$_('settings.lyricsRenderModeDesc', {
              default: 'Align lyrics dynamically based on track structure and vocal turn.',
            })}
          >
            <SettingToggle
              checked={$lyricsRenderMode === 'dynamic'}
              label={$_('settings.lyricsRenderModeToggleLabel', { default: 'Toggle dynamic lyrics alignment' })}
              on:change={(e) => handleRenderModeToggle(e.detail)}
            />
          </SettingRow>

          <!-- Raw source priority syntax text field for power users -->
          <div class="setting-row raw-priority-row">
            <div class="setting-row-info">
              <span class="setting-row-label">
                {$_('settings.lyricsRawPriorityTitle', { default: 'Manual priority string' })}
              </span>
              <span class="setting-row-desc">
                {$_('settings.lyricsRawPriorityDesc', {
                  default: 'Slash-separated list of source IDs for scripting or advanced configuration.',
                })}
              </span>
              {#if priorityError}
                <span class="raw-priority-error" role="alert">{priorityError}</span>
              {/if}
            </div>
            <div class="raw-priority-control">
              <input
                type="text"
                class="lyrics-text-input"
                bind:value={priorityInput}
                on:input={handlePriorityInput}
                on:keydown={(e) => e.key === 'Enter' && priorityChanged && handlePrioritySave()}
                placeholder={defaultPriorityExample}
                aria-label={$_('settings.lyricsPriorityInputLabel', { default: 'Lyrics source priority string' })}
              />
              {#if priorityChanged}
                <button type="button" class="btn-save-compact" on:click={handlePrioritySave}>
                  {$_('settings.save', { default: 'Save' })}
                </button>
              {/if}
            </div>
          </div>

          <!-- Bulk delete cached lyrics -->
          <div class="setting-row raw-priority-row" id="setting-lyrics-delete">
            <div class="setting-row-info">
              <span class="setting-row-label">
                {$_('settings.lyricsDeleteTitle', { default: 'Delete cached lyrics' })}
              </span>
              <span class="setting-row-desc">
                {$_('settings.lyricsDeleteDescShort', {
                  default: 'Delete cached lyrics files across your library by provider token, or "all" to wipe all cached lyrics.',
                })}
              </span>
              <span class="delete-sources-hint">
                {$_('settings.lyricsAvailableSourcesLabel', { default: 'Available sources' })}: {deleteSourcesList}
              </span>
            </div>
            <div class="raw-delete-control">
              <input
                type="text"
                class="lyrics-text-input delete-input"
                bind:value={deleteToken}
                placeholder={deleteExampleTokens.join(', ') || 'e.g. lrclib, all'}
                aria-label={$_('settings.lyricsDeleteInputLabel', { default: 'Source token to delete' })}
                disabled={isBulkDeletingLyrics}
              />
              <button
                type="button"
                class="btn-danger-compact"
                on:click={handleBulkDeleteLyrics}
                disabled={isBulkDeletingLyrics || !deleteToken.trim()}
              >
                {#if isBulkDeletingLyrics}
                  <span class="spinner-sm"></span>
                {:else}
                  {$_('settings.delete', { default: 'Delete' })}
                {/if}
              </button>
            </div>
          </div>
        </div>
      </AdvancedGroup>
    </div>
  </div>
</section>

<style>
  .settings-section {
    margin-bottom: var(--spacing-md, 16px);
  }

  .section-header-row {
    margin-bottom: 12px;
  }

  .settings-section-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 3px 0;
    letter-spacing: -0.01em;
  }

  .settings-section-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  .settings-card {
    background-color: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-color);
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .lyrics-advanced-wrap {
    padding: 12px 16px 16px;
    border-top: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.08);
  }

  .advanced-card {
    background-color: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    margin-top: 8px;
  }

  .raw-priority-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .raw-priority-row:last-child {
    border-bottom: none;
  }

  .setting-row-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 55ch;
    flex: 1;
  }

  .setting-row-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-row-desc {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .delete-sources-hint {
    font-size: 12px;
    color: var(--text-subdued);
    margin-top: 2px;
  }

  .raw-priority-error {
    font-size: 12px;
    color: var(--color-error, #ef4444);
    margin-top: 2px;
  }

  .raw-priority-control,
  .raw-delete-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .lyrics-text-input {
    width: 220px;
    height: 34px;
    padding: 0 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-primary);
    font-size: 13px;
    font-family: monospace;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .lyrics-text-input:focus {
    border-color: var(--accent-primary);
  }

  .delete-input {
    width: 150px;
  }

  .btn-save-compact {
    height: 34px;
    padding: 0 12px;
    background: var(--accent-primary);
    color: #000;
    font-size: 13px;
    font-weight: 600;
    border: none;
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .btn-save-compact:hover {
    background: var(--accent-hover, var(--accent-primary));
  }

  .btn-danger-compact {
    height: 34px;
    padding: 0 14px;
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-danger-compact:hover:not(:disabled) {
    background: #ef4444;
    color: #fff;
  }

  .btn-danger-compact:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spinner-sm {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 580px) {
    .raw-priority-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .raw-priority-control,
    .raw-delete-control {
      width: 100%;
      justify-content: flex-start;
    }

    .lyrics-text-input {
      flex: 1;
      width: auto;
    }
  }
</style>
