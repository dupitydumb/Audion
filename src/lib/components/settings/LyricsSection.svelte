<script lang="ts">
  import { _ } from "svelte-i18n";
  import { sourcePriorityRaw, setSourcePriority, lyricsStore, lyricsRenderMode, type LyricsRenderMode } from "$lib/stores/lyrics";
  import { addToast } from "$lib/stores/toast";
  import { confirm } from "$lib/stores/dialogs";
  import { slide } from "svelte/transition";
  import { createEventDispatcher, tick } from "svelte";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // =================================================
  // lyrics: render mode (legacy / dynamic alignment)
  // =================================================

  function handleRenderModeToggle() {
    const mode: LyricsRenderMode = $lyricsRenderMode === 'dynamic' ? 'legacy' : 'dynamic';

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
  // lyrics: source priority
  // ---------------------------------------------------------------------

  let priorityInput = $sourcePriorityRaw;
  let priorityChanged = false;
  let priorityError = "";

  // Keep the local field in sync with the store when it changes elsewhere
  // (e.g. reset from another tab), but never clobber an in-progress edit
  $: if (!priorityChanged && priorityInput !== $sourcePriorityRaw) {
    priorityInput = $sourcePriorityRaw;
  }

  function handlePriorityInput() {
    priorityChanged = priorityInput.trim() !== $sourcePriorityRaw.trim();
    priorityError = "";
  }

  function handlePrioritySave() {
    const ok = setSourcePriority(priorityInput.trim());
    if (ok) {
      priorityChanged = false;
      priorityError = "";
      addToast($_('settings.lyricsPrioritySaved', { default: 'Lyrics source priority saved' }), "success");
    } else {
      priorityError = $_('settings.lyricsPriorityInvalidFormat', {
        values: { example: 'apple/imported/genius' },
        default: 'Invalid format — lowercase letters and single "/" separators only, e.g. apple/imported/genius. Unknown tokens are also rejected.',
      });
      addToast($_('settings.lyricsPriorityInvalidToast', { default: 'Invalid lyrics priority format' }), "error");
    }
  }

  function handlePriorityReset() {
    priorityInput = "";
    priorityChanged = priorityInput.trim() !== $sourcePriorityRaw.trim();
    priorityError = "";
  }

  // ---------------------------------------------------------------------
  // lyrics: bulk delete by token
  // ---------------------------------------------------------------------

  let deleteToken = "";
  let isBulkDeletingLyrics = false;

  function tokenDisplayLabel(token: string): string {
    const t = token.trim().toLowerCase();
    if (!t) return "";
    if (t === "all") return $_('settings.lyricsTokenAll', { default: 'All' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  async function handleBulkDeleteLyrics() {
    const token = deleteToken.trim().toLowerCase();
    if (!token) {
      addToast($_('settings.lyricsDeleteEmptyToken', { default: 'Type a source token first' }), "error");
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
      const count = await lyricsStore.deleteLyricsByToken(token);
      addToast(
        count > 0
          ? $_('settings.lyricsDeleteSuccess', { values: { count, label, plural: count === 1 ? '' : 's' }, default: `Deleted ${count} ${label} lyrics file${count === 1 ? "" : "s"}` })
          : $_('settings.lyricsDeleteNoneFound', { values: { label }, default: `No cached ${label} lyrics found to delete` }),
        count > 0 ? "success" : "error",
      );
      if (count > 0) deleteToken = "";
    } catch (err) {
      console.error("[Settings] Bulk lyrics delete failed:", err);
      addToast($_('settings.lyricsDeleteFailed', { values: { label }, default: `Failed to delete ${label} lyrics` }), "error");
    } finally {
      isBulkDeletingLyrics = false;
    }
  }
</script>

<section class="settings-section" aria-labelledby="lyrics-heading">
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <svg class="accordion-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.lyrics', { default: 'Lyrics' })}</span>
      <span class="accordion-subtitle">{$_('settings.lyricsSubtitle', { default: 'Manage automatic source priority and cached lyrics' })}</span>
    </div>
    <svg class="accordion-chevron" class:rotated={open} viewBox="0 0 24 24" width="16" height="16">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">

        <!-- render mode -->
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.lyricsRenderModeTitle', { default: 'Dynamic alignment' })}</span>
            <span class="setting-description">
              {$_('settings.lyricsRenderModeDesc', {
                default: 'Structure-aware line alignment based on surrounding lyrics. Turn off to use the legacy behavior: featured-artist lines always right-aligned, everything else always left-aligned.',
              })}
            </span>
          </div>
          <button
            class="toggle-btn"
            class:active={$lyricsRenderMode === 'dynamic'}
            on:click={handleRenderModeToggle}
            role="switch"
            aria-checked={$lyricsRenderMode === 'dynamic'}
            aria-label={$_('settings.lyricsRenderModeToggleLabel', { default: 'Toggle dynamic lyrics alignment' })}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        <div class="divider"></div>

        <!-- source priority -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.lyricsPriorityTitle', { default: 'Auto-fetch source priority' })}</span>
          <span class="setting-description">
            {$_('settings.lyricsPriorityDesc', {
              values: { example: 'apple/imported/genius' },
              default: 'Controls the order sources are tried automatically, e.g. apple/imported/genius. Lowercase letters and single "/" separators only. Leave blank to use the default order. Manual source selection in the lyrics panel is unaffected.',
            })}
          </span>
          <div class="lyrics-priority-row">
            <input
              type="text"
              class="lyrics-text-input"
              bind:value={priorityInput}
              on:input={handlePriorityInput}
              on:keydown={(e) => e.key === 'Enter' && priorityChanged && handlePrioritySave()}
              placeholder={$_('settings.lyricsPriorityPlaceholder', { default: 'apple/imported/genius' })}
              aria-label={$_('settings.lyricsPriorityInputLabel', { default: 'Lyrics source priority' })}
            />
            {#if priorityChanged}
              <button class="btn-outline-compact" on:click={handlePrioritySave}>{$_('settings.save', { default: 'Save' })}</button>
            {/if}
          </div>
          {#if priorityInput.trim() !== '' && priorityChanged}
            <button class="lyrics-priority-clear" on:click={handlePriorityReset}>{$_('settings.lyricsPriorityResetToDefault', { default: 'Reset to default' })}</button>
          {/if}
          {#if priorityError}
            <p class="error-message" role="alert">{priorityError}</p>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- bulk delete by token -->
        <div class="inner-section">
          <span class="setting-title">{$_('settings.lyricsDeleteTitle', { default: 'Delete cached lyrics' })}</span>
          <span class="setting-description">
            {$_('settings.lyricsDeleteDesc', {
              values: { apple: 'apple', imported: 'imported', all: 'all' },
              default: 'Permanently delete every cached lyrics file for a given source, across your whole library. Type a source token (e.g. apple, imported, or all for everything).',
            })}
          </span>
          <div class="lyrics-delete-row">
            <span class="lyrics-delete-label">{$_('settings.lyricsDeleteAllLabel', { default: 'Delete all' })}</span>
            <input
              type="text"
              class="lyrics-text-input lyrics-token-input"
              bind:value={deleteToken}
              placeholder={$_('settings.lyricsDeleteTokenPlaceholder', { default: 'token' })}
              aria-label={$_('settings.lyricsDeleteTokenInputLabel', { default: 'Lyrics source token to delete' })}
              disabled={isBulkDeletingLyrics}
            />
            <span class="lyrics-delete-label">{$_('settings.lyricsDeleteLyricsLabel', { default: 'lyrics' })}</span>
            <button
              class="lyrics-delete-btn"
              on:click={handleBulkDeleteLyrics}
              disabled={isBulkDeletingLyrics || !deleteToken.trim()}
              aria-label={$_('settings.lyricsDeleteButtonLabel', { default: 'Delete lyrics for this source' })}
              title={$_('settings.lyricsDeleteButtonTitle', { default: 'Delete all cached lyrics for this source' })}
            >
              {#if isBulkDeletingLyrics}
                <div class="lyrics-delete-spinner"></div>
              {:else}
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M6 7h12v2H6zm2 3h2v9H8zm6 0h2v9h-2zM9 4h6l1 2H8z"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>

      </div>
    </div>
  {/if}
</section>