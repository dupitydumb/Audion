## [v1.4.4] - 2026-11-16

### Highlights: Dynamic Island Mini-Player, Notch Mode, Skin Studio Enhancements, and Performance Optimizations

### New Features

* **Island Mini-Player & Notch Mode**:
  * Brand-new Apple Dynamic Island-inspired Mini-Player featuring fluid morphing geometry across compact, peek, HUD volume feedback, and expanded states.
  * Dual display modes: Floating Island and Top Notch mode with screen anchoring and seamless mode switching.
  * Two-line micro-stack layout with animated luminous audio visualizer and Dynamic Island transport glyphs.
  * Native OS-level click-through support using Win32 GDI region masking (`SetWindowRgn`) so areas outside the island pill do not intercept mouse clicks on background apps.
* **Skin Studio**:
  * Added custom local skin directory support with built-in default skins and an appearance settings refactor.
* **Plugin Installation**:
  * Enhanced plugin install modal displaying full plugin name, author, description, and source repository.

### Improvements and Bug Fixes

* **Mini-Player**:
  * Eliminated faint black/transparent theme background box artifact around the island by hiding background layers in MiniPlayer mode.
  * Fixed missing toggle icons by registering custom Notch and Floating mode icons.
  * Resolved horizontal repositioning jumps and outline glitches during island expansion.
  * Disabled native DWM window shadows in island mode for clean borderless presentation.
* **Queue & Playback**:
  * Filled section height for virtualized queue and added element resize observation.
  * Added `queueExhausted` event handling and prevented premature audio preload eviction on natural track end.
* **Database & Performance**:
  * Improved tracklist performance and resolved layout glitches on mobile screens.
  * Added busy timeout and duplicate merging resilience during audio hash migrations.
