<script lang="ts">
  import type { Track } from "$lib/api/tauri";
  import {
    formatDuration,
    getAlbumArtSrc,
    getTrackCoverSrc,
    getAlbumCoverSrc,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    deleteTrack,
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
    loadLibrary,
    getTrackAlbumCover,
    loadMoreTracks,
  } from "$lib/stores/library";
  import { pluginStore } from "$lib/stores/plugin-store";
  import { goToAlbumDetail, goToArtistDetail } from "$lib/stores/view";
  import {
    canDownload,
    downloadTrack,
    needsDownloadLocation,
  } from "$lib/services/downloadService";
  import { addToast } from "$lib/stores/toast";
  import { isOnline } from "$lib/stores/network";
  import { onDestroy, onMount } from "svelte";
  import { multiSelect } from "$lib/stores/multiselect";
  import { isMobile } from "$lib/stores/mobile";
  import { confirm, prompt } from "$lib/stores/dialogs";
  import { saveScroll, getScroll } from "$lib/stores/scrollMemory";
  import { setCustomArtwork } from "$lib/stores/customArtwork";
  import MetadataModal from "$lib/components/MetadataModal.svelte";
  import { _, locale } from "svelte-i18n";

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

  // 3: Memoize availability check results
  const availabilityCache = new Map<number, boolean>();

  function isTrackUnavailable(track: Track): boolean {
    // Check cache first
    if (availabilityCache.has(track.id)) {
      return availabilityCache.get(track.id)!;
    }

    let unavailable = false;

    // Local tracks are always available
    if (!track.source_type || track.source_type === "local") {
      unavailable = false;
    } else if (track.local_src) {
      unavailable = false;
    } else {
      // Streaming track: only unavailable if NO plugin can play it
      const runtime = pluginStore.getRuntime();
      unavailable = !runtime || !runtime.streamResolvers.has(track.source_type);
    }

    availabilityCache.set(track.id, unavailable);
    return unavailable;
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
        unavailable: isTrackUnavailable(track),
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

      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
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
    if (!track || isTrackUnavailable(track)) return;

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
    if (!track || isTrackUnavailable(track)) return;

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

    const playlistItems = $playlists.map((playlist) => ({
      label: playlist.name,
      action: async () => {
        try {
          await addTrackToPlaylist(playlist.id, track.id);
        } catch (error) {
          console.error("Failed to add track to playlist:", error);
        }
      },
    }));

    const isUnavailable = isTrackUnavailable(track);

    const menuItems: any[] = [
      {
        label: $_('contextMenu.play'),
        action: () => {
          if (trackIndex !== undefined) {
            // Use unified queueTracks if available
            if (queueTracks) {
              const globalIndex = queueTracks.findIndex(
                (t) => t.id === trackId,
              );
              if (globalIndex !== -1) {
                playTracks(queueTracks, globalIndex, playbackContext);
                return;
              }
            }
            playTracks(sortedTracks, trackIndex, playbackContext);
          }
        },
        disabled: isUnavailable,
      },
      { type: "separator" },
      {
        label: $_('contextMenu.addToQueue'),
        action: () => addToQueue([track]),
        disabled: isUnavailable,
      },
      { type: "separator" },
      {
        label: $_('contextMenu.download'),
        action: async () => {
          if (needsDownloadLocation()) {
            addToast(
              "Please configure a download location in Settings first",
              "error",
            );
            return;
          }

          addToast(`Downloading "${track.title}"...`, "info");
          try {
            await downloadTrack(track);
            addToast(`Downloaded "${track.title}"`, "success");
          } catch (error) {
            console.error("Failed to download track:", error);
            addToast(`Failed to download "${track.title}"`, "error");
          }
        },
        disabled:
          !canDownload(track) ||
          (isUnavailable && !isTidalAvailable && !track.local_src),
      },
      { type: "separator" },
      {
        label: $_('contextMenu.addToPlaylist'),
        submenu:
          playlistItems.length > 0
            ? playlistItems
            : [
                {
                  label: $_('contextMenu.noPlaylists'),
                  action: () => {},
                  disabled: true,
                },
              ],
      },
      { type: "separator" },
      {
        label: $_('contextMenu.changeArtwork'),
        submenu: [
          {
            label: $_('contextMenu.fromFile'),
            action: () => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = reader.result as string;
                    setCustomArtwork("track", track.id, result);
                    addToast("Artwork updated", "success");
                    // Refresh local cache for reactivity
                    trackAlbumArtCache.delete(track.id);
                  };
                  reader.readAsDataURL(file);
                }
              };
              input.click();
            },
          },
          {
            label: $_('contextMenu.fromUrl'),
            action: async () => {
              const url = await prompt("Enter image URL:", {
                title: "Change Artwork",
                placeholder: "https://example.com/image.jpg",
              });
              if (url && url.trim()) {
                setCustomArtwork("track", track.id, url.trim());
                addToast("Artwork updated", "success");
                trackAlbumArtCache.delete(track.id);
              }
            },
          },
        ],
      },
    ];

    menuItems.push(
      { type: "separator" },
      {
        label: $_('contextMenu.showMoreInfo'),
        action: () => {
          metadataModalTrack = track;
        },
      },
    );

    if (playlistId) {
      menuItems.push({
        label: $_('contextMenu.removeFromPlaylist'),
        action: async () => {
          try {
            await removeTrackFromPlaylist(playlistId, track.id);
            tracks = tracks.filter((t) => t.id !== track.id);
          } catch (error) {
            console.error("Failed to remove track from playlist:", error);
          }
        },
      });
    }

    menuItems.push(
      { type: "separator" },
      {
        label: $_('contextMenu.deleteFromLibrary'),
        danger: true,
        action: async () => {
          const confirmed = await confirm(
            `Are you sure you want to delete "${track.title}" from your library? This will also remove the file from your computer.`,
            {
              title: "Delete Track",
              confirmLabel: "Delete",
              danger: true,
            },
          );

          if (!confirmed) return;

          try {
            await deleteTrack(track.id);
            // Clear from cache
            trackAlbumArtCache.delete(track.id);
            availabilityCache.delete(track.id);
            await loadLibrary();
            // Also remove from local tracks array for immediate UI feedback
            tracks = tracks.filter((t) => t.id !== track.id);
          } catch (error) {
            console.error("Failed to delete track:", error);
          }
        },
      },
    );

    contextMenu.set({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
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

        addToast("Tracks reordered", "success");
      } catch (error) {
        console.error("Failed to reorder tracks:", error);
        addToast(`Failed to reorder tracks: ${error}`, "error");
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
          addToast(`Added "${track.title}" to queue`, "success");
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

  // Helper to handle album click from event delegation
  function handleAlbumClick(e: MouseEvent) {
    const albumButton = (e.target as HTMLElement).closest(".col-album-cell");
    if (!albumButton) return;

    e.stopPropagation();

    const row = albumButton.closest(".track-row");
    if (!row) return;

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");
    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (track && track.album_id) {
      goToAlbumDetail(track.album_id);
    }
  }

  function handleArtistClick(e: MouseEvent) {
    const artistButton = (e.target as HTMLElement).closest(".track-artist");
    if (!artistButton) return;

    e.stopPropagation();

    const row = artistButton.closest(".track-row");
    if (!row) return;

    const trackId = parseInt(row.getAttribute("data-track-id") || "0");
    const trackIndex = trackIndexMap.get(trackId);

    if (trackIndex === undefined) return;

    const track = sortedTracks[trackIndex];
    if (track && track.artist) {
      goToArtistDetail(track.artist);
    }
  }

  function formatDateAdded(dateAdded?: string | null): string {
    if (!dateAdded) return "Unknown";

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
          ? "Details shown: format, bitrate, source"
          : "Minimal view"}</span
      >
      <button
        class="advanced-toggle"
        title="Toggle extra metadata (format, bitrate, source)"
        on:click={() => {
          showAdvancedMetadata = !showAdvancedMetadata;
        }}
      >
        {showAdvancedMetadata ? "Hide details" : "Show details"}
      </button>
    </div>
  {/if}

  <!-- Header stays fixed -->
  <header
    class="list-header"
    class:no-album={!showAlbum}
    class:with-drag={playlistId !== null}
    class:multiselect={multiSelectMode}
    style={`--scrollbar-width: ${scrollbarWidth}px`}
  >
    {#if multiSelectMode}
      <div class="col-header col-checkbox">
        <input
          type="checkbox"
          on:change={(e) => {
            if (e.currentTarget.checked) {
              multiSelect.selectAll(sortedTracks.map((t) => t.id));
            } else {
              multiSelect.clearSelections();
            }
          }}
          checked={$multiSelect.selectedTrackIds.size > 0 &&
            $multiSelect.selectedTrackIds.size === sortedTracks.length}
          indeterminate={$multiSelect.selectedTrackIds.size > 0 &&
            $multiSelect.selectedTrackIds.size < sortedTracks.length}
        />
      </div>
    {/if}
    {#if playlistId !== null && !multiSelectMode}
      <span class="col-header col-drag"></span>
    {/if}
    <button class="col-header col-num sortable" on:click={() => toggleSort("track_number")}>
      #
      {#if sortField === "track_number"}
        <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
      {/if}
    </button>
    <button
      class="col-header col-artist sortable"
      on:click={() => toggleSort("title")}
    >
      {$_('trackList.title')}
      {#if sortField === "title"}
        <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
      {/if}
    </button>
    {#if showAlbum}
      <button
        class="col-header col-album sortable"
        on:click={() => toggleSort("album")}
      >
        {$_('trackList.album')}
        {#if sortField === "album"}
          <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
        {/if}
      </button>
    {/if}
    <button
      class="col-header col-duration sortable"
      on:click={() => toggleSort("duration")}
    >
      {$_('trackList.duration')}
      {#if sortField === "duration"}
        <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
      {/if}
    </button>
    <button
      class="col-header col-date-added sortable"
      on:click={() => toggleSort("date_added")}
    >
      {$_('trackList.dateAdded')}
      {#if sortField === "date_added"}
        <span class="sort-icon">{sortDirection === "asc" ? "▲" : "▼"}</span>
      {/if}
    </button>
  </header>

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
            <div
              class="track-row"
              class:playing={playingTrackId === track.id}
              class:unavailable
              class:dragging={draggedIndex === actualIndex}
              class:drag-over={dragOverIndex === actualIndex}
              class:selected={multiSelectMode && isSelected}
              data-track-id={track.id}
              data-track-index={actualIndex}
              role="button"
              tabindex="0"
            >
              {#if multiSelectMode}
                <div
                  class="col-checkbox"
                  on:click|stopPropagation={() =>
                    multiSelect.toggleTrack(track.id)}
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
                  on:pointerdown={(e) => handlePointerDown(e, actualIndex)}
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
                {#if playingTrackId === track.id && $isPlaying}
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
                        on:error={() => handleImageError(albumArt)}
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
                  <button
                    class="track-artist truncate"
                    on:click={handleArtistClick}
                    >{track.artist || "Unknown Artist"}</button
                  >
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
                        on:error={() => handleImageError(albumArt)}
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
                    <button class="track-artist truncate" on:click={handleArtistClick}
                      >{track.artist || "Unknown Artist"}</button
                    >
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
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="list-body">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
          <path
            d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
          />
        </svg>
        <h3>{$_('trackList.noTracksFound')}</h3>
        <p>{$_('trackList.addFolderToGetStarted')}</p>
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
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .advanced-toggle:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .list-header {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px 130px;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    padding-right: calc(var(--spacing-md) + var(--scrollbar-width, 0px));
    padding-left: var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    font-size: 0.78rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.1;
    color: var(--text-subdued);
    background-color: var(--bg-base);
    z-index: 10;
    flex-shrink: 0;
  }

  .list-header.with-drag {
    grid-template-columns: 32px 40px 1fr 1fr 80px 130px;
  }

  .list-header.no-album {
    grid-template-columns: 40px 1fr 80px 130px;
  }

  .list-header.no-album.with-drag {
    grid-template-columns: 32px 40px 1fr 80px 130px;
  }

  .col-header {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: default;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: color var(--transition-fast);
    user-select: none;
    justify-self: stretch;
    width: 100%;
    font-size: inherit;
    font-weight: inherit;
    line-height: inherit;
  }

  .col-header.sortable {
    cursor: pointer;
  }

  .col-header.sortable:hover {
    color: var(--text-primary);
  }

  .col-header.col-drag {
    cursor: default;
  }

  .col-header.col-num {
    justify-content: center;
  }

  .col-header.col-artist {
    justify-content: flex-start;
    padding-left: 36px;
  }

  .col-header.col-album {
    justify-content: flex-start;
  }

  .col-header.col-duration {
    justify-content: flex-end;
  }

  .col-header.col-date-added {
    justify-content: flex-end;
  }

  .sort-icon {
    color: var(--accent-primary);
    font-size: 0.75rem;
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    overscroll-behavior-y: contain;
  }

  /* Virtual scrolling structure */
  .virtual-spacer {
    position: relative;
    width: 100%;
  }

  .virtual-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }

  .track-row {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 80px 130px;
    gap: var(--spacing-md);
    padding: 6px var(--spacing-md);
    padding-left: var(--spacing-lg);
    align-items: center;
    border-radius: var(--radius-md);
    transition: background-color var(--transition-fast);
    width: 100%;
    text-align: left;
    height: 50px; /* Fixed height for virtual scrolling */
    box-sizing: border-box;
  }

  .list-body.with-drag .track-row {
    grid-template-columns: 32px 40px 1fr 1fr 80px 130px;
  }

  .list-body.no-album .track-row {
    grid-template-columns: 40px 1fr 80px 130px;
  }

  .list-body.no-album.with-drag .track-row {
    grid-template-columns: 32px 40px 1fr 80px 130px;
  }

  .list-body.multiselect .track-row {
    grid-template-columns: 40px 40px 1fr 1fr 80px 130px;
  }

  .list-body.multiselect.no-album .track-row {
    grid-template-columns: 40px 40px 1fr 80px 130px;
  }

  .track-row.selected {
    background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.12);
  }

  .track-row.selected:hover {
    background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.18);
  }

  .track-row:hover {
    background-color: rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }

  .track-row.playing {
    background-color: var(--bg-surface);
  }

  .track-row.playing .track-name {
    color: var(--accent-primary);
  }

  .track-row.dragging {
    opacity: 0.5;
    background-color: var(--bg-highlight);
  }

  .track-row.drag-over {
    border-top: 2px solid var(--accent-primary);
    margin-top: -2px;
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--text-subdued);
    cursor: grab;
    opacity: 0;
    transition: all var(--transition-fast);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none; /* Prevent default touch behaviors */
  }

  .track-row:hover .drag-handle {
    opacity: 1;
  }

  .drag-handle:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-sm);
  }

  .drag-handle:active {
    cursor: grabbing;
    background-color: rgba(255, 255, 255, 0.15);
  }

  .col-num {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-subdued);
    font-size: 0.875rem;
  }

  .track-row:hover .col-num:not(:has(.playing-icon)) {
    color: var(--text-primary);
  }

  .track-index,
  .hover-play {
    transition: opacity var(--transition-fast);
  }

  .hover-play {
    position: absolute;
    opacity: 0;
    color: var(--text-primary);
    font-size: 0.82rem;
    line-height: 1;
  }

  .track-row:hover .track-index {
    opacity: 0;
  }

  .track-row:hover .hover-play {
    opacity: 1;
  }

  .track-row.unavailable:hover .hover-play,
  .track-row.unavailable:hover .track-index {
    opacity: 1;
  }

  .col-cover {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cover-image {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  .cover-placeholder {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-highlight);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
  }

  .cover-wrapper {
    position: relative;
    width: 40px;
    height: 40px;
  }

  .cover-play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.6);
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity var(--transition-fast);
    color: var(--text-primary);
  }

  .track-row:hover .cover-play-overlay {
    opacity: 1;
  }

  .track-row.playing .cover-play-overlay {
    opacity: 0;
  }

  .playing-icon {
    color: var(--accent-primary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .col-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    justify-content: center;
    gap: 1px;
    height: 100%;
    padding-top: 1.5px;
  }

  .col-artist {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 8px;
  }

  .artist-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }

  .cover-image-small {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: cover;
  }

  .cover-placeholder-small {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background-color: var(--bg-highlight);
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .artist-meta {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    gap: 1px;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .track-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.2;
    margin: 0;
  }

  .quality-tag {
    font-size: 0.6rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-highlight);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.7;
    transition: opacity var(--transition-fast);
  }

  .track-row:hover .quality-tag {
    opacity: 1;
  }

  .quality-tag.high-quality {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background-color: color-mix(in srgb, var(--accent-primary), transparent 85%);
  }

  .track-artist {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    max-width: fit-content;
    line-height: 1.2;
    min-height: 0;
  }

  .track-artist:hover:not(:disabled) {
    color: var(--text-primary);
    text-decoration: underline;
    cursor: pointer;
  }

  .media-metadata {
    font-size: 0.7rem;
    color: var(--text-subdued);
    opacity: 0.9;
  }

  .col-album-cell {
    font-size: 0.875rem;
    color: var(--text-secondary);
    background: none;
    border: none;
    padding: 0;
    width: 100%;
    justify-self: stretch;
    text-align: left;
    line-height: 1.2;
  }

  .col-album-cell:hover:not(:disabled) {
    color: var(--text-primary);
    text-decoration: underline;
    cursor: pointer;
  }

  .col-duration {
    text-align: right;
    font-size: 0.875rem;
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .col-date-added {
    text-align: right;
    font-size: 0.8125rem;
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xl);
    color: var(--text-subdued);
    text-align: center;
    gap: var(--spacing-sm);
    height: 100%;
  }

  .empty-state h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: 0.875rem;
  }

  .track-row.unavailable {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .track-row.unavailable:hover {
    background-color: transparent;
  }

  .downloaded-icon {
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    margin-left: var(--spacing-xs);
    flex-shrink: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .custom-checkbox {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-color);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
    background-color: transparent;
    position: relative;
  }

  .custom-checkbox:hover {
    border-color: var(--accent-primary);
    background-color: rgba(var(--accent-primary-rgb, 29, 185, 84), 0.1);
  }

  .custom-checkbox.checked {
    background-color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .custom-checkbox svg {
    color: var(--bg-base);
  }

  .col-header.col-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .list-header.multiselect {
    grid-template-columns: 40px 40px 1fr 1fr 80px 130px;
  }

  .list-header.multiselect.no-album {
    grid-template-columns: 40px 40px 1fr 80px 130px;
  }

  /* ── Equalizer bars (hidden by default, shown on mobile album view) ── */
  .equalizer-bars {
    display: none;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .list-toolbar {
      display: none;
    }

    /* Hide the entire header row on mobile */
    .list-header {
      display: none;
    }

    /* Hide quality tags on mobile to save space */
    .quality-tag {
      display: none;
    }

    /* Hide play overlay on mobile (uses tap instead) */
    .cover-play-overlay {
      display: none;
    }

    /* Drag handle always visible on mobile for playlist reorder */
    .drag-handle {
      opacity: 1;
    }

    /* ─── Base track row (shared) ─── */
    .track-row {
      gap: var(--spacing-sm);
      padding: var(--spacing-xs) var(--spacing-sm);
      height: 60px;
      min-height: 60px;
    }

    /* ─────────────────────────────────────────────────
       ALBUM VIEW — Numbered, no covers, clean & minimal
       Grid: [number] [title] [duration]
    ───────────────────────────────────────────────── */
    .list-body.mobile-album .track-row {
      grid-template-columns: 32px 1fr 48px;
      padding-left: var(--spacing-sm);
    }

    .list-body.mobile-album .col-num {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9375rem;
      color: var(--text-subdued);
    }

    .list-body.mobile-album .track-row.playing .col-num {
      color: var(--accent-primary);
    }

    /* Hide cover art in album view */
    .list-body.mobile-album .col-cover {
      display: none;
    }

    /* Hide album column */
    .list-body.mobile-album .col-album-cell {
      display: none;
    }

    /* Show equalizer bars, hide music note on album mobile */
    .list-body.mobile-album .equalizer-bars {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 2px;
      height: 16px;
      width: 16px;
    }

    .list-body.mobile-album .playing-icon {
      display: none;
    }

    .eq-bar {
      width: 3px;
      background-color: var(--accent-primary);
      border-radius: 1px;
      animation: eq-bounce 1.2s ease-in-out infinite;
    }

    .eq-bar:nth-child(1) {
      height: 60%;
      animation-delay: 0s;
    }

    .eq-bar:nth-child(2) {
      height: 100%;
      animation-delay: 0.2s;
    }

    .eq-bar:nth-child(3) {
      height: 40%;
      animation-delay: 0.4s;
    }

    .eq-bar:nth-child(4) {
      height: 80%;
      animation-delay: 0.6s;
    }

    @keyframes eq-bounce {
      0%,
      100% {
        height: 20%;
      }
      50% {
        height: 100%;
      }
    }

    /* Title in album view — bold, prominent */
    .list-body.mobile-album .track-name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .list-body.mobile-album .track-artist {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    /* Duration compact */
    .list-body.mobile-album .col-duration {
      font-size: 0.75rem;
      color: var(--text-subdued);
    }

    /* Drag variant for album */
    .list-body.mobile-album.with-drag .track-row {
      grid-template-columns: 28px 32px 1fr 48px;
    }

    /* Multiselect variant for album */
    .list-body.mobile-album.multiselect .track-row {
      grid-template-columns: 36px 32px 1fr 48px;
    }

    /* ─────────────────────────────────────────────────
       PLAYLIST VIEW — Cover art + info, Spotify-style
       Grid: [cover] [title+artist] [duration]
    ───────────────────────────────────────────────── */
    .list-body.mobile-playlist .track-row {
      grid-template-columns: 48px 1fr 48px;
      padding-left: var(--spacing-sm);
    }

    /* Hide track number in playlist view */
    .list-body.mobile-playlist .col-num {
      display: none;
    }

    /* Hide album column */
    .list-body.mobile-playlist .col-album-cell {
      display: none;
    }

    /* Cover art sizing */
    .list-body.mobile-playlist .cover-wrapper,
    .list-body.mobile-playlist .cover-image,
    .list-body.mobile-playlist .cover-placeholder {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-sm);
    }

    /* Align cover flush left in its column */
    .list-body.mobile-playlist .col-cover {
      justify-content: flex-start;
      align-items: center;
    }

    /* Ensure title col aligns center without extra top shift */
    .list-body.mobile-playlist .col-title {
      padding-top: 0;
      justify-content: center;
    }

    /* Title + Artist stacked */
    .list-body.mobile-playlist .track-name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .list-body.mobile-playlist .track-artist {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0;
    }

    /* Duration compact */
    .list-body.mobile-playlist .col-duration {
      font-size: 0.75rem;
      color: var(--text-subdued);
    }

    /* Drag variant for playlist */
    .list-body.mobile-playlist.with-drag .track-row {
      grid-template-columns: 28px 48px 1fr 48px;
    }

    /* Multiselect variant for playlist */
    .list-body.mobile-playlist.multiselect .track-row {
      grid-template-columns: 36px 48px 1fr 48px;
    }

    /* ─────────────────────────────────────────────────
       LIBRARY VIEW — Full info with cover + album context
       Grid: [cover] [title+artist] [duration]
    ───────────────────────────────────────────────── */
    .list-body.mobile-library .track-row {
      grid-template-columns: 48px 1fr 48px;
      padding-left: var(--spacing-sm);
    }

    /* Hide track number in library view */
    .list-body.mobile-library .col-num {
      display: none;
    }

    /* Hide album column (show album name under artist instead) */
    .list-body.mobile-library .col-album-cell {
      display: none;
    }

    /* Cover art sizing */
    .list-body.mobile-library .cover-wrapper,
    .list-body.mobile-library .cover-image,
    .list-body.mobile-library .cover-placeholder {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-sm);
    }

    /* Align cover flush left in its column */
    .list-body.mobile-library .col-cover {
      justify-content: flex-start;
      align-items: center;
    }

    /* Ensure title col aligns center without extra top shift */
    .list-body.mobile-library .col-title {
      padding-top: 0;
      justify-content: center;
    }

    /* Title + Artist stacked */
    .list-body.mobile-library .track-name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .list-body.mobile-library .track-artist {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    /* Duration compact */
    .list-body.mobile-library .col-duration {
      font-size: 0.75rem;
      color: var(--text-subdued);
    }

    /* Drag variant for library */
    .list-body.mobile-library.with-drag .track-row {
      grid-template-columns: 28px 48px 1fr 48px;
    }

    /* Multiselect variant for library */
    .list-body.mobile-library.multiselect .track-row,
    .list-body.mobile-library.multiselect.no-album .track-row {
      grid-template-columns: 36px 48px 1fr 48px;
    }

    /* ─── Shared playing state accents ─── */
    .track-row.playing .track-name {
      color: var(--accent-primary);
    }

    .track-row.playing .col-num {
      color: var(--accent-primary);
    }

    /* ─── Downloaded icon compact ─── */
    .downloaded-icon {
      margin-left: 2px;
    }

    .downloaded-icon svg {
      width: 12px;
      height: 12px;
    }

    /* ─── Swipe-to-queue visual states ─── */
    .track-row {
      position: relative;
      will-change: transform;
    }

    /* Green reveal behind the row when swiping right */
    .track-row::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: var(--radius-md);
      background-color: transparent;
      transition: background-color 0.15s ease;
      z-index: -1;
      pointer-events: none;
    }

    :global(.track-row.swipe-queue-ready)::before {
      background-color: color-mix(in srgb, var(--accent-primary), transparent 80%);
    }

    :global(.track-row.swipe-queue-added)::before {
      background-color: color-mix(in srgb, var(--accent-primary), transparent 65%);
    }

    /* Queue icon hint that peeks from the left while swiping */
    .track-row::after {
      content: "+";
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--accent-primary);
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
      z-index: -1;
    }

    :global(.track-row.swipe-queue-ready)::after {
      opacity: 1;
    }

    :global(.track-row.swipe-queue-added)::after {
      content: "✓";
      opacity: 1;
    }
  }
</style>
