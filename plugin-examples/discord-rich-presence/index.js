// Discord Rich Presence Plugin for Audion

(function () {
  "use strict";

  const DiscordRPC = {
    name: "Discord Rich Presence",

    // State
    isConnected: false,
    isEnabled: true,
    currentTrack: null,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    updateTimeout: null,
    coverCache: new Map(), // Cache found covers to avoid repeated searches
    MAX_COVER_CACHE_SIZE: 100, // Limit cache size

    init(api) {
      console.log("[Discord RPC] Plugin initialized");
      this.api = api;

      // Connect to Discord immediately
      this.connect();

      // Subscribe to player events
      api.on("trackChange", (data) => this.handleTrackChange(data));
      api.on("playStateChange", (data) => this.handlePlaybackState(data));
      api.on("timeUpdate", (data) => this.handleTimeUpdate(data));
      api.on("seeked", (data) => this.handleSeeked(data));
    },

    async connect() {
      console.log("[Discord RPC] Attempting to connect...");
      try {
        const result = await this.api.discord.connect();
        console.log("[Discord RPC] ✅ Connected:", result);
        this.isConnected = true;

        // Update with current track if available
        this.updatePresence();
      } catch (error) {
        console.error("[Discord RPC] ❌ Connection failed:", error);
        this.isConnected = false;

        // Retry in 5 seconds
        setTimeout(() => this.connect(), 5000);
      }
    },

    async disconnect() {
      try {
        await this.api.discord.disconnect();
        this.isConnected = false;
        console.log("[Discord RPC] Disconnected");
      } catch (error) {
        console.error("[Discord RPC] Disconnect error:", error);
      }
    },

    async reconnect() {
      try {
        await this.api.discord.reconnect();
        this.isConnected = true;
        console.log("[Discord RPC] Reconnected");
        this.updatePresence();
      } catch (error) {
        console.error("[Discord RPC] Reconnect failed:", error);
      }
    },

    handleTrackChange(data) {
      const { track } = data;

      if (track) {
        console.log("[Discord RPC] Track changed:", track.title);
        this.currentTrack = track;
        this.duration = track.duration || 0;
        this.currentTime = 0;

        // Update immediately
        this.updatePresence();
      }
    },

    handlePlaybackState(data) {
      const { isPlaying } = data;

      console.log(
        "[Discord RPC] Playback state:",
        isPlaying ? "Playing" : "Paused",
      );
      this.isPlaying = isPlaying;

      // Update presence immediately when play/pause changes
      this.updatePresence();
    },

    handleTimeUpdate(data) {
      const { currentTime, duration } = data;

      this.currentTime = currentTime || 0;
      this.duration = duration || this.duration;

      // Schedule regular update every 10 seconds
      this.scheduleUpdate();
    },

    handleSeeked(data) {
      const { currentTime, duration } = data;
      console.log(`[Discord RPC] ⏭️ Seeked to ${Math.floor(currentTime)}s`);

      this.currentTime = currentTime || 0;
      this.duration = duration || this.duration;

      // Update immediately on seek
      this.updatePresence();
    },

    scheduleUpdate() {
      if (this.updateTimeout) {
        return; // Already scheduled
      }

      this.updateTimeout = setTimeout(() => {
        this.updatePresence();
        this.updateTimeout = null;
      }, 10000); // Update every 10 seconds for progress bar
    },

    async updatePresence() {
      if (!this.isConnected || !this.isEnabled) {
        return;
      }

      // Get current track if not set
      if (!this.currentTrack) {
        try {
          this.currentTrack = this.api.player.getCurrentTrack();
          this.isPlaying = this.api.player.isPlaying();
          this.currentTime = this.api.player.getCurrentTime();
          this.duration = this.api.player.getDuration();
        } catch (error) {
          console.log("[Discord RPC] No track playing");
          return;
        }
      }

      if (!this.currentTrack) {
        return;
      }

      // WORKAROUND: Always fetch live playback state directly from player
      // because the playbackState event listener is broken
      try {
        this.isPlaying = this.api.player.isPlaying();
        this.currentTime = this.api.player.getCurrentTime();
        this.duration = this.api.player.getDuration();
      } catch (error) {
        console.log("[Discord RPC] Failed to fetch live state:", error);
      }

      // If paused, clear the presence entirely to avoid Discord timestamp bugs
      if (!this.isPlaying) {
        console.log(
          "[Discord RPC] ⏸️ Paused - clearing presence to prevent timestamp bugs",
        );
        await this.clearPresence();
        return;
      }

      // Prepare presence data
      const presenceData = {
        song_title: this.currentTrack.title || "Unknown Track",
        artist: this.currentTrack.artist || "Unknown Artist",
        album: this.currentTrack.album || null,
        cover_url: await this.getCoverUrl(),
        current_time: Math.floor(this.currentTime),
        duration: Math.floor(this.duration),
        is_playing: this.isPlaying,
      };

      console.log(
        `[Discord RPC] Updating: "${presenceData.song_title}" by ${presenceData.artist} (${presenceData.current_time}s/${presenceData.duration}s)`,
      );

      try {
        const result = await this.api.discord.updatePresence(presenceData);
        console.log("[Discord RPC] ✅ Presence updated");
      } catch (error) {
        console.error("[Discord RPC] ❌ Update failed:", error);

        // Try to reconnect
        this.isConnected = false;
        setTimeout(() => this.reconnect(), 2000);
      }
    },

    async getCoverUrl() {
      const coverUrl = this.currentTrack?.cover_url;

      // If we already have a valid HTTP/HTTPS URL (from streaming), use it
      if (typeof coverUrl === "string") {
        try {
          const url = new URL(coverUrl);
          const isValid = url.protocol === "http:" || url.protocol === "https:";
          if (isValid) {
            return coverUrl;
          }
        } catch {}
      }

      // For local files without a valid cover URL, search Tidal
      if (this.currentTrack?.title && this.currentTrack?.artist) {
        const cacheKey = `${this.currentTrack.artist}-${this.currentTrack.title}`;

        // Check cache first
        if (this.coverCache.has(cacheKey)) {
          return this.coverCache.get(cacheKey);
        }

        // Search Tidal for cover
        const foundCover = await this.searchCoverFromTidal();
        if (foundCover) {
          this.coverCache.set(cacheKey, foundCover);
          this.pruneCache(); // clear old cache
          console.log("[Discord RPC] Found cover from Tidal:", foundCover);
          return foundCover;
        }
      }

      // No cover available - Discord will use app icon
      return null;
    },

    async searchCoverFromTidal() {
      // Use Tidal plugin's cover search if available
      if (window.TidalSearchAPI?.searchCover) {
        try {
          const trackId = this.currentTrack?.id || null;
          return await window.TidalSearchAPI.searchCover(
            this.currentTrack.title,
            this.currentTrack.artist,
            trackId, // Pass track ID so Tidal can update the database
          );
        } catch (error) {
          console.log("[Discord RPC] Tidal cover search error:", error);
        }
      } else {
        console.log(
          "[Discord RPC] Tidal Search plugin not available for cover lookup",
        );
      }

      return null;
    },

    // covercache cleanup
    pruneCache() {
      if (this.coverCache.size > this.MAX_COVER_CACHE_SIZE) {
        // Remove oldest half (FIFO)
        const entries = Array.from(this.coverCache.entries());
        const toKeep = entries.slice(-this.MAX_COVER_CACHE_SIZE / 2);
        this.coverCache.clear();
        toKeep.forEach(([key, value]) => this.coverCache.set(key, value));
      }
    },

    async clearPresence() {
      if (!this.isConnected) {
        return;
      }

      try {
        await this.api.discord.clearPresence();
        console.log("[Discord RPC] Presence cleared");
      } catch (error) {
        console.error("[Discord RPC] Clear failed:", error);
      }
    },

    start() {
      console.log("[Discord RPC] Plugin started");
      this.isEnabled = true;
      this.updatePresence();
    },

    stop() {
      console.log("[Discord RPC] Plugin stopped");
      this.isEnabled = false;
      this.clearPresence();

      // Clear update timeout
      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
        this.updateTimeout = null;
      }
    },

    destroy() {
      console.log("[Discord RPC] Plugin destroyed");
      this.disconnect();

      // Clear timeout
      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
      }
    },
  };

  // Register plugin globally
  window.DiscordRichPresence = DiscordRPC;
  window.AudionPlugin = DiscordRPC;
})();
