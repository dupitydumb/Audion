// Tauri backend commands for plugin management
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
#[allow(unused_imports)]
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginManifest {
    pub name: String,
    #[serde(default)]
    pub safe_name: Option<String>, // Explicit safe folder name (e.g., "discord-rich-presence")
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub manifest_url: Option<String>,
    #[serde(rename = "type")]
    pub plugin_type: String,
    pub entry: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub cross_plugin_access: Vec<CrossPluginAccess>,
    #[serde(default)]
    pub ui_slots: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub provides: Option<Vec<String>>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub integrity: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginState {
    pub name: String,
    pub enabled: bool,
    pub granted_permissions: Vec<String>,
    pub version: String,
    pub plugin_type: String,
    pub installed_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginInfo {
    pub name: String,
    pub enabled: bool,
    pub manifest: PluginManifest,
    pub granted_permissions: Vec<String>,
    pub folder_name: String,
}

#[derive(Serialize, Deserialize, Default)]
struct PluginStateStore {
    plugins: HashMap<String, PluginState>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CrossPluginAccess {
    pub plugin: String,
    pub methods: Vec<String>,
}

// Helper to convert display name to safe folder name (fallback when safe_name not in manifest)
fn to_safe_name(name: &str) -> String {
    // Replace one or more whitespace characters with a single dash, then lowercase
    let mut result = String::new();
    let mut last_was_space = false;

    for c in name.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                result.push('-');
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }

    result.to_lowercase()
}

// Get safe name from manifest (prefers explicit safe_name, falls back to conversion)
fn get_safe_name_from_manifest(manifest: &PluginManifest) -> String {
    manifest
        .safe_name
        .clone()
        .unwrap_or_else(|| to_safe_name(&manifest.name))
}

fn get_state_file_path(plugin_dir: &str) -> PathBuf {
    let dir = get_plugins_root(plugin_dir);
    dir.join("plugin_state.json")
}

fn load_plugin_states(plugin_dir: &str) -> PluginStateStore {
    let state_path = get_state_file_path(plugin_dir);
    if let Ok(content) = fs::read_to_string(&state_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        PluginStateStore::default()
    }
}

fn save_plugin_states(plugin_dir: &str, store: &PluginStateStore) -> Result<(), String> {
    let state_path = get_state_file_path(plugin_dir);
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&state_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_plugin_manifest(plugin_path: &PathBuf) -> Option<PluginManifest> {
    let manifest_path = plugin_path.join("plugin.json");
    if let Ok(manifest_str) = fs::read_to_string(&manifest_path) {
        serde_json::from_str(&manifest_str).ok()
    } else {
        None
    }
}

// Resolve the effective plugins root. On Linux we use XDG config dir (~/.config/<app>/plugins).
fn get_plugins_root(plugin_dir: &str) -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        if let Some(mut p) = dirs::config_dir() {
            p.push(env!("CARGO_PKG_NAME"));
            p.push("plugins");
            return p;
        }
    }
    PathBuf::from(plugin_dir)
}

// Helper to find a plugin's path by its name
// Tries:
// 1. Standard safe name
// 2. Safe name with "-main" suffix
// 3. Scan all directories for matching manifest name
fn resolve_plugin_path(plugin_dir: &str, plugin_name: &str) -> Option<(PathBuf, String)> {
    let dir = get_plugins_root(plugin_dir);
    let safe_name = to_safe_name(plugin_name);

    // 1. Try exact safe name
    let path1 = dir.join(&safe_name);
    if let Some(manifest) = read_plugin_manifest(&path1) {
        if manifest.name == plugin_name {
            return Some((path1, safe_name));
        }
    }

    // 2. Try safe name + "-main" suffix
    let suffix_name = format!("{}-main", safe_name);
    let path2 = dir.join(&suffix_name);
    if let Some(manifest) = read_plugin_manifest(&path2) {
        if manifest.name == plugin_name {
            return Some((path2, suffix_name));
        }
    }

    // 3. Scan all subdirectories
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(manifest) = read_plugin_manifest(&path) {
                    if manifest.name == plugin_name {
                        let folder_name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or_default()
                            .to_string();
                        return Some((path, folder_name));
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
pub fn list_plugins(plugin_dir: String) -> Vec<PluginInfo> {
    let mut plugins = Vec::new();
    let dir = get_plugins_root(&plugin_dir);
    let states = load_plugin_states(dir.to_string_lossy().as_ref());

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(manifest) = read_plugin_manifest(&path) {
                    // No need to strict validate folder name anymore, just list it.
                    let name = manifest.name.clone();
                    let state = states.plugins.get(&name);

                    plugins.push(PluginInfo {
                        name: name.clone(),
                        enabled: state.map(|s| s.enabled).unwrap_or(false),
                        manifest,
                        granted_permissions: state
                            .map(|s| s.granted_permissions.clone())
                            .unwrap_or_default(),
                        folder_name: path.file_name().unwrap().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    plugins
}

#[tauri::command]
pub fn enable_plugin(name: String, plugin_dir: String) -> Result<bool, String> {
    let plugin_root = get_plugins_root(&plugin_dir);
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());

    // Use resolve_plugin_path to find the real path
    let (plugin_path, _folder_name) = resolve_plugin_path(&plugin_dir, &name)
        .ok_or_else(|| format!("Plugin not found: {}", name))?;

    // Read manifest to get requested permissions
    let manifest = read_plugin_manifest(&plugin_path);

    if let Some(state) = states.plugins.get_mut(&name) {
        state.enabled = true;

        // Auto-grant manifest permissions if not already granted
        if let Some(ref m) = manifest {
            for perm in &m.permissions {
                if !state.granted_permissions.contains(perm) {
                    state.granted_permissions.push(perm.clone());
                }
            }
        }

        save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;
        Ok(true)
    } else {
        // Plugin not in state yet, need to add it
        if let Some(manifest) = manifest {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();

            // Auto-grant all manifest permissions on first enable
            let granted_permissions = manifest.permissions.clone();

            states.plugins.insert(
                name.clone(),
                PluginState {
                    name: name.clone(),
                    enabled: true,
                    granted_permissions,
                    version: manifest.version,
                    plugin_type: manifest.plugin_type,
                    installed_at: now,
                },
            );
            save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;
            Ok(true)
        } else {
            Err(format!("Plugin manifest not found"))
        }
    }
}

#[tauri::command]
pub fn disable_plugin(name: String, plugin_dir: String) -> Result<bool, String> {
    let plugin_root = get_plugins_root(&plugin_dir);
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());

    if let Some(state) = states.plugins.get_mut(&name) {
        state.enabled = false;
        save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;
        Ok(true)
    } else {
        Err(format!("Plugin not tracked: {}", name))
    }
}

#[tauri::command]
pub async fn install_plugin(
    repo_url: String,
    plugin_dir: String,
    expected_sha256: Option<String>,
) -> Result<PluginInfo, String> {
    // Parse GitHub URL to get owner/repo
    let parts: Vec<&str> = repo_url.trim_end_matches('/').split('/').collect();

    if parts.len() < 2 {
        return Err("Invalid repository URL".to_string());
    }

    let owner = parts[parts.len() - 2];
    let repo = parts[parts.len() - 1];

    let client = reqwest::Client::new();

    // First, get repo info to find default branch
    let repo_api_url = format!("https://api.github.com/repos/{}/{}", owner, repo);

    let repo_response = client
        .get(&repo_api_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo info: {}", e))?;

    let default_branch = if repo_response.status().is_success() {
        let repo_info: serde_json::Value = repo_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse repo info: {}", e))?;
        repo_info["default_branch"]
            .as_str()
            .unwrap_or("main")
            .to_string()
    } else {
        "main".to_string()
    };

    // Fetch plugin.json from raw content
    let manifest_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/plugin.json",
        owner, repo, default_branch
    );

    let manifest_response = client
        .get(&manifest_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch plugin.json: {}", e))?;

    if !manifest_response.status().is_success() {
        return Err(format!(
            "Failed to fetch plugin.json: HTTP {}",
            manifest_response.status()
        ));
    }

    let mut manifest: PluginManifest = manifest_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse plugin.json: {}", e))?;

    // Inject repo URL into manifest for future update checks
    manifest.repo = Some(repo_url.clone());

    // Get safe name from manifest (prefers explicit safe_name field)
    let safe_name = get_safe_name_from_manifest(&manifest);
    let plugin_root = get_plugins_root(&plugin_dir);
    let plugin_path = plugin_root.join(&safe_name);

    // When installing new, we enforce the standard naming convention
    // validate_safe_name(&manifest, &safe_name)?;

    fs::create_dir_all(&plugin_path).map_err(|e| format!("Failed to create plugin dir: {}", e))?;

    // Save plugin.json (with repo URL included)
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(plugin_path.join("plugin.json"), &manifest_json)
        .map_err(|e| format!("Failed to save plugin.json: {}", e))?;

    // Fetch the entry file (index.js or plugin.wasm)
    let entry_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, default_branch, manifest.entry
    );

    let entry_response = client
        .get(&entry_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch entry file: {}", e))?;

    if !entry_response.status().is_success() {
        return Err(format!(
            "Failed to fetch {}: HTTP {}",
            manifest.entry,
            entry_response.status()
        ));
    }

    let entry_bytes = entry_response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read entry file: {}", e))?;

    // Verify SHA-256 integrity hash if provided or specified in manifest
    let target_sha256 = expected_sha256
        .as_deref()
        .or(manifest.sha256.as_deref())
        .or(manifest.integrity.as_deref());

    if let Some(expected_hash) = target_sha256 {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&entry_bytes);
        let actual_hash = format!("{:x}", hasher.finalize());
        let clean_expected = expected_hash
            .trim()
            .trim_start_matches("sha256-")
            .to_lowercase();

        if actual_hash != clean_expected {
            return Err(format!(
                "Integrity verification failed for {}: expected SHA-256 '{}', but got '{}'",
                manifest.entry, clean_expected, actual_hash
            ));
        }
        println!("[PluginInstall] SHA-256 verified successfully for plugin {}: {}", manifest.name, actual_hash);
    }

    fs::write(plugin_path.join(&manifest.entry), &entry_bytes)
        .map_err(|e| format!("Failed to save entry file: {}", e))?;

    // Fetch the icon file if it's relative
    if let Some(icon_path) = &manifest.icon {
        if !icon_path.starts_with("http") && !icon_path.starts_with("data:") {
            let icon_url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}",
                owner, repo, default_branch, icon_path
            );
            if let Ok(icon_resp) = client
                .get(&icon_url)
                .header("User-Agent", "Audion-Plugin-Manager")
                .send()
                .await
            {
                if icon_resp.status().is_success() {
                    if let Ok(icon_bytes) = icon_resp.bytes().await {
                        let _ = fs::write(plugin_path.join(icon_path), &icon_bytes);
                    }
                }
            }
        }
    }

    // Add to state
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    states.plugins.insert(
        manifest.name.clone(),
        PluginState {
            name: manifest.name.clone(),
            enabled: false,
            granted_permissions: vec![],
            version: manifest.version.clone(),
            plugin_type: manifest.plugin_type.clone(),
            installed_at: now,
        },
    );
    save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;

    Ok(PluginInfo {
        name: manifest.name.clone(),
        enabled: false,
        manifest,
        granted_permissions: vec![],
        folder_name: safe_name,
    })
}

fn generate_default_manifest(stem: &str) -> PluginManifest {
    let display_name = stem
        .replace('-', " ")
        .replace('_', " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    PluginManifest {
        name: if display_name.is_empty() {
            "Imported Plugin".to_string()
        } else {
            display_name
        },
        safe_name: Some(to_safe_name(stem)),
        version: "1.0.0".to_string(),
        author: "Community".to_string(),
        description: Some("Imported community extension package".to_string()),
        repo: None,
        manifest_url: None,
        plugin_type: "js".to_string(),
        entry: "index.js".to_string(),
        permissions: vec![
            "player:control".to_string(),
            "player:read".to_string(),
            "library:read".to_string(),
            "ui:inject".to_string(),
            "network:fetch".to_string(),
            "storage:local".to_string(),
            "lyrics:read".to_string(),
            "lyrics:write".to_string(),
            "system:notify".to_string(),
        ],
        cross_plugin_access: vec![],
        ui_slots: None,
        icon: None,
        icon_url: None,
        category: Some("utility".to_string()),
        tags: None,
        provides: None,
        license: None,
        integrity: None,
        sha256: None,
    }
}

#[tauri::command]
pub async fn install_plugin_package(
    file_path: String,
    plugin_dir: String,
) -> Result<PluginInfo, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let plugin_root = get_plugins_root(&plugin_dir);
    fs::create_dir_all(&plugin_root)
        .map_err(|e| format!("Failed to create plugins root: {}", e))?;

    let file_bytes = fs::read(&path)
        .map_err(|e| format!("Failed to read plugin file: {}", e))?;

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("plugin");
    let clean_stem = file_stem
        .trim_end_matches(".audion")
        .trim_end_matches("-audion");

    // Case 1: ZIP Archive (.zip, .ext, .audion-ext containing plugin.json / index.js)
    if file_bytes.starts_with(b"PK\x03\x04") {
        let cursor = std::io::Cursor::new(&file_bytes);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to parse zip archive: {}", e))?;

        let mut manifest_path_in_zip: Option<String> = None;
        let mut manifest_content: Option<String> = None;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            let norm_name = name.replace('\\', "/");
            let norm_lower = norm_name.to_lowercase();

            if norm_lower == "plugin.json" || norm_lower.ends_with("/plugin.json") {
                let mut buf = String::new();
                std::io::Read::read_to_string(&mut file, &mut buf).map_err(|e| e.to_string())?;
                manifest_path_in_zip = Some(norm_name);
                manifest_content = Some(buf);
                break;
            }
        }

        let manifest: PluginManifest = if let Some(content) = manifest_content {
            serde_json::from_str(&content)
                .map_err(|e| format!("Invalid plugin.json in archive: {}", e))?
        } else {
            generate_default_manifest(clean_stem)
        };

        let safe_name = get_safe_name_from_manifest(&manifest);
        let dest_dir = plugin_root.join(&safe_name);
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create destination dir: {}", e))?;

        let prefix = if let Some(ref m_path) = manifest_path_in_zip {
            if let Some(pos) = m_path.rfind('/') {
                format!("{}/", &m_path[..pos])
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let raw_name = file.name().replace('\\', "/");
            let rel_path = if !prefix.is_empty() && raw_name.starts_with(&prefix) {
                &raw_name[prefix.len()..]
            } else {
                &raw_name
            };

            if rel_path.is_empty() || rel_path.ends_with('/') {
                continue;
            }

            let outpath = dest_dir.join(rel_path);
            if let Some(parent) = outpath.parent() {
                let _ = fs::create_dir_all(parent);
            }

            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file {:?}: {}", outpath, e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file {:?}: {}", outpath, e))?;
        }

        let manifest_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
        fs::write(dest_dir.join("plugin.json"), manifest_json)
            .map_err(|e| format!("Failed to save plugin.json: {}", e))?;

        let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        states.plugins.insert(
            manifest.name.clone(),
            PluginState {
                name: manifest.name.clone(),
                enabled: false,
                granted_permissions: manifest.permissions.clone(),
                version: manifest.version.clone(),
                plugin_type: manifest.plugin_type.clone(),
                installed_at: now,
            },
        );
        save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;

        return Ok(PluginInfo {
            name: manifest.name.clone(),
            enabled: false,
            manifest,
            granted_permissions: vec![],
            folder_name: safe_name,
        });
    }

    // Case 2: Plain text file (.ext, .audion-ext, .js, .sflx, .json)
    let content = String::from_utf8(file_bytes)
        .map_err(|_| "Unsupported binary file format. Expected zip archive or JavaScript/JSON text.".to_string())?;

    let trimmed = content.trim();
    let (mut manifest, js_code) = if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let code_str = val.get("code")
                .or_else(|| val.get("script"))
                .or_else(|| val.get("entry_code"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let Some(code) = code_str {
                let m: PluginManifest = if let Some(m_val) = val.get("manifest") {
                    serde_json::from_value(m_val.clone()).unwrap_or_else(|_| generate_default_manifest(clean_stem))
                } else {
                    serde_json::from_value(val.clone()).unwrap_or_else(|_| generate_default_manifest(clean_stem))
                };
                (m, code)
            } else {
                (generate_default_manifest(clean_stem), content.clone())
            }
        } else {
            (generate_default_manifest(clean_stem), content.clone())
        }
    } else {
        let mut m = generate_default_manifest(clean_stem);
        for line in content.lines() {
            let line_trim = line.trim();
            if !line_trim.starts_with("//") {
                if !line_trim.is_empty() && !line_trim.starts_with("/*") && !line_trim.starts_with("*") {
                    break;
                }
                continue;
            }
            let comment = line_trim.trim_start_matches("//").trim();
            if let Some(rest) = comment.strip_prefix("@name") {
                let val = rest.trim();
                if !val.is_empty() { m.name = val.to_string(); }
            } else if let Some(rest) = comment.strip_prefix("@version") {
                let val = rest.trim();
                if !val.is_empty() { m.version = val.to_string(); }
            } else if let Some(rest) = comment.strip_prefix("@author") {
                let val = rest.trim();
                if !val.is_empty() { m.author = val.to_string(); }
            } else if let Some(rest) = comment.strip_prefix("@description") {
                let val = rest.trim();
                if !val.is_empty() { m.description = Some(val.to_string()); }
            }
        }
        (m, content.clone())
    };

    let safe_name = get_safe_name_from_manifest(&manifest);
    let dest_dir = plugin_root.join(&safe_name);
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    let entry_filename = if manifest.entry.is_empty() { "index.js".to_string() } else { manifest.entry.clone() };
    manifest.entry = entry_filename.clone();

    fs::write(dest_dir.join(&entry_filename), js_code)
        .map_err(|e| format!("Failed to save entry file: {}", e))?;

    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(dest_dir.join("plugin.json"), manifest_json)
        .map_err(|e| format!("Failed to save plugin.json: {}", e))?;

    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    states.plugins.insert(
        manifest.name.clone(),
        PluginState {
            name: manifest.name.clone(),
            enabled: false,
            granted_permissions: manifest.permissions.clone(),
            version: manifest.version.clone(),
            plugin_type: manifest.plugin_type.clone(),
            installed_at: now,
        },
    );
    save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;

    Ok(PluginInfo {
        name: manifest.name.clone(),
        enabled: false,
        manifest,
        granted_permissions: vec![],
        folder_name: safe_name,
    })
}

