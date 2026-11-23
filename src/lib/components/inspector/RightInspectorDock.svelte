<script lang="ts">
  import { _ } from "svelte-i18n";
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import {
    isInspectorOpen,
    activeInspectorTab,
    closeInspector,
    type InspectorTab,
  } from "$lib/stores/inspector";
  import {
    currentTrack,
    isPlaying,
    queue,
    queueIndex,
    clearUpcoming,
  } from "$lib/stores/player";
  import {
    albums,
    resolveTrackCover,
  } from "$lib/stores/library";
  import { customArtworks } from "$lib/stores/customArtwork";
  import {
    lyricsData,
    lyricsLoading,
    lyricsError,
    availableSources,
    selectedSource,
    initLyricsSync,
    destroyLyricsSync,
    switchLyricsSource,
    fetchLyricsForTrack,
    importLyricsContent,
    lyricsStore,
    type LyricsQueryOverride,
  } from "$lib/stores/lyrics";
  import { LYRICS_SOURCES, type LyricsSource } from "$lib/lyrics";
  import {
    isTauri,
    getAlbum,
    getAudioTelemetry,
    getArtistMusicBrainzInfo,
    type AudioTelemetry,
    type MbArtistInfo,
    type Track,
  } from "$lib/api/tauri";
  import { goToAlbumDetail, goToArtistDetail } from "$lib/stores/view";
  import { addToast } from "$lib/stores/toast";
  import Icon from "$lib/components/Icon.svelte";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import AudioQualityBadge from "$lib/components/AudioQualityBadge.svelte";
  import LyricsView from "$lib/components/LyricsView.svelte";
  import LyricCardModal from "$lib/components/LyricCardModal.svelte";
  import QueuePanel from "$lib/components/QueuePanel.svelte";

  // =========================================================================
  // Telemetry & Audio Specs
  // =========================================================================
  let telemetry: AudioTelemetry | null = null;
  let telemetryInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchTelemetry() {
    if (!isTauri()) return;
    try {
      const data = await getAudioTelemetry();
      if (data) {
        telemetry = data;
      }
    } catch {
      // ignore
    }
  }

  function startTelemetryPolling() {
    if (telemetryInterval) return;
    fetchTelemetry();
    telemetryInterval = setInterval(fetchTelemetry, 3000);
  }

  function stopTelemetryPolling() {
    if (telemetryInterval) {
      clearInterval(telemetryInterval);
      telemetryInterval = null;
    }
  }

  $: if ($isInspectorOpen && $activeInspectorTab === "now_playing") {
    startTelemetryPolling();
  } else {
    stopTelemetryPolling();
  }

  // =========================================================================
  // Cover Art Resolution
  // =========================================================================
  let albumArt: string | null = null;

  $: if ($currentTrack) {
    void loadCover($currentTrack, $customArtworks);
  } else {
    albumArt = null;
  }

  async function loadCover(track: Track, _customs?: unknown) {
    try {
      let src = resolveTrackCover(track);
      if (!src && track.album_id) {
        const album = await getAlbum(track.album_id);
        if (get(currentTrack)?.id !== track.id) return;
        src = resolveTrackCover(track, album);
      }
      albumArt = src;
    } catch {
      albumArt = null;
    }
  }

  // =========================================================================
  // Artist MusicBrainz Bio & Info
  // =========================================================================
  let mbInfo: MbArtistInfo | null = null;
  let loadingBio = false;
  let lastBioArtist = "";

  async function fetchArtistBio(artistName?: string | null) {
    if (!artistName || !isTauri()) {
      mbInfo = null;
      return;
    }
    const cleanName = artistName.trim();
    if (!cleanName || cleanName === lastBioArtist) return;
    lastBioArtist = cleanName;
    loadingBio = true;
    try {
      mbInfo = await getArtistMusicBrainzInfo(cleanName);
    } catch {
      mbInfo = null;
    } finally {
      loadingBio = false;
    }
  }

  $: if ($isInspectorOpen && $activeInspectorTab === "now_playing" && $currentTrack?.artist) {
    void fetchArtistBio($currentTrack.artist);
  } else if (!$currentTrack?.artist) {
    mbInfo = null;
    lastBioArtist = "";
  }

  // Format sample rate into clean readable string
  function formatSampleRate(hz?: number | null): string {
    if (!hz || hz <= 0) return "—";
    if (hz >= 1000) {
      const khz = (hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1);
      return `${khz} kHz`;
    }
    return `${hz} Hz`;
  }

  const LOSSLESS_CODECS = new Set([
    "FLAC",
    "ALAC",
    "WAV",
    "AIFF",
    "DSD",
    "PCM",
  ]);

  $: rawCodec = (telemetry?.codec || $currentTrack?.format || "").toUpperCase();
  $: isLossless = LOSSLESS_CODECS.has(rawCodec);
  $: bitDepthDisplay = telemetry?.bit_depth
    ? `${telemetry.bit_depth}-bit`
    : $currentTrack?.bit_depth
    ? `${$currentTrack.bit_depth}-bit`
    : isLossless
    ? "16/24-bit"
    : "16-bit";
  $: sampleRateDisplay = formatSampleRate(
    telemetry?.sample_rate || $currentTrack?.sample_rate || 44100
  );
  $: channelsDisplay = telemetry?.channels
    ? telemetry.channels === 1
      ? "Mono (1 ch)"
      : telemetry.channels === 2
      ? "Stereo (2 ch)"
      : `${telemetry.channels} ch`
    : "Stereo";

  // =========================================================================
  // Lyrics Handling & Source Menu
  // =========================================================================
  let sourceMenuOpen = false;

  $: ALL_SOURCE_LABELS = {
    user: $_("lyrics.imported", { default: "Imported" }),
    embedded: $_("lyrics.embedded", { default: "Embedded" }),
    ...Object.fromEntries(
      LYRICS_SOURCES.map((s: LyricsSource) => [s.id, s.label])
    ),
  } as Record<string, string>;

  $: showSourcePicker =
    LYRICS_SOURCES.length > 1 || $availableSources.includes("embedded");
  $: activeSourceLabel = $lyricsData
    ? ALL_SOURCE_LABELS[$lyricsData.source] ?? $lyricsData.source
    : $selectedSource
    ? ALL_SOURCE_LABELS[$selectedSource] ?? $selectedSource
    : "";

  $: hasLineSync =
    !!$lyricsData &&
    !$lyricsData.hasWordSync &&
    !$lyricsData.hasSyllableSync &&
    $lyricsData.lines.some((l) => l.time > 0);

  async function handleSourceSelect(sourceId: string) {
    sourceMenuOpen = false;
    if ($lyricsData?.source === sourceId) return;
    selectedSource.set(sourceId);
    await switchLyricsSource(sourceId);
  }

  async function handleDeleteSource(sourceId: string, label: string, event: MouseEvent) {
    event.stopPropagation();
    const ok = await lyricsStore.deleteLyricsForSource(sourceId);
    if (ok) {
      addToast(`Deleted ${label} lyrics`, "success");
    } else {
      addToast(`Failed to delete ${label} lyrics`, "error");
    }
  }

  // Lyric Card Modal & Lyrics Import
  let showLyricCardModal = false;
  const IMPORT_ACCEPT = ".lrc,.ttml,.xml,.srt,.json";

  async function handleImportLyrics() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMPORT_ACCEPT;
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
    await new Promise((resolve) => {
      input.onchange = resolve;
    });
    const file = input.files?.[0];
    document.body.removeChild(input);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      if (!content) return;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "lrc";
      const format: "lrc" | "ttml" | "srt" | "json" =
        ext === "ttml" || ext === "xml"
          ? "ttml"
          : ext === "srt"
            ? "srt"
            : ext === "json"
              ? "json"
              : "lrc";
      await importLyricsContent(content, format);
      addToast($_("lyrics.importedSuccess", { default: "Lyrics imported successfully" }), "success");
    };
    reader.readAsText(file);
  }

  // Custom search query for lyrics
  $: defaultQueryText = $currentTrack
    ? `${$currentTrack.title || "Unknown"} - ${$currentTrack.artist || "Unknown"}`
    : "";

  let customQueryInput = "";
  let customQueryChanged = false;
  let customQueryTrackPath: string | null = null;
  let customQueryDebounce: ReturnType<typeof setTimeout> | null = null;

  $: if ($currentTrack && $currentTrack.path !== customQueryTrackPath) {
    customQueryTrackPath = $currentTrack.path;
    customQueryInput = defaultQueryText;
    customQueryChanged = false;
  }

  function handleCustomQueryInput() {
    customQueryChanged = false;
    if (customQueryDebounce) clearTimeout(customQueryDebounce);
    customQueryDebounce = setTimeout(() => {
      const trimmed = customQueryInput.trim();
      customQueryChanged = trimmed.length > 0 && trimmed !== defaultQueryText.trim();
    }, 200);
  }

  async function retryWithCustomQuery() {
    if (!$currentTrack) return;
    if (customQueryDebounce) clearTimeout(customQueryDebounce);

    const resolved = customQueryInput
      .replace(/\$title/gi, $currentTrack.title ?? "")
      .replace(/\$artist/gi, $currentTrack.artist ?? "")
      .replace(/\$album/gi, $currentTrack.album ?? "")
      .trim();

    if (!resolved) return;

    let title = resolved;
    let artist: string | undefined;
    const sepIdx = resolved.indexOf(" - ");
    if (sepIdx !== -1) {
      title = resolved.slice(0, sepIdx).trim();
      artist = resolved.slice(sepIdx + 3).trim();
    }

    customQueryChanged = false;
    const override: LyricsQueryOverride = { title, artist };
    await fetchLyricsForTrack(override);
  }

  // =========================================================================
  // Queue stats
  // =========================================================================
  $: upcomingCount = Math.max(0, $queue.length - $queueIndex - 1);

  // Lifecycle
  onMount(() => {
    initLyricsSync();
  });

  onDestroy(() => {
    stopTelemetryPolling();
    destroyLyricsSync();
    if (customQueryDebounce) clearTimeout(customQueryDebounce);
  });
