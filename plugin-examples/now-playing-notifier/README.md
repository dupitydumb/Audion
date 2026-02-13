# Now Playing Notifier

**Get notified when your music changes.**

This plugin sends system notifications whenever the playing track changes in Audion. It's perfect for keeping track of what's playing without having to look at the Audion window.

## Features

- **System Notifications**: Uses your OS's native notification system (Windows, macOS, Linux).
- **Customizable Content**: Choose exactly what information to display in the notification title and body.
- **Format Options**: Support for Track Title, Artist, Album, Duration, Bitrate, File Path, and more.
- **Custom Text**: Add your own static text to notifications.
- **Duration Control**: Set how long the notification stays on screen (1s - 15s).
- **Preview Mode**: See exactly what your notification will look like before saving.

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `now-playing-notifier`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

1. **Enable the Plugin**: Make sure it's enabled in Settings.
2. **Play Music**: Change tracks to see the notification appear.
3. **Configure**: Click the **Notification Settings** button in the player bar (bell/notification icon) to customize the behavior.

## Configuration

Open the settings panel to customize:
- **Enable/Disable**: Toggle notifications on or off globally.
- **Duration**: Slider to control how long the notification remains visible.
- **Layout**: Independently configure the **Title** and **Body** of the notification.
  - Choose separate Left and Right values for both title and body.
  - Mix and match metadata like *Artist*, *Album*, *Bitrate*, etc.

## Permissions

This plugin requires the following permissions:
- `player:read`: To get track information.
- `system:notify`: To assign and send system notifications.
- `ui:inject`: To add the settings button to the player interface.