#[tauri::command]
pub fn uninstall_plugin(name: String, plugin_dir: String) -> Result<bool, String> {
    // Resolve path using our robust helper
    let (plugin_path, _) = resolve_plugin_path(&plugin_dir, &name)
        .ok_or_else(|| format!("Plugin not found: {}", name))?;

    // Remove plugin directory
    fs::remove_dir_all(&plugin_path).map_err(|e| format!("Failed to remove plugin: {}", e))?;

    // Remove from state (using original name as key)
    let plugin_root = get_plugins_root(&plugin_dir);
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
    states.plugins.remove(&name);
    save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;

    Ok(true)
}

#[tauri::command]
pub fn get_plugin_permissions(name: String, plugin_dir: String) -> Option<Vec<String>> {
    let (plugin_path, _) = resolve_plugin_path(&plugin_dir, &name)?;
    read_plugin_manifest(&plugin_path).map(|m| m.permissions)
}

#[tauri::command]
pub fn grant_permissions(
    name: String,
    plugin_dir: String,
    permissions: Vec<String>,
) -> Result<bool, String> {
    let plugin_root = get_plugins_root(&plugin_dir);
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());

    if let Some(state) = states.plugins.get_mut(&name) {
        // Merge new permissions with existing ones
        for perm in permissions {
            if !state.granted_permissions.contains(&perm) {
                state.granted_permissions.push(perm);
            }
        }
        save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;
        Ok(true)
    } else {
        Err(format!("Plugin not tracked: {}", name))
    }
}

