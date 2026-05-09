# Release Notes - Audion

## [v1.4.0] - 2026-05-09

### New Features & Enhancements
- **Extended Metadata Support**: Full support for `track_number`, `disc_number`, `musicbrainz_recording_id`, and additional JSON metadata for library tracks.
- **Advanced Library Scanning**: Overhauled the library import and scanning engine to support new metadata fields and improve overall database consistency.
- **Spotify Playlist Sync**: Enhanced cover art synchronization for Spotify-imported playlists, ensuring high-quality covers are prioritized over placeholders.
- **Spotify Utilities**: Added the ability to copy Spotify URLs directly from the playlist detail view and integrated similar playlist recommendations.

### UI & UX Improvements
- **Lyrics UI Refinement**: Resolved lyrics overflow issues in the FullScreen Player. Implemented dynamic wrapping for long lines and optimized scaling to prevent text clipping.
- **Optimized FullScreen Layout**: Reduced the gap between track information and lyrics for a more balanced and aesthetically pleasing desktop experience.
- **Sidebar Enhancements**: Improved playlist cover art loading logic in the sidebar for better visual consistency.

### Bug Fixes & Stability
- **PR Merge Reconciliation**: Successfully resolved complex merge conflicts between the library metadata updates and core plugin runtime.
- **Container Constraints**: Fixed layout breakage caused by long track titles and lyrics in the desktop player view.
- **Mobile Lyric Scaling**: Fine-tuned scaling and padding for mobile lyrics to ensure no text is cut off during playback.


## [v1.3.2] - 2026-04-27

### New Features & Enhancements
- **Localization Support**: Audion is now available in multiple languages, making it accessible to a wider audience.
- **Sleep Timer**: Schedule when your music should stop, perfect for listening before bed.
- **Minimize to Tray**: Keep Audion running in the background while keeping your taskbar clean.
- **Sync Status & Error Handling**: Improved visibility into synchronization issues with clear error messages.
- **Android Fullscreen Menu**: Added a secondary menu to the Android fullscreen player for easier navigation.

### Quality of Life & UI Improvements
- **Support UI Update**: Refreshed the support interface for a better user experience.
- **Mobile Padding Fixes**: Improved layout and padding on mobile devices for a more polished look.
- **Player Bar & EQ**: Various fixes and improvements to the player bar and equalizer functionality.

### Platform & Deployment
- **Flatpak Packaging**: Significant updates to Flatpak configurations and build workflows for better Linux distribution.
- **CI/CD Reliability**: Continuous integration improvements to ensure stable releases across all platforms.