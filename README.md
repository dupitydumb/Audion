<p align="center">
  <img width="850" height="230" alt="AudionBanner" src="https://github.com/user-attachments/assets/8649842c-118a-4b24-a987-6bb4be6a9036" />
</p>

<p align="center">
  <strong>A modern, local music player with a Spotify-inspired interface</strong>
</p>

<p align="center">
  <a href="https://github.com/dupitydumb/Audion/releases"><img src="https://img.shields.io/badge/version-1.2.4-blue.svg" alt="Version"></a>
  <img src="https://img.shields.io/badge/platform-Windows-brightgreen.svg" alt="Windows">
  <img src="https://img.shields.io/badge/platform-macOS-brightgreen.svg" alt="macOS">
  <img src="https://img.shields.io/badge/platform-Linux-brightgreen.svg" alt="Linux">
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

<div align="center">

### Desktop
<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
  <a href="https://github.com/user-attachments/assets/7aa5f266-6b36-47cc-930c-b56f3883acc0">
    <img src="https://github.com/user-attachments/assets/878874db-8615-4881-b4c7-531d1d89874f" width="400" alt="Fullscreen Mode" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/a67ec2d7-1859-4b86-bf20-0ba218e800e4">
    <img src="https://github.com/user-attachments/assets/a67ec2d7-1859-4b86-bf20-0ba218e800e4" width="400" alt="Plugin Marketplace" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/94164ad4-4783-474d-886f-4a407979d902">
    <img src="https://github.com/user-attachments/assets/94164ad4-4783-474d-886f-4a407979d902" width="400" alt="Main Page" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/65a86a0d-6d28-4bd6-9ce9-b68bfae54be7">
    <img src="https://github.com/user-attachments/assets/65a86a0d-6d28-4bd6-9ce9-b68bfae54be7" width="400" alt="Home Page" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/878874db-8615-4881-b4c7-531d1d89874f">
    <img src="https://github.com/user-attachments/assets/7aa5f266-6b36-47cc-930c-b56f3883acc0" width="400" alt="Theme Selection" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
</div>

### Mobile (Android)
<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
  <a href="https://github.com/user-attachments/assets/74f38713-b645-4abc-bad8-a70793de0e87">
    <img src="https://github.com/user-attachments/assets/74f38713-b645-4abc-bad8-a70793de0e87" width="240" alt="Android Library" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/f3bc93c4-1b46-4fff-8226-dcc9c8622922">
    <img src="https://github.com/user-attachments/assets/f3bc93c4-1b46-4fff-8226-dcc9c8622922" width="240" alt="Android Home" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
  <a href="https://github.com/user-attachments/assets/583c41ea-3205-49bb-bb94-f59d168f7bdc">
    <img src="https://github.com/user-attachments/assets/583c41ea-3205-49bb-bb94-f59d168f7bdc" width="240" alt="Android Fullscreen" style="border-radius: 8px; border: 1px solid #333;" />
  </a>
</div>

<p><em>Click any screenshot to view full size</em></p>
</div>
---

## ⚡ Quick Start

### Download
Get the latest builds from [Releases](https://github.com/dupitydumb/Audion/releases/latest).

- **Windows:** Audion_x64-setup.exe
- **macOS (dmg):** Audion.dmg
- **Linux (AppImage):** Audion-x86_64.AppImage

If you prefer, download the platform-specific asset from the Releases page for your OS.

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
- Keyboard shortcuts [ Shift + / ]

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
