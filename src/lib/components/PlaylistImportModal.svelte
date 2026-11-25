<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";
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

  let progressCurrent = 0;
  let progressTotal = 0;

  let importResult: PlaylistImportResult | null = null;
  let editablePlaylistName = "";

  // Manual search for unmatched tracks
  let searchingItemId: string | null = null;
  let searchQuery = "";
  let searchResults: Array<{ id: number; title: string | null; artist: string | null }> = [];
  let isSearching = false;

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
    try {
      const text = await file.text();
      startWaterfall(text, file.name);
    } catch (err) {
      console.error("Failed reading playlist file:", err);
    }
  }

  function handlePasteSubmit() {
    if (!pastedText.trim()) return;
    startWaterfall(pastedText, "Pasted Playlist.m3u");
  }

  async function startWaterfall(content: string, filename: string) {
    const parsed = parsePlaylistFile(content, filename);
    if (!parsed.tracks.length) {
      alert("No valid tracks found in playlist file.");
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
                <h3>Choose a playlist file or drag & drop</h3>
                <p>Supports .m3u, .m3u8, JSON, .sflx exports & plain text</p>
                <button type="button" class="btn-browse">Browse Files</button>
              </div>

              <div class="paste-toggle">
                <span>or</span>
                <button type="button" class="btn-text-link" on:click={() => (pasteMode = true)}>
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
                <div class="paste-actions">
                  <button type="button" class="btn-secondary" on:click={() => (pasteMode = false)}>
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
    z-index: 9999;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .modal-container {
    width: 100%;
    max-width: 640px;
    max-height: 88vh;
    background: rgba(26, 26, 32, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .header-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #6366f1);
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0;
    color: #fff;
  }

  .subtitle {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.55);
    margin: 0.15rem 0 0 0;
  }

  .btn-icon {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    padding: 0.4rem;
    cursor: pointer;
    border-radius: 8px;
  }

  .btn-icon:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .modal-body {
    padding: 1.25rem 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  /* Dropzone */
  .dropzone {
    border: 2px dashed rgba(255, 255, 255, 0.18);
    border-radius: 14px;
    padding: 2.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    background: rgba(255, 255, 255, 0.02);
  }

  .dropzone:hover,
  .dropzone.dragover {
    border-color: var(--accent, #6366f1);
    background: rgba(99, 102, 241, 0.06);
  }

  .drop-icon {
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 0.75rem;
  }

  .dropzone h3 {
    margin: 0;
    font-size: 1rem;
    color: #fff;
    font-weight: 600;
  }

  .dropzone p {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.5);
    margin: 0.35rem 0 1rem 0;
  }

  .btn-browse {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-browse:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .paste-toggle {
    text-align: center;
    margin-top: 1rem;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .btn-text-link {
    background: transparent;
    border: none;
    color: var(--accent, #818cf8);
    cursor: pointer;
    text-decoration: underline;
    font-size: 0.82rem;
  }

  .paste-zone textarea {
    width: 100%;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 0.75rem;
    color: #fff;
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
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent, #6366f1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 1.25rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .resolving-section h3 {
    margin: 0;
    color: #fff;
    font-size: 1.05rem;
  }

  .resolving-section p {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.82rem;
    margin: 0.35rem 0 1.25rem 0;
  }

  .progress-bar-wrap {
    width: 100%;
    max-width: 360px;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent, #6366f1);
    transition: width 0.15s ease;
  }

  .progress-label {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
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
    color: rgba(255, 255, 255, 0.6);
    font-weight: 600;
  }

  .name-edit-group input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    padding: 0.55rem 0.85rem;
    color: #fff;
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
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-num {
    font-size: 1.1rem;
    font-weight: 700;
    color: #fff;
  }

  .stat-txt {
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .stat-pill.success .stat-num { color: #34d399; }
  .stat-pill.info .stat-num { color: #60a5fa; }
  .stat-pill.purple .stat-num { color: #c084fc; }
  .stat-pill.warn .stat-num { color: #f87171; }

  .track-list-scroll {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.2);
  }

  .track-item-row {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    gap: 0.65rem;
  }

  .track-item-row.unmatched {
    background: rgba(248, 113, 113, 0.04);
  }

  .track-idx {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.35);
    width: 22px;
  }

  .track-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .track-title {
    font-size: 0.85rem;
    color: #fff;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 0.74rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-badge-group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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
    color: #f87171;
  }

  .btn-manual-search {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }

  .btn-manual-search:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  /* Manual search popover */
  .manual-search-box {
    position: absolute;
    right: 0.75rem;
    top: 100%;
    z-index: 10;
    background: #1c1c24;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 0.5rem;
    width: 280px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
  }

  .search-input-wrap {
    display: flex;
    gap: 0.35rem;
  }

  .search-input-wrap input {
    flex: 1;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    font-size: 0.78rem;
    color: #fff;
  }

  .btn-sm {
    background: var(--accent, #6366f1);
    border: none;
    color: #fff;
    font-size: 0.75rem;
    padding: 0.3rem 0.55rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-sm.cancel {
    background: rgba(255, 255, 255, 0.1);
  }

  .search-hint {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.45);
    margin: 0.4rem 0 0.2rem 0;
  }

  .results-dropdown {
    margin-top: 0.4rem;
    max-height: 120px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .result-item {
    background: rgba(255, 255, 255, 0.05);
    border: none;
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
  }

  .result-item:hover {
    background: rgba(99, 102, 241, 0.25);
  }

  .res-title {
    font-size: 0.78rem;
    color: #fff;
    font-weight: 500;
  }

  .res-artist {
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 0.55rem 1.25rem;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .btn-primary {
    background: var(--accent, #6366f1);
    border: none;
    border-radius: 8px;
    padding: 0.55rem 1.35rem;
    color: #fff;
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
</style>
