#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"

# ---------------------------------------------------------------------------
# GPU / WebKit environment — runtime auto-detection
# Covers: VirtualBox/VMware (no /dev/dri), Bazzite/NixOS (broken EGL),
#         Mint/Ubuntu 24 (broken gvfs symbols), Wayland+XWayland sessions.
# ---------------------------------------------------------------------------

# Host WebKit helpers (not bundled in AppImage — rely on system install).
# WebKit resolves subprocess path as "././lib/..." (CWD-relative).
# We cd to APPDIR just before exec so the relative path resolves correctly.
export APPDIR="$HERE"

# Disable dmabuf — most common blank-screen cause on Mesa/NVIDIA with no DRI3.
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# Disable WebKit sandbox — required inside AppImage (seccomp conflicts with AppImage runtime).
export WEBKIT_FORCE_SANDBOX=0
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

# Disable DRI3 — prevents EGL_BAD_PARAMETER abort on AMD/Intel with broken DRI3.
export LIBGL_DRI3_DISABLE=1

# Software Mesa — fallback for any remaining GL call when /dev/dri absent or broken.
# User can override by setting these vars before launch.
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-0}"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-}"

# GVfs — prevent "undefined symbol: g_task_set_static_name" crash on Mint 22 / Ubuntu 24.
export GIO_USE_VFS=local
if [ -d "$HERE/usr/lib/gio/modules" ]; then
  export GIO_MODULE_DIR="$HERE/usr/lib/gio/modules"
else
  unset GIO_MODULE_DIR
fi

# Drop host GTK modules (e.g. xapp-gtk3-module) absent inside AppImage.
unset GTK_MODULES

# Prefer X11 via XWayland on Wayland sessions (WebKitGTK 4.x is more stable on X11).
if [ -n "$WAYLAND_DISPLAY" ] && [ -z "$FORCE_WAYLAND" ]; then
  if [ -n "$DISPLAY" ]; then
    export GDK_BACKEND=x11
    export QT_QPA_PLATFORM=xcb
  fi
  # else: no XWayland — let GTK negotiate Wayland directly.
fi

# ALSA — point to host config when not already set.
if [ -z "$ALSA_CONFIG_PATH" ] && [ -f /usr/share/alsa/alsa.conf ]; then
  export ALSA_CONFIG_PATH=/usr/share/alsa/alsa.conf
fi

# Tauri 2 lowercases the binary name on Linux (productName → audion).
if [ -f "$HERE/usr/bin/audion" ]; then
  BIN="$HERE/usr/bin/audion"
else
  BIN=$(find "$HERE/usr/bin" -type f -executable | head -1)
fi

# WebKit computes its subprocess path as a CWD-relative "././lib/..." string.
# Change to APPDIR so that relative path resolves correctly regardless of
# where the user launched the AppImage from.
cd "$HERE"

exec "$BIN" "$@"
