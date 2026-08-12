# Release Notes - Audion

## [v1.3.9] - 2026-08-12

### Highlights: OS Media Integration, Library & Lyrics Management

* **OS Media Integration**: Full Windows SMTC (System Media Transport Controls) support — playback controls, album art, and track metadata surface natively in the OS media overlay and taskbar. Windows Thumbar now shows live playback progress with pause state.
* **Library Management**: Replaced single Android music folder picker with full multi-folder desktop library management. Folder scanning is progressive with improved performance via HashSet-based playlist counts.
* **Lyrics Management**: Added source priority controls, bulk delete by source, per-source delete, and custom search query overrides in the lyrics panel.
* **Context Menus**: Comprehensive native context menu system (`contextMenus.ts`) for tracks, playlists, and library items.
* **Export**: New export command module for track/library data.
* **Startup & Navigation**: Launch-on-startup toggle, startup page setting, and last-visited view restore on relaunch.

### New Features & Enhancements

* **SMTC / Media Session**: Windows System Media Transport Controls wired to player state via `smtc.rs` and `media-session.ts`; artwork and metadata update on track change.
* **Windows Thumbar Progress**: Thumbar progress bar tracks playback position; paused state reflected correctly (Windows only).
* **Move to Playlist**: Track list now supports move-to-playlist action alongside existing add-to-playlist.
* **Search Results**: Album and duration columns added to search results view.
* **Fullscreen Player**: Album name in fullscreen player is now clickable (navigates to album detail).
* **Tray Fix**: Window now restores correctly when app is minimized to tray.
* **Workflow**: CI pr-check workflow fixed; release workflow updated; SDK version bumped.

### Bug Fixes

* **Windows COM**: Initialize COM apartment before Jump List COM calls to prevent crash on startup.
* **Playlist Counts**: Use HashSet for deduplication to fix incorrect playlist track counts.
* **Tray Restore**: Fixed window not showing when activated from tray while minimized.
* **SDK**: Bumped SDK version to resolve flagged build issues.

