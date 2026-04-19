# Release Notes - Audion

## [v1.3.1] - 2026-04-19

### Featured Highlights

#### Desktop Playback & Window Experience
This patch improves day-to-day playback flow on desktop with focused quality-of-life fixes:
- Added **Windows thumbar** support for faster media control from the taskbar.
- Fixed duplicate title bar behavior after using **Picture-in-Picture (PiP)**.
- Fixed fullscreen layout issues for a more consistent viewing experience.

#### Android Reliability Improvements
We resolved several Android-specific regressions to improve stability:
- Fixed Android media handler issues.
- Fixed Android folder handling problems.
- Improved resume behavior to prevent playback from failing to continue.

#### Queue, Library & Data Consistency
Playback and library data handling are now more reliable:
- Fixed queue reordering behavior.
- Improved scanning reliability.
- Added a `date_added` field to tracks and backfilled existing entries for better metadata consistency.

---

### Platform, Build & Release Pipeline
- Enhanced Linux build environment with additional WebKit dependencies.
- Improved Flatpak and release workflow reliability in CI/CD (installation handling, tag/artifact validation, and builder setup).

### Additional Fixes
- Settings and temporary dashboard behavior refinements.
- General under-the-hood stability improvements and cleanup.