// cross plugin permission check
#[tauri::command]
pub fn check_cross_plugin_permission(
    caller_plugin: String,
    target_plugin: String,
    method: String,
    plugin_dir: String,
) -> Result<bool, String> {
    // Get caller plugin's manifest using resolve_plugin_path
    let (caller_path, _) = resolve_plugin_path(&plugin_dir, &caller_plugin)
        .ok_or_else(|| format!("Caller plugin not found: {}", caller_plugin))?;

    let manifest = read_plugin_manifest(&caller_path)
        .ok_or_else(|| format!("Caller plugin manifest not found"))?;

    // Check if caller has permission for this target plugin + method
    // The manifest contains display names in cross_plugin_access, so compare directly
    for access in &manifest.cross_plugin_access {
        if access.plugin == target_plugin && access.methods.contains(&method) {
            return Ok(true);
        }
    }

    Ok(false)
}

// Get all cross-plugin permissions for a plugin - returns them as-is from manifest
#[tauri::command]
pub fn get_cross_plugin_permissions(
    plugin_name: String,
    plugin_dir: String,
) -> Result<Vec<CrossPluginAccess>, String> {
    // Resolve path using robust helper
    let (plugin_path, _) = resolve_plugin_path(&plugin_dir, &plugin_name)
        .ok_or_else(|| format!("Plugin not found: {}", plugin_name))?;

    let manifest =
        read_plugin_manifest(&plugin_path).ok_or_else(|| format!("Plugin manifest not found"))?;

    // Return cross_plugin_access as-is (contains display names like "Tidal Search")
    Ok(manifest.cross_plugin_access)
}

