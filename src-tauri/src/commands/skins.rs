// src-tauri/src/commands/skins.rs
// Native backend commands for skin discovery, folder management, and file operations

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalSkinInfo {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub version: u32,
    pub path: String,
    pub is_folder: bool,
    pub accent_color: String,
    pub preview_colors: Vec<String>,
    pub has_css: bool,
    pub has_effect: bool,
    pub schemes_count: usize,
    pub schemes: Vec<String>,
    pub raw_package: String,
}

/// Resolves and ensures the skins root directory exists.
pub fn get_skins_root(#[allow(unused_variables)] app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        let mut dir =
            dirs::config_dir().ok_or_else(|| "Failed to get config directory".to_string())?;
        dir.push(env!("CARGO_PKG_NAME"));
        dir.push("skins");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        let dir = app_dir.join("skins");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }
}

/// Helper to write skin.ini, user.css, and effect.js into a folder from JSON package
fn seed_folder_from_json(folder_path: &Path, val: &serde_json::Value) {
    if let Some(css) = val.get("customCss").and_then(|v| v.as_str()) {
        let _ = fs::write(folder_path.join("user.css"), css);
    }
    if let Some(js) = val.get("customJs").and_then(|v| v.as_str()) {
        if !js.trim().is_empty() {
            let _ = fs::write(folder_path.join("effect.js"), js);
        }
    }

    let mut ini = String::new();
    ini.push_str("[Metadata]\n");
    if let Some(name) = val.get("name").and_then(|v| v.as_str()) {
        ini.push_str(&format!("name = {}\n", name));
    }
    if let Some(author) = val.get("author").and_then(|v| v.as_str()) {
        ini.push_str(&format!("author = {}\n", author));
    }
    if let Some(desc) = val.get("description").and_then(|v| v.as_str()) {
        ini.push_str(&format!("description = {}\n", desc));
    }
    if let Some(accent) = val.get("accentColor").and_then(|v| v.as_str()) {
        ini.push_str(&format!("accent = {}\n", accent));
    }
    ini.push_str("version = 2\n\n");

    if let Some(schemes) = val.get("schemes").and_then(|v| v.as_object()) {
        for (scheme_name, scheme_val) in schemes {
            ini.push_str(&format!("[{}]\n", scheme_name));
            if let Some(mode) = scheme_val.get("mode").and_then(|v| v.as_str()) {
                ini.push_str(&format!("mode = {}\n", mode));
            }
            if let Some(accent) = scheme_val.get("accentColor").and_then(|v| v.as_str()) {
                ini.push_str(&format!("accentColor = {}\n", accent));
            }
            if let Some(colors) = scheme_val.get("customColors").and_then(|v| v.as_object()) {
                for (k, v) in colors {
                    if let Some(color_str) = v.as_str() {
                        ini.push_str(&format!("{} = {}\n", k, color_str));
                    }
                }
            }
            ini.push('\n');
        }
    }

    let _ = fs::write(folder_path.join("skin.ini"), ini);
}

