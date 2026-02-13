// Tauri backend commands for plugin management
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub license: Option<String>,
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
    name.replace(" ", "-").to_lowercase()
}

// Get safe name from manifest (prefers explicit safe_name, falls back to conversion)
fn get_safe_name_from_manifest(manifest: &PluginManifest) -> String {
    manifest
        .safe_name
        .clone()
        .unwrap_or_else(|| to_safe_name(&manifest.name))
}

fn get_state_file_path(plugin_dir: &str) -> PathBuf {
    PathBuf::from(plugin_dir).join("plugin_state.json")
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

// Helper to find a plugin's path by its name
// Tries:
// 1. Standard safe name
// 2. Safe name with "-main" suffix
// 3. Scan all directories for matching manifest name
fn resolve_plugin_path(plugin_dir: &str, plugin_name: &str) -> Option<(PathBuf, String)> {
    let dir = PathBuf::from(plugin_dir);
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
    let dir = PathBuf::from(&plugin_dir);
    let states = load_plugin_states(&plugin_dir);

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
                    });
                }
            }
        }
    }
    plugins
}

#[tauri::command]
pub fn enable_plugin(name: String, plugin_dir: String) -> Result<bool, String> {
    let mut states = load_plugin_states(&plugin_dir);

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

        save_plugin_states(&plugin_dir, &states)?;
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
            save_plugin_states(&plugin_dir, &states)?;
            Ok(true)
        } else {
            Err(format!("Plugin manifest not found"))
        }
    }
}

#[tauri::command]
pub fn disable_plugin(name: String, plugin_dir: String) -> Result<bool, String> {
    let mut states = load_plugin_states(&plugin_dir);

    if let Some(state) = states.plugins.get_mut(&name) {
        state.enabled = false;
        save_plugin_states(&plugin_dir, &states)?;
        Ok(true)
    } else {
        Err(format!("Plugin not tracked: {}", name))
    }
}

#[tauri::command]
pub async fn install_plugin(repo_url: String, plugin_dir: String) -> Result<PluginInfo, String> {
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
    let plugin_path = PathBuf::from(&plugin_dir).join(&safe_name);

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

    fs::write(plugin_path.join(&manifest.entry), &entry_bytes)
        .map_err(|e| format!("Failed to save entry file: {}", e))?;

    // Add to state
    let mut states = load_plugin_states(&plugin_dir);
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
    save_plugin_states(&plugin_dir, &states)?;

    Ok(PluginInfo {
        name: manifest.name.clone(),
        enabled: false,
        manifest,
        granted_permissions: vec![],
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
    let mut states = load_plugin_states(&plugin_dir);
    states.plugins.remove(&name);
    save_plugin_states(&plugin_dir, &states)?;

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
    let mut states = load_plugin_states(&plugin_dir);

    if let Some(state) = states.plugins.get_mut(&name) {
        // Merge new permissions with existing ones
        for perm in permissions {
            if !state.granted_permissions.contains(&perm) {
                state.granted_permissions.push(perm);
            }
        }
        save_plugin_states(&plugin_dir, &states)?;
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
    let mut states = load_plugin_states(&plugin_dir);

    if let Some(state) = states.plugins.get_mut(&name) {
        state
            .granted_permissions
            .retain(|p| !permissions.contains(p));
        save_plugin_states(&plugin_dir, &states)?;
        Ok(true)
    } else {
        Err(format!("Plugin not tracked: {}", name))
    }
}

#[tauri::command]
pub fn get_plugin_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let plugin_dir = app_dir.join("plugins");
    fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    Ok(plugin_dir.to_string_lossy().to_string())
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
    let dir = PathBuf::from(&plugin_dir);
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
    let states = load_plugin_states(&plugin_dir);
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
    let new_plugin_path = PathBuf::from(&plugin_dir).join(&new_safe_name);

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

    // Update state, preserving enabled status and permissions from before
    let mut states = load_plugin_states(&plugin_dir);
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
    save_plugin_states(&plugin_dir, &states)?;

    Ok(PluginInfo {
        name: new_manifest.name.clone(),
        enabled,
        manifest: new_manifest,
        granted_permissions,
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
    let storage_dir = std::path::PathBuf::from(&plugin_dir)
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
    let file_path = std::path::PathBuf::from(&plugin_dir)
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
    let storage_dir = std::path::PathBuf::from(&plugin_dir)
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
    let storage_dir = std::path::PathBuf::from(&plugin_dir)
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
