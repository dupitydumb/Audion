<script context="module" lang="ts">
  let activeTrackListCount = 0;
</script>

<script lang="ts">
  import type { Track } from "$lib/api/tauri";
  import {
    formatDuration,
    getAlbumArtSrc,
    reorderPlaylistTracks,
  } from "$lib/api/tauri";
  import {
    playTracks,
    togglePlay,
    currentTrack,
    isPlaying,
    addToQueue,
    shuffle,
    type PlaybackContext,
  } from "$lib/stores/player";
  import { contextMenu, isFullScreen } from "$lib/stores/ui";
  import {
    albums,
    playlists,
    loadPlaylists,
    resolveTrackCover,
    loadMoreTracks,
    tracks as libraryTracks,
    trackCount,
  } from "$lib/stores/library";
  import { get } from "svelte/store";
  import { appSettings } from "$lib/stores/settings";
  import { isInputElement, isShortcutsHelpVisible } from "$lib/stores/shortcuts";
  import { customArtworks } from "$lib/stores/customArtwork";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { addToast } from "$lib/stores/toast";
  import { isOnline } from "$lib/stores/network";
  import { onDestroy, onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { multiSelect } from "$lib/stores/multiselect";
  import { trackSelectionStore } from "$lib/stores/trackSelectionStore";
  import { isMobile, registerBackHandler } from "$lib/stores/mobile";
  import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
  import MetadataModal from "$lib/components/MetadataModal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { _, locale } from "svelte-i18n";
  import { buildTrackContextMenu, isTrackUnavailable } from "$lib/menus/contextMenus";
  import { providersStore } from "$lib/plugins/providers";
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
  export let allowMultiSelectEntry: boolean = false;
  export let onEnterMultiSelect: (() => void) | undefined = undefined;
  export let onExitMultiSelect: (() => void) | undefined = undefined;
  export let showMobileActionBar: boolean = true;
  export let externalScroll: boolean = false;
  export let queueTracks: Track[] | null = null; // New prop for unified queue context

  let localSelectMode = false;
  $: effectiveMultiSelectMode = multiSelectMode || localSelectMode;

  // Virtual scrolling configuration
  // must match the row height in css (desktop 50px, html.layout-mobile 60px)
  // a wrong value => rows jump every time the visible window shifts
  const DESKTOP_ROW_HEIGHT = 50;
  const MOBILE_ROW_HEIGHT = 60;
  $: rowHeight = $isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT;
  const OVERSCAN = 5; // Extra rows to render above/below viewport

  let containerHeight = 600; // Will be calculated from container
  let scrollTop = 0;
  let scrollbarWidth = 0;
  let containerElement: HTMLDivElement;
  let rootElement: HTMLDivElement;
  let scrollParent: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let unregisterBack: (() => void) | null = null;

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

  // custom artwork changed (set/removed) => drop cached covers so rows re-resolve
  $: {
    void $customArtworks;
    trackAlbumArtCache.clear();
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

  // Clear availability cache when dependencies change (including plugin store and providers store)
  // references $pluginStore to ensure reactivity when store state changes (e.g. init -> loaded)
  $: runtime = $pluginStore && pluginStore.getRuntime();
  $: activeProviders = $providersStore;
  $: {
    // Watch all relevant dependencies
    const _ = runtime;
    const __ = activeProviders;
    if ($isOnline !== undefined || isTidalAvailable !== undefined || activeProviders !== undefined) {
      availabilityCache.clear();
    }
  }

  $: filteredTracks = tracks;

  // When tracks prop changes, evict cache entries whose cover_url changed
  // (Subsonic loads covers async — track objects are replaced with updated cover_url)
  let lastTracksRef = tracks;
  $: {
    if (tracks !== lastTracksRef) {
      for (const t of tracks) {
        if (t.cover_url && trackAlbumArtCache.get(t.id) !== t.cover_url) {
          trackAlbumArtCache.delete(t.id);
        }
      }
      lastTracksRef = tracks;
    }
  }

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
    trackSelectionStore.resetAnchor();
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
      if (sortField !== lastSortField || sortDirection !== lastSortDirection) {
        trackSelectionStore.resetAnchor();
      }
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

  // primitives => dependants only re-run when the value actually changes,
  // not on every scroll event
  $: rangeStart = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  $: rangeEnd = Math.min(
    sortedTracks.length,
    Math.ceil((scrollTop + containerHeight) / rowHeight) + OVERSCAN,
  );

  $: virtualScrollState = {
    totalHeight: sortedTracks.length * rowHeight,
    startIndex: rangeStart,
    endIndex: rangeEnd,
    offsetY: rangeStart * rowHeight,
    visibleTracks: sortedTracks.slice(rangeStart, rangeEnd),
  };

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

  // 5: Pre-compute album art, availability, and date for visible tracks
  type TrackWithMetadata = {
    track: Track;
    albumArt: string | null;
    unavailable: boolean;
    formattedDate: string;
  };

  // Date format cache — keyed by raw date_added string, invalidated on locale change
  const dateFormatCache = new Map<string, string>();
  $: {
    // Bust cache when locale changes so re-renders pick up new format
    const _loc = $locale;
    dateFormatCache.clear();
  }

  function getCachedFormattedDate(dateAdded?: string | null): string {
    if (!dateAdded) return $_('common.unknown');
    if (dateFormatCache.has(dateAdded)) return dateFormatCache.get(dateAdded)!;
    const result = formatDateAdded(dateAdded);
    dateFormatCache.set(dateAdded, result);
    return result;
  }

  $: visibleTracksWithMetadata = virtualScrollState.visibleTracks.map(
    (track) => {
      // Re-evaluate when runtime or custom artwork changes
      const _ = runtime;
      const _custom = $customArtworks;
      return {
        track,
        albumArt: getTrackAlbumArt(track),
        unavailable: getCachedUnavailable(track),
        formattedDate: getCachedFormattedDate(track.date_added),
      };
    },
  ) as TrackWithMetadata[];

  function handleScroll(e: Event) {
    if (externalScroll) return;
    const target = e.target as HTMLElement;
    scrollTop = target.scrollTop;
  }

  function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    let cur = el?.parentElement ?? null;
    while (cur) {
      const style = window.getComputedStyle(cur);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function updateExternalMetrics() {
    if (!externalScroll || !containerElement) return;
    if (!scrollParent) {
      scrollParent = findScrollParent(containerElement);
    }
    if (!scrollParent) {
      containerHeight = containerElement.clientHeight || window.innerHeight;
      scrollTop = 0;
      return;
    }
    const parentRect = scrollParent.getBoundingClientRect();
    const bodyRect = containerElement.getBoundingClientRect();
    const visibleTop = Math.max(0, parentRect.top - bodyRect.top);
    const visibleBottom = Math.max(0, Math.min(bodyRect.height, parentRect.bottom - bodyRect.top));
    scrollTop = visibleTop;
    containerHeight = Math.max(0, visibleBottom - visibleTop);
  }

  $: if (externalScroll && (sortedTracks.length >= 0 || rowHeight > 0)) {
    tick().then(updateExternalMetrics);
  }

  // Measure container height on mount
  onMount(() => {
    activeTrackListCount++;

    unregisterBack = registerBackHandler(() => {
      if (localSelectMode) {
        exitMobileSelect();
        return true;
      }
      return false;
    });

    // 5: Load playlists once on mount to avoid race conditions
    if ($playlists.length === 0) {
      loadPlaylists();
    }

    if (containerElement) {
      const updateHeight = () => {
        if (!containerElement) return;
        if (externalScroll) {
          updateExternalMetrics();
          return;
        }
        containerHeight = containerElement.clientHeight;
        scrollbarWidth = Math.max(
          0,
          containerElement.offsetWidth - containerElement.clientWidth,
        );
      };

      if (externalScroll) {
        scrollParent = findScrollParent(containerElement);
        scrollParent?.addEventListener("scroll", updateExternalMetrics, { passive: true });
      }

      updateHeight();

      if (scrollKey) {
        const saved = getScroll(scrollKey);
        if (saved > 0) {
          if (externalScroll && scrollParent) {
            scrollParent.scrollTop = saved;
            updateExternalMetrics();
          } else if (containerElement) {
            containerElement.scrollTop = saved;
          }
        }
      }

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(containerElement);
        if (externalScroll && scrollParent) {
          resizeObserver.observe(scrollParent);
        }
      } else {
        window.addEventListener("resize", updateHeight);
      }
    }
  });

  // Cleanup for drag listeners to prevent memory leaks
  let cleanupDragListeners: (() => void) | null = null;

  // Cleanup on destroy
  onDestroy(() => {
    unregisterBack?.();
    unregisterBack = null;
    if (localSelectMode) {
      multiSelect.clearSelections();
    }
    activeTrackListCount = Math.max(0, activeTrackListCount - 1);
    if (activeTrackListCount === 0) {
      trackSelectionStore.clearSelections();
    }
    if (scrollKey) {
      saveScroll(scrollKey, externalScroll && scrollParent ? scrollParent.scrollTop : scrollTop);
    }
    scrollParent?.removeEventListener("scroll", updateExternalMetrics);
    scrollParent = null;
    failedImages.clear();
    trackAlbumArtCache.clear();
    albumMap.clear();
    availabilityCache.clear();
    dateFormatCache.clear();

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
    if (justSwipedTimer) {
      clearTimeout(justSwipedTimer);
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

  // Cached cover lookup - resolution itself lives in the shared resolver
  function getTrackAlbumArt(track: Track): string | null {
    if (trackAlbumArtCache.has(track.id)) {
      return trackAlbumArtCache.get(track.id) ?? null;
    }

    const album = track.album_id ? albumMap.get(track.album_id) : null;
    const result = resolveTrackCover(track, album);

    trackAlbumArtCache.set(track.id, result);
    return result;
  }

  function playTrackAtIndex(trackIndex: number, trackId: number) {
    const track = sortedTracks[trackIndex];
    if (!track || getCachedUnavailable(track)) return;

    trackSelectionStore.selectSingle(trackId, trackIndex);

    if (queueTracks) {
      const globalIndex = queueTracks.findIndex((t) => t.id === trackId);
      if (globalIndex !== -1) {
        playTracks(queueTracks, globalIndex, playbackContext);
        return;
      }
    }
    playTracks(sortedTracks, trackIndex, playbackContext);
  }

  function openTrackContextMenu(
    clientX: number,
    clientY: number,
    track: Track,
    trackIndex: number,
  ) {
    const selectedIds = effectiveMultiSelectMode
      ? $multiSelect.selectedTrackIds
      : $trackSelectionStore.selectedTrackIds;
    const isTargetSelected = selectedIds.has(track.id);

    let selectedTracks: Track[] | undefined;
    if (isTargetSelected && selectedIds.size > 1) {
      selectedTracks = sortedTracks.filter((t) => selectedIds.has(t.id));
    } else if (!isTargetSelected && !effectiveMultiSelectMode) {
      trackSelectionStore.selectSingle(track.id, trackIndex);
    }

    contextMenu.set({
      visible: true,
      x: clientX,
      y: clientY,
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
        selectedTracks,
        t: $_,
        onMetadataOpen: (t) => { metadataModalTrack = t; },
        onArtworkCacheInvalidate: (id) => { trackAlbumArtCache.delete(id); },
        onAvailabilityCacheInvalidate: (id) => { availabilityCache.delete(id); },
        onTracksUpdated: (updated) => {
          tracks = updated;
          trackSelectionStore.clearSelections();
          if (effectiveMultiSelectMode) {
            multiSelect.clearSelections();
          }
        },
      }),
    });
  }

  function handleRowMoreClick(e: MouseEvent, track: Track, index: number) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openTrackContextMenu(rect.left, rect.bottom, track, index);
  }

  function handleMobileShuffleAll() {
    const list = queueTracks && queueTracks.length > 0 ? queueTracks : sortedTracks;
    const playable = list.filter((t) => !getCachedUnavailable(t));
    if (playable.length === 0) return;
    shuffle.set(true);
    const randomTrack = playable[Math.floor(Math.random() * playable.length)];
    const startIdx = list.findIndex((t) => t.id === randomTrack.id);
    playTracks(list, startIdx >= 0 ? startIdx : 0, playbackContext);
  }

  function sortFieldLabel(field: SortField): string {
    switch (field) {
      case "title":
        return $_("trackList.title");
      case "track_number":
        return "#";
      case "artist":
        return $_("sidebar.artists");
      case "album":
        return $_("trackList.album");
      case "duration":
        return $_("trackList.duration");
      case "date_added":
        return $_("trackList.dateAdded");
      default:
        return $_("trackList.sort", { default: "Sort" });
    }
  }

  function openMobileSortMenu(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fields: { field: SortField; label: string }[] = [
      ...(!showAlbum ? [{ field: "track_number" as SortField, label: "#" }] : []),
      { field: "title", label: $_("trackList.title") },
      { field: "artist", label: $_("sidebar.artists") },
      ...(showAlbum ? [{ field: "album" as SortField, label: $_("trackList.album") }] : []),
      { field: "duration", label: $_("trackList.duration") },
      { field: "date_added", label: $_("trackList.dateAdded") },
    ];
    contextMenu.set({
      visible: true,
      x: rect.left,
      y: rect.bottom,
      items: [
        {
          label: $_("trackList.sortDefault", { default: "Default order" }),
          icon: sortField === null ? "check" : undefined,
          action: () => {
            sortField = null;
            sortDirection = "asc";
            trackSelectionStore.resetAnchor();
          },
        },
        { type: "separator" },
        ...fields.map(({ field, label }) => ({
          label,
          icon:
            sortField === field
              ? sortDirection === "asc"
                ? "arrow-up"
                : "arrow-down"
              : undefined,
          action: () => toggleSort(field),
        })),
      ],
    });
  }

  function enterMobileSelect() {
    if (onEnterMultiSelect) {
      onEnterMultiSelect();
    } else {
      multiSelect.clearSelections();
      localSelectMode = true;
    }
  }

  function exitMobileSelect() {
    if (onExitMultiSelect) {
      onExitMultiSelect();
    } else {
      localSelectMode = false;
      multiSelect.clearSelections();
    }
  }

  function openMobileBulkActions(e: MouseEvent) {
    const selectedIds = $multiSelect.selectedTrackIds;
    const selected = sortedTracks.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;
    const firstIdx = trackIndexMap.get(selected[0].id) ?? 0;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openTrackContextMenu(rect.left, rect.bottom, selected[0], firstIdx);
  }

  // Event delegation
  function handleBodyClick(e: MouseEvent) {
    if (justSwiped) return;
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest(".drag-handle, .row-more-btn, .track-artist, .col-album-cell")) {
      return;
    }

    const row = targetEl.closest(".track-row") as HTMLElement | null;
    if (!row) {
      if (!effectiveMultiSelectMode) {
        trackSelectionStore.clearSelections();
      }
      return;
    }

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");

    // In multi-select mode, clicking toggles selection
    if (effectiveMultiSelectMode) {
      multiSelect.toggleTrack(trackId);
      return;
    }

    const trackIndex = trackIndexMap.get(trackId);
    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (!track) return;

    // On mobile, single-tap on a track row plays immediately (do not require double-tap).
    // On desktop, clicking directly on play icon / hover play / cover play overlay plays.
    const isPlayAction = !!targetEl.closest(".hover-play, .cover-play-overlay");
    if (isPlayAction || $isMobile) {
      playTrackAtIndex(trackIndex, trackId);
      return;
    }

    // Desktop OS table selection
    if (e.shiftKey) {
      trackSelectionStore.selectRange(trackIndex, sortedTracks, e.ctrlKey || e.metaKey);
    } else if (e.ctrlKey || e.metaKey) {
      trackSelectionStore.toggleTrack(trackId, trackIndex);
    } else {
      trackSelectionStore.selectSingle(trackId, trackIndex);
    }

    row.focus();
  }

  function handleBodyDoubleClick(e: MouseEvent) {
    if ($isMobile || effectiveMultiSelectMode) return;
    const row = (e.target as HTMLElement).closest(".track-row");
    if (!row) return;

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");
    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;
    playTrackAtIndex(trackIndex, trackId);
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

    openTrackContextMenu(e.clientX, e.clientY, track, trackIndex);
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

  // ── Drag and drop for playlist reordering ──
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;
  let isDragging = false;
  let dragGhost: HTMLElement | null = null;
  let dragGrabOffsetY = 0;
  let dragRowHeight = 48;

  /** Per-row translateY in px, keyed by actual track index. */
  let dragShifts: Record<number, number> = {};

  function computeShifts(dragged: number, over: number | null): Record<number, number> {
    if (over === null) return {};
    const shifts: Record<number, number> = {};
    const dir = over > dragged ? 1 : -1; // dragging down (+1) or up (-1)
    const lo = Math.min(dragged, over);
    const hi = Math.max(dragged, over);
    for (let i = lo; i <= hi; i++) {
      if (i === dragged) continue;
      shifts[i] = dir > 0 ? -dragRowHeight : dragRowHeight;
    }
    return shifts;
  }

  function createGhost(sourceRow: HTMLElement, clientY: number): HTMLElement {
    const rect = sourceRow.getBoundingClientRect();
    dragRowHeight = rect.height;
    dragGrabOffsetY = clientY - rect.top;

    const ghost = sourceRow.cloneNode(true) as HTMLElement;
    ghost.classList.remove("dragging", "drag-over", "playing", "selected");
    ghost.style.cssText = [
      `position: fixed`,
      `top: ${rect.top}px`,
      `left: ${rect.left}px`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
      `pointer-events: none`,
      `z-index: 9999`,
      `opacity: 0.95`,
      `border-radius: var(--radius-md, 8px)`,
      `box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)`,
      `transform: rotate(1.5deg) scale(1.02)`,
      `transform-origin: center center`,
      `background: var(--bg-highlight)`,
      `transition: none`,
      `will-change: top`,
    ].join('; ');
    document.body.appendChild(ghost);
    return ghost;
  }

  function handlePointerDown(e: PointerEvent, actualIndex: number) {
    if (!playlistId) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    // Find the track-row ancestor to clone
    const row = handle.closest('.track-row') as HTMLElement | null;
    if (row) dragGhost = createGhost(row, e.clientY);

    isDragging = true;
    draggedIndex = actualIndex;
    dragOverIndex = null;
    dragShifts = {};

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    cleanupDragListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging || draggedIndex === null || !playlistId) return;

    // Move ghost
    if (dragGhost) {
      dragGhost.style.top = `${e.clientY - dragGrabOffsetY}px`;
    }

    // Compute target index from pointer position relative to the scroll container.
    // This avoids unreliable DOM hit-testing with z-stacked/clipped elements.
    let newOver: number | null = null;
    if (containerElement) {
      const rect = containerElement.getBoundingClientRect();
      // pointer Y relative to the list content (account for scroll)
      const relY = e.clientY - rect.top + containerElement.scrollTop;
      const idx = Math.floor(relY / rowHeight);
      const clamped = Math.max(0, Math.min(sortedTracks.length - 1, idx));
      if (clamped !== draggedIndex) newOver = clamped;
    }

    if (newOver !== dragOverIndex) {
      dragOverIndex = newOver;
      dragShifts = computeShifts(draggedIndex, dragOverIndex);
    }
  }

  async function handlePointerUp() {
    // Fade out ghost
    if (dragGhost) {
      dragGhost.style.transition = 'opacity 120ms ease, transform 120ms ease';
      dragGhost.style.opacity = '0';
      dragGhost.style.transform = 'scale(0.96)';
      const g = dragGhost;
      setTimeout(() => g.remove(), 130);
      dragGhost = null;
    }

    if (
      isDragging &&
      draggedIndex !== null &&
      dragOverIndex !== null &&
      draggedIndex !== dragOverIndex &&
      playlistId
    ) {
      try {
        await reorderPlaylistTracks(playlistId, draggedIndex, dragOverIndex);
        // Reorder on sortedTracks (what the user sees), then update the source prop.
        // sortedTracks === tracks when no sort is active (common for playlists).
        const newTracks = [...sortedTracks];
        const [removed] = newTracks.splice(draggedIndex, 1);
        newTracks.splice(dragOverIndex, 0, removed);
        tracks = newTracks;
        addToast($_('trackList.tracksReordered'), "success");
      } catch (error) {
        console.error("Failed to reorder tracks:", error);
        addToast($_('trackList.reorderTracksFailed', { values: { error: String(error) } }), "error");
      }
    }

    isDragging = false;
    draggedIndex = null;
    dragOverIndex = null;
    dragShifts = {};

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
  let swipingInner: HTMLElement | null = null;
  let swipeTrackId: number | null = null;
  let swipeCommitted = false;
  let justSwiped = false;
  let justSwipedTimer: ReturnType<typeof setTimeout> | null = null;
  const SWIPE_THRESHOLD = 80; // px to trigger add-to-queue
  const SWIPE_MAX = 120;
  let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSwipeTouchStart(e: TouchEvent) {
    if (!$isMobile || effectiveMultiSelectMode) return;
    // Don't swipe on drag handles or overflow button
    if ((e.target as HTMLElement).closest(".drag-handle, .row-more-btn")) return;

    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeDeltaX = 0;
    swipeCommitted = false;

    const row = (e.target as HTMLElement).closest(".track-row") as HTMLElement | null;
    if (row) {
      swipingRow = row;
      swipingInner = row.querySelector(".track-row-inner") as HTMLElement | null;
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
      if (swipingInner) {
        swipingInner.style.transform = "";
        swipingInner.style.transition = "";
      }
      swipingRow.classList.remove("swiping", "swipe-queue-ready");
      swipingRow = null;
      swipingInner = null;
      return;
    }

    // Only right-swipe
    if (dx < 0) {
      swipeDeltaX = 0;
      if (swipingInner) swipingInner.style.transform = "";
      swipingRow.classList.remove("swipe-queue-ready");
      return;
    }

    // Prevent vertical scroll while swiping
    e.preventDefault();

    swipeDeltaX = Math.min(dx, SWIPE_MAX);
    swipingRow.classList.add("swiping");
    if (swipingInner) {
      swipingInner.style.transition = "none";
      swipingInner.style.transform = `translateX(${swipeDeltaX}px)`;
    }

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
    const inner = swipingInner;
    const trackId = swipeTrackId;

    if (swipeDeltaX > 10) {
      justSwiped = true;
      if (justSwipedTimer) clearTimeout(justSwipedTimer);
      justSwipedTimer = setTimeout(() => {
        justSwiped = false;
      }, 120);
    }

    if (swipeDeltaX >= SWIPE_THRESHOLD && trackId) {
      swipeCommitted = true;
      row.classList.add("swipe-queue-added", "swipe-animating");
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
        if (inner) {
          inner.style.transition = "transform 0.25s ease";
          inner.style.transform = "";
        }
        row.classList.remove("swipe-queue-added", "swiping");
        setTimeout(() => row.classList.remove("swipe-animating"), 260);
      }, 400);
    } else {
      // Snap back
      row.classList.add("swipe-animating");
      if (inner) {
        inner.style.transition = "transform 0.25s ease";
        inner.style.transform = "";
      }
      row.classList.remove("swipe-queue-ready", "swiping");
      setTimeout(() => row.classList.remove("swipe-animating"), 260);
    }

    swipingRow = null;
    swipingInner = null;
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

  // ── Alphabetical jump ───────────────────────────────────────────────────
  // With "Alphabetical jump" on (keyboard shortcuts modal) and the list sorted by title, artist
  // or album, typing a letter scrolls to the first track in the list that starts with it.
  const JUMP_SORT_FIELDS = new Set<SortField>(["title", "artist", "album"]);
  let jumpInFlight = false;

  function jumpValue(track: Track): string {
    const raw =
      sortField === "title"
        ? track.title
        : sortField === "artist"
          ? track.artist
          : track.album;
    // same normalisation the sort itself uses (lower-cased), minus leading spaces
    return (raw || "").toLowerCase().trimStart();
  }

  function findFirstStartingWith(char: string): number {
    for (let i = 0; i < sortedTracks.length; i++) {
      if (jumpValue(sortedTracks[i]).startsWith(char)) return i;
    }
    return -1;
  }

  // the main library list is loaded in batches; a letter may sit in a batch that isn't loaded yet
  function canLoadMoreLibrary(): boolean {
    const library = get(libraryTracks);
    return tracks === library && library.length < get(trackCount);
  }

  // ── Jump indicator: an A–Z strip on the right with a bubble for the jumped-to letter ──
  const JUMP_STRIP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const JUMP_BUBBLE_MS = 800; // how long the letter bubble stays
  const JUMP_STRIP_IDLE_MS = 1600; // the strip goes away this long after the last key press

  let jumpStripVisible = false;
  let jumpBubbleVisible = false;
  let jumpLetter = "";
  let jumpLetterIndex = -1; // position in the strip; -1 for letters outside A–Z (e.g. Cyrillic)
  let jumpMatched = true;
  let jumpBubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let jumpStripTimer: ReturnType<typeof setTimeout> | undefined;

  function showJumpIndicator(char: string) {
    jumpLetter = char.toUpperCase();
    jumpLetterIndex = JUMP_STRIP_LETTERS.indexOf(jumpLetter);
    jumpMatched = true;
    jumpStripVisible = true;
    jumpBubbleVisible = true;

    // every key press restarts both timers: bubble fades first, strip after a quiet period
    clearTimeout(jumpBubbleTimer);
    clearTimeout(jumpStripTimer);
    jumpBubbleTimer = setTimeout(() => (jumpBubbleVisible = false), JUMP_BUBBLE_MS);
    jumpStripTimer = setTimeout(() => (jumpStripVisible = false), JUMP_STRIP_IDLE_MS);
  }

  onDestroy(() => {
    clearTimeout(jumpBubbleTimer);
    clearTimeout(jumpStripTimer);
  });

  function scrollToIndex(index: number) {
    if (!containerElement) return;
    if (externalScroll && scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const bodyRect = containerElement.getBoundingClientRect();
      const bodyTopInParent = bodyRect.top - parentRect.top + scrollParent.scrollTop;
      scrollParent.scrollTop = bodyTopInParent + index * rowHeight;
      return;
    }
    containerElement.scrollTop = index * rowHeight;
  }

  async function handleAlphabeticalJump(e: KeyboardEvent) {
    const settings = get(appSettings);
    if (!settings.alphabeticalJump || !settings.shortcutsEnabled) return;

    // bare letters only (Alt + letter etc. stay shortcuts), ignore key-repeat
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
    if (!/^\p{L}$/u.test(e.key)) return;

    // only when the order the user sees is alphabetical
    if (!sortField || !JUMP_SORT_FIELDS.has(sortField)) return;

    // not while typing, in a dialog/overlay, or when this list isn't the one on screen
    if (isInputElement(e.target)) return;
    if (get(isShortcutsHelpVisible) || get(isFullScreen) || metadataModalTrack) return;
    if (!containerElement || containerElement.getClientRects().length === 0) return;
    if (jumpInFlight) return;

    e.preventDefault();
    const char = e.key.toLowerCase();
    showJumpIndicator(char);

    jumpInFlight = true;
    try {
      let index = findFirstStartingWith(char);

      // not in what's loaded: keep loading library batches until found or none are left
      let busyRetries = 0;
      while (index === -1 && canLoadMoreLibrary()) {
        const loaded = await loadMoreTracks();
        if (!loaded) {
          // loadMoreTracks also returns false while another load is running - wait, then retry
          if (++busyRetries > 20) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        busyRetries = 0;
        await tick(); // let the new tracks flow through the sort
        index = findFirstStartingWith(char);
      }

      if (index !== -1) {
        scrollToIndex(index);
        trackSelectionStore.setFocusedIndex(index);
      } else if (jumpLetter === char.toUpperCase()) {
        jumpMatched = false; // nothing starts with this letter: show it dimmed
      }
    } finally {
      jumpInFlight = false;
    }
  }

  function ensureIndexVisible(index: number) {
    if (!containerElement) return;
    if (externalScroll && scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const bodyRect = containerElement.getBoundingClientRect();
      const bodyTopInParent = bodyRect.top - parentRect.top + scrollParent.scrollTop;
      const itemTop = bodyTopInParent + index * rowHeight;
      const itemBottom = itemTop + rowHeight;
      const viewTop = scrollParent.scrollTop;
      const viewBottom = viewTop + scrollParent.clientHeight;
      if (itemTop < viewTop) {
        scrollParent.scrollTop = itemTop;
      } else if (itemBottom > viewBottom) {
        scrollParent.scrollTop = itemBottom - scrollParent.clientHeight;
      }
      return;
    }
    const itemTop = index * rowHeight;
    const itemBottom = itemTop + rowHeight;
    const viewTop = containerElement.scrollTop;
    const viewBottom = viewTop + containerHeight;

    if (itemTop < viewTop) {
      containerElement.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      containerElement.scrollTop = itemBottom - containerHeight;
    }
  }

  async function focusRowByIndex(index: number) {
    ensureIndexVisible(index);
    await tick();
    if (!containerElement) return;
    const rowEl = containerElement.querySelector(`[data-track-index="${index}"]`) as HTMLElement | null;
    if (rowEl) {
      rowEl.focus();
    }
  }

  async function handleTableKeydown(e: KeyboardEvent) {
    if (isInputElement(e.target)) return;
    if (get(isShortcutsHelpVisible) || get(isFullScreen) || metadataModalTrack) return;
    if (!containerElement || containerElement.getClientRects().length === 0) return;

    const isInsideList = !!rootElement && (rootElement.contains(document.activeElement) || rootElement.contains(e.target as Node));
    if (!isInsideList) return;

    // Ctrl / Cmd + A: Select all currently loaded/displayed tracks
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      if (effectiveMultiSelectMode) {
        multiSelect.selectAll(sortedTracks.map((t) => t.id));
      } else {
        trackSelectionStore.selectAll(sortedTracks.map((t) => t.id));
      }
      return;
    }

    const currentState = trackSelectionStore.getState();
    const currentFocused = currentState.focusedIndex;

    // Spacebar: Play/Pause or toggle
    if (e.key === " " || e.code === "Space") {
      if (isInsideList) {
        e.preventDefault();
        e.stopPropagation();
        if (currentFocused !== null && currentFocused >= 0 && currentFocused < sortedTracks.length) {
          const focusedTrack = sortedTracks[currentFocused];
          if (focusedTrack) {
            if ($currentTrack?.id === focusedTrack.id) {
              togglePlay();
            } else {
              if (queueTracks) {
                const globalIndex = queueTracks.findIndex((t) => t.id === focusedTrack.id);
                if (globalIndex !== -1) {
                  playTracks(queueTracks, globalIndex, playbackContext);
                  return;
                }
              }
              playTracks(sortedTracks, currentFocused, playbackContext);
            }
            return;
          }
        }
        togglePlay();
        return;
      }
    }

    // Enter: Start playback of selected/focused track in queue context
    if (e.key === "Enter") {
      if (isInsideList && currentFocused !== null && currentFocused >= 0 && currentFocused < sortedTracks.length) {
        const focusedTrack = sortedTracks[currentFocused];
        if (focusedTrack && !getCachedUnavailable(focusedTrack)) {
          e.preventDefault();
          if (queueTracks) {
            const globalIndex = queueTracks.findIndex((t) => t.id === focusedTrack.id);
            if (globalIndex !== -1) {
              playTracks(queueTracks, globalIndex, playbackContext);
              return;
            }
          }
          playTracks(sortedTracks, currentFocused, playbackContext);
          return;
        }
      }
    }

    // Escape: Clear selection
    if (e.key === "Escape") {
      if (currentState.selectedTrackIds.size > 0) {
        e.preventDefault();
        trackSelectionStore.clearSelections();
        return;
      }
    }

    // Arrow navigation & page navigation
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End" || e.key === "PageDown" || e.key === "PageUp") {
      if (!isInsideList) return;
      if (sortedTracks.length === 0) return;

      e.preventDefault();
      let nextIndex = currentFocused ?? 0;
      const pageSize = Math.max(1, Math.floor(containerHeight / rowHeight));

      if (e.key === "ArrowDown") {
        nextIndex = currentFocused === null ? 0 : Math.min(sortedTracks.length - 1, currentFocused + 1);
      } else if (e.key === "ArrowUp") {
        nextIndex = currentFocused === null ? 0 : Math.max(0, currentFocused - 1);
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = sortedTracks.length - 1;
      } else if (e.key === "PageDown") {
        nextIndex = Math.min(sortedTracks.length - 1, (currentFocused ?? 0) + pageSize);
      } else if (e.key === "PageUp") {
        nextIndex = Math.max(0, (currentFocused ?? 0) - pageSize);
      }

      if (e.shiftKey) {
        trackSelectionStore.selectRange(nextIndex, sortedTracks, e.ctrlKey || e.metaKey);
      } else if (e.ctrlKey || e.metaKey) {
        trackSelectionStore.setFocusedIndex(nextIndex);
      } else {
        trackSelectionStore.selectSingle(sortedTracks[nextIndex].id, nextIndex);
      }

      await focusRowByIndex(nextIndex);
      return;
    }

    await handleAlphabeticalJump(e);
  }
