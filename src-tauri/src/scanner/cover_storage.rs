// Cover image storage and management
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;
use std::collections::HashSet;
use crate::security;

/// Image format detection
#[derive(Debug, Clone, Copy)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Webp,
}

impl ImageFormat {
    /// Detect format from raw image bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 4 {
            return None;
        }

        // JPEG: FF D8 FF
        if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Some(ImageFormat::Jpeg);
        }

        // PNG: 89 50 4E 47
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            return Some(ImageFormat::Png);
        }

        // WebP: RIFF....WEBP
        if data.len() >= 12
            && data.starts_with(b"RIFF")
            && &data[8..12] == b"WEBP"
        {
            return Some(ImageFormat::Webp);
        }

        None
    }

    /// Get file extension
    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
            ImageFormat::Webp => "webp",
        }
    }
}

/// Get the covers directory path
/// Returns: AppData/Roaming/com.audion.app/covers/
pub fn get_covers_directory() -> Result<PathBuf, String> {
    // Get the app data directory
    let app_data = std::env::var("APPDATA")
        .map_err(|_| "Failed to get APPDATA environment variable".to_string())?;
    
    let covers_dir = PathBuf::from(app_data)
        .join("com.audion.app")
        .join("covers");

    // Create directories if they don't exist
    fs::create_dir_all(&covers_dir)
        .map_err(|e| format!("Failed to create covers directory: {}", e))?;

    Ok(covers_dir)
}

/// Get the tracks covers subdirectory
pub fn get_tracks_covers_directory() -> Result<PathBuf, String> {
    let covers_dir = get_covers_directory()?;
    let tracks_dir = covers_dir.join("tracks");
    
    fs::create_dir_all(&tracks_dir)
        .map_err(|e| format!("Failed to create tracks covers directory: {}", e))?;
    
    Ok(tracks_dir)
}

/// Get the albums covers subdirectory
pub fn get_albums_covers_directory() -> Result<PathBuf, String> {
    let covers_dir = get_covers_directory()?;
    let albums_dir = covers_dir.join("albums");
    
    fs::create_dir_all(&albums_dir)
        .map_err(|e| format!("Failed to create albums covers directory: {}", e))?;
    
    Ok(albums_dir)
}