#[tauri::command]
pub fn revoke_permissions(
    name: String,
    plugin_dir: String,
    permissions: Vec<String>,
) -> Result<bool, String> {
    let plugin_root = get_plugins_root(&plugin_dir);
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());

    if let Some(state) = states.plugins.get_mut(&name) {
        state
            .granted_permissions
            .retain(|p| !permissions.contains(p));
        save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;
        Ok(true)
    } else {
        Err(format!("Plugin not tracked: {}", name))
    }
}

#[tauri::command]
pub fn get_plugin_dir(#[allow(unused_variables)] app_handle: tauri::AppHandle) -> Result<String, String> {
    // On Linux use XDG config directory (~/.config/<app>/plugins)
    #[cfg(target_os = "linux")]
    {
        let mut plugin_dir =
            dirs::config_dir().ok_or_else(|| "Failed to get config directory".to_string())?;
        // Use the package name as the application folder (e.g., "audion")
        plugin_dir.push(env!("CARGO_PKG_NAME"));
        plugin_dir.push("plugins");
        fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
        return Ok(plugin_dir.to_string_lossy().to_string());
    }

    // Default behavior for other platforms: use app data dir
    #[cfg(not(target_os = "linux"))]
    {
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        let plugin_dir = app_dir.join("plugins");
        fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
        Ok(plugin_dir.to_string_lossy().to_string())
    }
}

