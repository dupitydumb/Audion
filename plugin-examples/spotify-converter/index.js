(function () {
    // ═══════════════════════════════════════════════════════════════════════════
    // SPOTIFY CONVERTER PLUGIN - ENHANCED VERSION
    // ═══════════════════════════════════════════════════════════════════════════

    const SpotifyConverter = {
        name: 'Spotify Converter',
        api: null,

        isOpen: false,
        isConverting: false,
        stopConversion: false,
        abortController: null,
        importedPlaylistData: null,

        // API endpoints
        TIDAL_SEARCH_ENDPOINTS: [
            'https://hund.qqdl.site',
            'https://katze.qqdl.site',
            'https://tidal.kinoplus.online',
            'https://maus.qqdl.site',
            'https://arran.monochrome.tf'
        ],
        TIDAL_DETAILS_ENDPOINT: 'https://triton.squid.wtf', // For ISRC lookup
        NEW_SPOTIFY_API_BASE: 'https://playlist.audionplayer.com/api/playlist',

        lastWorkingSearchEndpoint: null,
        trackCache: new Map(), // normalized key -> Tidal ID

        // ── Lifecycle ───────────────────────────────────────────────────────
        async init(api) {
            console.log('[SpotifyConverter] Initializing...');
            this.api = api;
            this.injectStyles();
            this.createModal();
            this.createMenuButton();
            console.log('[SpotifyConverter] Ready');
        },

        // ── API helpers ──────────────────────────────────────────────────────
        async getWorkingSearchEndpoint() {
            const endpoints = [...this.TIDAL_SEARCH_ENDPOINTS];
            if (this.lastWorkingSearchEndpoint) {
                const idx = endpoints.indexOf(this.lastWorkingSearchEndpoint);
                if (idx > -1) {
                    endpoints.splice(idx, 1);
                    endpoints.unshift(this.lastWorkingSearchEndpoint);
                }
            }
            for (const base of endpoints) {
                try {
                    const testUrl = `${base}/search/?s=test`;
                    const res = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
                    if (res.ok) {
                        this.lastWorkingSearchEndpoint = base;
                        return base;
                    }
                } catch (e) {
                    // ignore
                }
            }
            return this.TIDAL_SEARCH_ENDPOINTS[0]; // fallback
        },

        async searchByISRC(isrc, signal) {
            const url = `${this.TIDAL_DETAILS_ENDPOINT}/track/?isrc=${isrc}`;
            try {
                const res = await this.api.fetch(url, { signal });
                if (res.ok) {
                    const data = await res.json();
                    return data.data; // assume track object
                }
            } catch (e) {
                if (e.name === 'AbortError') throw e;
            }
            return null;
        },

        async searchTidal(sourceTrack, signal) {
            // 1. Try ISRC first if available
            if (sourceTrack.isrc) {
                try {
                    const isrcTrack = await this.searchByISRC(sourceTrack.isrc, signal);
                    if (isrcTrack) return isrcTrack;
                } catch (e) {
                    if (e.name === 'AbortError') throw e;
                }
            }

            // 2. Fallback to text search
            const endpoint = await this.getWorkingSearchEndpoint();
            const query = `${sourceTrack.title} ${sourceTrack.artist}`;
            const url = `${endpoint}/search/?s=${encodeURIComponent(query)}`;
            const res = await this.api.fetch(url, { signal });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.data || !data.data.items || data.data.items.length === 0) return null;

            // Score each candidate
            const candidates = data.data.items.map(tidalTrack => ({
                track: tidalTrack,
                score: this.calculateMatchScore(tidalTrack, sourceTrack)
            }));
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            return best.score >= 60 ? best.track : null; // threshold
        },

        normalizeString(str) {
            if (!str) return '';
            return str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        },

        calculateMatchScore(tidalTrack, spotifyTrack) {
            let score = 0;

            const tidalTitle = this.normalizeString(tidalTrack.title);
            const spotifyTitle = this.normalizeString(spotifyTrack.title);
            if (tidalTitle === spotifyTitle) score += 50;
            else if (tidalTitle.includes(spotifyTitle) || spotifyTitle.includes(tidalTitle)) score += 30;

            const tidalArtist = this.normalizeString(tidalTrack.artist?.name || tidalTrack.artists?.[0]?.name || '');
            const spotifyArtist = this.normalizeString(spotifyTrack.artist);
            if (tidalArtist === spotifyArtist) score += 30;
            else if (tidalArtist.includes(spotifyArtist) || spotifyArtist.includes(tidalArtist)) score += 15;

            if (spotifyTrack.duration_ms) {
                const tidalSec = tidalTrack.duration;
                const spotifySec = spotifyTrack.duration_ms / 1000;
                const diff = Math.abs(tidalSec - spotifySec);
                if (diff < 5) score += 20;
                else if (diff < 10) score += 10;
            }

            if (tidalTrack.isrc && spotifyTrack.isrc && tidalTrack.isrc === spotifyTrack.isrc) score += 100;
            return score;
        },

        // ── Library helpers ─────────────────────────────────────────────────
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

        async addTrackToLibrary(tidalTrack) {
            const artistName = tidalTrack.artist?.name || tidalTrack.artists?.[0]?.name || 'Unknown Artist';
            const title = tidalTrack.title + (tidalTrack.version ? ` (${tidalTrack.version})` : '');
            const coverUrl = tidalTrack.album?.cover
                ? `https://resources.tidal.com/images/${tidalTrack.album.cover.replace(/-/g, '/')}/1280x1280.jpg`
                : null;
            const trackData = {
                title,
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
        },

        // ── UI ──────────────────────────────────────────────────────────────
        injectStyles() {
            if (document.getElementById('spotify-converter-styles')) return;
            const style = document.createElement('style');
            style.id = 'spotify-converter-styles';
            style.textContent = `
                /* ── Modal & overlay ─────────────────────────────────────── */
                #spotify-converter-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(6px);
                    z-index: 10000;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.2s;
                }
                #spotify-converter-overlay.open {
                    opacity: 1;
                    visibility: visible;
                }
                #spotify-converter-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) scale(0.96);
                    width: 600px;
                    max-width: 96vw;
                    max-height: 88vh;
                    background: var(--bg-elevated, #181818);
                    border: 1px solid var(--border-color, #2e2e2e);
                    border-radius: 20px;
                    z-index: 10001;
                    box-shadow: 0 28px 70px rgba(0, 0, 0, 0.65);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #spotify-converter-modal.open {
                    opacity: 1;
                    visibility: visible;
                    transform: translate(-50%, -50%) scale(1);
                }

                /* ── Header ───────────────────────────────────────────────── */
                .sc-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--border-color, #2a2a2a);
                    background: var(--bg-elevated, #181818);
                    flex-shrink: 0;
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
                    font-size: 24px;
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s, color 0.2s;
                }
                .sc-close-btn:hover {
                    background: var(--bg-highlight, #2a2a2a);
                    color: #fff;
                }

                /* ── Body (scrollable) ───────────────────────────────────── */
                .sc-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                    background: var(--bg-base, #111);
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    min-height: 0;
                }
                .sc-body::-webkit-scrollbar {
                    width: 6px;
                }
                .sc-body::-webkit-scrollbar-thumb {
                    background: #2a2a2a;
                    border-radius: 3px;
                }

                /* ── Input section ───────────────────────────────────────── */
                .sc-section {
                    background: var(--bg-elevated, #1a1a1a);
                    border-radius: 10px;
                    padding: 12px;
                    border: 1px solid var(--border-color, #2a2a2a);
                    flex-shrink: 0;
                }
                .sc-section-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-secondary, #888);
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .sc-row {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }
                .sc-input-wrapper {
                    flex: 1;
                    position: relative;
                }
                .sc-input {
                    width: 100%;
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    color: var(--text-primary, #fff);
                    padding: 10px 35px 10px 10px;
                    border-radius: 8px;
                    font-size: 13px;
                    box-sizing: border-box;
                }
                .sc-input:focus {
                    outline: none;
                    border-color: #1DB954;
                }
                .sc-input:disabled {
                    opacity: 0.6;
                    background: var(--bg-highlight, #222);
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
                .sc-clear-file:hover {
                    background: #777;
                }
                .sc-file-input-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    color: var(--text-primary, #fff);
                    padding: 10px 14px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: border-color 0.2s;
                    white-space: nowrap;
                    font-size: 13px;
                }
                .sc-file-input-label:hover {
                    border-color: #1DB954;
                }
                #sc-file-input {
                    display: none;
                }
                .sc-badge {
                    background: #1DB954;
                    color: #000;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 4px 8px;
                    border-radius: 20px;
                    margin-left: 8px;
                }
                .sc-file-info {
                    font-size: 13px;
                    color: #1DB954;
                    margin-top: 8px;
                    display: none;
                    align-items: center;
                    gap: 8px;
                }
                .sc-remove-json {
                    background: transparent;
                    border: 1px solid #e74c3c;
                    color: #e74c3c;
                    padding: 2px 10px;
                    border-radius: 20px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .sc-remove-json:hover {
                    background: #e74c3c;
                    color: #fff;
                }

                /* ── Info banner ─────────────────────────────────────────── */
                .sc-info-banner {
                    font-size: 11px;
                    color: var(--text-secondary, #999);
                    padding: 8px 10px;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.04);
                    line-height: 1.5;
                    flex-shrink: 0;
                }
                .sc-info-banner strong {
                    color: var(--text-primary, #ccc);
                }
                .sc-help-link {
                    color: #1DB954;
                    cursor: pointer;
                    text-decoration: none;
                    font-weight: 500;
                }
                .sc-help-link:hover {
                    text-decoration: underline;
                }
                .sc-help-box {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 12px;
                    color: var(--text-secondary, #b3b3b3);
                    display: none;
                    flex-shrink: 0;
                }
                .sc-help-box.visible { display: block; }
                .sc-help-box a { color: #1DB954; text-decoration: none; }
                .sc-help-box ol { margin: 6px 0 0; padding-left: 18px; }

                /* ── Buttons ─────────────────────────────────────────────── */
                .sc-btn {
                    background: #1DB954;
                    color: #fff;
                    border: none;
                    padding: 10px 16px;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: filter 0.15s, transform 0.1s;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .sc-btn:hover:not(:disabled) { filter: brightness(1.1); transform: scale(1.02); }
                .sc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .sc-btn.secondary {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    color: var(--text-primary, #fff);
                }
                .sc-btn.secondary:hover:not(:disabled) {
                    background: var(--bg-highlight, #333);
                    border-color: #555;
                }

                /* ── Playlist preview ────────────────────────────────────── */
                .sc-playlist-preview {
                    background: var(--bg-surface, #1e1e1e);
                    border-radius: 8px;
                    padding: 10px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                }
                .sc-playlist-cover {
                    width: 48px;
                    height: 48px;
                    border-radius: 6px;
                    background: var(--bg-highlight, #2a2a2a);
                    object-fit: cover;
                    flex-shrink: 0;
                }
                .sc-playlist-info {
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .sc-playlist-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary, #fff);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .sc-playlist-owner {
                    font-size: 11px;
                    color: var(--text-secondary, #b3b3b3);
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .sc-playlist-meta {
                    font-size: 11px;
                    color: var(--text-secondary, #888);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                /* ── Progress & log ──────────────────────────────────────── */
                .sc-progress-bar {
                    height: 4px;
                    background: var(--bg-highlight, #3e3e3e);
                    border-radius: 2px;
                    overflow: hidden;
                    flex-shrink: 0;
                }
                .sc-progress-value {
                    height: 100%;
                    background: #1DB954;
                    width: 0%;
                    transition: width 0.2s;
                }
                .sc-log {
                    background: #000;
                    border-radius: 8px;
                    padding: 10px;
                    flex: 1;
                    min-height: 120px;
                    overflow-y: auto;
                    font-family: monospace;
                    font-size: 11px;
                    color: #bbb;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }
                .sc-log-item.success { color: #1DB954; }
                .sc-log-item.error { color: #ff5555; }
                .sc-log-item.warn { color: #ffb86c; }
                .sc-log-item.info { color: #66d9ef; }

                /* ── Footer ──────────────────────────────────────────────── */
                .sc-footer {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 16px;
                    border-top: 1px solid var(--border-color, #2a2a2a);
                    background: var(--bg-elevated, #181818);
                    flex-shrink: 0;
                }

                /* ── Mobile ──────────────────────────────────────────────── */
                @media (max-width: 768px) {
                    #spotify-converter-modal {
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100dvh;
                        transform: none !important;
                        border-radius: 0;
                        border: none;
                        max-width: none;
                        max-height: none;
                    }
                    .sc-header {
                        padding: 12px 16px;
                        padding-left: max(16px, env(safe-area-inset-left));
                        padding-right: max(16px, env(safe-area-inset-right));
                    }
                    .sc-close-btn {
                        min-width: 44px;
                        min-height: 44px;
                    }
                    .sc-body {
                        padding: 12px;
                        padding-left: max(12px, env(safe-area-inset-left));
                        padding-right: max(12px, env(safe-area-inset-right));
                        gap: 8px;
                    }
                    .sc-footer {
                        padding: 10px 16px;
                        padding-left: max(16px, env(safe-area-inset-left));
                        padding-right: max(16px, env(safe-area-inset-right));
                        padding-bottom: max(12px, env(safe-area-inset-bottom));
                    }
                    .sc-input {
                        font-size: 16px;
                        padding: 12px 35px 12px 12px;
                    }
                    .sc-btn {
                        min-height: 44px;
                    }
                    .sc-row {
                        flex-wrap: wrap;
                    }
                    .sc-file-input-label {
                        width: 100%;
                        justify-content: center;
                    }
                    .sc-log {
                        min-height: 160px;
                    }
                }
                @media (max-width: 400px) {
                    .sc-header h2 { font-size: 16px; }
                    .sc-section { padding: 10px; }
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
                    <button class="sc-close-btn" id="sc-close-btn" title="Close">✕</button>
                </div>
                <div class="sc-body" id="sc-body">
                    <div class="sc-section">
                        <div class="sc-section-title">📥 Import Source</div>
                        <div class="sc-row">
                            <div class="sc-input-wrapper">
                                <input type="text" id="sc-url-input" class="sc-input" placeholder="https://open.spotify.com/playlist/...">
                                <div id="sc-clear-file" class="sc-clear-file" style="display:none;">✕</div>
                            </div>
                            <label for="sc-file-input" class="sc-file-input-label" id="sc-upload-btn-label">
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

                    <div class="sc-info-banner">
                        ⚠️ Playlists must be <strong>public</strong>. Requires <strong>tidal-search</strong> plugin to play.
                        <a class="sc-help-link" id="sc-help-toggle">Need help?</a>
                    </div>

                    <div class="sc-help-box" id="sc-help-box">
                        <strong>💡 Alternative Method:</strong> If automatic conversion fails:
                        <ol>
                            <li>Visit <a href="https://playlist.audionplayer.com" target="_blank">playlist.audionplayer.com</a></li>
                            <li>Paste your Spotify playlist URL to get JSON data</li>
                            <li>Save the JSON and upload using the JSON button above</li>
                        </ol>
                    </div>

                    <div id="sc-playlist-preview" class="sc-playlist-preview" style="display: none;">
                        <img id="sc-playlist-cover" class="sc-playlist-cover" src="" alt="">
                        <div class="sc-playlist-info">
                            <div id="sc-playlist-name" class="sc-playlist-name"></div>
                            <div id="sc-playlist-owner" class="sc-playlist-owner"></div>
                            <div id="sc-playlist-trackcount" class="sc-playlist-meta"></div>
                        </div>
                    </div>

                    <div class="sc-progress-bar">
                        <div class="sc-progress-value" id="sc-progress"></div>
                    </div>

                    <div class="sc-log" id="sc-log">
                        <div class="sc-log-item info">Ready to convert...</div>
                    </div>
                </div>
                <div class="sc-footer">
                    <button class="sc-btn secondary" id="sc-stop-btn" disabled>⏹ Stop</button>
                    <button class="sc-btn" id="sc-convert-btn">🚀 Convert</button>
                </div>
            `;
            document.body.appendChild(modal);

            // Event listeners
            modal.querySelector('#sc-close-btn').onclick = () => this.close();
            modal.querySelector('#sc-convert-btn').onclick = () => this.startConversion();
            modal.querySelector('#sc-stop-btn').onclick = () => this.stopConversionProcess();
            modal.querySelector('#sc-file-input').addEventListener('change', (e) => this.handleFileUpload(e));
            modal.querySelector('#sc-clear-file').addEventListener('click', () => this.clearFile());
            modal.querySelector('#sc-help-toggle').onclick = (e) => {
                e.preventDefault();
                const helpBox = document.getElementById('sc-help-box');
                const link = document.getElementById('sc-help-toggle');
                const isVisible = helpBox.classList.contains('visible');
                helpBox.classList.toggle('visible');
                link.textContent = isVisible ? 'Need help?' : 'Hide help';
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

        open() {
            this.isOpen = true;
            document.getElementById('spotify-converter-overlay').classList.add('open');
            document.getElementById('spotify-converter-modal').classList.add('open');
        },

        close() {
            if (this.isConverting) return;
            this.isOpen = false;
            document.getElementById('spotify-converter-overlay').classList.remove('open');
            document.getElementById('spotify-converter-modal').classList.remove('open');
        },

        // ── Logging & Progress ──────────────────────────────────────────────
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

        showPlaylistPreview(data) {
            const preview = document.getElementById('sc-playlist-preview');
            const img = document.getElementById('sc-playlist-cover');
            const name = document.getElementById('sc-playlist-name');
            const owner = document.getElementById('sc-playlist-owner');
            const count = document.getElementById('sc-playlist-trackcount');

            if (data.image) {
                img.src = data.image;
                img.style.display = 'block';
            } else {
                img.style.display = 'none';
            }

            name.textContent = data.title || 'Playlist';

            if (data.owner) {
                owner.innerHTML = `👤 ${data.owner}`;
                owner.style.display = 'flex';
            } else {
                owner.style.display = 'none';
            }

            const totalTracks = data.total || data.tracks.length;
            const fetchedTracks = data.tracks.length;
            if (data.total && data.total > fetchedTracks) {
                count.innerHTML = `🎵 ${fetchedTracks} of ${totalTracks} tracks loaded`;
            } else {
                count.innerHTML = `🎵 ${totalTracks} tracks`;
            }

            preview.style.display = 'flex';
        },

        // ── File handling ───────────────────────────────────────────────────
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

                    fileInfo.innerHTML = `📁 Loaded ${this.importedPlaylistData.tracks.length} tracks <button class="sc-remove-json" id="sc-remove-json">Remove</button>`;
                    fileInfo.style.display = 'flex';
                    urlInput.value = "";
                    urlInput.placeholder = "Using imported JSON file...";
                    urlInput.disabled = true;

                    clearBtn.style.display = 'flex';
                    uploadBtnLabel.style.display = 'none';

                    document.getElementById('sc-remove-json').onclick = () => this.clearFile();

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
            const preview = document.getElementById('sc-playlist-preview');

            fileInput.value = '';
            urlInput.value = '';
            urlInput.disabled = false;
            urlInput.placeholder = "https://open.spotify.com/playlist/...";
            fileInfo.style.display = 'none';
            clearBtn.style.display = 'none';
            uploadBtnLabel.style.display = 'flex';
            preview.style.display = 'none';

            this.log('File cleared.', 'info');
        },

        normalizeJSON(jsonData) {
            return {
                title: 'JSON Import',
                description: `Imported ${jsonData.length} tracks from file`,
                tracks: jsonData.map(t => ({
                    title: t.songTitle || t.title || t.name || 'Unknown',
                    artist: (Array.isArray(t.artist) ? t.artist.join(', ') : (t.artist || t.artist_name || 'Unknown')),
                    album: t.album || null,
                    duration_ms: this.parseDurationToMs(t.duration),
                    isrc: t.isrc || null
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
            } catch (e) { }
            return 0;
        },

        // ── Spotify API ─────────────────────────────────────────────────────
        async fetchPlaylistFromAPI(playlistId) {
            this.log(`Fetching playlist from API...`, 'info');

            const limit = 100;
            let offset = 0;
            let allTracks = [];
            let playlistMeta = null;
            let total = 0;
            let page = 1;

            while (true) {
                const url = `${this.NEW_SPOTIFY_API_BASE}/${playlistId}?limit=${limit}&offset=${offset}`;
                const response = await this.api.fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch playlist: ${response.status}`);
                const json = await response.json();
                if (!json.success || !json.data) throw new Error('Invalid API response');

                const data = json.data;

                // Store metadata from the first page
                if (!playlistMeta) {
                    playlistMeta = {
                        title: data.name || 'Spotify Import',
                        description: data.description || '',
                        image: data.image || null,
                        owner: data.owner || null,
                    };
                    total = data.total || 0;
                }

                const pageTracks = data.tracks.map(t => ({
                    title: t.name,
                    artist: t.artists.join(', '),
                    album: t.album,
                    duration_ms: t.duration_ms,
                    isrc: null
                }));
                allTracks = allTracks.concat(pageTracks);

                this.log(`📄 Page ${page}: fetched ${pageTracks.length} tracks (${allTracks.length}/${total})`, 'info');

                // Show preview after first page with current progress
                this.showPlaylistPreview({
                    ...playlistMeta,
                    total,
                    tracks: allTracks
                });

                // Check if there are more pages
                if (!data.next || pageTracks.length === 0 || allTracks.length >= total) {
                    break;
                }

                offset += limit;
                page++;
            }

            this.log(`✅ Fetched all ${allTracks.length} tracks`, 'success');

            return {
                ...playlistMeta,
                total,
                tracks: allTracks
            };
        },

        // ── Conversion core ─────────────────────────────────────────────────
        async startConversion() {
            const urlInput = document.getElementById('sc-url-input');
            const btn = document.getElementById('sc-convert-btn');
            const stopBtn = document.getElementById('sc-stop-btn');

            let playlistData = null;

            if (this.importedPlaylistData) {
                playlistData = this.importedPlaylistData;
                this.log(`📁 Using imported JSON: ${playlistData.tracks.length} tracks`, 'info');
            } else {
                const url = urlInput.value.trim();
                if (!url.includes('spotify.com/playlist/')) {
                    this.log('❌ Invalid Spotify playlist URL', 'error');
                    return;
                }
                const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
                if (!match) {
                    this.log('❌ Could not extract playlist ID', 'error');
                    return;
                }
                const playlistId = match[1];
                this.log('🔍 Fetching playlist...', 'info');
                try {
                    playlistData = await this.fetchPlaylistFromAPI(playlistId);
                    this.showPlaylistPreview(playlistData);
                } catch (err) {
                    console.error(err);
                    this.log(`❌ Error: ${err.message}`, 'error');
                    return;
                }
            }

            this.isConverting = true;
            this.stopConversion = false;
            this.abortController = new AbortController();
            btn.disabled = true;
            stopBtn.disabled = false;
            urlInput.disabled = true;
            this.updateProgress(0);

            const log = document.getElementById('sc-log');
            log.innerHTML = '';
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
            this.log(`📝 Playlist: ${playlistData.title}`, 'info');
            this.log(`🎵 Found ${playlistData.tracks.length} tracks`, 'info');
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

            try {
                const existingTracks = await this.getTidalLibraryMap();
                this.log(`📚 Loaded ${existingTracks.size} existing Tidal tracks`, 'info');

                // Create playlist
                const audionPlaylistId = await this.api.library.createPlaylist(playlistData.title);
                this.log(`✅ Playlist created`, 'success');
                if (playlistData.image) {
                    try {
                        await this.api.library.updatePlaylistCover(audionPlaylistId, playlistData.image);
                        this.log('🖼️ Playlist image set', 'success');
                    } catch (e) {
                        this.log('⚠️ Failed to set playlist image', 'warn');
                    }
                }
                this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

                const total = playlistData.tracks.length;
                let processed = 0;
                let successes = 0;
                let fromLibrary = 0;
                let notFound = 0;
                const foundTracks = [];

                // Phase 1: Search (concurrency = 3)
                const concurrency = 3;
                const queue = [...playlistData.tracks];
                const searchWorkers = [];

                const searchWorker = async () => {
                    while (queue.length > 0 && !this.stopConversion) {
                        const track = queue.shift();
                        const key = `${this.normalizeString(track.title)}|${this.normalizeString(track.artist)}|${track.duration_ms}`;
                        const cachedId = this.trackCache.get(key);

                        if (cachedId) {
                            foundTracks.push({ track, trackId: cachedId, wasInLibrary: true, truncatedTitle: track.title });
                            fromLibrary++;
                        } else {
                            try {
                                // Jitter to avoid rate limits
                                await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
                                const tidalTrack = await this.searchTidal(track, this.abortController.signal);
                                if (tidalTrack) {
                                    const tidalId = String(tidalTrack.id);
                                    let trackId;
                                    let wasInLibrary = existingTracks.has(tidalId);
                                    if (wasInLibrary) {
                                        trackId = existingTracks.get(tidalId);
                                        fromLibrary++;
                                    } else {
                                        trackId = await this.addTrackToLibrary(tidalTrack);
                                        existingTracks.set(tidalId, trackId);
                                        successes++;
                                    }
                                    foundTracks.push({ track, trackId, wasInLibrary, truncatedTitle: track.title });
                                    this.trackCache.set(key, trackId);
                                } else {
                                    notFound++;
                                    foundTracks.push({ track, trackId: null, wasInLibrary: false, truncatedTitle: track.title });
                                }
                            } catch (err) {
                                if (err.name === 'AbortError') {
                                    this.log('⏹️ Search aborted', 'warn');
                                    break;
                                }
                                console.error(err);
                                notFound++;
                                foundTracks.push({ track, trackId: null, wasInLibrary: false, truncatedTitle: track.title });
                            }
                        }

                        processed++;
                        if (processed % 5 === 0 || processed === total) {
                            const phase1Percent = (processed / total) * 50;
                            this.updateProgress(phase1Percent);
                            this.log(`📊 Search: ${processed}/${total} | ✅ New: ${successes} | 📚 Library: ${fromLibrary} | ❌ Not found: ${notFound}`, 'info');
                        }
                    }
                };

                for (let i = 0; i < concurrency; i++) {
                    searchWorkers.push(searchWorker());
                }
                await Promise.all(searchWorkers);

                if (this.stopConversion) {
                    this.log('⚠️ Conversion stopped by user.', 'warn');
                } else {
                    // Phase 2: Add to playlist
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                    this.log(`📋 Adding ${foundTracks.length} tracks to playlist...`, 'info');

                    for (let i = 0; i < foundTracks.length; i++) {
                        if (this.stopConversion) break;
                        const { trackId, truncatedTitle } = foundTracks[i];
                        if (trackId) {
                            try {
                                await new Promise(r => setTimeout(r, 50)); // throttle
                                await this.api.library.addTrackToPlaylist(audionPlaylistId, trackId);
                            } catch (err) {
                                this.log(`❌ Failed to add: ${truncatedTitle}`, 'error');
                            }
                        }
                        const phase2Progress = 50 + ((i + 1) / foundTracks.length) * 50;
                        this.updateProgress(phase2Progress);
                    }

                    this.updateProgress(100);
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                    this.log(`🎉 CONVERSION COMPLETE!`, 'success');
                    this.log(`📊 Summary:`, 'info');
                    this.log(`   Total Tracks: ${total}`, 'info');
                    this.log(`   ✅ Newly Added: ${successes}`, 'success');
                    this.log(`   📚 From Library: ${fromLibrary}`, 'warn');
                    this.log(`   ❌ Not Found: ${notFound}`, 'error');
                    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

                    if (this.api.library.refresh) this.api.library.refresh();
                }

            } catch (err) {
                console.error(err);
                this.log(`❌ Error: ${err.message}`, 'error');
            } finally {
                this.isConverting = false;
                this.abortController = null;
                btn.disabled = false;
                stopBtn.disabled = true;
                if (!this.importedPlaylistData) {
                    urlInput.disabled = false;
                }
            }
        },

        stopConversionProcess() {
            this.stopConversion = true;
            if (this.abortController) {
                this.abortController.abort();
            }
            document.getElementById('sc-stop-btn').disabled = true;
        }
    };

    if (typeof Audion !== 'undefined' && Audion.register) {
        Audion.register(SpotifyConverter);
    } else {
        window.SpotifyConverter = SpotifyConverter;
        window.AudionPlugin = SpotifyConverter;
    }
})();