/// Seed official showcase skins into the skins directory if not present
fn seed_default_skins(skins_dir: &Path) {
    // 1. Seed showcase folders (apple-music/ and winamp-classic/) if not present
    let showcase_folders = [
        ("apple-music", include_str!("../../../skins/apple-music.audionskin")),
        ("winamp-classic", include_str!("../../../skins/winamp-classic.audionskin")),
    ];

    for (folder_name, embedded_pkg) in showcase_folders {
        let folder_path = skins_dir.join(folder_name);
        if folder_path.exists() {
            continue;
        }

        let _ = fs::create_dir_all(&folder_path);

        let dev_folders = [
            PathBuf::from(format!("skins/{}", folder_name)),
            PathBuf::from(format!("static/skins/{}", folder_name)),
        ];

        let mut copied_from_dev = false;
        for dev_f in &dev_folders {
            if dev_f.exists() && dev_f.is_dir() {
                if let Ok(entries) = fs::read_dir(dev_f) {
                    for entry in entries.flatten() {
                        let src = entry.path();
                        if src.is_file() {
                            let dest = folder_path.join(entry.file_name());
                            let _ = fs::copy(&src, &dest);
                        }
                    }
                    copied_from_dev = true;
                    break;
                }
            }
        }

        if !copied_from_dev {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(embedded_pkg) {
                seed_folder_from_json(&folder_path, &val);
            }
        }
    }

    // 2. Only seed standalone .audionskin files if folder counterpart does not exist
    const EMBEDDED_SKINS: &[(&str, &str)] = &[
        (
            "apple-music.audionskin",
            include_str!("../../../skins/apple-music.audionskin"),
        ),
        (
            "winamp-classic.audionskin",
            include_str!("../../../skins/winamp-classic.audionskin"),
        ),
    ];

    for (filename, embedded_content) in EMBEDDED_SKINS {
        let base_name = filename
            .trim_end_matches(".audionskin")
            .trim_end_matches(".audiotheme");
        if skins_dir.join(base_name).exists() {
            // Folder theme exists; do not create redundant standalone file
            continue;
        }

        let target_file = skins_dir.join(filename);
        if target_file.exists() {
            continue;
        }

        let dev_paths = [
            PathBuf::from(format!("skins/{}", filename)),
            PathBuf::from(format!("static/skins/{}", filename)),
        ];

        let mut seeded = false;
        for p in &dev_paths {
            if p.exists() {
                if let Ok(content) = fs::read_to_string(p) {
                    if fs::write(&target_file, content).is_ok() {
                        seeded = true;
                        break;
                    }
                }
            }
        }

        if !seeded {
            let _ = fs::write(&target_file, embedded_content);
        }
    }
}

/// Returns the absolute path string of the skins folder
#[tauri::command]
pub fn get_skins_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = get_skins_root(&app_handle)?;
    seed_default_skins(&dir);
    Ok(dir.to_string_lossy().to_string())
}

/// Opens the skins directory in the operating system's native file explorer
#[tauri::command]
pub async fn open_skins_dir(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = get_skins_root(&app_handle)?;
    seed_default_skins(&dir);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open Windows Explorer: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported operating system for opening skins directory".to_string())
    }
}

/// Simple, robust INI parser that turns an INI string into Section -> (Key -> Value)
fn parse_ini(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut sections = HashMap::new();
    let mut current_section = "default".to_string();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            let section_name = line[1..line.len() - 1].trim().to_string();
            current_section = section_name;
            continue;
        }

        if let Some((raw_key, raw_val)) = line.split_once('=').or_else(|| line.split_once(':')) {
            let key = raw_key.trim().to_string();
            let mut val = raw_val.trim();
            if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
            {
                val = &val[1..val.len() - 1];
            }
            sections
                .entry(current_section.clone())
                .or_insert_with(HashMap::new)
                .insert(key, val.to_string());
        }
    }

    sections
}

fn normalize_color_key(key: &str) -> &'static str {
    match key.to_lowercase().as_str() {
        "bg_base" | "bgbase" | "bg" | "background" => "bgBase",
        "bg_elevated" | "bgelevated" => "bgElevated",
        "bg_surface" | "bgsurface" => "bgSurface",
        "bg_highlight" | "bghighlight" => "bgHighlight",
        "text_primary" | "textprimary" | "foreground" | "main_fg" | "text" => "textPrimary",
        "text_secondary" | "textsecondary" | "sub_fg" => "textSecondary",
        "text_subdued" | "textsubdued" | "text_muted" | "textmuted" => "textSubdued",
        "accent" | "accent_color" | "accentcolor" | "main_accent" => "accentColor",
        "accent_hover" | "accenthover" => "accentHover",
        "accent_active" | "accentactive" => "accentActive",
        "border_color" | "bordercolor" | "border_base" | "borderbase" | "border" => "borderColor",
        "sidebar_bg" | "sidebarbg" => "sidebarBg",
        "player_bg" | "playerbg" => "playerBg",
        _ => "unknown",
    }
}

