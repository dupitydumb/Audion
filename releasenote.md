## [v1.5.0] - 2026-11-23

### Highlights: Desktop PlayerBar Responsive Overhaul, WebView2 Performance & Memory Optimization, Album Grid Layout Refinements, Curated Plugin Logos, and Cross-Platform Audio Resilience

### New Features & Improvements

* **Responsive Desktop PlayerBar & Staggered Collapsing**:
  * Upgraded PlayerBar layout to an inline-size container query grid with shrinkable columns (`minmax(0, ...)`), eliminating overlapping controls when resizing desktop windows.
  * Staggered collapsing sequence starting at 1525px:
    * Collapses view controls (fullscreen, mini-player) into a new overflow `"⋯"` menu.
    * Collapses horizontal volume slider, lossless badge, and time labels progressively.
    * Centers playback controls down to essential skip/play controls at compact sizes.
  * Added a dedicated quick-actions overflow popover menu containing lyrics, queue, cast, sleep timer, plugin actions, device selector, shuffle, repeat, and a compact volume slider.
* **WebView2 Performance & Resource Optimization**:
  * Dramatic reduction in memory (up to 1GB saved) and CPU overhead (dropped idle background usage from ~20% to ~0%).
  * Background mesh gradient worker now pauses continuous CPU ray calculation and `requestAnimationFrame` loops when audio is paused or when the application is minimized/hidden (`document.hidden`).
  * Fixed MiniPlayer visualizer re-allocating state and looping continuously when paused.
  * Added `--enable-gpu-rasterization --enable-zero-copy` hardware acceleration flags in Tauri configuration.
* **Album Tab Grid Sizing**:
  * Replaced the rigid 924px 2-column breakpoint with responsive auto-flowing columns, keeping album covers square (1:1 aspect ratio) without awkward wide rectangular stretching.
* **Curated Plugin Logos**:
  * Curated marketplace plugins now automatically resolve raw GitHub asset paths for relative icon references, displaying logos properly prior to installation.
* **Cross-Platform Audio Engine & Resilience**:
  * Safe cross-platform `is_exclusive()` capability detection for `OutputSink` across Windows, Linux, macOS, and Android.
  * Corrected negative full-scale conversions in WASAPI exclusive mode and aligned buffer periods.
  * Protected against zip-slip path traversal in archive extraction.

---

## [v1.4.4] - 2026-11-19

### Highlights: Dynamic Island Mini-Player, Provider Ecosystem, Exclusive DAC Output, Plugin Marketplace Taxonomy, and Per-ABI Android APKs

### New Features

* **Island Mini-Player & Notch Mode**:
  * Brand-new Apple Dynamic Island-inspired Mini-Player featuring fluid morphing geometry across compact, peek, HUD volume feedback, and expanded states.
  * Dual display modes: Floating Island and Top Notch mode with screen anchoring and seamless mode switching.
  * Two-line micro-stack layout with animated luminous audio visualizer and Dynamic Island transport glyphs.
  * Native OS-level click-through support using Win32 GDI region masking (`SetWindowRgn`) so areas outside the island pill do not intercept mouse clicks on background apps.
* **Provider Ecosystem**:
  * Dedicated provider management in Settings, separate from the plugin manager, with priority reordering and per-provider enable/disable toggles.
  * Cross-provider stream handoff and resolver bridging, so playback can fall back between streaming sources transparently.
  * Discover now searches across providers and navigates to streamable entities directly.
* **Exclusive DAC Output**:
  * Real exclusive-mode output on Windows (WASAPI) and Linux (ALSA), bypassing the OS mixer for bit-perfect playback.
* **Plugin Marketplace**:
  * Human-readable plugin names, authors, and descriptions in every card and install modal.
  * Canonical plugin categories (Streaming, Metadata, Lyrics, Library, Integration, Appearance, Utility) with category chips, alias support, and multi-value capability badges (`stream`, `metadata`, `lyrics`) — a plugin can now surface under several capabilities at once.
  * Marketplace search matches human labels, not just raw identifiers.
  * Plugin Manager tabs and permission modal are now mobile friendly.
* **Android Per-ABI & Universal APKs**:
  * Android build pipeline now runs on dedicated parallel runners per ABI to build and publish individual architecture APKs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`), significantly reducing download and install size for users who know their device hardware.
  * A combined `universal` Android APK is also generated and published for users who are unsure which architecture their hardware uses.
* **Skin Studio**:
  * Added custom local skin directory support with built-in default skins and an appearance settings refactor.

### Improvements and Bug Fixes

* **Appearance**:
  * Theme now defaults to following the OS light/dark setting for new installs, switches live when the OS appearance changes, and custom color defaults resolve against the active appearance.
* **Last.fm**:
  * Fixed the core API credentials rejected by Last.fm (error 10) and completed the browser auth flow through `audionplayer.com/lastfm`.
  * Connection and disconnection strings are now translated in every supported language.
* **Localization**:
  * Filled in missing Last.fm and ListenBrainz strings across English, Russian, French, and Spanish, and removed hardcoded labels from the scrobbling settings.
* **Mini-Player**:
  * Eliminated faint black/transparent theme background box artifact around the island by hiding background layers in MiniPlayer mode.
  * Fixed missing toggle icons by registering custom Notch and Floating mode icons.
  * Resolved horizontal repositioning jumps and outline glitches during island expansion.
  * Disabled native DWM window shadows in island mode for clean borderless presentation.
* **Queue & Playback**:
  * Filled section height for virtualized queue and added element resize observation.
  * Added `queueExhausted` event handling and prevented premature audio preload eviction on natural track end.
  * Preload now resolves the full stream instead of briefly playing the 30-second preview.
  * Next-up and shuffle indices stay in sync when skipping tracks.
* **Library & Window**:
  * Restored wheel scrolling over album track rows.
  * PiP-sized windows no longer reopen in the normal layout.
* **Database & Performance**:
  * Improved tracklist performance and resolved layout glitches on mobile screens.
  * Added busy timeout and duplicate merging resilience during audio hash migrations.
* **Linux Compatibility**:
  * Added automated Linux smoke-test verification and status reporting after release build across supported distributions.

Thanks to @SmileofHaven and @hunty-97 for helping me with the release.