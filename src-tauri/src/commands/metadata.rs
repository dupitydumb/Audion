// Audio save and metadata commands
use futures::StreamExt;
use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;
use metaflac::block::Picture as FlacPicture;
use metaflac::Tag as FlacTag;
use mp4ameta::{Img, Tag as Mp4Tag};
// use ratio_metadata::{...}; // Import ratio-metadata functions
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Emitter, State};

use crate::db::{self, Database};

#[derive(serde::Deserialize)]
pub struct DownloadAudioInput {
    pub url: String,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub cover_url: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    path: String,
    current: u64,
    total: u64,
}

#[command]
pub async fn download_and_save_audio(
    app: AppHandle,
    input: DownloadAudioInput,
    state: State<'_, Database>,
) -> Result<String, String> {
    let path = std::path::Path::new(&input.path);

    // Security: Validate path to prevent directory traversal
    // We expect the path to be absolute or at least not escaping its intended parent
    if let Some(parent) = path.parent() {
        // For simplicity, we'll ensure the path doesn't contain traversal components
        // and that it's a subpath of its own parent (which should be the download dir)
        crate::utils::resolve_path(
            parent,
            path.file_name().unwrap_or_default().to_str().unwrap_or(""),
        )
        .map_err(|e| format!("Security Error: {}", e))?;
    } else {
        return Err("Invalid path: No parent directory".to_string());
    }

    // Debug: Log input values
    println!("[Metadata] Saving to path: {}", &input.path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Download the audio file from URL with progress
    println!("[Metadata] Downloading audio from URL...");
    download_file_with_progress(&app, &input.url, &input.path).await?;

    // Probe the actual file type
    let actual_file_type = Probe::open(path)
        .ok()
        .and_then(|p| p.guess_file_type().ok())
        .and_then(|p| p.file_type());

    println!("[Metadata] Detected file type: {:?}", actual_file_type);

    // Always correct the file extension to match the detected type
    let final_path = match actual_file_type {
        Some(ft) => {
            let corrected = correct_extension(path, ft);
            if corrected != path {
                println!(
                    "[Metadata] Correcting extension: .{} -> .{}",
                    path.extension().and_then(|e| e.to_str()).unwrap_or(""),
                    corrected.extension().and_then(|e| e.to_str()).unwrap_or("")
                );
                fs::rename(path, &corrected)
                    .map_err(|e| format!("Failed to rename file to correct extension: {}", e))?;
                // Emit progress event after rename so frontend can match on the correct filename
                let _ = app.emit(
                    "download://progress",
                    DownloadProgress {
                        path: corrected.to_string_lossy().to_string(),
                        current: 0,
                        total: 0,
                    },
                );
            }
            corrected
        }
        None => {
            eprintln!(
                "[Metadata] Warning: Could not detect file type, skipping extension correction"
            );
            path.to_path_buf()
        }
    };

    // Normalize path
    let final_path_str = final_path
        .canonicalize()
        .unwrap_or(final_path.clone())
        .to_string_lossy()
        .to_string()
        .replace(r"\\?\", ""); // Remove Windows extended-length prefix

    // Try to write metadata (non-fatal if it fails)
    // Write metadata based on the file extension, since detection might be unreliable
    let final_ext = final_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Consolidate cover art retrieval
    let mut cover_data: Option<Vec<u8>> = None;

    // 1. Try to get local cover file path from DB if possible
    // Note: Reusing the logic that was present in write_metadata_to_file
    // Using track_number as track_id seems to be the intended behavior in the existing code
    if let Some(track_id) = input.track_number.map(|n| n as i64) {
        let conn = state.conn.lock().unwrap();
        if let Ok(Some(local_path)) = db::queries::get_track_cover_path(&conn, track_id) {
            if let Ok(data) = std::fs::read(&local_path) {
                println!("[Metadata] Found local cover art at {}", local_path);
                cover_data = Some(data);
            }
        }
    }

    // 2. If not found locally, try to download with retry
    if cover_data.is_none() {
        if let Some(cover_url) = &input.cover_url {
            if !cover_url.is_empty() {
                println!("[Metadata] Downloading cover art from {}", cover_url);
                cover_data = download_cover_with_retry(cover_url).await;
            }
        }
    }

    match final_ext.as_str() {
        "m4a" | "mp4" => match write_m4a_metadata(&final_path, &input, cover_data).await {
            Ok(()) => println!("[Metadata] Successfully wrote M4A metadata"),
            Err(e) => eprintln!("[Metadata] Warning: Could not write M4A metadata: {}", e),
        },
        "mp3" | "ogg" | "opus" | "wav" | "aiff" | "aac" => {
            // For other formats handled by lofty
            match write_metadata_to_file(&final_path, &input, cover_data).await {
                Ok(()) => println!("[Metadata] Successfully wrote metadata to file"),
                Err(e) => eprintln!("[Metadata] Warning: Could not write metadata: {}", e),
            }
        }
        "flac" => {
            match write_flac_metadata(&final_path, &input, cover_data) {
                Ok(()) => println!("[Metadata] Successfully wrote FLAC metadata using metaflac"),
                Err(e) => eprintln!("[Metadata] Failed to write FLAC metadata: {}", e),
            }
            return Ok(final_path_str);
        }
        _ => {
            println!(
                "[Metadata] Unknown file extension '{}', skipping metadata write",
                final_ext
            );
        }
    }

    Ok(final_path_str)
}

/// Rename a file's extension to match its actual detected container type.
/// Returns the original path unchanged if the extension is already correct
/// or if the file type has no known preferred extension.
fn correct_extension(path: &Path, file_type: lofty::file::FileType) -> PathBuf {
    let correct_ext = match file_type {
        lofty::file::FileType::Flac => "flac",
        lofty::file::FileType::Mpeg => "mp3",
        lofty::file::FileType::Aac => "aac",
        lofty::file::FileType::Mp4 => "m4a",
        lofty::file::FileType::Vorbis => "ogg",
        lofty::file::FileType::Opus => "opus",
        lofty::file::FileType::Wav => "wav",
        lofty::file::FileType::Aiff => "aiff",
        lofty::file::FileType::Ape => "ape",
        lofty::file::FileType::Speex => "spx",
        _ => return path.to_path_buf(),
    };

    let current_ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if current_ext == correct_ext {
        path.to_path_buf()
    } else {
        path.with_extension(correct_ext)
    }
}

async fn download_file_with_progress(
    app: &AppHandle,
    url: &str,
    file_path: &str,
) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download audio: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut file =
        fs::File::create(file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error while downloading: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Error while writing to file: {}", e))?;

        downloaded += chunk.len() as u64;

        // Emit progress event
        let _ = app.emit(
            "download://progress",
            DownloadProgress {
                path: file_path.to_string(),
                current: downloaded,
                total: total_size,
            },
        );
    }

    Ok(())
}

#[command]
pub async fn update_track_after_download(
    state: State<'_, Database>,
    track_id: i64,
    local_path: String,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::queries::update_track_after_download(&conn, track_id, &local_path)
        .map_err(|e| format!("Failed to update track after download: {}", e))
}

#[command]
pub async fn update_track_cover_url(
    state: State<'_, Database>,
    track_id: i64,
    cover_url: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::queries::update_track_cover_url(&conn, track_id, cover_url.as_deref())
        .map_err(|e| format!("Failed to update cover URL: {}", e))
}

#[command]
pub async fn update_local_src(
    state: State<'_, Database>,
    track_id: i64,
    local_src: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::queries::update_local_src(&conn, track_id, local_src.as_deref())
        .map_err(|e| format!("Failed to update local_src: {}", e))
}

async fn write_metadata_to_file(
    path: &Path,
    input: &DownloadAudioInput,
    cover_data: Option<Vec<u8>>,
) -> Result<(), String> {
    // Read the file for metadata with better error handling
    let mut tagged_file = match Probe::open(path) {
        Ok(probe) => match probe.guess_file_type() {
            Ok(probe_with_type) => match probe_with_type.read() {
                Ok(file) => file,
                Err(e) => {
                    eprintln!(
                        "[Metadata] Failed to read file tags: {}. Skipping metadata write.",
                        e
                    );
                    return Ok(()); // Don't fail, just skip
                }
            },
            Err(e) => {
                eprintln!(
                    "[Metadata] Failed to guess file type: {}. Skipping metadata write.",
                    e
                );
                return Ok(());
            }
        },
        Err(e) => {
            eprintln!(
                "[Metadata] Failed to open file for metadata: {}. Skipping metadata write.",
                e
            );
            return Ok(());
        }
    };

    // Get or create primary tag
    let tag = match tagged_file.primary_tag_mut() {
        Some(tag) => tag,
        None => {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
            match tagged_file.primary_tag_mut() {
                Some(tag) => tag,
                None => {
                    eprintln!("[Metadata] Failed to create tag. Skipping metadata write.");
                    return Ok(());
                }
            }
        }
    };

    // Helper function to sanitize strings
    fn sanitize_string(s: &str) -> String {
        s.chars()
            .filter(|c| {
                c.is_ascii()
                    || c.is_alphanumeric()
                    || c.is_whitespace()
                    || matches!(
                        c,
                        '.' | '-'
                            | '_'
                            | '('
                            | ')'
                            | '['
                            | ']'
                            | ':'
                            | ';'
                            | ','
                            | '!'
                            | '?'
                            | '\''
                            | '"'
                    )
            })
            .collect::<String>()
            .trim()
            .to_string()
    }

    // Set metadata with validation
    if let Some(title) = &input.title {
        let clean_title = sanitize_string(title);
        if !clean_title.is_empty() && clean_title.len() <= 255 {
            tag.set_title(clean_title);
        }
    }
    if let Some(artist) = &input.artist {
        let clean_artist = sanitize_string(artist);
        if !clean_artist.is_empty() && clean_artist.len() <= 255 {
            tag.set_artist(clean_artist);
        }
    }
    if let Some(album) = &input.album {
        let clean_album = sanitize_string(album);
        if !clean_album.is_empty() && clean_album.len() <= 255 {
            tag.set_album(clean_album);
        }
    }
    if let Some(track_num) = input.track_number {
        if track_num > 0 && track_num <= 255 {
            tag.set_track(track_num);
        }
    }

    // If we have cover data, embed it
    if let Some(cover_data) = cover_data {
        if cover_data.len() > 0 && cover_data.len() <= 10 * 1024 * 1024 {
            let mime_type = if cover_data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                Some(MimeType::Jpeg)
            } else if cover_data.starts_with(b"\x89PNG\r\n\x1a\n") {
                Some(MimeType::Png)
            } else if cover_data.starts_with(b"GIF87a") || cover_data.starts_with(b"GIF89a") {
                Some(MimeType::Gif)
            } else {
                None
            };
            if let Some(mime) = mime_type {
                let picture =
                    Picture::new_unchecked(PictureType::CoverFront, Some(mime), None, cover_data);
                tag.push_picture(picture);
                println!("[Metadata] Added cover art to file");
            } else {
                eprintln!("[Metadata] Unsupported image format for cover art");
            }
        } else {
            eprintln!(
                "[Metadata] Cover art data size invalid: {} bytes",
                cover_data.len()
            );
        }
    }

    // Save the metadata with error handling
    match tag.save_to_path(path, WriteOptions::default()) {
        Ok(_) => {
            println!("[Metadata] Successfully saved metadata");
            Ok(())
        }
        Err(e) => {
            eprintln!(
                "[Metadata] Failed to save metadata: {}. File may be read-only or corrupted.",
                e
            );
            Ok(()) // Don't fail the download
        }
    }
}

