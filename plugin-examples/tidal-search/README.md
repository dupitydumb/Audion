# Tidal Search

**The ultimate Tidal integration for Audion.**

Tidal Search is a comprehensive plugin that brings the full Tidal experience to your desktop. Search, browse, and stream directly from Tidal's massive catalog of high-fidelity music.

## Features

- **Unified Search**: Seamlessly search for Tracks and Artists.
- **Stream Quality**: Supports **HI-RES** (Master), **LOSSLESS** (FLAC), and **HIGH** (AAC) streaming qualities.
- **Library Management**: Add tracks to your local Audion library with one click.
- **Artist Profiles**: Detailed artist pages with popularity rankings and full discography.
- **Smart Resolving**: Automatically finds the best stream url for playback.
- **Toast Notifications**: Non-intrusive feedback for actions like "Added to Library".
- **Download Progress**: Visual indicator when caching/downloading tracks.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `tidal-search`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

1. **Access**: Click the **Tidal** button in the player bar.
2. **Search**: Enter a song or artist name.
3. **Modes**: Toggle between **Track** and **Artist** search modes using the buttons.
4. **Quality**: Select your preferred streaming quality from the dropdown (High, Lossless, Hi-Res).
5. **Play**: Click any item to play.
6. **Save**: Use the `+` or Heart button to save to your library.

## API Integration

This plugin uses a custom API/proxy to communicate with Tidal's services. It handles manifest decoding (DASH/HLS) automatically to ensure specific audio qualities are delivered to the player.

## Permissions

This plugin requires the following permissions:
- `network:fetch`: To communicate with Tidal APIs.
- `ui:inject`: To display the search interface.
- `player:control`: To manage playback.
- `library:write`: To save content to the library.
- `library:read`: To verify saved status.
- `settings:write`: To save quality preferences.