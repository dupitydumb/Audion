<script lang="ts">
  import { _ } from "svelte-i18n";
  import type { Track } from "$lib/api/tauri";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";
  import Icon from "$lib/components/Icon.svelte";
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
    if (!dateAdded) return $_('common.unknown');

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
          <Icon name="check" size={14} />
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
      title={$_('player.dragToReorder')}
      role="button"
      tabindex="-1"
    >
      <Icon name="drag-handle" size={16} />
    </div>
  {/if}
  <span class="col-num">
    {#if playingTrackId === track.id && isPlaying}
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
            <Icon name="music" size={16} />
          </div>
        {/if}
        <div class="cover-play-overlay">
          <Icon name="play" size={18} />
        </div>
      </div>
    </span>
    <div class="col-title">
      <div class="title-row">
        <span class="track-name truncate"
          >{track.title || $_('player.unknownTitle')}</span
        >

        {#if !track.source_type || track.source_type === "local" || track.local_src}
          <span class="downloaded-icon" title={$_('album.downloaded')}>
            <Icon name="check-circle" size={14} />
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
        artist={track.artist || $_('common.unknownArtist')}
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
            <Icon name="music" size={12} />
          </span>
        {/if}
      </span>
      <div class="artist-meta">
        <span class="track-name truncate"
          >{track.title || $_('player.unknownTitle')}</span
        >
        <ArtistLinks
          artist={track.artist || $_('common.unknownArtist')}
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
            {track.format ? track.format.toUpperCase() : $_('trackList.unknownFormat')}
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
