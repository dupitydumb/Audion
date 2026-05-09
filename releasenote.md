# Release Notes - Audion

## [v1.3.3] - 2026-05-09

### New Features & Enhancements
- **Extended Metadata Support**: Full support for `track_number`, `disc_number`, `musicbrainz_recording_id`, and additional JSON metadata for library tracks.
- **Advanced Library Scanning**: Overhauled the library import and scanning engine to support new metadata fields and improve overall database consistency.
- **Spotify Playlist Sync**: Enhanced cover art synchronization for Spotify-imported playlists, ensuring high-quality covers are prioritized over placeholders.

### UI & UX Improvements
- **Lyrics UI Refinement**: Resolved lyrics overflow issues in the FullScreen Player. Implemented dynamic wrapping for long lines and optimized scaling to prevent text clipping.
- **Optimized FullScreen Layout**: Reduced the gap between track information and lyrics for a more balanced and aesthetically pleasing desktop experience.
- **Sidebar Enhancements**: Improved playlist cover art loading logic in the sidebar for better visual consistency.

### Bug Fixes & Stability
- **PR Merge Reconciliation**: Successfully resolved complex merge conflicts between the library metadata updates and core plugin runtime.
- **Container Constraints**: Fixed layout breakage caused by long track titles and lyrics in the desktop player view.
- **Mobile Lyric Scaling**: Fine-tuned scaling and padding for mobile lyrics to ensure no text is cut off during playback.