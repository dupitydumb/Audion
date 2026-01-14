<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Audion Logo" width="128" height="128">
</p>

<h1 align="center">Audion</h1>

<p align="center">
  <strong>A modern, local music player with a Spotify-inspired interface</strong>
</p>

<p align="center">
  <a href="https://github.com/dupitydumb/Audion/releases"><img src="https://img.shields.io/badge/version-1.1.1-blue.svg" alt="Version"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue.svg" alt="Platform">
  <a href="https://discord.gg/27XRVQsBd9"><img src="https://img.shields.io/discord/1234567890?color=5865F2&label=Discord&logo=discord&logoColor=white" alt="Discord"></a>
</p>

---

## 🎵 What is Audion?

Audion is a privacy-focused music player that brings the Spotify experience to your local music library. No internet required, no tracking—just your music, beautifully organized.

**Key highlights:**
- Synced lyrics with karaoke-style word highlighting
- Extensible plugin system
- Gorgeous, customizable interface
- Fully offline

---

## 📸 Screenshots

<details>
<summary>Click to view screenshots</summary>

<p align="center">
  <img src="promotional/mainpage.png" alt="Main Player" width="100%">
  <br><em>Clean, modern interface</em>
</p>

<p align="center">
  <img src="promotional/mainwithlyrics.png" alt="Lyrics Panel" width="100%">
  <br><em>Real-time synced lyrics</em>
</p>

<p align="center">
  <img src="promotional/fullscreen.png" alt="Fullscreen Mode" width="100%">
  <br><em>Immersive full-screen player</em>
</p>

</details>

---

## ⚡ Quick Start

### Download
Get the latest version from [Releases](https://github.com/dupitydumb/Audion/releases/latest)

**Windows:** `Audion_x64-setup.exe`  
**macOS & Linux:** Coming soon

### First Run
1. Launch Audion
2. Click "Add Music Folder" and select your music directory
3. Wait for the scan to complete
4. Enjoy!

---

## ✨ Features

### Music Management
- Auto-scan local music folders with metadata extraction
- Smart playlists and queue management
- Support for all major audio formats (FLAC, MP3, AAC, etc.)

### Lyrics
- Real-time synced lyrics from LRCLIB and Musixmatch
- Word-by-word karaoke highlighting
- Cached locally for offline use

### Customization
- Dark/light themes with custom accent colors
- Full-screen mode
- Mini player
- Keyboard shortcuts

### Plugins
Extend Audion with JavaScript/WASM plugins. [Learn more →](./PLUGINS.md)

---

## 🛠️ Build from Source

**Requirements:** Node.js 18+, Rust (latest), Tauri CLI
```bash
git clone https://github.com/dupitydumb/Audion.git
cd audion
npm install
npm run tauri dev    # Development
npm run tauri build  # Production build
```

**Tech stack:** Tauri 2.0, SvelteKit, Rust, SQLite

---

## 🤝 Contributing

Contributions are welcome! Check out:
- [Issues](https://github.com/dupitydumb/Audion/issues) for bugs and feature requests
- [PLUGINS.md](./PLUGINS.md) to create plugins
- [Discord](https://discord.gg/27XRVQsBd9) to discuss ideas

---

<p align="center">
  Built with <a href="https://tauri.app">Tauri</a> and <a href="https://svelte.dev">Svelte</a>
</p>