// Helper to compare semver versions (returns true if remote is newer)
fn is_newer_version(local: &str, remote: &str) -> bool {
    let parse_version = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };

    let local_parts = parse_version(local);
    let remote_parts = parse_version(remote);

    for i in 0..std::cmp::max(local_parts.len(), remote_parts.len()) {
        let local_num = local_parts.get(i).copied().unwrap_or(0);
        let remote_num = remote_parts.get(i).copied().unwrap_or(0);

        if remote_num > local_num {
            return true;
        } else if remote_num < local_num {
            return false;
        }
    }
    false
}

#[derive(Serialize, Clone, Debug)]
pub struct PluginUpdateInfo {
    pub name: String,
    pub current_version: String,
    pub new_version: String,
    pub repo_url: String,
}

#[tauri::command]
pub async fn check_plugin_updates(plugin_dir: String) -> Result<Vec<PluginUpdateInfo>, String> {
    let mut updates = Vec::new();
    let dir = get_plugins_root(&plugin_dir);
    let client = reqwest::Client::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(manifest) = read_plugin_manifest(&path) {
                    // Need repo URL to check for updates
                    if let Some(repo_url) = &manifest.repo {
                        // Parse GitHub URL
                        let parts: Vec<&str> = repo_url.trim_end_matches('/').split('/').collect();
                        if parts.len() < 2 {
                            continue;
                        }

                        let owner = parts[parts.len() - 2];
                        let repo = parts[parts.len() - 1];

                        // Get default branch
                        let repo_api_url =
                            format!("https://api.github.com/repos/{}/{}", owner, repo);
                        let default_branch = match client
                            .get(&repo_api_url)
                            .header("User-Agent", "Audion-Plugin-Manager")
                            .send()
                            .await
                        {
                            Ok(resp) if resp.status().is_success() => {
                                match resp.json::<serde_json::Value>().await {
                                    Ok(info) => info["default_branch"]
                                        .as_str()
                                        .unwrap_or("main")
                                        .to_string(),
                                    Err(_) => "main".to_string(),
                                }
                            }
                            _ => "main".to_string(),
                        };

                        // Fetch remote plugin.json
                        let manifest_url = format!(
                            "https://raw.githubusercontent.com/{}/{}/{}/plugin.json",
                            owner, repo, default_branch
                        );

                        if let Ok(resp) = client
                            .get(&manifest_url)
                            .header("User-Agent", "Audion-Plugin-Manager")
                            .send()
                            .await
                        {
                            if resp.status().is_success() {
                                if let Ok(remote_manifest) = resp.json::<PluginManifest>().await {
                                    if is_newer_version(&manifest.version, &remote_manifest.version)
                                    {
                                        updates.push(PluginUpdateInfo {
                                            name: manifest.name.clone(),
                                            current_version: manifest.version.clone(),
                                            new_version: remote_manifest.version,
                                            repo_url: repo_url.clone(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(updates)
}

#[tauri::command]
pub async fn update_plugin(name: String, plugin_dir: String) -> Result<PluginInfo, String> {
    // Get the current plugin's path using resolve_plugin_path
    let (plugin_path, _) = resolve_plugin_path(&plugin_dir, &name)
        .ok_or_else(|| format!("Plugin not found: {}", name))?;

    let manifest =
        read_plugin_manifest(&plugin_path).ok_or_else(|| format!("Plugin manifest not found"))?;

    let repo_url = manifest
        .repo
        .ok_or_else(|| format!("Plugin {} has no repository URL", name))?;

    // Load current state to preserve enabled status and permissions
    let plugin_root = get_plugins_root(&plugin_dir);
    let states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
    let current_state = states.plugins.get(&name).cloned();

    // Remove the old plugin files (but keep state)
    // NOTE: This will delete the arbitrary folder it was in.
    // The re-install below will use the safe name. This effectively "standardizes"
    // the folder name on update, which is desirable.
    fs::remove_dir_all(&plugin_path)
        .map_err(|e| format!("Failed to remove old plugin files: {}", e))?;

    // Reinstall from repo (reuse install_plugin logic parts)
    let parts: Vec<&str> = repo_url.trim_end_matches('/').split('/').collect();
    if parts.len() < 2 {
        return Err("Invalid repository URL".to_string());
    }

    let owner = parts[parts.len() - 2];
    let repo = parts[parts.len() - 1];
    let client = reqwest::Client::new();

    // Get default branch
    let repo_api_url = format!("https://api.github.com/repos/{}/{}", owner, repo);
    let default_branch = match client
        .get(&repo_api_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(info) => info["default_branch"]
                .as_str()
                .unwrap_or("main")
                .to_string(),
            Err(_) => "main".to_string(),
        },
        _ => "main".to_string(),
    };

    // Fetch new plugin.json
    let manifest_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/plugin.json",
        owner, repo, default_branch
    );

    let manifest_response = client
        .get(&manifest_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch plugin.json: {}", e))?;

    if !manifest_response.status().is_success() {
        return Err(format!(
            "Failed to fetch plugin.json: HTTP {}",
            manifest_response.status()
        ));
    }

    let mut new_manifest: PluginManifest = manifest_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse plugin.json: {}", e))?;

    // Inject repo URL into manifest for future update checks
    new_manifest.repo = Some(repo_url.clone());

    // Get safe name from manifest (prefers explicit safe_name field)
    let new_safe_name = get_safe_name_from_manifest(&new_manifest);
    // When updating, we revert to standard naming
    let new_plugin_path = plugin_root.join(&new_safe_name);

    fs::create_dir_all(&new_plugin_path)
        .map_err(|e| format!("Failed to create plugin dir: {}", e))?;

    // Save new plugin.json
    let manifest_json = serde_json::to_string_pretty(&new_manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(new_plugin_path.join("plugin.json"), &manifest_json)
        .map_err(|e| format!("Failed to save plugin.json: {}", e))?;

    // Fetch the entry file
    let entry_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, default_branch, new_manifest.entry
    );

    let entry_response = client
        .get(&entry_url)
        .header("User-Agent", "Audion-Plugin-Manager")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch entry file: {}", e))?;

    if !entry_response.status().is_success() {
        return Err(format!(
            "Failed to fetch {}: HTTP {}",
            new_manifest.entry,
            entry_response.status()
        ));
    }

    let entry_bytes = entry_response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read entry file: {}", e))?;

    fs::write(new_plugin_path.join(&new_manifest.entry), &entry_bytes)
        .map_err(|e| format!("Failed to save entry file: {}", e))?;

    // Fetch the icon file if it's relative
    if let Some(icon_path) = &new_manifest.icon {
        if !icon_path.starts_with("http") && !icon_path.starts_with("data:") {
            let icon_url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}",
                owner, repo, default_branch, icon_path
            );
            if let Ok(icon_resp) = client
                .get(&icon_url)
                .header("User-Agent", "Audion-Plugin-Manager")
                .send()
                .await
            {
                if icon_resp.status().is_success() {
                    if let Ok(icon_bytes) = icon_resp.bytes().await {
                        let _ = fs::write(new_plugin_path.join(icon_path), &icon_bytes);
                    }
                }
            }
        }
    }

    // Update state, preserving enabled status and permissions from before
    let mut states = load_plugin_states(plugin_root.to_string_lossy().as_ref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let (enabled, granted_permissions) = if let Some(old_state) = current_state {
        (old_state.enabled, old_state.granted_permissions)
    } else {
        (false, vec![])
    };

    states.plugins.insert(
        new_manifest.name.clone(),
        PluginState {
            name: new_manifest.name.clone(),
            enabled,
            granted_permissions: granted_permissions.clone(),
            version: new_manifest.version.clone(),
            plugin_type: new_manifest.plugin_type.clone(),
            installed_at: now,
        },
    );
    save_plugin_states(plugin_root.to_string_lossy().as_ref(), &states)?;

    Ok(PluginInfo {
        name: new_manifest.name.clone(),
        enabled,
        manifest: new_manifest,
        granted_permissions,
        folder_name: new_safe_name,
    })
}

// windows currently ignore images
#[tauri::command]
pub fn save_notification_image(data_uri: String) -> Result<String, String> {
    // Parse the data URI
    // Format: data:image/jpeg;base64,<base64_data>
    let parts: Vec<&str> = data_uri.split(',').collect();
    if parts.len() != 2 {
        return Err("Invalid data URI format".to_string());
    }

    let header = parts[0];
    let base64_data = parts[1];

    // Extract image type (jpeg, png, etc.)
    let image_ext = if header.contains("jpeg") || header.contains("jpg") {
        "jpg"
    } else if header.contains("png") {
        "png"
    } else if header.contains("gif") {
        "gif"
    } else {
        "jpg" // default
    };

    // Decode base64
    let image_data = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Get temp directory
    let temp_dir = std::env::temp_dir();

    // Create a unique filename
    let filename = format!(
        "audion_notification_{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
        image_ext
    );

    let temp_path = temp_dir.join(filename);

    // Write to file
    fs::write(&temp_path, image_data).map_err(|e| format!("Failed to write file: {}", e))?;

    // Return the absolute path as string
    temp_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
pub async fn plugin_save_data(
    plugin_name: String,
    key: String,
    value: String,
    plugin_dir: String,
) -> Result<(), String> {
    let safe_name = to_safe_name(&plugin_name);
    let storage_dir = get_plugins_root(&plugin_dir)
        .join(&safe_name)
        .join("storage");
    fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;

    let file_path = storage_dir.join(format!("{}.json", key));
    fs::write(file_path, value).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_get_data(
    plugin_name: String,
    key: String,
    plugin_dir: String,
) -> Result<Option<String>, String> {
    let safe_name = to_safe_name(&plugin_name);
    let file_path = get_plugins_root(&plugin_dir)
        .join(&safe_name)
        .join("storage")
        .join(format!("{}.json", key));

    if file_path.exists() {
        let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn plugin_list_keys(
    plugin_name: String,
    plugin_dir: String,
) -> Result<Vec<String>, String> {
    let safe_name = to_safe_name(&plugin_name);
    let storage_dir = get_plugins_root(&plugin_dir)
        .join(&safe_name)
        .join("storage");

    if !storage_dir.exists() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();
    if let Ok(entries) = fs::read_dir(storage_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.path().file_stem().and_then(|s| s.to_str()) {
                keys.push(name.to_string());
            }
        }
    }
    Ok(keys)
}

#[tauri::command]
pub async fn plugin_clear_data(plugin_name: String, plugin_dir: String) -> Result<usize, String> {
    let safe_name = to_safe_name(&plugin_name);
    let storage_dir = get_plugins_root(&plugin_dir)
        .join(&safe_name)
        .join("storage");

    if !storage_dir.exists() {
        return Ok(0);
    }

    let count = fs::read_dir(&storage_dir)
        .map(|entries| entries.flatten().count())
        .unwrap_or(0);

    fs::remove_dir_all(&storage_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;

    Ok(count)
}
