<p align="center">
  <img width="850" height="230" alt="AudionBanner" src="https://github.com/user-attachments/assets/8649842c-118a-4b24-a987-6bb4be6a9036" />
</p>

<h1 align="center">Audion</h1>

<p align="center">
  <strong>A local-first music player for your own library</strong>
</p>

<p align="center">
  <a href="https://github.com/dupitydumb/Audion/releases/latest"><img src="https://img.shields.io/github/v/release/dupitydumb/Audion?style=for-the-badge&labelColor=0d1117" alt="Version"></a>
  <a href="https://github.com/dupitydumb/Audion/releases"><img src="https://img.shields.io/github/downloads/dupitydumb/Audion/total?style=for-the-badge&logo=github&labelColor=0d1117" alt="Downloads"></a>
  <a href="https://github.com/dupitydumb/Audion/stargazers"><img src="https://img.shields.io/github/stars/dupitydumb/Audion?style=for-the-badge&logo=github&labelColor=0d1117" alt="Stars"></a>
  <a href="https://github.com/dupitydumb/Audion/blob/master/LICENSE"><img src="https://img.shields.io/github/license/dupitydumb/Audion?style=for-the-badge&labelColor=0d1117" alt="License"></a>
  <a href="https://aur.archlinux.org/packages/audion-bin"><img src="https://img.shields.io/aur/version/audion-bin?style=for-the-badge&logo=arch-linux&labelColor=0d1117" alt="AUR"></a>
  <a href="https://discord.gg/27XRVQsBd9"><img src="https://img.shields.io/discord/1234567890?style=for-the-badge&color=5865F2&labelColor=0d1117&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-brightgreen.svg" alt="Windows">
  <img src="https://img.shields.io/badge/platform-macOS-brightgreen.svg" alt="macOS">
  <img src="https://img.shields.io/badge/platform-Linux-brightgreen.svg" alt="Linux">
  <img src="https://img.shields.io/badge/platform-Android-brightgreen.svg" alt="Android">
</p>

<p align="center">
  <a href="#-download"><strong>Download</strong></a> ·
  <a href="#-features"><strong>Features</strong></a> ·
  <a href="#-screenshots"><strong>Screenshots</strong></a> ·
  <a href="#-self-hosted-server-docker"><strong>Self-Hosted Server</strong></a> ·
  <a href="#-build-from-source"><strong>Build from Source</strong></a> ·
  <a href="#-contributing"><strong>Contributing</strong></a> ·
  <a href="#-support"><strong>Support</strong></a>
</p>

<p align="center">
  <a href="https://fmhy.net/audio#audio-players" target="_blank" rel="noopener noreferrer"><img src="https://cdn.jsdelivr.net/gh/JMcrafter26/badges@main/src/assets/available/fmhy/cozy.svg" alt="Featured on FMHY" height="55"/></a>
</p>

---

## 🎵 What is Audion?

Audion is a desktop and mobile player for the music you already own. Index your folders once, then get synced lyrics, smart queues, custom themes, plugins, and streaming to any device — all without an account, tracking, or a permanent internet connection.

**In short:** your files, beautiful interface, nothing phoning home.

---

## ✨ Features

<table>
  <tr>
    <td width="50%" valign="top">

#### Playback & Output
- **Rock-solid playback** for FLAC, MP3, AAC, ALAC, Opus (native decoder) and more.
- **Exclusive DAC output** on Windows (WASAPI) and Linux (ALSA) for bit-perfect audio, bypassing the OS mixer.
- **Exclusive-mode & audiophile telemetry** — codec, bit depth, and sample rate in Stats for Nerds.
- **Queue management** with shuffle, repeat, next-up reordering, and queue persistence.
- **Cross-provider streaming handoff** — play from your library or a configured provider without changing apps.
- **Android Auto** — browse, control, and queue from the car display, including cold start.

    </td>
    <td width="50%" valign="top">

#### Library & Organization
- **Automatic library scanning** with metadata extraction and incremental rescans.
- **Smart playlists** and custom playlist management.
- **Duplicate detection & merging**, with background audio-hash migration.
- **Folder & format aware** organisation that scales to large libraries.
- **Tracklist virtualization** for fast browsing on desktop and mobile.

    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">

#### Lyrics
- **Synced lyrics** from LRCLIB and Musixmatch.
- **Karaoke-style word highlighting** in full screen and the lyric card.
- **Cached offline** — lyrics you've loaded stay available without a connection.
- **Export and share** lyric cards from desktop and mobile.

    </td>
    <td width="50%" valign="top">

#### Customization
- **Light, dark, or follow the system** — themes switch live with your OS appearance.
- **Custom accent colors** and per-element color overrides.
- **Skin Studio** with built-in and custom local skins.
- **Artwork-driven theming** with a player bar matched to album art.
- **Island mini-player** with a Dynamic Island-inspired floating or notch layout.
- **Keyboard shortcuts** and full-screen mode.

    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">

#### Plugins & Providers
- **JavaScript/WASM plugin system** with a built-in marketplace. [Learn more →](./PLUGINS.md)
- **Human-readable plugin catalog** with categories (Streaming, Metadata, Lyrics, Library, Integration, Appearance, Utility) and capability badges.
- **Provider management** in Settings with priority ordering and per-provider toggles.
- **Stream, metadata, and lyrics providers** that bridge into the player.

    </td>
    <td width="50%" valign="top">

