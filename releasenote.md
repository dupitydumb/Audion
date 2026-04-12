# Release Notes - Audion

## [v1.3.0] - 2026-04-13

### Featured Highlights

#### High-Performance Infrastructure Migration
We have successfully migrated Audion to a dedicated VPS. This upgrade significantly increases our request capacity, providing enhanced bandwidth and faster response times for all users.

#### Universal Account Synchronization
With our expanded server capacity, **Account Sync is now available for all users**, including the Free Tier. Synchronize your music library effortlessly across your devices.
- **Free Tier Limits:**
  - Total Songs: 100
  - Total Playlists: 3
  - Songs per Playlist: 30

#### Device Connection & Remote Control
Introducing the **Connect Device** feature. Synchronize your playback state across devices and use one device as a remote control for your Audion experience.

---

### Lyrics Engine Overhaul @SmileofHaven

We have completely redesigned the lyrics pipeline, transitioning from a single-format system to a robust, modular architecture.
- **Extended Format Support:** Full compatibility with TTML, SRT, XML, LRC, USLT, SYLT, and JSON formats.
- **New Apple Music Provider:** Integrated Apple Music as a primary lyrics source.
- **Advanced Sync Features:** 
  - Added support for syllable-level and word-level synchronization.
  - Optimized word-level fill animations utilizing CSS `background-size` transitions.
  - Support for unsynced lyrics prose and square-bracket format synchronization.
- **Enhanced Metadata Handling:** Improved support for structure text and opposite vocals metadata.

### Technical Improvements & Fixes

- **Manual Source Selection:** Explicit source selection is now available in the UI; preferences are saved and persisted.
- **Advanced Extraction Engine:** 
  - Upgraded embedded extraction logic (SYLT priority over USLT).
  - Intelligent MPEG-frame SYLT timestamp conversion to milliseconds.
  - Added `metaflac` and `mp4meta` as fallbacks for robust metadata extraction.
  - Expanded codec support for lyrics extraction including FLAC and MP4.
- **Caching & performance:**
  - Independent caching for different sources to maximize availability.
  - Visual indicators for cache status per source.
  - Hardened security by restricting frontend filesystem access.
- **UI/UX refinements:**
  - Native Drag-and-Drop support for importing lyrics files.
  - Enhanced synchronization detection to avoid false positives on section headers (e.g., `[Verse 1]`).
  - Various under-the-hood cleanups and bug fixes.

---

### Supporter Benefits & Tiers
To support the ongoing maintenance and development of the platform, we have structured our supporter tiers:
- **Weekly ($1.00 – $2.99):** 7 days of Pro access.
- **Monthly ($3.00 – $19.99):** 31 days of Pro access.
- **Annual ($20.00 and above):** 366 days of Pro access.
- *Subscriptions remain at a 35-day rolling window per payment.*

**Special Note for Early Supporters:**
If you supported Audion prior to this update, your remaining access time remains unchanged. As a token of appreciation, we have added **one extra month** to the current remaining time for all existing supporters.

Thank you for helping Audion grow.

---