## [v1.5.2] - 2026-11-27

### Highlights: Lyrics Auto-Scroll Fix, Stream Playback Stability, Toast Coalescing, Accent Preservation, and Android Icon & Build Polish

### 🎨 UI & Theme Fixes

* **Right Inspector Lyrics Auto-Scroll**:
  * Fixed the right inspector dock lyrics container flex layout so synced lyrics auto-scroll and scroll manually as expected.
* **Accent & Progress Bar Color Preservation**:
  * Fixed `matchPlayerToArt` track-change updates so only the player bar background updates, preserving custom and plugin-applied `--accent-primary` and progress bar colors.
* **Toast Deduplication & Stack Cap**:
  * Coalesces repeated identical toasts into a single toast with a `×N` badge and caps the visible stack at 3, preventing screen overflow during bulk album saves or repeated errors.
* **English Localization Completeness**:
  * Added 15 missing English locale keys in `en.json` across Artist, TrackList, Sidebar, Playlists, Lyrics, and Player UI.

### 🎧 Audio & Playback

* **HTML5 Stream Error Fix**:
  * Cleanly detaches `<audio>` sources on stop/cleanup/backend switches and guards against empty resolved stream URLs, eliminating spurious `Empty src attribute` errors when playing streams or transitioning tracks.

### 🧩 Plugins & Library

* **Artist Picture Resolver Hook**:
  * Added a unified `resolveArtistPicture` hook supporting `CoverSource` (`type: 'artist'`) and `MetadataProvider` plugins across `ArtistGrid` and `ArtistDetail`, with legacy fallback preserved.

### 📱 Android & Mobile

* **Adaptive Launcher Icon Polish**:
  * Updated the Android adaptive icon with a full-bleed gradient background and centered safe-zone foreground glyph so the logo no longer clips or looks tight inside circular/squircle launchers.
* **Android Runtime & Packaging**:
  * Fixed `com.audionplayer.audion` JNI `initAudioContext` exports for native audio initialization and Gradle `libc++_shared.so` bundling for both `.apk` and `.aab` builds.
