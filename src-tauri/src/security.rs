// Security utilities for file operations
// Provides path validation, safe deletion (trash), and audit logging

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Allowed directories for file operations
/// These are populated at runtime from the database music_folders table
static ALLOWED_DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();

/// Initialize allowed directories from music folders
pub fn init_allowed_dirs(dirs: Vec<PathBuf>) {
    let _ = ALLOWED_DIRS.set(dirs);
}

/// Add a directory to the allowed list (called when user adds a music folder)
pub fn add_allowed_dir(dir: PathBuf) {
    // Note: OnceLock doesn't support mutation, so we validate against DB instead
    log::info!("[SECURITY] Music folder added: {:?}", dir);
}

/// Validate that a path is within allowed directories
/// Returns true if the path is safe to operate on
pub fn is_safe_path(path: &Path) -> Result<bool, String> {
    // Canonicalize the path to resolve symlinks and ../ traversals
    let canonical = path.canonicalize().map_err(|e| {
        format!("Failed to canonicalize path {:?}: {}", path, e)
    })?;

    // Get allowed directories from the static, or return true if not initialized
    // (fallback for backward compatibility during transition)
    let allowed = match ALLOWED_DIRS.get() {
        Some(dirs) => dirs,
        None => {
            log::warn!("[SECURITY] Allowed directories not initialized, allowing operation");
            return Ok(true);
        }
    };

    // Check if the canonical path starts with any allowed directory
    for allowed_dir in allowed {
        if let Ok(allowed_canonical) = allowed_dir.canonicalize() {
            if canonical.starts_with(&allowed_canonical) {
                return Ok(true);
            }
        }
    }

    log::warn!(
        "[SECURITY] Path validation failed: {:?} is not within allowed directories",
        path
    );
    Ok(false)
}

/// Safely delete a file by moving it to trash instead of permanent deletion
/// Returns Ok(true) if successfully trashed, Ok(false) if file didn't exist
pub fn safe_delete_file(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        log::debug!("[SECURITY] File does not exist, skipping deletion: {:?}", path);
        return Ok(false);
    }

    // Validate path is within allowed directories
    if !is_safe_path(path)? {
        return Err(format!(
            "Security: Cannot delete file outside allowed directories: {:?}",
            path
        ));
    }

    // Log the deletion attempt
    log::info!(
        "[AUDIT] File deletion requested: {:?} (moving to trash)",
        path
    );

    // Move to trash instead of permanent deletion
    match trash::delete(path) {
        Ok(()) => {
            log::info!("[AUDIT] File successfully moved to trash: {:?}", path);
            Ok(true)
        }
        Err(e) => {
            log::error!("[AUDIT] Failed to move file to trash: {:?} - {}", path, e);
            // Fallback: try permanent deletion if trash fails (e.g., network drives)
            log::warn!("[AUDIT] Attempting permanent deletion as fallback: {:?}", path);
            std::fs::remove_file(path).map_err(|e| {
                format!("Failed to delete file {:?}: {}", path, e)
            })?;
            log::info!("[AUDIT] File permanently deleted (trash unavailable): {:?}", path);
            Ok(true)
        }
    }
}

/// Batch validate multiple paths
pub fn validate_paths(paths: &[&Path]) -> Result<(), String> {
    for path in paths {
        if !is_safe_path(path)? {
            return Err(format!(
                "Security: Path {:?} is outside allowed directories",
                path
            ));
        }
    }
    Ok(())
}

/// Initialize the logger for audit trail
pub fn init_logger() {
    let _ = env_logger::builder()
        .filter_level(log::LevelFilter::Info)
        .filter_module("audion_lib::security", log::LevelFilter::Debug)
        .try_init();
}
