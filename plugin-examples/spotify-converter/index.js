(function () {
    // ═══════════════════════════════════════════════════════════════════════════
    // SPOTIFY CONVERTER PLUGIN - API VERSION
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // PLUGIN LOGIC
    // ═══════════════════════════════════════════════════════════════════════════

    const SpotifyConverter = {
        name: 'Spotify Converter',
        api: null,

        isOpen: false,
        isConverting: false,
        stopConversion: false,
        importedPlaylistData: null,

        // API endpoints - Multiple endpoints for load distribution
        TIDAL_SEARCH_ENDPOINTS: [
            'https://hund.qqdl.site',
            'https://katze.qqdl.site',
            'https://tidal.kinoplus.online',
            'https://maus.qqdl.site',
            'https://arran.monochrome.tf'
        ],
        NEW_SPOTIFY_API_BASE: 'https://playlist.audionplayer.com/api/playlist',
        DELAY_PER_TRACK_MS: 150, // Delay between track processing to avoid rate limits

        // Helper function to get a random search endpoint
        getRandomSearchEndpoint() {
            const endpoints = this.TIDAL_SEARCH_ENDPOINTS;
            return endpoints[Math.floor(Math.random() * endpoints.length)];
        },

        async init(api) {
            console.log('[SpotifyConverter] Initializing...');
            this.api = api;

            this.injectStyles();
            this.createModal();
            this.createMenuButton();

            console.log('[SpotifyConverter] Ready');
        },

        injectStyles() {
            if (document.getElementById('spotify-converter-styles')) return;

            const style = document.createElement('style');
            style.id = 'spotify-converter-styles';
            style.textContent = `
                #spotify-converter-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) scale(0.9);
                    background: var(--bg-elevated, #181818);
                    border: 1px solid var(--border-color, #404040);
                    border-radius: 16px;
                    padding: 24px;
                    width: 500px;
                    max-width: 90vw;
                    z-index: 10001;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                #spotify-converter-modal.open {
                    opacity: 1;
                    visibility: visible;
                    transform: translate(-50%, -50%) scale(1);
                }

                #spotify-converter-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    z-index: 10000;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.3s ease;
                }

                #spotify-converter-overlay.open {
                    opacity: 1;
                    visibility: visible;
                }

                .sc-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sc-header h2 {
                    margin: 0;
                    color: var(--text-primary, #fff);
                    font-size: 20px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .sc-icon {
                    color: #1DB954;
                }

                .sc-close-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary, #b3b3b3);
                    font-size: 20px;
                    cursor: pointer;
                    padding: 4px;
                }
                .sc-close-btn:hover { color: #fff; }

                .sc-input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .sc-row {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                }
                
                .sc-input-wrapper {
                    flex-grow: 1;
                    position: relative;
                }

                .sc-clear-file {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: #555;
                    border: none;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    color: white;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    z-index: 2;
                }
                
                .sc-details {
                    font-size: 12px;
                    color: #888;
                    margin-top: -4px;
                }

                .sc-input {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    color: var(--text-primary, #fff);
                    padding: 12px;
                    padding-right: 35px;
                    border-radius: 8px;
                    font-size: 14px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .sc-input:focus {
                    outline: none;
                    border-color: #1DB954;
                }

                .sc-btn {
                    background: #1DB954;
                    color: #fff;
                    border: none;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.1s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    white-space: nowrap;
                }
                .sc-btn:hover:not(:disabled) { transform: scale(1.02); filter: brightness(1.1); }
                .sc-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .sc-btn.secondary { 
                    background: #282828;
                    color: #fff;
                    border: 1px solid #555;
                }
                .sc-btn.secondary:hover {
                    background: #333;
                    border-color: #fff;
                }

                #sc-file-input { display: none; }

                .sc-file-info {
                    font-size: 12px;
                    color: #1DB954;
                    margin-top: 4px;
                    display: none;
                }
                .sc-btn.help { 
                    background: transparent; 
                    border: 1px solid var(--border-color, #404040); 
                    color: var(--text-secondary, #b3b3b3);
                    padding: 8px 12px;
                    font-size: 12px;
                }
                .sc-btn.help:hover {
                    border-color: #1DB954;
                    color: #1DB954;
                }

                .sc-help-box {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                    font-size: 13px;
                    color: var(--text-secondary, #b3b3b3);
                    display: none;
                }
                .sc-help-box.visible { display: block; }
                .sc-help-box a { color: #1DB954; text-decoration: none; }
                .sc-help-box ul { margin: 8px 0; padding-left: 20px; }
                .sc-help-box li { margin-bottom: 4px; }

                .sc-log {
                    background: #000;
                    border-radius: 8px;
                    padding: 12px;
                    height: 150px;
                    overflow-y: auto;
                    font-family: monospace;
                    font-size: 12px;
                    color: #bbb;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .sc-log-item.success { color: #1DB954; }
                .sc-log-item.error { color: #ff5555; }
                .sc-log-item.warn { color: #ffb86c; }

                .sc-progress-bar {
                    height: 6px;
                    background: var(--bg-highlight, #3e3e3e);
                    border-radius: 3px;
                    overflow: hidden;
                }
                .sc-progress-value {
                    height: 100%;
                    background: #1DB954;
                    width: 0%;
                    transition: width 0.3s;
                }

                /* ═══ Mobile Responsive ═══ */
                @media (max-width: 768px) {
                    #spotify-converter-modal {
                        width: 100vw;
                        height: 100vh;
                        max-width: 100vw;
                        max-height: 100vh;
                        top: 0; left: 0;
                        transform: none;
                        border-radius: 0;
                        border: none;
                        padding: 16px;
                        gap: 14px;
                        justify-content: flex-start;
                    }
                    #spotify-converter-modal.open {
                        transform: none;
                    }

                    .sc-header h2 {
                        font-size: 18px;
                    }
                    .sc-close-btn {
                        min-width: 44px;
                        min-height: 44px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        -webkit-tap-highlight-color: transparent;
                    }

                    .sc-input {
                        font-size: 16px; /* prevent iOS zoom */
                        padding: 14px 12px;
                    }

                    .sc-btn {
                        min-height: 48px;
                        font-size: 15px;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .sc-btn.help {
                        min-height: 44px;
                        font-size: 13px;
                    }

                    .sc-log {
                        height: 120px;
                        font-size: 11px;
                    }

                    .sc-help-box {
                        font-size: 12px;
                        padding: 12px;
                    }
                }
            `;
            document.head.appendChild(style);
        },

        createModal() {
            const overlay = document.createElement('div');
            overlay.id = 'spotify-converter-overlay';
            overlay.onclick = () => { if (!this.isConverting) this.close(); };
            document.body.appendChild(overlay);

            const modal = document.createElement('div');
            modal.id = 'spotify-converter-modal';
            modal.innerHTML = `
                <div class="sc-header">
                    <h2>
                        <svg class="sc-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 4.32-1.38 9.841-.719 13.44 1.56.42.3.6.84.3 1.26zm.12-3.36C14.939 8.46 8.641 8.28 5.1 9.421c-.6.18-1.26-.12-1.441-.72-.18-.6.12-1.26.72-1.44 4.08-1.26 11.04-1.02 15.361 1.56.6.358.779 1.14.421 1.74-.359.6-1.14.779-1.741.419z"/>
                        </svg>
                        Spotify to Audion
                    </h2>
                    <div style="display:flex; gap:8px;">
                        <button class="sc-close-btn" id="sc-close-btn">✕</button>
                    </div>
                </div>

                <div class="sc-input-group">
                    <label>Source</label>
                    <div class="sc-row">
                        <div class="sc-input-wrapper">
                            <input type="text" id="sc-url-input" class="sc-input" placeholder="https://open.spotify.com/playlist/...">
                            <div id="sc-clear-file" class="sc-clear-file" style="display:none;">✕</div>
                        </div>
                        
                        <label for="sc-file-input" class="sc-btn secondary" id="sc-upload-btn-label">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            JSON
                        </label>
                        <input type="file" id="sc-file-input" accept=".json">
                    </div>
                    <div id="sc-file-info" class="sc-file-info"></div>
                </div>

                <div class="sc-details" id="sc-privacy-note" style="margin-top:4px;">
                    ⚠️ <strong>Important:</strong> Spotify playlists must be public. Private playlists cannot be fetched by this plugin. Make the playlist public via Spotify (Share → Make Public), or use the JSON import method below.
                </div>

                <div class="sc-help-box" id="sc-help-box">
                    <strong>💡 Alternative Method:</strong> If the automatic conversion fails, you can manually import the playlist data:
                    <ol style="margin: 8px 0; padding-left: 20px;">
                        <li>Visit <a href="https://playlist.audionplayer.com" target="_blank">playlist.audionplayer.com</a></li>
                        <li>Paste your Spotify playlist URL there to get the JSON data</li>
                        <li>Copy the JSON response</li>
                        <li>Use the JSON import feature in Audion to import the tracks</li>
                    </ol>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
                    <button class="sc-btn help" id="sc-help-toggle">ℹ️ Show Help</button>
                </div>

                <div class="sc-progress-bar">
                    <div class="sc-progress-value" id="sc-progress"></div>
                </div>

                <div class="sc-log" id="sc-log">
                    <div class="sc-log-item">Ready to convert...</div>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="sc-btn secondary" id="sc-stop-btn" disabled>Stop</button>
                    <button class="sc-btn" id="sc-convert-btn">Convert</button>
                </div>
            `;
            document.body.appendChild(modal);

            // Events
            modal.querySelector('#sc-close-btn').onclick = () => this.close();
            modal.querySelector('#sc-convert-btn').onclick = () => this.startConversion();
            modal.querySelector('#sc-stop-btn').onclick = () => { this.stopConversion = true; };
            modal.querySelector('#sc-file-input').addEventListener('change', (e) => this.handleFileUpload(e));
            modal.querySelector('#sc-clear-file').addEventListener('click', () => this.clearFile());

            // Toggle help box
            modal.querySelector('#sc-help-toggle').onclick = () => {
                const helpBox = document.getElementById('sc-help-box');
                const btn = document.getElementById('sc-help-toggle');
                const isVisible = helpBox.classList.contains('visible');

                if (isVisible) {
                    helpBox.classList.remove('visible');
                    btn.textContent = 'ℹ️ Show Help';
                } else {
                    helpBox.classList.add('visible');
                    btn.textContent = 'ℹ️ Hide Help';
                }
            };
        },



        createMenuButton() {
            const btn = document.createElement('button');
            btn.className = 'plugin-menu-btn';
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 12h20M2 12l5-5m-5 5l5 5"/>
                    <circle cx="12" cy="12" r="10"/>
                </svg>
                <span>Import Spotify Playlist</span>
            `;
            btn.onclick = () => this.open();

            this.api.ui.registerSlot('playerbar:menu', btn);
        },

        // ═══════════════════════════════════════════════════════════════════════
        // JSON IMPORT & UTILITIES
        // ═══════════════════════════════════════════════════════════════════════

        handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const fileInfo = document.getElementById('sc-file-info');
            const urlInput = document.getElementById('sc-url-input');
            const clearBtn = document.getElementById('sc-clear-file');
            const uploadBtnLabel = document.getElementById('sc-upload-btn-label');

            this.log(`Reading file: ${file.name}...`);
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    if (!Array.isArray(json)) throw new Error("JSON must be an array");

                    this.importedPlaylistData = this.normalizeJSON(json);

                    fileInfo.textContent = `Loaded ${this.importedPlaylistData.tracks.length} tracks from ${file.name}`;
                    fileInfo.style.display = 'block';
                    urlInput.value = "";
                    urlInput.placeholder = "Using imported JSON file...";
                    urlInput.disabled = true;

                    clearBtn.style.display = 'flex';
                    uploadBtnLabel.style.display = 'none';

                    this.log(`Parsed ${this.importedPlaylistData.tracks.length} tracks successfully`, 'success');

                } catch (err) {
                    this.log('Invalid JSON file format', 'error');
                    console.error(err);
                    event.target.value = '';
                }
            };

            reader.readAsText(file);
        },

        clearFile() {
            this.importedPlaylistData = null;
            const fileInput = document.getElementById('sc-file-input');
            const urlInput = document.getElementById('sc-url-input');
            const fileInfo = document.getElementById('sc-file-info');
            const clearBtn = document.getElementById('sc-clear-file');
            const uploadBtnLabel = document.getElementById('sc-upload-btn-label');

            fileInput.value = '';
            urlInput.value = '';
            urlInput.disabled = false;
            urlInput.placeholder = "https://open.spotify.com/playlist/...";
            fileInfo.style.display = 'none';
            clearBtn.style.display = 'none';
            uploadBtnLabel.style.display = 'flex';

            this.log('File cleared.', 'info');
        },

        normalizeJSON(jsonData) {
            return {
                title: 'JSON Import',
                description: `Imported ${jsonData.length} tracks from file`,
                tracks: jsonData.map(t => ({
                    title: t.songTitle || t.title || 'Unknown',
                    artist: Array.isArray(t.artist) ? t.artist.join(', ') : t.artist,
                    album: null,
                    duration_ms: this.parseDurationToMs(t.duration),
                    isrc: null
                }))
            };
        },

        parseDurationToMs(timeStr) {
            if (!timeStr) return 0;
            try {
                const parts = timeStr.split(':');
                if (parts.length === 2) {
                    const min = parseInt(parts[0], 10);
                    const sec = parseInt(parts[1], 10);
                    return (min * 60 + sec) * 1000;
                }
            } catch (e) { console.error('Duration parse error', e); }
            return 0;
        },

        // ═══════════════════════════════════════════════════════════════════════
        // SPOTIFY API METHODS
        // ═══════════════════════════════════════════════════════════════════════

        async fetchPlaylistFromAPI(playlistId) {
            this.log(`Fetching playlist from new API...`, 'info');
            const response = await this.api.fetch(`${this.NEW_SPOTIFY_API_BASE}/${playlistId}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch playlist data: ${response.status}`);
            }

            const json = await response.json();
            if (!json.success || !json.data) {
                throw new Error('Invalid response from Spotify API');
            }

            const data = json.data;
            const tracks = data.tracks.map(t => ({
                title: t.name,
                artist: t.artists.join(', '),
                album: t.album,
                duration_ms: t.duration_ms,
                // New API doesn't seem to provide ISRC in the example, but let's keep the field
                isrc: null
            }));

            return {
                // Use the playlist `name` returned by the API when available
                title: data.name || 'Spotify Import',
                description: data.description || `Imported with ${tracks.length} tracks`,
                // Expose image URL so caller can set playlist cover
                image: data.image || null,
                tracks: tracks
            };
        },



        // ═══════════════════════════════════════════════════════════════════════
        // MAIN LOGIC
        // ═══════════════════════════════════════════════════════════════════════

        open() {
            this.isOpen = true;
            document.getElementById('spotify-converter-overlay').classList.add('open');
            document.getElementById('spotify-converter-modal').classList.add('open');
            document.getElementById('sc-url-input').focus();
        },

        close() {
            if (this.isConverting) return;
            this.isOpen = false;
            document.getElementById('spotify-converter-overlay').classList.remove('open');
            document.getElementById('spotify-converter-modal').classList.remove('open');
        },

        log(msg, type = 'info') {
            const log = document.getElementById('sc-log');
            const item = document.createElement('div');
            item.className = `sc-log-item ${type}`;
            item.textContent = `> ${msg}`;
            log.appendChild(item);
            log.scrollTop = log.scrollHeight;
        },

        updateProgress(percent) {
            document.getElementById('sc-progress').style.width = `${percent}%`;
        },

        async getTidalLibraryMap() {
            const map = new Map();
            if (this.api.library.getTracks) {
                try {
                    const tracks = await this.api.library.getTracks();
                    if (Array.isArray(tracks)) {
                        tracks.forEach(t => {
                            if (t.source_type === 'tidal' && t.external_id) {
                                map.set(String(t.external_id), t.id);
                            }
                        });
                    }
                } catch (e) { console.error(e); }
            }
            return map;
        },

        async startConversion() {
            const urlInput = document.getElementById('sc-url-input');
            const btn = document.getElementById('sc-convert-btn');
            const stopBtn = document.getElementById('sc-stop-btn');

            let playlistData = null;

            // Check if using imported JSON or URL
            if (this.importedPlaylistData) {
                playlistData = this.importedPlaylistData;
                this.log(`Using Imported JSON: ${playlistData.tracks.length} tracks`);
            } else {
                const url = urlInput.value.trim();
                if (!url.includes('spotify.com/playlist/')) {
                    this.log('Invalid Spotify playlist URL', 'error');
                    return;
                }
                const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
                if (!playlistIdMatch) {
                    this.log('Could not extract playlist ID', 'error');
                    return;
                }
                const playlistId = playlistIdMatch[1];

                this.log('Fetching playlist...', 'info');
                try {
                    playlistData = await this.fetchPlaylistFromAPI(playlistId);
                } catch (err) {
                    console.error(err);
                    this.log(`Error: ${err.message}`, 'error');
                    return;
                }
            }

            this.isConverting = true;
            this.stopConversion = false;
            btn.disabled = true;
            stopBtn.disabled = false;
            urlInput.disabled = true;
            this.updateProgress(0);

            document.getElementById('sc-log').innerHTML = '';
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
            this.log(`📝 Playlist: ${playlistData.title}`, 'info');
            this.log(`🎵 Found ${playlistData.tracks.length} tracks to convert`, 'info');
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

            try {

                // 2. Pre-fetch library map for fast dup-checking
                this.log('🔍 Checking existing library...', 'info');
                const existingTracks = await this.getTidalLibraryMap();
                this.log(`📚 Loaded ${existingTracks.size} existing Tidal tracks`, 'info');

                // 3. Create Audion playlist
                this.log('📝 Creating playlist in library...', 'info');
                const audionPlaylistId = await this.api.library.createPlaylist(playlistData.title);
                this.log(`✅ Playlist created. Starting track search...`, 'success');

                // If the converter returned an image URL, set it as the playlist cover
                if (playlistData.image) {
                    try {
                        await this.api.library.updatePlaylistCover(audionPlaylistId, playlistData.image);
                        this.log('🖼️ Playlist image set from Spotify data', 'success');
                    } catch (e) {
                        console.warn('Failed to set playlist cover', e);
                        this.log('⚠️ Failed to set playlist image', 'warn');
                    }
                }
                this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

                // ── PHASE 1: Search Tidal concurrently (fast) ──
                const total = playlistData.tracks.length;
                let searched = 0;
                let successes = 0;
                let fromLibrary = 0;
                let notFound = 0;
                const foundTracks = []; // Collect results: { track, tidalTrack, trackId, wasInLibrary }

                this.log(`⚡ Phase 1: Searching Tidal for matches...`, 'info');

                const concurrency = 5;
                const queue = [...playlistData.tracks];
                const searchWorkers = [];

                const searchWorker = async () => {
                    while (queue.length > 0 && !this.stopConversion) {
                        const track = queue.shift();

                        try {
                            if (searched > 0) {
                                await new Promise(resolve => setTimeout(resolve, 50)); // Small 50ms delay for UI smoothness
                            }

                            const truncatedTitle = track.title.length > 30 ? track.title.substring(0, 30) + '...' : track.title;
                            this.log(`🔍 Searching: ${truncatedTitle}`, 'info');

                            const tidalTrack = await this.searchTidal(track);

                            if (tidalTrack) {
                                const tidalId = String(tidalTrack.id);
                                let trackId;
                                let wasInLibrary = existingTracks.has(tidalId);

                                if (wasInLibrary) {
                                    trackId = existingTracks.get(tidalId);
                                    this.log(`📚 Found (Library): ${truncatedTitle}`, 'warn');
                                } else {
                                    trackId = await this.addTrackToLibrary(tidalTrack);
                                    existingTracks.set(tidalId, trackId);
                                    this.log(`✅ Found: ${truncatedTitle}`, 'success');
                                }

                                foundTracks.push({ track, trackId, wasInLibrary, truncatedTitle });
                            } else {
                                notFound++;
                                this.log(`❌ Not Found: ${truncatedTitle}`, 'error');
                            }

                        } catch (err) {
                            console.error(err);
                            notFound++;
                            this.log(`❌ Error searching: ${track.title}`, 'error');
                        }

                        searched++;
                        if (searched % 5 === 0 || searched === total) {
                            this.updateProgress((searched / total) * 50); // Phase 1 = 0-50%
                            this.log(`📊 Search: ${searched}/${total} | Found: ${foundTracks.length} | ❌ ${notFound} not found`, 'info');
                        }
                    }
                };

                for (let i = 0; i < concurrency; i++) {
                    searchWorkers.push(searchWorker());
                }
                await Promise.all(searchWorkers);

                if (this.stopConversion) {
                    // Skip phase 2 if stopped
                } else {
                    // ── PHASE 2: Add to playlist ONE BY ONE (reliable) ──
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                    this.log(`📋 Phase 2: Adding ${foundTracks.length} tracks to playlist...`, 'info');

                    for (let i = 0; i < foundTracks.length; i++) {
                        if (this.stopConversion) break;

                        const { trackId, wasInLibrary, truncatedTitle } = foundTracks[i];

                        try {
                            await new Promise(r => setTimeout(r, 50)); // Small delay to prevent UI freezing
                            await this.api.library.addTrackToPlaylist(audionPlaylistId, trackId);

                            if (wasInLibrary) {
                                fromLibrary++;
                            } else {
                                successes++;
                            }
                        } catch (err) {
                            console.error('Playlist add failed:', err);
                            notFound++;
                            this.log(`❌ Failed to add: ${truncatedTitle}`, 'error');
                        }

                        // Progress for phase 2 = 50-100%
                        const progress = 50 + ((i + 1) / foundTracks.length) * 50;
                        this.updateProgress(progress);

                        if ((i + 1) % 10 === 0 || i === foundTracks.length - 1) {
                            this.log(`📋 Playlist: ${i + 1}/${foundTracks.length} added`, 'info');
                        }
                    }
                }

                if (this.stopConversion) {
                    this.log('⚠️ Conversion stopped by user.', 'warn');
                    this.log(`📊 Final Stats: ${processed}/${total} processed | ✅ ${successes} new | 📚 ${fromLibrary} from library | ❌ ${notFound} not found`, 'info');
                } else {
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                    this.log(`🎉 CONVERSION COMPLETE!`, 'success');
                    this.log(`📊 Summary:`, 'info');
                    this.log(`   Total Tracks: ${total}`, 'info');
                    this.log(`   ✅ Newly Added: ${successes}`, 'success');
                    this.log(`   📚 From Library: ${fromLibrary}`, 'warn');
                    this.log(`   ❌ Not Found: ${notFound}`, 'error');
                    this.log(`   📝 Playlist: ${playlistData.title}`, 'info');
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                    if (this.api.library.refresh) this.api.library.refresh();
                }

            } catch (err) {
                console.error(err);
                this.log(`Error: ${err.message}`, 'error');
            } finally {
                this.isConverting = false;
                btn.disabled = false;
                stopBtn.disabled = true;
                if (!this.importedPlaylistData) {
                    urlInput.disabled = false;
                }
            }
        },

        async searchTidal(sourceTrack) {
            try {
                // 1. Try ISRC search first (Highly accurate)
                if (sourceTrack.isrc) {
                    // Try fetch via ISRC if API supported it, but we can stick to search for now or use the track endpoint
                    // const res = await this.api.fetch(...) 
                }

                // Standard search with randomized endpoint
                const query = `${sourceTrack.title} ${sourceTrack.artist}`;
                const endpoint = this.getRandomSearchEndpoint();
                const response = await this.api.fetch(`${endpoint}/search/?s=${encodeURIComponent(query)}`);

                if (!response.ok) return null;
                const data = await response.json();

                if (data.data && data.data.items && data.data.items.length > 0) {
                    // Filter Logic:
                    // 1. If we have duration, check if it's within tolerance (e.g. +/- 10s)
                    const matches = data.data.items;

                    if (sourceTrack.duration_ms) {
                        const sourceSec = sourceTrack.duration_ms / 1000;
                        const validDuration = matches.find(m => {
                            const diff = Math.abs(m.duration - sourceSec);
                            return diff < 10; // 10 seconds tolerance
                        });

                        // If we found a duration match, return it
                        if (validDuration) return validDuration;
                    }

                    // Fallback to first result if no duration match (or no duration info)
                    return matches[0];
                }
            } catch (e) {
                console.warn('Tidal search failed', e);
            }
            return null;
        },

        async addTrackToLibrary(tidalTrack) {
            const artistName = tidalTrack.artist?.name || tidalTrack.artists?.[0]?.name || 'Unknown Artist';
            const title = tidalTrack.title + (tidalTrack.version ? ` (${tidalTrack.version})` : '');

            // High res cover if available
            const coverUrl = tidalTrack.album?.cover
                ? `https://resources.tidal.com/images/${tidalTrack.album.cover.replace(/-/g, '/')}/1280x1280.jpg`
                : null;

            const trackData = {
                title: title,
                artist: artistName,
                album: tidalTrack.album?.title || null,
                duration: tidalTrack.duration || null,
                cover_url: coverUrl,
                source_type: 'tidal',
                external_id: String(tidalTrack.id),
                format: 'LOSSLESS',
                bitrate: null
            };

            return await this.api.library.addExternalTrack(trackData);
        }
    };

    if (typeof Audion !== 'undefined' && Audion.register) {
        Audion.register(SpotifyConverter);
    } else {
        window.SpotifyConverter = SpotifyConverter;
        window.AudionPlugin = SpotifyConverter;
    }
})();
