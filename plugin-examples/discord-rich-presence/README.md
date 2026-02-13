# Discord Rich Presence

**Show what you're listening to on Discord with style.**

This plugin integrates Audion with Discord Rich Presence, allowing you to display your current playback status, track details, and album art directly in your Discord profile.

## Features

- **Real-time Status**: Updates your Discord status instantly when you play, pause, or change tracks.
- **Album Art**: Automatically fetches and displays high-quality album art from Tidal (optional).
- **Time Elapsed/Remaining**: Shows a progress bar or time elapsed in your status.
- **Customizable Details**: Choose what to display on the first and second lines (Track Title, Artist, Album, or Custom Text).
- **Custom Buttons**: Add buttons to your status (e.g., "Listen on Tidal", "View Album").
- **Privacy Mode**: Option to disable presence updates without uninstalling the plugin.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `discord-rich-presence`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

Once enabled, the plugin will automatically connect to your local Discord client.
- **Play Music**: Start playing any track in Audion.
- **Check Discord**: Look at your own profile to see the rich presence in action.

## Configuration

You can customize the plugin via the settings panel:
- **Click the "Discord Rich Presence" button** in the player bar (game controller icon) or access it via the Plugins settings.
- **Display Options**:
  - Toggle "Show Progress Bar".
  - Toggle "Use Tidal for Cover Art".
- **Update Frequency**: Adjust how often the status updates (default: 10s).
- **Display Format**: Select what information is shown on the top and bottom lines of the rich presence.

## Permissions

This plugin requires the following permissions:
- `player:read`: To get current track info.
- `ui:inject`: To add the settings button to the UI.
- `storage:local`: To save your configuration preferences.