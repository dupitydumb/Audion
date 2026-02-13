# Keyboard Shortcuts

**Control playback with global hotkeys.**

This plugin adds convenient keyboard shortcuts to control Audion's music playback, making it easier to skip tracks, pause/play, and adjust volume without needing to focus the window or click buttons.

## Features

- **Global Control**: Works even when you are browsing other tabs (if the browser supports media keys) or focused on different parts of the app.
- **Standard Shortcuts**: Implements familiar media key behaviors.
- **Lightweight**: Minimal impact on performance.

## Default Shortcuts

| Action | Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` |
| **Next Track** | `ArrowRight` |
| **Previous Track** | `ArrowLeft` |
| **Volume Up** | `ArrowUp` |
| **Volume Down** | `ArrowDown` |
| **Mute / Unmute** | `m` |
| **Toggle Repeat** | `r` |
| **Toggle Shuffle** | `s` |

## Installation

1. Open Audion.
2. Go to **Settings > Plugins**.
3. Click **Open Plugin Folder**.
4. Download or clone this plugin into the `plugins` directory.
   - Folder name should be `keyboard-shortcuts`.
5. Restart Audion or click **Reload Plugins**.
6. Enable the plugin in the settings menu.

## Usage

Simply install and enable the plugin. The shortcuts will be active immediately.
- **Note**: Some shortcuts might conflict if you are typing in a text input field (like search). The plugin is smart enough to disable shortcuts while you are typing.

## Permissions

This plugin requires the following permissions:
- `player:control`: To execute playback commands (play, pause, next, etc.).