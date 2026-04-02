# Release Notes - Audion

## [v1.2.7] - 2026-03-31

### 🚀 New Features
- **Smart Playlists**: Added support for Folder-based playlists.
- **Audio Experience**: 
  - Implemented Gapless Playback and Replay Gain.
  - Added ListenBrainz-powered Recommendations component for personalized music suggestions.
- **Media Controls**: 
  - Enhanced Android media notifications with playback controls and 'loved' track functionality.
  - Added previous and next actions to the media notification service.
- **Lyrics & Metadata**:
  - New Offline Lyrics download capability.
  - Added support for more metadata and embedded lyrics.
  - Improved Cover Fetching mechanism.
- **Synchronization**:
  - Implemented account synchronization API.
  - Added Tauri backend sync with Cloudflare.
  - Integrated activity tracking (liked tracks, play history).
- **Customization**: Added Pinned Items and Custom Artwork support.
- **Plugins**: Added Tidal Search plugin definition.

### 🛠 Bug Fixes & Improvements
- **UI/UX**:
  - Multiple fixes for Mobile UI and metadata modals on mobile.
  - Overall UI polish and improvements.
  - Fixed Album cover display issues on the home screen.
  - Fixed Picture-in-Picture (PiP) mode on desktop.
- **Lyrics**: Improved cached `.lrc` import feature.
- **Sync & Data**:
  - Fixed playlist duplication during synchronization.
  - Resolved issues with "Audion Wrapped" not saving correctly.
  - Fixed Auto-Sync and Recap summary issues.
- **Discovery**:
  - Fixed MusicBrainz discovery and external URL navigation.
  - Resolved recommendation logic issues.
- **General**:
  - Updated versioning and enhanced README screenshots.
  - Various bugfixes and code cleanup.

---
*Based on commits from v1.2.7 to current master.*
