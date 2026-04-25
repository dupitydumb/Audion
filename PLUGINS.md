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

1.  Create a new folder for your plugin, e.g., `my-plugin`.
2.  Create a `plugin.json` manifest file (see structure below).
3.  Create an `index.js` entry point file.
4.  **Test Locally**: Move your plugin folder into Audion's active plugins directory:
    *   **Windows**: `%APPDATA%\audion\plugins\`
    *   **macOS**: `~/Library/Application Support/audion/plugins/`
    *   **Linux**: `~/.config/audion/plugins/`

*(If you are developing an example for the official repository, you can work directly inside the `plugin-examples/` folder).*


## Plugin Structure

### 1. Manifest (`plugin.json`)

The manifest defines your plugin's metadata, entry point, and requested permissions.

```json
{
  "name": "My Plugin",
  "safe_name": "my-plugin",
  "version": "1.0.0",
  "description": "A brief description of what my plugin does.",
  "author": "Your Name",
  "entry": "index.js",
  "type": "js",
  "permissions": [
    "player:read",
    "ui:inject",
    "network:fetch"
  ],
  "repo": "https://github.com/username/my-plugin.git",
  "repository": "https://github.com/username/my-plugin.git"
}
```

#### Key Fields:
- `name`: The display name of your plugin.
- `safe_name` *(Optional)*: The folder name for your plugin. If omitted, it will be generated from the name.
- `entry`: The entry point file (e.g., `index.js` for JS, `index.wasm` for WASM). **Required** (Replaces legacy `main` field).
- `type`: Either `"js"` or `"wasm"`.
- `permissions`: Array of permissions your plugin requires.
- `repo`: The repository URL used for schema validation.
- `repository`: The repository URL used by the `npm run sync-plugins` script.


### 2. Entry Point (`index.js`)

The entry point should register your plugin using the `Audion.register()` method.

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
            console.log('My Plugin destroyed');
        }
    };
    
    // Register the plugin
    if (typeof Audion !== 'undefined' && Audion.register) {
        Audion.register(MyPlugin);
    } else {
        // Fallback for legacy support
        window.MyPlugin = MyPlugin;
        window.AudionPlugin = MyPlugin;
    }
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
- `api.player.removeFromQueue(index)`
- `api.player.reorderQueue(from, to)`
- `api.player.clearUpcoming()`

### Player State (`api.player`)
*Requires `player:read` permission.*

- `api.player.getCurrentTrack()`
- `api.player.isPlaying()`
- `api.player.getCurrentTime()`
- `api.player.getDuration()`
- `api.player.getQueue()`

### Streaming & External Sources (`api.stream`)
*Requires `player:control` permission.*

Register resolvers for external music sources (e.g., Tidal, JioSaavn).

```javascript
// Register a resolver for 'my-service' tracks
api.stream.registerResolver('my-service', async (externalId, options) => {
    // Fetch and return the actual stream URL
    const url = await fetchStreamUrl(externalId);
    return url;
});
```

### Library Management (`api.library`)

#### Read Library (*Requires `library:read` permission.*)

- `api.library.getTracks()`: Returns an array of all tracks in the library.
- `api.library.getPlaylists()`: Returns an array of all playlists.

#### Modify Library (*Requires `library:write` permission.*)

- `api.library.addExternalTrack(trackData)`: Add a track from an external source.
- `api.library.downloadTrack(options)`: Download a track to local storage.
- `api.library.refresh()`: Trigger a library refresh.
- `api.library.createPlaylist(name)`: Create a new playlist.
- `api.library.addTrackToPlaylist(playlistId, trackId)`: Add a track to a playlist.
- `api.library.updatePlaylistCover(playlistId, coverUrl)`: Update playlist cover image.
- `api.library.updateTrackCoverUrl(trackId, coverUrl)`: Update track cover image.

```javascript
// Add an external track to the library
await api.library.addExternalTrack({
    title: "Song Title",
    artist: "Artist Name",
    album: "Album Name",
    cover_url: "https://example.com/cover.jpg",
    source_type: "my-service", // Matches your resolver
    external_id: "12345",
    duration: 180 // seconds
});

