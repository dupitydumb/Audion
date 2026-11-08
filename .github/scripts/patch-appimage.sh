#!/usr/bin/env bash
set -euo pipefail

# Ensure squashfs-root is always cleaned up, even if an error occurs earlier
trap 'rm -rf squashfs-root' EXIT

APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
APPIMAGE=$(find "$APPIMAGE_DIR" -name "*.AppImage" ! -name "*-patched*" | head -1)

if [ -z "$APPIMAGE" ]; then
  echo "::error::No AppImage found in $APPIMAGE_DIR"
  exit 1
fi

echo "Patching AppImage: $APPIMAGE"

chmod +x "$APPIMAGE"
# APPIMAGE_EXTRACT_AND_RUN=1 avoids libfuse2 requirement on Ubuntu 22.04+ runners
APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" --appimage-extract

# Back up original AppRun and replace with GPU-safe wrappers
if [ -L squashfs-root/AppRun ]; then
  rm squashfs-root/AppRun
else
  mv squashfs-root/AppRun squashfs-root/AppRun-original
fi

cp .github/scripts/appimage-apprun-real.sh squashfs-root/AppRun-real
cp .github/scripts/appimage-apprun.sh squashfs-root/AppRun
chmod +x squashfs-root/AppRun-real squashfs-root/AppRun

# WebKitGTK computes subprocess path as: dirname(binary)/../../lib/...
# (binary is usr/bin/audion, so two levels up = root, then lib/).
# The Tauri AppImage bundler does not create a root-level lib symlink,
# so WebKitNetworkProcess fails with ENOENT. Add the symlink.
ln -sf usr/lib squashfs-root/lib

# Ensure .DirIcon is a valid relative link to the bundled top-level icon
ICON_FILE=$(find squashfs-root -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.svg" \) | head -1)
if [ -z "$ICON_FILE" ]; then
  echo "::error::No top-level icon found in AppDir"
  exit 1
fi
rm -f squashfs-root/.DirIcon
ln -s "$(basename "$ICON_FILE")" squashfs-root/.DirIcon
test -e squashfs-root/.DirIcon || { echo "::error::.DirIcon still dangling"; exit 1; }

# Download and verify pinned appimagetool (v1.9.1)
APPIMAGETOOL="/tmp/appimagetool"
APPIMAGETOOL_VERSION="1.9.1"
APPIMAGETOOL_SHA256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"

if [ ! -f "$APPIMAGETOOL" ]; then
  echo "Downloading pinned appimagetool v${APPIMAGETOOL_VERSION}..."
  wget -q "https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage" \
    -O "$APPIMAGETOOL"
  echo "${APPIMAGETOOL_SHA256}  ${APPIMAGETOOL}" | sha256sum -c -
  chmod +x "$APPIMAGETOOL"
fi

# Download and verify pinned type2-runtime to prevent network downloads during repack
RUNTIME_FILE="/tmp/runtime-x86_64"
RUNTIME_VERSION="20251108"
RUNTIME_SHA256="2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d"

if [ ! -f "$RUNTIME_FILE" ]; then
  echo "Downloading pinned type2-runtime (${RUNTIME_VERSION})..."
  wget -q "https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_VERSION}/runtime-x86_64" \
    -O "$RUNTIME_FILE"
  echo "${RUNTIME_SHA256}  ${RUNTIME_FILE}" | sha256sum -c -
fi

# Repack AppImage with pinned runtime file
PATCHED_OUTPUT="$APPIMAGE_DIR/audion-patched.AppImage"
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$APPIMAGETOOL" \
  --no-appstream \
  --runtime-file "$RUNTIME_FILE" \
  squashfs-root "$PATCHED_OUTPUT"

if [ ! -f "$PATCHED_OUTPUT" ]; then
  echo "::error::appimagetool did not produce audion-patched.AppImage"
  exit 1
fi

echo "Successfully repacked AppImage: $(du -sh "$PATCHED_OUTPUT")"
