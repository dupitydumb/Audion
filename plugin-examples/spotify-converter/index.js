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

        // API endpoints
        TIDAL_API_BASE: 'https://katze.qqdl.site',
        NEW_SPOTIFY_API_BASE: 'https://spotify-api-6y41.vercel.app/api/playlist',

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
                    padding: 12px;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.1s;
                }
                .sc-btn:hover:not(:disabled) { transform: scale(1.02); filter: brightness(1.1); }
                .sc-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .sc-btn.secondary { background: var(--bg-highlight, #3e3e3e); }
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
                    <label>Spotify Playlist URL</label>
                    <input type="text" id="sc-url-input" class="sc-input" placeholder="https://open.spotify.com/playlist/...">
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
                title: 'Spotify Import', // The new API doesn't seem to return playlist name in the example
                description: `Imported with ${tracks.length} tracks`,
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
            const url = urlInput.value.trim();
            const btn = document.getElementById('sc-convert-btn');
            const stopBtn = document.getElementById('sc-stop-btn');

            if (!url.includes('spotify.com/playlist/')) {
                this.log('Invalid Spotify playlist URL', 'error');
                return;
            }

            // Extract playlist ID
            const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
            if (!playlistIdMatch) {
                this.log('Could not extract playlist ID', 'error');
                return;
            }
            const playlistId = playlistIdMatch[1];

            this.isConverting = true;
            this.stopConversion = false;
            btn.disabled = true;
            stopBtn.disabled = false;
            urlInput.disabled = true;
            this.updateProgress(0);

            document.getElementById('sc-log').innerHTML = '';
            this.log('Starting conversion...');

            try {
                this.log('Fetching playlist...', 'info');
                const playlistData = await this.fetchPlaylistFromAPI(playlistId);
                this.log(`Found ${playlistData.tracks.length} tracks`, 'success');

                // 2. Pre-fetch library map for fast dup-checking
                this.log('Checking existing library...', 'info');
                const existingTracks = await this.getTidalLibraryMap();
                this.log(`Loaded ${existingTracks.size} existing Tidal tracks`, 'info');

                // 3. Create Audion playlist
                this.log('Creating local playlist...', 'info');
                const audionPlaylistId = await this.api.library.createPlaylist(playlistData.title);

                // 4. Process tracks concurrently
                // Worker Pool Pattern
                const concurrency = 5; // Run 5 searches/adds in parallel
                const total = playlistData.tracks.length;
                let processed = 0;
                let successes = 0;

                // Create a queue
                const queue = [...playlistData.tracks];
                const activeWorkers = [];

                const worker = async () => {
                    while (queue.length > 0 && !this.stopConversion) {
                        const track = queue.shift();

                        try {
                            const query = track.isrc ? `isrc:${track.isrc}` : `${track.title} ${track.artist}`;

                            // Log only every 5th track or so to reduce spam, or just progress
                            // this.log(`Searching: ${track.title}`, 'info');

                            // Find best match
                            const tidalTrack = await this.searchTidal(track);

                            if (tidalTrack) {
                                const tidalId = String(tidalTrack.id);
                                let trackId;

                                if (existingTracks.has(tidalId)) {
                                    trackId = existingTracks.get(tidalId);
                                } else {
                                    trackId = await this.addTrackToLibrary(tidalTrack);
                                    existingTracks.set(tidalId, trackId);
                                }

                                await this.api.library.addTrackToPlaylist(audionPlaylistId, trackId);
                                successes++;
                            }

                            processed++;
                            if (processed % 5 === 0 || processed === total) {
                                this.updateProgress((processed / total) * 100);
                                this.log(`Processed ${processed}/${total} tracks...`, 'info');
                            }

                        } catch (err) {
                            console.error(err);
                            // this.log(`Error processing ${track.title}`, 'error');
                            processed++;
                        }
                    }
                };

                // Start workers
                for (let i = 0; i < concurrency; i++) {
                    activeWorkers.push(worker());
                }

                await Promise.all(activeWorkers);

                if (this.stopConversion) {
                    this.log('Conversion stopped by user.', 'warn');
                } else {
                    this.log(`Done! Imported ${successes}/${total} tracks`, 'success');
                    if (this.api.library.refresh) this.api.library.refresh();
                }

            } catch (err) {
                console.error(err);
                this.log(`Error: ${err.message}`, 'error');
            } finally {
                this.isConverting = false;
                btn.disabled = false;
                stopBtn.disabled = true;
                urlInput.disabled = false;
            }
        },

        async searchTidal(sourceTrack) {
            try {
                // 1. Try ISRC search first (Highly accurate)
                if (sourceTrack.isrc) {
                    // Try fetch via ISRC if API supported it, but we can stick to search for now or use the track endpoint
                    // const res = await this.api.fetch(...) 
                }

                // Standard search
                const query = `${sourceTrack.title} ${sourceTrack.artist}`;
                const response = await this.api.fetch(`${this.TIDAL_API_BASE}/search/?s=${encodeURIComponent(query)}`);

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

    window.SpotifyConverter = SpotifyConverter;
    window.AudionPlugin = SpotifyConverter;
})();
