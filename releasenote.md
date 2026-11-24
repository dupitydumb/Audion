## [v1.5.1] - 2026-11-24

### Highlights: Desktop UI Overhaul, Unified Right Inspector Dock, Multi-Row Selection, Ambient Hero Banners, Mobile Bottom-Sheet Gestures, Streaming Safeguards, and Android Release Signing

### Desktop UI Improvements

* **Responsive Left Sidebar & Compact 64px Icon Rail**:
  * Added responsive breakpoint logic that automatically collapses the sidebar into an icon-only 64px rail when the window width drops to $\le$1024px (or $\le$1200px when the right inspector dock is active).
  * Seamlessly preserves the 32px Audion logo, `<SyncStatus />`, and `<LibraryWatcherStatus />` indicators pinned and centered at the top of the 64px rail, maintaining real-time status and tooltip interactivity.
  * Added a manual header chevron toggle button, double-click splitter shortcut, and persistent `lastExpandedWidth` memory so expanding restores custom user widths.
  * Sidebar playlists now serve as interactive drag-and-drop targets for adding tracks.
* **Unified Right Inspector Dock**:
  * Added a dedicated, collapsible side dock with `[Now Playing | Lyrics | Queue]` tabs.
  * Guaranteed strict 1:1 square aspect ratio (`min-height: 200px; aspect-ratio: 1 / 1; object-fit: cover`) for the now-playing cover artwork, eliminating rectangular flexing and container collapse across window sizes.
  * Scoped table cover styles in `TrackList.svelte` to isolate track-row styling and prevent global CSS leakage into the inspector dock.
* **Restored Lyrics Action Bar**:
  * Restored the dedicated lyrics subheader in the right inspector dock.
  * Added a **Share Lyric Card** button that opens the visual lyric card generator and sharing modal.
  * Added an **Import Lyrics File** button supporting `.lrc`, `.ttml`, `.xml`, `.srt`, and `.json` files, with empty-state import actions.
* **Multi-Row Track Selection**:
  * Implemented multi-track selection in track lists supporting `Shift` range click, `Ctrl`/`Cmd` toggle, and `Ctrl+A` select all.
  * Added batch actions allowing selected tracks to be queued or added to playlists in a single click.
* **Ambient Hero Banners & Shimmer Skeletons**:
  * Album and Artist detail headers now feature dynamic palette-driven backdrop gradients with contrast scrims and navigation race-condition guards.
  * Added smooth shimmer skeleton loaders for virtualized card grids and rows during data fetching.
* **Playback Controls & Windows Integration**:
  * **Decoupled Scrubbing**: Smooth progress bar seeking with decoupled dead-reckoning to eliminate position bounce and rubber-banding.
  * **Perceptual Volume Curve**: Implemented acoustic cubic volume curve ($v^3$) for natural logarithmic loudness scaling.
  * **Titlebar Double-Click**: Native titlebar double-click to maximize and restore windows on Windows WebView2.

### Mobile Experience Refinements

* **Interactive Bottom-Sheet Gestures**:
  * Fluid, physics-based swipe-to-dismiss bottom sheet for the mobile player with velocity detection and scroll gesture guards.
* **Hairline Scrubber & Catch-Up Clock**:
  * Word-synchronized lyrics clock with catch-up interpolation for synchronized lyrics display.
* **Grayscale Chroma Guard**:
  * Adaptive color extractor safeguards against murky low-saturation accents on monochromatic album artwork.

### Audio Engine & Streaming Hotfix

* **Streaming Playback Safeguards**:
  * Hardened the playback engine's catalog stream resolution (`_resolveCatalogStream`), explicitly exempting live audio stream sources from being misclassified as catalog preview tracks or hijacked by cross-provider query handoffs.
* **Native Rodio Visualizer Bridge**:
  * Canvas audio visualizer fallback bridge when WebAudio graph processing is bypassed.

### Platform & Packaging

* **Package Identifier Standardisation**:
  * Standardised application identifier to `com.audionplayer.audion` across Tauri configuration, Flatpak manifests, Windows Thumbar, and notification services.
* **Android Release Signing**:
  * Configured release AAB/APK signing via `keystore.properties` in Gradle.
