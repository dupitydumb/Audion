# Release Notes - Audion

## [v1.3.5] - 2026-06-12

### Highlights: Server Docker Support & Custom Server Integration

* **Server Docker Support**: Audion now officially supports self-hosted deployment using Docker (`audion-server-docker`), enabling seamless hosting of your library with custom server integration.
* **Custom Server Enhancements**: Added library streaming capabilities, backend-supported search, tokenized search results, and secure retrieval of album/cover artwork via local SQLite DB and server origin access tokens.
* **Event-Driven Player Sync**: Replaced interval polling with a modern event-driven architecture and dead-reckoning positional tracking for synchronized and responsive playback.

### New Features & Enhancements

* **Keyboard Shortcut Rebinding**: Added full support for customizing and rebinding keyboard shortcuts.
* **Refined Fullscreen UI**: Restyled the fullscreen playback user interface for a cleaner and more immersive visual experience.
* **Device Info Popover**: Introduced an information popover for audio output devices to provide more clarity on active configurations.
* **Robust Streaming & Connection Handling**: Integrated event-driven playback syncing and automatic handling for connection state resets when switching server accounts or handling server failures.

### Audio & Playback Upgrades

* **Channel-Mix Compatibility**: Added support for automatic upmixing and downmixing of mismatched channel counts.
* **HTML5 Backend Refactoring**: Refactored the player codebase to isolate the HTML5 playback backend from core player logic.
* **Bundled Dash.js**: Replaced the CDN-based `dash.js` with a bundled local import, preventing external dependency fetch issues.
* **MPEG & Lofty Fixes**: Patched duration estimation freezes for MPEG streams and integrated zero-duration fallback logic via Symphonia.
* **Audio Library Updates**: Upgraded critical audio libraries, including `rodio` to `0.22.2`, `rubato` to `3.0.0`, `rayon` to `1.12`, and `lofty` to `0.24.0`.

### Bug Fixes & Stability

* **Device Switching Guards**: Added safety guards preventing redundant switching to the same device, and optimized switching logic with higher probe limit retries and pre-seeded seek positions.
* **Fullscreen Scroll Alignment**: Resolved unsynced scrolling issues when viewing lyrics/content in fullscreen mode.
* **Android CI fixes**: Fixed build and compilation errors in CI pipelines for the Android build.
* **Error & Abort Improvements**: Improved error handling for album cover retrieval, channel mapping, and audio playback abort actions.