## [v1.4.2] - 2026-10-26

### Highlights: Free Trial Cloud Access, Auth Hardening, Live Library Watcher, and AppImage Fixes

* **Free Trial Cloud Access**: Cloud sync accounts now include a 7-day free trial period upon registration without requiring immediate supporter status. Account status reflects trial duration and expiration in real time.
* **Authentication Hardening**: The frontend callback handler now uses SHA-256 URL hashing and in-session tracking to suppress duplicate OAuth deep-link callback replays.
* **Live Filesystem Watcher**: Background directory watcher monitors library folders for added, modified, or deleted tracks and updates the database automatically.
* **Multistream Opus Decoding**: Native audio engine handles multichannel and multistream Opus streams cleanly without decoder panic.
* **Linux AppImage Packaging**: Fixed `.DirIcon` symlink resolution in AppImage builds and normalized file permissions to ensure bundles remain executable across distributions.

### New Features

* **Free Trial Access**:
  * New registered accounts receive 7 days of free cloud sync trial access.
  * Real-time trial countdown in settings with automatic status transitions when expired.
  * Localized strings for trial status and notifications in English, French, Spanish, and Russian.
* **Live Library Monitoring**: Integrated filesystem watcher detects file additions, renames, and deletions in library paths in real time.
* **Dynamic Player Bar Styling**: Improved adaptive contrast and background handling on the desktop and mobile player bar.

### Improvements and Bug Fixes

* **Sync and Auth**:
  * Added duplicate callback suppression within the frontend session using SHA-256 URL hashing.
  * Cleared stale trial and supporter metadata from the local database on expiration or logout.
  * Resolved session cleanup when logging out of cloud accounts.
  * Made modal dialog accessibility labels update reactively between email and OAuth modes.
* **Audio Engine**:
  * Added multistream Opus decoding support.
  * Rebuilt EQ source node correctly when preloading tracks across audio element switches.
* **Linux and Packaging**:
  * Fixed broken `.DirIcon` symlink in AppImage packaging workflow.
  * Normalized bundle permissions so AppImage binaries are world-readable.
  * Added independent database connection for startup reconciliation to prevent contention on initial launch.
  * Hardened smoke test suites in CI with structured diagnostic logging.
* **UI and Search**:
  * Improved contrast on player bar action buttons.
  * Fixed artist chip behavior and transitions in search history.
  * Cleaned up view-transition identifiers after page morph animations complete.