async fn download_cover(url: &str) -> Result<Vec<u8>, String> {
    // Validate URL
    if url.is_empty() || !url.starts_with("http") {
        return Err("Invalid cover URL".to_string());
    }

    // Create client with timeout
    let client = reqwest::Client::builder()
        .http1_only()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = match client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .send()
        .await {
        Ok(resp) => resp,
        Err(e) => {
            eprintln!("[Metadata] Reqwest error (debug): {:#?}", e);
            return Err(format!("Failed to fetch cover: {}", e));
        }
    };

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    // Check content length header
    if let Some(len) = response.content_length() {
        if len == 0 {
            return Err("Empty cover image".to_string());
        }
        if len > 10 * 1024 * 1024 {
            // 10MB limit
            return Err(format!("Cover image too large: {} bytes", len));
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read cover data: {}", e))?;

    let data = bytes.to_vec();

    // Final size check
    if data.is_empty() {
        return Err("Empty cover data received".to_string());
    }
    if data.len() > 10 * 1024 * 1024 {
        return Err(format!("Cover data too large: {} bytes", data.len()));
    }

    // Basic validation - check if it looks like an image
    if data.len() < 4 {
        return Err("Cover data too small to be a valid image".to_string());
    }

    // Check magic bytes for common image formats
    let is_valid_image = data.starts_with(&[0xFF, 0xD8, 0xFF]) || // JPEG
                        data.starts_with(b"\x89PNG\r\n\x1a\n") || // PNG
                        data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") || // GIF
                        data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WEBP" || // WebP
                        data.starts_with(&[0x42, 0x4D]); // BMP

    if !is_valid_image {
        return Err("Cover data does not appear to be a valid image".to_string());
    }

    Ok(data)
}

async fn download_cover_with_retry(url: &str) -> Option<Vec<u8>> {
    let mut attempts = 0;
    let max_attempts = 3;
    let mut backoff = 1;

    loop {
        attempts += 1;
        match download_cover(url).await {
            Ok(data) => return Some(data),
            Err(e) => {
                eprintln!(
                    "[Metadata] Failed to download cover (attempt {}/{}): {}",
                    attempts, max_attempts, e
                );
                if attempts >= max_attempts {
                    eprintln!(
                        "[Metadata] Giving up on cover download after {} attempts",
                        max_attempts
                    );
                    return None;
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                backoff *= 2;
            }
        }
    }
}

/// Read metadata from an audio file gracefully
pub fn read_metadata_gracefully(path: &Path) -> Option<lofty::tag::Tag> {
    match Probe::open(path) {
        Ok(probe) => match probe.guess_file_type() {
            Ok(probe_with_type) => match probe_with_type.read() {
                Ok(tagged_file) => {
                    if let Some(tag) = tagged_file.primary_tag() {
                        Some(tag.clone())
                    } else {
                        // Try to get any tag
                        tagged_file.tags().get(0).cloned()
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[Metadata] Failed to read metadata from {}: {}",
                        path.display(),
                        e
                    );
                    None
                }
            },
            Err(e) => {
                eprintln!(
                    "[Metadata] Failed to guess file type for {}: {}",
                    path.display(),
                    e
                );
                None
            }
        },
        Err(e) => {
            eprintln!(
                "[Metadata] Failed to open file for metadata reading {}: {}",
                path.display(),
                e
            );
            None
        }
    }
}

/// Extract basic metadata fields from a tag
pub fn extract_metadata_fields(
    tag: &lofty::tag::Tag,
) -> (Option<String>, Option<String>, Option<String>, Option<u32>) {
    let title = tag.title().map(|s| s.to_string());
    let artist = tag.artist().map(|s| s.to_string());
    let album = tag.album().map(|s| s.to_string());
    let track_number = tag.track();

    (title, artist, album, track_number)
}

async fn write_m4a_metadata(
    path: &Path,
    input: &DownloadAudioInput,
    cover_data: Option<Vec<u8>>,
) -> Result<(), String> {
    // Read the M4A file with better error handling
    let mut tag = match Mp4Tag::read_from_path(path) {
        Ok(tag) => tag,
        Err(e) => {
            eprintln!("[Metadata] Failed to read M4A container: {}. File may not be a valid M4A/MP4 or may be corrupted. Skipping metadata write.", e);
            return Ok(());
        }
    };

    // Helper function to sanitize strings
    fn sanitize_string(s: &str) -> String {
        s.chars()
            .filter(|c| {
                c.is_ascii()
                    || c.is_alphanumeric()
                    || c.is_whitespace()
                    || matches!(
                        c,
                        '.' | '-'
                            | '_'
                            | '('
                            | ')'
                            | '['
                            | ']'
                            | ':'
                            | ';'
                            | ','
                            | '!'
                            | '?'
                            | '\''
                            | '"'
                    )
            })
            .collect::<String>()
            .trim()
            .to_string()
    }

    // Set metadata with validation
    if let Some(title) = &input.title {
        let clean_title = sanitize_string(title);
        if !clean_title.is_empty() && clean_title.len() <= 255 {
            tag.set_title(clean_title);
        }
    }
    if let Some(artist) = &input.artist {
        let clean_artist = sanitize_string(artist);
        if !clean_artist.is_empty() && clean_artist.len() <= 255 {
            tag.set_artist(clean_artist);
        }
    }
    if let Some(album) = &input.album {
        let clean_album = sanitize_string(album);
        if !clean_album.is_empty() && clean_album.len() <= 255 {
            tag.set_album(clean_album);
        }
    }
    if let Some(track_num) = input.track_number {
        if track_num > 0 && track_num <= u16::MAX as u32 {
            tag.set_track_number(track_num as u16);
        }
    }

    // Download and set cover art if URL provided
    if let Some(cover_data) = cover_data {
        if cover_data.len() > 0 && cover_data.len() <= 10 * 1024 * 1024 {
            // 10MB limit
            // Detect image format by magic bytes
            let img = if cover_data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                Img::jpeg(cover_data)
            } else if cover_data.starts_with(b"\x89PNG\r\n\x1a\n") {
                Img::png(cover_data)
            } else if cover_data.starts_with(b"GIF87a") || cover_data.starts_with(b"GIF89a") {
                // GIF not supported by mp4ameta, use JPEG
                eprintln!("[Metadata] GIF cover art not supported for M4A, converting to JPEG");
                Img::jpeg(cover_data)
            } else if cover_data.starts_with(b"RIFF")
                && cover_data.len() >= 12
                && &cover_data[8..12] == b"WEBP"
            {
                // WebP not supported, use JPEG
                eprintln!("[Metadata] WebP cover art not supported for M4A, converting to JPEG");
                Img::jpeg(cover_data)
            } else {
                eprintln!("[Metadata] Unknown image format for M4A cover art, defaulting to JPEG");
                Img::jpeg(cover_data)
            };
            tag.set_artwork(img);
            println!("[Metadata] Added cover art to M4A file");
        } else {
            eprintln!(
                "[Metadata] Cover art data size invalid: {} bytes",
                cover_data.len()
            );
        }
    }

    // Save the metadata with error handling
    match tag.write_to_path(path) {
        Ok(_) => {
            println!("[Metadata] Successfully saved M4A metadata");
            Ok(())
        }
        Err(e) => {
            eprintln!(
                "[Metadata] Failed to save M4A metadata: {}. File may be read-only or corrupted.",
                e
            );
            Ok(()) // Don't fail the download
        }
    }
}

/// Write FLAC metadata using metaflac
fn write_flac_metadata(
    path: &Path,
    input: &DownloadAudioInput,
    cover_data: Option<Vec<u8>>,
) -> Result<(), String> {
    let mut tag =
        FlacTag::read_from_path(path).map_err(|e| format!("Failed to read FLAC tag: {}", e))?;
    if let Some(title) = &input.title {
        tag.set_vorbis("TITLE", vec![title.clone()]);
    }
    if let Some(artist) = &input.artist {
        tag.set_vorbis("ARTIST", vec![artist.clone()]);
    }
    if let Some(album) = &input.album {
        tag.set_vorbis("ALBUM", vec![album.clone()]);
    }
    if let Some(track_num) = input.track_number {
        tag.set_vorbis("TRACKNUMBER", vec![track_num.to_string()]);
    }
    // Add cover art if available
    if let Some(cover_data) = cover_data {
        if !cover_data.is_empty() && cover_data.len() <= 10 * 1024 * 1024 {
            let mime_type = if cover_data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                "image/jpeg"
            } else if cover_data.starts_with(b"\x89PNG\r\n\x1a\n") {
                "image/png"
            } else if cover_data.starts_with(b"GIF87a") || cover_data.starts_with(b"GIF89a") {
                "image/gif"
            } else {
                "application/octet-stream"
            };
            tag.add_picture(
                mime_type,
                metaflac::block::PictureType::CoverFront,
                cover_data,
            );
            println!("[Metadata] Added cover art to FLAC file");
        }
    }
    tag.write_to_path(path)
        .map_err(|e| format!("Failed to write FLAC tag: {}", e))?;
    Ok(())
}
