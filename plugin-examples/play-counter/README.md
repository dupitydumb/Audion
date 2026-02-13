# Play Counter

**Track your listening habits.**

The Play Counter plugin automatically tracks how many times you've played each song in your library. It provides a discreet widget and overlay to show your listening stats in real-time.

## Features

- **Automatic Tracking**: Counts a "play" after you've listened to a track for at least 30 seconds.
- **Real-time Widget**: Shows the play count for the current song.
- **Library Statistics**: Displays total number of tracks tracked and total plays across your library.
- **Persistent Storage**: Saves your play counts locally, so they persist between sessions.
- **Minimized Mode**: Collapse the widget to save screen space while still tracking.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `play-counter`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

- **View Stats**: The Play Counter widget will appear in the bottom right of the screen (or above the player bar on mobile).
- **Toggle Visibility**: Click the **Play Counter** button in the player bar menu to show/hide the widget.
- **Minimize**: Click the `−` button on the widget to collapse it into a smaller pill.

## How it Works

- The plugin listens for `trackChange` events.
- It records the start time of each track.
- If a track is played for more than **30 seconds**, the counter for that specific track ID is incremented.
- Data is saved to your local Audion storage.

## Permissions

This plugin requires the following permissions:
- `player:read`: To detect track changes and play state.
- `storage:local`: To save and load play counts.
- `ui:inject`: To display the stats widget.