// Download a track
await api.library.downloadTrack({
    url: "https://example.com/audio.mp3",
    filename: "Song.mp3",
    metadata: {
        title: "Song",
        artist: "Artist"
    }
});
```


### Network API (`api.fetch`)
*Requires `network:fetch` permission.*

Make CORS-free network requests routed through the backend.

```javascript
const response = await api.fetch('https://api.example.com/data', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer token' }
});
const data = await response.json();
```

### Settings API (`api.settings`)
*Requires `settings:write` or `storage:local` permission.*

```javascript
// Update the global download location
api.settings.setDownloadLocation('/path/to/downloads');
```

### Lyrics API (`api.lyrics`)
*Always available.*

- `api.lyrics.getCurrentTrackLyrics()`: Get all lyrics for the currently playing track.
- `api.lyrics.getCurrentTrackActiveLyric()`: Get the active lyric line for the current track.
- `api.lyrics.getLyrics(musicPath)`: Get lyrics for a specific track file path.
- `api.lyrics.getCurrentLyric(musicPath, currentTime)`: Get the active lyric for a track at a specific time.

### Discord RPC API (`api.discord`)
*Always available.*

- `api.discord.connect()`: Connect to Discord client.
- `api.discord.updatePresence(data)`: Update presence status.
- `api.discord.clearPresence()`: Clear presence status.
- `api.discord.disconnect()`: Disconnect from Discord.
- `api.discord.reconnect()`: Reconnect to Discord.


### Inter-Plugin Communication (`api.request` / `api.handleRequest`)
*Requires defining `cross_plugin_access` in `plugin.json`.*

```javascript
// In Plugin A (Provider)
api.handleRequest('getData', async (params) => {
    return { data: 'value' };
});

// In Plugin B (Consumer)
const result = await api.request('getData', { param: 1 });
```

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
- `playerbar:menu`: Dedicated popup menu for plugins (triggered by plugin icon). **Works on both desktop and mobile.**
- `mobile:home`: Mobile home screen content area.
- `mobile:bottomnav`: Mobile bottom navigation area.

#### Mobile Considerations

On mobile, the app uses a Spotify-like bottom navigation layout. Plugins registered to `playerbar:menu` are accessible from the PluginMenu button in the mobile mini-player bar. For mobile-specific content:

```javascript
// Register a widget on the mobile home screen
const widget = document.createElement('div');
widget.innerHTML = '<p>My mobile widget</p>';
api.ui.registerSlot('mobile:home', widget);
```

- Plugin modals should use `max-width: 90vw` and `max-height: 85vh` for responsive sizing.
- Touch targets should be at least 44×44px.
- Avoid `hover` effects for primary interactions; use `:active` for touch feedback.



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
| `lyrics:read` | Read lyrics data. |
| `lyrics:write` | Modify and save lyrics. |
| `settings:write`| Access and modify app settings (e.g., download location). |


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

## Publishing & Marketplace

Audion features an automated marketplace. Plugins are automatically indexed and made available to users via a GitHub Actions runner.

### How to Publish Your Plugin

To make your plugin available in the Audion Marketplace, follow these steps:

1.  **Create a GitHub Repository**: Host your plugin source code on GitHub.
2.  **Add Topic**: Add the topic `audion-plugins` to your GitHub repository settings.
3.  **Ensure Valid Manifest**: Your default branch must contain a valid `plugin.json` file.

### Indexing Requirements

The automated indexer validates the following:

- **Required Fields**: `name`, `version`, `author`, `type`, `entry`, `permissions`.
- **Valid Types**: `"js"`, `"wasm"`.
- **Valid Categories**: `"audio"`, `"ui"`, `"lyrics"`, `"library"`, `"utility"`, `"appearance"`.

Once your repository meets these criteria, the indexer will automatically detect it and add it to the global registry.

