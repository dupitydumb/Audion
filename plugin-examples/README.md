# Audion Plugin Examples

This folder contains example plugins demonstrating the Audion plugin system.

## Plugins

For a complete guide on creating plugins, including API reference and permissions, see the [Plugin Development Guide](../PLUGINS.md).

### 1. Now Playing Notifier
Shows system notifications when the track changes.
- **Type:** JavaScript
- **Permissions:** `player:read`, `system:notify`
- **Category:** Utility

### 2. Play Counter
Tracks how many times each song has been played.
- **Type:** JavaScript
- **Permissions:** `player:read`, `storage:local`
- **Category:** Library

### 3. Keyboard Shortcuts
Adds global keyboard shortcuts for playback control.
- **Type:** JavaScript
- **Permissions:** `player:control`
- **Category:** Utility
- **Shortcuts:**
  - `Space` - Play/Pause
  - `←` / `→` - Previous/Next track
  - `↑` / `↓` - Volume up/down
  - `M` - Mute

### 4. Theme Customizer
Transform Audion's look with stunning visual themes.
- **Type:** JavaScript
- **Permissions:** `ui:inject`, `storage:local`
- **Category:** Appearance

### 5. Tidal Search
Search and browse tracks from the Tidal catalog.
- **Type:** JavaScript
- **Permissions:** `network:fetch`, `ui:inject`, `player:control`
- **Category:** Library
- **Features:**
  - Search for tracks and artists
  - View album art, duration, and quality badges (Hi-Res, Lossless)
  - Toggle between track and artist search modes

## Plugin Structure

Each plugin requires:
- `plugin.json` - Manifest file with metadata
- `index.js` (or `.wasm` for WASM plugins) - Entry point

## Creating Your Own Plugin

```javascript
(function() {
    const MyPlugin = {
        name: 'My Plugin',
        
        init(api) {
            // Called when plugin is loaded
            this.api = api;
        },
        
        start() {
            // Called when plugin is enabled
        },
        
        stop() {
            // Called when plugin is disabled
        },
        
        destroy() {
            // Called when plugin is unloaded
        }
    };
    
    window.MyPlugin = MyPlugin;
    window.AudionPlugin = MyPlugin;
})();
```
