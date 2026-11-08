#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"

# ---------------------------------------------------------------------------
# Library search path — prioritize bundled dependencies with host fallback
# ---------------------------------------------------------------------------
export LD_LIBRARY_PATH="${HERE}/usr/lib:${HERE}/usr/lib/x86_64-linux-gnu:${HERE}/lib:${HERE}/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# ---------------------------------------------------------------------------
# GPU / WebKit environment — runtime auto-detection
# Covers: VirtualBox/VMware (no /dev/dri), Bazzite/NixOS (broken EGL),
#         Mint/Ubuntu 24 (broken gvfs symbols), Wayland+XWayland sessions.
# ---------------------------------------------------------------------------

# WebKit helper processes (WebKitNetworkProcess, WebKitWebProcess) must match
# the host libwebkit2gtk-4.1.so.0 version to prevent fatal IPC protocol desynchronization.
# Dynamically detect host WebKit helper process directory:
HOST_WEBKIT_EXEC=""
for candidate in \
  /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
  /usr/libexec/webkit2gtk-4.1 \
  /usr/lib/webkit2gtk-4.1 \
  /usr/lib64/webkit2gtk-4.1 \
  /usr/local/libexec/webkit2gtk-4.1; do
  if [ -x "$candidate/WebKitNetworkProcess" ]; then
    HOST_WEBKIT_EXEC="$candidate"
    break
  fi
done

if [ -n "$HOST_WEBKIT_EXEC" ]; then
  # Host helper exists and matches host WebKit library version
  export WEBKIT_EXEC_PATH="$HOST_WEBKIT_EXEC"
elif [ -d "$HERE/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1" ]; then
  # Fallback to bundled helper only if no host helper is available
  export WEBKIT_EXEC_PATH="$HERE/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
  export APPDIR="$HERE"
fi

# Disable dmabuf — most common blank-screen cause on Mesa/NVIDIA with no DRI3.
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# Disable WebKit sandbox — required inside AppImage & containers (seccomp / user ns restrictions).
# Note: WEBKIT_FORCE_SANDBOX=0 is deprecated in WebKitGTK 2.40+; use WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

# Auto-detect missing GPU / headless / virtualized environments (e.g. CI, Xvfb, VMs, Docker):
# When /dev/dri is missing or software Mesa is requested, disable compositing mode
# and force llvmpipe. Accelerated compositing without DRI3 causes black/blank windows.
if [ ! -d /dev/dri ] || [ -z "$(ls -A /dev/dri 2>/dev/null)" ] || [ "${LIBGL_ALWAYS_SOFTWARE:-0}" = "1" ]; then
  export LIBGL_ALWAYS_SOFTWARE=1
  export GALLIUM_DRIVER=llvmpipe
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
else
  # On real hardware with /dev/dri, leave unset unless user explicitly set them
  if [ -z "${LIBGL_ALWAYS_SOFTWARE+x}" ]; then
    unset LIBGL_ALWAYS_SOFTWARE
  fi
  if [ -z "${GALLIUM_DRIVER+x}" ]; then
    unset GALLIUM_DRIVER
  fi
fi

# DRI3 — opt-in disable. Set LIBGL_DRI3_DISABLE=1 at runtime if you hit
# EGL_BAD_PARAMETER crashes (AMD RX 6600 + Bazzite / Mesa 23).
# Do not export =0 as some Mesa versions treat any non-empty value as enabled.
if [ -z "${LIBGL_DRI3_DISABLE+x}" ]; then
  unset LIBGL_DRI3_DISABLE
fi

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

# Change directory to $HERE so any remaining relative paths resolve cleanly.
cd "$HERE"

exec "$BIN" "${ARGS[@]}"