/// Save track cover image to file
/// Returns the file path as a string
pub fn save_track_cover(track_id: i64, image_data: &[u8]) -> Result<String, String> {
    let tracks_dir = get_tracks_covers_directory()?;
    
    // Detect image format
    let format = ImageFormat::from_bytes(image_data)
        .ok_or_else(|| "Unsupported or invalid image format".to_string())?;
    
    let filename = format!("{}.{}", track_id, format.extension());
    let file_path = tracks_dir.join(&filename);
    
    // Write image data to file
    fs::write(&file_path, image_data)
        .map_err(|e| format!("Failed to write cover file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

/// Save track cover from base64 string (for migration)
pub fn save_track_cover_from_base64(track_id: i64, base64_data: &str) -> Result<String, String> {
    // Decode base64
    let image_bytes = STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    save_track_cover(track_id, &image_bytes)
}

/// Save album art image to file
/// Returns the file path as a string
pub fn save_album_art(album_id: i64, image_data: &[u8]) -> Result<String, String> {
    let albums_dir = get_albums_covers_directory()?;
    
    // Detect image format
    let format = ImageFormat::from_bytes(image_data)
        .ok_or_else(|| "Unsupported or invalid image format".to_string())?;
    
    let filename = format!("{}.{}", album_id, format.extension());
    let file_path = albums_dir.join(&filename);
    
    // Write image data to file
    fs::write(&file_path, image_data)
        .map_err(|e| format!("Failed to write album art file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

/// Save album art from base64 string (for migration)
pub fn save_album_art_from_base64(album_id: i64, base64_data: &str) -> Result<String, String> {
    // Decode base64
    let image_bytes = STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    save_album_art(album_id, &image_bytes)
}

/// Get cover file path for a track (verifies file exists)
pub fn get_track_cover_file_path(conn: &Connection, track_id: i64) -> Result<Option<String>> {
    let path: Option<String> = conn
        .query_row(
            "SELECT track_cover_path FROM tracks WHERE id = ?1",
            [track_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    
    // Verify file exists
    if let Some(ref p) = path {
        if std::path::Path::new(p).exists() {
            return Ok(Some(p.clone()));
        }
    }
    
    Ok(None)
}

/// Get cover file path for an album (verifies file exists)
pub fn get_album_art_file_path(conn: &Connection, album_id: i64) -> Result<Option<String>> {
    let path: Option<String> = conn
        .query_row(
            "SELECT art_path FROM albums WHERE id = ?1",
            [album_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    
    // Verify file exists
    if let Some(ref p) = path {
        if std::path::Path::new(p).exists() {
            return Ok(Some(p.clone()));
        }
    }
    
    Ok(None)
}

/// Delete cover file for a track (uses secure deletion with logging)
pub fn delete_track_cover_file(track_cover_path: Option<&str>) -> Result<(), String> {
    if let Some(path) = track_cover_path {
        let path_obj = std::path::Path::new(path);
        if path_obj.exists() {
            // Cover files are in app data directory, use direct deletion
            // (secure deletion is for music files in user directories)
            log::debug!("[AUDIT] Deleting track cover file: {:?}", path_obj);
            fs::remove_file(path_obj)
                .map_err(|e| format!("Failed to delete cover file: {}", e))?;
        }
    }
    Ok(())
}

/// Delete album art file (uses logging for audit trail)
pub fn delete_album_art_file(art_path: Option<&str>) -> Result<(), String> {
    if let Some(path) = art_path {
        let path_obj = std::path::Path::new(path);
        if path_obj.exists() {
            // Album art files are in app data directory, use direct deletion
            log::debug!("[AUDIT] Deleting album art file: {:?}", path_obj);
            fs::remove_file(path_obj)
                .map_err(|e| format!("Failed to delete album art file: {}", e))?;
        }
    }
    Ok(())
}

/// Clean up orphaned cover files (covers without corresponding tracks/albums)
pub fn cleanup_orphaned_covers(conn: &Connection) -> Result<usize, String> {
    let mut deleted_count = 0;
    
    // 1: Load all valid IDs from database
    
    // Get all track IDs at once
    let track_ids: HashSet<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM tracks")
            .map_err(|e| format!("Failed to prepare track IDs query: {}", e))?;
        
        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to query track IDs: {}", e))?
            .collect::<std::result::Result<HashSet<i64>, _>>()
            .map_err(|e| format!("Failed to collect track IDs: {}", e))?;
        
        ids
    };
    
    // Get all album IDs at once
    let album_ids: HashSet<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM albums")
            .map_err(|e| format!("Failed to prepare album IDs query: {}", e))?;
        
        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to query album IDs: {}", e))?
            .collect::<std::result::Result<HashSet<i64>, _>>()
            .map_err(|e| format!("Failed to collect album IDs: {}", e))?;
        
        ids
    };
    
    // 2: Clean up track covers

    let tracks_dir = get_tracks_covers_directory()?;
    if tracks_dir.exists() {
        for entry in fs::read_dir(&tracks_dir)
            .map_err(|e| format!("Failed to read tracks covers directory: {}", e))? 
        {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();
            
            if path.is_file() {
                // Extract track_id from filename (e.g., "123.jpg" -> 123)
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(track_id) = stem.parse::<i64>() {
                        // Check against in-memory HashSet
                        if !track_ids.contains(&track_id) {
                            // Track doesn't exist, delete the cover file
                            if let Err(e) = fs::remove_file(&path) {
                                eprintln!("Failed to delete orphaned track cover {:?}: {}", path, e);
                            } else {
                                deleted_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 3: Clean up album art
    
    let albums_dir = get_albums_covers_directory()?;
    if albums_dir.exists() {
        for entry in fs::read_dir(&albums_dir)
            .map_err(|e| format!("Failed to read albums covers directory: {}", e))? 
        {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();
            
            if path.is_file() {
                // Extract album_id from filename (e.g., "456.jpg" -> 456)
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(album_id) = stem.parse::<i64>() {
                        // Check against in-memory HashSet
                        if !album_ids.contains(&album_id) {
                            // Album doesn't exist, delete the art file
                            if let Err(e) = fs::remove_file(&path) {
                                eprintln!("Failed to delete orphaned album art {:?}: {}", path, e);
                            } else {
                                deleted_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_format_detection() {
        // JPEG
        let jpeg_bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        assert!(matches!(ImageFormat::from_bytes(&jpeg_bytes), Some(ImageFormat::Jpeg)));

        // PNG
        let png_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(matches!(ImageFormat::from_bytes(&png_bytes), Some(ImageFormat::Png)));

        // Invalid
        let invalid_bytes = vec![0x00, 0x00, 0x00, 0x00];
        assert!(ImageFormat::from_bytes(&invalid_bytes).is_none());
    }

    #[test]
    fn test_format_extension() {
        assert_eq!(ImageFormat::Jpeg.extension(), "jpg");
        assert_eq!(ImageFormat::Png.extension(), "png");
        assert_eq!(ImageFormat::Webp.extension(), "webp");
    }
}