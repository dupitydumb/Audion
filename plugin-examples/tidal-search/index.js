// Tidal Search Plugin
// Search and browse tracks from the Tidal catalog with full playback integration

(function () {
    // Import appSettings from Svelte store (native app settings)
    let appSettings = null;
    try {
        // Dynamically require if possible (for Tauri context)
        appSettings = window.__TAURI__ && window.appSettings ? window.appSettings : null;
    } catch (e) {
        appSettings = null;
    }
    'use strict';

    const API_BASE = 'https://katze.qqdl.site';

    // ═══════════════════════════════════════════════════════════════════════════
    // TIDAL SEARCH PLUGIN
    // ═══════════════════════════════════════════════════════════════════════════

    const TidalSearch = {
        name: 'Tidal Search',
        api: null,
        isOpen: false,
        searchMode: 'track', // 'track' or 'artist'
        searchTimeout: null,
        currentResults: [],
        isPlaying: null, // Currently playing Tidal track ID
        downloadPath: null, // Custom download path
        showSettings: false, // Settings panel visibility

        init(api) {
            console.log('[TidalSearch] Initializing...');
            this.api = api;

            // Load saved download path from settings
            this.loadDownloadPath();
            // Try to restore any persisted directory handle (non-blocking)
            if (typeof indexedDB !== 'undefined') {
                this.restoreDirectoryHandle().catch(() => { });
            }

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
                api.stream.registerResolver('tidal', async (externalId, options) => {
                    console.log('[TidalSearch] Resolving stream for track ID:', externalId);
                    try {
                        const quality = options?.quality || 'LOSSLESS';
                        let streamData = await this.fetchStream(externalId, quality);

                        // Handle MPD fallback
                        if (streamData?.data?.manifestMimeType === 'application/dash+xml') {
                            streamData = await this.fetchStream(externalId, 'LOSSLESS');
                            if (streamData?.data?.manifestMimeType === 'application/dash+xml') {
                                streamData = await this.fetchStream(externalId, 'HIGH');
                            }
                        }

                        const streamUrl = this.decodeManifest(streamData.data);
                        return streamUrl;
                    } catch (err) {
                        console.error('[TidalSearch] Failed to resolve stream:', err);
                        return null;
                    }
                });
                console.log('[TidalSearch] Registered stream resolver for tidal');
            }

            console.log('[TidalSearch] Plugin ready!');
        },

        // Load saved download path from settings or localStorage
        loadDownloadPath() {
            try {
                // Try to get from plugin API settings
                if (this.api && this.api.settings && typeof this.api.settings.getDownloadLocation === 'function') {
                    this.downloadPath = this.api.settings.getDownloadLocation();
                    console.log('[TidalSearch] Loaded download path from API:', this.downloadPath);
                    return;
                }

                // Fallback to localStorage
                const stored = localStorage.getItem('audion_settings');
                if (stored) {
                    const settings = JSON.parse(stored);
                    if (settings.downloadLocation) {
                        this.downloadPath = settings.downloadLocation;
                        console.log('[TidalSearch] Loaded download path from localStorage:', this.downloadPath);
                        return;
                    }
                }

                // No saved path found
                this.downloadPath = null;
                console.log('[TidalSearch] No saved download path, will use browser downloads');
            } catch (err) {
                console.warn('[TidalSearch] Could not load download path:', err);
                this.downloadPath = null;
            }
        },

        // Get download path from native app settings (Tauri)
        getDownloadPath() {
            // Try to use Svelte appSettings store if available
            try {
                if (window.appSettings && typeof window.appSettings.getDownloadLocation === 'function') {
                    const path = window.appSettings.getDownloadLocation();
                    if (path && path.trim() !== "") return path;
                }
            } catch (err) {
                console.warn('[TidalSearch] Could not read native app settings:', err);
            }
            // Fallback to Music folder
            if (window && window.navigator && window.navigator.userAgent.includes('Windows')) {
                return `${window.process?.env?.USERPROFILE || ''}/Music`;
            } else if (window && window.navigator && window.navigator.userAgent.includes('Mac')) {
                return `${window.process?.env?.HOME || ''}/Music`;
            } else {
                return `${window.process?.env?.HOME || ''}/Music`;
            }
        },

        // Persist and restore directory handles using IndexedDB so user selection
        // survives across reloads (where supported).
        async _idbOpen() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open('tidal-search-store', 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore('state');
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        },

        async _idbPut(key, value) {
            const db = await this._idbOpen();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readwrite');
                tx.objectStore('state').put(value, key);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error); };
            });
        },

        async _idbGet(key) {
            const db = await this._idbOpen();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('state', 'readonly');
                const req = tx.objectStore('state').get(key);
                req.onsuccess = () => { db.close(); resolve(req.result); };
                req.onerror = () => { db.close(); reject(req.error); };
            });
        },

        async persistDirectoryHandle(handle) {
            try {
                if (!handle) return;
                await this._idbPut('directoryHandle', handle);
                console.log('[TidalSearch] Persisted directory handle');
            } catch (err) {
                console.warn('[TidalSearch] Could not persist directory handle:', err);
            }
        },

        async restoreDirectoryHandle() {
            try {
                const handle = await this._idbGet('directoryHandle');
                if (handle) {
                    this.directoryHandle = handle;
                    // Only query permission here — requesting permission requires a user gesture
                    if (typeof handle.queryPermission === 'function') {
                        const perm = await handle.queryPermission({ mode: 'readwrite' });
                        if (perm === 'granted') {
                            console.log('[TidalSearch] Restored directory handle with permission');
                            return true;
                        } else {
                            console.log('[TidalSearch] Restored directory handle but no write permission:', perm);
                            return false;
                        }
                    }

                    // If permission APIs are not available, assume handle is usable
                    return true;
                }
            } catch (err) {
                console.warn('[TidalSearch] Could not restore directory handle:', err);
            }
            return false;
        },

        // ═══════════════════════════════════════════════════════════════════════
        // STYLES
        // ═══════════════════════════════════════════════════════════════════════

        injectStyles() {
            if (document.getElementById('tidal-search-styles')) return;

            const style = document.createElement('style');
            style.id = 'tidal-search-styles';
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

                /* Settings */
                .tidal-settings-btn {
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
                    margin-right: 8px;
                }

                .tidal-settings-btn:hover {
                    color: var(--text-primary, #fff);
                    transform: rotate(45deg);
                }

                .tidal-settings-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background: var(--bg-surface, #282828);
                    border-radius: 8px;
                    margin-bottom: 12px;
                }

                .tidal-settings-row.hidden {
                    display: none;
                }

                .tidal-settings-label {
                    font-size: 12px;
                    color: var(--text-secondary, #b3b3b3);
                    white-space: nowrap;
                }

                .tidal-path-input {
                    flex: 1;
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: 1px solid var(--border-color, #404040);
                    background: var(--bg-base, #121212);
                    color: var(--text-primary, #fff);
                    font-size: 12px;
                    min-width: 0;
                }

                .tidal-path-input:disabled {
                    opacity: 0.7;
                }

                .tidal-browse-btn {
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: none;
                    background: var(--accent-primary, #1DB954);
                    color: #fff;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                }

                .tidal-browse-btn:hover {
                    background: var(--accent-hover, #1ed760);
                }
            `;
            document.head.appendChild(style);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // UI CREATION
        // ═══════════════════════════════════════════════════════════════════════

        createSearchPanel() {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.id = 'tidal-search-overlay';
            overlay.onclick = () => this.close();
            document.body.appendChild(overlay);

            // Create download progress bar
            const progressBar = document.createElement('div');
            progressBar.id = 'tidal-download-progress';
            progressBar.className = 'tidal-download-progress hidden';
            progressBar.innerHTML = `
                <div class="tidal-download-progress-bar" style="width:100%;background:var(--bg-highlight, #3e3e3e);"></div>
                <div class="tidal-download-progress-text"></div>
            `;
            document.body.appendChild(progressBar);

            // Create panel
            const panel = document.createElement('div');
            panel.id = 'tidal-search-panel';
            panel.innerHTML = `
                <div class="tidal-search-header">
                    <h2>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
                            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" fill="none"/>
                        </svg>
                        Tidal Search
                        <span class="tidal-badge">TIDAL</span>
                    </h2>
                    <button class="tidal-settings-btn" title="Settings">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                        </svg>
                    </button>
                    <button class="tidal-close-btn" title="Close">✕</button>
                </div>
                <div class="tidal-settings-row hidden" id="tidal-settings-row">
                    <span class="tidal-settings-label">📁 Save to:</span>
                    <input type="text" class="tidal-path-input" id="tidal-download-path" placeholder="Leave empty for browser downloads">
                    <button class="tidal-browse-btn" id="tidal-browse-btn">Browse</button>
                    <div id="tidal-api-warning" class="tidal-api-warning" style="display:none;margin-top:8px;font-size:12px;color:var(--text-subdued);">
                        Host integration not available — the host cannot write files directly. Click the button to pick a folder the browser can save to, or run the plugin inside the desktop app for full integration.
                    </div>
                </div>
                <div class="tidal-search-controls">
                    <input type="text" class="tidal-search-input" placeholder="Search for tracks or artists..." autofocus>
                    <div class="tidal-mode-toggle">
                        <button class="tidal-mode-btn active" data-mode="track">Tracks</button>
                        <button class="tidal-mode-btn" data-mode="artist">Artists</button>
                    </div>
                </div>
                <div class="tidal-results-info" style="display: none;">
                    <span class="tidal-results-count"></span>
                    <div class="tidal-quality-selector">
                        <label>Quality:</label>
                        <select id="tidal-quality">
                            <option value="HI_RES_LOSSLESS">Hi-Res (24-bit)</option>
                            <option value="LOSSLESS" selected>Lossless (16-bit)</option>
                            <option value="HIGH">High (320kbps)</option>
                            <option value="LOW">Low (96kbps)</option>
                        </select>
                    </div>
                </div>
                <div class="tidal-results-container">
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">🔍</div>
                        <div>Search for tracks on Tidal</div>
                        <div style="font-size: 12px; margin-top: 8px; color: var(--text-subdued);">Click any track to play it</div>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);

            // Event listeners
            panel.querySelector('.tidal-close-btn').onclick = () => this.close();
            panel.querySelector('.tidal-settings-btn').onclick = () => this.toggleSettings();
            panel.querySelector('#tidal-browse-btn').onclick = () => this.browseForFolder();

            // Show API warning when host integration is unavailable
            const apiWarningEl = panel.querySelector('#tidal-api-warning');
            if (apiWarningEl) {
                if (!this.api || !this.api.library || typeof this.api.library.downloadTrack !== 'function') {
                    apiWarningEl.style.display = 'block';
                } else {
                    apiWarningEl.style.display = 'none';
                }
            }

            // Update path input with saved value or computed default
            const pathInput = panel.querySelector('#tidal-download-path');
            if (this.downloadPath) {
                pathInput.value = this.downloadPath;
                console.log('[TidalSearch] Set path input to:', this.downloadPath);
            } else {
                const defaultPath = this.getDownloadPath() || '';
                pathInput.value = defaultPath;
                console.log('[TidalSearch] No download path set, using default:', defaultPath);
            }
            // Save path on blur/change
            pathInput.addEventListener('blur', (e) => this.handlePathChange(e.target.value));
            pathInput.addEventListener('change', (e) => this.handlePathChange(e.target.value));

            const input = panel.querySelector('.tidal-search-input');
            input.addEventListener('input', (e) => this.handleSearch(e.target.value));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.close();
            });

            panel.querySelectorAll('.tidal-mode-btn').forEach(btn => {
                btn.onclick = (e) => this.setSearchMode(e.target.dataset.mode);
            });

            // Prevent panel close when clicking inside
            panel.onclick = (e) => e.stopPropagation();
        },

        handlePathChange(path) {
            if (path !== this.downloadPath) {
                this.downloadPath = path || null;
                // Prefer using plugin API to update global app setting, fallback to localStorage
                try {
                    if (this.api && this.api.settings && typeof this.api.settings.setDownloadLocation === 'function') {
                        this.api.settings.setDownloadLocation(path || null);
                    } else {
                        let settings = {};
                        const stored = localStorage.getItem('audion_settings');
                        if (stored) settings = JSON.parse(stored);
                        settings.downloadLocation = path || null;
                        localStorage.setItem('audion_settings', JSON.stringify(settings));
                    }
                } catch (err) {
                    console.warn('[TidalSearch] Could not save download path:', err);
                }
                if (path) {
                    this.showToast(`✓ Download path saved`);
                }
            }
        },

        toggleSettings() {
            this.showSettings = !this.showSettings;
            const row = document.getElementById('tidal-settings-row');
            if (row) {
                row.classList.toggle('hidden', !this.showSettings);
            }
        },

        async browseForFolder() {
            // Since Tauri's dialog plugin requires ES module import which isn't available in plugins,
            // Prefer native directory picker when available (must be triggered by user click).
            try {
                if (typeof window.showDirectoryPicker === 'function') {
                    // This call is a direct user gesture (browse button click) so should be allowed.
                    const dirHandle = await window.showDirectoryPicker();
                    this.directoryHandle = dirHandle;
                    // Persist handle so it can be reused across restarts
                    try {
                        await this.persistDirectoryHandle(dirHandle);
                    } catch (err) {
                        console.warn('[TidalSearch] Could not persist directory handle:', err);
                    }

                    // Try to derive a display path from the handle name for UI only
                    const displayPath = dirHandle.name || '';
                    this.downloadPath = displayPath || this.downloadPath;

                    const pathInput = document.getElementById('tidal-download-path');
                    if (pathInput) pathInput.value = this.downloadPath || '';

                    // Persist selection via plugin API where possible (store the path string)
                    try {
                        if (this.api && this.api.settings && typeof this.api.settings.setDownloadLocation === 'function') {
                            this.api.settings.setDownloadLocation(this.downloadPath || null);
                        } else {
                            let settings = {};
                            const stored = localStorage.getItem('audion_settings');
                            if (stored) settings = JSON.parse(stored);
                            settings.downloadLocation = this.downloadPath || null;
                            localStorage.setItem('audion_settings', JSON.stringify(settings));
                        }
                    } catch (err) {
                        console.warn('[TidalSearch] Could not save download path:', err);
                    }

                    this.showToast(`✓ Download folder selected`);
                    return;
                }
            } catch (err) {
                console.warn('[TidalSearch] Directory picker failed:', err);
            }

            // Fallback to text prompt when directory picker is unavailable
            const currentPath = this.downloadPath || '';
            const newPath = prompt(
                'Enter download folder path:\n\nExample:\nC:\\Users\\YourName\\Music\\Tidal\n/home/user/Music/Tidal',
                currentPath
            );

            if (newPath !== null && newPath !== currentPath) {
                this.downloadPath = newPath || null;
                const pathInput = document.getElementById('tidal-download-path');
                if (pathInput) {
                    pathInput.value = newPath;
                }
                // Persist via plugin API where possible
                try {
                    if (this.api && this.api.settings && typeof this.api.settings.setDownloadLocation === 'function') {
                        this.api.settings.setDownloadLocation(newPath || null);
                    } else {
                        let settings = {};
                        const stored = localStorage.getItem('audion_settings');
                        if (stored) settings = JSON.parse(stored);
                        settings.downloadLocation = newPath || null;
                        localStorage.setItem('audion_settings', JSON.stringify(settings));
                    }
                } catch (err) {
                    console.warn('[TidalSearch] Could not save download path:', err);
                }
                if (newPath) {
                    this.showToast(`✓ Download path set:\n${newPath}`);
                } else {
                    this.showToast('Using browser downloads folder');
                }
            }
        },

        createPlayerBarButton() {
            if (document.getElementById('tidal-search-playerbar-btn')) return;

            const volumeControls = document.querySelector('.volume-controls');
            if (!volumeControls) return;

            const btn = document.createElement('button');
            btn.id = 'tidal-search-playerbar-btn';
            btn.className = 'tidal-search-btn icon-btn';
            btn.title = 'Tidal Search';
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                </svg>
            `;
            btn.onclick = () => this.toggle();

            volumeControls.insertBefore(btn, volumeControls.firstChild);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // TOAST NOTIFICATIONS
        // ═══════════════════════════════════════════════════════════════════════

        showToast(message, isError = false) {
            const toast = document.getElementById('tidal-toast');
            if (!toast) return;

            toast.textContent = message;
            toast.className = 'tidal-toast show' + (isError ? ' error' : '');

            setTimeout(() => {
                toast.classList.remove('show');
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
            document.getElementById('tidal-search-overlay')?.classList.add('open');
            document.getElementById('tidal-search-panel')?.classList.add('open');
            document.getElementById('tidal-search-playerbar-btn')?.classList.add('active');

            // Focus input
            setTimeout(() => {
                document.querySelector('.tidal-search-input')?.focus();
            }, 100);
        },

        close() {
            this.isOpen = false;
            document.getElementById('tidal-search-overlay')?.classList.remove('open');
            document.getElementById('tidal-search-panel')?.classList.remove('open');
            document.getElementById('tidal-search-playerbar-btn')?.classList.remove('active');
        },

        // ═══════════════════════════════════════════════════════════════════════
        // SEARCH FUNCTIONALITY
        // ═══════════════════════════════════════════════════════════════════════

        setSearchMode(mode) {
            this.searchMode = mode;

            document.querySelectorAll('.tidal-mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });

            // Re-run search with new mode
            const query = document.querySelector('.tidal-search-input')?.value;
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
                const param = this.searchMode === 'track' ? 's' : 'a';
                const response = await fetch(`${API_BASE}/search/?${param}=${encodeURIComponent(query)}`);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                this.currentResults = data;

                if (this.searchMode === 'track') {
                    this.renderTrackResults(data);
                } else {
                    this.renderArtistResults(data);
                }
            } catch (err) {
                console.error('[TidalSearch] Search error:', err);
                this.showError(err.message);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // RENDERING
        // ═══════════════════════════════════════════════════════════════════════

        showLoading() {
            const container = document.querySelector('.tidal-results-container');
            const info = document.querySelector('.tidal-results-info');
            if (container) {
                container.innerHTML = `
                    <div class="tidal-loading">
                        <div class="tidal-spinner"></div>
                        <div>Searching Tidal...</div>
                    </div>
                `;
            }
            if (info) info.style.display = 'none';
        },

        showEmpty() {
            const container = document.querySelector('.tidal-results-container');
            const info = document.querySelector('.tidal-results-info');
            if (container) {
                container.innerHTML = `
                    <div class="tidal-empty">
                        <div class="tidal-empty-icon">🔍</div>
                        <div>Search for tracks on Tidal</div>
                        <div style="font-size: 12px; margin-top: 8px; color: var(--text-subdued);">Click any track to play it</div>
                    </div>
                `;
            }
            if (info) info.style.display = 'none';
        },

        showError(message) {
            const container = document.querySelector('.tidal-results-container');
            const info = document.querySelector('.tidal-results-info');
            if (container) {
                container.innerHTML = `
                    <div class="tidal-error">
                        <div>⚠️ Failed to search: ${message}</div>
                        <div style="font-size: 12px; margin-top: 8px;">Please check your connection and try again</div>
                    </div>
                `;
            }
            if (info) info.style.display = 'none';
        },

        renderTrackResults(data) {
            const container = document.querySelector('.tidal-results-container');
            const info = document.querySelector('.tidal-results-info');

            const items = data?.data?.items || [];
            const total = data?.data?.totalNumberOfItems || 0;

            if (info) {
                info.querySelector('.tidal-results-count').textContent =
                    `Found ${total.toLocaleString()} tracks (showing ${items.length})`;
                info.style.display = 'flex';
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

            container.innerHTML = items.map(track => this.renderTrackItem(track)).join('');

            // Add click handlers for play
            container.querySelectorAll('.tidal-track-item').forEach((el, index) => {
                el.onclick = (e) => {
                    // Don't trigger if clicking on save button or link
                    if (e.target.closest('.tidal-save-btn') || e.target.tagName === 'A') return;
                    this.playTrack(items[index], el);
                };
            });

            // Add click handlers for save buttons
            container.querySelectorAll('.tidal-save-btn').forEach((btn, index) => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.saveTrack(items[index], btn);
                };
            });
        },

        renderTrackItem(track) {
            const coverUrl = track.album?.cover
                ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, '/')}/160x160.jpg`
                : '';

            const duration = this.formatDuration(track.duration);
            const qualityBadge = this.getQualityBadge(track);
            const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';
            const title = track.version ? `${track.title} (${track.version})` : track.title;
            const isPlaying = this.isPlaying === track.id;
            const explicitBadge = track.explicit ? '<span class="tidal-explicit-badge">E</span>' : '';

            return `
                <div class="tidal-track-item ${isPlaying ? 'playing' : ''}" data-id="${track.id}">
                    <div class="tidal-track-cover-wrapper">
                        <img class="tidal-track-cover" src="${coverUrl}" alt="${this.escapeHtml(track.title)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect fill=%22%23282828%22 width=%2248%22 height=%2248%22/><text x=%2224%22 y=%2230%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2220%22>🎵</text></svg>'">
                        <div class="tidal-play-overlay">
                            <span class="tidal-play-icon">▶</span>
                        </div>
                    </div>
                    <div class="tidal-track-info">
                        <div class="tidal-track-title">${this.escapeHtml(title)} ${explicitBadge}</div>
                        <div class="tidal-track-artist">
                            ${this.escapeHtml(artistName)} • ${this.escapeHtml(track.album?.title || '')}
                        </div>
                    </div>
                    <div class="tidal-track-meta">
                        ${qualityBadge}
                        <span class="tidal-track-duration">${duration}</span>
                        <button class="tidal-save-btn" data-track-id="${track.id}" title="Save to library">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        },

        renderArtistResults(data) {
            const container = document.querySelector('.tidal-results-container');
            const info = document.querySelector('.tidal-results-info');

            const artists = data?.data?.artists?.items || [];
            const total = data?.data?.artists?.totalNumberOfItems || 0;

            if (info) {
                info.querySelector('.tidal-results-count').textContent =
                    `Found ${total.toLocaleString()} artists (showing ${artists.length})`;
                info.style.display = 'flex';
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

            container.innerHTML = artists.map(artist => this.renderArtistItem(artist)).join('');

            // Add click handlers
            container.querySelectorAll('.tidal-artist-item').forEach((el, index) => {
                el.onclick = () => this.handleArtistClick(artists[index]);
            });
        },

        renderArtistItem(artist) {
            const pictureUrl = artist.picture
                ? `https://resources.tidal.com/images/${artist.picture.replace(/-/g, '/')}/160x160.jpg`
                : '';

            const types = artist.artistTypes?.join(', ') || 'Artist';

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
            console.log('[TidalSearch] Playing track:', track.title);

            // Show loading state
            if (element) {
                element.classList.add('loading');
            }

            try {
                // Get selected quality
                let quality = document.getElementById('tidal-quality')?.value || 'LOSSLESS';

                // Fetch stream
                let streamData = await this.fetchStream(track.id, quality);

                // Check if it's MPD (DASH) format - native audio can't play this
                if (streamData?.data?.manifestMimeType === 'application/dash+xml') {
                    console.log('[TidalSearch] MPD detected, falling back to LOSSLESS');
                    this.showToast('Hi-Res uses DASH, trying Lossless...');

                    // Try LOSSLESS instead
                    if (quality === 'HI_RES_LOSSLESS') {
                        quality = 'LOSSLESS';
                        streamData = await this.fetchStream(track.id, quality);
                    }

                    // If still MPD, try HIGH
                    if (streamData?.data?.manifestMimeType === 'application/dash+xml') {
                        quality = 'HIGH';
                        streamData = await this.fetchStream(track.id, quality);
                    }
                }

                if (!streamData?.data?.manifest) {
                    throw new Error('No manifest in response');
                }

                // Decode manifest to get stream URL
                const streamUrl = this.decodeManifest(streamData.data);

                if (!streamUrl) {
                    throw new Error('Could not extract stream URL');
                }

                console.log('[TidalSearch] Stream URL:', streamUrl);

                // Get the audio element and play
                const audioElement = document.querySelector('audio');
                if (audioElement) {
                    // Update current playing track
                    this.isPlaying = track.id;

                    // Create Audion-compatible track object
                    const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';
                    const coverUrl = track.album?.cover
                        ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, '/')}/320x320.jpg`
                        : null;

                    const audionTrack = {
                        id: track.id,
                        path: streamUrl,              // Use stream URL as path
                        title: track.title + (track.version ? ` (${track.version})` : ''),
                        artist: artistName,
                        album: track.album?.title || null,
                        duration: track.duration || null,
                        cover_url: coverUrl,          // For Tidal album art
                        tidal_id: track.id,           // Keep original Tidal ID
                        format: streamData?.data?.audioQuality || 'LOSSLESS',
                        bitrate: streamData?.data?.sampleRate || null
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
                        if (playErr.name !== 'AbortError') {
                            throw playErr;
                        }
                    }

                    // Show toast notification
                    this.showToast(`▶ ${audionTrack.title} - ${artistName}`);

                    // Update track items to show playing state
                    document.querySelectorAll('.tidal-track-item').forEach(el => {
                        el.classList.toggle('playing', parseInt(el.dataset.id) === track.id);
                    });
                } else {
                    throw new Error('Audio element not found');
                }
            } catch (err) {
                console.error('[TidalSearch] Playback error:', err);
                this.showToast(`Error: ${err.message}`, true);
            } finally {
                if (element) {
                    element.classList.remove('loading');
                }
            }
        },

        async fetchStream(trackId, quality) {
            const response = await fetch(`${API_BASE}/track/?id=${trackId}&quality=${quality}`);
            if (!response.ok) {
                throw new Error(`Failed to get stream: HTTP ${response.status}`);
            }
            return await response.json();
        },

        // Complete saveTrack method - saves static data only, URL is resolved on play

        async saveTrack(track, button) {
            console.log('[TidalSearch] Adding track to library:', track.title);

            // Show saving state
            button.classList.add('saving');

            try {
                // Get quality selection for format info
                const quality = document.getElementById('tidal-quality')?.value || 'LOSSLESS';

                // Get track metadata
                const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';
                const title = track.title + (track.version ? ` (${track.version})` : '');
                const coverUrl = track.album?.cover
                    ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, '/')}/640x640.jpg`
                    : null;

                // Check if API is available
                if (this.api?.library?.addExternalTrack) {
                    console.log('[TidalSearch] Saving static metadata (URL resolved on play)');

                    // Add track to database with static metadata only
                    // Path will be "tidal://{id}" - stream URL fetched fresh on play
                    const trackData = {
                        title: title,
                        artist: artistName,
                        album: track.album?.title || null,
                        duration: track.duration || null,
                        cover_url: coverUrl,
                        source_type: 'tidal',
                        external_id: String(track.id),  // Used to fetch stream on play
                        format: (track.mediaMetadata?.tags?.includes('HIRES_LOSSLESS')) ? 'HI_RES_LOSSLESS' :
                            (track.mediaMetadata?.tags?.includes('LOSSLESS')) ? 'LOSSLESS' :
                                quality, // Fallback to selected quality
                        bitrate: null
                        // No stream_url - resolved on play for freshness
                    };

                    await this.api.library.addExternalTrack(trackData);

                    // Mark as saved
                    button.classList.remove('saving');
                    button.classList.add('saved');

                    this.showToast(`✓ Added to library: ${title}`);
                    console.log('[TidalSearch] Track saved:', trackData);

                } else {
                    throw new Error('Library API not available');
                }

            } catch (err) {
                console.error('[TidalSearch] Save error:', err);
                button.classList.remove('saving');
                this.showToast(`Error: ${err.message}`, true);
            }
        },

        arrayBufferToBase64(buffer) {
            // For large files, process in chunks to avoid stack overflow
            const bytes = new Uint8Array(buffer);
            const chunkSize = 8192;
            let binary = '';

            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                binary += String.fromCharCode.apply(null, chunk);
            }

            return btoa(binary);
        },

        formatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        },

        downloadViaBrowser(blob, filename) {
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
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

                if (manifestMimeType === 'application/vnd.tidal.bts') {
                    // JSON manifest for FLAC/AAC
                    const manifest = JSON.parse(manifestStr);
                    console.log('[TidalSearch] Decoded BTS manifest:', manifest);

                    if (manifest.urls && manifest.urls.length > 0) {
                        return manifest.urls[0];
                    }
                } else if (manifestMimeType === 'application/dash+xml') {
                    // MPD manifest for Hi-Res - can't play directly
                    console.warn('[TidalSearch] MPD manifest not supported by native audio');
                    return null;
                }

                return null;
            } catch (err) {
                console.error('[TidalSearch] Manifest decode error:', err);
                return null;
            }
        },

        updateNowPlaying(track) {
            // Update the player bar with Tidal track info
            const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';
            const coverUrl = track.album?.cover
                ? `https://resources.tidal.com/images/${track.album.cover.replace(/-/g, '/')}/160x160.jpg`
                : null;

            // Try to update the now playing display
            const trackTitle = document.querySelector('.now-playing .track-title, .track-info .title');
            const trackArtist = document.querySelector('.now-playing .track-artist, .track-info .artist');
            const albumArt = document.querySelector('.now-playing .album-art img, .album-art img');

            if (trackTitle) trackTitle.textContent = track.title;
            if (trackArtist) trackArtist.textContent = artistName;
            if (albumArt && coverUrl) albumArt.src = coverUrl;
        },

        handleArtistClick(artist) {
            console.log('[TidalSearch] Artist clicked:', artist.name);
            // Search for tracks by this artist
            const input = document.querySelector('.tidal-search-input');
            if (input) {
                input.value = artist.name;
                this.setSearchMode('track');
                this.handleSearch(artist.name);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        // UTILITIES
        // ═══════════════════════════════════════════════════════════════════════

        formatDuration(seconds) {
            if (!seconds) return '--:--';
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        },

        getQualityBadge(track) {
            const tags = track.mediaMetadata?.tags || [];

            if (tags.includes('HIRES_LOSSLESS')) {
                return '<span class="tidal-quality-badge hires">Hi-Res</span>';
            } else if (tags.includes('LOSSLESS')) {
                return '<span class="tidal-quality-badge lossless">Lossless</span>';
            } else if (track.audioQuality === 'HIGH') {
                return '<span class="tidal-quality-badge high">High</span>';
            }
            return '';
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        // ═══════════════════════════════════════════════════════════════════════
        // LIFECYCLE
        // ═══════════════════════════════════════════════════════════════════════

        start() {
            console.log('[TidalSearch] Plugin started');
        },

        stop() {
            console.log('[TidalSearch] Plugin stopped');
            this.close();
        },

        destroy() {
            console.log('[TidalSearch] Plugin destroyed');

            // Clean up DOM
            document.getElementById('tidal-search-styles')?.remove();
            document.getElementById('tidal-search-overlay')?.remove();
            document.getElementById('tidal-search-panel')?.remove();
            document.getElementById('tidal-search-playerbar-btn')?.remove();
            document.getElementById('tidal-toast')?.remove();
        }
    };

    // Register plugin globally
    window.TidalSearch = TidalSearch;
    window.AudionPlugin = TidalSearch;
})();
