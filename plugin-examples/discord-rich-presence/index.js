// Discord Rich Presence Plugin for Audion

(function () {
  "use strict";

  const DiscordRPC = {
    name: "Discord Rich Presence",

    defaultSettings: {
      enabled: true,
      showProgress: true,
      updateInterval: 10000,
      detailsLeft: "track_title",
      detailsRight: "none",
      detailsCustomLeft: "",
      detailsCustomRight: "",
      stateLeft: "artist",
      stateRight: "album",
      stateCustomLeft: "",
      stateCustomRight: "",
      useTidalCovers: true,
    },

    settings: null,
    isConnected: false,
    currentTrack: null,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    updateTimeout: null,
    coverCache: new Map(),
    MAX_COVER_CACHE_SIZE: 100,
    isSettingsOpen: false,
    api: null,
    tempSettings: null,
    connectionStatusInterval: null,

    async init(api) {
      this.api = api;
      this.settings = { ...this.defaultSettings };

      await this.loadSettings();

      this.injectStyles();
      this.createSettingsModal();
      this.createMenuButton();

      api.on("trackChange", (data) => this.handleTrackChange(data), this.name);
      api.on(
        "playStateChange",
        (data) => this.handlePlaybackState(data),
        this.name,
      );
      api.on("timeUpdate", (data) => this.handleTimeUpdate(data), this.name);
      api.on("seeked", (data) => this.handleSeeked(data), this.name);

      if (this.settings.enabled) {
        this.connect();
      }
    },

    async loadSettings() {
      if (!this.api?.storage?.get) return;

      try {
        const saved = await this.api.storage.get("settings");
        if (saved) {
          this.settings = { ...this.defaultSettings, ...saved };
        }
      } catch (err) {
        console.error("[Discord RPC] Error loading settings:", err);
      }
    },

    async saveSettings() {
      if (!this.api?.storage?.set) {
        if (this.isSettingsOpen) {
          this.showStorageWarning();
        }
        return false;
      }

      try {
        await this.api.storage.set("settings", this.settings);
        return true;
      } catch (err) {
        console.error("[Discord RPC] Error saving settings:", err);
        if (this.isSettingsOpen) {
          this.showStorageWarning();
        }
        return false;
      }
    },

    showStorageWarning() {
      const statusText = document.querySelector(".drpc-status-text");
      if (statusText) {
        const originalText = statusText.textContent;
        statusText.textContent =
          "Storage unavailable - settings won't persist";
        statusText.style.color = "#ffc107";
        setTimeout(() => {
          statusText.textContent = originalText;
          statusText.style.color = "";
        }, 3000);
      }
    },

    async applySettings() {
      const wasEnabled = this.settings.enabled;
      this.settings = { ...this.tempSettings };

      if (this.settings.enabled && !this.isConnected) {
        await this.connect();
      } else if (!this.settings.enabled && this.isConnected) {
        await this.clearPresence();
        await this.disconnect();
      } else if (this.isConnected && this.settings.enabled) {
        await this.updatePresence();
      }

      await this.saveSettings();
      this.updateConnectionStatus();
    },

    injectStyles() {
      if (document.getElementById("drpc-styles")) return;

      const style = document.createElement("style");
      style.id = "drpc-styles";
      style.textContent = `
        #drpc-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          z-index: 10000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease;
        }
        #drpc-overlay.open {
          opacity: 1;
          visibility: visible;
        }

        #drpc-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          background: var(--bg-elevated);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          padding: 24px;
          width: 550px;
          max-width: 90vw;
          max-height: 85vh;
          overflow-y: auto;
          z-index: 10001;
          box-shadow: var(--shadow-lg);
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #drpc-modal.open {
          opacity: 1;
          visibility: visible;
          transform: translate(-50%, -50%) scale(1);
        }

        .drpc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .drpc-header h2 {
          margin: 0;
          color: var(--text-primary);
          font-size: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .drpc-icon {
          color: #5865F2;
        }
        .drpc-close-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 20px;
          cursor: pointer;
          padding: 4px;
          transition: color 0.2s;
        }
        .drpc-close-btn:hover {
          color: var(--text-primary);
        }

        .drpc-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: var(--bg-surface);
          border-radius: 8px;
          margin-bottom: 20px;
          border: 1px solid var(--border-color);
          transition: all 0.3s ease;
        }
        .drpc-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--text-subdued);
          transition: all 0.3s ease;
        }
        .drpc-status-dot.connected {
          background: #3ba55d;
          box-shadow: 0 0 8px rgba(59, 165, 93, 0.4);
        }
        .drpc-status-dot.disconnected {
          background: #ed4245;
          box-shadow: 0 0 8px rgba(237, 66, 69, 0.4);
        }
        .drpc-status-dot.disabled {
          background: #99aab5;
        }
        .drpc-status-text {
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 500;
          transition: all 0.3s ease;
        }

        .drpc-toggle-section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          background: var(--bg-surface);
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .drpc-toggle-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .drpc-toggle-title {
          color: var(--text-primary);
          font-weight: 600;
          font-size: 15px;
        }
        .drpc-toggle-desc {
          color: var(--text-secondary);
          font-size: 13px;
        }

        .drpc-toggle {
          position: relative;
          width: 48px;
          height: 26px;
        }
        .drpc-toggle input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .drpc-toggle-slider {
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
        .drpc-toggle-slider:before {
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
        .drpc-toggle input:checked + .drpc-toggle-slider {
          background: var(--accent-primary);
        }
        .drpc-toggle input:checked + .drpc-toggle-slider:before {
          transform: translateX(22px);
        }

        .drpc-settings-container {
          transition: opacity 0.3s, filter 0.3s;
        }
        .drpc-settings-container.disabled .drpc-setting-item,
        .drpc-settings-container.disabled .drpc-section {
          opacity: 0.5;
          filter: grayscale(100%);
          pointer-events: none;
        }

        .drpc-setting-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: var(--bg-surface);
          border-radius: 8px;
          margin-bottom: 12px;
        }
        .drpc-setting-label {
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 500;
          flex: 1;
        }
        .drpc-setting-desc {
          color: var(--text-secondary);
          font-size: 12px;
          margin-top: 4px;
        }

        .drpc-section {
          margin-bottom: 24px;
        }
        .drpc-section-title {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
          opacity: 0.7;
        }

        .drpc-compound-format {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .drpc-compound-select {
          flex: 1;
          min-width: 0;
        }
        .drpc-compound-divider {
          color: var(--text-subdued);
          font-weight: 600;
          user-select: none;
        }

        .drpc-select, .drpc-input {
          width: 100%;
          padding: 10px 14px;
          background: var(--bg-surface);
          border: 1.5px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 13px;
          transition: all 0.2s;
          font-family: inherit;
        }
        
        .drpc-select {
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 36px;
        }
        
        .drpc-select:hover {
          border-color: var(--accent-primary);
          background-color: var(--bg-highlight);
        }
        
        .drpc-select:focus, .drpc-input:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.1);
        }
        
        .drpc-select option {
          background: var(--bg-elevated);
          color: var(--text-primary);
          padding: 8px;
        }

        .drpc-input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .drpc-input-group label {
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 500;
        }

        .drpc-range-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .drpc-range-value {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .drpc-range {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: var(--bg-highlight);
          outline: none;
          -webkit-appearance: none;
          appearance: none;
        }
        .drpc-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--accent-primary);
          cursor: pointer;
          transition: transform 0.2s;
        }
        .drpc-range::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }
        .drpc-range::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: none;
          border-radius: 50%;
          background: var(--accent-primary);
          cursor: pointer;
          transition: transform 0.2s;
        }

        .drpc-preview {
          padding: 0;
          background: #1e1f22;
          border: 1px solid #2b2d31;
          border-radius: 8px;
          margin-top: 16px;
          overflow: hidden;
        }

        .drpc-preview-title {
          font-size: 11px;
          color: #b5bac1;
          margin-bottom: 0;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 12px 16px 8px;
          background: #2b2d31;
          border-bottom: 1px solid #3f4147;
        }
        
        .drpc-preview-content {
          padding: 16px;
        }
        
        .drpc-discord-card {
          background: #2b2d31;
          border-radius: 8px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          position: relative;
        }

        .drpc-discord-app {
          font-size: 11px;
          color: #b5bac1;
          font-weight: 600;
          margin-bottom: 4px;
        }
        
        .drpc-discord-menu {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #b5bac1;
          font-size: 16px;
        }
        
        .drpc-discord-main {
          display: flex;
          gap: 12px;
        }
        
        .drpc-discord-image {
          width: 80px;
          height: 80px;
          border-radius: 8px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 32px;
        }
        
        .drpc-discord-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          padding-top: 2px;
        }
        
        .drpc-discord-details {
          font-size: 15px;
          font-weight: 600;
          color: #f2f3f5;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .drpc-discord-state {
          font-size: 13px;
          color: #b5bac1;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .drpc-discord-state-mirror {
          font-size: 13px;
          color: #b5bac1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 6px;
        }
        
        .drpc-discord-progress {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .drpc-discord-time {
          font-size: 11px;
          color: #b5bac1;
          font-variant-numeric: tabular-nums;
          min-width: 38px;
        }
        
        .drpc-discord-progress-bar {
          flex: 1;
          height: 4px;
          background: #3f4147;
          border-radius: 2px;
          overflow: hidden;
        }
        
        .drpc-discord-progress-fill {
          height: 100%;
          background: #ffffff;
          border-radius: 2px;
          width: 35%;
        }
        
        .drpc-discord-stopwatch {
          font-size: 12px;
          color: #23a55a;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .drpc-action-buttons {
          display: flex;
          gap: 12px;
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--border-color);
          pointer-events: auto !important;
        }
        .drpc-btn {
          flex: 1;
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .drpc-btn-primary {
          background: var(--accent-primary);
          color: white;
        }
        .drpc-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        .drpc-btn-secondary {
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }
        .drpc-btn-secondary:hover {
          background: var(--bg-highlight);
        }

        .drpc-warning-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.3);
          border-radius: 6px;
          color: #ffc107;
          font-size: 12px;
          font-weight: 500;
          margin-top: 8px;
        }

        .drpc-info-box {
          padding: 12px;
          background: rgba(33, 150, 243, 0.1);
          border: 1px solid rgba(33, 150, 243, 0.3);
          border-radius: 8px;
          margin-top: 12px;
        }
        .drpc-info-text {
          color: #2196F3;
          font-size: 12px;
          line-height: 1.5;
        }
      `;

      document.head.appendChild(style);
    },

    createSettingsModal() {
      if (document.getElementById("drpc-modal")) return;

      const overlay = document.createElement("div");
      overlay.id = "drpc-overlay";
      overlay.addEventListener("click", () => this.closeSettings());
      document.body.appendChild(overlay);

      const modal = document.createElement("div");
      modal.id = "drpc-modal";
      modal.innerHTML = `
        <div class="drpc-header">
          <h2>
            <span class="drpc-icon">🎮</span>
            Discord Rich Presence
          </h2>
          <button class="drpc-close-btn">×</button>
        </div>

        <div class="drpc-status">
          <div class="drpc-status-dot"></div>
          <span class="drpc-status-text">Checking connection...</span>
        </div>

        <div class="drpc-toggle-section">
          <div class="drpc-toggle-label">
            <div class="drpc-toggle-title">Enable Rich Presence</div>
            <div class="drpc-toggle-desc">Show your music activity on Discord</div>
          </div>
          <label class="drpc-toggle">
            <input type="checkbox" id="drpc-enabled" ${this.settings.enabled ? "checked" : ""}>
            <span class="drpc-toggle-slider"></span>
          </label>
        </div>

        <div class="drpc-settings-container ${this.settings.enabled ? "" : "disabled"}">
          <div class="drpc-section">
            <div class="drpc-section-title">Display Options</div>
            
            <div class="drpc-setting-item">
              <div>
                <div class="drpc-setting-label">Show Progress Bar</div>
                <div class="drpc-setting-desc">Display playback progress in Discord</div>
                <div class="drpc-warning-badge">
                  <span>⚠</span>
                  Discord shows a stopwatch even when disabled
                </div>
              </div>
              <label class="drpc-toggle">
                <input type="checkbox" id="drpc-show-progress" ${this.settings.showProgress ? "checked" : ""}>
                <span class="drpc-toggle-slider"></span>
              </label>
            </div>

            <div class="drpc-setting-item">
              <div>
                <div class="drpc-setting-label">Use Tidal for Cover Art</div>
                <div class="drpc-setting-desc">Fetch album covers from Tidal</div>
              </div>
              <label class="drpc-toggle">
                <input type="checkbox" id="drpc-use-tidal" ${this.settings.useTidalCovers ? "checked" : ""}>
                <span class="drpc-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="drpc-section">
            <div class="drpc-section-title">Update Frequency</div>
            <div class="drpc-setting-item">
              <div style="width: 100%;">
                <div class="drpc-range-wrapper">
                  <div class="drpc-range-value">
                    <span>Minimum Update Interval</span>
                    <span id="drpc-interval-display">${this.settings.updateInterval / 1000}s</span>
                  </div>
                  <input
                    type="range"
                    id="drpc-update-interval"
                    class="drpc-range"
                    min="6"
                    max="30"
                    step="1"
                    value="${this.settings.updateInterval / 1000}"
                  >
                </div>
                <div class="drpc-info-box">
                  <div class="drpc-info-text">
                    Lower values = more frequent updates. Minimum is 6 seconds (Discord's rate limit is 5s).
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="drpc-section">
            <div class="drpc-section-title">Display Format</div>
            
            <div class="drpc-input-group">
              <label>Details (First Line)</label>
              <div class="drpc-compound-format">
                <select id="drpc-details-left" class="drpc-select drpc-compound-select">
                  <option value="none">None</option>
                  <option value="track_title">Track Title</option>
                  <option value="artist">Artist</option>
                  <option value="album">Album</option>
                  <option value="custom">Custom</option>
                </select>
                <span class="drpc-compound-divider">•</span>
                <select id="drpc-details-right" class="drpc-select drpc-compound-select">
                  <option value="none">None</option>
                  <option value="track_title">Track Title</option>
                  <option value="artist">Artist</option>
                  <option value="album">Album</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <input
                type="text"
                id="drpc-details-custom-left"
                class="drpc-input"
                placeholder="Custom left text..."
                style="display: none;"
              >
              <input
                type="text"
                id="drpc-details-custom-right"
                class="drpc-input"
                placeholder="Custom right text..."
                style="display: none;"
              >
            </div>

            <div class="drpc-input-group">
              <label>State (Second Line)</label>
              <div class="drpc-compound-format">
                <select id="drpc-state-left" class="drpc-select drpc-compound-select">
                  <option value="none">None</option>
                  <option value="track_title">Track Title</option>
                  <option value="artist">Artist</option>
                  <option value="album">Album</option>
                  <option value="custom">Custom</option>
                </select>
                <span class="drpc-compound-divider">•</span>
                <select id="drpc-state-right" class="drpc-select drpc-compound-select">
                  <option value="none">None</option>
                  <option value="track_title">Track Title</option>
                  <option value="artist">Artist</option>
                  <option value="album">Album</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <input
                type="text"
                id="drpc-state-custom-left"
                class="drpc-input"
                placeholder="Custom left text..."
                style="display: none;"
              >
              <input
                type="text"
                id="drpc-state-custom-right"
                class="drpc-input"
                placeholder="Custom right text..."
                style="display: none;"
              >
            </div>

            <div class="drpc-preview">
              <div class="drpc-preview-title">PREVIEW</div>
              <div class="drpc-preview-content"></div>
            </div>
          </div>
        </div>

        <div class="drpc-action-buttons">
          <button class="drpc-btn drpc-btn-secondary" id="drpc-reset-btn">Reset Defaults</button>
          <button class="drpc-btn drpc-btn-primary" id="drpc-save-btn">Save Settings</button>
        </div>
      `;

      document.body.appendChild(modal);

      modal
        .querySelector(".drpc-close-btn")
        .addEventListener("click", () => this.closeSettings());

      const enabledToggle = modal.querySelector("#drpc-enabled");
      enabledToggle.addEventListener("change", (e) => {
        this.tempSettings.enabled = e.target.checked;
        const container = modal.querySelector(".drpc-settings-container");
        container.classList.toggle("disabled", !e.target.checked);
        this.updateConnectionStatus();
      });

      modal
        .querySelector("#drpc-show-progress")
        .addEventListener("change", (e) => {
          this.tempSettings.showProgress = e.target.checked;
          this.updatePreview();
        });

      modal.querySelector("#drpc-use-tidal").addEventListener("change", (e) => {
        this.tempSettings.useTidalCovers = e.target.checked;
      });

      const intervalSlider = modal.querySelector("#drpc-update-interval");
      const intervalDisplay = modal.querySelector("#drpc-interval-display");
      intervalSlider.addEventListener("input", (e) => {
        const seconds = parseInt(e.target.value);
        intervalDisplay.textContent = `${seconds}s`;
        this.tempSettings.updateInterval = seconds * 1000;
      });

      const detailsLeft = modal.querySelector("#drpc-details-left");
      const detailsRight = modal.querySelector("#drpc-details-right");
      const stateLeft = modal.querySelector("#drpc-state-left");
      const stateRight = modal.querySelector("#drpc-state-right");

      detailsLeft.value = this.settings.detailsLeft;
      detailsRight.value = this.settings.detailsRight;
      stateLeft.value = this.settings.stateLeft;
      stateRight.value = this.settings.stateRight;

      const detailsCustomLeft = modal.querySelector(
        "#drpc-details-custom-left",
      );
      const detailsCustomRight = modal.querySelector(
        "#drpc-details-custom-right",
      );
      const stateCustomLeft = modal.querySelector("#drpc-state-custom-left");
      const stateCustomRight = modal.querySelector("#drpc-state-custom-right");

      const updateCustomInputs = () => {
        detailsCustomLeft.style.display =
          detailsLeft.value === "custom" ? "block" : "none";
        detailsCustomRight.style.display =
          detailsRight.value === "custom" ? "block" : "none";
        stateCustomLeft.style.display =
          stateLeft.value === "custom" ? "block" : "none";
        stateCustomRight.style.display =
          stateRight.value === "custom" ? "block" : "none";
      };

      updateCustomInputs();

      detailsLeft.addEventListener("change", (e) => {
        this.tempSettings.detailsLeft = e.target.value;
        updateCustomInputs();
        this.updatePreview();
      });
      detailsRight.addEventListener("change", (e) => {
        this.tempSettings.detailsRight = e.target.value;
        updateCustomInputs();
        this.updatePreview();
      });
      stateLeft.addEventListener("change", (e) => {
        this.tempSettings.stateLeft = e.target.value;
        updateCustomInputs();
        this.updatePreview();
      });
      stateRight.addEventListener("change", (e) => {
        this.tempSettings.stateRight = e.target.value;
        updateCustomInputs();
        this.updatePreview();
      });

      detailsCustomLeft.value = this.settings.detailsCustomLeft;
      detailsCustomRight.value = this.settings.detailsCustomRight;
      stateCustomLeft.value = this.settings.stateCustomLeft;
      stateCustomRight.value = this.settings.stateCustomRight;

      detailsCustomLeft.addEventListener("input", (e) => {
        this.tempSettings.detailsCustomLeft = e.target.value;
        this.updatePreview();
      });
      detailsCustomRight.addEventListener("input", (e) => {
        this.tempSettings.detailsCustomRight = e.target.value;
        this.updatePreview();
      });
      stateCustomLeft.addEventListener("input", (e) => {
        this.tempSettings.stateCustomLeft = e.target.value;
        this.updatePreview();
      });
      stateCustomRight.addEventListener("input", (e) => {
        this.tempSettings.stateCustomRight = e.target.value;
        this.updatePreview();
      });

      modal
        .querySelector("#drpc-reset-btn")
        .addEventListener("click", () => this.resetSettings());
      modal.querySelector("#drpc-save-btn").addEventListener("click", () => {
        this.applySettings();
        this.closeSettings();
      });

      this.updatePreview();
    },

    createMenuButton() {
      if (!this.api?.ui) return;

      const button = document.createElement("button");
      button.textContent = "Discord RPC Settings";
      button.style.cssText = `display: flex; align-items: center; gap: 8px;`;

      const icon = document.createElement("span");
      icon.textContent = "🎮";
      button.insertBefore(icon, button.firstChild);

      button.addEventListener("click", () => this.openSettings());

      this.api.ui.registerSlot("playerbar:menu", button, 5);
    },

    openSettings() {
      this.isSettingsOpen = true;
      this.tempSettings = { ...this.settings };

      const modal = document.getElementById("drpc-modal");
      const overlay = document.getElementById("drpc-overlay");

      modal.classList.add("open");
      overlay.classList.add("open");

      this.updateConnectionStatus();
      this.updatePreview();
      this.startConnectionStatusPolling();
    },

    closeSettings() {
      this.isSettingsOpen = false;
      const modal = document.getElementById("drpc-modal");
      const overlay = document.getElementById("drpc-overlay");

      modal.classList.remove("open");
      overlay.classList.remove("open");

      this.stopConnectionStatusPolling();
    },

    startConnectionStatusPolling() {
      this.stopConnectionStatusPolling();
      this.updateConnectionStatus();

      this.connectionStatusInterval = setInterval(() => {
        if (this.isSettingsOpen) {
          this.updateConnectionStatus();
        }
      }, 500);
    },

    stopConnectionStatusPolling() {
      if (this.connectionStatusInterval) {
        clearInterval(this.connectionStatusInterval);
        this.connectionStatusInterval = null;
      }
    },

    updateConnectionStatus() {
      const statusDot = document.querySelector(".drpc-status-dot");
      const statusText = document.querySelector(".drpc-status-text");

      if (!statusDot || !statusText) return;

      const settings = this.tempSettings || this.settings;

      if (!settings.enabled) {
        statusDot.className = "drpc-status-dot disabled";
        statusText.textContent = "Rich Presence Disabled";
        return;
      }

      if (this.isConnected) {
        statusDot.className = "drpc-status-dot connected";
        statusText.textContent = "Connected to Discord";
      } else {
        statusDot.className = "drpc-status-dot disconnected";
        statusText.textContent = "Disconnected";
      }
    },

    updatePreview() {
      const previewContent = document.querySelector(".drpc-preview-content");
      if (!previewContent) return;

      const settings = this.tempSettings || this.settings;

      const mockTrack = {
        title: "Song Title",
        artist: "Artist Name",
        album: "Album Name",
      };

      const detailsText = this.buildCompoundFormat(
        settings.detailsLeft,
        settings.detailsRight,
        settings.detailsCustomLeft,
        settings.detailsCustomRight,
        mockTrack,
      );

      const stateText = this.buildCompoundFormat(
        settings.stateLeft,
        settings.stateRight,
        settings.stateCustomLeft,
        settings.stateCustomRight,
        mockTrack,
      );

      previewContent.innerHTML = `
        <div class="drpc-discord-card">
          <div class="drpc-discord-app">Listening to Audion</div>
          <div class="drpc-discord-menu">⋯</div>
          
          <div class="drpc-discord-main">
            <div class="drpc-discord-image">🎵</div>
            <div class="drpc-discord-info">
              <div class="drpc-discord-details">
                ${detailsText || '<span style="opacity: 0.5">(empty)</span>'}
              </div>
              <div class="drpc-discord-state">
                ${stateText || '<span style="opacity: 0.5">(empty)</span>'}
              </div>
              <div class="drpc-discord-state-mirror">
                ${detailsText || '<span style="opacity: 0.5">(empty)</span>'}
              </div>
              
              ${
                settings.showProgress
                  ? `<div class="drpc-discord-progress">
                    <span class="drpc-discord-time">1:23</span>
                    <div class="drpc-discord-progress-bar">
                      <div class="drpc-discord-progress-fill"></div>
                    </div>
                    <span class="drpc-discord-time">3:45</span>
                  </div>`
                  : `<div class="drpc-discord-stopwatch">
                    <span>♫</span>
                    <span>1:23</span>
                  </div>`
              }
            </div>
          </div>
        </div>
      `;
    },

    resetSettings() {
      this.tempSettings = { ...this.defaultSettings };

      const modal = document.getElementById("drpc-modal");
      modal.querySelector("#drpc-enabled").checked = this.tempSettings.enabled;
      modal.querySelector("#drpc-show-progress").checked =
        this.tempSettings.showProgress;
      modal.querySelector("#drpc-use-tidal").checked =
        this.tempSettings.useTidalCovers;
      modal.querySelector("#drpc-update-interval").value =
        this.tempSettings.updateInterval / 1000;
      modal.querySelector("#drpc-interval-display").textContent =
        `${this.tempSettings.updateInterval / 1000}s`;

      modal.querySelector("#drpc-details-left").value =
        this.tempSettings.detailsLeft;
      modal.querySelector("#drpc-details-right").value =
        this.tempSettings.detailsRight;
      modal.querySelector("#drpc-state-left").value =
        this.tempSettings.stateLeft;
      modal.querySelector("#drpc-state-right").value =
        this.tempSettings.stateRight;

      modal.querySelector("#drpc-details-custom-left").value = "";
      modal.querySelector("#drpc-details-custom-right").value = "";
      modal.querySelector("#drpc-state-custom-left").value = "";
      modal.querySelector("#drpc-state-custom-right").value = "";

      modal
        .querySelector(".drpc-settings-container")
        .classList.remove("disabled");

      this.updateConnectionStatus();
      this.updatePreview();
    },

    buildCompoundFormat(leftType, rightType, leftCustom, rightCustom, track) {
      const parts = [];

      if (leftType === "custom" && leftCustom) {
        parts.push(leftCustom);
      } else if (leftType === "track_title" && track?.title) {
        parts.push(track.title);
      } else if (leftType === "artist" && track?.artist) {
        parts.push(track.artist);
      } else if (leftType === "album" && track?.album) {
        parts.push(track.album);
      }

      if (rightType === "custom" && rightCustom) {
        parts.push(rightCustom);
      } else if (rightType === "track_title" && track?.title) {
        parts.push(track.title);
      } else if (rightType === "artist" && track?.artist) {
        parts.push(track.artist);
      } else if (rightType === "album" && track?.album) {
        parts.push(track.album);
      }

      return parts.filter(Boolean).join(" • ");
    },

    async connect() {
      if (this.isConnected) return;

      try {
        await this.api.discord.connect();
        this.isConnected = true;

        if (this.currentTrack) {
          this.updatePresence();
        }
      } catch (error) {
        console.error("[Discord RPC] Connection failed:", error);
        this.isConnected = false;

        setTimeout(() => {
          if (this.settings.enabled) {
            this.connect();
          }
        }, 5000);
      }
    },

    async disconnect() {
      if (!this.isConnected) return;

      try {
        await this.api.discord.disconnect();
        this.isConnected = false;
      } catch (error) {
        console.error("[Discord RPC] Disconnect error:", error);
      }
    },

    handleTrackChange(data) {
      const { track } = data;
      if (!track) return;

      this.currentTrack = track;
      this.duration = track.duration || 0;

      try {
        this.currentTime = this.api.player.getCurrentTime();
        this.isPlaying = this.api.player.isPlaying();
      } catch (error) {
        this.currentTime = 0;
      }

      this.updatePresence();
    },

    handlePlaybackState(data) {
      const { isPlaying } = data;
      this.isPlaying = isPlaying;
      this.updatePresence();
    },

    handleTimeUpdate(data) {
      const { currentTime, duration } = data;
      this.currentTime = currentTime || 0;
      this.duration = duration || this.duration;

      this.scheduleUpdate();
    },

    handleSeeked(data) {
      const { currentTime, duration } = data;
      this.currentTime = currentTime || 0;
      this.duration = duration || this.duration;

      this.updatePresence();
    },

    scheduleUpdate() {
      if (this.updateTimeout) return;

      this.updateTimeout = setTimeout(() => {
        this.updatePresence();
        this.updateTimeout = null;
      }, this.settings.updateInterval);
    },

    async updatePresence() {
      if (!this.settings.enabled || !this.isConnected) return;

      if (!this.currentTrack) {
        try {
          this.currentTrack = this.api.player.getCurrentTrack();
          this.isPlaying = this.api.player.isPlaying();
          this.currentTime = this.api.player.getCurrentTime();
          this.duration = this.api.player.getDuration();
        } catch (error) {
          return;
        }
      }

      if (!this.currentTrack) return;

      try {
        this.isPlaying = this.api.player.isPlaying();
        this.currentTime = this.api.player.getCurrentTime();
        this.duration = this.api.player.getDuration();
      } catch (error) {}

      if (!this.isPlaying) {
        await this.clearPresence();
        return;
      }

      const presenceData = {
        song_title: this.formatDetails(),
        artist: this.formatState(),
        album: null,
        cover_url: await this.getCoverUrl(),
        current_time: this.settings.showProgress
          ? Math.floor(this.currentTime)
          : 0,
        duration: this.settings.showProgress ? Math.floor(this.duration) : 0,
        is_playing: this.isPlaying,
      };

      try {
        await this.api.discord.updatePresence(presenceData);
      } catch (error) {
        console.error("[Discord RPC] Update failed:", error);
        this.isConnected = false;

        setTimeout(() => this.connect(), 2000);
      }
    },

    formatDetails() {
      return this.buildCompoundFormat(
        this.settings.detailsLeft,
        this.settings.detailsRight,
        this.settings.detailsCustomLeft,
        this.settings.detailsCustomRight,
        this.currentTrack,
      );
    },

    formatState() {
      return this.buildCompoundFormat(
        this.settings.stateLeft,
        this.settings.stateRight,
        this.settings.stateCustomLeft,
        this.settings.stateCustomRight,
        this.currentTrack,
      );
    },

    async getCoverUrl() {
      if (!this.settings.useTidalCovers) return null;

      const coverUrl = this.currentTrack?.cover_url;

      if (typeof coverUrl === "string") {
        try {
          const url = new URL(coverUrl);
          if (url.protocol === "http:" || url.protocol === "https:") {
            return coverUrl;
          }
        } catch {}
      }

      if (this.currentTrack?.title && this.currentTrack?.artist) {
        const cacheKey = `${this.currentTrack.artist}-${this.currentTrack.title}`;

        if (this.coverCache.has(cacheKey)) {
          return this.coverCache.get(cacheKey);
        }

        const foundCover = await this.searchCoverFromTidal();
        if (foundCover) {
          this.coverCache.set(cacheKey, foundCover);
          this.pruneCache();
          return foundCover;
        }
      }

      return null;
    },

    async searchCoverFromTidal() {
      if (!this.api?.request) return null;

      try {
        const coverUrl = await this.api.request("searchCover", {
          title: this.currentTrack.title,
          artist: this.currentTrack.artist,
          trackId: this.currentTrack?.id || null,
          requester: "Discord Rich Presence",
        });

        return coverUrl;
      } catch (error) {
        return null;
      }
    },

    pruneCache() {
      if (this.coverCache.size > this.MAX_COVER_CACHE_SIZE) {
        const entries = Array.from(this.coverCache.entries());
        const toKeep = entries.slice(-this.MAX_COVER_CACHE_SIZE / 2);
        this.coverCache.clear();
        toKeep.forEach(([key, value]) => this.coverCache.set(key, value));
      }
    },

    async clearPresence() {
      if (!this.isConnected) return;

      try {
        await this.api.discord.clearPresence();
      } catch (error) {
        console.error("[Discord RPC] Clear failed:", error);
      }
    },

    start() {},

    stop() {
      this.clearPresence();

      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
        this.updateTimeout = null;
      }
    },

    destroy() {
      this.disconnect();

      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
      }

      if (this.connectionStatusInterval) {
        clearInterval(this.connectionStatusInterval);
      }

      const modal = document.getElementById("drpc-modal");
      const overlay = document.getElementById("drpc-overlay");
      const style = document.getElementById("drpc-styles");

      if (modal) modal.remove();
      if (overlay) overlay.remove();
      if (style) style.remove();
    },
  };

  if (typeof Audion !== "undefined" && Audion.register) {
    Audion.register(DiscordRPC);
  } else {
    window.DiscordRichPresence = DiscordRPC;
    window.AudionPlugin = DiscordRPC;
  }
})();
