use tauri::AppHandle;

#[cfg(target_os = "windows")]
mod windows_impl {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use serde::Serialize;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::mem;
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject, HGDIOBJ};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        ITaskbarList3, TaskbarList, THBN_CLICKED, THUMBBUTTON, THUMBBUTTONFLAGS, THUMBBUTTONMASK,
        THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
        TBPF_NOPROGRESS, TBPF_NORMAL, TBPF_PAUSED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, CreateIconIndirect, DefWindowProcW, GetWindowLongPtrW,
        ICONINFO, SetWindowLongPtrW, GWLP_WNDPROC, WM_COMMAND, WNDPROC,
    };

    const THUMBAR_BUTTON_PREVIOUS: u32 = 2001;
    const THUMBAR_BUTTON_PLAY_PAUSE: u32 = 2002;
    const THUMBAR_BUTTON_NEXT: u32 = 2003;

    // disabled but kept for future use
    const TASKBAR_PROGRESS_ENABLED: bool = false;

    #[derive(Clone)]
    pub(crate) struct JumpListItem {
        pub track_id: i64,
        pub title: String,
        pub artist: Option<String>,
        pub path: String,
    }

    const ICON_W: usize = 16;
    const ICON_H: usize = 16;

    #[derive(Clone, Copy)]
    enum TransportIcon {
        Previous,
        Play,
        Pause,
        Next,
    }

    #[derive(Clone, Copy)]
    struct IconSet {
        previous: usize,
        play: usize,
        pause: usize,
        next: usize,
    }

    static ICON_SET: OnceLock<Result<IconSet, String>> = OnceLock::new();

    #[derive(Clone)]
    struct HookData {
        original_wndproc: isize,
        app_handle: AppHandle,
    }

    static WINDOW_HOOKS: OnceLock<Mutex<HashMap<usize, HookData>>> = OnceLock::new();

    fn hooks() -> &'static Mutex<HashMap<usize, HookData>> {
        WINDOW_HOOKS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    #[derive(Clone, Serialize)]
    struct ThumbarActionPayload {
        action: String,
    }

    fn fill_tip(buffer: &mut [u16], value: &str) {
        let mut utf16: Vec<u16> = value.encode_utf16().collect();
        if utf16.len() >= buffer.len() {
            utf16.truncate(buffer.len().saturating_sub(1));
        }
        for (i, c) in utf16.into_iter().enumerate() {
            buffer[i] = c;
        }
        if !buffer.is_empty() {
            buffer[buffer.len() - 1] = 0;
        }
    }

    fn draw_icon(kind: TransportIcon) -> Vec<u32> {
        let mut px = vec![0u32; ICON_W * ICON_H];
        let white = 0xFFFFFFFFu32;

        let mut put = |x: i32, y: i32| {
            if x >= 0 && y >= 0 && (x as usize) < ICON_W && (y as usize) < ICON_H {
                px[y as usize * ICON_W + x as usize] = white;
            }
        };

        let fill_rect = |put: &mut dyn FnMut(i32, i32), x0: i32, y0: i32, x1: i32, y1: i32| {
            for y in y0..=y1 {
                for x in x0..=x1 {
                    put(x, y);
                }
            }
        };

        let fill_right_triangle =
            |put: &mut dyn FnMut(i32, i32), x_left: i32, x_right: i32, y_top: i32, y_bottom: i32| {
                for y in y_top..=y_bottom {
                    let dy_top = y - y_top;
                    let dy_bottom = y_bottom - y;
                    let span = dy_top.min(dy_bottom);
                    let max_x = (x_left + span).min(x_right);
                    for x in x_left..=max_x {
                        put(x, y);
                    }
                }
            };

        let fill_left_triangle =
            |put: &mut dyn FnMut(i32, i32), x_left: i32, x_right: i32, y_top: i32, y_bottom: i32| {
                for y in y_top..=y_bottom {
                    let dy_top = y - y_top;
                    let dy_bottom = y_bottom - y;
                    let span = dy_top.min(dy_bottom);
                    let min_x = (x_right - span).max(x_left);
                    for x in min_x..=x_right {
                        put(x, y);
                    }
                }
            };

        match kind {
            TransportIcon::Play => {
                fill_right_triangle(&mut put, 4, 11, 2, 13);
            }
            TransportIcon::Pause => {
                fill_rect(&mut put, 4, 3, 6, 12);
                fill_rect(&mut put, 9, 3, 11, 12);
            }
            TransportIcon::Previous => {
                fill_rect(&mut put, 3, 3, 4, 12);
                fill_left_triangle(&mut put, 5, 11, 2, 13);
            }
            TransportIcon::Next => {
                fill_right_triangle(&mut put, 4, 10, 2, 13);
                fill_rect(&mut put, 11, 3, 12, 12);
            }
        }

        px
    }

    fn create_hicon(kind: TransportIcon) -> Result<windows::Win32::UI::WindowsAndMessaging::HICON, String> {
        let pixels = draw_icon(kind);
        let mask_bits = vec![0u8; (ICON_W * ICON_H) / 8];

        let hbm_color = unsafe {
            CreateBitmap(
                ICON_W as i32,
                ICON_H as i32,
                1,
                32,
                Some(pixels.as_ptr() as *const c_void),
            )
        };
        if hbm_color.is_invalid() {
            return Err("Failed to create color bitmap for thumbar icon".into());
        }

        let hbm_mask = unsafe {
            CreateBitmap(
                ICON_W as i32,
                ICON_H as i32,
                1,
                1,
                Some(mask_bits.as_ptr() as *const c_void),
            )
        };
        if hbm_mask.is_invalid() {
            unsafe {
                let _ = DeleteObject(HGDIOBJ(hbm_color.0));
            }
            return Err("Failed to create mask bitmap for thumbar icon".into());
        }

        let icon_info = ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };

        let icon = unsafe { CreateIconIndirect(&icon_info) }
            .map_err(|e| format!("CreateIconIndirect failed: {e}"))?;

        unsafe {
            let _ = DeleteObject(HGDIOBJ(hbm_mask.0));
            let _ = DeleteObject(HGDIOBJ(hbm_color.0));
        }

        if icon.is_invalid() {
            return Err("Failed to create HICON for thumbar icon".into());
        }

        Ok(icon)
    }

    fn icon_set() -> Result<IconSet, String> {
        match ICON_SET.get_or_init(|| {
            let previous = create_hicon(TransportIcon::Previous)?;
            let play = create_hicon(TransportIcon::Play)?;
            let pause = create_hicon(TransportIcon::Pause)?;
            let next = create_hicon(TransportIcon::Next)?;
            Ok(IconSet {
                previous: previous.0 as usize,
                play: play.0 as usize,
                pause: pause.0 as usize,
                next: next.0 as usize,
            })
        }) {
            Ok(s) => Ok(*s),
            Err(e) => Err(e.clone()),
        }
    }

    fn icon_for(kind: TransportIcon) -> Result<windows::Win32::UI::WindowsAndMessaging::HICON, String> {
        let set = icon_set()?;
        let raw = match kind {
            TransportIcon::Previous => set.previous,
            TransportIcon::Play => set.play,
            TransportIcon::Pause => set.pause,
            TransportIcon::Next => set.next,
        };

        Ok(windows::Win32::UI::WindowsAndMessaging::HICON(raw as *mut c_void))
    }

    fn make_button(id: u32, tooltip: &str, kind: TransportIcon) -> Result<THUMBBUTTON, String> {
        let icon = icon_for(kind)?;
        let mut tip = [0u16; 260];
        fill_tip(&mut tip, tooltip);

        Ok(THUMBBUTTON {
            dwMask: THUMBBUTTONMASK(THB_FLAGS.0 | THB_ICON.0 | THB_TOOLTIP.0),
            iId: id,
            iBitmap: 0,
            hIcon: icon,
            szTip: tip,
            dwFlags: THUMBBUTTONFLAGS(THBF_ENABLED.0),
        })
    }

    fn taskbar_list() -> Result<ITaskbarList3, String> {
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let taskbar: ITaskbarList3 =
            unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("Taskbar COM init failed: {e}"))?;
        unsafe { taskbar.HrInit() }.map_err(|e| format!("Taskbar HrInit failed: {e}"))?;
        Ok(taskbar)
    }

    fn add_buttons(hwnd: HWND) -> Result<(), String> {
        let taskbar = taskbar_list()?;
        let mut buttons = [
            make_button(THUMBAR_BUTTON_PREVIOUS, "Previous", TransportIcon::Previous)?,
            make_button(THUMBAR_BUTTON_PLAY_PAUSE, "Play", TransportIcon::Play)?,
            make_button(THUMBAR_BUTTON_NEXT, "Next", TransportIcon::Next)?,
        ];

        unsafe { taskbar.ThumbBarAddButtons(hwnd, &mut buttons) }
            .map_err(|e| format!("ThumbBarAddButtons failed: {e}"))
    }

    fn update_play_pause_button(hwnd: HWND, is_playing: bool) -> Result<(), String> {
        let taskbar = taskbar_list()?;
        let (tooltip, icon_kind) = if is_playing {
            ("Pause", TransportIcon::Pause)
        } else {
            ("Play", TransportIcon::Play)
        };

        let mut buttons = [make_button(THUMBAR_BUTTON_PLAY_PAUSE, tooltip, icon_kind)?];

        unsafe { taskbar.ThumbBarUpdateButtons(hwnd, &mut buttons) }
            .map_err(|e| format!("ThumbBarUpdateButtons failed: {e}"))
    }

    // taskbar icon progress overlay
    // value is 0.0-1.0
    // is_paused switches the green fill to the amber paused color
    fn set_progress(hwnd: HWND, value: f64, is_paused: bool) -> Result<(), String> {
        if !TASKBAR_PROGRESS_ENABLED {
            return Ok(());
        }
        let taskbar = taskbar_list()?;

        let state = if is_paused { TBPF_PAUSED } else { TBPF_NORMAL };
        unsafe { taskbar.SetProgressState(hwnd, state) }
            .map_err(|e| format!("SetProgressState failed: {e}"))?;

        let completed = (value.clamp(0.0, 1.0) * 100.0).round() as u64;
        unsafe { taskbar.SetProgressValue(hwnd, completed, 100) }
            .map_err(|e| format!("SetProgressValue failed: {e}"))
    }

    fn clear_progress(hwnd: HWND) -> Result<(), String> {
        if !TASKBAR_PROGRESS_ENABLED {
            return Ok(());
        }
        let taskbar = taskbar_list()?;
        unsafe { taskbar.SetProgressState(hwnd, TBPF_NOPROGRESS) }
            .map_err(|e| format!("SetProgressState failed: {e}"))
    }

    fn window_hwnd(window: &WebviewWindow) -> Result<*mut c_void, String> {
        let handle = window
            .window_handle()
            .map_err(|e| format!("Failed to get raw window handle: {e}"))?;

        match handle.as_raw() {
            RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as *mut c_void),
            _ => Err("Window is not a Win32 handle".into()),
        }
    }

    fn ensure_window_hook(app_handle: &AppHandle, hwnd_raw: *mut c_void) -> Result<(), String> {
        let hwnd = HWND(hwnd_raw);
        let hwnd_key = hwnd_raw as usize;

        {
            let map = hooks().lock().map_err(|_| "Hook map lock poisoned".to_string())?;
            if map.contains_key(&hwnd_key) {
                return Ok(());
            }
        }

        let current_proc = unsafe { GetWindowLongPtrW(hwnd, GWLP_WNDPROC) };
        if current_proc == 0 {
            return Err("Failed to fetch current window procedure".into());
        }

        let previous = unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, thumbar_wndproc as _) };
        if previous == 0 {
            return Err("Failed to install thumbar window procedure".into());
        }

        let mut map = hooks().lock().map_err(|_| "Hook map lock poisoned".to_string())?;
        map.insert(
            hwnd_key,
            HookData {
                original_wndproc: current_proc,
                app_handle: app_handle.clone(),
            },
        );
        Ok(())
    }

    unsafe extern "system" fn thumbar_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_COMMAND {
            let command_id = (wparam.0 & 0xFFFF) as u32;
            let notify_code = ((wparam.0 >> 16) & 0xFFFF) as u32;

            if notify_code == THBN_CLICKED {
                let action = match command_id {
                    THUMBAR_BUTTON_PREVIOUS => Some("previous"),
                    THUMBAR_BUTTON_PLAY_PAUSE => Some("toggle_play_pause"),
                    THUMBAR_BUTTON_NEXT => Some("next"),
                    _ => None,
                };

                if let Some(action_name) = action {
                    if let Ok(map) = hooks().lock() {
                        if let Some(hook) = map.get(&(hwnd.0 as usize)) {
                            let payload = ThumbarActionPayload {
                                action: action_name.to_string(),
                            };
                            let _ = hook.app_handle.emit("windows://thumbar-action", payload);
                        }
                    }
                    return LRESULT(0);
                }
            }
        }

        let original = hooks()
            .lock()
            .ok()
            .and_then(|map| map.get(&(hwnd.0 as usize)).map(|h| h.original_wndproc));

        if let Some(prev_proc) = original {
            let wndproc: WNDPROC = mem::transmute(prev_proc);
            return CallWindowProcW(wndproc, hwnd, msg, wparam, lparam);
        }

        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub(crate) fn init_thumbar(app: &AppHandle) -> Result<bool, String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(false);
        };

        let hwnd_raw = window_hwnd(&window)?;
        ensure_window_hook(app, hwnd_raw)?;
        add_buttons(HWND(hwnd_raw))?;

        Ok(true)
    }

    pub(crate) fn update_thumbar_state(app: &AppHandle, is_playing: bool) -> Result<(), String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        let hwnd_raw = window_hwnd(&window)?;
        update_play_pause_button(HWND(hwnd_raw), is_playing)
    }

    pub(crate) fn set_taskbar_progress(app: &AppHandle, value: f64, is_paused: bool) -> Result<(), String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        let hwnd_raw = window_hwnd(&window)?;
        set_progress(HWND(hwnd_raw), value, is_paused)
    }

    pub(crate) fn clear_taskbar_progress(app: &AppHandle) -> Result<(), String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        let hwnd_raw = window_hwnd(&window)?;
        clear_progress(HWND(hwnd_raw))
    }

    /// windows returns E_ACCESSDENIED (0x80070005) for jump list writes when the user
    /// has disabled "Show recently opened items in Jump Lists" under
    /// Settings > Personalization > Start
    ///  we tag it distinctly and skip re-logging it as a real error
    const E_ACCESSDENIED: i32 = 0x80070005u32 as i32;
    const JUMP_LIST_DISABLED_MARKER: &str = "JUMPLIST_DISABLED_BY_SETTINGS";

    fn jump_list_err(context: &str, e: windows::core::Error) -> String {
        if e.code().0 == E_ACCESSDENIED {
            JUMP_LIST_DISABLED_MARKER.to_string()
        } else {
            format!("{context} failed: {e}")
        }
    }

    pub(crate) fn update_jump_list(_app: &AppHandle, items: Vec<JumpListItem>) -> Result<(), String> {
        use windows::Win32::UI::Shell::{
            ICustomDestinationList, DestinationList,
            IShellLinkW, ShellLink,
            EnumerableObjectCollection,
            Common::{IObjectCollection, IObjectArray},
            PropertiesSystem::IPropertyStore,
        };
        use windows::Win32::Storage::EnhancedStorage::{PKEY_Title, PKEY_AppUserModel_ID};
        use windows::Win32::System::Com::{
            StructuredStorage::PROPVARIANT,
            CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::core::{HSTRING, PCWSTR, Interface};

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {e}"))?;
        let exe_hstring = HSTRING::from(exe_path.as_os_str());

        unsafe {
            // required or else :
            // AppendCategory fails with E_ACCESSDENIED (0x80070005)
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let cdl: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| jump_list_err("ICustomDestinationList", e))?;

            let mut max_slots: u32 = 0;
            // beginList returns the removed items array (ignored) and tells us max slots
            let _: IObjectArray = cdl
                .BeginList(&mut max_slots)
                .map_err(|e| jump_list_err("BeginList", e))?;

            let collection: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("IObjectCollection failed: {e}"))?;

            let count = items.len().min(max_slots as usize).min(5);
            for item in items.iter().take(count) {
                let link: IShellLinkW =
                    CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| format!("IShellLink failed: {e}"))?;

                link.SetPath(PCWSTR(exe_hstring.as_ptr()))
                    .map_err(|e| format!("SetPath failed: {e}"))?;

                let arg = format!("audion://play/{}", item.track_id);
                let arg_hstring = HSTRING::from(arg.as_str());
                link.SetArguments(PCWSTR(arg_hstring.as_ptr()))
                    .map_err(|e| format!("SetArguments failed: {e}"))?;

                let display_name = match &item.artist {
                    Some(a) if !a.is_empty() => format!("{} \u{b7} {}", item.title, a),
                    _ => item.title.clone(),
                };

                let prop_store: IPropertyStore = link.cast()
                    .map_err(|e| format!("IPropertyStore cast failed: {e}"))?;

                let pv = PROPVARIANT::from(display_name.as_str());

                prop_store.SetValue(&PKEY_Title, &pv)
                    .map_err(|e| format!("SetValue PKEY_Title failed: {e}"))?;

                // per-link AppUserModelID must match the process-level's
                let pv_appid = PROPVARIANT::from("com.audion.app");
                prop_store.SetValue(&PKEY_AppUserModel_ID, &pv_appid)
                    .map_err(|e| format!("SetValue PKEY_AppUserModel_ID failed: {e}"))?;

                prop_store.Commit()
                    .map_err(|e| format!("IPropertyStore::Commit failed: {e}"))?;
                // pv, pv_appid are Drop-safe, no manual clear needed

                collection.AddObject(&link)
                    .map_err(|e| format!("AddObject failed: {e}"))?;
            }

            let category = HSTRING::from("NEXT UP");
            // IObjectCollection implements From<IObjectCollection> for IObjectArray
            let obj_array = IObjectArray::from(collection);
            cdl.AppendCategory(PCWSTR(category.as_ptr()), &obj_array)
                .map_err(|e| jump_list_err("AppendCategory", e))?;

            cdl.CommitList()
                .map_err(|e| jump_list_err("CommitList", e))?;
        }

        Ok(())
    }

    pub(crate) fn clear_jump_list() -> Result<(), String> {
        use windows::Win32::UI::Shell::{ICustomDestinationList, DestinationList};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::core::PCWSTR;

        unsafe {
            // see update_jump_list for why this is required
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let cdl: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| jump_list_err("ICustomDestinationList", e))?;
            cdl.DeleteList(PCWSTR::null())
                .map_err(|e| jump_list_err("DeleteList", e))?;
        }
        Ok(())
    }

}

