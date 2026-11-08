// Linux-specific runtime configuration and virtualization detection
//
// Only compiled on Linux desktop.

use std::path::Path;

/// Check whether the application is running inside a virtual machine or emulated environment.
pub fn is_virtual_machine() -> bool {
    // 1. Explicit user override
    if std::env::var_os("AUDION_SAFE_MODE").is_some()
        || std::env::var_os("AUDION_SOFTWARE_RENDERING").is_some()
        || std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_some()
    {
        return true;
    }

    // 2. DMI table vendor / product check (fast kernel sysfs, no subprocess)
    for path in &[
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/board_vendor",
        "/sys/class/dmi/id/bios_vendor",
    ] {
        if let Ok(content) = std::fs::read_to_string(path) {
            let lower = content.to_lowercase();
            if lower.contains("virtualbox")
                || lower.contains("vmware")
                || lower.contains("qemu")
                || lower.contains("kvm")
                || lower.contains("bochs")
                || lower.contains("hyper-v")
                || lower.contains("parallels")
            {
                return true;
            }
        }
    }

    // 3. /proc/cpuinfo hypervisor flag check
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        if cpuinfo.lines().any(|l| l.starts_with("flags") && l.contains("hypervisor")) {
            return true;
        }
    }

    // 4. systemd-detect-virt (fallback check)
    if let Ok(output) = std::process::Command::new("systemd-detect-virt").output() {
        if output.status.success() {
            let virt = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !virt.is_empty() && virt != "none" {
                return true;
            }
        }
    }

    false
}

/// Check whether the application is running inside a container / sandboxed package
/// (Flatpak, AppImage, Docker, Podman, or WSL).
pub fn is_container_or_sandbox() -> bool {
    std::env::var_os("AUDION_DISABLE_SANDBOX").is_some()
        || std::env::var_os("AUDION_SAFE_MODE").is_some()
        || std::env::var_os("FLATPAK_ID").is_some()
        || Path::new("/.flatpak-info").exists()
        || std::env::var_os("APPIMAGE").is_some()
        || Path::new("/.dockerenv").exists()
        || Path::new("/run/.containerenv").exists()
        || std::env::var_os("WSL_DISTRO_NAME").is_some()
}

/// Determines whether WebKit should force software rendering (Never).
pub fn should_use_software_rendering() -> bool {
    is_virtual_machine()
}

/// Configure Linux environment variables before Tauri / GTK / WebKit initialization.
/// In Rust 2024, setting or removing environment variables is an unsafe operation.
pub fn init_linux_environment() {
    unsafe {
        // Unset GTK_MODULES so WebKit child processes don't try to load host-only
        // GTK modules (e.g. xapp-gtk3-module on Linux Mint) that are absent in the context.
        std::env::remove_var("GTK_MODULES");

        // Clean up legacy WEBKIT_FORCE_SANDBOX if set
        std::env::remove_var("WEBKIT_FORCE_SANDBOX");

        // WEBKIT_DISABLE_DMABUF_RENDERER: Widespread Tauri fix for blank windows, Wayland,
        // and NVIDIA/Intel driver issues in WebKitGTK. Keep this active by default.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // WebKitGTK sandbox: only disable if in a container, Flatpak, AppImage, or VM
        // where unprivileged user namespaces / seccomp cause launch crashes.
        if is_container_or_sandbox() || is_virtual_machine() {
            if std::env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
                std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
            }
        }

        // Software rendering: only force on VMs or if safe mode was requested.
        // Machines with physical GPUs retain full hardware-accelerated rendering.
        if should_use_software_rendering() {
            if std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
                std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
            }
            if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
                std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            }
        }

        // Normalize problematic locale variables to base LANG to prevent
        // "Locale not supported by C library" warnings in GTK/WebKit subprocesses.
        if let Ok(lang) = std::env::var("LANG") {
            for var in &[
                "LC_NUMERIC", "LC_MONETARY", "LC_PAPER", "LC_NAME",
                "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT",
                "LC_IDENTIFICATION",
            ] {
                if let Ok(val) = std::env::var(var) {
                    if val != lang {
                        std::env::set_var(var, &lang);
                    }
                }
            }
        }
    }
}

