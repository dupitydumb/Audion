<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";
  import { isMobile, registerBackHandler } from "$lib/stores/mobile";
  import { addToast } from "$lib/stores/toast";
  import {
    parsePlaylistFile,
    resolvePlaylistWaterfall,
    commitPlaylistImport,
    type PlaylistImportResult,
    type ResolvedTrackItem,
  } from "$lib/services/playlist-import";
  import { searchLibrary } from "$lib/api/tauri";

  export let open: boolean = false;

  const dispatch = createEventDispatcher<{
    close: void;
    imported: { playlistId: number; name: string; trackCount: number };
  }>();

  // Stepper state: 'upload' | 'resolving' | 'report' | 'committing'
  let step: "upload" | "resolving" | "report" | "committing" = "upload";

  let fileInput: HTMLInputElement;
  let dragOver = false;
  let pasteMode = false;
  let pastedText = "";
  let importError = "";

  let progressCurrent = 0;
  let progressTotal = 0;

  let importResult: PlaylistImportResult | null = null;
  let editablePlaylistName = "";

  // Manual search for unmatched tracks
  let searchingItemId: string | null = null;
  let searchQuery = "";
  let searchResults: Array<{ id: number; title: string | null; artist: string | null }> = [];
  let isSearching = false;
  let unregisterBackHandler: (() => void) | null = null;

  $: if (open) {
    if (!unregisterBackHandler) {
      unregisterBackHandler = registerBackHandler(() => {
        if (searchingItemId !== null) {
          searchingItemId = null;
          return true;
        }
        if (step === "resolving" || step === "committing") {
          return true;
        }
        handleClose();
        return true;
      });
    }
  } else if (unregisterBackHandler) {
    unregisterBackHandler();
    unregisterBackHandler = null;
  }

  onDestroy(() => {
    if (unregisterBackHandler) {
      unregisterBackHandler();
      unregisterBackHandler = null;
    }
  });

  function handleClose() {
    if (step === "resolving" || step === "committing") return;
    open = false;
    resetState();
    dispatch("close");
  }

  function resetState() {
    step = "upload";
    dragOver = false;
    pasteMode = false;
    pastedText = "";
    importError = "";
    progressCurrent = 0;
    progressTotal = 0;
    importResult = null;
    editablePlaylistName = "";
    searchingItemId = null;
    searchResults = [];
  }

  function handleFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      processFile(input.files[0]);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  async function processFile(file: File) {
    importError = "";
    try {
      const text = await file.text();
      startWaterfall(text, file.name);
    } catch (err) {
      console.error("Failed reading playlist file:", err);
      importError = "Failed to read playlist file.";
      addToast(importError, "error");
    }
  }

  function handlePasteSubmit() {
    if (!pastedText.trim()) return;
    importError = "";
    startWaterfall(pastedText, "Pasted Playlist.m3u");
  }

  async function startWaterfall(content: string, filename: string) {
    importError = "";
    const parsed = parsePlaylistFile(content, filename);
    if (!parsed.tracks.length) {
      importError = "No valid tracks found in playlist file.";
      addToast(importError, "error");
      return;
    }

    step = "resolving";
    progressCurrent = 0;
    progressTotal = parsed.tracks.length;

    try {
      const result = await resolvePlaylistWaterfall(parsed, (done, total) => {
        progressCurrent = done;
        progressTotal = total;
      });

      importResult = result;
      editablePlaylistName = result.playlistName;
      step = "report";
    } catch (err) {
      console.error("Failed resolving playlist tracks:", err);
      importError = "Failed resolving playlist tracks.";
      addToast(importError, "error");
      step = "upload";
    }
  }

  async function handleImportCommit() {
    if (!importResult) return;
    step = "committing";

    try {
      const { playlistId, importedTrackCount } = await commitPlaylistImport(
        importResult,
        editablePlaylistName
      );

      dispatch("imported", {
        playlistId,
        name: editablePlaylistName,
        trackCount: importedTrackCount,
      });

      handleClose();
    } catch (err) {
      console.error("Failed committing playlist import:", err);
      addToast("Failed to save imported playlist", "error");
      step = "report";
    }
  }

  async function startManualSearch(item: ResolvedTrackItem) {
    searchingItemId = item.id;
    searchQuery = item.entry.artist && item.entry.artist !== "Unknown Artist"
      ? `${item.entry.title} ${item.entry.artist}`
      : item.entry.title;
    searchResults = [];
    isSearching = true;

    try {
      const res = await searchLibrary(searchQuery, 6, 0);
      if (res && res.tracks) {
        searchResults = res.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
        }));
      }
    } catch (e) {
      console.error("Manual search error:", e);
    } finally {
      isSearching = false;
    }
  }

  function selectManualMatch(item: ResolvedTrackItem, track: { id: number; title: string | null; artist: string | null }) {
    if (!importResult) return;
    item.matchSource = "local";
    item.matchedTrackId = track.id;
    item.matchedTrackTitle = track.title;
    item.matchedTrackArtist = track.artist;
    item.status = "matched";

    importResult.matchedCount++;
    importResult.unmatchedCount--;
    importResult.tier1LocalCount++;
    importResult = { ...importResult };

    searchingItemId = null;
    searchResults = [];
  }
