#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"

# ---------------------------------------------------------------------------
# GPU / WebKit environment — runtime auto-detection
# Covers: VirtualBox/VMware (no /dev/dri), Bazzite/NixOS (broken EGL),
#         Mint/Ubuntu 24 (broken gvfs symbols), Wayland+XWayland sessions.
# ---------------------------------------------------------------------------

# DO NOT set APPDIR unconditionally — Tauri does not bundle WebKit subprocess
# helpers (WebKitNetworkProcess, WebKitWebProcess) inside the AppImage.
# Setting APPDIR would make WebKitGTK look for them under $HERE/usr/lib/...,
# where they do not exist, causing subprocess launch failures.
# Only set APPDIR if the helpers are actually present in the bundle.
# WebKit helpers reside under usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/ on Debian/Ubuntu,
# under usr/lib/webkit2gtk-4.1/ on Arch/Fedora, or via root lib/ symlink.
if [ -f "$HERE/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess" ] || \
   [ -f "$HERE/usr/lib/webkit2gtk-4.1/WebKitNetworkProcess" ] || \
   [ -f "$HERE/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess" ] || \
   [ -n "$(find "$HERE/usr/lib" "$HERE/lib" -name "WebKitNetworkProcess" 2>/dev/null | head -1)" ]; then
  export APPDIR="$HERE"
fi

# Disable dmabuf — most common blank-screen cause on Mesa/NVIDIA with no DRI3.
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# Disable WebKit sandbox — required inside AppImage (seccomp conflicts with AppImage runtime).
export WEBKIT_FORCE_SANDBOX=0

# DRI3 — opt-in disable. Set LIBGL_DRI3_DISABLE=1 at runtime if you hit
# EGL_BAD_PARAMETER crashes (AMD RX 6600 + Bazzite / Mesa 23).
# Do not export =0 as some Mesa versions treat any non-empty value as enabled.
if [ -z "${LIBGL_DRI3_DISABLE+x}" ]; then
  unset LIBGL_DRI3_DISABLE
fi

# Software Mesa — opt-in fallback for VMs or broken GPU drivers.
# User can set LIBGL_ALWAYS_SOFTWARE=1 before launch to force llvmpipe.
# Do not export =0 as some Mesa loaders treat any non-empty value as true.
if [ -z "${LIBGL_ALWAYS_SOFTWARE+x}" ]; then
  unset LIBGL_ALWAYS_SOFTWARE
fi
# GALLIUM_DRIVER: leave unset unless the user explicitly set it.
# Exporting an empty string breaks Mesa's implicit llvmpipe selection on some versions.
if [ -z "${GALLIUM_DRIVER+x}" ]; then unset GALLIUM_DRIVER; fi

# GVfs / GIO — prevent "undefined symbol: g_task_set_static_name" crash on Mint 22 / Ubuntu 24 / Debian testing.
# Avoid loading host GIO modules (like libgvfsdbus.so) compiled against newer GLib symbol versions.
export GIO_USE_VFS=local
if [ -d "$HERE/usr/lib/gio/modules" ]; then
  export GIO_MODULE_DIR="$HERE/usr/lib/gio/modules"
else
  export GIO_MODULE_DIR=/dev/null
fi

# GTK IM module — fallback to built-in 'simple' input method to avoid host ibus symbol mismatch.
if [ -z "$GTK_IM_MODULE" ] || [ "$GTK_IM_MODULE" = "ibus" ]; then
  export GTK_IM_MODULE=simple
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

# Convert relative file path arguments to absolute paths before changing directory to $HERE.
# This ensures command-line file arguments (e.g. "audion ./song.mp3") resolve properly
# after we change CWD to $HERE.
ARGS=()
for arg in "$@"; do
  if [ -e "$arg" ]; then
    ARGS+=("$(readlink -f "$arg")")
  else
    ARGS+=("$arg")
  fi
done

# WebKit computes its subprocess path as a CWD-relative "././lib/..." string.
# Change to APPDIR so that relative path resolves correctly regardless of
# where the user launched the AppImage from.
cd "$HERE"

exec "$BIN" "${ARGS[@]}"
