## [v1.4.1-beta] - 2026-09-20

### Highlights: Theming Engine, Android Auto, Opus Codec, Hybrid Layout & Linux Stability

* **Theming Engine & Community Themes**: Complete theming system with `.audiotheme` export/import, in-app Theme Browser, custom backgrounds (solid, gradient, image, video), customizable color tokens, animation presets, audio visualizers, and sandboxed custom JavaScript visual effect overlays (`customJs`).
* **Theme Deep Linking**: One-click theme installation from web or links via `audion://install-theme?url=...` with confirmation prompt.
* **Android Auto**: Full Android Auto integration — browse library, play tracks, control playback, and navigate playlists from your car display.
* **Opus Codec**: Native Opus audio support with multichannel decoding and x86-32 build fix. Plays `.opus` files directly via the native audio engine.
* **Hybrid Layout**: New hybrid layout mode combines desktop and mobile UI elements. Volume control added to mobile fullscreen player. Layout detection refined.
* **Linux Stability**: Fixed library-loading hang on CachyOS and other distributions (issue #139) — DB integrity check now delayed 60s past startup to avoid mutex preemption. Flatpak sandbox corrected so app actually launches. Removed invalid `--socket=pipewire` flag from Flatpak build.
* **Subsonic Server**: Connect to your own Navidrome/Subsonic server and browse your library — artists, albums, and tracks streamed directly in-app.

### New Features

* **Custom Themes & Community Browser**:
  * Export and import portable `.audiotheme` packages.
  * In-app Theme Browser with realistic mini app UI previews showing sidebar, content cards, and player bar.
  * Deep link support (`audion://install-theme?url=...`) to preview and apply community themes directly.
  * Custom background layer supporting solid colors, CSS gradients, images, and videos with adjustable opacity and blur.
  * Optional custom JavaScript visual effect overlay runner (`customJs`) rendering canvas animations (e.g. rain, snow, matrix code, ambient glowing orbs) with user safety toggle.
  * WCAG luminance tokens (`--text-on-accent`, `--text-on-player`) ensuring legibility across dynamic theme palettes.
* **Android Auto**: Browse and play your full library, control playback (shuffle, repeat), and queue tracks from any Android Auto-compatible head unit. Cold start support — app launches directly into the correct playback context from the car.
* **Full Opus Support**: Native Opus codec via `opus.rs`. Multichannel Opus decoding. Patched `opus-rs` for x86-32 build stability.
* **Hybrid Layout Mode**: New layout option blending desktop and mobile views. Volume slider in mobile fullscreen player.
* **Playlist Column Headers**: Sortable column header row in track lists.
* **Export Logs**: Route cold-start diagnostic logging through the existing file export feature.
* **Select All in Playlist**: Select all tracks in a playlist in one action.
* **Shuffle & Repeat in Android Auto**: Shuffle and repeat controls exposed in the Android Auto media UI.
* **Subsonic Browser**: Three-panel artist → album → track browser for Subsonic/Navidrome servers. Appears in sidebar when a server is configured (Settings → Subsonic Server).

### Bug Fixes

* **Linux — Library Loading Hang** (issue #139): DB integrity check ran at startup on a native thread, causing mutex contention that blocked `get_library` on CachyOS and similar distributions. Fixed by delaying the check 60s after launch.
* **Linux — Flatpak Sandbox**: Flatpak was built with incorrect permissions — app launched but immediately crashed. Fixed sandbox flags: correct filesystem, socket, and device permissions.
* **Linux — Flatpak `--socket=pipewire`**: `pipewire` is not a valid `flatpak build-finish` socket value; removed to unblock builds.
* **Linux — AppImage GPU crashes**: `LIBGL_DRI3_DISABLE` is now opt-in (`AUDION_DISABLE_DRI3=1`) instead of forced — prevents llvmpipe fallback on Mesa 23+ (Fedora, Arch, Bazzite). `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`, and Wayland/XWayland detection added to the AppRun wrapper for broader distro compatibility.
* **Linux — appimagetool pinned**: `appimagetool` is now pinned to release/13 (SHA256 verified) instead of the rolling `continuous` channel, which had historically broken builds.
* **Android Storage Permission**: App now prompts for storage permission on Android when required.
* **Server Sync**: Fixed auth token refresh flow and sync command handling in `sync/auth.rs` and `tauri.ts`.
* **Opus Multichannel Crash**: Fixed decoder panic on multichannel Opus streams.
* **Opus `repeat-one` Pre-skip Leak**: Pre-skip was not reset between tracks in repeat-one mode.
* **Android Auto — `playMediaId`**: Fixed incorrect media ID resolution breaking playback from Android Auto.
* **Android Auto — Repeat & Shuffle Context**: Shuffle and repeat state now correctly propagated to and from Android Auto session.
* **Lyrics Priority**: Lyrics source priority now correctly respects the auto-fetch setting. Partial deletion handled without false success.
* **Unavailable Tracks in Batch Queue**: Filtered unavailable tracks from batch add-to-queue to prevent silent playback failures.
* **Keyboard Accessibility**: Fixed keyboard activation for checkboxes, volume bar, and seek bar.
* **Global Selector**: Fixed invalid global CSS selector causing style bleed. Safe top padding applied. Minimum window size enforced.
* **Hide Keyboard Settings on Mobile**: Keyboard shortcut settings section no longer shown on mobile.
* **Deprecated Android SDK Tools**: Removed use of deprecated `tools` in Android SDK config. Fixed invalid `--bundles none` flag.

### Linux Compatibility

This release ships with an improved AppImage wrapper validated against multiple distributions in CI:

| Distro | Runner | Status |
|--------|--------|--------|
| Ubuntu 22.04 LTS | `ubuntu-22.04` | ✅ Smoke tested |
| Ubuntu 24.04 LTS | `ubuntu-24.04` | ✅ Smoke tested |
| Fedora 40 | `fedora:40` container | ✅ Smoke tested |

The AppImage is built on Ubuntu 22.04 (glibc 2.35) for maximum compatibility. It should run on any x86-64 Linux distribution released after 2022 with WebKitGTK 4.1 available system-wide.

**Known issues on specific distros:**
- **Bazzite / immutable distros with broken EGL**: If you see a blank white window, set `AUDION_DISABLE_DRI3=1` before launching to force the software renderer.
- **NixOS**: Run with `--no-sandbox` or wrap via `nixpkgs.buildFHSEnv`. The AppImage sandbox conflicts with NixOS's namespacing.
- **Wayland-only sessions (no XWayland)**: App will attempt native Wayland. If it fails to start, install `xwayland` or launch with `GDK_BACKEND=wayland`.
