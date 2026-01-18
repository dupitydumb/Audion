# Release Notes

## Version 1.1.7

### ✨ New Features

- **Download Functionality**: Added support for downloading tracks (requires `tidal-search` re-installation).
- **Autoplay**: The player now automatically queues random tracks from the library when the current queue ends, ensuring uninterrupted listening.
- **Interactive Lyrics**: Users can now click on a specific line in the lyrics to skip directly to that part of the song.

### 🚀 Enhancements

- **Lyrics Handling**: Prioritized local `.lrc` files in the music folder for lyrics display.
- **Visual Indicators**:
    - Added indicators for unavailable tracks.
    - Added indicators for downloaded tracks.
- **Duration Formatting**: Updated album and playlist duration display to use the `HH:MM` format for better readability.
- **Spotify Converter**: Improved the Spotify converter to handle more than 30 songs at a time.

### 🐛 Bug Fixes

- **Library Organization**: Fixed an issue where albums were split into duplicates if tracks had different artists.
- **Search**: Resolved an issue where playlists were not appearing in search results.
- **Playlists**:
    - Fixed a bug where a single playlist row would consume the full container height.
    - Addressed an issue where playlists were deleted before the confirmation dialog appeared.
- **UI/UX**:
    - Handled image loading errors gracefully when offline or disconnected.
- **Data Integrity**: Fixed a bug where empty albums persisted after tracks were removed.

### ⚠️ Known Issues / Notes

- **macOS/Linux**: Builds for these platforms are currently experimental.