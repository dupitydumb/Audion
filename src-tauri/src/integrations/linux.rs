// Linux-specific runtime configuration and virtualization detection
//
// Only compiled on Linux desktop.

use std::path::Path;

fn is_env_truthy(var: &str) -> bool {
    std::env::var(var)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes"))
        .unwrap_or(false)
}

/// Check whether the application is running inside a virtual machine or emulated environment.
pub fn is_virtual_machine() -> bool {
    // 1. Explicit user override
    if is_env_truthy("AUDION_SAFE_MODE")
        || is_env_truthy("AUDION_SOFTWARE_RENDERING")
        || is_env_truthy("LIBGL_ALWAYS_SOFTWARE")
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
#[allow(dead_code)]
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

