// Qobuz Search Plugin V2 (Fixed)
// Supports Navigation, Album View, Artist View, Search Types, and Library Integration

(function () {
  "use strict";

  const API_BASE = "https://dabmusic.xyz/api";
  const SOURCE_TYPE = "qobuz";

  const QobuzSearch = {
    name: "Qobuz Search",
    api: null,
    isOpen: false,
    searchTimeout: null,
    libraryTracks: new Set(),
    hasNewChanges: false,
    
    // State Management for Navigation
    state: {
      view: "search", // 'search', 'album', 'artist'
      searchType: "track", // 'track', 'album', 'artist'
      currentData: null,
      history: [], // Stack to manage "Back" functionality
      currentTitle: ""
    },
    
    isPlaying: null,

    init(api) {
      console.log("[QobuzSearch] Initializing...");
      this.api = api;
      
      // FIX: Fetch library tracks to check for duplicates
      this.fetchLibraryTracks();
      
      this.injectStyles();
      this.createSearchPanel();
      this.createPlayerBarButton();

      // Retry for late DOM loading
      setTimeout(() => this.createPlayerBarButton(), 500);

      // Register stream resolver
      if (api.stream && api.stream.registerResolver) {
        api.stream.registerResolver(SOURCE_TYPE, async (externalId, options) => {
          try {
            const streamData = await this.fetchStream(externalId);
            return streamData.url;
          } catch (err) {
            console.error("[QobuzSearch] Stream resolve error:", err);
            return null;
          }
        });
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // UTILITIES (Previously Missing)
    // ═══════════════════════════════════════════════════════════════════

    async fetchLibraryTracks() {
      if (this.api?.library?.getTracks) {
        try {
          const tracks = (await this.api.library.getTracks()) || [];
          if (!Array.isArray(tracks)) {
             this.libraryTracks = new Set();
             return;
          }
          // Store Qobuz IDs
          this.libraryTracks = new Set(
            tracks
              .filter((t) => t && t.source_type === SOURCE_TYPE)
              .map((t) => t.external_id)
          );
        } catch (err) {
          console.error("[QobuzSearch] Failed to fetch library tracks:", err);
        }
      }
    },

    formatDuration(sec) {
      if (!sec) return "--:--";
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    },

    escapeHtml(str) {
      if (!str) return "";
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    // ═══════════════════════════════════════════════════════════════════
    // UI CREATION & STYLES
    // ═══════════════════════════════════════════════════════════════════

    injectStyles() {
      if (document.getElementById("qobuz-search-styles-v2")) return;
      const style = document.createElement("style");
      style.id = "qobuz-search-styles-v2";
      style.textContent = `
        /* Core Panels */
        #qobuz-search-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); background: var(--bg-elevated, #181818); border: 1px solid var(--border-color, #404040); border-radius: 16px; padding: 0; width: 700px; max-height: 85vh; z-index: 10001; box-shadow: 0 20px 50px rgba(0,0,0,0.5); opacity: 0; visibility: hidden; transition: all 0.2s cubic-bezier(0, 0, 0.2, 1); display: flex; flex-direction: column; overflow: hidden; }
        #qobuz-search-panel.open { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); }
        #qobuz-search-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); z-index: 10000; opacity: 0; visibility: hidden; transition: opacity 0.2s; }
        #qobuz-search-overlay.open { opacity: 1; visibility: visible; }

        /* Header */
        .qobuz-header { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); display: flex; align-items: center; gap: 16px; background: var(--bg-elevated, #181818); flex-shrink: 0; }
        .qobuz-back-btn { background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; padding: 8px; border-radius: 50%; transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .qobuz-back-btn:hover { background: var(--bg-highlight, #333); color: #fff; }
        .qobuz-title { font-size: 18px; font-weight: 700; color: var(--text-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-close-btn { margin-left: auto; background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; font-size: 20px; }
        .qobuz-close-btn:hover { color: #fff; }

        /* Controls */
        .qobuz-controls { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); background: var(--bg-elevated, #181818); }
        .qobuz-search-row { display: flex; flex-direction: column; gap: 12px; }
        .qobuz-input-wrapper { position: relative; }
        .qobuz-input { width: 100%; padding: 10px 16px 10px 36px; border-radius: 8px; border: 1px solid var(--border-color, #404040); background: var(--bg-surface, #202020); color: #fff; font-size: 14px; outline: none; }
        .qobuz-input:focus { border-color: #1a62b9; }
        .qobuz-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #666; font-size: 14px; }

        .qobuz-tabs { display: flex; background: var(--bg-surface, #202020); padding: 4px; border-radius: 8px; }
        .qobuz-tab { flex: 1; border: none; background: transparent; color: var(--text-secondary, #888); padding: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px; transition: 0.2s; }
        .qobuz-tab:hover { color: #fff; }
        .qobuz-tab.active { background: var(--bg-elevated, #2a2a2a); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }

        /* Content */
        .qobuz-content { flex: 1; overflow-y: auto; padding: 0; position: relative; }
        .qobuz-content::-webkit-scrollbar { width: 6px; }
        .qobuz-content::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

        /* Hero Section (Album/Artist) */
        .qobuz-hero { padding: 24px; display: flex; gap: 20px; background: linear-gradient(to bottom, rgba(26, 98, 185, 0.1), transparent); }
        .qobuz-hero-cover { width: 140px; height: 140px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); object-fit: cover; background: #333; }
        .qobuz-hero-info { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 4px; }
        .qobuz-hero-type { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #aaa; margin-bottom: 4px; }
        .qobuz-hero-title { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.1; margin-bottom: 8px; }
        .qobuz-hero-meta { font-size: 13px; color: #ccc; display: flex; align-items: center; gap: 8px; }
        .qobuz-badge { background: #1a62b9; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }

        /* Track List */
        .qobuz-track-list { padding: 0 16px 24px; }
        .qobuz-track-item { display: grid; grid-template-columns: 40px 1fr auto auto; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 6px; cursor: pointer; transition: 0.2s; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .qobuz-track-item:hover { background: var(--bg-surface, #202020); }
        .qobuz-track-item.playing .qobuz-track-title { color: #1a62b9; }
        .qobuz-track-num { color: #666; font-size: 14px; text-align: center; }
        .qobuz-track-title { font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-track-artist { font-size: 12px; color: #888; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-track-time { color: #666; font-size: 12px; font-variant-numeric: tabular-nums; }
        .qobuz-track-actions { display: flex; align-items: center; gap: 8px; opacity: 0; transition: 0.2s; }
        .qobuz-track-item:hover .qobuz-track-actions { opacity: 1; }

        /* Grid Items */
        .qobuz-grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; padding: 16px; }
        .qobuz-card { background: transparent; border-radius: 8px; cursor: pointer; transition: 0.2s; }
        .qobuz-card:hover .qobuz-card-title { color: #fff; }
        .qobuz-card-img { width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; background: #333; margin-bottom: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .qobuz-card-title { font-size: 13px; font-weight: 600; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
        .qobuz-card-sub { font-size: 12px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Player Bar Button */
        .qobuz-playerbar-btn { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color, #404040); background: transparent; color: #fff; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.2s; }
        .qobuz-playerbar-btn:hover { background: var(--bg-elevated, #2a2a2a); border-color: #1a62b9; }
        .qobuz-playerbar-btn svg { fill: #1a62b9; width: 14px; height: 14px; }

        .hidden { display: none !important; }
        .text-center { text-align: center; color: #666; margin-top: 40px; }
      `;
      document.head.appendChild(style);
    },

    createSearchPanel() {
      const overlay = document.createElement("div");
      overlay.id = "qobuz-search-overlay";
      overlay.onclick = () => this.close();
      document.body.appendChild(overlay);

      const panel = document.createElement("div");
      panel.id = "qobuz-search-panel";
      panel.innerHTML = `
        <div class="qobuz-header">
          <button id="qobuz-back-btn" class="qobuz-back-btn hidden" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div class="qobuz-title" id="qobuz-panel-title">Qobuz Search</div>
          <button class="qobuz-close-btn" title="Close">✕</button>
        </div>
        
        <div id="qobuz-controls-area" class="qobuz-controls">
          <div class="qobuz-search-row">
            <div class="qobuz-input-wrapper">
              <span class="qobuz-input-icon">🔍</span>
              <input type="text" id="qobuz-search-input" class="qobuz-input" placeholder="Search tracks, albums, artists...">
            </div>
            <div class="qobuz-tabs" id="qobuz-search-tabs">
              <button class="qobuz-tab active" data-type="track">Tracks</button>
              <button class="qobuz-tab" data-type="album">Albums</button>
              <button class="qobuz-tab" data-type="artist">Artists</button>
            </div>
          </div>
        </div>

        <div id="qobuz-content-area" class="qobuz-content"></div>
      `;
      document.body.appendChild(panel);

      panel.querySelector(".qobuz-close-btn").onclick = () => this.close();
      panel.querySelector("#qobuz-back-btn").onclick = () => this.goBack();
      
      const input = panel.querySelector("#qobuz-search-input");
      input.addEventListener("input", (e) => this.handleSearch(e.target.value));
      
      panel.querySelectorAll(".qobuz-tab").forEach(btn => {
        btn.onclick = () => {
          this.state.searchType = btn.dataset.type;
          panel.querySelectorAll(".qobuz-tab").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          if(input.value) this.handleSearch(input.value);
        };
      });
    },

    createPlayerBarButton() {
      if (document.getElementById("qobuz-search-btn")) return;
      const btn = document.createElement("button");
      btn.id = "qobuz-search-btn";
      btn.className = "qobuz-playerbar-btn";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
        <span>Qobuz</span>
      `;
      btn.onclick = () => this.open();
      if (this.api?.ui?.registerSlot) {
        this.api.ui.registerSlot("playerbar:menu", btn);
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════════════

    open() {
      this.isOpen = true;
      document.getElementById("qobuz-search-overlay")?.classList.add("open");
      document.getElementById("qobuz-search-panel")?.classList.add("open");
      if (this.state.view !== 'search') this.goBack(true);
      setTimeout(() => document.querySelector("#qobuz-search-input")?.focus(), 100);
    },

    close() {
      this.isOpen = false;
      document.getElementById("qobuz-search-overlay")?.classList.remove("open");
      document.getElementById("qobuz-search-panel")?.classList.remove("open");
    },

    navigateTo(view, data, title) {
      this.state.history.push({ view: this.state.view, data: this.state.currentData, title: this.state.currentTitle });
      this.state.view = view;
      this.state.currentData = data;
      this.state.currentTitle = title;
      this.updateHeader();
      this.render();
    },

    goBack(forceReset = false) {
      if (forceReset) {
          this.state.history = [];
          this.state.view = 'search';
          this.state.currentData = null;
          this.state.currentTitle = "Qobuz Search";
          this.updateHeader();
          this.render();
          return;
      }
      if (this.state.history.length > 0) {
        const prev = this.state.history.pop();
        this.state.view = prev.view;
        this.state.currentData = prev.data;
        this.state.currentTitle = prev.title;
        this.updateHeader();
        this.render();
      } else {
        this.close();
      }
    },

    updateHeader() {
      const backBtn = document.getElementById("qobuz-back-btn");
      const title = document.getElementById("qobuz-panel-title");
      const controls = document.getElementById("qobuz-controls-area");
      title.textContent = this.state.currentTitle;
      if (this.state.view === 'search') {
        backBtn.classList.add("hidden");
        controls.classList.remove("hidden");
      } else {
        backBtn.classList.remove("hidden");
        controls.classList.add("hidden");
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // DATA FETCHING
    // ═══════════════════════════════════════════════════════════════════

    handleSearch(query) {
      clearTimeout(this.searchTimeout);
      const container = document.getElementById("qobuz-content-area");
      if (!query.trim()) { container.innerHTML = `<div class="text-center">Start typing to search</div>`; return; }
      container.innerHTML = `<div class="text-center">Searching...</div>`;
      this.searchTimeout = setTimeout(() => this.performSearch(query.trim()), 400);
    },

    async performSearch(query) {
      try {
        const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&offset=0&type=${this.state.searchType}`;
        const response = this.api.fetch ? await this.api.fetch(url) : await fetch(url);
        if (!response.ok) throw new Error("Network error");
        const data = await response.json();
        let results = [];
        if (this.state.searchType === 'track') results = data.tracks || [];
        else if (this.state.searchType === 'album') results = data.albums || [];
        else if (this.state.searchType === 'artist') results = data.artists || [];
        if (results.length === 0 && Array.isArray(data)) results = data;
        this.state.currentData = results;
        this.renderSearchResults(results);
      } catch (err) {
        console.error(err);
        document.getElementById("qobuz-content-area").innerHTML = `<div class="text-center" style="color:#f55">Error: ${err.message}</div>`;
      }
    },

    async fetchAlbumDetails(albumId) {
      try {
        const url = `${API_BASE}/album?albumId=${albumId}`;
        const response = this.api.fetch ? await this.api.fetch(url) : await fetch(url);
        if (!response.ok) throw new Error("Failed to load album");
        const data = await response.json();
        return data.album || data;
      } catch (err) {
        this.showToast("Error loading album", true);
        console.error(err);
        return null;
      }
    },

    async fetchArtistDiscography(artistId) {
      try {
        const url = `${API_BASE}/discography?artistId=${artistId}`;
        const response = this.api.fetch ? await this.api.fetch(url) : await fetch(url);
        if (!response.ok) throw new Error("Failed to load artist");
        const data = await response.json();
        return data;
      } catch (err) {
        this.showToast("Error loading artist", true);
        console.error(err);
        return null;
      }
    },

    async fetchStream(trackId) {
      const url = `${API_BASE}/stream?trackId=${trackId}`;
      const response = this.api.fetch ? await this.api.fetch(url) : await fetch(url);
      const data = await response.json();
      return data;
    },

    // ═══════════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════════

    render() {
      const container = document.getElementById("qobuz-content-area");
      if (this.state.view === 'search') {
        if (!container.innerHTML.includes('qobuz') && this.state.currentData) this.renderSearchResults(this.state.currentData);
      } else if (this.state.view === 'album') {
        this.renderAlbumView(this.state.currentData);
      } else if (this.state.view === 'artist') {
        this.renderArtistView(this.state.currentData);
      }
    },

    renderSearchResults(results) {
      const container = document.getElementById("qobuz-content-area");
      if (!results || results.length === 0) { container.innerHTML = `<div class="text-center">No results found</div>`; return; }
      if (this.state.searchType === 'track') {
        container.innerHTML = `<div class="qobuz-track-list">${results.map(t => this.renderTrackItem(t, false)).join('')}</div>`;
        this.attachTrackListeners(container, results);
      } else {
        const isAlbum = this.state.searchType === 'album';
        container.innerHTML = `<div class="qobuz-grid-list">${results.map(item => this.renderCard(item, isAlbum)).join('')}</div>`;
        this.attachCardListeners(container, results, isAlbum);
      }
    },

    renderAlbumView(album) {
      const container = document.getElementById("qobuz-content-area");
      const audioInfo = album.audioQuality || {};
      const badge = (audioInfo.isHiRes) ? '<span class="qobuz-badge">Hi-Res</span>' : '';
      const tracksHtml = album.tracks.map((t, i) => this.renderTrackItem({ ...t, albumTitle: album.title, artist: album.artist }, true, i + 1)).join('');
      container.innerHTML = `
        <div class="qobuz-hero">
          <img src="${album.cover}" class="qobuz-hero-cover" onerror="this.src='https://picsum.photos/200'">
          <div class="qobuz-hero-info">
            <div class="qobuz-hero-type">Album ${badge}</div>
            <div class="qobuz-hero-title">${this.escapeHtml(album.title)}</div>
            <div class="qobuz-hero-meta"><span>${this.escapeHtml(album.artist)}</span> • <span>${album.releaseDate ? album.releaseDate.split('-')[0] : '----'}</span> • <span>${album.tracks.length} songs</span></div>
          </div>
        </div>
        <div class="qobuz-track-list">${tracksHtml}</div>
      `;
      this.attachTrackListeners(container, album.tracks);
    },

    renderArtistView(data) {
      const container = document.getElementById("qobuz-content-area");
      const artist = data.artist || {};
      const albums = data.albums || [];
      const html = `
        <div style="padding: 24px; display:flex; align-items:center; gap:20px;">
           <div style="width:120px; height:120px; background:#333; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:40px; color:#555;">🎤</div>
           <div><div class="qobuz-hero-title">${this.escapeHtml(artist.name || 'Unknown Artist')}</div><div style="color:#aaa; font-size:14px;">${albums.length} Albums</div></div>
        </div>
        <div style="padding:0 16px 24px; font-size:14px; font-weight:700; color:#fff;">Discography</div>
        <div class="qobuz-grid-list">${albums.map(a => this.renderCard(a, true)).join('')}</div>
      `;
      container.innerHTML = html;
      this.attachCardListeners(container, albums, true);
    },

    renderTrackItem(track, isCompact = false, index = null) {
      const isPlaying = this.isPlaying == track.id;
      const titleClass = isPlaying ? "color: #1a62b9;" : "";
      return `
        <div class="qobuz-track-item ${isPlaying ? 'playing' : ''}" data-id="${track.id}">
          <div class="qobuz-track-num">${index !== null ? index : (isPlaying ? '▶' : '')}</div>
          <div>
            <div class="qobuz-track-title" style="${titleClass}">${this.escapeHtml(track.title)}</div>
            ${!isCompact ? `<div class="qobuz-track-artist">${this.escapeHtml(track.artist)}</div>` : ''}
          </div>
          ${!isCompact ? `<div class="qobuz-track-time">${this.formatDuration(track.duration)}</div>` : ''}
          <div class="qobuz-track-actions">
             <button class="qobuz-save-btn-mini" title="Add to Library"><svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>
          </div>
        </div>
      `;
    },

    renderCard(item, isAlbum) {
      const imgUrl = isAlbum ? item.cover : (item.image || `https://ui-avatars.com/api/?name=${item.name}&background=333&color=fff`);
      const title = isAlbum ? item.title : item.name;
      const sub = isAlbum ? item.artist : (item.albumsCount || 'Artist');
      return `
        <div class="qobuz-card" data-id="${item.id}">
          <img src="${imgUrl}" class="qobuz-card-img" loading="lazy">
          <div class="qobuz-card-title">${this.escapeHtml(title)}</div>
          <div class="qobuz-card-sub">${this.escapeHtml(sub)}</div>
        </div>
      `;
    },

    attachTrackListeners(container, tracks) {
      container.querySelectorAll('.qobuz-track-item').forEach((el, idx) => {
        el.onclick = (e) => {
          if(e.target.closest('.qobuz-save-btn-mini')) { this.saveTrack(tracks[idx]); return; }
          this.playTrack(tracks[idx]);
        };
      });
    },

    attachCardListeners(container, items, isAlbum) {
      container.querySelectorAll('.qobuz-card').forEach((el, idx) => {
        el.onclick = () => {
          const item = items[idx];
          if (isAlbum) this.loadAlbumPage(item.id, item.title);
          else this.loadArtistPage(item.id, item.name);
        };
      });
    },

    async loadAlbumPage(id, title) {
      this.showToast("Loading Album...");
      const albumData = await this.fetchAlbumDetails(id);
      if (albumData) this.navigateTo('album', albumData, title);
    },

    async loadArtistPage(id, name) {
      this.showToast("Loading Artist...");
      const artistData = await this.fetchArtistDiscography(id);
      if (artistData) this.navigateTo('artist', artistData, name);
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════

    async playTrack(track) {
      try {
        const streamData = await this.fetchStream(track.id);
        if (!streamData.url) throw new Error("No stream URL");
        this.isPlaying = track.id;
        document.querySelectorAll('.qobuz-track-item').forEach(el => { el.classList.toggle('playing', el.dataset.id == track.id); });
        const audio = document.querySelector("audio");
        if (audio) {
          audio.src = streamData.url;
          if(this.api?.player?.setTrack) {
            this.api.player.setTrack({ id: track.id, title: track.title, artist: track.artist, album: track.albumTitle, cover_url: track.albumCover || track.images?.large });
          }
          audio.play().catch(e => console.log(e));
        }
      } catch (err) { this.showToast("Playback Error", true); }
    },

    async saveTrack(track) {
      try {
         if (this.api?.library?.addExternalTrack) {
            await this.api.library.addExternalTrack({
               title: track.title, artist: track.artist, album: track.albumTitle,
               duration: track.duration, cover_url: track.albumCover || track.images?.large,
               source_type: SOURCE_TYPE, external_id: String(track.id)
            });
            this.showToast(`Saved ${track.title}`);
         }
      } catch (e) { this.showToast("Error saving track", true); }
    },

    showToast(msg, isError = false) {
      const toast = document.createElement("div");
      toast.style.cssText = `position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:${isError ? '#f55' : '#333'}; color:#fff; padding:10px 20px; border-radius:8px; z-index:10002; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.3); opacity:0; transition:0.3s;`;
      toast.textContent = msg;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.style.opacity = '1');
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    },

    start() {},
    stop() { this.close(); },
    destroy() {
      this.close();
      document.getElementById("qobuz-search-styles-v2")?.remove();
      document.getElementById("qobuz-search-panel")?.remove();
      document.getElementById("qobuz-search-overlay")?.remove();
      document.getElementById("qobuz-search-btn")?.remove();
    }
  };

  window.QobuzSearch = QobuzSearch;
  window.AudionPlugin = QobuzSearch;
})();
