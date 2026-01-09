<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Audion Logo" width="128" height="128">
</p>

<h1 align="center">Audion</h1>

<p align="center">
  <strong>A modern, local music player with a Spotify-inspired experience</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#plugins">Plugins</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
</p>

---

## ✨ Features

### 🎵 Core Music Experience
- **Local Library Management** — Scan and organize your local music collection with automatic metadata extraction
- **Album Art Display** — Beautiful album artwork fetched from your music files
- **Smart Playlists** — Create, edit, and manage custom playlists
- **Queue Management** — Full queue control with drag-and-drop reordering

### 🎤 Lyrics Integration
- **Synced Lyrics** — Real-time synchronized lyrics from LRCLIB and Musixmatch
- **Word-by-Word Sync** — Premium karaoke-style word highlighting
- **Lyrics Panel** — Dedicated panel with smooth auto-scrolling
- **Local Caching** — LRC files saved locally for offline access

### 🎨 Customization
- **Theme Engine** — Fully customizable color schemes with live preview
- **Dark/Light Mode** — System-aware theme switching
- **Accent Colors** — Choose your preferred accent color palette
- **Mini Player** — Compact mode for minimal desktop footprint

### 🔌 Plugin System
- **Extensible Architecture** — JavaScript and WebAssembly plugin support
- **Permission System** — Granular permissions for plugin security
- **Event API** — React to player events (track changes, play/pause, etc.)
- **UI Injection** — Plugins can add custom UI elements

### 🖥️ Desktop Experience
- **Full-Screen Mode** — Immersive full-screen player with lyrics
- **Keyboard Shortcuts** — Quick controls for power users
- **Context Menus** — Right-click actions for tracks, albums, and artists
- **Cross-Platform** — Native performance on Windows, macOS, and Linux

---

## 📦 Installation

### Pre-built Binaries
Download the latest release for your platform from the [Releases](https://github.com/dupitydumb/audion/releases) page.

| Platform | Download |
|----------|----------|
| Windows  | `Audion_1.0.0_x64-setup.exe` |
| macOS    | `Audion_1.0.0_x64.dmg` |
| Linux    | `Audion_1.0.0_amd64.AppImage` |

### Build from Source

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

#### Steps

```bash
# Clone the repository
git clone https://github.com/your-username/audion.git
cd audion

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---

## 🛠️ Development

### Tech Stack

| Layer     | Technology |
|-----------|------------|
| Framework | [Tauri 2.0](https://tauri.app/) |
| Frontend  | [SvelteKit](https://kit.svelte.dev/) + TypeScript |
| Backend   | Rust |
| Database  | SQLite (via rusqlite) |
| Styling   | CSS Variables + Custom Theme Engine |

### Project Structure

```
audion/
├── src/                    # Frontend (SvelteKit)
│   ├── lib/
│   │   ├── components/     # UI components
│   │   ├── stores/         # Svelte stores (state management)
│   │   ├── plugins/        # Plugin runtime & API
│   │   ├── lyrics/         # Lyrics fetching (LRCLIB, Musixmatch)
│   │   └── api/            # Tauri API wrappers
│   └── routes/             # SvelteKit routes
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   ├── db/             # SQLite database operations
│   │   └── scanner/        # Music file scanner
│   └── tauri.conf.json     # Tauri configuration
├── plugin-examples/        # Example plugins
└── static/                 # Static assets
```

### Available Scripts

```bash
npm run dev          # Start SvelteKit dev server
npm run build        # Build frontend for production
npm run tauri dev    # Run full Tauri app in development
npm run tauri build  # Build production binaries
npm run check        # TypeScript type checking
```

---

## 🔌 Plugins

Audion supports a flexible plugin system that allows extending functionality.

### Plugin Permissions

| Permission | Description |
|------------|-------------|
| `player:read` | Access current track, playback state |
| `player:control` | Play, pause, skip, seek |
| `storage:local` | Persist plugin data locally |
| `ui:inject` | Add custom UI elements |
| `system:notify` | Show system notifications |

### Example Plugin

```javascript
(function() {
    const MyPlugin = {
        init(api) {
            this.api = api;
            
            // Listen for track changes
            api.on('trackChange', (track) => {
                console.log('Now playing:', track.title);
            });
        },
        
        start() {
            // Plugin enabled
        },
        
        stop() {
            // Plugin disabled
        }
    };
    
    window.MyPlugin = MyPlugin;
    window.AudionPlugin = MyPlugin;
})();
```

See the [plugin-examples](./plugin-examples) folder for more examples.

---


## 🗂️ Supported Formats

Audion supports all audio formats that your system can play, including:

- **Lossless**: FLAC, WAV, ALAC, AIFF
- **Lossy**: MP3, AAC, OGG, Opus, M4A
- **Metadata**: ID3v2, Vorbis Comments, APE Tags

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ using <a href="https://tauri.app">Tauri</a> and <a href="https://svelte.dev">Svelte</a>
</p>