#### Everywhere
- **Windows, macOS, Linux (AppImage, Flatpak, AUR), and Android**.
- **Per-ABI Android APKs** — `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` — plus a universal build.
- **Self-hosted streaming** from your own Docker server.
- **Scrobbling** to Last.fm and ListenBrainz, with an offline queue.
- **Localized UI** in English, Russian, French, and Spanish.

    </td>
  </tr>
</table>

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

## ⚡ Download

Get the latest builds from [Releases](https://github.com/dupitydumb/Audion/releases/latest).

| Platform | Asset |
| --- | --- |
| Windows | `Audion_x64-setup.exe` |
| macOS | `Audion.dmg` |
| Linux (AppImage) | `Audion-x86_64.AppImage` |
| Linux (Flatpak) | `audion_<version>_linux.flatpak` |
| Arch Linux (AUR, community maintained) | `yay -S audion-bin` |
| Android | `Audion.apk` (per-ABI builds and universal APK also published) |

### First Run

1. Launch Audion
2. Click **Add Music Folder** and select your music directory
3. Wait for the scan to complete
4. Press play

### Arch Linux / Arch-based Distros

```bash
# Using yay
yay -S audion-bin

# Using paru
paru -S audion-bin
```

### Linux Troubleshooting & Flags

Audion uses GPU hardware acceleration on Linux by default. If you encounter driver crashes, blank windows, or run inside a VM:

```bash
AUDION_SAFE_MODE=1 audion            # force software rendering
AUDION_SOFTWARE_RENDERING=1 audion   # same, explicit flag
AUDION_DISABLE_SANDBOX=1 audion      # for restricted container environments
```

Virtual machines (VirtualBox, VMware, QEMU) and Flatpak/AppImage sandbox restrictions are detected automatically.

### Android Notes

Install builds only from the official Releases page, and enable "Install unknown apps" for whichever app you download the APK with. Individual per-ABI APKs are smaller; use the `universal` APK if you are unsure of your device architecture.

---

## 🐳 Self-Hosted Server (Docker)

Audion supports a self-hosted streaming server (`audion-server-docker`) written in Rust with a responsive Svelte frontend, so you can host your library on a home server or VPS and stream to Audion clients from anywhere.

### Running Audion Server

A preconfigured `docker-compose.yml` is available in the `audion-server-docker` directory:

1. **Verify configuration** in `audion-server-docker/docker-compose.yml`:
   ```yaml
   services:
     audion-server:
       build:
         context: .
         dockerfile: Dockerfile
       ports:
         - "8080:8080"
       volumes:
         - ./data:/data
       environment:
         - AUDION_ADMIN_USER=admin
         - AUDION_ADMIN_PASSWORD=securepasswordhere # Change this!
         - AUDION_JWT_SECRET=your-secret-key-here
         - AUDION_DATA_DIR=/data
   ```

2. **Start the server**:
   ```bash
   cd audion-server-docker
   docker compose up --build -d
   ```

3. **Access the web interface** at `http://localhost` to manage files, playlists, and users.

### Connecting the Client

1. Open Audion settings.
2. Under **Server Connection**, select **Custom Server**.
3. Enter your server URL (e.g. `http://your-server-ip:8080`) and credentials.
4. Stream your library, sync it, and control it remotely.

---

## 🛠️ Build from Source

**Requirements:** Node.js 18+, Rust (latest), Tauri CLI

```bash
git clone https://github.com/dupitydumb/Audion.git
cd Audion
npm install
npm run tauri dev    # development
npm run tauri build  # production build
```

**Tech stack:** Tauri 2.0, SvelteKit, Rust, SQLite

---

## ❓ FAQ

**Is Audion free?** Yes — free and open source under GPLv3. Donations are voluntary.

**Does it need an internet connection?** No. Playback, lyrics caching, and library management work fully offline. Network access is only needed for optional features such as online lyric sources, scrobbling, provider streaming, and updates.

**Where is my music stored?** Wherever it already lives. Audion indexes your folders in place and never moves or re-encodes your files.

**Does it phone home?** No telemetry or tracking. Cloud sync and scrobbling are opt-in.

**How do I request a feature or report a bug?** Open an [issue](https://github.com/dupitydumb/Audion/issues) or join the [Discord](https://discord.gg/27XRVQsBd9).

---

## 🤝 Contributing

Contributions are welcome — translations, bug reports, plugins, and code.

- [Issues](https://github.com/dupitydumb/Audion/issues) — bugs and feature requests
- [PLUGINS.md](./PLUGINS.md) — build plugins
- [developerguide.md](./developerguide.md) — architecture and development setup
- [Discord](https://discord.gg/27XRVQsBd9) — discuss ideas

---

## 💙 Support

Audion is free and stays free. If it has earned a spot in your rotation:

<p>
  <a href="https://ko-fi.com/N4N5UMNR1"><img src="https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi"></a>
  <a href="https://www.patreon.com/AudionPlayer"><img src="https://img.shields.io/badge/Patreon-Support-F96854?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon"></a>
</p>

Support pays for hosting, development time, and code-signing certificates — nothing else.

---

## 📄 License

Licensed under the **GNU General Public License v3.0 or later** (GPL-3.0-or-later). See [LICENSE](./LICENSE).

Audion is an independent project: it hosts no media and is not affiliated with any streaming service it may integrate with through plugins.

---

<p align="center">
  Built with <a href="https://tauri.app">Tauri</a> and <a href="https://svelte.dev">Svelte</a>
</p>
