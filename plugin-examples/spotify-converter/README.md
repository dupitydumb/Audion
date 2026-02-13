# Spotify Converter

**Import your Spotify playlists to Audion.**

This powerful utility allows you to seamlessly transfer your playlists from Spotify to Audion. It scans a Spotify playlist URL, finds the matching high-quality tracks on Tidal/Audion's source, and recreates the playlist in your local library.

## Features

- **Simple Import**: Just paste a Spotify playlist URL and click Convert.
- **High Accuracy**: Uses specialized matching logic (ISRC, Title/Artist/Duration) to find the correct tracks.
- **Parallel Processing**: fast conversion using concurrent workers.
- **Duplicate Detection**: Skips tracks that are already in your library to avoid duplicates.
- **Automatic Playlist Creation**: Creates a new playlist in Audion with the original Spotify title.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `spotify-converter`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

1. **Open Converter**: Click the **Import Spotify Playlist** button in the player bar menu.
2. **Get URL**: Go to Spotify, right-click a playlist, and select **Share > Copy link to playlist**.
3. **Paste & Convert**: Paste the URL into the plugin's input field and click **Convert**.
4. **Wait**: Watch the progress bar as tracks are found and added.
5. **Enjoy**: Once finished, your new playlist will appear in the Audion sidebar.

## How it Matches Tracks

1. **Metadata**: It fetches the track list from the Spotify API.
2. **Search**: It searches the Tidal catalog (via Audion's provider) for the same Title and Artist.
3. **Verify**: It compares the duration of the found track with the Spotify original. usage of a +/- 10s tolerance ensures it's the correct version (e.g., Radio Edit vs Extended Mix).
4. **Add**: Valid matches are added to your Audion library and the new playlist.

## Permissions

This plugin requires the following permissions:
- `network:fetch`: To access Spotify and Tidal APIs.
- `library:write`: To create playlists and add tracks.
- `library:read`: To check for existing tracks.
- `ui:inject`: To show the converter UI.