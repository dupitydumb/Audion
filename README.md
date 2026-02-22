<p align="center">
  <img width="850" height="230" alt="AudionBanner" src="https://github.com/user-attachments/assets/8649842c-118a-4b24-a987-6bb4be6a9036" />
</p>

<p align="center">
  <strong>A modern, local music player with a Spotify-inspired interface</strong>
</p>

<p align="center">
  <a href="https://github.com/dupitydumb/Audion/releases"><img src="https://img.shields.io/badge/version-1.2.2-blue.svg" alt="Version"></a>
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
  <img width="1343" height="795" alt="image" src="https://github.com/user-attachments/assets/f4d0f1d4-8147-4d81-b010-502da196b432"/>
  <br><em>Immersive full-screen player</em>
</p>

<p align="center">
  <img width="1345" height="793" alt="image" src="https://github.com/user-attachments/assets/00c79e80-48a2-4142-8530-27357195c3b3" />
  <br><em>Real-time synced lyrics</em>
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

## 🐧 Linux Troubleshooting

### "Could not create surfaceless EGL display" Error

If you encounter this error when running the AppImage:
```
could not create surfaceless egl display bad alloc aborting
```

**Solution 1: Use software rendering**
```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./Audion.AppImage
```

**Solution 2: Force software rendering with Mesa**
```bash
LIBGL_ALWAYS_SOFTWARE=1 ./Audion.AppImage
```

**Solution 3: Disable GPU acceleration**
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Audion.AppImage
```

**Solution 4: Combined flags (most compatible)**
```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Audion.AppImage
```

**Permanent fix:** Add the environment variable to your `.bashrc` or create a desktop entry with the flag.

### Missing Dependencies

Ensure you have the required WebKitGTK libraries installed:

**Ubuntu/Debian:**
```bash
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

**Fedora:**
```bash
sudo dnf install webkit2gtk4.1 gtk3 libappindicator-gtk3
```

**Arch Linux:**
```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3
```

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