</script>

<svelte:window on:click={() => (sourceMenuOpen = false)} />

<aside
  class="right-inspector-dock"
  class:closed={!$isInspectorOpen}
  aria-label="Inspector Dock"
>
  <!-- Segmented Header Tabs -->
  <header class="inspector-header">
    <div class="segmented-control" role="tablist">
      <button
        class="tab-btn"
        class:active={$activeInspectorTab === "now_playing"}
        role="tab"
        aria-selected={$activeInspectorTab === "now_playing"}
        on:click={() => activeInspectorTab.set("now_playing")}
      >
        <Icon name="music" size={14} />
        <span>Now Playing</span>
      </button>

      <button
        class="tab-btn"
        class:active={$activeInspectorTab === "lyrics"}
        role="tab"
        aria-selected={$activeInspectorTab === "lyrics"}
        on:click={() => activeInspectorTab.set("lyrics")}
      >
        <Icon name="lyrics" size={14} />
        <span>Lyrics</span>
      </button>

      <button
        class="tab-btn"
        class:active={$activeInspectorTab === "queue"}
        role="tab"
        aria-selected={$activeInspectorTab === "queue"}
        on:click={() => activeInspectorTab.set("queue")}
      >
        <Icon name="queue" size={14} />
        <span>Queue</span>
        {#if upcomingCount > 0}
          <span class="tab-badge">{upcomingCount}</span>
        {/if}
      </button>
    </div>

    <button
      class="close-btn"
      on:click={closeInspector}
      title="Close inspector"
      aria-label="Close inspector"
    >
      <Icon name="x" size={16} />
    </button>
  </header>

  <!-- TAB 1: NOW PLAYING -->
  {#if $activeInspectorTab === "now_playing"}
    <div class="inspector-scrollable">
      {#if $currentTrack}
        <div class="now-playing-content">
          <!-- Album Cover Art -->
          <div class="dock-cover-wrapper">
            {#if albumArt}
              <img
                src={albumArt}
                alt={$currentTrack.album || "Album artwork"}
                class="dock-cover-image"
                loading="eager"
                on:error={() => (albumArt = null)}
              />
            {:else}
              <div class="dock-cover-placeholder">
                <Icon name="music" size={48} />
              </div>
            {/if}
          </div>

          <!-- Track Metadata -->
          <div class="track-header">
            <h2 class="track-title" title={$currentTrack.title}>
              {$currentTrack.title || $_("player.unknownTitle", { default: "Unknown Title" })}
            </h2>
            <div class="track-artist-row">
              <ArtistLinks
                artist={$currentTrack.artist || $_("common.unknownArtist", { default: "Unknown Artist" })}
                artists={$currentTrack.artists}
                chipClass="inspector-artist-chip"
                marquee
                marqueeTrigger="hover"
                resetKey={$currentTrack.id}
                on:select={(e) => goToArtistDetail(e.detail)}
              />
            </div>
            {#if $currentTrack.album}
              <button
                class="track-album-link"
                on:click={() => $currentTrack?.album_id && goToAlbumDetail($currentTrack.album_id)}
                title="View album"
              >
                {$currentTrack.album}
              </button>
            {/if}
          </div>

          <!-- Audio Specifications Card -->
          <section class="specs-card">
            <div class="specs-card-header">
              <span class="specs-card-title">Audio Specs</span>
              <AudioQualityBadge variant="compact" />
            </div>

            <div class="specs-grid">
              <div class="spec-tile">
                <span class="spec-label">Format</span>
                <span class="spec-value highlight">
                  {rawCodec || "Audio"}
                  {#if isLossless}
                    <span class="lossless-pill">Lossless</span>
                  {/if}
                </span>
              </div>

              <div class="spec-tile">
                <span class="spec-label">Bit Depth</span>
                <span class="spec-value">{bitDepthDisplay}</span>
              </div>

              <div class="spec-tile">
                <span class="spec-label">Sample Rate</span>
                <span class="spec-value">{sampleRateDisplay}</span>
              </div>

              <div class="spec-tile">
                <span class="spec-label">Channels</span>
                <span class="spec-value">{channelsDisplay}</span>
              </div>

              {#if $currentTrack.bitrate}
                <div class="spec-tile">
                  <span class="spec-label">Bitrate</span>
                  <span class="spec-value">{$currentTrack.bitrate} kbps</span>
                </div>
              {/if}
            </div>
          </section>

          <!-- Artist Bio / Summary -->
          <section class="bio-card">
            <h3 class="bio-card-title">
              About {$currentTrack.artist || "the Artist"}
            </h3>

            {#if loadingBio}
              <div class="bio-loading">
                <div class="loading-spinner-sm"></div>
                <span>Loading artist summary...</span>
              </div>
            {:else if mbInfo}
              {#if mbInfo.disambiguation}
                <p class="bio-disambiguation">{mbInfo.disambiguation}</p>
              {/if}

              {#if mbInfo.genres && mbInfo.genres.length > 0}
                <div class="genres-row">
                  {#each mbInfo.genres.slice(0, 5) as genre}
                    <span class="genre-tag">{genre}</span>
                  {/each}
                </div>
              {/if}

              {#if mbInfo.bio}
                <p class="bio-text">{mbInfo.bio}</p>
              {:else}
                <p class="bio-empty">No biography found for this artist.</p>
              {/if}

              {#if mbInfo.wikipedia_url}
                <a
                  href={mbInfo.wikipedia_url}
                  target="_blank"
                  rel="noreferrer"
                  class="wiki-link"
                >
                  <Icon name="external-link" size={13} />
                  <span>Wikipedia Article</span>
                </a>
              {/if}
            {:else}
              <p class="bio-empty">No artist summary available.</p>
            {/if}
          </section>
        </div>
      {:else}
        <div class="inspector-idle">
          <Icon name="music" size={44} />
          <p>No track currently playing</p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- TAB 2: LYRICS -->
  {#if $activeInspectorTab === "lyrics"}
    <div class="lyrics-tab-container">
      <!-- Persistent Lyrics Action Header: Source Picker, Share, Import -->
      <div class="lyrics-sub-header">
        <div class="lyrics-header-left">
          {#if showSourcePicker}
            <div
              class="source-picker"
              role="none"
              on:click|stopPropagation={() => (sourceMenuOpen = !sourceMenuOpen)}
            >
              <button
                class="source-pill"
                class:open={sourceMenuOpen}
                aria-haspopup="listbox"
                aria-expanded={sourceMenuOpen}
                title={$_("lyrics.switchSource", { default: "Switch lyrics source" })}
              >
                <span class="source-pill-label">{activeSourceLabel}</span>
                <Icon name="chevron-down" size={12} />
              </button>

              {#if sourceMenuOpen}
                <ul class="source-menu" role="listbox">
                  {#if $availableSources.includes("user")}
                    <li
                      class="source-menu-item"
                      class:active={$lyricsData?.source === "user"}
                      role="option"
                      aria-selected={$lyricsData?.source === "user"}
                      on:click={() => handleSourceSelect("user")}
                    >
                      <span>Imported</span>
                      <button
                        class="source-menu-delete"
                        on:click={(e) => handleDeleteSource("user", "Imported", e)}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </li>
                  {/if}

                  {#if $availableSources.includes("embedded")}
                    <li
                      class="source-menu-item"
                      class:active={$lyricsData?.source === "embedded"}
                      role="option"
                      aria-selected={$lyricsData?.source === "embedded"}
                      on:click={() => handleSourceSelect("embedded")}
                    >
                      <span>Embedded</span>
                    </li>
                  {/if}

                  {#each LYRICS_SOURCES as src}
                    <li
                      class="source-menu-item"
                      class:active={$lyricsData?.source === src.id}
                      role="option"
                      aria-selected={$lyricsData?.source === src.id}
                      on:click={() => handleSourceSelect(src.id)}
                    >
                      <span>{src.label}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>

        <div class="lyrics-header-actions">
          <!-- Share Lyric Card Button -->
          {#if $lyricsData?.lines && $lyricsData.lines.length > 0}
            <button
              class="lyrics-action-btn"
              title={$_("lyrics.shareCard", { default: "Share Lyric Card" })}
              aria-label="Share Lyric Card"
              on:click={() => (showLyricCardModal = true)}
            >
              <Icon name="share" size={16} />
            </button>
          {/if}

          <!-- Import Lyrics File Button -->
          <button
            class="lyrics-action-btn"
            title={$_("lyrics.importTooltip", { default: "Import lyrics file (.lrc, .ttml, .srt, .json)" })}
            aria-label="Import lyrics file"
            on:click={handleImportLyrics}
          >
            <Icon name="download" size={16} />
          </button>
        </div>
      </div>

      {#if $lyricsLoading}
        <div class="inspector-idle">
          <div class="loading-spinner"></div>
          <p>{$_("lyrics.searching", { default: "Searching lyrics..." })}</p>
        </div>
      {:else if $lyricsData && $lyricsData.lines.length > 0}
        <div class="lyrics-view-embed">
          <LyricsView style="--lyrics-font-size: 1.15rem; --lyrics-active-font-size: 1.3rem;" />
        </div>

        <footer class="lyrics-dock-footer">
          <span class="lyrics-format-badge">
            {#if ($lyricsData.source as string) === "user"}
              {$_("lyrics.imported", { default: "Imported" })} · {$lyricsData.format.toUpperCase()}
            {:else if ($lyricsData.source as string) === "embedded"}
              {$_("lyrics.embeddedTag", { default: "Embedded Tag" })}
            {:else}
              {activeSourceLabel} · {$lyricsData.format?.toUpperCase() || ""}
            {/if}
            {#if $lyricsData.hasSyllableSync}
              · {$_("lyrics.syllableSync", { default: "Syllable Sync" })}
            {:else if $lyricsData.hasWordSync}
              · {$_("lyrics.wordSync", { default: "Word Sync" })}
            {:else if hasLineSync}
              · {$_("lyrics.lineSync", { default: "Line Sync" })}
            {:else}
              · {$_("lyrics.unsynced", { default: "Unsynced" })}
            {/if}
          </span>
        </footer>
      {:else if $lyricsError && !$lyricsData}
        <div class="inspector-idle error-state">
          <Icon name="music" size={38} />
          <p class="error-title">
            {$_("lyrics.notFound", { default: "No lyrics found" })}
          </p>
          {#if $currentTrack}
            <p class="error-track">
              {$currentTrack.title} — {$currentTrack.artist}
            </p>
            <div class="custom-query-box">
              <input
                type="text"
                class="query-input"
                bind:value={customQueryInput}
                on:input={handleCustomQueryInput}
                on:keydown={(e) =>
                  e.key === "Enter" && customQueryChanged && retryWithCustomQuery()}
                placeholder={defaultQueryText}
              />
              {#if customQueryChanged}
                <button
                  class="retry-btn"
                  on:click={retryWithCustomQuery}
                  title="Retry with this query"
                >
                  <Icon name="refresh" size={13} />
                  <span>Retry</span>
                </button>
              {/if}
            </div>

            <div class="empty-import-action">
              <button class="empty-import-btn" on:click={handleImportLyrics}>
                <Icon name="download" size={14} />
                <span>Import Lyrics File (.lrc, .ttml)</span>
              </button>
            </div>
          {/if}

          {#if showSourcePicker}
            <div class="fallback-sources">
              <span>Try other sources:</span>
              <div class="source-buttons">
                {#each LYRICS_SOURCES as src}
                  <button
                    class="source-quick-btn"
                    on:click={() => handleSourceSelect(src.id)}
                  >
                    {src.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="inspector-idle">
          <Icon name="lyrics" size={40} />
          <p>{$_("lyrics.idle", { default: "Play a track to view lyrics" })}</p>
          {#if $currentTrack}
            <button class="empty-import-btn" on:click={handleImportLyrics} style="margin-top: 12px;">
              <Icon name="download" size={14} />
              <span>Import Lyrics File</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- TAB 3: QUEUE -->
  {#if $activeInspectorTab === "queue"}
    <div class="queue-tab-container">
      <div class="queue-sub-header">
        <span class="queue-summary-label">
          Next Up <strong>({upcomingCount})</strong>
        </span>

        {#if upcomingCount > 0}
          <button
            class="clear-queue-action"
            on:click={clearUpcoming}
            title={$_("player.clearUpcoming", { default: "Clear upcoming tracks" })}
          >
            <Icon name="trash" size={13} />
            <span>Clear</span>
          </button>
        {/if}
      </div>

      <div class="queue-dock-embed">
        <QueuePanel hideheader={true} forceVisible={true} />
      </div>
    </div>
  {/if}
</aside>

<LyricCardModal
  bind:open={showLyricCardModal}
  onClose={() => (showLyricCardModal = false)}
/>

<style>
  .right-inspector-dock {
    width: 380px;
    min-width: 320px;
    max-width: 440px;
    height: 100%;
    min-height: 0;
    background: linear-gradient(
      180deg,
      var(--bg-elevated) 0%,
      var(--bg-base) 100%
    );
    border-left: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 15;
    flex-shrink: 0;
    transition:
      width 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
      min-width 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
      max-width 0.28s cubic-bezier(0.25, 0.1, 0.25, 1),
      opacity 0.22s ease,
      border-left 0.28s ease;
  }

  .right-inspector-dock.closed {
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    opacity: 0;
    padding: 0;
    border-left: none;
    overflow: hidden;
    pointer-events: none;
  }

  /* Segmented Header */
  .inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-elevated);
  }

  .segmented-control {
    display: flex;
    align-items: center;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    padding: 3px;
    gap: 3px;
    flex: 1;
  }

  .tab-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--radius-full);
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.18s ease;
    white-space: nowrap;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }

  .tab-badge {
    background: var(--accent-primary);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    line-height: 1.2;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* Content area scrollable */
  .inspector-scrollable {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  .now-playing-content {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  /* Album Art */
  .dock-cover-wrapper {
    position: relative;
    width: 100%;
    max-width: 320px;
    aspect-ratio: 1 / 1;
    min-height: 200px;
    margin: 0 auto;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .dock-cover-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    display: block;
    transition: transform 0.3s ease;
  }

  .dock-cover-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--bg-surface);
  }

  /* Track Header */
  .track-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .track-title {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.25;
    word-break: break-word;
  }

  .track-artist-row {
    font-size: 0.95rem;
    color: var(--text-secondary);
  }

  :global(.inspector-artist-chip) {
    font-size: 0.95rem !important;
    color: var(--text-secondary) !important;
  }

  .track-album-link {
    font-size: 0.82rem;
    color: var(--text-muted);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .track-album-link:hover {
    color: var(--accent-primary);
  }

  /* Audio Specs Card */
  .specs-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm) var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .specs-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .specs-card-title {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .specs-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-xs) var(--spacing-md);
  }

  .spec-tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .spec-label {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .spec-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .lossless-pill {
    background: rgba(30, 215, 96, 0.15);
    color: #1ed760;
    border: 1px solid rgba(30, 215, 96, 0.3);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    text-transform: uppercase;
  }

  /* Bio Card */
  .bio-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .bio-card-title {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .bio-disambiguation {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .genres-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .genre-tag {
    font-size: 0.7rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    color: var(--text-secondary);
  }

  .bio-text {
    font-size: 0.84rem;
    line-height: 1.5;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 7;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .bio-empty {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .bio-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .wiki-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--accent-primary);
    text-decoration: none;
    margin-top: 4px;
    width: fit-content;
  }

  .wiki-link:hover {
    text-decoration: underline;
  }

  /* Lyrics Tab */
  .lyrics-tab-container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .lyrics-sub-header {
    padding: 8px var(--spacing-md);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    flex-shrink: 0;
    position: relative;
    border-bottom: 1px solid var(--border-color);
    min-height: 44px;
    box-sizing: border-box;
  }

  .lyrics-header-left {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    min-width: 0;
  }

  .lyrics-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .lyrics-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .lyrics-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .empty-import-action {
    margin-top: 10px;
    display: flex;
    justify-content: center;
  }

  .empty-import-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .empty-import-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .lyrics-view-embed {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .lyrics-dock-footer {
    padding: 6px var(--spacing-md);
    border-top: 1px solid var(--border-color);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .lyrics-format-badge {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  /* Queue Tab */
  .queue-tab-container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .queue-sub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-xs) var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .queue-summary-label {
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .clear-queue-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .clear-queue-action:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .queue-dock-embed {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Global overrides for embedded QueuePanel inside inspector */
  :global(.right-inspector-dock .queue-panel) {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    height: 100% !important;
    background: transparent !important;
    border: none !important;
    border-left: none !important;
    position: relative !important;
    inset: auto !important;
    box-shadow: none !important;
    top: 0 !important;
  }

  :global(.right-inspector-dock .queue-panel .queue-content) {
    padding: var(--spacing-sm) var(--spacing-md) !important;
  }

  /* Idle and error states */
  .inspector-idle {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-md);
    padding: var(--spacing-xl);
    color: var(--text-muted);
    text-align: center;
  }

  .error-state {
    gap: var(--spacing-sm);
  }

  .error-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-track {
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .custom-query-box {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    width: 100%;
    max-width: 280px;
  }

  .query-input {
    flex: 1;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 0.8rem;
    color: var(--text-primary);
  }

  .retry-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: var(--accent-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .fallback-sources {
    margin-top: var(--spacing-sm);
    font-size: 0.78rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }

  .source-quick-btn {
    font-size: 0.72rem;
    padding: 4px 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .source-quick-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  /* Source pill */
  .source-picker {
    position: relative;
  }

  .source-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    padding: 4px 10px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .source-pill:hover,
  .source-pill.open {
    color: var(--text-primary);
    border-color: var(--border-highlight);
  }

  .source-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 140px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    list-style: none;
    padding: 4px;
    margin: 0;
    z-index: 50;
  }

  .source-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    font-size: 0.78rem;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .source-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .source-menu-item.active {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .source-menu-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
  }

  .source-menu-delete:hover {
    color: #ff5555;
  }

  /* Spinners */
  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--bg-surface);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .loading-spinner-sm {
    width: 14px;
    height: 14px;
    border: 2px solid var(--bg-surface);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
