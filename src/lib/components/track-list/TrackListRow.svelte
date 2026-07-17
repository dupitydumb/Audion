<script lang="ts">
  import type { Track } from "$lib/api/tauri";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import { formatDuration } from "$lib/api/tauri";
  import { isMobile } from "$lib/stores/mobile";
  import { multiSelect } from "$lib/stores/multiselect";
  import { goToArtistDetail, goToAlbumDetail } from "$lib/stores/view";

  export let track: Track;
  export let albumArt: string | null = null;
  export let unavailable = false;
  export let actualIndex: number;
  export let isSelected = false;
  export let showAlbum = true;
  export let playlistId: number | null = null;
  export let multiSelectMode = false;
  export let playingTrackId: number | null = null;
  export let isPlaying = false;
  export let failedImages: Set<string>;
  export let showAdvancedMetadata = false;

  export let isDragging = false;
  export let isDragOver = false;

  export let onPointerDown: (e: PointerEvent, index: number) => void;
  export let onImageError: (art: string) => void;

  /** row's own hover state, used to drive marquee start/stop for the
   *  artist chips in this row (see ArtistLinks marqueeTrigger=external */
  let rowHovered = false;

  function handleArtistSelect(name: string) {
    if (name) {
      goToArtistDetail(name);
    }
  }

  function handleAlbumClick(e: MouseEvent) {
    e.stopPropagation();
    if (track && track.album_id) {
      goToAlbumDetail(track.album_id);
    }
  }

  function formatDateAdded(dateAdded?: string | null): string {
    if (!dateAdded) return "Unknown";

    const raw = dateAdded.trim();
    const isoLike = raw.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const parsed = new Date(isoLike);
    if (!isNaN(parsed.getTime())) return parsed.toLocaleDateString();

    // Fallback for YYYY-MM-DD HH:MM:SS
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      const fallback = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(fallback.getTime())
        ? `${y}-${m}-${d}`
        : fallback.toLocaleDateString();
    }

    return raw;
  }
</script>

<div
  class="track-row"
  class:playing={playingTrackId === track.id}
  class:unavailable
  class:dragging={isDragging}
  class:drag-over={isDragOver}
  class:selected={multiSelectMode && isSelected}
  data-track-id={track.id}
  data-track-index={actualIndex}
  role="button"
  tabindex="0"
  on:mouseenter={() => (rowHovered = true)}
  on:mouseleave={() => (rowHovered = false)}
>
  {#if multiSelectMode}
    <div
      class="col-checkbox"
      on:click|stopPropagation={() => multiSelect.toggleTrack(track.id)}
      role="checkbox"
      aria-checked={isSelected}
      tabindex="0"
    >
      <div class="custom-checkbox" class:checked={isSelected}>
        {#if isSelected}
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="14"
            height="14"
          >
            <path
              d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
            />
          </svg>
        {/if}
      </div>
    </div>
  {/if}
  {#if playlistId !== null && !multiSelectMode}
    <div
      class="drag-handle"
      on:pointerdown={(e) => onPointerDown(e, actualIndex)}
      on:click|stopPropagation
      on:dblclick|stopPropagation
      title="Drag to reorder"
      role="button"
      tabindex="-1"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        width="16"
        height="16"
      >
        <path
          d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"
        />
      </svg>
    </div>
  {/if}
  <span class="col-num">
    {#if playingTrackId === track.id && isPlaying}
      <svg
        class="playing-icon"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="14"
        height="14"
      >
        <path
          d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
        />
      </svg>
      <span class="equalizer-bars">
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
      </span>
    {:else}
      <span class="track-index">{actualIndex + 1}</span>
      <span class="hover-play" aria-hidden="true">▶</span>
    {/if}
  </span>

  {#if $isMobile}
    <span class="col-cover">
      <div class="cover-wrapper">
        {#if albumArt && !failedImages.has(albumArt)}
          <img
            src={albumArt}
            alt="Album cover"
            class="cover-image"
            loading="lazy"
            decoding="async"
            on:error={() => onImageError(albumArt)}
          />
        {:else}
          <div class="cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="16"
              height="16"
            >
              <path
                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
              />
            </svg>
          </div>
        {/if}
        <div class="cover-play-overlay">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="18"
            height="18"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </span>
    <div class="col-title">
      <div class="title-row">
        <span class="track-name truncate"
          >{track.title || "Unknown Title"}</span
        >

        {#if !track.source_type || track.source_type === "local" || track.local_src}
          <span class="downloaded-icon" title="Downloaded">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="14"
              height="14"
            >
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              />
            </svg>
          </span>
        {/if}

        {#if track.format}
          {@const formatUpper = track.format.toUpperCase()}
          {@const displayFormat =
            formatUpper.includes("HI_RES") ||
            formatUpper.includes("HIRES")
              ? "HI-RES"
              : formatUpper.includes("LOSSLESS")
                ? "LOSSLESS"
                : formatUpper.replace("MPEG", "MP3")}
          <span
            class="quality-tag"
            class:high-quality={formatUpper.includes("FLAC") ||
              formatUpper.includes("WAV") ||
              formatUpper.includes("HI_RES") ||
              formatUpper.includes("HIRES") ||
              (track.bitrate && track.bitrate >= 320)}
          >
            {displayFormat}
          </span>
        {/if}
      </div>
      <ArtistLinks
        artist={track.artist}
        artists={track.artists}
        chipClass="track-artist truncate"
        marquee
        marqueeTrigger="external"
        marqueeActive={rowHovered}
        resetKey={track.id}
        on:select={(e) => handleArtistSelect(e.detail)}
      />
    </div>
  {:else}
    <div class="col-artist">
      <span class="artist-thumb">
        {#if albumArt && !failedImages.has(albumArt)}
          <img
            src={albumArt}
            alt="Album cover"
            class="cover-image-small"
            loading="lazy"
            decoding="async"
            on:error={() => onImageError(albumArt)}
          />
        {:else}
          <span class="cover-placeholder-small">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="12"
              height="12"
            >
              <path
                d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
              />
            </svg>
          </span>
        {/if}
      </span>
      <div class="artist-meta">
        <span class="track-name truncate"
          >{track.title || "Unknown Title"}</span
        >
        <ArtistLinks
          artist={track.artist}
          artists={track.artists}
          chipClass="track-artist truncate"
          marquee
          marqueeTrigger="external"
          marqueeActive={rowHovered}
          resetKey={track.id}
          on:select={(e) => handleArtistSelect(e.detail)}
        />
        {#if showAdvancedMetadata}
          <span class="media-metadata truncate">
            {track.format ? track.format.toUpperCase() : "Unknown format"}
            {#if track.bitrate} • {track.bitrate} kbps{/if}
            {#if track.source_type} • {track.source_type}{/if}
          </span>
        {/if}
      </div>
    </div>
  {/if}
  {#if showAlbum}
    <button
      class="col-album-cell truncate"
      on:click={handleAlbumClick}
      disabled={!track.album_id}>{track.album || "-"}</button
    >
  {/if}
  <span class="col-duration">{formatDuration(track.duration)}</span>
  {#if !$isMobile}
    <span class="col-date-added">{formatDateAdded(track.date_added)}</span>
  {/if}
</div>
