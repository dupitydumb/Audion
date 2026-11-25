## [v1.5.1] - 2026-11-24

### Highlights: Desktop Responsive Sidebar & Dock Overhaul, Multi-Track Selection, Perceptual Volume, Streaming Safeguards, and Android Release Signing

### 🎨 Desktop UI Overhaul

* **Responsive Left Sidebar & 64px Icon Rail**:
  * Automatically collapses into a sleek 64px icon rail on compact screens ($\le$1024px, or $\le$1200px when the inspector dock is active).
  * Keeps the Audion logo, `<SyncStatus />`, and watcher indicators pinned and interactive at the top of the rail with full tooltips.
  * Added a manual collapse/expand header button and double-click splitter shortcut with memory for custom widths.
  * Playlists in the sidebar now support drag-and-drop targeting for quickly adding tracks.
* **Unified Right Inspector Dock**:
  * Collapsible side dock featuring **Now Playing**, **Lyrics**, and **Queue** tabs.
  * Guaranteed 1:1 square cover artwork with zero flex collapse across all screen sizes.
  * Restored lyrics action bar with one-click **Lyric Card Generator & Sharing** and **Lyrics File Import** (`.lrc`, `.ttml`, `.xml`, `.srt`, `.json`).
* **Multi-Row Track Selection**:
  * Select multiple tracks across your library using `Shift` for range selection, `Ctrl`/`Cmd` for individual toggles, and `Ctrl+A` to select all.
  * Batch add selected tracks to any playlist or append them to the playback queue in one click.
* **Ambient Hero Banners & Shimmer Loading**:
  * Album and Artist detail headers now feature dynamic palette-driven backdrop gradients with contrast scrims.
  * Smooth shimmer skeleton loaders for cards and track rows during data loads.

### ✨ UI Polish & Animations

* **Motion & Depth Transitions**:
  * Added damped spring transitions across desktop popovers, view depth transitions, tab switches, shared-element hero cover morphs, and staggered grid animations.
  * Unified mobile drawer, modal, and bottom context menu slide-up transitions with damped spring physics.
  * Added a spring pop-in animation to the desktop context menu that cleanly re-animates when re-opened at a new position.
* **PlayerBar & Queue Polish**:
  * Added track-change transitions for album art and track details, a spring-pop heart animation, and animated responsive collapsing into the overflow menu without overlapping the progress bar or hiding the volume slider on normal desktop widths.
  * Fixed active player controls (shuffle, repeat, sleep timer, and device indicator) to follow skin and theme `--accent-primary` colors.
  * Added a floating drag ghost and smooth row-parting animations when reordering tracks in the Queue panel.
* **Sidebar, Titlebar & TrackList Refinement**:
  * Polished sidebar and titlebar light-mode contrast, button press feedback, spring rail collapse transitions, and collapsed section dividers.
  * Fixed titlebar breadcrumbs overlapping the search bar on smaller windows with clean truncation and responsive hiding on narrow widths.
  * Boosted hero cover backdrop vibrancy, theme-aligned the TrackList jump strip and selected rows, and added an animated equalizer soundwave indicator for the playing track.

### 🎧 Audio & Playback Polish

* **Streaming Playback Safeguards**:
  * Hardened the playback engine to explicitly protect live audio feeds (e.g. internet radio) from being misclassified as preview tracks or hijacked by cross-provider query handoffs.
* **Perceptual Cubic Volume Curve**:
  * Implemented acoustic cubic volume scaling ($v^3$) for natural, gradual volume control at lower listening levels instead of harsh linear steps.
* **Decoupled Smooth Scrubbing**:
  * Eliminated rubber-band bouncing and dead-reckoning jitter when scrubbing the progress bar.

### 📱 Mobile & Platform

* **Interactive Bottom-Sheet Player**:
  * Fluid swipe-to-dismiss gesture for the mobile player with velocity detection and boundary guards.
  * Word-synchronized lyrics catch-up clock for synchronized lyric scrolling.
* **Platform & Packaging**:
  * **Android Release Signing**: Configured official release AAB/APK signing via keystore.
  * **Windows Titlebar Controls**: Native double-click titlebar to maximize and restore windows.
  * **App Identifier**: Standardised application identifier to `com.audionplayer.audion`.
