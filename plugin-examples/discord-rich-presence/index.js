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

    init(api) {
      console.log("[Discord RPC] Plugin initialized");
      this.api = api;

      // Connect to Discord immediately
      this.connect();

      // Subscribe to player events
      api.on("trackChange", (data) => this.handleTrackChange(data));
      api.on("playbackState", (data) => this.handlePlaybackState(data));
      api.on("timeUpdate", (data) => this.handleTimeUpdate(data));

      console.log("[Discord RPC] Event listeners registered");
    },

    async connect() {
      try {
        const result = await this.api.discord.connect();
        console.log("[Discord RPC]", result);
        this.isConnected = true;

        // Update with current track if available
        this.updatePresence();
      } catch (error) {
        console.error("[Discord RPC] Connection failed:", error);
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

      // Update every 10 seconds for smoother progress bar
      this.scheduleUpdate();
    },

    scheduleUpdate() {
      if (this.updateTimeout) {
        return; // Already scheduled
      }

      this.updateTimeout = setTimeout(() => {
        this.updatePresence();
        this.updateTimeout = null;
      }, 10000); // Update every 10 seconds for better accuracy
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

      // Prepare presence data
      const presenceData = {
        song_title: this.currentTrack.title || "Unknown Track",
        artist: this.currentTrack.artist || "Unknown Artist",
        album: this.currentTrack.album || null,
        cover_url: this.getCoverUrl(),
        current_time: Math.floor(this.currentTime),
        duration: Math.floor(this.duration),
        is_playing: this.isPlaying,
      };

      // debug
      console.log("[Discord RPC] Full presence data being sent:", presenceData);
      console.log("[Discord RPC] Cover URL:", presenceData.cover_url);
      console.log("[Discord RPC] Current track object:", this.currentTrack);

      try {
        await this.api.discord.updatePresence(presenceData);
        console.log("[Discord RPC] Presence updated:", {
          title: presenceData.song_title,
          artist: presenceData.artist,
          time: `${presenceData.current_time}/${presenceData.duration}`,
          playing: presenceData.is_playing,
        });
      } catch (error) {
        console.error("[Discord RPC] Update failed:", error);

        // Try to reconnect
        this.isConnected = false;
        setTimeout(() => this.reconnect(), 2000);
      }
    },

    // cover
    // discord needs a http link. it can't access local files
    // currently using a fixed logo from the uploaded assets
    // todo -create a server to server covers as http urls
    getCoverUrl() {
      const coverUrl = this.currentTrack?.cover_url;
      if (typeof coverUrl !== "string") return null;
    
      try {
        const url = new URL(coverUrl);
        return url.protocol === "http:" || url.protocol === "https:"
          ? coverUrl
          : null;
      } catch {
        return null;
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
