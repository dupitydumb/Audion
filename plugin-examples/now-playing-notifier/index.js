// ═══════════════════════════════════════════════════════════════════════════
// NOW PLAYING NOTIFIER PLUGIN
// Shows desktop notifications when tracks change with customizable settings
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  "use strict";

  const NowPlayingNotifier = {
    name: "Now Playing Notifier",

    // Default Configuration
    settings: {
      enabled: true,
      notificationDuration: 5000, // milliseconds
      titleLeft: "custom",
      titleRight: "none",
      titleCustomLeft: "Now Playing",
      titleCustomRight: "",
      bodyLeft: "track_title",
      bodyRight: "artist",
      bodyCustomLeft: "",
      bodyCustomRight: "",
    },

    // State management for queue system
    isNotificationActive: false,
    activeNotificationTimer: null,
    queuedTrack: null,
    notificationIdCounter: 1,
    isSettingsOpen: false,

    async init(api) {
      this.api = api;

      // Load saved settings
      await this.loadSettings();

      // Inject styles and create UI
      this.injectStyles();
      this.createSettingsModal();
      this.createMenuButton();

      // Register event listener
      api.on("trackChange", (data) => this.handleTrackChange(data));
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SETTINGS MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    async loadSettings() {
      try {
        const saved = await this.api.storage.get("settings");
        if (saved) {
          this.settings = { ...this.settings, ...JSON.parse(saved) };
        }
      } catch (e) {
        console.error("[NowPlayingNotifier] Failed to load settings:", e);
      }
    },

    async saveSettings() {
      try {
        await this.api.storage.set(
          "settings",
          JSON.stringify(this.settings),
        );
      } catch (e) {
        console.error("[NowPlayingNotifier] Failed to save settings:", e);
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UI INJECTION
    // ═══════════════════════════════════════════════════════════════════════

    injectStyles() {
      if (document.getElementById("npn-styles")) return;

      const style = document.createElement("style");
      style.id = "npn-styles";
      style.textContent = `
        /* Overlay */
        #npn-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          z-index: 10000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease;
        }
        #npn-overlay.open {
          opacity: 1;
          visibility: visible;
        }

        /* Modal */
        #npn-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          background: var(--bg-elevated);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          width: 550px;
          max-width: 90vw;
          max-height: 85vh;
          z-index: 10001;
          box-shadow: var(--shadow-lg);
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        #npn-modal.open {
          opacity: 1;
          visibility: visible;
          transform: translate(-50%, -50%) scale(1);
        }

        /* Header */
        .npn-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          flex-shrink: 0;
          padding: 24px 24px 0 24px;
        }
        .npn-header h2 {
          margin: 0;
          color: var(--text-primary);
          font-size: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .npn-modal-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 0 24px 24px 24px;
          overscroll-behavior-y: contain;
        }
        .npn-icon {
          color: var(--accent-primary);
        }
        .npn-close-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 20px;
          cursor: pointer;
          padding: 4px;
          transition: color 0.2s;
        }
        .npn-close-btn:hover {
          color: var(--text-primary);
        }

        /* Settings Section */
        .npn-section {
          margin-bottom: 24px;
        }
        .npn-section:last-child {
          margin-bottom: 0;
        }

        /* Toggle Section */
        .npn-toggle-section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          background: var(--bg-surface);
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .npn-toggle-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .npn-toggle-title {
          color: var(--text-primary);
          font-weight: 600;
          font-size: 15px;
        }
        .npn-toggle-desc {
          color: var(--text-secondary);
          font-size: 13px;
        }

        /* Toggle Switch */
        .npn-toggle {
          position: relative;
          width: 48px;
          height: 26px;
        }
        .npn-toggle input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .npn-toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--bg-highlight);
          transition: 0.3s;
          border-radius: 26px;
        }
        .npn-toggle-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .npn-toggle input:checked + .npn-toggle-slider {
          background: var(--accent-primary);
        }
        .npn-toggle input:checked + .npn-toggle-slider:before {
          transform: translateX(22px);
        }

        /* Settings Container */
        .npn-settings-container {
          transition: opacity 0.3s, filter 0.3s;
        }
        .npn-settings-container.disabled {
          opacity: 0.5;
          filter: grayscale(0.5);
          pointer-events: none;
        }

        /* Field Group */
        .npn-field {
          margin-bottom: 20px;
        }
        .npn-field:last-child {
          margin-bottom: 0;
        }
        .npn-label {
          display: block;
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .npn-hint {
          display: block;
          color: var(--text-secondary);
          font-size: 12px;
          margin-top: 6px;
        }

        /* Slider */
        .npn-slider-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .npn-slider-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .npn-slider-value {
          color: var(--text-primary);
          font-weight: 600;
          font-size: 14px;
          padding: 4px 10px;
          background: var(--bg-surface);
          border-radius: 4px;
        }
        .npn-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: var(--bg-surface);
          outline: none;
          transition: background 0.2s;
        }
        .npn-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent-primary);
          cursor: pointer;
          transition: transform 0.2s;
        }
        .npn-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }
        .npn-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent-primary);
          cursor: pointer;
          border: none;
          transition: transform 0.2s;
        }
        .npn-slider::-moz-range-thumb:hover {
          transform: scale(1.2);
        }

        /* Format Builder */
        .npn-format-builder {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .npn-format-part {
          flex: 1;
        }
        .npn-separator {
          color: var(--text-secondary);
          font-weight: 600;
          font-size: 18px;
          padding: 0 4px;
        }

        /* Dropdown */
        .npn-select {
          width: 100%;
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .npn-select:focus {
          outline: none;
          border-color: var(--accent-primary);
        }
        .npn-select:hover {
          border-color: var(--text-secondary);
        }
        .npn-select option {
          background: var(--bg-surface);
          color: var(--text-primary);
        }

        /* Input */
        .npn-input {
          width: 100%;
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 14px;
          transition: border-color 0.2s;
        }
        .npn-input:focus {
          outline: none;
          border-color: var(--accent-primary);
        }
        .npn-input::placeholder {
          color: var(--text-secondary);
        }

        /* Format Preview */
        .npn-preview {
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          margin-top: 16px;
        }
        .npn-preview-title {
          color: var(--text-secondary);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .npn-preview-content {
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.5;
        }
        .npn-preview-title-text {
          font-weight: 600;
          margin-bottom: 2px;
        }
        .npn-preview-body-text {
          color: var(--text-secondary);
        }

        /* Buttons */
        .npn-button-group {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid var(--border-color);
        }
        .npn-btn {
          background: var(--accent-primary);
          color: #fff;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
        }
        .npn-btn:hover:not(:disabled) {
          background: var(--accent-hover);
          transform: scale(1.02);
        }
        .npn-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .npn-btn.secondary {
          background: var(--bg-highlight);
          color: var(--text-primary);
        }
        .npn-btn.secondary:hover:not(:disabled) {
          background: var(--bg-press);
        }
      `;
      document.head.appendChild(style);
    },

    createSettingsModal() {
      // Overlay
      const overlay = document.createElement("div");
      overlay.id = "npn-overlay";
      overlay.onclick = () => this.closeSettings();
      document.body.appendChild(overlay);

      // Modal
      const modal = document.createElement("div");
      modal.id = "npn-modal";
      modal.innerHTML = `
      <div class="npn-header">
        <h2>
          <svg class="npn-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Notification Settings
        </h2>
        <button class="npn-close-btn" id="npn-close-btn">✕</button>
      </div>

      <!-- scrollable content -->
      <div class="npn-modal-body">
        <!-- Enable/Disable Toggle -->
        <div class="npn-toggle-section">
          <div class="npn-toggle-label">
            <div class="npn-toggle-title">Enable Notifications</div>
            <div class="npn-toggle-desc">Show desktop notifications when tracks change</div>
          </div>
          <label class="npn-toggle">
            <input type="checkbox" id="npn-enabled-toggle" ${this.settings.enabled ? "checked" : ""}>
            <span class="npn-toggle-slider"></span>
          </label>
        </div>

        <!-- Settings Container (dims when disabled) -->
        <div class="npn-settings-container" id="npn-settings-container">
          <!-- Duration Slider -->
          <div class="npn-section">
            <div class="npn-field">
              <div class="npn-slider-container">
                <div class="npn-slider-header">
                  <label class="npn-label">Notification Duration</label>
                  <span class="npn-slider-value" id="npn-duration-value">${this.settings.notificationDuration / 1000}s</span>
                </div>
                <input 
                  type="range" 
                  id="npn-duration-slider" 
                  class="npn-slider"
                  min="1000" 
                  max="15000" 
                  step="500" 
                  value="${this.settings.notificationDuration}"
                >
                <span class="npn-hint">Recommended: Match your OS notification duration (usually 5s)</span>
              </div>
            </div>
          </div>

          <!-- Title Format Builder -->
          <div class="npn-section">
            <div class="npn-field">
              <label class="npn-label">Notification Title</label>
              <div class="npn-format-builder">
                <select id="npn-title-left" class="npn-select npn-format-part">
                  <option value="custom">Custom Text</option>
                  <option value="track_title">Track Title</option>
                  <option value="album">Album</option>
                  <option value="artist">Artist</option>
                  <option value="duration">Duration</option>
                  <option value="format">Format</option>
                  <option value="bitrate">Bitrate</option>
                  <option value="filepath">File Path</option>
                  <option value="local_time">Local Time</option>
                  <option value="none">None</option>
                </select>
                
                <span class="npn-separator">-</span>
                
                <select id="npn-title-right" class="npn-select npn-format-part">
                  <option value="none">None</option>
                  <option value="custom">Custom Text</option>
                  <option value="track_title">Track Title</option>
                  <option value="album">Album</option>
                  <option value="artist">Artist</option>
                  <option value="duration">Duration</option>
                  <option value="format">Format</option>
                  <option value="bitrate">Bitrate</option>
                  <option value="filepath">File Path</option>
                  <option value="local_time">Local Time</option>
                </select>
              </div>
              <input 
                type="text" 
                id="npn-title-custom-left" 
                class="npn-input" 
                placeholder="Custom text for left side..." 
                value="${this.settings.titleCustomLeft || ""}"
                style="margin-top: 8px; display: ${this.settings.titleLeft === "custom" ? "block" : "none"};"
              >
              <input 
                type="text" 
                id="npn-title-custom-right" 
                class="npn-input" 
                placeholder="Custom text for right side..." 
                value="${this.settings.titleCustomRight || ""}"
                style="margin-top: 8px; display: ${this.settings.titleRight === "custom" ? "block" : "none"};"
              >
            </div>
          </div>

          <!-- Body Format Builder -->
          <div class="npn-section">
            <div class="npn-field">
              <label class="npn-label">Notification Body</label>
              <div class="npn-format-builder">
                <select id="npn-body-left" class="npn-select npn-format-part">
                  <option value="track_title">Track Title</option>
                  <option value="album">Album</option>
                  <option value="artist">Artist</option>
                  <option value="duration">Duration</option>
                  <option value="format">Format</option>
                  <option value="bitrate">Bitrate</option>
                  <option value="filepath">File Path</option>
                  <option value="local_time">Local Time</option>
                  <option value="custom">Custom Text</option>
                  <option value="none">None</option>
                </select>
                
                <span class="npn-separator">-</span>
                
                <select id="npn-body-right" class="npn-select npn-format-part">
                  <option value="artist">Artist</option>
                  <option value="none">None</option>
                  <option value="track_title">Track Title</option>
                  <option value="album">Album</option>
                  <option value="duration">Duration</option>
                  <option value="format">Format</option>
                  <option value="bitrate">Bitrate</option>
                  <option value="filepath">File Path</option>
                  <option value="local_time">Local Time</option>
                  <option value="custom">Custom Text</option>
                </select>
              </div>
              <input 
                type="text" 
                id="npn-body-custom-left" 
                class="npn-input" 
                placeholder="Custom text for left side..." 
                value="${this.settings.bodyCustomLeft || ""}"
                style="margin-top: 8px; display: ${this.settings.bodyLeft === "custom" ? "block" : "none"};"
              >
              <input 
                type="text" 
                id="npn-body-custom-right" 
                class="npn-input" 
                placeholder="Custom text for right side..." 
                value="${this.settings.bodyCustomRight || ""}"
                style="margin-top: 8px; display: ${this.settings.bodyRight === "custom" ? "block" : "none"};"
              >
            </div>
          </div>

          <!-- Preview -->
          <div class="npn-preview">
            <div class="npn-preview-title">Preview</div>
            <div class="npn-preview-content">
              <div class="npn-preview-title-text" id="npn-preview-title">Now Playing</div>
              <div class="npn-preview-body-text" id="npn-preview-body">Song Title - Artist Name</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="npn-button-group">
          <button class="npn-btn secondary" id="npn-cancel-btn">Cancel</button>
          <button class="npn-btn" id="npn-save-btn">Save Settings</button>
        </div>
      </div>
      `;
      document.body.appendChild(modal);

      // Event Listeners
      this.attachEventListeners();
      this.updateSettingsState();
    },

    attachEventListeners() {
      // Close buttons
      document.getElementById("npn-close-btn").onclick = () =>
        this.closeSettings();
      document.getElementById("npn-cancel-btn").onclick = () =>
        this.closeSettings();
      document.getElementById("npn-save-btn").onclick = () =>
        this.saveSettingsFromUI();

      // Enable toggle
      const enableToggle = document.getElementById("npn-enabled-toggle");
      enableToggle.onchange = () => this.updateSettingsState();

      // Duration slider
      const durationSlider = document.getElementById("npn-duration-slider");
      const durationValue = document.getElementById("npn-duration-value");
      durationSlider.oninput = (e) => {
        const seconds = e.target.value / 1000;
        durationValue.textContent = `${seconds}s`;
        this.updatePreview();
      };

      // Title format builder
      const titleLeft = document.getElementById("npn-title-left");
      const titleRight = document.getElementById("npn-title-right");
      const titleCustomLeft = document.getElementById("npn-title-custom-left");
      const titleCustomRight = document.getElementById(
        "npn-title-custom-right",
      );

      titleLeft.value = this.settings.titleLeft;
      titleRight.value = this.settings.titleRight;

      titleLeft.onchange = () => {
        titleCustomLeft.style.display =
          titleLeft.value === "custom" ? "block" : "none";
        this.updatePreview();
      };
      titleRight.onchange = () => {
        titleCustomRight.style.display =
          titleRight.value === "custom" ? "block" : "none";
        this.updatePreview();
      };
      titleCustomLeft.oninput = () => this.updatePreview();
      titleCustomRight.oninput = () => this.updatePreview();

      // Body format builder
      const bodyLeft = document.getElementById("npn-body-left");
      const bodyRight = document.getElementById("npn-body-right");
      const bodyCustomLeft = document.getElementById("npn-body-custom-left");
      const bodyCustomRight = document.getElementById("npn-body-custom-right");

      bodyLeft.value = this.settings.bodyLeft;
      bodyRight.value = this.settings.bodyRight;

      bodyLeft.onchange = () => {
        bodyCustomLeft.style.display =
          bodyLeft.value === "custom" ? "block" : "none";
        this.updatePreview();
      };
      bodyRight.onchange = () => {
        bodyCustomRight.style.display =
          bodyRight.value === "custom" ? "block" : "none";
        this.updatePreview();
      };
      bodyCustomLeft.oninput = () => this.updatePreview();
      bodyCustomRight.oninput = () => this.updatePreview();

      // Initial preview
      this.updatePreview();
    },

    updateSettingsState() {
      const enabled = document.getElementById("npn-enabled-toggle").checked;
      const container = document.getElementById("npn-settings-container");

      if (enabled) {
        container.classList.remove("disabled");
      } else {
        container.classList.add("disabled");
      }
    },

    updatePreview() {
      const sampleTrack = {
        title: "Song Title",
        artist: "Artist Name",
        album: "Album Name",
        duration: 245,
        path: "/path/to/song.flac",
        filepath: "/path/to/song.flac",
        format: "FLAC",
        bitrate: 1411000,
        source_type: "local",
        cover_url: null,
        track_cover: null,
        album_art: null,
        external_id: null,
        local_src: null,
      };

      const titleLeft = document.getElementById("npn-title-left").value;
      const titleRight = document.getElementById("npn-title-right").value;
      const titleCustomLeft = document.getElementById(
        "npn-title-custom-left",
      ).value;
      const titleCustomRight = document.getElementById(
        "npn-title-custom-right",
      ).value;

      const bodyLeft = document.getElementById("npn-body-left").value;
      const bodyRight = document.getElementById("npn-body-right").value;
      const bodyCustomLeft = document.getElementById(
        "npn-body-custom-left",
      ).value;
      const bodyCustomRight = document.getElementById(
        "npn-body-custom-right",
      ).value;

      const previewTitle = document.getElementById("npn-preview-title");
      const previewBody = document.getElementById("npn-preview-body");

      previewTitle.textContent = this.buildCompoundFormat(
        titleLeft,
        titleRight,
        titleCustomLeft,
        titleCustomRight,
        sampleTrack,
      );
      previewBody.textContent = this.buildCompoundFormat(
        bodyLeft,
        bodyRight,
        bodyCustomLeft,
        bodyCustomRight,
        sampleTrack,
      );
    },

    createMenuButton() {
      const btn = document.createElement("button");
      btn.className = "plugin-menu-btn";
      btn.title = "Notification Settings";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span>Notification Settings</span>
      `;
      btn.onclick = () => this.openSettings();

      if (this.api.ui && this.api.ui.registerSlot) {
        this.api.ui.registerSlot("playerbar:menu", btn);
      }
    },

    openSettings() {
      this.isSettingsOpen = true;
      document.getElementById("npn-overlay").classList.add("open");
      document.getElementById("npn-modal").classList.add("open");
    },

    closeSettings() {
      this.isSettingsOpen = false;
      document.getElementById("npn-overlay").classList.remove("open");
      document.getElementById("npn-modal").classList.remove("open");
    },

    async saveSettingsFromUI() {
      // Read values from UI
      this.settings.enabled =
        document.getElementById("npn-enabled-toggle").checked;
      this.settings.notificationDuration = parseInt(
        document.getElementById("npn-duration-slider").value,
      );

      this.settings.titleLeft = document.getElementById("npn-title-left").value;
      this.settings.titleRight =
        document.getElementById("npn-title-right").value;
      this.settings.titleCustomLeft = document.getElementById(
        "npn-title-custom-left",
      ).value;
      this.settings.titleCustomRight = document.getElementById(
        "npn-title-custom-right",
      ).value;

      this.settings.bodyLeft = document.getElementById("npn-body-left").value;
      this.settings.bodyRight = document.getElementById("npn-body-right").value;
      this.settings.bodyCustomLeft = document.getElementById(
        "npn-body-custom-left",
      ).value;
      this.settings.bodyCustomRight = document.getElementById(
        "npn-body-custom-right",
      ).value;

      await this.saveSettings();
      this.closeSettings();
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TRACK CHANGE HANDLING
    // ═══════════════════════════════════════════════════════════════════════

    handleTrackChange(data) {
      const { track } = data;
      if (!track || !this.settings.enabled) return;

      // No notification currently active
      if (!this.isNotificationActive) {
        this.sendNotification(track);
        return;
      }

      // Notification is active - queue this track
      this.queuedTrack = track;
    },

    async sendNotification(track) {
      // Mark notification as active
      this.isNotificationActive = true;

      // Send the actual notification
      await this.showNotification(track);

      // Clear any existing timer
      if (this.activeNotificationTimer) {
        clearTimeout(this.activeNotificationTimer);
      }

      // Start timer for notification duration
      this.activeNotificationTimer = setTimeout(() => {
        this.onNotificationExpired();
      }, this.settings.notificationDuration);
    },

    onNotificationExpired() {
      // Check if there's a queued track
      if (this.queuedTrack) {
        const trackToSend = this.queuedTrack;
        this.queuedTrack = null; // Clear queue BEFORE sending
        this.sendNotification(trackToSend); // This will restart the timer
      } else {
        // No queued track - we're done
        this.isNotificationActive = false;
        this.activeNotificationTimer = null;
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FORMATTING
    // ═══════════════════════════════════════════════════════════════════════

    buildCompoundFormat(
      leftFormat,
      rightFormat,
      leftCustom,
      rightCustom,
      track,
    ) {
      // Get left and right values
      const leftValue = this.formatSingleField(leftFormat, leftCustom, track);
      const rightValue = this.formatSingleField(
        rightFormat,
        rightCustom,
        track,
      );

      // Smart separator logic
      if (leftValue && rightValue) {
        return `${leftValue} - ${rightValue}`;
      } else if (leftValue) {
        return leftValue;
      } else if (rightValue) {
        return rightValue;
      } else {
        return "";
      }
    },

    formatSingleField(format, customText, track) {
      switch (format) {
        case "track_title":
          return track.title || "";

        case "album":
          return track.album || "";

        case "artist":
          return track.artist || "";

        case "duration":
          return track.duration ? this.formatDuration(track.duration) : "";

        case "filepath":
          return track.path || track.filepath || "";

        case "format":
          return track.format || "";

        case "bitrate":
          if (track.bitrate) {
            return typeof track.bitrate === "number"
              ? `${Math.round(track.bitrate / 1000)} kbps`
              : track.bitrate;
          }
          return "";

        case "local_time":
          return new Date().toLocaleTimeString();

        case "custom":
          return customText || "";

        case "none":
          return "";

        default:
          return "";
      }
    },

    formatDuration(seconds) {
      if (!seconds) return "0:00";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // NOTIFICATION DISPLAY
    // ═══════════════════════════════════════════════════════════════════════

    getCoverArt(track) {
      const coverSources = [
        { name: "track_cover", value: track.track_cover },
        { name: "cover_url", value: track.cover_url },
        { name: "album_art", value: track.album_art },
      ];

      for (const source of coverSources) {
        if (source.value) {
          return source.value;
        }
      }
      return null;
    },

    async showNotification(track) {
      try {
        if (window.__TAURI__?.notification && window.__TAURI__?.core) {
          const { sendNotification, isPermissionGranted, requestPermission } =
            window.__TAURI__.notification;
          const { invoke } = window.__TAURI__.core;

          let permissionGranted = await isPermissionGranted();
          if (!permissionGranted) {
            const permission = await requestPermission();
            permissionGranted = permission === "granted";
          }

          if (permissionGranted) {
            const notificationId = this.notificationIdCounter++;

            // Build title and body using compound format
            const titleText = this.buildCompoundFormat(
              this.settings.titleLeft,
              this.settings.titleRight,
              this.settings.titleCustomLeft,
              this.settings.titleCustomRight,
              track,
            );

            const bodyText = this.buildCompoundFormat(
              this.settings.bodyLeft,
              this.settings.bodyRight,
              this.settings.bodyCustomLeft,
              this.settings.bodyCustomRight,
              track,
            );

            const notificationOptions = {
              id: notificationId,
              title: titleText || "Now Playing",
              body: bodyText,
            };

            // Add album artwork if available
            const coverArt = this.getCoverArt(track);
            if (coverArt) {
              try {
                if (coverArt.startsWith("data:image/")) {
                  const tempPath = await invoke("save_notification_image", {
                    dataUri: coverArt,
                  });
                  notificationOptions.attachments = [
                    {
                      id: "album-art",
                      url: `file://${tempPath}`,
                    },
                  ];
                } else if (
                  coverArt.startsWith("http://") ||
                  coverArt.startsWith("https://")
                ) {
                  notificationOptions.icon = coverArt;
                } else if (coverArt.startsWith("file://")) {
                  notificationOptions.attachments = [
                    {
                      id: "album-art",
                      url: coverArt,
                    },
                  ];
                }
              } catch (error) {
                console.error(
                  "[NowPlayingNotifier] Failed to process cover art:",
                  error,
                );
              }
            }

            await sendNotification(notificationOptions);
          }
        }
      } catch (error) {
        console.error("[NowPlayingNotifier] Notification error:", error);
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    start() {
      // Plugin started
    },

    stop() {
      if (this.activeNotificationTimer) {
        clearTimeout(this.activeNotificationTimer);
        this.activeNotificationTimer = null;
      }
      this.isNotificationActive = false;
      this.queuedTrack = null;
    },

    destroy() {
      this.stop();
    },
  };

  // Register plugin
  if (typeof Audion !== "undefined" && Audion.register) {
    Audion.register(NowPlayingNotifier);
  } else {
    window.NowPlayingNotifier = NowPlayingNotifier;
    window.AudionPlugin = NowPlayingNotifier;
  }
})();