fn format_folder_name(folder_id: &str) -> String {
    folder_id
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_ini_to_skin_json(ini_content: &str, folder_id: &str) -> serde_json::Value {
    let sections = parse_ini(ini_content);

    let meta = sections
        .iter()
        .find(|(k, _)| {
            let lk = k.to_lowercase();
            lk == "metadata" || lk == "theme" || lk == "skin" || lk == "setting"
        })
        .map(|(_, v)| v.clone())
        .unwrap_or_default();

    let name = meta
        .get("name")
        .cloned()
        .unwrap_or_else(|| format_folder_name(folder_id));

    let author = meta
        .get("author")
        .cloned()
        .unwrap_or_else(|| "Local Theme".to_string());

    let description = meta
        .get("description")
        .cloned()
        .unwrap_or_else(|| "Custom folder theme".to_string());

    let default_accent = meta
        .get("accent")
        .or_else(|| meta.get("accentColor"))
        .or_else(|| meta.get("accent_color"))
        .cloned()
        .unwrap_or_else(|| "#fa243c".to_string());

    let version = meta
        .get("version")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(2);

    let mut schemes_map = serde_json::Map::new();
    let mut first_custom_colors = serde_json::Map::new();
    let mut primary_accent = default_accent.clone();

    for (section_name, kvs) in &sections {
        let lk = section_name.to_lowercase();
        if lk == "metadata" || lk == "theme" || lk == "skin" || lk == "setting" || lk == "default" {
            continue;
        }

        let mut colors_map = serde_json::Map::new();
        let mut scheme_accent = default_accent.clone();
        let mut mode = "dark".to_string();

        for (k, v) in kvs {
            let lk_key = k.to_lowercase();
            if lk_key == "mode" {
                mode = v.to_lowercase();
                continue;
            }
            if lk_key == "accent" || lk_key == "accentcolor" || lk_key == "accent_color" {
                scheme_accent = v.clone();
                continue;
            }
            let norm = normalize_color_key(k);
            if norm != "unknown" {
                colors_map.insert(norm.to_string(), serde_json::Value::String(v.clone()));
            } else {
                colors_map.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }

        if !colors_map.contains_key("bgBase") {
            colors_map.insert(
                "bgBase".to_string(),
                serde_json::Value::String(
                    if mode == "light" { "#ffffff" } else { "#161618" }.to_string(),
                ),
            );
        }
        if !colors_map.contains_key("bgElevated") {
            colors_map.insert(
                "bgElevated".to_string(),
                serde_json::Value::String(
                    if mode == "light" { "#f5f5f7" } else { "#1f1f22" }.to_string(),
                ),
            );
        }
        if !colors_map.contains_key("textPrimary") {
            colors_map.insert(
                "textPrimary".to_string(),
                serde_json::Value::String(
                    if mode == "light" { "#1d1d1f" } else { "#ffffff" }.to_string(),
                ),
            );
        }

        if first_custom_colors.is_empty() || lk == "dark" {
            first_custom_colors = colors_map.clone();
            primary_accent = scheme_accent.clone();
        }

        let mut scheme_obj = serde_json::Map::new();
        scheme_obj.insert(
            "name".to_string(),
            serde_json::Value::String(section_name.clone()),
        );
        scheme_obj.insert("mode".to_string(), serde_json::Value::String(mode));
        scheme_obj.insert(
            "accentColor".to_string(),
            serde_json::Value::String(scheme_accent),
        );
        scheme_obj.insert(
            "customColors".to_string(),
            serde_json::Value::Object(colors_map),
        );

        schemes_map.insert(section_name.clone(), serde_json::Value::Object(scheme_obj));
    }

    if schemes_map.is_empty() {
        let mut def_colors = serde_json::Map::new();
        def_colors.insert(
            "bgBase".to_string(),
            serde_json::Value::String("#161618".to_string()),
        );
        def_colors.insert(
            "bgElevated".to_string(),
            serde_json::Value::String("#1f1f22".to_string()),
        );
        def_colors.insert(
            "bgSurface".to_string(),
            serde_json::Value::String("#28282d".to_string()),
        );
        def_colors.insert(
            "textPrimary".to_string(),
            serde_json::Value::String("#ffffff".to_string()),
        );
        def_colors.insert(
            "textSecondary".to_string(),
            serde_json::Value::String("#a1a1a6".to_string()),
        );
        def_colors.insert(
            "textSubdued".to_string(),
            serde_json::Value::String("#86868b".to_string()),
        );
        def_colors.insert(
            "borderColor".to_string(),
            serde_json::Value::String("rgba(255, 255, 255, 0.08)".to_string()),
        );
        def_colors.insert(
            "sidebarBg".to_string(),
            serde_json::Value::String("#1a1a1d".to_string()),
        );
        def_colors.insert(
            "playerBg".to_string(),
            serde_json::Value::String("#1e1e22".to_string()),
        );

        let mut def_scheme = serde_json::Map::new();
        def_scheme.insert(
            "name".to_string(),
            serde_json::Value::String("Default".to_string()),
        );
        def_scheme.insert(
            "mode".to_string(),
            serde_json::Value::String("dark".to_string()),
        );
        def_scheme.insert(
            "accentColor".to_string(),
            serde_json::Value::String(primary_accent.clone()),
        );
        def_scheme.insert(
            "customColors".to_string(),
            serde_json::Value::Object(def_colors.clone()),
        );

        first_custom_colors = def_colors;
        schemes_map.insert("Default".to_string(), serde_json::Value::Object(def_scheme));
    }

    let mut root = serde_json::Map::new();
    root.insert("version".to_string(), serde_json::Value::Number(version.into()));
    root.insert("name".to_string(), serde_json::Value::String(name));
    root.insert("author".to_string(), serde_json::Value::String(author));
    root.insert("description".to_string(), serde_json::Value::String(description));
    root.insert(
        "accentColor".to_string(),
        serde_json::Value::String(primary_accent),
    );
    root.insert(
        "mode".to_string(),
        serde_json::Value::String("dark".to_string()),
    );
    root.insert(
        "customColors".to_string(),
        serde_json::Value::Object(first_custom_colors),
    );
    root.insert(
        "schemes".to_string(),
        serde_json::Value::Object(schemes_map),
    );

    serde_json::Value::Object(root)
}

fn build_folder_css_skin_json(folder_id: &str) -> serde_json::Value {
    let name = format_folder_name(folder_id);
    let mut def_colors = serde_json::Map::new();
    def_colors.insert(
        "bgBase".to_string(),
        serde_json::Value::String("#161618".to_string()),
    );
    def_colors.insert(
        "bgElevated".to_string(),
        serde_json::Value::String("#1f1f22".to_string()),
    );
    def_colors.insert(
        "bgSurface".to_string(),
        serde_json::Value::String("#28282d".to_string()),
    );
    def_colors.insert(
        "textPrimary".to_string(),
        serde_json::Value::String("#ffffff".to_string()),
    );
    def_colors.insert(
        "textSecondary".to_string(),
        serde_json::Value::String("#a1a1a6".to_string()),
    );
    def_colors.insert(
        "textSubdued".to_string(),
        serde_json::Value::String("#86868b".to_string()),
    );
    def_colors.insert(
        "borderColor".to_string(),
        serde_json::Value::String("rgba(255, 255, 255, 0.08)".to_string()),
    );
    def_colors.insert(
        "sidebarBg".to_string(),
        serde_json::Value::String("#1a1a1d".to_string()),
    );
    def_colors.insert(
        "playerBg".to_string(),
        serde_json::Value::String("#1e1e22".to_string()),
    );

    let mut def_scheme = serde_json::Map::new();
    def_scheme.insert(
        "name".to_string(),
        serde_json::Value::String("Default".to_string()),
    );
    def_scheme.insert(
        "mode".to_string(),
        serde_json::Value::String("dark".to_string()),
    );
    def_scheme.insert(
        "accentColor".to_string(),
        serde_json::Value::String("#fa243c".to_string()),
    );
    def_scheme.insert(
        "customColors".to_string(),
        serde_json::Value::Object(def_colors.clone()),
    );

    let mut schemes_map = serde_json::Map::new();
    schemes_map.insert("Default".to_string(), serde_json::Value::Object(def_scheme));

    let mut root = serde_json::Map::new();
    root.insert("version".to_string(), serde_json::Value::Number(2.into()));
    root.insert("name".to_string(), serde_json::Value::String(name));
    root.insert(
        "author".to_string(),
        serde_json::Value::String("Local Theme".to_string()),
    );
    root.insert(
        "description".to_string(),
        serde_json::Value::String("Custom style theme folder".to_string()),
    );
    root.insert(
        "accentColor".to_string(),
        serde_json::Value::String("#fa243c".to_string()),
    );
    root.insert(
        "mode".to_string(),
        serde_json::Value::String("dark".to_string()),
    );
    root.insert(
        "customColors".to_string(),
        serde_json::Value::Object(def_colors),
    );
    root.insert(
        "schemes".to_string(),
        serde_json::Value::Object(schemes_map),
    );

    serde_json::Value::Object(root)
}

/// Parse a raw JSON Value into a LocalSkinInfo
fn parse_skin_value(
    mut val: serde_json::Value,
    id: String,
    path_str: String,
    is_folder: bool,
) -> Option<LocalSkinInfo> {
    let obj = val.as_object_mut()?;
    let name = obj.get("name")?.as_str()?.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let accent_color = obj
        .get("accentColor")
        .and_then(|v| v.as_str())
        .unwrap_or("#1db954")
        .to_string();

    let author = obj
        .get("author")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let version = obj
        .get("version")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(1);

    let has_css = obj
        .get("customCss")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let has_effect = obj
        .get("customJs")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    // Color schemes extraction
    let mut schemes = Vec::new();
    if let Some(s_obj) = obj.get("schemes").and_then(|s| s.as_object()) {
        for (k, _) in s_obj {
            schemes.push(k.clone());
        }
    }
    let schemes_count = schemes.len();

    // Swatches preview
    let mut preview_colors = Vec::new();
    if let Some(c_obj) = obj.get("customColors").and_then(|c| c.as_object()) {
        if let Some(c) = c_obj.get("bgBase").and_then(|v| v.as_str()) {
            preview_colors.push(c.to_string());
        }
        if let Some(c) = c_obj.get("bgElevated").and_then(|v| v.as_str()) {
            preview_colors.push(c.to_string());
        }
    }
    preview_colors.push(accent_color.clone());
    if let Some(c_obj) = obj.get("customColors").and_then(|c| c.as_object()) {
        if let Some(c) = c_obj.get("textPrimary").and_then(|v| v.as_str()) {
            preview_colors.push(c.to_string());
        }
    }

    let raw_package = serde_json::to_string(&val).ok()?;

    Some(LocalSkinInfo {
        id,
        name,
        author,
        description,
        version,
        path: path_str,
        is_folder,
        accent_color,
        preview_colors,
        has_css,
        has_effect,
        schemes_count,
        schemes,
        raw_package,
    })
}

fn upsert_skin(result: &mut Vec<LocalSkinInfo>, info: LocalSkinInfo) {
    if let Some(pos) = result.iter().position(|s| {
        s.id.eq_ignore_ascii_case(&info.id) || s.name.eq_ignore_ascii_case(&info.name)
    }) {
        // Folder theme takes precedence over standalone skin package
        if info.is_folder && !result[pos].is_folder {
            result[pos] = info;
        }
        // If incoming is file and existing is folder, keep existing folder
    } else {
        result.push(info);
    }
}

/// Scans the skins directory for both standalone files and theme folders
#[tauri::command]
pub fn list_local_skins(app_handle: tauri::AppHandle) -> Result<Vec<LocalSkinInfo>, String> {
    let skins_dir = get_skins_root(&app_handle)?;
    seed_default_skins(&skins_dir);

    let mut result = Vec::new();
    let entries = fs::read_dir(&skins_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "audionskin" || ext == "audiotheme" || ext == "json" {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        let id = file_name.trim_end_matches(&format!(".{}", ext)).to_string();
                        if let Some(info) = parse_skin_value(
                            val,
                            id,
                            path.to_string_lossy().to_string(),
                            false,
                        ) {
                            upsert_skin(&mut result, info);
                        }
                    }
                }
            }
        } else if path.is_dir() {
            // Folder containing theme data (skin.ini/color.ini + user.css + effect.js, or .audionskin, or standalone user.css)
            let folder_id = file_name.clone();

            let mut found_skin: Option<serde_json::Value> = None;
            let mut modular_css: Option<String> = None;
            let mut modular_js: Option<String> = None;

            if let Ok(sub_entries) = fs::read_dir(&path) {
                for sub in sub_entries.flatten() {
                    let sub_path = sub.path();
                    let sub_name = sub.file_name().to_string_lossy().to_string().to_lowercase();

                    if sub_path.is_file() {
                        let sub_ext = sub_path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();

                        if sub_ext == "audionskin" || sub_ext == "audiotheme" {
                            if let Ok(content) = fs::read_to_string(&sub_path) {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                    found_skin = Some(val);
                                }
                            }
                        } else if sub_name == "skin.json" || sub_name == "theme.json" {
                            if let Ok(content) = fs::read_to_string(&sub_path) {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                    found_skin = Some(val);
                                }
                            }
                        } else if sub_name == "skin.ini" || sub_name == "color.ini" || sub_ext == "ini" {
                            if let Ok(content) = fs::read_to_string(&sub_path) {
                                let ini_skin = parse_ini_to_skin_json(&content, &folder_id);
                                found_skin = Some(ini_skin);
                            }
                        } else if sub_name == "user.css" || sub_name == "style.css" {
                            if let Ok(css) = fs::read_to_string(&sub_path) {
                                modular_css = Some(css);
                            }
                        } else if sub_name == "effect.js" || sub_name == "script.js" {
                            if let Ok(js) = fs::read_to_string(&sub_path) {
                                modular_js = Some(js);
                            }
                        }
                    }
                }
            }

            // If only user.css exists without INI or JSON, auto-generate skin metadata
            if found_skin.is_none() && modular_css.is_some() {
                found_skin = Some(build_folder_css_skin_json(&folder_id));
            }

            if let Some(mut skin_val) = found_skin {
                if let Some(obj) = skin_val.as_object_mut() {
                    if let Some(css) = modular_css {
                        obj.insert("customCss".to_string(), serde_json::Value::String(css));
                    }
                    if let Some(js) = modular_js {
                        obj.insert("customJs".to_string(), serde_json::Value::String(js));
                    }
                }

                if let Some(info) = parse_skin_value(
                    skin_val,
                    folder_id,
                    path.to_string_lossy().to_string(),
                    true,
                ) {
                    upsert_skin(&mut result, info);
                }
            }
        }
    }

    // Deduplication safety pass: strictly guarantee unique IDs
    let mut seen_ids = std::collections::HashSet::new();
    result.retain(|item| {
        let lower = item.id.to_lowercase();
        if seen_ids.contains(&lower) {
            false
        } else {
            seen_ids.insert(lower);
            true
        }
    });

    // Sort by name case-insensitively
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

