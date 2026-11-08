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

    // 2. Hardware CPUID hypervisor check (unprivileged, works inside sandboxes / Flatpak / containers)
    #[cfg(target_arch = "x86_64")]
    {
        let cpuid1 = unsafe { core::arch::x86_64::__cpuid(1) };
        // ECX bit 31 is the hypervisor present bit (set by VirtualBox, VMware, KVM, QEMU, Hyper-V)
        if (cpuid1.ecx & (1 << 31)) != 0 {
            return true;
        }
    }

    // 3. No physical GPU device nodes available (/dev/dri missing or empty)
    if !Path::new("/dev/dri").exists()
        || std::fs::read_dir("/dev/dri").map(|mut it| it.next().is_none()).unwrap_or(true)
    {
        return true;
    }

    // 4. DRM driver inspection — detect virtualized GPU drivers (vboxvideo, vmwgfx, virtio-gpu, qxl, bochs)
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let uevent_path = entry.path().join("device/uevent");
            if let Ok(uevent) = std::fs::read_to_string(uevent_path) {
                let lower = uevent.to_lowercase();
                if lower.contains("driver=vboxvideo")
                    || lower.contains("driver=vmwgfx")
                    || lower.contains("driver=virtio-gpu")
                    || lower.contains("driver=qxl")
                    || lower.contains("driver=bochs")
                {
                    return true;
                }
            }
        }
    }

    // 5. PCI device vendor check (0x80ee = VirtualBox, 0x15ad = VMware, 0x1af4 = Red Hat / QEMU virtio)
    if let Ok(entries) = std::fs::read_dir("/sys/bus/pci/devices") {
        for entry in entries.flatten() {
            let vendor_path = entry.path().join("vendor");
            if let Ok(vendor) = std::fs::read_to_string(vendor_path) {
                let vendor = vendor.trim().to_lowercase();
                if vendor == "0x80ee" || vendor == "0x15ad" || vendor == "0x1af4" {
                    return true;
                }
            }
        }
    }

    // 6. Block device / SCSI model check (VBOX HARDDISK, VMware Virtual S, QEMU, etc.)
    if let Ok(scsi) = std::fs::read_to_string("/proc/scsi/scsi") {
        let lower = scsi.to_lowercase();
        if lower.contains("vbox") || lower.contains("vmware") || lower.contains("qemu") {
            return true;
        }
    }
    if let Ok(entries) = std::fs::read_dir("/sys/block") {
        for entry in entries.flatten() {
            let model_path = entry.path().join("device/model");
            if let Ok(model) = std::fs::read_to_string(model_path) {
                let lower = model.to_lowercase();
                if lower.contains("vbox") || lower.contains("vmware") || lower.contains("qemu") {
                    return true;
                }
            }
        }
    }

    // 7. DMI table vendor / product check (fast kernel sysfs, no subprocess)
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

    // 8. /proc/cpuinfo hypervisor flag check
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        if cpuinfo.lines().any(|l| l.starts_with("flags") && l.contains("hypervisor")) {
            return true;
        }
    }

    // 9. systemd-detect-virt (fallback check)
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
///
/// Software rendering is only forced when:
/// 1. Safe mode or software rendering is explicitly requested via environment variables.
/// 2. Running inside a virtual machine without 3D acceleration.
/// 3. Physical GPU device nodes (/dev/dri) are missing or inaccessible (e.g. headless CI,
///    unprivileged containers without GPU passthrough).
///
/// Bare-metal AppImage and Flatpak environments with accessible /dev/dri retain full
/// hardware acceleration.
pub fn should_use_software_rendering() -> bool {
    // 1. Explicit user override
    if is_env_truthy("AUDION_SAFE_MODE")
        || is_env_truthy("AUDION_SOFTWARE_RENDERING")
        || is_env_truthy("LIBGL_ALWAYS_SOFTWARE")
    {
        return true;
    }

    // 2. Virtual machine detection
    if is_virtual_machine() {
        return true;
    }

    // 3. Headless or container environment without physical GPU device nodes
    if !Path::new("/dev/dri").exists()
        || std::fs::read_dir("/dev/dri")
            .map(|mut it| it.next().is_none())
            .unwrap_or(true)
    {
        return true;
    }

    false
}

/// Pre-initialization hook for Linux desktop.
///
/// MUST be called before GTK, WebKitGTK, or Mesa initializes (before builder.run()),
/// so that driver and compositing environment variables take effect in Mesa/WebKit.
pub fn setup_environment() {
    if is_container_or_sandbox() {
        if std::env::var_os("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_none() {
            std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
        }
    }

    if should_use_software_rendering() {
        tracing::info!("Virtual machine, headless, or software rendering environment detected — configuring software rasterization");
        if std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
            std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        }
        if std::env::var_os("GALLIUM_DRIVER").is_none() {
            std::env::set_var("GALLIUM_DRIVER", "llvmpipe");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