</script>

{#if open}
  <div class="modal-backdrop" transition:fade={{ duration: 150 }}>
    <div
      class="modal-container"
      transition:scale={{ duration: 180, start: 0.95 }}
      role="dialog"
      aria-modal="true"
    >
      <!-- Header -->
      <div class="modal-header">
        <div class="header-title-group">
          <div class="header-icon">
            <Icon name="list-music" size={20} />
          </div>
          <div>
            <h2>Smart Playlist Importer</h2>
            <p class="subtitle">3-Tier Resolution: Local Library → Subsonic → Stream Providers</p>
          </div>
        </div>
        <button class="btn-icon" on:click={handleClose} aria-label="Close modal">
          <Icon name="x" size={16} />
        </button>
      </div>

      <!-- Body -->
      <div class="modal-body">
        {#if step === "upload"}
          <div class="upload-section">
            <input
              type="file"
              accept=".m3u,.m3u8,.json,.txt"
              bind:this={fileInput}
              on:change={handleFileSelected}
              style="display: none;"
            />

            {#if !pasteMode}
              <div
                class="dropzone"
                class:dragover={dragOver}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDrop}
                on:click={() => fileInput.click()}
                role="button"
                tabindex="0"
                on:keydown={(e) => e.key === "Enter" && fileInput.click()}
              >
                <div class="drop-icon">
                  <Icon name="folder" size={36} />
                </div>
                <h3>{$isMobile ? "Tap to choose a playlist file" : "Choose a playlist file or drag & drop"}</h3>
                <p>Supports .m3u, .m3u8, JSON, .sflx exports & plain text</p>
                <button type="button" class="btn-browse">Browse Files</button>
              </div>

              {#if importError}
                <div class="import-error" role="alert">
                  <Icon name="alert-circle" size={15} />
                  <span>{importError}</span>
                </div>
              {/if}

              <div class="paste-toggle">
                <span>or</span>
                <button type="button" class="btn-text-link" on:click={() => { pasteMode = true; importError = ""; }}>
                  Paste playlist text or track list directly
                </button>
              </div>
            {:else}
              <div class="paste-zone">
                <textarea
                  bind:value={pastedText}
                  placeholder="Paste playlist text here (M3U format or 'Artist - Title' per line)..."
                  rows={8}
                ></textarea>
                {#if importError}
                  <div class="import-error" role="alert">
                    <Icon name="alert-circle" size={15} />
                    <span>{importError}</span>
                  </div>
                {/if}
                <div class="paste-actions">
                  <button type="button" class="btn-secondary" on:click={() => { pasteMode = false; importError = ""; }}>
                    Back to File Upload
                  </button>
                  <button
                    type="button"
                    class="btn-primary"
                    disabled={!pastedText.trim()}
                    on:click={handlePasteSubmit}
                  >
                    Resolve Tracks
                  </button>
                </div>
              </div>
            {/if}
          </div>

        {:else if step === "resolving"}
          <div class="resolving-section">
            <div class="spinner"></div>
            <h3>Resolving Tracks across 3 Tiers...</h3>
            <p>Matching against local library, Subsonic server, and active stream plugins.</p>
            <div class="progress-bar-wrap">
              <div
                class="progress-bar-fill"
                style="width: {progressTotal ? (progressCurrent / progressTotal) * 100 : 0}%"
              ></div>
            </div>
            <span class="progress-label">{progressCurrent} / {progressTotal} tracks analyzed</span>
          </div>

        {:else if step === "report" && importResult}
          <div class="report-section">
            <!-- Playlist Title Edit -->
            <div class="name-edit-group">
              <label for="import-playlist-name">Playlist Name</label>
              <input
                id="import-playlist-name"
                type="text"
                bind:value={editablePlaylistName}
                placeholder="Playlist Name"
              />
            </div>

            <!-- Stats Bar -->
            <div class="stats-strip">
              <div class="stat-pill">
                <span class="stat-num">{importResult.total}</span>
                <span class="stat-txt">Total</span>
              </div>
              <div class="stat-pill success">
                <span class="stat-num">{importResult.tier1LocalCount}</span>
                <span class="stat-txt">Local Matches</span>
              </div>
              {#if importResult.tier2SubsonicCount > 0}
                <div class="stat-pill info">
                  <span class="stat-num">{importResult.tier2SubsonicCount}</span>
                  <span class="stat-txt">Subsonic</span>
                </div>
              {/if}
              {#if importResult.tier3ProviderCount > 0}
                <div class="stat-pill purple">
                  <span class="stat-num">{importResult.tier3ProviderCount}</span>
                  <span class="stat-txt">Plugins</span>
                </div>
              {/if}
              <div class="stat-pill warn">
                <span class="stat-num">{importResult.unmatchedCount}</span>
                <span class="stat-txt">Unmatched</span>
              </div>
            </div>

            <!-- Track Resolution List -->
            <div class="track-list-scroll">
              {#each importResult.items as item, index}
                <div class="track-item-row" class:unmatched={item.status === "unmatched"}>
                  <span class="track-idx">{index + 1}</span>
                  <div class="track-meta">
                    <span class="track-title">{item.entry.title}</span>
                    <span class="track-artist">{item.entry.artist}</span>
                  </div>

                  <!-- Source Badge -->
                  <div class="track-badge-group">
                    {#if item.matchSource === "local"}
                      <span class="badge badge-local">Local ({item.matchedTrackTitle})</span>
                    {:else if item.matchSource === "subsonic"}
                      <span class="badge badge-subsonic">Subsonic ({item.matchedTrackTitle})</span>
                    {:else if item.matchSource === "provider"}
                      <span class="badge badge-provider">{item.providerName || "Plugin"}</span>
                    {:else}
                      <span class="badge badge-unmatched">Unmatched</span>
                      <button
                        type="button"
                        class="btn-manual-search"
                        on:click={() => startManualSearch(item)}
                      >
                        Search
                      </button>
                    {/if}
                  </div>

                  <!-- Manual search popover -->
                  {#if searchingItemId === item.id}
                    <div class="manual-search-box">
                      <div class="search-input-wrap">
                        <input
                          type="text"
                          bind:value={searchQuery}
                          placeholder="Search track title or artist..."
                          on:keydown={(e) => e.key === "Enter" && startManualSearch(item)}
                        />
                        <button type="button" class="btn-sm" on:click={() => startManualSearch(item)}>
                          Go
                        </button>
                        <button type="button" class="btn-sm cancel" on:click={() => (searchingItemId = null)}>
                          ✕
                        </button>
                      </div>

                      {#if isSearching}
                        <p class="search-hint">Searching library...</p>
                      {:else if searchResults.length > 0}
                        <div class="results-dropdown">
                          {#each searchResults as candidate}
                            <button
                              type="button"
                              class="result-item"
                              on:click={() => selectManualMatch(item, candidate)}
                            >
                              <span class="res-title">{candidate.title}</span>
                              <span class="res-artist">{candidate.artist}</span>
                            </button>
                          {/each}
                        </div>
                      {:else}
                        <p class="search-hint">No matches found.</p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>

        {:else if step === "committing"}
          <div class="resolving-section">
            <div class="spinner"></div>
            <h3>Saving Playlist...</h3>
            <p>Creating playlist '{editablePlaylistName}' in your library.</p>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        {#if step === "report"}
          <button type="button" class="btn-secondary" on:click={resetState}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={!editablePlaylistName.trim() || importResult?.matchedCount === 0}
            on:click={handleImportCommit}
          >
            Import {importResult?.matchedCount || 0} Tracks
          </button>
        {:else if step === "upload"}
          <button type="button" class="btn-secondary" on:click={handleClose}>
            Cancel
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 4000);
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(16px + var(--safe-area-top, 0px)) 16px calc(16px + var(--safe-area-bottom, 0px));
  }

  .modal-container {
    width: 100%;
    max-width: 640px;
    max-height: 90dvh;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    box-shadow: var(--shadow-lg, 0 24px 60px rgba(0, 0, 0, 0.6));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    position: relative;
    flex-shrink: 0;
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }

  .header-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--surface-subtle, rgba(255, 255, 255, 0.07));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 0.78rem;
    color: var(--text-subdued);
    margin: 0.15rem 0 0 0;
  }

  .btn-icon {
    background: transparent;
    border: none;
    color: var(--text-subdued);
    padding: 0.4rem;
    cursor: pointer;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .btn-icon:hover {
    color: var(--text-primary);
    background: var(--surface-subtle-hover, rgba(255, 255, 255, 0.08));
  }

  .modal-body {
    padding: 1.25rem 1.5rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    overscroll-behavior: contain;
  }

  /* Dropzone */
  .dropzone {
    border: 2px dashed var(--border-color);
    border-radius: 14px;
    padding: 2.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    background: var(--surface-subtle, rgba(255, 255, 255, 0.02));
  }

  .dropzone:hover,
  .dropzone.dragover {
    border-color: var(--accent-primary);
    background: var(--accent-subtle, color-mix(in srgb, var(--accent-primary) 10%, transparent));
  }

  .drop-icon {
    color: var(--text-subdued);
    margin-bottom: 0.75rem;
  }

  .dropzone h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-primary);
    font-weight: 600;
  }

  .dropzone p {
    font-size: 0.8rem;
    color: var(--text-subdued);
    margin: 0.35rem 0 1rem 0;
  }

  .btn-browse {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-browse:hover {
    background: var(--bg-highlight);
  }

  .import-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 0.75rem;
    padding: 0.6rem 0.85rem;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--error-color, #f87171);
    font-size: 0.82rem;
  }

  .paste-toggle {
    text-align: center;
    margin-top: 1rem;
    font-size: 0.82rem;
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .btn-text-link {
    background: transparent;
    border: none;
    color: var(--accent-primary);
    cursor: pointer;
    text-decoration: underline;
    font-size: 0.82rem;
  }

  .paste-zone textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 0.75rem;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 0.85rem;
    resize: vertical;
  }

  .paste-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }

  /* Resolving */
  .resolving-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 2.5rem 1rem;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 1.25rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .resolving-section h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.05rem;
  }

  .resolving-section p {
    color: var(--text-subdued);
    font-size: 0.82rem;
    margin: 0.35rem 0 1.25rem 0;
  }

  .progress-bar-wrap {
    width: 100%;
    max-width: 360px;
    height: 6px;
    background: var(--bg-surface);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent-primary);
    transition: width 0.15s ease;
  }

  .progress-label {
    font-size: 0.75rem;
    color: var(--text-subdued);
    margin-top: 0.5rem;
  }

  /* Report Section */
  .name-edit-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .name-edit-group label {
    font-size: 0.78rem;
    color: var(--text-secondary);
    font-weight: 600;
  }

  .name-edit-group input {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.55rem 0.85rem;
    color: var(--text-primary);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .stats-strip {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .stat-pill {
    flex: 1;
    min-width: 80px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-num {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .stat-txt {
    font-size: 0.68rem;
    color: var(--text-subdued);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .stat-pill.success .stat-num { color: #34d399; }
  .stat-pill.info .stat-num { color: #60a5fa; }
  .stat-pill.purple .stat-num { color: #c084fc; }
  .stat-pill.warn .stat-num { color: var(--error-color, #f87171); }

  .track-list-scroll {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-base);
  }

  .track-item-row {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.04));
    gap: 0.65rem;
  }

  .track-item-row.unmatched {
    background: rgba(248, 113, 113, 0.04);
  }

  .track-idx {
    font-size: 0.75rem;
    color: var(--text-subdued);
    width: 22px;
    flex-shrink: 0;
  }

  .track-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .track-title {
    font-size: 0.85rem;
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 0.74rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-badge-group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    font-weight: 600;
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-local {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
  }

  .badge-subsonic {
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
  }

  .badge-provider {
    background: rgba(192, 132, 252, 0.15);
    color: #c084fc;
  }

  .badge-unmatched {
    background: rgba(248, 113, 113, 0.15);
    color: var(--error-color, #f87171);
  }

  .btn-manual-search {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.72rem;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }

  .btn-manual-search:hover {
    background: var(--bg-highlight);
  }

  /* Inline manual search box (never clipped by scroll container) */
  .manual-search-box {
    flex-basis: 100%;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.5rem;
  }

  .search-input-wrap {
    display: flex;
    gap: 0.35rem;
  }

  .search-input-wrap input {
    flex: 1;
    min-width: 0;
    background: var(--bg-base);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.78rem;
    color: var(--text-primary);
  }

  .btn-sm {
    background: var(--accent-primary);
    border: none;
    color: var(--text-on-accent, #fff);
    font-size: 0.75rem;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }

  .btn-sm.cancel {
    background: var(--bg-highlight);
    color: var(--text-primary);
  }

  .search-hint {
    font-size: 0.72rem;
    color: var(--text-subdued);
    margin: 0.4rem 0 0.2rem 0;
  }

  .results-dropdown {
    margin-top: 0.4rem;
    max-height: 140px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .result-item {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle, transparent);
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
  }

  .result-item:hover {
    background: var(--bg-highlight);
  }

  .res-title {
    font-size: 0.78rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .res-artist {
    font-size: 0.68rem;
    color: var(--text-secondary);
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .btn-secondary {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.55rem 1.25rem;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--bg-highlight);
  }

  .btn-primary {
    background: var(--accent-primary);
    border: none;
    border-radius: 8px;
    padding: 0.55rem 1.35rem;
    color: var(--text-on-accent, #fff);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.92;
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Mobile bottom-sheet / full-height layout */
  :global(html.layout-mobile) .modal-backdrop {
    align-items: flex-end;
    padding: var(--safe-area-top, 16px) 0 0;
  }

  :global(html.layout-mobile) .modal-container {
    max-width: 100%;
    max-height: 90dvh;
    border-radius: 20px 20px 0 0;
    border-bottom: none;
  }

  :global(html.layout-mobile) .modal-header {
    padding: 1.25rem 1rem 0.85rem;
  }

  :global(html.layout-mobile) .modal-header::before {
    content: "";
    position: absolute;
    top: 0.45rem;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-highlight);
  }

  :global(html.layout-mobile) .btn-icon {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }

  :global(html.layout-mobile) .modal-body {
    padding: 1rem;
  }

  :global(html.layout-mobile) .dropzone {
    padding: 1.75rem 1rem;
  }

  :global(html.layout-mobile) .track-list-scroll {
    max-height: 42dvh;
  }

  :global(html.layout-mobile) .btn-browse,
  :global(html.layout-mobile) .btn-manual-search,
  :global(html.layout-mobile) .btn-sm,
  :global(html.layout-mobile) .btn-primary,
  :global(html.layout-mobile) .btn-secondary {
    min-height: 44px;
  }

  :global(html.layout-mobile) .modal-footer {
    padding: 0.85rem 1rem calc(0.85rem + var(--safe-area-bottom, 0px));
  }

  :global(html.layout-mobile) .modal-footer > button {
    flex: 1;
  }
</style>
