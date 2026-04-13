# Flatpak packaging (starter)

This directory contains a first-pass Flatpak setup for Audion.

## Files

- `com.audion.app.yml` - Flatpak manifest
- `com.audion.app.desktop` - Desktop launcher metadata
- `com.audion.app.metainfo.xml` - AppStream metadata

## Local build

```bash
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub \
  org.freedesktop.Platform//24.08 \
  org.freedesktop.Sdk//24.08 \
  org.freedesktop.Sdk.Extension.node20//24.08 \
  org.freedesktop.Sdk.Extension.rust-stable//24.08

flatpak-builder --force-clean --repo=repo build-dir packaging/flatpak/com.audion.app.yml
flatpak build-bundle repo audion_dev_linux.flatpak com.audion.app
```

## Notes

- This is an implementation starter meant to unblock CI artifact generation.
- The manifest currently allows network during build to fetch npm/cargo dependencies.
- For Flathub submission, convert this to vendored dependencies and remove network access during build.
