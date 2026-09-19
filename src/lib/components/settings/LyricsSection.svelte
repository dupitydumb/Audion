<script lang="ts">
  import { _ } from "svelte-i18n";
  import { sourcePriorityRaw, setSourcePriority, lyricsStore, lyricsRenderMode, PRIORITY_TOKENS, DELETABLE_PRIORITY_TOKENS, type LyricsRenderMode } from "$lib/stores/lyrics";
  import { addToast } from "$lib/stores/toast";
  import { confirm } from "$lib/stores/dialogs";
  import { slide } from "svelte/transition";
  import { createEventDispatcher, tick, onDestroy } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { appSettings } from "$lib/stores/settings";

  export let open: boolean = false;
  const dispatch = createEventDispatcher();

  // full default priority order, e.g. "user/embedded/applejson/musixmatch/lrclib/genius"
  const defaultPriorityExample = PRIORITY_TOKENS.map((t) => t.id).join('/');
  const deleteExampleTokens = [DELETABLE_PRIORITY_TOKENS[0]?.id, DELETABLE_PRIORITY_TOKENS[1]?.id].filter(Boolean);

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

  const PRIORITY_INPUT_DEBOUNCE_MS = 500;

  let priorityInput = $sourcePriorityRaw;
  let lastSyncedPriority = $sourcePriorityRaw;
  let priorityError = "";
  let priorityChanged = false;
  let priorityDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Keep the local field in sync with the store when it changes elsewhere
  // (e.g. reset from another tab), but never clobber an in-progress edit
  // this only depends on the store value, not priorityInput
  // => it won't re-fire on every keystroke
  $: if ($sourcePriorityRaw !== lastSyncedPriority) {
    priorityInput = $sourcePriorityRaw;
    lastSyncedPriority = $sourcePriorityRaw;
    priorityChanged = false;
  }

  // only check for a real change once the user stops typing
  // => the save button doesn't flicker in on every keystroke
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
    console.log("[LyricsSection] Priority save attempt:", trimmed, "=> result:", result);
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
      console.warn("[LyricsSection] Priority save rejected, invalid format:", trimmed);
    }
  }

  function handlePriorityReset() {
    console.log("[LyricsSection] Priority reset to default, previous value:", priorityInput);
    clearTimeout(priorityDebounceTimer);
    priorityInput = "";
    priorityChanged = priorityInput.trim() !== $sourcePriorityRaw.trim();
    priorityError = "";
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
    // unrecognized token (e.g. a source that's since been removed)
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ==============================
  // lyrics: available-source text lines
  // ==============================

  $: prioritySourcesList = PRIORITY_TOKENS.map((t) => `${t.id} (${t.label})`).join(' · ');
  $: deleteSourcesList = [
    ...DELETABLE_PRIORITY_TOKENS.map((t) => `${t.id} (${t.label})`),
    `all (${$_('settings.lyricsTokenAll', { default: 'All' })})`,
  ].join(' · ');

  async function handleBulkDeleteLyrics() {
    const token = deleteToken.trim().toLowerCase();
    if (!token) {
      console.warn("[LyricsSection] Bulk delete blocked, empty token");
      addToast($_('settings.lyricsDeleteEmptyToken', { default: 'Type a source token first' }), "error");
      return;
    }

    // embedded lyrics live in the track's own file tags
    // be explicit that it is not currently deletable
    if (token === "embedded") {
      console.warn("[LyricsSection] Bulk delete blocked, embedded is not deletable");
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
    if (!ok) {
      console.log("[LyricsSection] Bulk delete cancelled by user, token:", token);
      return;
    }

    console.log("[LyricsSection] Bulk delete starting, token:", token);
    isBulkDeletingLyrics = true;
    try {
      const { matched, deleted } = await lyricsStore.deleteLyricsByToken(token);
      console.log("[LyricsSection] Bulk delete finished, token:", token, "matched:", matched, "deleted:", deleted);
      if (deleted > 0 && deleted === matched) {
        addToast(
          $_('settings.lyricsDeleteSuccess', { values: { count: deleted, label, plural: deleted === 1 ? '' : 's' }, default: `Deleted ${deleted} ${label} lyrics file${deleted === 1 ? "" : "s"}` }),
          "success",
        );
        deleteToken = "";
      } else if (deleted > 0) {
        // some matched files were deleted, some weren't => not full success,
        // keep the token around so the user can retry
        addToast(
          $_('settings.lyricsDeletePartial', {
            values: { deleted, matched, label },
            default: `Deleted ${deleted} of ${matched} ${label} lyrics files — some couldn't be removed, check the app's storage permissions`,
          }),
          "error",
        );
      } else if (matched > 0) {
        // files exist and were matched, but every removal attempt failed
        // (most likely a storage permission issue)
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
  <button class="accordion-trigger" on:click={() => dispatch('toggle')} aria-expanded={open}>
    <Icon name="lyrics" size="lg" className="accordion-icon" />
    <div class="accordion-header-info">
      <span class="accordion-title">{$_('settings.lyrics', { default: 'Lyrics' })}</span>
      <span class="accordion-subtitle">{$_('settings.lyricsSubtitle', { default: 'Manage automatic source priority and cached lyrics' })}</span>
    </div>
    <Icon name="chevron-down" size={16} className="accordion-chevron {open ? 'rotated' : ''}" />
  </button>
  {#if open}
    <div class="section-body" transition:slide|local>
      <div class="settings-card">

        <!-- auto-fetch toggle -->
        <div class="toggle-container">
          <div class="toggle-info">
            <span class="setting-title">{$_('settings.lyricsAutoFetchTitle', { default: 'Auto-fetch lyrics' })}</span>
            <span class="setting-description">
              {$_('settings.lyricsAutoFetchDesc', {
                default: 'Automatically search for lyrics when a track starts playing. Turn off to save bandwidth or prevent unwanted lookups.',
              })}
            </span>
          </div>
          <button
            class="toggle-btn"
            class:active={$appSettings.lyricsAutoFetch}
            on:click={() => appSettings.setLyricsAutoFetch(!$appSettings.lyricsAutoFetch)}
            role="switch"
            aria-checked={$appSettings.lyricsAutoFetch}
            aria-label={$_('settings.lyricsAutoFetchToggleLabel', { default: 'Toggle automatic lyrics fetching' })}
          >
            <div class="toggle-handle"></div>
          </button>
        </div>

        <div class="divider"></div>

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
              values: { example: defaultPriorityExample },
              default: `Controls the order sources are tried automatically, e.g. ${defaultPriorityExample}. Lowercase letters and single "/" separators only. Leave blank to use the default order shown below. Manual source selection in the lyrics panel is unaffected.`,
            })}
          </span>
          <p class="lyrics-source-list">
            <span class="lyrics-source-list-label">{$_('settings.lyricsAvailableSourcesLabel', { default: 'Available sources' })}:</span>
            {prioritySourcesList}
          </p>
          <div class="lyrics-priority-row">
            <input
              type="text"
              class="lyrics-text-input"
              bind:value={priorityInput}
              on:input={handlePriorityInput}
              on:keydown={(e) => e.key === 'Enter' && priorityChanged && handlePrioritySave()}
              placeholder={$_('settings.lyricsPriorityPlaceholder', { default: defaultPriorityExample })}
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
              values: { tokenA: deleteExampleTokens[0], tokenB: deleteExampleTokens[1] },
              default: `Permanently delete every cached lyrics file for a given source, across your whole library. Type a source token (e.g. ${deleteExampleTokens.join(', ')}, or all for everything).`,
            })}
          </span>
          <p class="lyrics-source-list">
            <span class="lyrics-source-list-label">{$_('settings.lyricsAvailableSourcesLabel', { default: 'Available sources' })}:</span>
            {deleteSourcesList}
          </p>
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
                <Icon name="trash" size={16} />
              {/if}
            </button>
          </div>
        </div>

      </div>
    </div>
  {/if}
</section>