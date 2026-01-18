(function () {
    // ═══════════════════════════════════════════════════════════════════════════
    // SPOTIFY CONVERTER PLUGIN
    // ═══════════════════════════════════════════════════════════════════════════

    const SpotifyConverter = {
        name: 'Spotify Converter',
        api: null,
        isOpen: false,
        isConverting: false,
        stopConversion: false,

        // API endpoints
        TIDAL_API_BASE: 'https://katze.qqdl.site',
        // CORS proxy might be needed for Spotify if direct fetch fails due to CORS,
        // but often we can fetch public pages. If not, we might need a proxy.
        // For now we'll try direct fetch, and if it fails (likely due to CORS), we'll note it.
        // Actually, 'network:fetch' in Tauri usually bypasses CORS if done via backend,
        // but here plugins use browser fetch.
        // However, we are in a Tauri app properly configured, we might have privileges.
        // If strict CORS applies, we might need a workaround or the user to use a backend proxy.
        // Let's assume we can fetch or use a CORS proxy.
        CORS_PROXY: 'https://api.allorigins.win/raw?url=',

        init(api) {
            console.log('[SpotifyConverter] Initializing...');
            this.api = api;

            this.injectStyles();
            this.createModal();
            this.createMenuButton();

            console.log('[SpotifyConverter] Ready');
        },

        // ═══════════════════════════════════════════════════════════════════════
        // UI
        // ═══════════════════════════════════════════════════════════════════════

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

                .sc-input {
                    background: var(--bg-surface, #282828);
                    border: 1px solid var(--border-color, #404040);
                    color: var(--text-primary, #fff);
                    padding: 12px;
                    border-radius: 8px;
                    font-size: 14px;
                    width: 100%;
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

                .sc-log {
                    background: #000;
                    border-radius: 8px;
                    padding: 12px;
                    height: 200px;
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
                    <button class="sc-close-btn" id="sc-close-btn">✕</button>
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
        // LOGIC
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

            this.isConverting = true;
            this.stopConversion = false;
            btn.disabled = true;
            stopBtn.disabled = false;
            urlInput.disabled = true;
            this.updateProgress(0);

            // Clear log except header
            document.getElementById('sc-log').innerHTML = '';
            this.log('Starting conversion...');

            try {
                // 0. Pre-fetch library map
                this.log('Checking existing library...');
                const existingTracks = await this.getTidalLibraryMap();
                this.log(`Loaded map of ${existingTracks.size} existing Tidal tracks.`, 'info');

                // 1. Fetch playlist page
                this.log('Fetching playlist data...');
                const playlistData = await this.fetchPlaylistData(url);
                this.log(`Found playlist: "${playlistData.title}" with ${playlistData.tracks.length} tracks`, 'success');

                // 2. Create Audion playlist
                this.log('Creating local playlist...');
                const playlistId = await this.api.library.createPlaylist(playlistData.title);
                this.log(`Created playlist ID: ${playlistId}`, 'info');

                // 2.5. Set playlist cover if available
                if (playlistData.coverUrl) {
                    try {
                        await this.api.library.updatePlaylistCover(playlistId, playlistData.coverUrl);
                        this.log('Set playlist cover from Spotify', 'success');
                    } catch (coverErr) {
                        this.log('Could not set playlist cover', 'warn');
                    }
                }

                // 3. Process tracks
                let processed = 0;
                let successes = 0;

                for (const track of playlistData.tracks) {
                    if (this.stopConversion) {
                        this.log('Conversion stopped by user.', 'warn');
                        break;
                    }

                    processed++;
                    this.updateProgress((processed / playlistData.tracks.length) * 100);

                    try {
                        const query = `${track.title} ${track.artist}`;
                        this.log(`Searching: ${track.title} + ${track.artist}`, 'info');

                        const tidalTrack = await this.searchTidal(query);

                        if (tidalTrack) {
                            const tidalId = String(tidalTrack.id);
                            const foundTitle = tidalTrack.title;
                            const foundArtist = tidalTrack.artist?.name || tidalTrack.artists?.[0]?.name || 'Unknown';
                            let trackId;

                            if (existingTracks.has(tidalId)) {
                                trackId = existingTracks.get(tidalId);
                                this.log(`[${processed}/${playlistData.tracks.length}] Reusing: ${foundTitle} - ${foundArtist}`, 'info');
                            } else {
                                trackId = await this.addTrackToLibrary(tidalTrack);
                                existingTracks.set(tidalId, trackId);
                                this.log(`[${processed}/${playlistData.tracks.length}] Found: ${foundTitle} - ${foundArtist}`, 'success');
                            }

                            await this.api.library.addTrackToPlaylist(playlistId, trackId);
                            successes++;
                        } else {
                            this.log(`[${processed}/${playlistData.tracks.length}] Not found: ${track.title}`, 'warn');
                        }
                    } catch (err) {
                        console.error(err);
                        this.log(`[${processed}/${playlistData.tracks.length}] Error: ${track.title}`, 'error');
                    }

                    await new Promise(r => setTimeout(r, 200));
                }

                this.log(`Done! Imported ${successes} of ${playlistData.tracks.length} tracks.`, 'success');

                // Clear input to prevent accidental re-import
                urlInput.value = '';

                if (this.api.library.refresh) {
                    this.api.library.refresh();
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

        async fetchPlaylistData(url) {
            // Extract playlist ID from URL
            const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
            if (!playlistIdMatch) {
                throw new Error('Invalid Spotify playlist URL');
            }
            const playlistId = playlistIdMatch[1];
            this.log(`Playlist ID: ${playlistId}`, 'info');

            let tracks = [];
            let title = 'Spotify Playlist';
            let coverUrl = null;

            // List of proxies to try in order
            const proxies = [
                (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
                (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
                (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
            ];

            // Strategy 0: Try Spotify Embed API (returns ALL tracks, not just 30)
            // The embed endpoint contains complete playlist data
            const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
            this.log('Trying Spotify embed API for complete track list...', 'info');

            for (const proxyFn of proxies) {
                if (tracks.length > 0) break;

                const proxyUrl = proxyFn(embedUrl);
                try {
                    const res = await fetch(proxyUrl);
                    if (!res.ok) continue;

                    const html = await res.text();

                    // The embed page contains JSON data in script tags
                    // Look for __NEXT_DATA__ or resource script
                    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
                    if (nextDataMatch) {
                        const data = JSON.parse(nextDataMatch[1]);
                        // Navigate to playlist entity
                        const props = data?.props?.pageProps;
                        if (props?.state?.data?.entity) {
                            const entity = props.state.data.entity;
                            title = entity.name || title;
                            coverUrl = entity.coverArt?.sources?.[0]?.url || null;

                            // Extract tracks from trackList
                            if (entity.trackList) {
                                entity.trackList.forEach(item => {
                                    if (item.title && item.subtitle) {
                                        tracks.push({
                                            title: item.title,
                                            artist: item.subtitle
                                        });
                                    }
                                });
                            }
                        }
                    }

                    // Alternative: Look for embedded JSON with tracks
                    if (tracks.length === 0) {
                        const scriptMatch = html.match(/<script[^>]*>\s*window\.__REDUX_STATE__\s*=\s*(.+?)\s*<\/script>/s)
                            || html.match(/"trackList":\s*(\[.+?\])/s);
                        if (scriptMatch) {
                            try {
                                const jsonStr = scriptMatch[1];
                                // Clean up JSON if needed
                                const cleanJson = jsonStr.replace(/undefined/g, 'null');
                                const trackData = JSON.parse(cleanJson);

                                if (Array.isArray(trackData)) {
                                    trackData.forEach(item => {
                                        if (item.title) {
                                            tracks.push({
                                                title: item.title,
                                                artist: item.subtitle || item.artist || 'Unknown'
                                            });
                                        }
                                    });
                                }
                            } catch (e) { /* parse error, try next */ }
                        }
                    }

                    if (tracks.length > 0) {
                        this.log(`Embed API: Found ${tracks.length} tracks!`, 'success');
                        break;
                    }
                } catch (e) {
                    console.warn('Embed fetch failed:', e);
                }
            }

            // If embed didn't work, fall back to regular open.spotify.com page
            if (tracks.length === 0) {
                this.log('Embed API failed, falling back to regular page...', 'warn');

                let html = null;

                // 1. Try Direct Fetch (unlikely to work for Spotify but good practice)
                try {
                    const res = await fetch(url);
                    if (res.ok) {
                        html = await res.text();
                    }
                } catch (e) { /* ignore */ }

                // 2. Try Proxies
                if (!html) {
                    for (const proxyFn of proxies) {
                        const proxyUrl = proxyFn(url);
                        this.log(`Trying proxy: ${new URL(proxyUrl).hostname}...`, 'info');
                        try {
                            const res = await fetch(proxyUrl);
                            if (!res.ok) throw new Error(`Status ${res.status}`);
                            html = await res.text();
                            if (html) {
                                this.log('Proxy fetch successful', 'success');
                                break;
                            }
                        } catch (e) {
                            console.warn(`Proxy failed: ${proxyUrl}`, e);
                        }
                    }
                }

                if (!html) {
                    throw new Error('Failed to fetch playlist data. All proxies failed.');
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                title = doc.querySelector('meta[property="og:title"]')?.content || title;
                // Extract playlist cover image from og:image meta tag
                coverUrl = coverUrl || doc.querySelector('meta[property="og:image"]')?.content || null;

                // Strategy 1: Look for JSON metadata (SpotifyEntity or initial-state)
                try {
                    // Check for generic initial-state script (Common in React/Next.js apps like Spotify)
                    const stateScript = doc.getElementById('initial-state') || doc.getElementById('session'); // session sometimes has it

                    if (stateScript) {
                        let jsonStr = stateScript.textContent;
                        // Attempt base64 decode if it looks like base64 (no curly brace at start)
                        if (jsonStr && !jsonStr.trim().startsWith('{')) {
                            try {
                                jsonStr = atob(jsonStr);
                            } catch (e) { /* ignore, maybe not base64 */ }
                        }

                        if (jsonStr) {
                            const data = JSON.parse(jsonStr);
                            // Traverse potential paths for tracks
                            // Path 1: entities relative
                            // Path 2: queries

                            // Helper to finding tracks in big object
                            const findItems = (obj) => {
                                if (!obj || typeof obj !== 'object') return;
                                if (obj.items && Array.isArray(obj.items) && obj.items.length > 0) {
                                    const first = obj.items[0];
                                    if (first.track && first.track.artists) {
                                        // Found it!
                                        obj.items.forEach(item => {
                                            if (item.track) {
                                                tracks.push({
                                                    title: item.track.name,
                                                    artist: item.track.artists.map(a => a.name).join(', ')
                                                });
                                            }
                                        });
                                    }
                                }
                                Object.values(obj).forEach(val => findItems(val));
                            };

                            findItems(data);
                        }
                    }

                    if (tracks.length === 0) {
                        // Fallback to searching scripts for "SpotifyEntity"
                        const scripts = Array.from(doc.scripts);
                        let resourceScript = scripts.find(s => s.textContent.includes('SpotifyEntity'));

                        if (resourceScript) {
                            const match = resourceScript.textContent.match(/SpotifyEntity\s*=\s*({.+?});/s);
                            if (match && match[1]) {
                                const data = JSON.parse(match[1]);
                                if (data && data.tracks && data.tracks.items) {
                                    data.tracks.items.forEach(item => {
                                        const t = item.track;
                                        if (t) {
                                            tracks.push({
                                                title: t.name,
                                                artist: t.artists.map(a => a.name).join(', ')
                                            });
                                        }
                                    });
                                }
                            }
                        }
                    }
                } catch (e) { console.warn('JSON parse failed', e); }

                // Strategy 1.5: Look for hydration data (modern Spotify)
                // It looks like <script type="application/json" id="shared-data"> or similar
                if (tracks.length === 0) {
                    // Try simple regex search on the whole HTML for track/artist patterns if DOM is messy.
                    // "name":"Track Name" ... "artists":[{"name":"Artist"}]
                    // This is risky but powerful for large blobs
                }

                // Strategy 2: User-provided DOM scraping logic (Adapted for static HTML)
                if (tracks.length === 0) {
                    this.log('Attempting user-provided scraper logic...', 'info');

                    // Get all track rows
                    const trackRows = doc.querySelectorAll('[data-testid="tracklist-row"], [data-testid="playlist-tracklist-row"]');
                    this.log(`Strategy 2: Found ${trackRows.length} track rows`, 'info');

                    trackRows.forEach((row, index) => {
                        try {
                            // Strategy 1: Look for title and artist in common containers
                            let songTitle = row.querySelector('[data-testid="internal-track-link"] div')?.textContent ||
                                row.querySelector('a[href*="/track/"] div')?.textContent;

                            let artist = row.querySelector('a[href*="/artist/"]')?.textContent;

                            // Strategy 2: Alternative selectors
                            if (!songTitle) {
                                songTitle = row.querySelector('.t_yrXoUO3qGsJS4Y6iXX')?.textContent ||
                                    row.querySelector('[dir="auto"]')?.textContent;
                                // Fallback to direct link text if div lookup failed
                                if (!songTitle) {
                                    songTitle = row.querySelector('a[href*="/track/"]')?.textContent;
                                }
                            }

                            if (!artist) {
                                const artistLinks = row.querySelectorAll('a[href*="/artist/"]');
                                if (artistLinks.length > 0) {
                                    artist = Array.from(artistLinks).map(a => a.textContent).join(', ');
                                }
                            }

                            if (songTitle) {
                                tracks.push({
                                    title: songTitle.trim(),
                                    artist: artist ? artist.trim() : 'Unknown Artist'
                                });
                            }
                        } catch (err) {
                            console.warn(`Error parsing row ${index + 1}:`, err);
                        }
                    });
                }

                // Strategy 3: Fallback simple link scraper (if the structured rows don't exist in static HTML)
                if (tracks.length === 0) {
                    this.log('Strategy 2 failed (0 tracks). Falling back to smart link scraping.', 'warn');
                    const trackLinks = Array.from(doc.querySelectorAll('a[href*="/track/"]'));
                    this.log(`Strategy 3: Found ${trackLinks.length} track links`, 'info');

                    // DEBUG: Log first track's HTML structure
                    if (trackLinks.length > 0) {
                        const firstLink = trackLinks[0];
                        console.log('=== FIRST TRACK LINK DEBUG ===');
                        console.log('Link text:', firstLink.textContent);
                        console.log('Link HTML:', firstLink.outerHTML);
                        console.log('Parent HTML:', firstLink.parentElement?.outerHTML);
                        // Use closest div or fallback to parent's parent for context
                        const container = firstLink.closest('div') || firstLink.parentElement?.parentElement;
                        if (container) {
                            console.log('Container HTML:', container.outerHTML.substring(0, 500));
                        }
                    }

                    for (const link of trackLinks) {
                        const trackTitle = link.textContent.trim();
                        if (!trackTitle) continue;

                        // Deduplicate based on title in this fallback pass
                        if (tracks.find(t => t.title === trackTitle)) continue;

                        let artistName = '';

                        // Try to find artist in next sibling or parent's sibling (look ahead)
                        let next = link.nextElementSibling;
                        // Or check parent's next sibling if link is inside a div
                        if (!next && link.parentElement.tagName === 'DIV') {
                            next = link.parentElement.nextElementSibling;
                        }

                        // Look ahead a few elements for an artist link OR text span
                        let lookAhead = 5;
                        while (next && lookAhead > 0) {
                            // 1. Check for Artist Link
                            if (next.tagName === 'A' && next.href.includes('/artist/')) {
                                artistName = next.textContent.trim();
                                break;
                            }

                            // 2. Check for nested Artist Link
                            if (next.querySelector) {
                                const internalArtist = next.querySelector('a[href*="/artist/"]');
                                if (internalArtist) {
                                    artistName = internalArtist.textContent.trim();
                                    break;
                                }

                                // 3. User Snippet Match: Check for Artist in SPAN (like "NIKI" case)
                                // Structure: Track Link -> Div -> Span(Artist)
                                // Or Track Link -> Span(Artist)
                                const possibleArtistSpan = next.querySelector('span[class*="encore-text"], span[class*="text"]');
                                if (possibleArtistSpan) {
                                    const t = possibleArtistSpan.textContent.trim();
                                    // Avoid confusing with duration (e.g. 3:45) or other metadata
                                    if (t && t.length > 1 && !t.includes(':') && t !== 'E') {
                                        artistName = t;
                                        // Don't break immediately, might be a better link further down? 
                                        // Actually usually this comes right after title.
                                        break;
                                    }
                                }
                            }

                            // 4. Check if NEXT element itself is the span (if layout is flat)
                            if (next.tagName === 'SPAN' || next.tagName === 'DIV') {
                                const t = next.textContent.trim();
                                if (t && !t.includes(':') && t !== 'E' && t.length > 1 && !artistName) {
                                    // Weak guess, but better than empty
                                    // Only accept if we haven't found anything better
                                    // artistName = t; 
                                    // Let's rely on class match or structure above for now to avoid junk
                                }
                            }

                            next = next.nextElementSibling;
                            lookAhead--;
                        }

                        tracks.push({ title: trackTitle, artist: artistName });
                    }
                }

                if (tracks.length === 0) {
                    // Strategy 3: Meta description fallback
                    const description = doc.querySelector('meta[name="description"]')?.content;
                    // Format: "Listen on Spotify: Playlist containing Track 1 by Artist 1, Track 2 by Artist 2..."
                    // Only gets first few tracks, but better than crashing.
                    if (description) {
                        // Try to match "Track by Artist"
                    }

                    throw new Error('Could not extract tracks. Spotify might have changed their layout.');
                }
            } // End of fallback block (if tracks.length === 0)

            // Log track count and cover status
            this.log(`Extracted ${tracks.length} tracks${coverUrl ? ' with cover' : ''}`, 'info');

            return { title, tracks, coverUrl };
        },

        async searchTidal(query) {
            try {
                // Use the same API as tidal-search plugin
                const response = await fetch(`${this.TIDAL_API_BASE}/search/?s=${encodeURIComponent(query)}`);
                if (!response.ok) return null;
                const data = await response.json();

                if (data.data && data.data.items && data.data.items.length > 0) {
                    return data.data.items[0]; // Best match
                }
            } catch (e) {
                console.warn('Search failed', e);
            }
            return null;
        },

        async addTrackToLibrary(tidalTrack) {
            // Construct data matching what 'tidal-search' does
            const artistName = tidalTrack.artist?.name || tidalTrack.artists?.[0]?.name || 'Unknown Artist';
            const title = tidalTrack.title + (tidalTrack.version ? ` (${tidalTrack.version})` : '');
            const coverUrl = tidalTrack.album?.cover
                ? `https://resources.tidal.com/images/${tidalTrack.album.cover.replace(/-/g, '/')}/640x640.jpg`
                : null;

            const trackData = {
                title: title,
                artist: artistName,
                album: tidalTrack.album?.title || null,
                duration: tidalTrack.duration || null,
                cover_url: coverUrl,
                source_type: 'tidal',
                external_id: String(tidalTrack.id),
                format: 'LOSSLESS', // Default, will resolve actual on play
                bitrate: null
            };

            // Returns track ID
            return await this.api.library.addExternalTrack(trackData);
        }
    };

    window.SpotifyConverter = SpotifyConverter;
    window.AudionPlugin = SpotifyConverter; // Register standard entry point
})();
