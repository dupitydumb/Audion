# Qobuz Search

**Stream high-quality music directly from Qobuz.**

This plugin integrates the Qobuz music catalog into Audion, allowing you to search for tracks, albums, and artists, and stream them directly within the app. It supports high-resolution audio and library management.

## Features

- **Direct Search**: Search the entire Qobuz catalog for Tracks, Albums, and Artists.
- **High-Res Streaming**: Supports streaming in Lossless and Hi-Res formats (flac).
- **Library Integration**: Save tracks directly to your Audion library with a single click.
- **Album Browsing**: View full album details, tracklists, and release dates.
- **Artist Discography**: Explore an artist's full catalog of albums.
- **"Save All"**: Add entire albums to your library at once.
- **Visual Polish**: Beautiful grid layouts, skeleton loading states, and responsive design.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `qubuz-search`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

1. **Open Search**: Click the **Qobuz** button in the player bar (search icon).
2. **Search**: Type your query in the search bar.
3. **Filter**: Switch between **Tracks** and **Albums** tabs.
4. **Play**: Click any track to start streaming immediately.
5. **Save**: Click the Heart icon next to any track to add it to your local library.
6. **Browse**: Click on an Artist or Album card to view more details.

## Configuration

This plugin uses a custom API proxy (`dabmusic.xyz`) to interface with Qobuz. No personal Qobuz account login is required for standard streaming, as it uses the proxy's resolution capabilities.

## Permissions

This plugin requires the following permissions:
- `network:fetch`: To search and stream from the API.
- `ui:inject`: To show the search panel.
- `player:control`: To play tracks.
- `library:write`: To save tracks to your library.
- `library:read`: To check if tracks are already saved.