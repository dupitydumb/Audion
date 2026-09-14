# Release Notes - Audion

## [v1.4.0] - 2026-09-14

### Highlights: Performance, Linux Support, Settings Redesign & Search History

* **Performance**: Throttled the RAF position ticker from 60fps to 4fps store writes — eliminates ~17% GPU process load on macOS and reduces CPU usage across all platforms while keeping crossfade timing precise.
* **Search History**: Spotify-style search history with recent query strings and recently-played tracks, albums, and playlists shown as cards when the search bar is focused and empty. Persisted to localStorage, deduplicates, max 20 items.
* **Settings Redesign**: Tab-based settings with clearer grouping (Sound · Library · Appearance · Account · More). Desktop view always expands sections as styled headings. Sync section only shown when logged in. Layout toggle buttons now include icons.
* **Linux Fixes**: AppImage crash caused by unconditional `APPDIR` env var fixed — WebKit now correctly falls back to system-provided helper processes. Flatpak fixed with correct build command (`npm run tauri build -- --bundles none`), home filesystem access, and MPRIS permissions.

### New Features

* **Search History**: Shows on search focus when query is empty. Tracks recent query strings and recently-played items (tracks, albums, playlists) with cover art. Individual remove and clear-all supported. Clicking a history item re-searches or navigates directly to album/playlist.
* **Settings Tab Navigation**: Five tabs (Sound, Library, Appearance, Account, More) replace the previous flat list. Desktop always expands sections; mobile uses collapsible accordions.
* **Layout Toggle Icons**: Auto/Desktop/Mobile layout override buttons now show sliders/monitor/smartphone icons.

### Bug Fixes

* **macOS/All Platforms CPU**: `currentTime` store and derived `progress` store were updating at 60fps, causing constant DOM and GPU repaints. Store writes now throttled to 250ms (4fps); crossfade threshold check still runs every frame for accuracy.
* **Linux AppImage Crash**: `WebKitNetworkProcess` not found — wrapper script was unconditionally setting `APPDIR=$HERE`, directing WebKit to look inside the AppImage for system helper processes that aren't bundled. Fixed with a file-existence guard.
* **Linux Flatpak**: Plain `cargo build` skips the Vite frontend build — binary launched with no UI. Fixed to `npm run tauri build -- --bundles none`. Added `--filesystem=home:rw`, `--talk-name` and `--own-name` for MPRIS.
* **Settings Pane Width**: Legacy `.settings-pane { width: 50% }` rule from old slider layout was capping the settings panel at half width on desktop. Fixed to `width: 100%`.
* **Settings Empty Space**: Accordion sections defaulted to closed on desktop, leaving tabs blank. Fixed with `isDesktop` detection via `matchMedia` — all sections open by default on desktop, with chevrons hidden and triggers styled as section headings.
* **Settings Icon Names**: `palette` and `ellipsis` are not registered Lucide icons — Appearance and More tabs showed no icon. Fixed to `monitor` and `more-horizontal`.
* **Backend Badge Color**: Native/HTML5 backend badge used `#4ade80` (bright green), clashing with the player bar. Changed to `var(--text-subdued)` with neutral background.
* **Sync Section Visibility**: SyncSection was always rendered in settings. Now gated behind `{#if $isLoggedIn}`.
* **Search Bar Focus (Desktop)**: Clicking the search bar caused it to immediately lose focus. Fixed by adding a blur guard that skips `handleBlur` when focus moves to an INPUT or TEXTAREA.

### UI Rehaul & Lucide Icon Migration

* **Lucide Icon System**: Migrated all icons across the entire app to Lucide — PlayerBar, Sidebar, TitleBar, MiniPlayer, FullScreenPlayer, AlbumDetail, ArtistDetail, ContextMenu, DesktopHome, LyricsPanel, MainView, and more. All icon usage now goes through the central `Icon.svelte` component; a `check-icons.js` script validates registered icon names at build time.
* **Context Menu Icons**: Context menu entries now show matching icons for all actions.
* **Animation & Transitions**: Rearranged and improved animation/transition timing throughout the app.
* **UI Polish**: Minor UI fixes across album, playlist, and artist views; header alignment; secondary artist name text styling; community header hidden when no community features are enabled; plugin dropdown fixed.

### PR #132 — Multiple Artists, Lyrics Engine, OS Integrations and Audio Backend (@SmileofHaven)

* **Multiple Artists**: Full multi-artist support with splitting rules and album artist handling. Artist links, artist detail view, artist grid.
* **Parametric EQ**: Full parametric equalizer editor with filter types, gain, frequency, Q controls, and response curve visualization.
* **ReplayGain**: ReplayGain support for HTML5 backend.
* **Native Crossfade**: Stable native audio crossfade via dual-track engine (`dual_track.rs`).
* **Dynamic Lyrics Alignment**: Lyrics alignment configurable per-song.
* **Volume Limiter**: Configurable volume ceiling.
* **Fullscreen Mesh Background**: Customizable animated mesh gradient background for fullscreen player, with settings panel.
* **Marquee Text**: Hardware-accelerated `MarqueeText.svelte` for long track/artist names.
* **Native Notifications**: `native-notification.ts` + `notifications.rs` — OS-level playback notifications.
* **File Associations**: Open audio files directly in Audion.
* **CLI Flags**: App responds to `--uri`, `--play`, and other CLI arguments.
* **Windows Context Menu**: File Explorer context menu integration.
* **Linux Quick Actions**: `.desktop` quick-action entries for Linux.
* **Windows Taskbar Overlay**: Taskbar icon overlay for playback state.
* **MSIX Bundling**: CI now builds MSIX packages for Windows Store.
* **Android Audio**: Fixed native Android audio backend.
* **Linux Resize Handles**: Custom resize handle component for frameless Linux window.
* **Mobile Layout Detection**: Layout mode now detected by OS (not window size).
* **Reorder Feature**: Track reorder in playlists.
* **Toggle Lyrics**: Lyrics panel toggle.
* **i18n**: Wired remaining UI strings through svelte-i18n; locale reactivity improvements; added ES, FR, RU translation updates.

Thanks to @SmileofHaven

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

Thanks to @SmileofHaven