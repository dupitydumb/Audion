# Audion Plugin Development Guide

Welcome to the Audion plugin development guide. This document covers everything you need to know to create extensions for Audion.

## Introduction

Audion's plugin system allows you to extend the player's functionality using **JavaScript** or **WebAssembly**. Plugins run in a sandboxed environment but can interact with the player through a permission-based API.

With plugins, you can:
- **Control Playback**: Play, pause, seek, and manage the queue.
- **Read State**: Access current track info, playback time, and library data.
- **Inject UI**: Add custom buttons, panels, and menu items to the interface.
- **Store Data**: Persist settings or plugin-specific data locally.
- **Resolve Streams**: Integrate external music sources like streaming services.

## Getting Started

1.  Navigate to the `plugin-examples` directory.
2.  Create a new folder for your plugin, e.g., `my-plugin`.
3.  Create a `plugin.json` manifest file.
4.  Create an `index.js` entry point file.

## Plugin Structure

### 1. Manifest (`plugin.json`)

The manifest defines your plugin's metadata and requested permissions.

```json
{
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A brief description of what my plugin does.",
  "author": "Your Name",
  "main": "index.js",
  "type": "js",
  "permissions": [
    "player:read",
    "ui:inject"
  ]
}
```

### 2. Entry Point (`index.js`)

The entry point must define a global object matching your plugin's name (spaces removed) or `AudionPlugin`.

```javascript
(function() {
    const MyPlugin = {
        name: 'My Plugin',
        
        // Called when the plugin is loaded
        init(api) {
            this.api = api;
            console.log('My Plugin initialized!');
            
            // Subscribe to events
            api.on('trackChange', (data) => {
                console.log('Track changed:', data.track.title);
            });
        },
        
        // Called when the plugin is enabled by the user
        start() {
            console.log('My Plugin started');
        },
        
        // Called when the plugin is disabled
        stop() {
            console.log('My Plugin stopped');
        },
        
        // Called when the plugin is completely unloaded
        destroy() {
            // Clean up resources
        }
    };
    
    // Register the plugin
    window.MyPlugin = MyPlugin;
})();
```

## API Reference

The `api` object passed to `init()` provides access to Audion's core features.

### Lifecycle Methods
- `init(api)`: Setup your plugin and save the `api` reference.
- `start()`: Activate logic (e.g., start timers, show UI).
- `stop()`: Deactivate logic.
- `destroy()`: Final cleanup.

### Events (`api.on`, `api.off`)

Listen to player events.

```javascript
api.on('trackChange', ({ track, previousTrack }) => { ... });
api.on('playbackState', ({ isPlaying }) => { ... });
api.on('timeUpdate', ({ currentTime, duration }) => { ... });
api.on('volumeChange', ({ volume }) => { ... });
```

### Player Control (`api.player`)
*Requires `player:control` permission.*

- `api.player.play()`
- `api.player.pause()`
- `api.player.next()`
- `api.player.prev()`
- `api.player.seek(seconds)`
- `api.player.setTrack(trackObject)`
- `api.player.addToQueue(tracks)`

### Player State (`api.player`)
*Requires `player:read` permission.*

- `api.player.getCurrentTrack()`
- `api.player.isPlaying()`
- `api.player.getCurrentTime()`
- `api.player.getDuration()`
- `api.player.getQueue()`

### UI Injection (`api.ui`)
*Requires `ui:inject` permission.*

Inject custom HTML elements into specific slots in the app.

```javascript
const element = document.createElement('div');
element.innerText = "Hello World";
api.ui.registerSlot('sidebar:top', element, 10); // Priority 10
```

#### Available Slots:
- `sidebar:top`: Top of the sidebar, below the logo.
- `sidebar:bottom`: Bottom of the sidebar, above the "Add Music" button.
- `playerbar:left`: Left side of player bar (near track info).
- `playerbar:right`: Right side of player bar (near volume).
- `playerbar:menu`: Dedicated popup menu for plugins (triggered by plugin icon).

### Storage (`api.storage`)
*Requires `storage:local` permission.*

Persist simple data strings.

```javascript
// Save data
await api.storage.set('my-key', 'some value');

// Retrieve data
const value = await api.storage.get('my-key');
```

## Permissions

You must request permissions in `plugin.json` to use these features.

| Permission | Description |
|------------|-------------|
| `player:read` | Read current track, time, status, and queue. |
| `player:control` | Control playback (play, pause, seek, internal queue). |
| `library:read` | Access the entire music library and playlists. |
| `library:write` | Modify library (scan, add external tracks). |
| `storage:local` | Save and load plugin-specific data. |
| `ui:inject` | Render custom UI elements into app slots. |
| `system:notify` | Send native system notifications. |
| `network:fetch` | Make network requests (for streaming/metadata). |

## CSS Styling

Plugins can inject their own `<style>` tags or use inline styles. Audion provides CSS variables for theming that you should use to blend in.

```css
.my-plugin-element {
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    padding: var(--spacing-md);
}
```

**Common Variables:**
- Colors: `--bg-base`, `--bg-surface`, `--text-primary`, `--text-secondary`, `--accent-primary`.
- Spacing: `--spacing-sm`, `--spacing-md`, `--spacing-lg`.
- Radius: `--radius-sm`, `--radius-md`.

## Publishing

Currently, plugins are installed manually by placing them in the `plugins` directory. A marketplace feature is planned for future releases.