/// Safely delete a local skin file or folder
#[tauri::command]
pub fn delete_local_skin(app_handle: tauri::AppHandle, path: String) -> Result<bool, String> {
    let skins_dir = get_skins_root(&app_handle)?;
    let target = Path::new(&path);

    // Security guard: ensure target is canonicalized inside skins_dir
    let can_skins = fs::canonicalize(&skins_dir).map_err(|e| e.to_string())?;
    let can_target = fs::canonicalize(target).map_err(|e| e.to_string())?;

    if !can_target.starts_with(&can_skins) {
        return Err("Security error: Target path is outside skins directory".to_string());
    }

    if can_target.is_dir() {
        fs::remove_dir_all(&can_target).map_err(|e| e.to_string())?;
    } else if can_target.is_file() {
        fs::remove_file(&can_target).map_err(|e| e.to_string())?;
    }

    Ok(true)
}

/// Save a skin directly into the skins directory
#[tauri::command]
pub fn save_local_skin(
    app_handle: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let skins_dir = get_skins_root(&app_handle)?;
    let safe_filename = filename
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string();

    let ext = if safe_filename.ends_with(".audionskin") {
        ""
    } else {
        ".audionskin"
    };

    let target_path = skins_dir.join(format!("{}{}", safe_filename, ext));
    fs::write(&target_path, content).map_err(|e| e.to_string())?;
    Ok(target_path.to_string_lossy().to_string())
}

