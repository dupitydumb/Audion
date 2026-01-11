# Release Notes - Audion v1.1.0

We are excited to announce the release of Audion v1.1.0! This update focuses on community integration, UI consistency, and improved documentation for plugin developers.

## 🚀 New Features

### Community Integration
- **Discord Link**: Added a direct link to the Audion Discord community in the sidebar. Connect with other users and developers!
- **Settings Toggle**: Added a new option in **Settings > General** to show or hide the Discord button in the sidebar, giving you full control over your interface.

## 🎨 UI/UX Improvements

### Sidebar Styling
- **Consistent Design**: The "Settings" section in the sidebar has been restyled to perfectly match the "Library" and "Playlists" sections, providing a more cohesive visual experience.

## �️ Plugin System Updates

### New APIs
- **Streaming Support**: Introduced `api.stream` to allow plugins to register custom stream resolvers for external music sources.
- **Library Management**: Enhanced `api.library` with `addExternalTrack` and `downloadTrack` capabilities, enabling plugins to deeply integrate with the user's library.

### Documentation
- **Plugin Development Guide**: We've added a comprehensive [Plugin Development Guide](PLUGINS.md) (`PLUGINS.md`) to help developers create amazing extensions for Audion.
- **Updated README**: The `README.md` now includes a Discord badge and points to the new plugin documentation.

## 🐛 Bug Fixes

- **Tidal Plugin**: Resolved an issue where fetching library tracks caused a crash, and fixed "Hi-Res" tracks being incorrectly tagged as "Lossless".
- **Album Art**: Fixed album art display issues in the Queue and Fullscreen player for external tracks.
- **UI Interaction**: Fixed the plugin menu button in the player bar not responding to clicks.
- **Visuals**: improved Light Mode support for the Fullscreen Player and cleaned up unused CSS in Settings.

## 🔧 Maintenance

- **Version Bump**: Updated application version to **1.1.0**.