#[tauri::command]
pub fn windows_init_thumbar(app: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::init_thumbar(&app)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub fn windows_update_thumbar_state(app: AppHandle, is_playing: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::update_thumbar_state(&app, is_playing)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = is_playing;
        Ok(())
    }
}

// value is 0.0-1.0 fraction of the track played
// is_paused => overlay to the amber paused color. called from player.ts's position
// ticker (throttled). instant on play/pause/seek/track-change
#[tauri::command]
pub fn windows_set_taskbar_progress(app: AppHandle, value: f64, is_paused: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::set_taskbar_progress(&app, value, is_paused)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, value, is_paused);
        Ok(())
    }
}

// called on stop / queue end so the icon doesn't keep showing a stale bar
#[tauri::command]
pub fn windows_clear_taskbar_progress(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::clear_taskbar_progress(&app)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}
#[derive(serde::Deserialize)]
pub struct JumpListTrack {
    pub track_id: i64,
    pub title: String,
    pub artist: Option<String>,
    pub path: String,
}

#[tauri::command]
pub fn windows_update_jump_list(
    app: AppHandle,
    tracks: Vec<JumpListTrack>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let items: Vec<windows_impl::JumpListItem> = tracks
            .into_iter()
            .map(|t| windows_impl::JumpListItem {
                track_id: t.track_id,
                title: t.title,
                artist: t.artist,
                path: t.path,
            })
            .collect();
        windows_impl::update_jump_list(&app, items)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tracks);
        Ok(())
    }
}

#[tauri::command]
pub fn windows_clear_jump_list() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::clear_jump_list()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}