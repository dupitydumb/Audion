# Release Notes - Audion

## [v1.3.8] - 2026-06-14

### Highlights: Tray Menu

* **Tray Menu**: Audion now supports detailed menus in the system tray accesible via right lick

### New Features & Enhancements

* *Thumbar Progress**: Thumbar will display progress as the track is played. pauseed is also supported. this is windows only

## [v1.3.7] - 2026-07-04

### Highlights: Linux Compatibility & Mobile UI Polish

* **Linux Compatibility**: Resolved critical startup and IPC connection bugs on Linux/Debian systems, including WebKitNetworkProcess launching, missing IPC CSP rules, and adding a `requestIdleCallback` polyfill for older WebKit versions.
* **Mobile UI Polish**: Enhanced mobile player experience with larger seek bar touch targets and visible seek thumb/progress line. Fixed layout issues on mobile view categories and page paddings.
* **Codebase Refactoring**: Initiated codebase refactoring to improve overall layout structure and responsiveness (in progress).


### Bug Fixes

* **Linux IPC**: Added `ipc:` and `ipc://localhost` to CSP to allow frontend commands to talk to the Rust backend on Linux.
* **Linux GVfs**: Fixed gvfs module errors causing AppImages to crash with undefined symbols.
* **Linux WebKit**: Set `APPDIR` environment variable in the wrapper script so the WebKitNetworkProcess binary can be found correctly.
* **Polyfills**: Added fallback for `requestIdleCallback` so pages load without ReferenceErrors on WebKit/Linux views.
* **Mobile Seek Bar**: Expanded the seek bar hit area to 28px on mobile, made progress line accent-colored and always show the seek thumb.
* **Mobile Category Pills**: Fixed plugin marketplace categories on mobile overlapping and extending weirdly by resetting min-sizes.
* **Mobile Black Screen**: Removed redundant bottom padding calc causing layout breakdown and half-black screens on Artist Detail, Liked Songs, and Playlist views.
* **Grid Column Layout**: Clamped the grid to exactly 2 columns for narrow container widths (< 924px) to ensure consistency when sidebar toggles.
