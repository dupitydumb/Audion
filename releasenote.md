## [v1.4.3] - 2026-11-08

### Highlights: YouTube Music Plugin Enhancements, Live Streaming Metadata Persistence, and Rate-Limit Resilience

### New Features

* **YouTube Music Plugin**:
  * Unified "All" search tab rendering top result hero cards, songs, and albums/playlists.
  * Interactive subtitle links allowing direct navigation to artist and album pages.
  * Album and playlist batch saves to local Library.
  * Automatic duration pre-fetching when saving unplayed search results to Library.
* **Library Host API**:
  * Added `library.removeTrack` and `library.deleteTrack` methods to the plugin runtime API.
  * Added `update_track_duration` Tauri command to persist resolved streaming track durations directly to the SQLite database.

### Improvements and Bug Fixes

* **Streaming Audio & Player**:
  * Prevented unplayed external tracks from displaying blank `--:--` durations in library views.
  * Dynamically updated the `tracks` store and SQLite database when the audio element receives playback duration.
* **Metadata Extraction**:
  * Added strict filtering against duration strings, view counts, and content types during track metadata extraction.
  * Added `findHeaderRenderer` to parse modern YouTube Music responsive headers for album title, artist, and year.
  * Inherited album artist and playlist owner across track listings when individual row artist runs are omitted.
* **Network & UI Resilience**:
  * Added fallback image resolution for palette extraction when `yt3.googleusercontent.com` rate-limits requests.
  * Silenced palette extraction error cascades on rate-limited cover URLs.
  * Added thumbnail fallback onerror handlers in plugin templates.