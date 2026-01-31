// Qobuz Search Plugin V3 (Enhanced)
// SVG Icons, Track Covers, Skeleton Loading, Save All Functionality

(function () {
  "use strict";

  const API_BASE = "https://dabmusic.xyz/api";
  const SOURCE_TYPE = "qobuz";

  // SVG Icons definition
  const ICONS = {
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    mic: `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,
    play: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
    heart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
    heartOutline: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
    download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
  };

  const QobuzSearch = {
    name: "Qobuz Search",
    api: null,
    isOpen: false,
    searchTimeout: null,
    libraryTracks: new Set(),
    hasNewChanges: false,

    state: {
      view: "search",
      searchType: "track",
      currentData: null,
      history: [],
      currentTitle: ""
    },

    isPlaying: null,

    init(api) {
      console.log("[QobuzSearch] Initializing...");
      this.api = api;
      this.fetchLibraryTracks();
      this.injectStyles();
      this.createSearchPanel();
      this.createPlayerBarButton();

      setTimeout(() => this.createPlayerBarButton(), 500);

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

    async fetchLibraryTracks() {
      if (this.api?.library?.getTracks) {
        try {
          const tracks = (await this.api.library.getTracks()) || [];
          if (!Array.isArray(tracks)) {
            this.libraryTracks = new Set();
            return;
          }
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

    injectStyles() {
      if (document.getElementById("qobuz-search-styles-v3")) return;
      const style = document.createElement("style");
      style.id = "qobuz-search-styles-v3";
      style.textContent = `
        /* Core Panels */
        #qobuz-search-panel { 
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); 
          background: var(--bg-elevated, #181818); 
          border: 1px solid var(--border-color, #333); 
          border-radius: 12px; padding: 0; width: 700px; max-height: 85vh; z-index: 10001; 
          box-shadow: 0 20px 50px rgba(0,0,0,0.5); 
          opacity: 0; visibility: hidden; 
          transition: all 0.2s cubic-bezier(0, 0, 0.2, 1); 
          display: flex; flex-direction: column; overflow: hidden; 
        }
        #qobuz-search-panel.open { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); }
        #qobuz-search-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); z-index: 10000; opacity: 0; visibility: hidden; transition: opacity 0.2s; }
        #qobuz-search-overlay.open { opacity: 1; visibility: visible; }

        /* Header */
        .qobuz-header { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); display: flex; align-items: center; gap: 16px; background: var(--bg-elevated, #181818); flex-shrink: 0; }
        .qobuz-back-btn { background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; padding: 8px; border-radius: 50%; transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .qobuz-back-btn:hover { background: var(--bg-highlight, #333); color: var(--text-primary, #fff); }
        .qobuz-title { font-size: 18px; font-weight: 700; color: var(--text-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-close-btn { margin-left: auto; background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; font-size: 20px; transition: 0.2s; }
        .qobuz-close-btn:hover { color: var(--text-primary, #fff); }

        /* Controls */
        .qobuz-controls { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); background: var(--bg-elevated, #181818); }
        .qobuz-search-row { display: flex; flex-direction: column; gap: 12px; }
        .qobuz-input-wrapper { position: relative; }
        .qobuz-input { width: 100%; padding: 10px 16px 10px 40px; border-radius: 8px; border: 1px solid var(--border-color, #404040); background: var(--bg-surface, #202020); color: var(--text-primary, #fff); font-size: 14px; outline: none; transition: border-color 0.2s; }
        .qobuz-input:focus { border-color: var(--accent-primary, #1a62b9); }
        .qobuz-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-subdued, #666); font-size: 14px; display: flex; align-items: center; }

        .qobuz-tabs { display: flex; background: var(--bg-surface, #202020); padding: 4px; border-radius: 8px; gap: 4px; }
        .qobuz-tab { flex: 1; border: none; background: transparent; color: var(--text-secondary, #888); padding: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px; transition: 0.2s; }
        .qobuz-tab:hover { color: var(--text-primary, #fff); background: rgba(255,255,255,0.05); }
        .qobuz-tab.active { background: var(--bg-highlight, #2a2a2a); color: var(--text-primary, #fff); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }

        /* Content */
        .qobuz-content { flex: 1; overflow-y: auto; padding: 0; position: relative; background: var(--bg-base, #121212); }
        .qobuz-content::-webkit-scrollbar { width: 8px; }
        .qobuz-content::-webkit-scrollbar-thumb { background: var(--bg-highlight, #333); border-radius: 4px; }

        /* Hero Section */
        .qobuz-hero { padding: 24px; display: flex; gap: 24px; background: linear-gradient(to bottom, rgba(26, 98, 185, 0.1), transparent); }
        .qobuz-hero-cover { width: 160px; height: 160px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); object-fit: cover; background: var(--bg-surface, #202020); }
        .qobuz-hero-info { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 4px; }
        .qobuz-hero-type { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: var(--text-secondary, #aaa); margin-bottom: 6px; }
        .qobuz-hero-title { font-size: 28px; font-weight: 800; color: var(--text-primary, #fff); line-height: 1.2; margin-bottom: 12px; }
        .qobuz-hero-meta { font-size: 13px; color: var(--text-secondary, #ccc); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .qobuz-badge { background: var(--accent-primary, #1a62b9); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; }
        
        /* Save All Button */
        .qobuz-save-all-btn {
            background: transparent; border: 1px solid var(--border-color, #444); color: var(--text-primary, #fff);
            padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; transition: 0.2s;
        }
        .qobuz-save-all-btn:hover { border-color: var(--accent-primary, #1a62b9); color: var(--accent-primary, #1a62b9); }

        /* Track List */
        .qobuz-track-list { padding: 8px 16px 24px; }
        .qobuz-track-item { 
            display: grid; 
            grid-template-columns: 48px 1fr auto auto; /* Cover, Info, Time, Action */
            align-items: center; 
            gap: 12px; 
            padding: 8px 8px; 
            border-radius: 6px; 
            cursor: pointer; 
            transition: 0.2s; 
            border-bottom: 1px solid rgba(255,255,255,0.03); 
        }
        .qobuz-track-item:hover { background: var(--bg-surface, #202020); }
        .qobuz-track-item.playing .qobuz-track-title { color: var(--accent-primary, #1a62b9); }
        
        .qobuz-track-cover-wrapper { position: relative; width: 48px; height: 48px; border-radius: 4px; overflow: hidden; background: #2a2a2a; flex-shrink: 0; }
        .qobuz-track-cover { width: 100%; height: 100%; object-fit: cover; }
        .qobuz-play-overlay {
            position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: 0.2s; color: white;
        }
        .qobuz-track-item:hover .qobuz-play-overlay { opacity: 1; }
        .qobuz-track-item.playing .qobuz-play-overlay { opacity: 1; background: rgba(26, 98, 185, 0.2); color: var(--accent-primary, #1a62b9); }

        .qobuz-track-title { font-size: 14px; color: var(--text-primary, #fff); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-track-artist { font-size: 12px; color: var(--text-secondary, #888); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qobuz-track-time { color: var(--text-subdued, #666); font-size: 12px; font-variant-numeric: tabular-nums; }
        
        /* Clickable Artist */
        .qobuz-clickable-artist { cursor: pointer; transition: color 0.2s; }
        .qobuz-clickable-artist:hover { color: var(--accent-primary, #1a62b9); text-decoration: underline; }

        .qobuz-track-actions { display: flex; align-items: center; gap: 8px; opacity: 0; transition: 0.2s; }
        .qobuz-track-item:hover .qobuz-track-actions { opacity: 1; }
        .qobuz-save-btn-mini { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .qobuz-save-btn-mini:hover { color: var(--text-primary); transform: scale(1.1); }
        .qobuz-save-btn-mini.saved { color: var(--accent-primary); opacity: 1 !important; }
        .qobuz-track-item .qobuz-save-btn-mini.saved { opacity: 1; }

        /* Grid Items */
        .qobuz-grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 20px; }
        .qobuz-card { background: var(--bg-elevated, #181818); padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
        .qobuz-card:hover { background: var(--bg-surface, #202020); transform: translateY(-4px); border-color: var(--bg-highlight, #333); }
        .qobuz-card-img { width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; background: var(--bg-surface, #202020); margin-bottom: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .qobuz-card-title { font-size: 14px; font-weight: 600; color: var(--text-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
        .qobuz-card-sub { font-size: 12px; color: var(--text-secondary, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Skeleton Loading */
        .qobux-skeleton { background: #2a2a2a; border-radius: 4px; animation: qobux-pulse 1.5s infinite ease-in-out; }
        @keyframes qobux-pulse { 0% { opacity: 0.4; } 50% { opacity: 0.7; } 100% { opacity: 0.4; } }
        .qobux-skeleton-row { height: 56px; margin-bottom: 8px; border-radius: 8px; background: #222; animation: qobux-pulse 1.5s infinite; }
        .qobux-skeleton-card { aspect-ratio: 1; border-radius: 6px; background: #222; animation: qobux-pulse 1.5s infinite; }

        /* Player Bar Button */
        .qobuz-playerbar-btn { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 20px; border: 1px solid var(--border-color, #404040); background: transparent; color: #fff; cursor: pointer; font-size: 13px; font-weight: 700; transition: 0.2s; }
        .qobuz-playerbar-btn:hover { background: var(--bg-highlight, #2a2a2a); border-color: var(--accent-primary, #1a62b9); transform: scale(1.05); }
        .qobuz-playerbar-btn svg { fill: var(--accent-primary, #1a62b9); width: 16px; height: 16px; }

        .hidden { display: none !important; }
        .text-center { text-align: center; color: var(--text-subdued, #666); margin-top: 60px; font-size: 14px; }
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
              <div class="qobuz-input-icon">${ICONS.search}</div>
              <input type="text" id="qobuz-search-input" class="qobuz-input" placeholder="Search tracks, albums, artists...">
            </div>
            <div class="qobuz-tabs" id="qobuz-search-tabs">
              <button class="qobuz-tab active" data-type="track">Tracks</button>
              <button class="qobuz-tab" data-type="album">Albums</button>
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
          if (input.value) this.handleSearch(input.value);
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
      this.renderSkeleton('search');
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
      this.renderSkeleton('album');
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
      this.renderSkeleton('artist');
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

    renderSkeleton(type) {
      const container = document.getElementById("qobuz-content-area");
      if (type === 'search' && this.state.searchType === 'track') {
        container.innerHTML = Array(6).fill('<div class="qobux-skeleton-row"></div>').join('');
      } else if (type === 'search' || type === 'artist') {
        container.innerHTML = `<div style="padding:20px; display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:20px;">` +
          Array(8).fill('<div class="qobux-skeleton-card"></div>').join('') + '</div>';
      } else if (type === 'album') {
        container.innerHTML = `
           <div style="padding:24px; display:flex; gap:24px;">
             <div class="qobux-skeleton" style="width:160px; height:160px;"></div>
             <div style="flex:1; display:flex; flex-direction:column; justify-content:center; gap:12px;">
                <div class="qobux-skeleton" style="width:60%; height:24px;"></div>
                <div class="qobux-skeleton" style="width:40%; height:16px;"></div>
             </div>
           </div>
           <div style="padding:0 16px 24px;">
             ${Array(5).fill('<div class="qobux-skeleton-row"></div>').join('')}
           </div>
         `;
      }
    },

    render() {
      const container = document.getElementById("qobuz-content-area");
      if (this.state.view === 'search') {
        if (!container.innerHTML.includes('qobux') && this.state.currentData) this.renderSearchResults(this.state.currentData);
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
      const tracksHtml = album.tracks.map((t, i) => this.renderTrackItem({ ...t, albumTitle: album.title, artist: album.artist, albumCover: album.cover }, true, i + 1)).join('');

      container.innerHTML = `
        <div class="qobuz-hero">
          <img src="${album.cover}" class="qobuz-hero-cover" onerror="this.src='https://picsum.photos/200'">
          <div class="qobuz-hero-info">
            <div class="qobuz-hero-type">Album ${badge}</div>
            <div class="qobuz-hero-title">${this.escapeHtml(album.title)}</div>
            <div class="qobuz-hero-meta">
              <span class="qobuz-clickable-artist" data-artist-id="${album.artistId || ''}">${this.escapeHtml(album.artist)}</span> 
              • <span>${album.releaseDate ? album.releaseDate.split('-')[0] : '----'}</span> 
              • <span>${album.tracks.length} songs</span>
            </div>
            <button id="qobuz-save-all-btn" class="qobuz-save-all-btn">
               ${ICONS.download} Save All Tracks
            </button>
          </div>
        </div>
        <div class="qobuz-track-list">${tracksHtml}</div>
      `;

      // Attach Listeners
      const heroArtist = container.querySelector('.qobuz-hero .qobuz-clickable-artist');
      if (heroArtist) {
        heroArtist.onclick = () => {
          if (album.artistId) this.loadArtistPage(album.artistId, album.artist);
        };
      }

      const saveAllBtn = container.querySelector('#qobuz-save-all-btn');
      if (saveAllBtn) {
        saveAllBtn.onclick = () => this.saveAllAlbumTracks(album);
      }

      this.attachTrackListeners(container, album.tracks);
    },

    renderArtistView(data) {
      const container = document.getElementById("qobuz-content-area");
      const artist = data.artist || {};
      const albums = data.albums || [];
      const html = `
        <div class="qobuz-hero">
           <div style="width:160px; height:160px; background:var(--bg-surface, #202020); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(0,0,0,0.3);">${ICONS.mic}</div>
           <div class="qobuz-hero-info">
             <div class="qobuz-hero-type">Artist</div>
             <div class="qobuz-hero-title">${this.escapeHtml(artist.name || 'Unknown Artist')}</div>
             <div class="qobuz-hero-meta"><span>${albums.length} Albums</span></div>
           </div>
        </div>
        <div style="padding:16px 24px 8px; font-size:18px; font-weight:700; color:var(--text-primary, #fff);">Discography</div>
        <div class="qobuz-grid-list">${albums.map(a => this.renderCard(a, true)).join('')}</div>
      `;
      container.innerHTML = html;
      this.attachCardListeners(container, albums, true);
    },

    renderTrackItem(track, isCompact = false, index = null) {
      const isPlaying = this.isPlaying == track.id;
      const isSaved = this.libraryTracks.has(String(track.id));
      // Determine cover: track cover first, or albumCover passed from parent, or default
      const coverUrl = track.cover || track.albumCover || track.images?.large || '';

      return `
        <div class="qobuz-track-item ${isPlaying ? 'playing' : ''}" data-id="${track.id}">
          <div class="qobuz-track-cover-wrapper">
             <img src="${coverUrl}" class="qobuz-track-cover" loading="lazy" onerror="this.style.display='none'">
             <div class="qobuz-play-overlay">${isPlaying ? ICONS.play : ''}</div>
          </div>
          <div>
            <div class="qobuz-track-title">${this.escapeHtml(track.title)}</div>
            ${!isCompact ? `<div class="qobuz-track-artist"><span class="qobuz-clickable-artist" data-artist-id="${track.artistId || ''}">${this.escapeHtml(track.artist)}</span></div>` : ''}
          </div>
          ${!isCompact ? `<div class="qobuz-track-time">${this.formatDuration(track.duration)}</div>` : ''}
          <div class="qobuz-track-actions">
             <button class="qobuz-save-btn-mini ${isSaved ? 'saved' : ''}" title="${isSaved ? 'Saved to Library' : 'Add to Library'}">
                ${isSaved ? ICONS.heart : ICONS.heartOutline}
             </button>
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
          const artistClick = e.target.closest('.qobuz-clickable-artist');
          if (artistClick) {
            const artistId = artistClick.dataset.artistId;
            const artistName = artistClick.textContent;
            if (artistId) this.loadArtistPage(artistId, artistName);
            return;
          }
          const saveBtn = e.target.closest('.qobuz-save-btn-mini');
          if (saveBtn) { this.saveTrack(tracks[idx], saveBtn); return; }
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
          if (this.api?.player?.setTrack) {
            this.api.player.setTrack({ id: track.id, title: track.title, artist: track.artist, album: track.albumTitle, cover_url: track.cover || track.albumCover || track.images?.large });
          }
          audio.play().catch(e => console.log(e));
        }
      } catch (err) { this.showToast("Playback Error", true); }
    },

    async saveTrack(track, btn) {
      try {
        if (this.libraryTracks.has(String(track.id))) {
          this.showToast("Already in library");
          return;
        }

        if (this.api?.library?.addExternalTrack) {
          await this.api.library.addExternalTrack({
            title: track.title, artist: track.artist, album: track.albumTitle,
            duration: track.duration, cover_url: track.cover || track.albumCover || track.images?.large,
            source_type: SOURCE_TYPE, external_id: String(track.id)
          });

          this.libraryTracks.add(String(track.id));
          if (btn) {
            btn.classList.add('saved');
            btn.innerHTML = ICONS.heart;
            btn.title = "Saved to Library";
          }
          this.showToast(`Saved ${track.title}`);

          // Refresh library and close panel after a short delay
          if (this.api?.library?.refresh) await this.api.library.refresh();
        }
      } catch (e) { this.showToast("Error saving track", true); }
    },

    async saveAllAlbumTracks(album) {
      const btn = document.getElementById('qobuz-save-all-btn');
      if (!btn || !album.tracks) return;

      btn.disabled = true;
      btn.textContent = "Saving...";

      let savedCount = 0;
      let alreadyCount = 0;

      for (const track of album.tracks) {
        try {
          // Check if already saved
          if (this.libraryTracks.has(String(track.id))) {
            alreadyCount++;
            continue;
          }

          if (this.api?.library?.addExternalTrack) {
            await this.api.library.addExternalTrack({
              title: track.title, artist: track.artist, album: track.albumTitle,
              duration: track.duration, cover_url: album.cover, // Use Album cover for all tracks
              source_type: SOURCE_TYPE, external_id: String(track.id)
            });
            savedCount++;
            this.libraryTracks.add(String(track.id)); // Add to local set

            // Update UI for the specific row
            const row = document.querySelector(`.qobuz-track-item[data-id="${track.id}"]`);
            if (row) {
              const miniBtn = row.querySelector('.qobuz-save-btn-mini');
              if (miniBtn) {
                miniBtn.classList.add('saved');
                miniBtn.innerHTML = ICONS.heart;
                miniBtn.title = "Saved to Library";
              }
            }
          }
        } catch (e) {
          console.error("Failed to save track", track.id, e);
        }
      }

      // Refresh library tracks and close panel
      if (this.api?.library?.refresh) await this.api.library.refresh();
      else this.fetchLibraryTracks();

      // UI Feedback
      if (savedCount > 0) {
        this.showToast(`Saved ${savedCount} tracks to library`);
        btn.textContent = "Saved!";
      } else if (alreadyCount > 0) {
        this.showToast(`All ${alreadyCount} tracks already in library`);
        btn.textContent = "Already Saved";
      }

      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `${ICONS.download} Save All Tracks`;
      }, 3000);
    },

    showToast(msg, isError = false) {
      const toast = document.createElement("div");
      toast.style.cssText = `position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:${isError ? '#f55' : '#333'}; color:#fff; padding:10px 20px; border-radius:8px; z-index:10002; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.3); opacity:0; transition:0.3s;`;
      toast.textContent = msg;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.style.opacity = '1');
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    },

    start() { },
    stop() { this.close(); },
    destroy() {
      this.close();
      document.getElementById("qobuz-search-styles-v3")?.remove();
      document.getElementById("qobuz-search-panel")?.remove();
      document.getElementById("qobuz-search-overlay")?.remove();
      document.getElementById("qobuz-search-btn")?.remove();
    }
  };

  window.QobuzSearch = QobuzSearch;
  window.AudionPlugin = QobuzSearch;
})();