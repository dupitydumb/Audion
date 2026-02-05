<div class="markdown"><p align="center">  <img src="https://github.com/user-attachments/assets/8649842c-118a-4b24-a987-6bb4be6a9036" alt="AudionBanner" height="230" width="850"></p><p align="center">  <strong>A modern, privacy-focused music player designed for your local library.</strong></p><p align="center">  <a href="https://github.com/dupitydumb/Audion/releases">    <img alt="Version" src="https://img.shields.io/badge/version-1.1.9-blue.svg">  </a>  <img alt="License" src="https://img.shields.io/badge/license-GNU-green.svg">  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-blue.svg">  <img alt="Downloads" src="https://img.shields.io/github/downloads/dupitydumb/Audion/total.svg">  <a href="https://discord.gg/27XRVQsBd9">    <img alt="Discord" src="https://img.shields.io/discord/1459798744806592568?color=5865F2&amp;label=Discord&amp;logo=discord&amp;logoColor=white">  </a></p></div>

* * * * *

Overview
--------

Audion is an open-source music player that brings the premium streaming experience to your local audio files. It is designed for users who value privacy and ownership, offering a feature-rich interface without the need for an internet connection, subscriptions, or user tracking.

Key Highlights:

-   Synchronized Lyrics: Supports real-time lyrics with karaoke-style word highlighting.
-   Extensible Architecture: Customize functionality with a powerful plugin system.
-   Modern Interface: A polished, responsive design built for readability and ease of use.
-   Offline First: Fully functional without an internet connection.

* * * * *

Screenshots
-----------

Expand to view interface

<p align="center"> <img src="promotional/mainpage.png" alt="Main Player" width="100%"> <br><em>The main player interface</em> </p> <p align="center"> <img src="promotional/mainwithlyrics.png" alt="Lyrics Panel" width="100%"> <br><em>Real-time synchronized lyrics view</em> </p> <p align="center"> <img src="promotional/fullscreen.png" alt="Fullscreen Mode" width="100%"> <br><em>Immersive full-screen mode</em> </p>

* * * * *

Installation
------------

### Download

Get the latest stable release from the [Releases page](https://github.com/dupitydumb/Audion/releases/latest).

-   Windows: `Audion_x64-setup.exe`
-   macOS & Linux: Support coming soon

### Getting Started

1.  Launch the application.
2.  Click "Add Music Folder" and select your audio directory.
3.  Allow the application to scan and import your library metadata.
4.  Start listening.

* * * * *

Features
--------

### Library Management

-   Automated scanning and metadata extraction for local folders.
-   Smart playlist generation and advanced queue management.
-   Broad format support including FLAC, MP3, AAC, and more.

### Lyrics Integration

-   Fetches real-time synced lyrics from LRCLIB and Musixmatch.
-   Word-by-word highlighting for karaoke-style playback.
-   Local caching ensures lyrics are available offline.

### Customization

-   Switch between dark and light themes with custom accent colors.
-   Includes full-screen mode and a mini-player for multitasking.
-   Fully configurable keyboard shortcuts.

### Plugin System

Extend the core functionality using JavaScript and WASM plugins. For details on creating your own plugins, see the [Plugin Documentation](https://zread.ai/dupitydumb/Audion).

* * * * *

Development
-----------

Prerequisites: Node.js 18+, Rust (latest stable), Tauri CLI

```bash

git clone https://github.com/dupitydumb/Audion.git

cd audion

npm install

npm run tauri dev # Start development server

npm run tauri build # Create production build
```
Tech Stack: Tauri 2.0, SvelteKit, Rust, SQLite

* * * * *

Contributing
------------

We encourage contributions from the community. Please feel free to:

-   Report bugs or request features via [Issues](https://github.com/dupitydumb/Audion/issues).
-   Submit pull requests for bug fixes or new features.
-   Join our [Discord Server](https://discord.gg/27XRVQsBd9) to discuss development.
-   Read [PLUGINS.md](https://chat.z.ai/c/PLUGINS.md) to start developing plugins.

* * * * *

<p align="center"> Built with <a href="https://tauri.app">Tauri</a> and <a href="https://svelte.dev">Svelte</a> </p>
