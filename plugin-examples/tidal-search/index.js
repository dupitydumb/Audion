// Tidal Search Plugin
// Search and browse tracks from the Tidal catalog with full playback integration

(function () {
  // Import appSettings from Svelte store (native app settings)
  let appSettings = null;
  try {
    // Dynamically require if possible (for Tauri context)
    appSettings =
      window.__TAURI__ && window.appSettings ? window.appSettings : null;
  } catch (e) {
    appSettings = null;
  }
  ("use strict");

  // API Configuration - Multiple endpoints for different services
  const API_ENDPOINTS = {
    SEARCH: [
      "https://hund.qqdl.site",
      "https://katze.qqdl.site",
      "https://tidal.kinoplus.online",
      "https://maus.qqdl.site",
      "https://arran.monochrome.tf"
    ],
    DETAILS: "https://triton.squid.wtf",         // Artist/Album details
    STREAM: "https://katze.qqdl.site"            // Stream/playback endpoint
  };

  // Helper function to get a random search endpoint
  function getRandomSearchEndpoint() {
    const searchEndpoints = API_ENDPOINTS.SEARCH;
    return searchEndpoints[Math.floor(Math.random() * searchEndpoints.length)];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIDAL SEARCH PLUGIN
  // ═══════════════════════════════════════════════════════════════════════════

  const TidalSearch = {
    name: "Tidal Search",
    api: null,
    isOpen: false,
    searchMode: "track", // 'track' or 'artist'
    searchTimeout: null,
    currentResults: [],
    isPlaying: null, // Currently playing Tidal track ID
    libraryTracks: new Set(), // Set of external_ids or Tidal IDs already in library
    hasNewChanges: false, // Track if we've added new songs

    // Navigation state
    navigationStack: [], // Stack of {type, data, scrollPosition} for back navigation
    currentView: "search", // 'search', 'artist', 'album'

    init(api) {
      console.log("[TidalSearch] Initializing...");
      this.api = api;

      // Fetch library tracks to check for duplicates
      this.fetchLibraryTracks();

      // Inject styles
      this.injectStyles();

      // Create UI
      this.createSearchPanel();
      this.createPlayerBarButton();

      // Retry for late DOM loading
      setTimeout(() => this.createPlayerBarButton(), 500);
      setTimeout(() => this.createPlayerBarButton(), 1500);

      // Register stream resolver for saved Tidal tracks
      // This is called by the player when playing a track with source_type='tidal'
      if (api.stream && api.stream.registerResolver) {
        api.stream.registerResolver("tidal", async (externalId, options) => {
          console.log(
            "[TidalSearch] Resolving stream for track ID:",
            externalId,
          );
          try {
            const quality = options?.quality || "LOSSLESS";
            let streamData = await this.fetchStream(externalId, quality);

            // Handle MPD fallback
            if (streamData?.data?.manifestMimeType === "application/dash+xml") {
              streamData = await this.fetchStream(externalId, "LOSSLESS");
              if (
                streamData?.data?.manifestMimeType === "application/dash+xml"
              ) {
                streamData = await this.fetchStream(externalId, "HIGH");
              }
            }

            const streamUrl = this.decodeManifest(streamData.data);
            return streamUrl;
          } catch (err) {
            console.error("[TidalSearch] Failed to resolve stream:", err);
            return null;
          }
        });
        console.log("[TidalSearch] Registered stream resolver for tidal");
      }

      // Register the searchCover request handler (for new request API)
      if (api.handleRequest) {
        api.handleRequest("searchCover", async (data) => {
          const { title, artist, trackId, requester } = data;
          console.log(
            `[TidalSearch] Cover search requested by: ${requester || "unknown"}`,
          );

          // Call the existing searchCoverForRPC method
          return await this.searchCoverForRPC(title, artist, trackId);
        });
        console.log("[TidalSearch] Registered 'searchCover' request handler");
      }

      console.log("[TidalSearch] Plugin ready!");
    },

    // ═══════════════════════════════════════════════════════════════════════
    // STYLES
    // ═══════════════════════════════════════════════════════════════════════

    injectStyles() {
      if (document.getElementById("tidal-search-styles")) return;

      const style = document.createElement("style");
      style.id = "tidal-search-styles";
      style.textContent = `
                /* Tidal Search Panel */
                #tidal-search-panel {

                /* Download Progress Bar */
                .tidal-download-progress {
                    position: fixed;
                    bottom: 100px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: var(--bg-elevated, #282828);
                    color: var(--text-primary, #fff);
                    padding: 16px 32px;
                    border-radius: 10px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    z-index: 10002;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    min-width: 320px;
                    max-width: 400px;
                    text-align: center;
                }
                .tidal-download-progress.hidden {
                    display: none;
                }
                .tidal-download-progress-bar {
                    width: 100%;
                    height: 8px;
                    background: var(--bg-highlight, #3e3e3e);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    overflow: hidden;
                    position: relative;
                }
                .tidal-download-progress-bar-inner {
                    height: 100%;
                    background: var(--accent-primary, #1DB954);
                    border-radius: 4px;
                    width: 0%;
                    transition: width 0.2s;
                    position: absolute;
                    left: 0;
                    top: 0;
                }
                .tidal-download-progress-text {
                    font-size: 14px;
                    color: var(--text-primary, #fff);
                }
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) scale(0.9);
                    background: var(--bg-elevated, #181818);
                    border: 1px solid var(--border-color, #404040);
                    border-radius: 16px;
                    padding: 24px;
                    width: 650px;
                    max-height: 80vh;
                    z-index: 10001;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    flex-direction: column;
                }

                #tidal-search-panel.open {
                    opacity: 1;
                    visibility: visible;
                    transform: translate(-50%, -50%) scale(1);
                }

                #tidal-search-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    z-index: 10000;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s ease;
                }

                #tidal-search-overlay.open {
                    opacity: 1;
                    visibility: visible;
                }

                .tidal-search-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .tidal-search-header h2 {
                    font-size: 20px;
                    font-weight: 700;
                    color: var(--text-primary, #fff);
                    margin: 0;
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .tidal-badge {
                    background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 700;
                    color: #fff;
                    letter-spacing: 0.5px;
                }

                .tidal-close-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: none;
                    background: var(--bg-surface, #282828);
                    color: var(--text-primary, #fff);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }

                .tidal-close-btn:hover {
                    background: var(--bg-highlight, #3e3e3e);
                    transform: rotate(90deg);
                }

                .tidal-back-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: none;
                    background: var(--bg-surface, #282828);
                    color: var(--text-primary, #fff);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }

                .tidal-back-btn:hover {
                    background: var(--bg-highlight, #3e3e3e);
                    transform: translateX(-2px);
                }

                .tidal-search-controls {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .tidal-search-input {
                    flex: 1;
                    padding: 12px 16px;
                    border-radius: 8px;
                    border: 1px solid var(--border-color, #404040);
                    background: var(--bg-surface, #282828);
                    color: var(--text-primary, #fff);
                    font-size: 14px;
                    outline: none;
                    transition: border-color 0.2s ease;
                }

                .tidal-search-input:focus {
                    border-color: var(--accent-primary, #1DB954);
                }

                .tidal-search-input::placeholder {
                    color: var(--text-subdued, #6a6a6a);
                }

                .tidal-mode-toggle {
                    display: flex;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid var(--border-color, #404040);
                }

                .tidal-mode-btn {
                    padding: 12px 16px;
                    border: none;
                    background: var(--bg-surface, #282828);
                    color: var(--text-secondary, #b3b3b3);
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    transition: all 0.2s ease;
                }

                .tidal-mode-btn:hover {
                    background: var(--bg-highlight, #3e3e3e);
                }

                .tidal-mode-btn.active {
                    background: var(--accent-primary, #1DB954);
                    color: #fff;
                }

                .tidal-results-container {
                    flex: 1;
                    overflow-y: auto;
                    max-height: 450px;
                    padding-right: 8px;
                    overscroll-behavior-y: contain;
                }

                .tidal-results-container::-webkit-scrollbar {
                    width: 6px;
                }

                .tidal-results-container::-webkit-scrollbar-thumb {
                    background: var(--bg-highlight, #3e3e3e);
                    border-radius: 3px;
                }

                .tidal-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 48px;
                    color: var(--text-subdued, #6a6a6a);
                }

                .tidal-spinner {
                    width: 32px;
                    height: 32px;
                    border: 3px solid var(--bg-highlight, #3e3e3e);
                    border-top-color: var(--accent-primary, #1DB954);
                    border-radius: 50%;
                    animation: tidal-spin 0.8s linear infinite;
                    margin-bottom: 12px;
                }

                @keyframes tidal-spin {
                    to { transform: rotate(360deg); }
                }

                .tidal-empty {
                    text-align: center;
                    padding: 48px;
                    color: var(--text-subdued, #6a6a6a);
                }

                .tidal-empty-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                }

                .tidal-error {
                    text-align: center;
                    padding: 24px;
                    color: var(--error-color, #f15e6c);
                    background: rgba(241, 94, 108, 0.1);
                    border-radius: 8px;
                }

                /* Track Item */
                .tidal-track-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.2s ease;
                    position: relative;
                }

                .tidal-track-item:hover {
                    background: var(--bg-surface, #282828);
                }

                .tidal-track-item:hover .tidal-play-overlay {
                    opacity: 1;
                }

                .tidal-track-item.playing {
                    background: rgba(29, 185, 84, 0.1);
                }

                .tidal-track-item.playing .tidal-track-title {
                    color: var(--accent-primary, #1DB954);
                }

                .tidal-track-item.loading {
                    opacity: 0.6;
                    pointer-events: none;
                }

                .tidal-track-cover-wrapper {
                    position: relative;
                    width: 48px;
                    height: 48px;
                }

                .tidal-track-cover {
                    width: 48px;
                    height: 48px;
                    border-radius: 4px;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                }

                .tidal-play-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.6);
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }

                .tidal-play-icon {
                    color: #fff;
                    font-size: 20px;
                }

                .tidal-track-info {
                    flex: 1;
                    min-width: 0;
                }

                .tidal-track-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .tidal-track-artist {
                    font-size: 12px;
                    color: var(--text-secondary, #b3b3b3);
                    margin-top: 2px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .tidal-track-meta {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }

                .tidal-track-duration {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                    min-width: 40px;
                    text-align: right;
                }

                .tidal-quality-badge {
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 600;
                    text-transform: uppercase;
                }

                .tidal-quality-badge.hires {
                    background: linear-gradient(135deg, #ffd700, #ff8c00);
                    color: #000;
                }

                .tidal-quality-badge.lossless {
                    background: #1DB954;
                    color: #fff;
                }

                .tidal-quality-badge.high {
                    background: var(--bg-highlight, #3e3e3e);
                    color: var(--text-secondary, #b3b3b3);
                }

                .tidal-explicit-badge {
                    background: var(--text-subdued, #6a6a6a);
                    color: var(--bg-base, #121212);
                    padding: 1px 4px;
                    border-radius: 2px;
                    font-size: 9px;
                    font-weight: 700;
                }

                /* Save button */
                .tidal-save-btn {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    border: none;
                    background: transparent;
                    color: var(--text-secondary, #b3b3b3);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    flex-shrink: 0;
                }

                .tidal-save-btn:hover {
                    color: var(--accent-primary, #1DB954);
                    background: rgba(29, 185, 84, 0.1);
                    transform: scale(1.1);
                }

                .tidal-save-btn.saving {
                    animation: tidal-pulse 1s ease infinite;
                }

                .tidal-save-btn.saved {
                    color: var(--accent-primary, #1DB954);
                }

                @keyframes tidal-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }

                /* Artist Item */
                .tidal-artist-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }

                .tidal-artist-item:hover {
                    background: var(--bg-surface, #282828);
                }

                .tidal-artist-picture {
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                }

                .tidal-artist-info {
                    flex: 1;
                }

                .tidal-artist-name {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--text-primary, #fff);
                }

                .tidal-artist-type {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                    margin-top: 2px;
                }

                .tidal-artist-popularity {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 12px;
                    color: var(--text-secondary, #b3b3b3);
                }

                /* Player bar button */
                .tidal-search-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: none;
                    background: transparent;
                    color: var(--text-secondary, #b3b3b3);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }

                .tidal-search-btn:hover {
                    color: var(--text-primary, #fff);
                    transform: scale(1.1);
                }

                .tidal-search-btn.active {
                    color: var(--accent-primary, #1DB954);
                }

                /* Results count */
                .tidal-results-info {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                    margin-bottom: 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .tidal-quality-selector {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .tidal-quality-selector label {
                    font-size: 11px;
                    color: var(--text-subdued, #6a6a6a);
                }

                .tidal-quality-selector select {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    border-radius: 4px;
                    color: var(--text-primary, #fff);
                    padding: 4px 8px;
                    font-size: 11px;
                    cursor: pointer;
                }

                /* Toast notification */
                .tidal-toast {
                    position: fixed;
                    bottom: 100px;
                    left: 50%;
                    transform: translateX(-50%) translateY(20px);
                    background: var(--bg-elevated, #282828);
                    color: var(--text-primary, #fff);
                    padding: 12px 24px;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    z-index: 10002;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s ease;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    max-width: 400px;
                    text-align: center;
                    white-space: pre-line;
                    font-size: 13px;
                }

                .tidal-toast.show {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(0);
                }

                .tidal-toast.error {
                    background: var(--error-color, #f15e6c);
                }

                /* Artist Page Styles */
                .tidal-artist-page {
                    padding: 16px 0;
                }

                .tidal-artist-header {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    margin-bottom: 32px;
                    padding: 0 4px;
                }

                .tidal-artist-page-picture {
                    width: 120px;
                    height: 120px;
                    border-radius: 50%;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                }

                .tidal-artist-header-info h3 {
                    font-size: 28px;
                    font-weight: 700;
                    color: var(--text-primary, #fff);
                    margin: 0 0 8px 0;
                }

                .tidal-artist-meta {
                    font-size: 14px;
                    color: var(--text-secondary, #b3b3b3);
                }

                /* Album Page Styles */
                .tidal-album-page {
                    padding: 16px 0;
                }

                .tidal-album-page-header {
                    display: flex;
                    gap: 24px;
                    margin-bottom: 32px;
                    padding: 0 4px;
                }

                .tidal-album-page-cover {
                    width: 200px;
                    height: 200px;
                    border-radius: 8px;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                    flex-shrink: 0;
                }

                .tidal-album-page-info {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }

                .tidal-album-page-info h3 {
                    font-size: 24px;
                    font-weight: 700;
                    color: var(--text-primary, #fff);
                    margin: 0 0 8px 0;
                }

                .tidal-album-page-artist {
                    font-size: 16px;
                    color: var(--text-secondary, #b3b3b3);
                    margin-bottom: 8px;
                }

                .tidal-album-page-meta {
                    font-size: 13px;
                    color: var(--text-subdued, #6a6a6a);
                }

                /* Section Styles */
                .tidal-section {
                    margin-bottom: 32px;
                }

                .tidal-section-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding: 0 4px;
                }

                .tidal-section-header h4 {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-primary, #fff);
                    margin: 0;
                }

                .tidal-section-count {
                    font-size: 13px;
                    color: var(--text-subdued, #6a6a6a);
                }

                /* Save All Button */
                .tidal-save-all-btn {
                    padding: 8px 16px;
                    border-radius: 20px;
                    border: 1px solid var(--accent-primary, #1DB954);
                    background: transparent;
                    color: var(--accent-primary, #1DB954);
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s ease;
                }

                .tidal-save-all-btn:hover {
                    background: var(--accent-primary, #1DB954);
                    color: #fff;
                }

                /* Album Grid */
                .tidal-album-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                    gap: 16px;
                    padding: 0 4px;
                }

                .tidal-album-item {
                    cursor: pointer;
                    border-radius: 8px;
                    padding: 12px;
                    transition: background 0.2s ease;
                }

                .tidal-album-item:hover {
                    background: var(--bg-surface, #282828);
                }

                .tidal-album-cover {
                    width: 100%;
                    aspect-ratio: 1;
                    border-radius: 4px;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                    margin-bottom: 8px;
                }

                .tidal-album-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tidal-album-meta {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                }

                /* Track List */
                .tidal-track-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .tidal-track-number {
                    width: 32px;
                    text-align: center;
                    font-size: 14px;
                    color: var(--text-subdued, #6a6a6a);
                    flex-shrink: 0;
                }

                /* Search Results Grid */
                .tidal-search-results-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 16px;
                    padding: 0 4px;
                    margin-bottom: 8px;
                }

                /* Artist Cards */
                .tidal-artist-card {
                    cursor: pointer;
                    border-radius: 8px;
                    padding: 12px;
                    transition: background 0.2s ease;
                    text-align: center;
                }

                .tidal-artist-card:hover {
                    background: var(--bg-surface, #282828);
                }

                .tidal-artist-card-picture {
                    width: 100%;
                    aspect-ratio: 1;
                    border-radius: 50%;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                    margin-bottom: 12px;
                }

                .tidal-artist-card-name {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tidal-artist-card-type {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                /* Album Cards */
                .tidal-album-card {
                    cursor: pointer;
                    border-radius: 8px;
                    padding: 12px;
                    transition: background 0.2s ease;
                }

                .tidal-album-card:hover {
                    background: var(--bg-surface, #282828);
                }

                .tidal-album-card-cover {
                    width: 100%;
                    aspect-ratio: 1;
                    border-radius: 4px;
                    object-fit: cover;
                    background: var(--bg-highlight, #3e3e3e);
                    margin-bottom: 8px;
                }

                .tidal-album-card-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                }

                .tidal-album-card-artist {
                    font-size: 12px;
                    color: var(--text-subdued, #6a6a6a);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                /* ═══ Mobile Responsive ═══ */
                @media (max-width: 768px) {
                    #tidal-search-panel {
                        width: 100vw;
                        height: 100vh;
                        max-height: 100vh;
                        top: 0; left: 0;
                        transform: none;
                        border-radius: 0;
                        border: none;
                        padding: 16px;
                    }
                    #tidal-search-panel.open {
                        transform: none;
                    }

                    .tidal-search-header h2 {
                        font-size: 18px;
                    }
                    .tidal-close-btn {
                        min-width: 44px;
                        min-height: 44px;
                        -webkit-tap-highlight-color: transparent;
                    }

                    .tidal-search-controls {
                        flex-direction: column;
                        gap: 10px;
                    }
                    .tidal-search-input {
                        font-size: 16px; /* prevent iOS zoom */
                        padding: 14px 16px;
                    }
                    .tidal-mode-btn {
                        padding: 12px;
                        min-height: 44px;
                        -webkit-tap-highlight-color: transparent;
                    }

                    .tidal-results-container {
                        max-height: none;
                        flex: 1;
                        padding-bottom: calc(60px + 64px); /* bottom nav + mini player */
                    }

                    /* Track items: always show save btn on mobile */
                    .tidal-track-item {
                        padding: 12px 8px;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .tidal-play-overlay {
                        display: none;
                    }
                    .tidal-save-btn {
                        width: 44px;
                        height: 44px;
                        -webkit-tap-highlight-color: transparent;
                    }

                    /* Artist items */
                    .tidal-artist-item {
                        padding: 12px 8px;
                        min-height: 44px;
                        -webkit-tap-highlight-color: transparent;
                    }

                    /* Quality selector */
                    .tidal-quality-selector select {
                        min-height: 44px;
                        padding: 8px 12px;
                        font-size: 14px;
                    }

                    /* Toast: account for bottom nav */
                    .tidal-toast {
                        bottom: calc(60px + 64px + 16px);
                        max-width: 90vw;
                    }

                    /* Download progress: account for bottom nav */
                    .tidal-download-progress {
                        bottom: calc(60px + 64px + 16px);
                        max-width: 90vw;
                        min-width: auto;
                    }
                }
            `;
      document.head.appendChild(style);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UI CREATION
    // ═══════════════════════════════════════════════════════════════════════

    createSearchPanel() {
      // Create overlay
      const overlay = document.createElement("div");
      overlay.id = "tidal-search-overlay";
      overlay.onclick = () => this.close();
      document.body.appendChild(overlay);

      // Create download progress bar
      const progressBar = document.createElement("div");
      progressBar.id = "tidal-download-progress";
      progressBar.className = "tidal-download-progress hidden";
      progressBar.innerHTML = `
                <div class="tidal-download-progress-bar" style="width:100%;background:var(--bg-highlight, #3e3e3e);"></div>
                <div class="tidal-download-progress-text"></div>
            `;
      document.body.appendChild(progressBar);

      // Create toast container
      const toastDef = document.createElement("div");
      toastDef.id = "tidal-toast";
      toastDef.className = "tidal-toast";
      document.body.appendChild(toastDef);

      // Create panel
      const panel = document.createElement("div");
      panel.id = "tidal-search-panel";
      panel.innerHTML = `
                <div class="tidal-search-header">
                    <button class="tidal-back-btn" style="display: none;" title="Back">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                    </button>
                    <h2>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
                            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" fill="none"/>
                        </svg>
                        <span class="tidal-panel-title">Tidal Search</span>
                        <span class="tidal-badge">TIDAL</span>
                    </h2>
                    <button class="tidal-close-btn" title="Close">✕</button>
                </div>
                <div class="tidal-search-controls">
                    <input type="text" class="tidal-search-input" placeholder="Search for music on Tidal..." autofocus>
                    <div class="tidal-mode-toggle">
                        <button class="tidal-mode-btn active" data-mode="track">Tracks</button>
                        <button class="tidal-mode-btn" data-mode="artist">Artists</button>
                        <button class="tidal-mode-btn" data-mode="album">Albums</button>
                    </div>
                </div>
                <div class="tidal-results-info" style="display: none;">
                    <span class="tidal-results-count"></span>
                </div>
                <div class="tidal-results-container">
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">🔍</div>
                        <div>Search for music on Tidal</div>
                        <div style="font-size: 12px; margin-top: 8px; color: var(--text-subdued);">Artists, Albums, and Tracks</div>
                    </div>
                </div>
            `;
      document.body.appendChild(panel);

      // Event listeners
      panel.querySelector(".tidal-close-btn").onclick = () => this.close();
      panel.querySelector(".tidal-back-btn").onclick = () => this.navigateBack();

      const input = panel.querySelector(".tidal-search-input");
      input.addEventListener("input", (e) => this.handleSearch(e.target.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.close();
      });

      // Mode toggle listeners
      panel.querySelectorAll(".tidal-mode-btn").forEach((btn) => {
        btn.onclick = (e) => this.setSearchMode(e.target.dataset.mode);
      });

      // Prevent panel close when clicking inside
      panel.onclick = (e) => e.stopPropagation();
    },

    createPlayerBarButton() {
      if (document.getElementById("tidal-search-playerbar-btn")) return;

      const btn = document.createElement("button");
      btn.id = "tidal-search-playerbar-btn";
      // Removed 'tidal-search-btn icon-btn' classes to fit in menu
      btn.title = "Tidal Search";
      btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                </svg>
                <span>Tidal Search</span>
            `;
      btn.onclick = () => this.toggle();

      if (this.api && this.api.ui) {
        this.api.ui.registerSlot("playerbar:menu", btn);
      } else {
        console.error("[TidalSearch] UI API not available");
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════

    showToast(message, isError = false) {
      const toast = document.getElementById("tidal-toast");
      if (!toast) return;

      toast.textContent = message;
      toast.className = "tidal-toast show" + (isError ? " error" : "");

      setTimeout(() => {
        toast.classList.remove("show");
      }, 3000);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PANEL CONTROL
    // ═══════════════════════════════════════════════════════════════════════

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    open() {
      this.isOpen = true;
      document.getElementById("tidal-search-overlay")?.classList.add("open");
      document.getElementById("tidal-search-panel")?.classList.add("open");
      document
        .getElementById("tidal-search-playerbar-btn")
        ?.classList.add("active");

      // Focus input
      setTimeout(() => {
        document.querySelector(".tidal-search-input")?.focus();
      }, 100);

      // Refresh library tracks cache on open to capture any external changes
      this.fetchLibraryTracks();
    },

    close() {
      this.isOpen = false;
      document.getElementById("tidal-search-overlay")?.classList.remove("open");
      document.getElementById("tidal-search-panel")?.classList.remove("open");
      document
        .getElementById("tidal-search-playerbar-btn")
        ?.classList.remove("active");

      // Refresh library if we made changes
      if (this.hasNewChanges) {
        console.log("[TidalSearch] Refreshing library after changes");
        this.api?.library?.refresh?.();
        this.hasNewChanges = false;
      }

      // Reset navigation state
      this.navigationStack = [];
      this.currentView = "search";
      this.updateBackButton();
      this.updatePanelTitle("Tidal Search");
    },

    async fetchLibraryTracks() {
      if (this.api?.library?.getTracks) {
        try {
          const tracks = (await this.api.library.getTracks()) || [];

          if (!Array.isArray(tracks)) {
            console.warn(
              "[TidalSearch] Library tracks response is not an array:",
              tracks,
            );
            this.libraryTracks = new Set();
            return;
          }

          // Store Tidal IDs (external_id) for fast lookup
          // Filter for source_type='tidal' and store their IDs
          this.libraryTracks = new Set(
            tracks
              .filter((t) => t && t.source_type === "tidal")
              .map((t) => t.external_id),
          );
          console.log(
            `[TidalSearch] Loaded ${this.libraryTracks.size} Tidal tracks from library`,
          );
        } catch (err) {
          console.error("[TidalSearch] Failed to fetch library tracks:", err);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SEARCH FUNCTIONALITY
    // ═══════════════════════════════════════════════════════════════════════

    setSearchMode(mode) {
      this.searchMode = mode;

      document.querySelectorAll(".tidal-mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
      });

      // Re-run search with new mode
      const query = document.querySelector(".tidal-search-input")?.value;
      if (query) {
        this.performSearch(query);
      }
    },

    handleSearch(query) {
      // Debounce search
      clearTimeout(this.searchTimeout);

      if (!query.trim()) {
        this.showEmpty();
        return;
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query.trim());
      }, 300);
    },

    async performSearch(query) {
      this.showLoading();

      try {
        // Use different parameters based on search mode
        let param;
        if (this.searchMode === "track") {
          param = "s"; // Track search
        } else if (this.searchMode === "artist") {
          param = "a"; // Artist search  
        } else {
          param = "al"; // Album search
        }

        const url = `${getRandomSearchEndpoint()}/search/?${param}=${encodeURIComponent(query)}`;

        // Use CORS-free fetch via Tauri backend
        const response = this.api.fetch
          ? await this.api.fetch(url)
          : await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        this.currentResults = data;

        // Render based on mode
        if (this.searchMode === "track") {
          this.renderTrackResults(data);
        } else if (this.searchMode === "artist") {
          this.renderArtistResults(data);
        } else {
          this.renderAlbumResults(data);
        }
      } catch (err) {
        console.error("[TidalSearch] Search error:", err);
        this.showError(err.message);
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════════════

    showLoading() {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");
      if (container) {
        container.innerHTML = `
                    <div class="tidal-loading">
                        <div class="tidal-spinner"></div>
                        <div>Searching Tidal...</div>
                    </div>
                `;
      }
      if (info) info.style.display = "none";
    },

    showEmpty() {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");
      if (container) {
        container.innerHTML = `
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">🔍</div>
                        <div>Search for tracks on Tidal</div>
                        <div style="font-size: 12px; margin-top: 8px; color: var(--text-subdued);">Click any track to play it</div>
                    </div>
                `;
      }
      if (info) info.style.display = "none";
    },

    showError(message) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");
      if (container) {
        container.innerHTML = `
                    <div class="tidal-error">
                        <div>⚠️ Failed to search: ${message}</div>
                        <div style="font-size: 12px; margin-top: 8px;">Please check your connection and try again</div>
                    </div>
                `;
      }
      if (info) info.style.display = "none";
    },

    renderUnifiedResults(data) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      // Extract all result types
      const tracks = data?.data?.items || [];
      const artists = data?.data?.artists?.items || [];
      const albums = data?.data?.albums?.items || [];

      const totalResults = tracks.length + artists.length + albums.length;

      if (info) {
        info.querySelector(".tidal-results-count").textContent =
          `Found ${totalResults} results`;
        info.style.display = "flex";
      }

      if (totalResults === 0) {
        container.innerHTML = `
          <div class="tidal-empty">
            <div class="tidal-empty-icon">😔</div>
            <div>No results found</div>
          </div>
        `;
        return;
      }

      let html = '';

      // Artists Section
      if (artists.length > 0) {
        html += `
          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Artists</h4>
              <span class="tidal-section-count">${artists.length} results</span>
            </div>
            <div class="tidal-search-results-grid">
              ${artists.map((artist) => this.renderArtistCard(artist)).join("")}
            </div>
          </div>
        `;
      }

      // Albums Section
      if (albums.length > 0) {
        html += `
          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Albums</h4>
              <span class="tidal-section-count">${albums.length} results</span>
            </div>
            <div class="tidal-search-results-grid">
              ${albums.map((album) => this.renderAlbumCard(album)).join("")}
            </div>
          </div>
        `;
      }

      // Tracks Section
      if (tracks.length > 0) {
        html += `
          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Tracks</h4>
              <span class="tidal-section-count">${tracks.length} results</span>
            </div>
            <div class="tidal-track-list">
              ${tracks.map((track) => this.renderTrackItem(track)).join("")}
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      // Attach event listeners
      this.attachTrackEventListeners(container);

      // Attach artist click listeners
      container.querySelectorAll(".tidal-artist-card").forEach((el) => {
        const artistId = el.dataset.artistId;
        if (artistId) {
          const artist = artists.find((a) => String(a.id) === artistId);
          if (artist) {
            el.onclick = () => this.handleArtistClick(artist);
          }
        }
      });

      // Attach album click listeners
      container.querySelectorAll(".tidal-album-card").forEach((el) => {
        const albumId = el.dataset.albumId;
        if (albumId) {
          el.onclick = () => this.handleAlbumClick(albumId);
        }
      });
    },

    renderArtistCard(artist) {
      const pictureUrl = artist.picture
        ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, "/")}/160x160.jpg`
        : "";

      return `
        <div class="tidal-artist-card" data-artist-id="${artist.id}">
          <img class="tidal-artist-card-picture" src="${pictureUrl}"
               alt="${this.escapeHtml(artist.name)}"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 160%22%3E%3Ccircle fill=%22%23282828%22 cx=%2280%22 cy=%2280%22 r=%2280%22/%3E%3Ctext x=%2280%22 y=%2295%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2250%22%3E👤%3C/text%3E%3C/svg%3E'">
          <div class="tidal-artist-card-name">${this.escapeHtml(artist.name)}</div>
          <div class="tidal-artist-card-type">Artist</div>
        </div>
      `;
    },

    renderAlbumCard(album) {
      const coverUrl = album.cover
        ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, "/")}/160x160.jpg`
        : "";

      const artistName = album.artist?.name || album.artists?.[0]?.name || "Various Artists";

      return `
        <div class="tidal-album-card" data-album-id="${album.id}">
          <img class="tidal-album-card-cover" src="${coverUrl}"
               alt="${this.escapeHtml(album.title)}"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 160%22%3E%3Crect fill=%22%23282828%22 width=%22160%22 height=%22160%22/%3E%3Ctext x=%2280%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2240%22%3E🎵%3C/text%3E%3C/svg%3E'">
          <div class="tidal-album-card-title">${this.escapeHtml(album.title)}</div>
          <div class="tidal-album-card-artist">${this.escapeHtml(artistName)}</div>
        </div>
      `;
    },

    renderTrackResults(data) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      const items = data?.data?.items || [];
      const total = data?.data?.totalNumberOfItems || 0;

      if (info) {
        info.querySelector(".tidal-results-count").textContent =
          `Found ${total.toLocaleString()} tracks (showing ${items.length})`;
        info.style.display = "flex";
      }

      if (items.length === 0) {
        container.innerHTML = `
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">😔</div>
                        <div>No tracks found</div>
                    </div>
                `;
        return;
      }

      container.innerHTML = items
        .map((track) => this.renderTrackItem(track))
        .join("");

      // Add click handlers for play
      container.querySelectorAll(".tidal-track-item").forEach((el, index) => {
        el.onclick = (e) => {
          // Don't trigger if clicking on save button or link
          if (e.target.closest(".tidal-save-btn") || e.target.tagName === "A")
            return;
          this.playTrack(items[index], el);
        };
      });

      // Add click handlers for save buttons
      container.querySelectorAll(".tidal-save-btn").forEach((btn, index) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.saveTrack(items[index], btn);
        };
      });
    },

    renderTrackItem(track) {
      const coverUrl = track.album?.cover
        ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, "/")}/160x160.jpg`
        : "";

      const duration = this.formatDuration(track.duration);
      const qualityBadge = this.getQualityBadge(track);
      const artistName =
        track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
      const title = track.version
        ? `${track.title} (${track.version})`
        : track.title;
      const isPlaying = this.isPlaying === track.id;
      const isSaved = this.libraryTracks.has(String(track.id));
      const explicitBadge = track.explicit
        ? '<span class="tidal-explicit-badge">E</span>'
        : "";

      // Heart icon path (outline vs filled)
      // Filled heart for saved, Outline for not saved
      const heartIcon = isSaved
        ? `<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`
        : `<path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>`;

      return `
                <div class="tidal-track-item ${isPlaying ? "playing" : ""} ${isSaved ? "saved" : ""}" data-id="${track.id}">
                    <div class="tidal-track-cover-wrapper">
                        <img class="tidal-track-cover" src="${coverUrl}" alt="${this.escapeHtml(track.title)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect fill=%22%23282828%22 width=%2248%22 height=%2248%22/><text x=%2224%22 y=%2230%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2220%22>🎵</text></svg>'">
                        <div class="tidal-play-overlay">
                            <span class="tidal-play-icon">▶</span>
                        </div>
                    </div>
                    <div class="tidal-track-info">
                        <div class="tidal-track-title">${this.escapeHtml(title)} ${explicitBadge}</div>
                        <div class="tidal-track-artist">
                            ${this.escapeHtml(artistName)} • ${this.escapeHtml(track.album?.title || "")}
                        </div>
                    </div>
                    <div class="tidal-track-meta">
                        ${qualityBadge}
                        <span class="tidal-track-duration">${duration}</span>
                        <button class="tidal-save-btn ${isSaved ? "saved" : ""}" data-track-id="${track.id}" title="${isSaved ? "Already in library" : "Save to library"}" ${isSaved ? "disabled" : ""}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                ${heartIcon}
                            </svg>
                        </button>
                    </div>
                </div>
            `;
    },

    renderArtistResults(data) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      const artists = data?.data?.artists?.items || [];
      const total = data?.data?.artists?.totalNumberOfItems || 0;

      if (info) {
        info.querySelector(".tidal-results-count").textContent =
          `Found ${total.toLocaleString()} artists (showing ${artists.length})`;
        info.style.display = "flex";
      }

      if (artists.length === 0) {
        container.innerHTML = `
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">😔</div>
                        <div>No artists found</div>
                    </div>
                `;
        return;
      }

      container.innerHTML = artists
        .map((artist) => this.renderArtistItem(artist))
        .join("");

      // Add click handlers
      container.querySelectorAll(".tidal-artist-item").forEach((el, index) => {
        el.onclick = () => this.handleArtistClick(artists[index]);
      });
    },

    renderAlbumResults(data) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      // Albums are in data.albums.items according to API docs
      const items = data?.data?.albums?.items || [];
      const total = data?.data?.albums?.totalNumberOfItems || 0;

      if (info) {
        info.querySelector(".tidal-results-count").textContent =
          total > 0 ? `${total} albums` : "No albums found";
        info.style.display = "flex";
      }

      if (items.length === 0) {
        container.innerHTML = `
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">😔</div>
                        <div>No albums found</div>
                    </div>
                `;
        return;
      }

      container.innerHTML = `
                <div class="tidal-search-results-grid">
                    ${items.map((album) => this.renderAlbumCard(album)).join("")}
                </div>
            `;

      // Add click handlers
      container.querySelectorAll(".tidal-album-card").forEach((el) => {
        const albumId = el.dataset.albumId;
        if (albumId) {
          el.onclick = () => this.handleAlbumClick(albumId);
        }
      });
    },

    renderArtistItem(artist) {
      const pictureUrl = artist.picture
        ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, "/")}/160x160.jpg`
        : "";

      const types = artist.artistTypes?.join(", ") || "Artist";

      return `
                <div class="tidal-artist-item" data-id="${artist.id}">
                    <img class="tidal-artist-picture" src="${pictureUrl}" alt="${this.escapeHtml(artist.name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 56 56%22><circle fill=%22%23282828%22 cx=%2228%22 cy=%2228%22 r=%2228%22/><text x=%2228%22 y=%2234%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2224%22>👤</text></svg>'">
                    <div class="tidal-artist-info">
                        <div class="tidal-artist-name">${this.escapeHtml(artist.name)}</div>
                        <div class="tidal-artist-type">${this.escapeHtml(types)}</div>
                    </div>
                    <div class="tidal-artist-popularity">
                        <span>🔥</span>
                        <span>${artist.popularity || 0}</span>
                    </div>
                </div>
            `;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PLAYBACK HANDLERS
    // ═══════════════════════════════════════════════════════════════════════

    async playTrack(track, element) {
      console.log("[TidalSearch] Playing track:", track.title);

      // Show loading state
      if (element) {
        element.classList.add("loading");
      }

      try {
        // Get selected quality
        let quality =
          document.getElementById("tidal-quality")?.value || "LOSSLESS";

        // Fetch stream
        let streamData = await this.fetchStream(track.id, quality);

        // Check if it's MPD (DASH) format - native audio can't play this
        if (streamData?.data?.manifestMimeType === "application/dash+xml") {
          console.log("[TidalSearch] MPD detected, falling back to LOSSLESS");
          this.showToast("Hi-Res uses DASH, trying Lossless...");

          // Try LOSSLESS instead
          if (quality === "HI_RES_LOSSLESS") {
            quality = "LOSSLESS";
            streamData = await this.fetchStream(track.id, quality);
          }

          // If still MPD, try HIGH
          if (streamData?.data?.manifestMimeType === "application/dash+xml") {
            quality = "HIGH";
            streamData = await this.fetchStream(track.id, quality);
          }
        }

        if (!streamData?.data?.manifest) {
          throw new Error("No manifest in response");
        }

        // Decode manifest to get stream URL
        const streamUrl = this.decodeManifest(streamData.data);

        if (!streamUrl) {
          throw new Error("Could not extract stream URL");
        }

        console.log("[TidalSearch] Stream URL:", streamUrl);

        // Get the audio element and play
        const audioElement = document.querySelector("audio");
        if (audioElement) {
          // Update current playing track
          this.isPlaying = track.id;

          // Create Audion-compatible track object
          const artistName =
            track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
          const coverUrl = track.album?.cover
            ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, "/")}/320x320.jpg`
            : null;

          const audionTrack = {
            id: track.id,
            path: streamUrl, // Use stream URL as path
            title: track.title + (track.version ? ` (${track.version})` : ""),
            artist: artistName,
            album: track.album?.title || null,
            duration: track.duration || null,
            cover_url: coverUrl, // For Tidal album art
            tidal_id: track.id, // Keep original Tidal ID
            format: streamData?.data?.audioQuality || "LOSSLESS",
            bitrate: streamData?.data?.sampleRate || null,
          };

          // Set track via API (triggers trackChange event for lyrics)
          if (this.api?.player?.setTrack) {
            this.api.player.setTrack(audionTrack);
          }

          // Set audio source and play
          audioElement.src = streamUrl;

          try {
            await audioElement.play();
          } catch (playErr) {
            // Ignore AbortError (happens when quickly switching tracks)
            if (playErr.name !== "AbortError") {
              throw playErr;
            }
          }

          // Show toast notification
          this.showToast(`▶ ${audionTrack.title} - ${artistName}`);

          // Update track items to show playing state
          document.querySelectorAll(".tidal-track-item").forEach((el) => {
            el.classList.toggle(
              "playing",
              parseInt(el.dataset.id) === track.id,
            );
          });
        } else {
          throw new Error("Audio element not found");
        }
      } catch (err) {
        console.error("[TidalSearch] Playback error:", err);
        this.showToast(`Error: ${err.message}`, true);
      } finally {
        if (element) {
          element.classList.remove("loading");
        }
      }
    },

    async fetchStream(trackId, quality) {
      const url = `${API_ENDPOINTS.STREAM}/track/?id=${trackId}&quality=${quality}`;

      // Use CORS-free fetch via Tauri backend
      const response = this.api.fetch
        ? await this.api.fetch(url)
        : await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to get stream: HTTP ${response.status}`);
      }
      return await response.json();
    },

    // covers for RPC

    async searchCoverForRPC(title, artist, trackId) {
      try {
        const query = `${title} ${artist}`;
        const url = `${getRandomSearchEndpoint()}/search/?s=${encodeURIComponent(query)}`;

        const response = this.api.fetch
          ? await this.api.fetch(url)
          : await fetch(url);

        if (!response.ok) {
          console.log("[TidalSearch] Cover search failed:", response.status);
          return null;
        }

        const data = await response.json();
        const items = data?.data?.items || [];

        if (items.length > 0 && items[0].album?.cover) {
          const coverUrl = `https://resources.tidal.com/images/${items[0].album.cover.replace(/-/g, "/")}/640x640.jpg`;

          // Update database if we have a track ID
          if (trackId && this.api.library?.updateTrackCoverUrl) {
            try {
              await this.api.library.updateTrackCoverUrl(trackId, coverUrl);
              console.log(
                "[TidalSearch] Updated cover_url in database for track:",
                trackId,
              );
            } catch (err) {
              console.log("[TidalSearch] Could not update database:", err);
            }
          }

          return coverUrl;
        }
      } catch (error) {
        console.log("[TidalSearch] Cover search error:", error);
      }

      return null;
    },

    // Search for artist picture from Tidal with local caching
    async searchArtistPictureForRPC(artistName) {
      console.log('[TidalSearch] searchArtistPictureForRPC called for:', artistName);
      try {
        // Sanitize artist name for file system
        const sanitizedName = artistName
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .toLowerCase();

        console.log('[TidalSearch] Sanitized:', sanitizedName);
        console.log('[TidalSearch] API check - path:', !!this.api.path, 'fs:', !!this.api.fs, 'fetch:', !!this.api.fetch, 'convertFileSrc:', !!this.api.convertFileSrc);

        // Check if we have Tauri API for file operations
        if (this.api.path && this.api.fs) {
          console.log('[TidalSearch] Tauri APIs available, checking cache...');
          try {
            // Get app data directory
            const appDataDir = await this.api.path.appDataDir();
            const artistsDir = await this.api.path.join(appDataDir, 'covers', 'artists');
            const imagePath = await this.api.path.join(artistsDir, `${sanitizedName}.jpg`);

            // Check if cached image exists
            const exists = await this.api.fs.exists(imagePath);
            console.log('[TidalSearch] Cache check - path:', imagePath, 'exists:', exists);

            if (exists) {
              console.log('[TidalSearch] Using cached artist image:', imagePath);
              // Convert to asset URL that can be used in src attribute
              return this.api.convertFileSrc(imagePath);
            }
          } catch (cacheError) {
            console.log('[TidalSearch] Cache check failed:', cacheError);
            // Continue to fetch from API
          }
        } else {
          console.log('[TidalSearch] Tauri APIs not available for cache check');
        }

        // Fetch from Tidal API
        const url = `${getRandomSearchEndpoint()}/search/?a=${encodeURIComponent(artistName)}`;

        const response = this.api.fetch
          ? await this.api.fetch(url)
          : await fetch(url);

        if (!response.ok) {
          console.log("[TidalSearch] Artist picture search failed:", response.status);
          return null;
        }

        const data = await response.json();
        const artists = data?.data?.artists?.items || [];

        if (artists.length > 0 && artists[0].picture) {
          const pictureUrl = `https://resources.tidal.com/images/${artists[0].picture.replace(/-/g, "/")}/480x480.jpg`;
          console.log('[TidalSearch] Found picture URL from API:', pictureUrl);

          // Download and cache the image if Tauri API is available
          if (this.api.path && this.api.fs && this.api.fetch) {
            console.log('[TidalSearch] Attempting to download and cache...');
            try {
              const appDataDir = await this.api.path.appDataDir();
              const artistsDir = await this.api.path.join(appDataDir, 'covers', 'artists');
              const imagePath = await this.api.path.join(artistsDir, `${sanitizedName}.jpg`);

              // Ensure directory exists
              console.log('[TidalSearch] Creating directory:', artistsDir);
              await this.api.fs.createDir(artistsDir, { recursive: true });

              // Download image
              console.log('[TidalSearch] Downloading from:', pictureUrl);
              const imageResponse = await this.api.fetch(pictureUrl);
              if (imageResponse.ok) {
                const arrayBuffer = await imageResponse.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // Write to file
                await this.api.fs.writeBinaryFile(imagePath, uint8Array);
                console.log('[TidalSearch] Cached artist image:', imagePath);

                // Return converted path
                return this.api.convertFileSrc(imagePath);
              }
            } catch (saveError) {
              console.log('[TidalSearch] Failed to cache artist image:', saveError);
              // Fall back to direct URL
              return pictureUrl;
            }
          }

          // If no Tauri API, return direct URL
          return pictureUrl;
        }
      } catch (error) {
        console.log("[TidalSearch] Artist picture search error:", error);
      }
      return null;
    },

    // Complete saveTrack method - saves static data only, URL is resolved on play

    async saveTrack(track, button) {
      console.log("[TidalSearch] Adding track to library:", track.title);

      // Show saving state
      button.classList.add("saving");

      try {
        // Get quality selection for format info
        const quality =
          document.getElementById("tidal-quality")?.value || "LOSSLESS";

        // Get track metadata
        const artistName =
          track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
        const title =
          track.title + (track.version ? ` (${track.version})` : "");
        const coverUrl = track.album?.cover
          ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, "/")}/640x640.jpg`
          : null;

        // Check if API is available
        if (this.api?.library?.addExternalTrack) {
          console.log(
            "[TidalSearch] Saving static metadata (URL resolved on play)",
          );

          // Add track to database with static metadata only
          // Path will be "tidal://{id}" - stream URL fetched fresh on play
          const trackData = {
            title: title,
            artist: artistName,
            album: track.album?.title || null,
            duration: track.duration || null,
            cover_url: coverUrl,
            source_type: "tidal",
            external_id: String(track.id), // Used to fetch stream on play
            format: track.mediaMetadata?.tags?.includes("HIRES_LOSSLESS")
              ? "HI_RES_LOSSLESS"
              : track.mediaMetadata?.tags?.includes("LOSSLESS")
                ? "LOSSLESS"
                : quality, // Fallback to selected quality
            bitrate: null,
            // No stream_url - resolved on play for freshness
          };

          await this.api.library.addExternalTrack(trackData);

          // Mark as saved
          button.classList.remove("saving");
          button.classList.add("saved");
          button.disabled = true;
          button.title = "Saved to library";

          // Update icon to filled heart
          button.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    `;

          this.showToast(`✓ Added to library: ${title}`);
          console.log("[TidalSearch] Track saved:", trackData);

          // Add to local set so it shows as saved in future searches
          this.libraryTracks.add(String(track.id));

          // Flag that we need a refresh on close
          this.hasNewChanges = true;
        } else {
          throw new Error("Library API not available");
        }
      } catch (err) {
        console.error("[TidalSearch] Save error:", err);
        button.classList.remove("saving");
        this.showToast(`Error: ${err.message}`, true);
      }
    },

    arrayBufferToBase64(buffer) {
      // For large files, process in chunks to avoid stack overflow
      const bytes = new Uint8Array(buffer);
      const chunkSize = 8192;
      let binary = "";

      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
      }

      return btoa(binary);
    },

    formatSize(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    },

    downloadViaBrowser(blob, filename) {
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    },

    decodeManifest(data) {
      try {
        const manifestMimeType = data.manifestMimeType;
        const manifestB64 = data.manifest;

        // Decode base64
        const manifestStr = atob(manifestB64);

        if (manifestMimeType === "application/vnd.tidal.bts") {
          // JSON manifest for FLAC/AAC
          const manifest = JSON.parse(manifestStr);
          console.log("[TidalSearch] Decoded BTS manifest:", manifest);

          if (manifest.urls && manifest.urls.length > 0) {
            return manifest.urls[0];
          }
        } else if (manifestMimeType === "application/dash+xml") {
          // MPD manifest for Hi-Res - can't play directly
          console.warn(
            "[TidalSearch] MPD manifest not supported by native audio",
          );
          return null;
        }

        return null;
      } catch (err) {
        console.error("[TidalSearch] Manifest decode error:", err);
        return null;
      }
    },

    updateNowPlaying(track) {
      // Update the player bar with Tidal track info
      const artistName =
        track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
      const coverUrl = track.album?.cover
        ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, "/")}/160x160.jpg`
        : null;

      // Try to update the now playing display
      const trackTitle = document.querySelector(
        ".now-playing .track-title, .track-info .title",
      );
      const trackArtist = document.querySelector(
        ".now-playing .track-artist, .track-info .artist",
      );
      const albumArt = document.querySelector(
        ".now-playing .album-art img, .album-art img",
      );

      if (trackTitle) trackTitle.textContent = track.title;
      if (trackArtist) trackArtist.textContent = artistName;
      if (albumArt && coverUrl) albumArt.src = coverUrl;
    },

    async handleArtistClick(artist) {
      console.log("[TidalSearch] Navigating to artist page:", artist.name);

      // Save current scroll position
      const container = document.querySelector(".tidal-results-container");
      const scrollPosition = container?.scrollTop || 0;

      // Push current search state to navigation stack
      this.navigationStack.push({
        type: "search",
        mode: this.searchMode,
        query: document.querySelector(".tidal-search-input")?.value || "",
        results: this.currentResults,
        scrollPosition: scrollPosition
      });

      // Navigate to artist page
      this.currentView = "artist";
      this.updateBackButton();
      this.updatePanelTitle("Artist");

      // Fetch and display artist details
      await this.fetchAndRenderArtistPage(artist.id);
    },

    async fetchAndRenderArtistPage(artistId) {
      this.showLoading();

      try {
        const url = `${API_ENDPOINTS.DETAILS}/artist/?f=${artistId}`;

        const response = this.api.fetch
          ? await this.api.fetch(url)
          : await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log("[TidalSearch] Artist data:", data);

        this.renderArtistPage(data);
      } catch (err) {
        console.error("[TidalSearch] Failed to fetch artist:", err);
        this.showError(`Failed to load artist: ${err.message}`);
      }
    },

    async handleAlbumClick(albumId) {
      console.log("[TidalSearch] Navigating to album page:", albumId);

      // Save current scroll position
      const container = document.querySelector(".tidal-results-container");
      const scrollPosition = container?.scrollTop || 0;

      // Push current view state to navigation stack
      this.navigationStack.push({
        type: this.currentView,
        scrollPosition: scrollPosition,
        // Store enough data to restore the view
        data: this.currentView === "artist" ?
          document.querySelector(".tidal-results-container").innerHTML :
          null
      });

      // Navigate to album page
      this.currentView = "album";
      this.updateBackButton();
      this.updatePanelTitle("Album");

      // Fetch and display album details
      await this.fetchAndRenderAlbumPage(albumId);
    },

    async fetchAndRenderAlbumPage(albumId) {
      this.showLoading();

      try {
        const url = `${API_ENDPOINTS.DETAILS}/album/?id=${albumId}`;

        const response = this.api.fetch
          ? await this.api.fetch(url)
          : await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log("[TidalSearch] Album data:", data);

        this.renderAlbumPage(data);
      } catch (err) {
        console.error("[TidalSearch] Failed to fetch album:", err);
        this.showError(`Failed to load album: ${err.message}`);
      }
    },

    navigateBack() {
      if (this.navigationStack.length === 0) return;

      const previousView = this.navigationStack.pop();
      console.log("[TidalSearch] Navigating back to:", previousView.type);

      if (previousView.type === "search") {
        // Restore search view
        this.currentView = "search";
        this.searchMode = previousView.mode;
        this.currentResults = previousView.results;

        // Restore search input
        const input = document.querySelector(".tidal-search-input");
        if (input) input.value = previousView.query;

        // Restore results
        if (this.searchMode === "track") {
          this.renderTrackResults(previousView.results);
        } else {
          this.renderArtistResults(previousView.results);
        }

        // Restore scroll position
        setTimeout(() => {
          const container = document.querySelector(".tidal-results-container");
          if (container) container.scrollTop = previousView.scrollPosition;
        }, 0);

        this.updatePanelTitle("Tidal Search");
      } else if (previousView.type === "artist" && previousView.data) {
        // Restore artist view
        this.currentView = "artist";
        const container = document.querySelector(".tidal-results-container");
        if (container) {
          container.innerHTML = previousView.data;

          // Re-attach event listeners for album clicks
          container.querySelectorAll(".tidal-album-item").forEach((el) => {
            const albumId = el.dataset.albumId;
            if (albumId) {
              el.onclick = () => this.handleAlbumClick(albumId);
            }
          });

          // Re-attach event listeners for track play/save
          this.attachTrackEventListeners(container);
        }

        // Restore scroll position
        setTimeout(() => {
          if (container) container.scrollTop = previousView.scrollPosition;
        }, 0);

        this.updatePanelTitle("Artist");
      }

      this.updateBackButton();
    },

    updateBackButton() {
      const backBtn = document.querySelector(".tidal-back-btn");
      if (backBtn) {
        backBtn.style.display = this.navigationStack.length > 0 ? "flex" : "none";
      }
    },

    updatePanelTitle(title) {
      const titleElement = document.querySelector(".tidal-panel-title");
      if (titleElement) {
        titleElement.textContent = title;
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // ARTIST & ALBUM PAGE RENDERING
    // ═══════════════════════════════════════════════════════════════════════

    renderArtistPage(artistData) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      if (info) info.style.display = "none";

      // Based on actual API response: no data field, albums at root, tracks (not topTracks) is direct array
      const albums = artistData.albums?.items || [];
      const tracks = artistData.tracks || [];

      // Extract artist info from first album or first track
      const artist = albums[0]?.artist || tracks[0]?.artists?.[0] || {};

      // Store tracks in currentResults so they can be accessed for playback/saving
      this.currentResults = {
        data: {
          items: tracks
        }
      };

      const artistPictureUrl = artist.picture
        ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, "/")}/480x480.jpg`
        : "";

      let html = `
        <div class="tidal-artist-page">
          <div class="tidal-artist-header">
            <img class="tidal-artist-page-picture" src="${artistPictureUrl}"
                 alt="${this.escapeHtml(artist.name || "Artist")}"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 480 480%22%3E%3Ccircle fill=%22%23282828%22 cx=%22240%22 cy=%22240%22 r=%22240%22/%3E%3Ctext x=%22240%22 y=%22280%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2280%22%3E👤%3C/text%3E%3C/svg%3E'">
            <div class="tidal-artist-header-info">
              <h3>${this.escapeHtml(artist.name || "Unknown Artist")}</h3>
              <div class="tidal-artist-meta">
                ${artist.artistTypes?.join(", ") || "Artist"}
              </div>
            </div>
          </div>
      `;

      // Top Tracks section
      if (tracks.length > 0) {
        const displayTracks = this.showAllArtistTracks ? tracks : tracks.slice(0, 25);
        const hasMoreTracks = tracks.length > 25;

        html += `
          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Top Tracks</h4>
              <button class="tidal-save-all-btn" data-type="artist-tracks">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Save All ${tracks.length} Tracks
              </button>
            </div>
            <div class="tidal-track-list">
              ${displayTracks.map((track) => this.renderTrackItem(track)).join("")}
            </div>
            ${hasMoreTracks && !this.showAllArtistTracks ? `
              <button class="tidal-load-more-btn" data-type="tracks">
                Load More Tracks (${tracks.length - 25} remaining)
              </button>
            ` : ''}
          </div>
        `;
      }

      // Albums section - filter duplicates by exact title match
      if (albums.length > 0) {
        const uniqueAlbums = [];
        const seenTitles = new Set();

        for (const album of albums) {
          const title = album.title?.toLowerCase().trim();
          if (title && !seenTitles.has(title)) {
            seenTitles.add(title);
            uniqueAlbums.push(album);
          }
        }

        const displayAlbums = this.showAllArtistAlbums ? uniqueAlbums : uniqueAlbums.slice(0, 25);
        const hasMoreAlbums = uniqueAlbums.length > 25;

        html += `
          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Albums</h4>
              <span class="tidal-section-count">${uniqueAlbums.length} albums</span>
            </div>
            <div class="tidal-album-grid">
              ${displayAlbums.map((album) => this.renderAlbumGridItem(album)).join("")}
            </div>
            ${hasMoreAlbums && !this.showAllArtistAlbums ? `
              <button class="tidal-load-more-btn" data-type="albums">
                Load More Albums (${uniqueAlbums.length - 25} remaining)
              </button>
            ` : ''}
          </div>
        `;
      }

      html += `</div>`;

      container.innerHTML = html;

      // Attach event listeners
      this.attachTrackEventListeners(container);

      // Attach album click listeners
      container.querySelectorAll(".tidal-album-item").forEach((el) => {
        const albumId = el.dataset.albumId;
        if (albumId) {
          el.onclick = () => this.handleAlbumClick(albumId);
        }
      });

      // Attach save all button listener
      const saveAllBtn = container.querySelector(".tidal-save-all-btn");
      if (saveAllBtn) {
        saveAllBtn.onclick = () => {
          // Get all tracks from current artist data
          const allTracks = artistData.tracks || [];
          this.saveAllTracks(allTracks, "artist");
        };
      }

      // Store current artist data for re-rendering on load more
      this.currentArtistData = artistData;

      // Attach load more button listeners
      const loadMoreBtns = container.querySelectorAll(".tidal-load-more-btn");
      loadMoreBtns.forEach(btn => {
        const type = btn.dataset.type;
        btn.onclick = () => {
          if (type === "tracks") {
            this.showAllArtistTracks = true;
          } else if (type === "albums") {
            this.showAllArtistAlbums = true;
          }
          // Re-render the artist page
          this.renderArtistPage(artistData);
        };
      });
    },

    renderAlbumGridItem(album) {
      const coverUrl = album.cover
        ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, "/")}/160x160.jpg`
        : "";

      const releaseYear = album.releaseDate
        ? new Date(album.releaseDate).getFullYear()
        : "";

      return `
        <div class="tidal-album-item" data-album-id="${album.id}">
          <img class="tidal-album-cover" src="${coverUrl}" 
               alt="${this.escapeHtml(album.title)}"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 160%22%3E%3Crect fill=%22%23282828%22 width=%22160%22 height=%22160%22/%3E%3Ctext x=%2280%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2240%22%3E🎵%3C/text%3E%3C/svg%3E'">
          <div class="tidal-album-info">
            <div class="tidal-album-title">${this.escapeHtml(album.title)}</div>
            <div class="tidal-album-meta">
              ${releaseYear} • ${album.numberOfTracks || 0} tracks
            </div>
          </div>
        </div>
      `;
    },

    renderAlbumPage(albumData) {
      const container = document.querySelector(".tidal-results-container");
      const info = document.querySelector(".tidal-results-info");

      if (info) info.style.display = "none";

      const album = albumData.data;
      // Tracks are in data.items, wrapped as {item: trackData, type: 'track'}
      const trackItems = albumData.data?.items || [];
      const tracks = trackItems.map(t => t.item).filter(Boolean);

      console.log("[TidalSearch] Album data:", albumData);
      console.log("[TidalSearch] Tracks found:", tracks.length, tracks);

      // Store tracks in currentResults so they can be accessed for playback/saving
      this.currentResults = {
        data: {
          items: tracks
        }
      };

      const coverUrl = album.cover
        ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, "/")}/320x320.jpg`
        : "";

      const releaseYear = album.releaseDate
        ? new Date(album.releaseDate).getFullYear()
        : "";

      const artistName = album.artist?.name || album.artists?.[0]?.name || "Unknown Artist";

      let html = `
        <div class="tidal-album-page">
          <div class="tidal-album-page-header">
            <img class="tidal-album-page-cover" src="${coverUrl}"
                 alt="${this.escapeHtml(album.title)}"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 320%22%3E%3Crect fill=%22%23282828%22 width=%22320%22 height=%22320%22/%3E%3Ctext x=%22160%22 y=%22180%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2280%22%3E🎵%3C/text%3E%3C/svg%3E'">
            <div class="tidal-album-page-info">
              <h3>${this.escapeHtml(album.title)}</h3>
              <div class="tidal-album-page-artist">${this.escapeHtml(artistName)}</div>
              <div class="tidal-album-page-meta">
                ${releaseYear} • ${album.numberOfTracks || 0} tracks • ${this.formatDuration(album.duration)}
              </div>
            </div>
          </div>

          <div class="tidal-section">
            <div class="tidal-section-header">
              <h4>Tracks</h4>
              <button class="tidal-save-all-btn" data-type="album-tracks">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Save All ${tracks.length} Tracks
              </button>
            </div>
            <div class="tidal-track-list">
              ${tracks.map((track, index) => this.renderAlbumTrackItem(track, index + 1)).join("")}
            </div>
          </div>
        </div>
      `;

      container.innerHTML = html;

      // Attach event listeners
      this.attachTrackEventListeners(container);

      // Attach save all button listener
      const saveAllBtn = container.querySelector(".tidal-save-all-btn");
      if (saveAllBtn) {
        saveAllBtn.onclick = () => this.saveAllTracks(tracks, "album");
      }
    },

    renderAlbumTrackItem(track, trackNumber) {
      const duration = this.formatDuration(track.duration);
      const artistName =
        track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
      const title = track.version
        ? `${track.title} (${track.version})`
        : track.title;
      const isSaved = this.libraryTracks.has(String(track.id));
      const explicitBadge = track.explicit
        ? '<span class="tidal-explicit-badge">E</span>'
        : "";

      const heartIcon = isSaved
        ? `<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`
        : `<path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>`;

      return `
        <div class="tidal-track-item ${isSaved ? "saved" : ""}" data-id="${track.id}">
          <div class="tidal-track-number">${trackNumber}</div>
          <div class="tidal-track-info">
            <div class="tidal-track-title">${this.escapeHtml(title)} ${explicitBadge}</div>
            <div class="tidal-track-artist">${this.escapeHtml(artistName)}</div>
          </div>
          <div class="tidal-track-meta">
            <span class="tidal-track-duration">${duration}</span>
            <button class="tidal-save-btn ${isSaved ? "saved" : ""}" data-track-id="${track.id}" title="${isSaved ? "Already in library" : "Save to library"}" ${isSaved ? "disabled" : ""}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                ${heartIcon}
              </svg>
            </button>
          </div>
        </div>
      `;
    },

    attachTrackEventListeners(container) {
      // Get all track items and their data
      const trackItems = container.querySelectorAll(".tidal-track-item");
      const tracks = [];

      trackItems.forEach((el) => {
        // Find track data from currentResults or reconstruct from DOM
        const trackId = el.dataset.id;
        if (trackId) {
          tracks.push({ id: trackId, element: el });
        }
      });

      // Add click listeners for play
      trackItems.forEach((el, index) => {
        el.onclick = (e) => {
          if (e.target.closest(".tidal-save-btn")) return;

          // Find the track in current results
          const trackId = el.dataset.id;
          let track = null;

          // Try to find in current results
          if (this.currentResults?.data?.items) {
            track = this.currentResults.data.items.find((t) => String(t.id) === String(trackId));
          }

          // For artist/album pages, we need to search in the response
          // This is a simplified approach - in production you'd store the full data
          if (!track) {
            console.warn("[TidalSearch] Track data not found for playback");
            return;
          }

          this.playTrack(track, el);
        };
      });

      // Add click listeners for save buttons
      container.querySelectorAll(".tidal-save-btn").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const trackId = btn.dataset.trackId;

          // Find track data
          let track = null;
          if (this.currentResults?.data?.items) {
            track = this.currentResults.data.items.find((t) => String(t.id) === String(trackId));
          }

          if (track) {
            this.saveTrack(track, btn);
          }
        };
      });
    },

    async saveAllTracks(tracks, source) {
      if (!tracks || tracks.length === 0) {
        this.showToast("No tracks to save", true);
        return;
      }

      console.log(`[TidalSearch] Saving ${tracks.length} tracks from ${source}`);

      // Show progress bar
      const progressContainer = document.getElementById("tidal-download-progress");
      const progressBar = progressContainer?.querySelector(".tidal-download-progress-bar");
      const progressText = progressContainer?.querySelector(".tidal-download-progress-text");

      if (progressContainer) {
        progressContainer.classList.remove("hidden");
      }

      let savedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];

        // Update progress
        const progress = ((i + 1) / tracks.length) * 100;
        if (progressBar) {
          const innerBar = progressBar.querySelector(".tidal-download-progress-bar-inner") ||
            document.createElement("div");
          innerBar.className = "tidal-download-progress-bar-inner";
          innerBar.style.width = `${progress}%`;
          if (!progressBar.querySelector(".tidal-download-progress-bar-inner")) {
            progressBar.appendChild(innerBar);
          }
        }
        if (progressText) {
          progressText.textContent = `Saving ${i + 1} of ${tracks.length} tracks...`;
        }

        // Skip if already saved
        if (this.libraryTracks.has(String(track.id))) {
          console.log(`[TidalSearch] Skipping already saved track: ${track.title}`);
          savedCount++;
          continue;
        }

        try {
          const artistName =
            track.artist?.name || track.artists?.[0]?.name || "Unknown Artist";
          const title = track.title + (track.version ? ` (${track.version})` : "");
          const coverUrl = track.album?.cover
            ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, "/")}/640x640.jpg`
            : null;

          const trackData = {
            title: title,
            artist: artistName,
            album: track.album?.title || null,
            duration: track.duration || null,
            cover_url: coverUrl,
            source_type: "tidal",
            external_id: String(track.id),
            format: track.mediaMetadata?.tags?.includes("HIRES_LOSSLESS")
              ? "HI_RES_LOSSLESS"
              : track.mediaMetadata?.tags?.includes("LOSSLESS")
                ? "LOSSLESS"
                : "HIGH",
            bitrate: null,
          };

          if (this.api?.library?.addExternalTrack) {
            await this.api.library.addExternalTrack(trackData);
            this.libraryTracks.add(String(track.id));
            savedCount++;
          }
        } catch (err) {
          console.error(`[TidalSearch] Failed to save track ${track.title}:`, err);
          errorCount++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Hide progress bar
      if (progressContainer) {
        progressContainer.classList.add("hidden");
      }

      // Show result
      if (errorCount === 0) {
        this.showToast(`✓ Saved all ${savedCount} tracks to library`);
      } else {
        this.showToast(
          `Saved ${savedCount} tracks\n${errorCount} failed`,
          errorCount > savedCount / 2
        );
      }

      this.hasNewChanges = true;
      console.log(`[TidalSearch] Bulk save complete: ${savedCount} saved, ${errorCount} errors`);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════

    formatDuration(seconds) {
      if (!seconds) return "--:--";
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },

    getQualityBadge(track) {
      const tags = track.mediaMetadata?.tags || [];

      if (tags.includes("HIRES_LOSSLESS")) {
        return '<span class="tidal-quality-badge hires">Hi-Res</span>';
      } else if (tags.includes("LOSSLESS")) {
        return '<span class="tidal-quality-badge lossless">Lossless</span>';
      } else if (track.audioQuality === "HIGH") {
        return '<span class="tidal-quality-badge high">High</span>';
      }
      return "";
    },

    escapeHtml(text) {
      if (!text) return "";
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    start() {
      console.log("[TidalSearch] Plugin started");
    },

    stop() {
      console.log("[TidalSearch] Plugin stopped");
      this.close();
    },

    destroy() {
      console.log("[TidalSearch] Plugin destroyed");

      // Clean up DOM
      document.getElementById("tidal-search-styles")?.remove();
      document.getElementById("tidal-search-overlay")?.remove();
      document.getElementById("tidal-search-panel")?.remove();
      document.getElementById("tidal-search-playerbar-btn")?.remove();
      document.getElementById("tidal-toast")?.remove();
    },
  };

  // Expose API for other plugins with permission
  window.TidalSearchAPI = {
    searchCover: async (title, artist, trackId, callerPluginId) => {
      // Get permission manager from global scope
      const permissionManager = window.__PLUGIN_PERMISSION_MANAGER__;

      if (!permissionManager) {
        console.error("[TidalSearch] Permission manager not available");
        throw new Error("Permission system not initialized");
      }

      // Validate caller has permission
      try {
        await permissionManager.validateAccess(
          callerPluginId,
          "Tidal Search",
          "searchCover",
        );
      } catch (error) {
        console.error("[TidalSearch] Permission denied:", error.message);
        throw error;
      }

      // Permission granted - execute the method
      return TidalSearch.searchCoverForRPC(title, artist, trackId);
    },

    searchArtistPictureForRPC: async (artistName) => {
      return TidalSearch.searchArtistPictureForRPC(artistName);
    },
  };

  // Register plugin
  if (typeof Audion !== "undefined" && Audion.register) {
    Audion.register(TidalSearch);
    // Also expose for direct access
    window.tidalSearchPlugin = TidalSearch;
  } else {
    window.TidalSearch = TidalSearch;
    window.AudionPlugin = TidalSearch;
    window.tidalSearchPlugin = TidalSearch;
  }
})();