</script>

<svelte:window on:keydown={handleTableKeydown} />

{#if metadataModalTrack}
  <MetadataModal
    track={metadataModalTrack}
    onClose={() => {
      metadataModalTrack = null;
    }}
  />
{/if}

<div class="track-list" class:external-scroll={externalScroll} bind:this={rootElement}>
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
  {:else if showMobileActionBar && sortedTracks.length > 0}
    <div class="mobile-track-bar">
      {#if effectiveMultiSelectMode}
        <span class="mobile-select-count">
          {$_("playlist.selectedCount", { values: { count: $multiSelect.selectedTrackIds.size } })}
        </span>
        <div class="mobile-bar-actions">
          <button
            type="button"
            class="mobile-bar-btn"
            on:click={() => {
              if ($multiSelect.selectedTrackIds.size === sortedTracks.length) {
                multiSelect.clearSelections();
              } else {
                multiSelect.selectAll(sortedTracks.map((t) => t.id));
              }
            }}
          >
            {$multiSelect.selectedTrackIds.size === sortedTracks.length ? $_("playlist.clearAll") : $_("playlist.selectAll")}
          </button>
          <button
            type="button"
            class="mobile-bar-btn"
            disabled={$multiSelect.selectedTrackIds.size === 0}
            on:click|stopPropagation={openMobileBulkActions}
          >
            <Icon name="more-vertical" size={16} />
            <span>{$_("common.actions", { default: "Actions" })}</span>
          </button>
          <button
            type="button"
            class="mobile-bar-btn primary-pill"
            on:click={exitMobileSelect}
          >
            {$_("shortcuts.doneEditing", { default: "Done" })}
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="mobile-bar-btn primary-pill"
          on:click={handleMobileShuffleAll}
        >
          <Icon name="shuffle" size={16} />
          <span>{$_("liked.shuffle")}</span>
        </button>
        <div class="mobile-bar-actions">
          <button
            type="button"
            class="mobile-bar-btn"
            class:active={sortField !== null}
            on:click|stopPropagation={openMobileSortMenu}
          >
            <Icon name="arrow-up-down" size={16} />
            <span>{sortField ? sortFieldLabel(sortField) : $_("trackList.sort", { default: "Sort" })}</span>
          </button>
          <button
            type="button"
            class="mobile-bar-btn"
            on:click={enterMobileSelect}
          >
            <Icon name="check-circle" size={16} />
            <span>{$_("trackList.select", { default: "Select" })}</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Header stays fixed -->
  <TrackListHeader
    multiSelectMode={effectiveMultiSelectMode}
    {showAlbum}
    {playlistId}
    {scrollbarWidth}
    {sortedTracks}
    {sortField}
    {sortDirection}
    {toggleSort}
    {allowMultiSelectEntry}
    {onEnterMultiSelect}
  />

  <!-- Virtualized scrolling container -->
  {#if sortedTracks.length > 0}
    <!-- Event delegation - handlers on container instead of each row -->
    <div
      class="list-body"
      class:no-album={!showAlbum}
      class:with-drag={playlistId !== null && !effectiveMultiSelectMode}
      class:multiselect={effectiveMultiSelectMode}
      class:mobile-album={mobileViewMode === "album"}
      class:mobile-playlist={mobileViewMode === "playlist"}
      class:mobile-library={mobileViewMode === "library"}
      class:is-dragging={isDragging}
      on:scroll={handleScroll}
      on:click={handleBodyClick}
      on:dblclick={handleBodyDoubleClick}
      on:contextmenu={handleBodyContextMenu}
      on:touchstart={handleSwipeTouchStart}
      on:touchmove={handleSwipeTouchMove}
      on:touchend={handleSwipeTouchEnd}
      on:touchcancel={handleSwipeTouchEnd}
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
          {#each visibleTracksWithMetadata as { track, albumArt, unavailable, formattedDate }, index (track.id)}
            {@const actualIndex = virtualScrollState.startIndex + index}
            {@const isSelected = effectiveMultiSelectMode ? $multiSelect.selectedTrackIds.has(track.id) : $trackSelectionStore.selectedTrackIds.has(track.id)}
            {@const isFocused = $trackSelectionStore.focusedIndex === actualIndex}
            <TrackListRow
              {track}
              {albumArt}
              {unavailable}
              {formattedDate}
              {actualIndex}
              {isSelected}
              {isFocused}
              {showAlbum}
              {playlistId}
              multiSelectMode={effectiveMultiSelectMode}
              {playingTrackId}
              isPlaying={$isPlaying}
              {failedImages}
              {showAdvancedMetadata}
              isDragging={draggedIndex === actualIndex}
              isDragOver={dragOverIndex === actualIndex}
              dragShift={isDragging ? (dragShifts[actualIndex] ?? 0) : 0}
              onPointerDown={handlePointerDown}
              onImageError={handleImageError}
              onMoreClick={handleRowMoreClick}
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

  <!-- Alphabetical jump indicator (purely visual) -->
  {#if !$isMobile}
    <div
      class="jump-strip"
      class:visible={jumpStripVisible}
      style="right: {scrollbarWidth + 8}px;"
      aria-hidden="true"
    >
      {#each JUMP_STRIP_LETTERS as letter, i}
        <span class="jump-cell">
          <span class="jump-glyph" class:active={jumpStripVisible && i === jumpLetterIndex}>{letter}</span>
          {#if jumpBubbleVisible && i === jumpLetterIndex}
            <span class="jump-bubble" class:nomatch={!jumpMatched} transition:fade={{ duration: 180 }}>{letter}</span>
          {/if}
        </span>
      {/each}
      <!-- letters outside A–Z (e.g. Cyrillic) have no cell: show the bubble beside the strip centre -->
      {#if jumpBubbleVisible && jumpLetterIndex === -1}
        <span class="jump-bubble jump-bubble-free" class:nomatch={!jumpMatched} transition:fade={{ duration: 180 }}>{jumpLetter}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .track-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative; /* anchors the jump strip */
  }

  .track-list.external-scroll {
    height: auto;
    overflow: visible;
  }

  .track-list.external-scroll .list-body {
    flex: none;
    overflow: visible;
  }

  .mobile-track-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    min-height: 48px;
    flex-shrink: 0;
  }

  .mobile-bar-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }

  .mobile-select-count {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--accent-primary);
    white-space: nowrap;
  }

  .mobile-bar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    min-width: 44px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    background-color: var(--surface-subtle, rgba(255, 255, 255, 0.08));
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    transition: background-color var(--transition-fast);
  }

  .mobile-bar-btn:active:not(:disabled) {
    background-color: var(--surface-subtle-hover, rgba(255, 255, 255, 0.14));
  }

  .mobile-bar-btn.active {
    color: var(--accent-primary);
    background-color: var(--accent-subtle);
  }

  .mobile-bar-btn.primary-pill {
    background-color: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    padding: 0 16px;
  }

  /* alphabetical jump indicator */
  .jump-strip {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: min(390px, calc(100% - 96px));
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 2px 0;
    pointer-events: none;
    z-index: 20;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .jump-strip.visible {
    opacity: 1;
    transition-duration: 0.15s;
  }

  .jump-cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex: 1 1 0;
    min-height: 0;
  }

  .jump-glyph {
    display: block;
    color: #fff;
    opacity: 0.7;
    font-size: 10px;
    line-height: 1;
    font-weight: 500;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    transition: transform 0.15s ease, opacity 0.15s ease;
  }

  .jump-glyph.active {
    opacity: 1;
    font-weight: 700;
    transform: scale(1.6);
  }

  .jump-bubble {
    position: absolute;
    right: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%);
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    color: #000;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }

  .jump-bubble.nomatch {
    background: rgba(255, 255, 255, 0.55);
  }

  /* letters with no strip cell (non A–Z) */
  .jump-bubble-free {
    top: 50%;
  }

  @media (prefers-reduced-motion: reduce) {
    .jump-glyph {
      transition: none;
    }
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

  /* pan-y => vertical scroll stays on the compositor, only horizontal swipes reach the touch handlers */
  .list-body { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; overscroll-behavior-y: contain; touch-action: pan-y; }
  .virtual-spacer { position: relative; width: 100%; }
  .virtual-content { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }

  :global(.track-row-inner) {
    display: contents;
  }

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

  :global(.track-row.selected) { background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.16); }
  :global(.track-row.selected:hover) { background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.22); }
  :global(.track-row.selected.playing) { background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.26); }
  :global(.track-row.focused),
  :global(.track-row:focus-visible) {
    outline: 1px solid var(--accent-primary, #1db954);
    outline-offset: -1px;
  }
  :global(.track-row:hover) { background-color: rgba(255, 255, 255, 0.1); cursor: pointer; }
  :global(.track-row.playing) { background-color: var(--bg-surface); }
  :global(.track-row.playing .track-name) { color: var(--accent-primary); }
  :global(.track-row.dragging) { opacity: 0; background: transparent; pointer-events: none; }
  :global(.track-row.drag-over) { /* handled by row shift, no border needed */ }
  /* Smooth shift during drag — only while is-dragging to avoid layout transitions elsewhere */
  .list-body.is-dragging :global(.track-row:not(.dragging)) {
    transition: transform 160ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
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
  :global(.track-row .cover-image) { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; }
  :global(.track-row .cover-placeholder) { width: 40px; height: 40px; border-radius: var(--radius-sm); background-color: var(--bg-highlight); display: flex; align-items: center; justify-content: center; color: var(--text-subdued); }
  :global(.track-row .cover-wrapper) { position: relative; width: 40px; height: 40px; }
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

  :global(.track-artist) { font-size: var(--font-size-sm); color: var(--text-subdued); background: none; border: none; padding: 0; margin: 0; text-align: left; max-width: fit-content; line-height: var(--line-height-tight); min-height: 0; }
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
  :global(.col-drag.selectable) { display: flex; align-items: center; justify-content: center; }
  :global(.enter-select-checkbox) {
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }
  :global(.list-header:hover .enter-select-checkbox),
  :global(.enter-select-checkbox:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }
  :global(.custom-checkbox) { width: 20px; height: 20px; border: 2px solid var(--border-color); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; transition: all var(--transition-fast); background-color: transparent; position: relative; }
  :global(.custom-checkbox:hover) { border-color: var(--accent-primary); background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.1); }
  :global(.custom-checkbox.checked) { background-color: var(--accent-primary); border-color: var(--accent-primary); }
  :global(.custom-checkbox.indeterminate) { background-color: var(--accent-primary); border-color: var(--accent-primary); }
  :global(.custom-checkbox svg) { color: var(--text-on-accent, #fff); }
  :global(.custom-checkbox .indeterminate-dash) { width: 10px; height: 2px; border-radius: 1px; background-color: var(--text-on-accent, #fff); }

  :global(.equalizer-bars) { display: none; }

  :global(html.layout-mobile) .list-toolbar { display: none; }
  :global(html.layout-mobile .list-header) { display: none; }
  :global(html.layout-mobile .quality-tag) { display: none; }
  :global(html.layout-mobile .cover-play-overlay) { display: none; }
  :global(html.layout-mobile .drag-handle) {
    opacity: 1;
    width: 32px;
    min-width: 0;
    height: 44px;
    min-height: 44px;
  }
  :global(html.layout-mobile .col-checkbox) {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
  }
  :global(html.layout-mobile .row-more-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-full);
    color: var(--text-subdued);
    flex-shrink: 0;
  }
  :global(html.layout-mobile .row-more-btn:active) {
    background-color: var(--surface-subtle, rgba(255, 255, 255, 0.08));
    color: var(--text-primary);
  }
  :global(html.layout-mobile .track-name-marquee) {
    min-width: 0;
    flex: 0 1 auto;
  }
  :global(html.layout-mobile .track-row) {
    display: block;
    position: relative;
    overflow: hidden;
    padding: 0;
    height: 60px;
    min-height: 60px;
  }
  :global(html.layout-mobile .track-row-inner) {
    display: grid;
    grid-template-columns: 48px 1fr auto 44px;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-xs) var(--spacing-xs) var(--spacing-sm);
    align-items: center;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
    border-radius: var(--radius-md);
    background-color: transparent;
  }
  :global(html.layout-mobile .track-row.swiping .track-row-inner),
  :global(html.layout-mobile .track-row.swipe-animating .track-row-inner) {
    background-color: var(--bg-base);
  }
  :global(html.layout-mobile .track-row.playing .track-row-inner) {
    background-color: var(--bg-surface);
  }
  :global(html.layout-mobile .track-row.selected .track-row-inner) {
    background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.16);
  }
  :global(html.layout-mobile .track-row.selected.playing .track-row-inner) {
    background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.26);
  }

  :global(html.layout-mobile) .list-body.mobile-album :global(.track-row-inner) { grid-template-columns: 32px 1fr auto 44px; padding-left: var(--spacing-sm); }
  :global(html.layout-mobile) .list-body.mobile-album :global(.col-num) { display: flex; align-items: center; justify-content: center; font-size: 0.9375rem; color: var(--text-subdued); }
  :global(html.layout-mobile) .list-body.mobile-album :global(.track-row.playing .col-num) { color: var(--accent-primary); }
  :global(html.layout-mobile) .list-body.mobile-album :global(.col-cover) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-album :global(.col-album-cell) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-album :global(.equalizer-bars) { display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 16px; width: 16px; }
  :global(html.layout-mobile) .list-body.mobile-album :global(.playing-icon) { display: none; }
  :global(html.layout-mobile .eq-bar) { width: 3px; background-color: var(--accent-primary); border-radius: 1px; animation: eq-bounce 1.2s ease-in-out infinite; }
  :global(html.layout-mobile .eq-bar:nth-child(1)) { height: 60%; animation-delay: 0s; }
  :global(html.layout-mobile .eq-bar:nth-child(2)) { height: 100%; animation-delay: 0.2s; }
  :global(html.layout-mobile .eq-bar:nth-child(3)) { height: 40%; animation-delay: 0.4s; }
  :global(html.layout-mobile .eq-bar:nth-child(4)) { height: 80%; animation-delay: 0.6s; }
  @keyframes eq-bounce { 0%, 100% { height: 20%; } 50% { height: 100%; } }
  :global(html.layout-mobile) .list-body.mobile-album :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
  :global(html.layout-mobile) .list-body.mobile-album :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-subdued); }
  :global(html.layout-mobile) .list-body.mobile-album :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
  :global(html.layout-mobile) .list-body.mobile-album.with-drag :global(.track-row-inner) { grid-template-columns: 32px 32px 1fr auto 44px; }
  :global(html.layout-mobile) .list-body.mobile-album.multiselect :global(.track-row-inner) { grid-template-columns: 44px 32px 1fr auto 44px; }

  :global(html.layout-mobile) .list-body.mobile-playlist :global(.track-row-inner) { grid-template-columns: 48px 1fr auto 44px; padding-left: var(--spacing-sm); }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.col-num) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.col-album-cell) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.cover-wrapper), :global(html.layout-mobile) .list-body.mobile-playlist :global(.cover-image), :global(html.layout-mobile) .list-body.mobile-playlist :global(.cover-placeholder) { width: 48px; height: 48px; border-radius: var(--radius-sm); }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.col-cover) { justify-content: flex-start; align-items: center; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.col-title) { padding-top: 0; justify-content: center; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-subdued); margin-top: 0; }
  :global(html.layout-mobile) .list-body.mobile-playlist :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
  :global(html.layout-mobile) .list-body.mobile-playlist.with-drag :global(.track-row-inner) { grid-template-columns: 32px 48px 1fr auto 44px; }
  :global(html.layout-mobile) .list-body.mobile-playlist.multiselect :global(.track-row-inner) { grid-template-columns: 44px 48px 1fr auto 44px; }

  :global(html.layout-mobile) .list-body.mobile-library :global(.track-row-inner) { grid-template-columns: 48px 1fr auto 44px; padding-left: var(--spacing-sm); }
  :global(html.layout-mobile) .list-body.mobile-library :global(.col-num) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.col-album-cell) { display: none; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.cover-wrapper), :global(html.layout-mobile) .list-body.mobile-library :global(.cover-image), :global(html.layout-mobile) .list-body.mobile-library :global(.cover-placeholder) { width: 48px; height: 48px; border-radius: var(--radius-sm); }
  :global(html.layout-mobile) .list-body.mobile-library :global(.col-cover) { justify-content: flex-start; align-items: center; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.col-title) { padding-top: 0; justify-content: center; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.track-name) { font-size: 0.9375rem; font-weight: var(--font-weight-semibold); color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.track-artist) { font-size: var(--font-size-xs); color: var(--text-subdued); margin-top: 2px; }
  :global(html.layout-mobile) .list-body.mobile-library :global(.col-duration) { font-size: var(--font-size-xs); color: var(--text-subdued); }
  :global(html.layout-mobile) .list-body.mobile-library.with-drag :global(.track-row-inner) { grid-template-columns: 32px 48px 1fr auto 44px; }
  :global(html.layout-mobile) .list-body.mobile-library.multiselect :global(.track-row-inner),
  :global(html.layout-mobile) .list-body.mobile-library.multiselect.no-album :global(.track-row-inner) { grid-template-columns: 44px 48px 1fr auto 44px; }

  :global(html.layout-mobile .track-row.playing .track-name) { color: var(--accent-primary); }
  :global(html.layout-mobile .track-row.playing .col-num) { color: var(--accent-primary); }
  :global(html.layout-mobile .downloaded-icon) { margin-left: 2px; }
  :global(html.layout-mobile .downloaded-icon svg) { width: 12px; height: 12px; }

  :global(html.layout-mobile .track-row.swiping .track-row-inner) { will-change: transform; }
  :global(html.layout-mobile .swipe-bg) {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    padding-left: 16px;
    background-color: transparent;
    color: var(--accent-primary);
    opacity: 0;
    pointer-events: none;
    z-index: 0;
    transition: opacity 0.15s ease, background-color 0.15s ease;
  }
  :global(html.layout-mobile .swipe-bg .swipe-icon-check) { display: none; }
  :global(html.layout-mobile .track-row.swiping .swipe-bg) {
    opacity: 0.7;
    background-color: color-mix(in srgb, var(--accent-primary), transparent 88%);
  }
  :global(html.layout-mobile .track-row.swipe-queue-ready .swipe-bg) {
    opacity: 1;
    background-color: color-mix(in srgb, var(--accent-primary), transparent 78%);
  }
  :global(html.layout-mobile .track-row.swipe-queue-added .swipe-bg) {
    opacity: 1;
    background-color: color-mix(in srgb, var(--accent-primary), transparent 65%);
  }
  :global(html.layout-mobile .track-row.swipe-queue-added .swipe-bg .swipe-icon-plus) { display: none; }
  :global(html.layout-mobile .track-row.swipe-queue-added .swipe-bg .swipe-icon-check) { display: inline-flex; }
</style>
