<script lang="ts">
  import type { Track } from "$lib/api/tauri";
  import {
    formatDuration,
    getAlbumArtSrc,
    getTrackCoverSrc,
    getAlbumCoverSrc,
    reorderPlaylistTracks,
  } from "$lib/api/tauri";
  import {
    playTracks,
    currentTrack,
    isPlaying,
    addToQueue,
    type PlaybackContext,
  } from "$lib/stores/player";
  import { contextMenu } from "$lib/stores/ui";
  import {
    albums,
    playlists,
    loadPlaylists,
    getTrackAlbumCover,
    loadMoreTracks,
  } from "$lib/stores/library";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { addToast } from "$lib/stores/toast";
  import { isOnline } from "$lib/stores/network";
  import { onDestroy, onMount } from "svelte";
  import { multiSelect } from "$lib/stores/multiselect";
  import { isMobile } from "$lib/stores/mobile";
  import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
  import MetadataModal from "$lib/components/MetadataModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { _, locale } from "svelte-i18n";
  import { buildTrackContextMenu, isTrackUnavailable } from "$lib/menus/contextMenus";
  import TrackListHeader from "./TrackListHeader.svelte";
  import TrackListRow from "./TrackListRow.svelte";

  // MetadataModal state
  let metadataModalTrack: Track | null = null;

  export let scrollKey: string | null = null;

  export let tracks: Track[] = [];
  // export let title = ""; // unused
  export let showAlbum: boolean = true;
  export let isTidalAvailable: boolean = true;
  export let playbackContext: PlaybackContext | undefined = undefined;
  export let playlistId: number | null = null;
  export let multiSelectMode: boolean = false;
  export let queueTracks: Track[] | null = null; // New prop for unified queue context

  // Virtual scrolling configuration
  const TRACK_ROW_HEIGHT = 50; // pixels (matches desktop row height in CSS)
  const OVERSCAN = 5; // Extra rows to render above/below viewport

  let containerHeight = 600; // Will be calculated from container
  let scrollTop = 0;
  let scrollbarWidth = 0;
  let containerElement: HTMLDivElement;
  let resizeObserver: ResizeObserver | undefined;

  // Cache structures
  let failedImages = new Set<string>();
  const MAX_FAILED_IMAGES = 200;
  const trackAlbumArtCache = new Map<number, string | null>();
  let albumMap = new Map<number, any>();

  // 1: Track albums by reference, not just length
  let lastAlbumsRef = $albums;
  $: {
    if ($albums !== lastAlbumsRef) {
      albumMap = new Map($albums.map((a) => [a.id, a]));
      lastAlbumsRef = $albums;
      trackAlbumArtCache.clear();
    }
  }

  // 2: Pre-compute playing track ID
  $: playingTrackId = $currentTrack?.id ?? null;

  // Mobile view mode: determines layout on small screens
  // 'album' = numbered list, no covers | 'playlist' = covers + info | 'library' = covers + full info
  $: mobileViewMode =
    !showAlbum && playbackContext?.type === "album"
      ? "album"
      : playbackContext?.type === "playlist"
        ? "playlist"
        : "library";

  // 3: Memoize availability check results via local cache wrapping the imported helper
  // cache is invalidated below when runtime or network state changes
  const availabilityCache = new Map<number, boolean>();

  function getCachedUnavailable(track: Track): boolean {
    if (availabilityCache.has(track.id)) return availabilityCache.get(track.id)!;
    const result = isTrackUnavailable(track);
    availabilityCache.set(track.id, result);
    return result;
  }

  // Clear availability cache when dependencies change (including plugin store)
  // references $pluginStore to ensure reactivity when store state changes (e.g. init -> loaded)
  $: runtime = $pluginStore && pluginStore.getRuntime();
  $: {
    // Watch all relevant dependencies
    const _ = runtime;
    if ($isOnline !== undefined || isTidalAvailable !== undefined) {
      availabilityCache.clear();
    }
  }

  $: filteredTracks = tracks;

  // Sorting state
  type SortField =
    | "title"
    | "track_number"
    | "artist"
    | "album"
    | "duration"
    | "date_added"
    | null;
  let sortField: SortField = null;
  let sortDirection: "asc" | "desc" = "asc";
  let showAdvancedMetadata = false;

  function toggleSort(field: SortField) {
    if (sortField === field) {
      if (sortDirection === "asc") {
        sortDirection = "desc";
      } else {
        sortField = null;
        sortDirection = "asc";
      }
    } else {
      sortField = field;
      // For date_added, default to descending (Recently added)
      sortDirection = field === "date_added" ? "desc" : "asc";
    }
  }

  // Optimized sorting with memoization
  let lastSortField: SortField = null;
  let lastSortDirection: "asc" | "desc" = "asc";
  let lastFilteredTracks: Track[] = [];
  let cachedSortedTracks: Track[] = [];

  $: {
    // Only re-sort if sort params or tracks actually changed
    if (
      sortField !== lastSortField ||
      sortDirection !== lastSortDirection ||
      filteredTracks !== lastFilteredTracks
    ) {
      if (!sortField) {
        cachedSortedTracks = filteredTracks;
      } else {
        cachedSortedTracks = [...filteredTracks].sort((a, b) => {
          let valA: any = "";
          let valB: any = "";

          switch (sortField) {
            case "title":
              valA = (a.title || "").toLowerCase();
              valB = (b.title || "").toLowerCase();
              break;
            case "track_number":
              valA = a.track_number ?? a.id;
              valB = b.track_number ?? b.id;
              break;
            case "artist":
              valA = (a.artist || "").toLowerCase();
              valB = (b.artist || "").toLowerCase();
              break;
            case "album":
              valA = (a.album || "").toLowerCase();
              valB = (b.album || "").toLowerCase();
              break;
            case "duration":
              valA = a.duration || 0;
              valB = b.duration || 0;
              break;
            case "date_added":
              valA = a.date_added || "";
              valB = b.date_added || "";
              break;
          }

          if (valA < valB) return sortDirection === "asc" ? -1 : 1;
          if (valA > valB) return sortDirection === "asc" ? 1 : -1;
          return 0;
        });
      }

      lastSortField = sortField;
      lastSortDirection = sortDirection;
      lastFilteredTracks = filteredTracks;
    }
  }

  $: sortedTracks = cachedSortedTracks;

  // 4: Build track index map
  let trackIndexMap = new Map<number, number>();
  $: {
    trackIndexMap = new Map(
      sortedTracks.map((track, index) => [track.id, index]),
    );
  }

  // Batch virtual scroll calculations
  let virtualScrollState = {
    totalHeight: 0,
    startIndex: 0,
    endIndex: 0,
    offsetY: 0,
    visibleTracks: [] as Track[],
  };

  $: {
    const totalHeight = sortedTracks.length * TRACK_ROW_HEIGHT;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / TRACK_ROW_HEIGHT) - OVERSCAN,
    );
    const endIndex = Math.min(
      sortedTracks.length,
      Math.ceil((scrollTop + containerHeight) / TRACK_ROW_HEIGHT) + OVERSCAN,
    );
    const visibleTracks = sortedTracks.slice(startIndex, endIndex);
    const offsetY = startIndex * TRACK_ROW_HEIGHT;

    virtualScrollState = {
      totalHeight,
      startIndex,
      endIndex,
      offsetY,
      visibleTracks,
    };
  }

  // Infinite scroll: when virtual scroll nears the bottom of loaded tracks,
  // fetch the next paginated batch from the backend.
  $: {
    if (
      virtualScrollState.endIndex >= sortedTracks.length - 10 &&
      sortedTracks.length > 0
    ) {
      loadMoreTracks();
    }
  }

  // 5: Pre-compute album art and availability for visible tracks
  type TrackWithMetadata = {
    track: Track;
    albumArt: string | null;
    unavailable: boolean;
  };

  $: visibleTracksWithMetadata = virtualScrollState.visibleTracks.map(
    (track) => {
      // Re-evaluate when runtime changes
      const _ = runtime;
      return {
        track,
        albumArt: getTrackAlbumArt(track),
        unavailable: getCachedUnavailable(track),
      };
    },
  ) as TrackWithMetadata[];

  function handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    scrollTop = target.scrollTop;
    scrollbarWidth = Math.max(0, target.offsetWidth - target.clientWidth);
  }

  // Measure container height on mount
  onMount(() => {
    // 5: Load playlists once on mount to avoid race conditions
    if ($playlists.length === 0) {
      loadPlaylists();
    }

    if (containerElement) {
      const updateHeight = () => {
        if (!containerElement) return;
        containerHeight = containerElement.clientHeight;
        scrollbarWidth = Math.max(
          0,
          containerElement.offsetWidth - containerElement.clientWidth,
        );
      };
      updateHeight();

      if (scrollKey) {
        const saved = getScroll(scrollKey);
        if (saved > 0 && containerElement) {
          containerElement.scrollTop = saved;
        }
      }

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(containerElement);
      } else {
        window.addEventListener("resize", updateHeight);
      }
    }
  });

  // Cleanup for drag listeners to prevent memory leaks
  let cleanupDragListeners: (() => void) | null = null;

  // Cleanup on destroy
  onDestroy(() => {
    if (scrollKey) saveScroll(scrollKey, scrollTop);
    failedImages.clear();
    trackAlbumArtCache.clear();
    albumMap.clear();
    availabilityCache.clear();

    resizeObserver?.disconnect();
    resizeObserver = undefined;

    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    // Clean up drag listeners if component unmounts during drag
    if (cleanupDragListeners) {
      cleanupDragListeners();
    }

    // Clean up swipe timer
    if (swipeResetTimer) {
      clearTimeout(swipeResetTimer);
    }
  });

  // 6: cleanup interval
  let cleanupInterval: number | undefined;

  function startCleanupInterval() {
    if (cleanupInterval || typeof window === "undefined") return;

    cleanupInterval = window.setInterval(() => {
      if (failedImages.size > MAX_FAILED_IMAGES) {
        const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
        failedImages.clear();
        toKeep.forEach((src) => failedImages.add(src));
        failedImages = failedImages;
      }

      // Stop interval if no failed images
      if (failedImages.size === 0 && cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
      }
    }, 300000);
  }

  // Cached album art lookup
  function getTrackAlbumArt(track: Track): string | null {
    // Check cache first
    if (trackAlbumArtCache.has(track.id)) {
      return trackAlbumArtCache.get(track.id) ?? null;
    }

    let result: string | null = null;

    // Priority 1: Track's own cover (handles both track_cover_path and track_cover)
    result = getTrackCoverSrc(track);

    // Priority 2: If no track cover, try album art
    if (!result && track.album_id) {
      const album = albumMap.get(track.album_id);
      if (album) {
        result = getAlbumCoverSrc(album);
      }
    }

    // Priority 3: fallback to library helper
    if (!result) {
      result = getTrackAlbumCover(track.id);
    }

    // Cache the result
    trackAlbumArtCache.set(track.id, result);
    return result;
  }

  // Event delegation
  function handleBodyClick(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest(".track-row");
    if (!row) return;

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");

    // In multi-select mode, clicking toggles selection
    if (multiSelectMode) {
      multiSelect.toggleTrack(trackId);
      return;
    }

    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (!track || getCachedUnavailable(track)) return;

    // Use unified queueTracks if available, otherwise fallback to local sortedTracks
    if (queueTracks) {
      // Find index of this track in the global/unified queue
      const globalIndex = queueTracks.findIndex((t) => t.id === trackId);
      if (globalIndex !== -1) {
        playTracks(queueTracks, globalIndex, playbackContext);
        return;
      }
    }

    playTracks(sortedTracks, trackIndex, playbackContext);
  }

  function handleBodyDoubleClick(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest(".track-row");
    if (!row) return;

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");
    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (!track || getCachedUnavailable(track)) return;

    // Use unified queueTracks if available
    if (queueTracks) {
      const globalIndex = queueTracks.findIndex((t) => t.id === trackId);
      if (globalIndex !== -1) {
        playTracks(queueTracks, globalIndex, playbackContext);
        return;
      }
    }

    playTracks(sortedTracks, trackIndex, playbackContext);
  }

  async function handleBodyContextMenu(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest(".track-row");
    if (!row) return;

    e.preventDefault();

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");
    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (!track) return;

    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: buildTrackContextMenu({
        track,
        trackIndex,
        sortedTracks,
        isUnavailable: getCachedUnavailable(track),
        variant: 'full',
        playlistId,
        queueTracks,
        playbackContext,
        isTidalAvailable,
        t: $_,
        onMetadataOpen: (t) => { metadataModalTrack = t; },
        onArtworkCacheInvalidate: (id) => { trackAlbumArtCache.delete(id); },
        onAvailabilityCacheInvalidate: (id) => { availabilityCache.delete(id); },
        onTracksUpdated: (updated) => { tracks = updated; },
      }),
    });
  }

  function handleImageError(albumArt: string) {
    if (failedImages.size >= MAX_FAILED_IMAGES) {
      const toKeep = Array.from(failedImages).slice(-MAX_FAILED_IMAGES / 2);
      failedImages.clear();
      toKeep.forEach((src) => failedImages.add(src));
    }

    failedImages.add(albumArt);
    failedImages = failedImages;

    // Start cleanup interval if needed
    startCleanupInterval();
  }

  // Drag and drop for playlist reordering (only enabled when playlistId is set)
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;
  let isDragging = false;

  function handlePointerDown(e: PointerEvent, actualIndex: number) {
    if (!playlistId) return; // Only allow dragging in playlists

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation(); // Prevent parent handlers
    isDragging = true;
    draggedIndex = actualIndex;

    // Capture pointer events
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    // Add global listeners
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    // Store cleanup function for memory leak prevention
    cleanupDragListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging || draggedIndex === null || !playlistId) return;

    // Find element under pointer
    const elementsUnderPointer = document.elementsFromPoint(
      e.clientX,
      e.clientY,
    );
    const trackRow = elementsUnderPointer.find((el) =>
      el.classList.contains("track-row"),
    );

    if (trackRow) {
      const indexAttr = trackRow.getAttribute("data-track-index");
      if (indexAttr !== null) {
        const overIndex = parseInt(indexAttr, 10);
        if (overIndex !== draggedIndex) {
          dragOverIndex = overIndex;
        } else {
          dragOverIndex = null;
        }
      }
    } else {
      dragOverIndex = null;
    }
  }

  async function handlePointerUp() {
    if (
      isDragging &&
      draggedIndex !== null &&
      dragOverIndex !== null &&
      draggedIndex !== dragOverIndex &&
      playlistId
    ) {
      try {
        // Update backend
        await reorderPlaylistTracks(playlistId, draggedIndex, dragOverIndex);

        console.log("Reorder successful, updating local state");

        // Update local state for instant feedback
        const newTracks = [...tracks];
        const [removed] = newTracks.splice(draggedIndex, 1);
        newTracks.splice(dragOverIndex, 0, removed);
        tracks = newTracks;

        addToast($_('trackList.tracksReordered'), "success");
      } catch (error) {
        console.error("Failed to reorder tracks:", error);
        addToast($_('trackList.reorderTracksFailed', { values: { error: String(error) } }), "error");
      }
    }

    // Cleanup
    isDragging = false;
    draggedIndex = null;
    dragOverIndex = null;

    // Clean up and clear the cleanup function
    if (cleanupDragListeners) {
      cleanupDragListeners();
      cleanupDragListeners = null;
    }
  }

  // ── Swipe-to-queue (mobile only) ──
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeDeltaX = 0;
  let swipingRow: HTMLElement | null = null;
  let swipeTrackId: number | null = null;
  let swipeCommitted = false;
  const SWIPE_THRESHOLD = 80; // px to trigger add-to-queue
  const SWIPE_MAX = 120;
  let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSwipeTouchStart(e: TouchEvent) {
    if (!$isMobile || multiSelectMode) return;
    // Don't swipe on drag handles
    if ((e.target as HTMLElement).closest(".drag-handle")) return;

    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeDeltaX = 0;
    swipeCommitted = false;

    const row = (e.target as HTMLElement).closest(".track-row") as HTMLElement;
    if (row) {
      swipingRow = row;
      swipeTrackId = parseInt(row.getAttribute("data-track-id") || "0");
    }
  }

  function handleSwipeTouchMove(e: TouchEvent) {
    if (!swipingRow || swipeCommitted) return;

    const touch = e.touches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;

    // If vertical movement is dominant, cancel swipe (allow scroll)
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 15) {
      swipingRow.style.transform = "";
      swipingRow.style.transition = "";
      swipingRow = null;
      return;
    }

    // Only right-swipe
    if (dx < 0) {
      swipeDeltaX = 0;
      swipingRow.style.transform = "";
      return;
    }

    // Prevent vertical scroll while swiping
    e.preventDefault();

    swipeDeltaX = Math.min(dx, SWIPE_MAX);
    swipingRow.style.transition = "none";
    swipingRow.style.transform = `translateX(${swipeDeltaX}px)`;

    // Visual feedback: change bg when past threshold
    if (swipeDeltaX >= SWIPE_THRESHOLD) {
      swipingRow.classList.add("swipe-queue-ready");
    } else {
      swipingRow.classList.remove("swipe-queue-ready");
    }
  }

  function handleSwipeTouchEnd() {
    if (!swipingRow) return;

    const row = swipingRow;
    const trackId = swipeTrackId;

    if (swipeDeltaX >= SWIPE_THRESHOLD && trackId) {
      swipeCommitted = true;
      row.classList.add("swipe-queue-added");
      row.classList.remove("swipe-queue-ready");

      // Find track and add to queue
      const trackIndex = trackIndexMap.get(trackId);
      if (trackIndex !== undefined) {
        const track = sortedTracks[trackIndex];
        if (track) {
          addToQueue([track]);
          addToast($_('trackList.addedToQueueWithTitle', { values: { title: track.title } }), "success");
        }
      }

      // Animate back after short delay
      swipeResetTimer = setTimeout(() => {
        row.style.transition = "transform 0.25s ease";
        row.style.transform = "";
        row.classList.remove("swipe-queue-added");
      }, 400);
    } else {
      // Snap back
      row.style.transition = "transform 0.25s ease";
      row.style.transform = "";
      row.classList.remove("swipe-queue-ready");
    }

    swipingRow = null;
    swipeTrackId = null;
    swipeDeltaX = 0;
  }



  function formatDateAdded(dateAdded?: string | null): string {
    if (!dateAdded) return $_('common.unknown');

    const raw = dateAdded.trim();
    const isoLike = raw.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const parsed = new Date(isoLike);
    if (!isNaN(parsed.getTime())) return parsed.toLocaleDateString();

    // Fallback for plain sqlite datetime (YYYY-MM-DD HH:MM:SS)
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

{#if metadataModalTrack}
  <MetadataModal
    track={metadataModalTrack}
    onClose={() => {
      metadataModalTrack = null;
    }}
  />
{/if}

<div class="track-list">
  {#if !$isMobile}
    <div class="list-toolbar">
      <span class="toolbar-hint"
        >{showAdvancedMetadata
          ? $_('trackList.detailsShown')
          : $_('trackList.minimalView')}</span
      >
      <button
        class="advanced-toggle"
        title={$_('trackList.toggleMetadataTitle')}
        on:click={() => {
          showAdvancedMetadata = !showAdvancedMetadata;
        }}
      >
        {showAdvancedMetadata ? $_('trackList.hideDetails') : $_('trackList.showDetails')}
      </button>
    </div>
  {/if}

  <!-- Header stays fixed -->
  <TrackListHeader
    {multiSelectMode}
    {showAlbum}
    {playlistId}
    {scrollbarWidth}
    {sortedTracks}
    {sortField}
    {sortDirection}
    {toggleSort}
  />

  <!-- Virtualized scrolling container -->
  {#if sortedTracks.length > 0}
    <!-- Event delegation - handlers on container instead of each row -->
    <div
      class="list-body"
      class:no-album={!showAlbum}
      class:with-drag={playlistId !== null && !multiSelectMode}
      class:multiselect={multiSelectMode}
      class:mobile-album={mobileViewMode === "album"}
      class:mobile-playlist={mobileViewMode === "playlist"}
      class:mobile-library={mobileViewMode === "library"}
      on:scroll={handleScroll}
      on:click={handleBodyClick}
      on:dblclick={handleBodyDoubleClick}
      on:contextmenu={handleBodyContextMenu}
      on:touchstart={handleSwipeTouchStart}
      on:touchmove={handleSwipeTouchMove}
      on:touchend={handleSwipeTouchEnd}
      bind:this={containerElement}
    >
      <div
        class="virtual-spacer"
        style="height: {virtualScrollState.totalHeight}px;"
      >
        <div
          class="virtual-content"
          style="transform: translateY({virtualScrollState.offsetY}px);"
        >
          {#each visibleTracksWithMetadata as { track, albumArt, unavailable }, index (track.id)}
            {@const actualIndex = virtualScrollState.startIndex + index}
            {@const isSelected = $multiSelect.selectedTrackIds.has(track.id)}
            <TrackListRow
              {track}
              {albumArt}
              {unavailable}
              {actualIndex}
              {isSelected}
              {showAlbum}
              {playlistId}
              {multiSelectMode}
              {playingTrackId}
              isPlaying={$isPlaying}
              {failedImages}
              {showAdvancedMetadata}
              isDragging={draggedIndex === actualIndex}
              isDragOver={dragOverIndex === actualIndex}
              onPointerDown={handlePointerDown}
              onImageError={handleImageError}
            />
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="list-body">
      <div class="empty-state-wrapper">
        <EmptyState
          icon="music"
          title={$_('trackList.noTracksFound')}
          description={$_('trackList.addFolderToGetStarted')}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .track-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .list-toolbar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding: 6px var(--spacing-md) 0;
  }

  .toolbar-hint {
    font-size: 0.72rem;
    color: var(--text-subdued);
  }

  .advanced-toggle {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-size: var(--font-size-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .advanced-toggle:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  :global(.list-header) {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px 140px;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    padding-right: calc(var(--spacing-md) + var(--scrollbar-width, 0px));
    padding-left: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    font-size: 0.78rem;
    font-weight: var(--font-weight-medium);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.1;
    color: var(--text-subdued);
    background-color: var(--bg-base);
    z-index: 10;
    flex-shrink: 0;
  }

  :global(.list-header.with-drag) { grid-template-columns: 32px 40px 1fr 1fr 80px 140px; }
  :global(.list-header.no-album) { grid-template-columns: 40px 1fr 80px 140px; }
  :global(.list-header.no-album.with-drag) { grid-template-columns: 32px 40px 1fr 80px 140px; }
  :global(.list-header.multiselect) { grid-template-columns: 40px 40px 1fr 1fr 80px 140px; }
  :global(.list-header.multiselect.no-album) { grid-template-columns: 40px 40px 1fr 80px 140px; }

  :global(.col-header) {
    background: none; border: none; padding: 0; font: inherit; color: inherit;
    text-transform: inherit; letter-spacing: inherit; cursor: default;
    display: flex; align-items: center; gap: 4px;
    transition: color var(--transition-fast); user-select: none;
    justify-self: stretch; width: 100%;
    font-size: inherit; font-weight: inherit; line-height: inherit;
  }
  :global(.col-header.sortable) { cursor: pointer; }
  :global(.col-header.sortable:hover) { color: var(--text-primary); }
  :global(.col-header.col-drag) { cursor: default; }
  :global(.col-header.col-num) { justify-content: center; }
  :global(.col-header.col-artist) { justify-content: flex-start; padding-left: 36px; }
  :global(.col-header.col-album) { justify-content: flex-start; }
  :global(.col-header.col-duration) { justify-content: flex-end; }
  :global(.col-header.col-date-added) { justify-content: flex-end; }
  :global(.col-header.col-checkbox) { display: flex; align-items: center; justify-content: center; }
  :global(.sort-icon) { color: var(--accent-primary); font-size: var(--font-size-xs); }

  .list-body { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; overscroll-behavior-y: contain; }
  .virtual-spacer { position: relative; width: 100%; }
  .virtual-content { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }

  :global(.track-row) {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px 140px;
    gap: var(--spacing-md);
    padding: 6px var(--spacing-md);
    padding-left: var(--spacing-lg);
    align-items: center;
    border-radius: var(--radius-md);
    transition: background-color var(--transition-fast);
    width: 100%; text-align: left; height: 50px; box-sizing: border-box;
  }
  .list-body.with-drag :global(.track-row) { grid-template-columns: 32px 40px 1fr 1fr 80px 140px; }
  .list-body.no-album :global(.track-row) { grid-template-columns: 40px 1fr 80px 140px; }
  .list-body.no-album.with-drag :global(.track-row) { grid-template-columns: 32px 40px 1fr 80px 140px; }
  .list-body.multiselect :global(.track-row) { grid-template-columns: 40px 40px 1fr 1fr 80px 140px; }
  .list-body.multiselect.no-album :global(.track-row) { grid-template-columns: 40px 40px 1fr 80px 140px; }

  :global(.track-row.selected) { background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.12); }
  :global(.track-row.selected:hover) { background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.18); }
  :global(.track-row:hover) { background-color: rgba(255, 255, 255, 0.1); cursor: pointer; }
  :global(.track-row.playing) { background-color: var(--bg-surface); }
  :global(.track-row.playing .track-name) { color: var(--accent-primary); }
  :global(.track-row.dragging) { opacity: 0.5; background-color: var(--bg-highlight); }
  :global(.track-row.drag-over) { border-top: 2px solid var(--accent-primary); margin-top: -2px; }
  :global(.track-row.unavailable) { opacity: 0.5; cursor: not-allowed; }
  :global(.track-row.unavailable:hover) { background-color: transparent; }

  :global(.drag-handle) {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; color: var(--text-subdued); cursor: grab; opacity: 0;
    transition: all var(--transition-fast); flex-shrink: 0;
    user-select: none; -webkit-user-select: none; touch-action: none;
  }
  :global(.track-row:hover .drag-handle) { opacity: 1; }
  :global(.drag-handle:hover) { color: var(--text-primary); background-color: rgba(255,255,255,0.1); border-radius: var(--radius-sm); }
  :global(.drag-handle:active) { cursor: grabbing; background-color: rgba(255,255,255,0.15); }

  :global(.col-num) { position: relative; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-subdued); font-size: var(--font-size-base); }
  :global(.track-row:hover .col-num:not(:has(.playing-icon))) { color: var(--text-primary); }
  :global(.track-index), :global(.hover-play) { transition: opacity var(--transition-fast); }
  :global(.hover-play) { position: absolute; opacity: 0; color: var(--text-primary); font-size: 0.82rem; line-height: 1; }
  :global(.track-row:hover .track-index) { opacity: 0; }
  :global(.track-row:hover .hover-play) { opacity: 1; }
  :global(.track-row.unavailable:hover .hover-play), :global(.track-row.unavailable:hover .track-index) { opacity: 1; }

  :global(.col-cover) { display: flex; align-items: center; justify-content: center; }
  :global(.cover-image) { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; }
  :global(.cover-placeholder) { width: 40px; height: 40px; border-radius: var(--radius-sm); background-color: var(--bg-highlight); display: flex; align-items: center; justify-content: center; color: var(--text-subdued); }
  :global(.cover-wrapper) { position: relative; width: 40px; height: 40px; }
  :global(.cover-play-overlay) { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background-color: rgba(0,0,0,0.6); border-radius: var(--radius-sm); opacity: 0; transition: opacity var(--transition-fast); color: var(--text-primary); }
  :global(.track-row:hover .cover-play-overlay) { opacity: 1; }
  :global(.track-row.playing .cover-play-overlay) { opacity: 0; }

  :global(.playing-icon) { color: var(--accent-primary); animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  :global(.col-title) { display: flex; flex-direction: column; min-width: 0; justify-content: center; gap: 1px; height: 100%; padding-top: 1.5px; }
  :global(.col-artist) { display: flex; align-items: center; min-width: 0; gap: 8px; }
  :global(.artist-thumb) { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; }
  :global(.cover-image-small) { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
  :global(.cover-placeholder-small) { width: 28px; height: 28px; border-radius: 6px; background-color: var(--bg-highlight); color: var(--text-subdued); display: flex; align-items: center; justify-content: center; }
  :global(.artist-meta) { display: flex; flex-direction: column; justify-content: center; min-width: 0; gap: 1px; }
  :global(.title-row) { display: flex; align-items: center; gap: var(--spacing-sm); min-width: 0; }
  :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-medium); color: var(--text-primary); line-height: var(--line-height-tight); margin: 0; }

  :global(.quality-tag) { font-size: 0.6rem; font-weight: var(--font-weight-bold); padding: 2px 6px; border-radius: var(--radius-sm); background-color: var(--bg-highlight); color: var(--text-secondary); border: 1px solid var(--border-color); white-space: nowrap; flex-shrink: 0; opacity: 0.7; transition: opacity var(--transition-fast); }
  :global(.track-row:hover .quality-tag) { opacity: 1; }
  :global(.quality-tag.high-quality) { color: var(--accent-primary); border-color: var(--accent-primary); background-color: color-mix(in srgb, var(--accent-primary), transparent 85%); }

  :global(.track-artist) { font-size: var(--font-size-sm); color: var(--text-secondary); background: none; border: none; padding: 0; margin: 0; text-align: left; max-width: fit-content; line-height: var(--line-height-tight); min-height: 0; }
  :global(.track-artist:hover:not(:disabled)) { color: var(--text-primary); text-decoration: underline; cursor: pointer; }
  :global(.media-metadata) { font-size: 0.7rem; color: var(--text-subdued); opacity: 0.9; }

  :global(.col-album-cell) { font-size: var(--font-size-base); color: var(--text-secondary); background: none; border: none; padding: 0; width: 100%; justify-self: stretch; text-align: left; line-height: var(--line-height-tight); }
  :global(.col-album-cell:hover:not(:disabled)) { color: var(--text-primary); text-decoration: underline; cursor: pointer; }
  :global(.col-duration) { text-align: right; font-size: var(--font-size-base); color: var(--text-subdued); display: flex; align-items: center; justify-content: flex-end; }
  :global(.col-date-added) { text-align: right; font-size: var(--font-size-sm); color: var(--text-subdued); display: flex; align-items: center; justify-content: flex-end; }

  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--spacing-xl); color: var(--text-subdued); text-align: center; gap: var(--spacing-sm); height: 100%; }
  .empty-state h3 { font-size: 1.25rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); }
  .empty-state p { font-size: var(--font-size-base); }

  :global(.downloaded-icon) { color: var(--accent-primary); display: flex; align-items: center; margin-left: var(--spacing-xs); flex-shrink: 0; }
  :global(.truncate) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  :global(.col-checkbox) { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  :global(.custom-checkbox) { width: 20px; height: 20px; border: 2px solid var(--border-color); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; transition: all var(--transition-fast); background-color: transparent; position: relative; }
  :global(.custom-checkbox:hover) { border-color: var(--accent-primary); background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.1); }
  :global(.custom-checkbox.checked) { background-color: var(--accent-primary); border-color: var(--accent-primary); }
  :global(.custom-checkbox svg) { color: var(--bg-base); }

  :global(.equalizer-bars) { display: none; }

  @media (max-width: 768px) {
    .list-toolbar { display: none; }
    :global(.list-header) { display: none; }
    :global(.quality-tag) { display: none; }
    :global(.cover-play-overlay) { display: none; }
    :global(.drag-handle) { opacity: 1; }
    :global(.track-row) { gap: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); height: 60px; min-height: 60px; }

    .list-body.mobile-album :global(.track-row) { grid-template-columns: 32px 1fr 48px; padding-left: var(--spacing-sm); }
    .list-body.mobile-album :global(.col-num) { display: flex; align-items: center; justify-content: center; font-size: 0.9375rem; color: var(--text-subdued); }
    .list-body.mobile-album :global(.track-row.playing .col-num) { color: var(--accent-primary); }
    .list-body.mobile-album :global(.col-cover) { display: none; }
    .list-body.mobile-album :global(.col-album-cell) { display: none; }
    .list-body.mobile-album :global(.equalizer-bars) { display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 16px; width: 16px; }
    .list-body.mobile-album :global(.playing-icon) { display: none; }
    :global(.eq-bar) { width: 3px; background-color: var(--accent-primary); border-radius: 1px; animation: eq-bounce 1.2s ease-in-out infinite; }
    :global(.eq-bar:nth-child(1)) { height: 60%; animation-delay: 0s; }
    :global(.eq-bar:nth-child(2)) { height: 100%; animation-delay: 0.2s; }
    :global(.eq-bar:nth-child(3)) { height: 40%; animation-delay: 0.4s; }
    :global(.eq-bar:nth-child(4)) { height: 80%; animation-delay: 0.6s; }
    @keyframes eq-bounce { 0%, 100% { height: 20%; } 50% { height: 100%; } }
    .list-body.mobile-album :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); }
    .list-body.mobile-album :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-secondary); }
    .list-body.mobile-album :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
    .list-body.mobile-album.with-drag :global(.track-row) { grid-template-columns: 28px 32px 1fr 48px; }
    .list-body.mobile-album.multiselect :global(.track-row) { grid-template-columns: 36px 32px 1fr 48px; }

    .list-body.mobile-playlist :global(.track-row) { grid-template-columns: 48px 1fr 48px; padding-left: var(--spacing-sm); }
    .list-body.mobile-playlist :global(.col-num) { display: none; }
    .list-body.mobile-playlist :global(.col-album-cell) { display: none; }
    .list-body.mobile-playlist :global(.cover-wrapper), .list-body.mobile-playlist :global(.cover-image), .list-body.mobile-playlist :global(.cover-placeholder) { width: 48px; height: 48px; border-radius: var(--radius-sm); }
    .list-body.mobile-playlist :global(.col-cover) { justify-content: flex-start; align-items: center; }
    .list-body.mobile-playlist :global(.col-title) { padding-top: 0; justify-content: center; }
    .list-body.mobile-playlist :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); }
    .list-body.mobile-playlist :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 0; }
    .list-body.mobile-playlist :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
    .list-body.mobile-playlist.with-drag :global(.track-row) { grid-template-columns: 28px 48px 1fr 48px; }
    .list-body.mobile-playlist.multiselect :global(.track-row) { grid-template-columns: 36px 48px 1fr 48px; }

    .list-body.mobile-library :global(.track-row) { grid-template-columns: 48px 1fr 48px; padding-left: var(--spacing-sm); }
    .list-body.mobile-library :global(.col-num) { display: none; }
    .list-body.mobile-library :global(.col-album-cell) { display: none; }
    .list-body.mobile-library :global(.cover-wrapper), .list-body.mobile-library :global(.cover-image), .list-body.mobile-library :global(.cover-placeholder) { width: 48px; height: 48px; border-radius: var(--radius-sm); }
    .list-body.mobile-library :global(.col-cover) { justify-content: flex-start; align-items: center; }
    .list-body.mobile-library :global(.col-title) { padding-top: 0; justify-content: center; }
    .list-body.mobile-library :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); }
    .list-body.mobile-library :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
    .list-body.mobile-library :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
    .list-body.mobile-library.with-drag :global(.track-row) { grid-template-columns: 28px 48px 1fr 48px; }
    .list-body.mobile-library.multiselect :global(.track-row),
    .list-body.mobile-library.multiselect.no-album :global(.track-row) { grid-template-columns: 36px 48px 1fr 48px; }

    :global(.track-row.playing .track-name) { color: var(--accent-primary); }
    :global(.track-row.playing .col-num) { color: var(--accent-primary); }
    :global(.downloaded-icon) { margin-left: 2px; }
    :global(.downloaded-icon svg) { width: 12px; height: 12px; }

    :global(.track-row) { position: relative; will-change: transform; }
    :global(.track-row::before) { content: ""; position: absolute; inset: 0; border-radius: var(--radius-md); background-color: transparent; transition: background-color 0.15s ease; z-index: -1; pointer-events: none; }
    :global(.track-row.swipe-queue-ready::before) { background-color: color-mix(in srgb, var(--accent-primary), transparent 80%); }
    :global(.track-row.swipe-queue-added::before) { background-color: color-mix(in srgb, var(--accent-primary), transparent 65%); }
    :global(.track-row::after) { content: "+"; position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 1.25rem; font-weight: var(--font-weight-bold); color: var(--accent-primary); opacity: 0; transition: opacity 0.15s ease; pointer-events: none; z-index: -1; }
    :global(.track-row.swipe-queue-ready::after) { opacity: 1; }
    :global(.track-row.swipe-queue-added::after) { content: "✓"; opacity: 1; }
  }
</style>
