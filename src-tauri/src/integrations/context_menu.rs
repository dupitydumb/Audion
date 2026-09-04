// adds "Play with Audion" to the right click context menu for supported audio files, under:
//   HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.<ext>\shell\Audion.Play
//
// clicking the entry launches Audion.exe with the file path as argv[1]
// exact same mechanism file association double clicks already use
// see is_associated_audio_file / handle_open_file in lib.rs

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::path::PathBuf;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    fn exe_path() -> Result<PathBuf, String> {
        std::env::current_exe().map_err(|e| format!("Failed to get exe path: {e}"))
    }

    fn set_string_value(key: HKEY, name: Option<&str>, value: &str) -> Result<(), String> {
        let value_wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        let name_h = name.map(HSTRING::from);
        let name_pcwstr = name_h
            .as_ref()
            .map(|h| PCWSTR(h.as_ptr()))
            .unwrap_or(PCWSTR::null());
        // value_wide is a valid, null-terminated UTF-16 buffer for
        // the duration of this call; the byte-length reinterpretation below
        // only changes the type the slice is viewed as, not its contents
        let bytes = unsafe {
            std::slice::from_raw_parts(value_wide.as_ptr() as *const u8, value_wide.len() * 2)
        };
        unsafe { RegSetValueExW(key, name_pcwstr, None, REG_SZ, Some(bytes)) }
            .ok()
            .map_err(|e| format!("RegSetValueExW failed: {e:?}"))
    }

    fn create_key(parent: HKEY, subkey: &str) -> Result<HKEY, String> {
        let subkey_h = HSTRING::from(subkey);
        let mut hkey = HKEY::default();
        let status = unsafe {
            RegCreateKeyExW(
                parent,
                &subkey_h,
                None,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut hkey,
                None,
            )
        };
        if status.is_err() {
            return Err(format!("RegCreateKeyExW({subkey}) failed: {status:?}"));
        }
        Ok(hkey)
    }

    pub fn register(extensions: &[&str]) -> Result<(), String> {
        let exe = exe_path()?;
        let exe_str = exe.to_string_lossy();
        // "%1" quoted so paths with spaces resolve correctly
        let command = format!("\"{exe_str}\" \"%1\"");

        for ext in extensions {
            let base =
                format!("Software\\Classes\\SystemFileAssociations\\.{ext}\\shell\\Audion.Play");

            let verb_key = create_key(HKEY_CURRENT_USER, &base)?;
            set_string_value(verb_key, None, "Play with Audion")?;
            set_string_value(verb_key, Some("Icon"), &format!("\"{exe_str}\""))?;
            unsafe {
                let _ = RegCloseKey(verb_key);
            }

            let command_key = create_key(HKEY_CURRENT_USER, &format!("{base}\\command"))?;
            set_string_value(command_key, None, &command)?;
            unsafe {
                let _ = RegCloseKey(command_key);
            }
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn register_context_menu(extensions: &[&str]) {
    if let Err(e) = windows_impl::register(extensions) {
        tracing::warn!("[ContextMenu] Failed to register: {e}");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn register_context_menu(_extensions: &[&str]) {}