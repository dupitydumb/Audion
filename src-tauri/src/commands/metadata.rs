// Audio save and metadata commands
use futures::StreamExt;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::Tag;
use lofty::config::WriteOptions;
use mp4ameta::{Tag as Mp4Tag, Img};
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

    // Correct the file extension to match the actual container, and rename on disk.
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
            eprintln!("[Metadata] Warning: Could not detect file type, skipping metadata");
            return Ok(input.path);
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
    // Write metadata acording to type
    match actual_file_type {
        Some(lofty::file::FileType::Mp4) => {
            match write_m4a_metadata(&final_path, &input).await {
                Ok(()) => println!("[Metadata] Successfully wrote M4A metadata"),
                Err(e) => eprintln!("[Metadata] Warning: Could not write M4A metadata: {}", e),
            }
        }
        Some(lofty::file::FileType::Aac) => {
            // Raw aac streams do not support  metadata – skip
            println!("[Metadata] File is raw AAC, skipping metadata");
        }
        Some(_) => {
            // mp3, wav, opus, flac – handled by lofty
            match write_metadata_to_file(&final_path, &input).await {
                Ok(()) => println!("[Metadata] Successfully wrote metadata to file"),
                Err(e) => eprintln!("[Metadata] Warning: Could not write metadata: {}", e),
            }
        }
        None => {
            
        }
    }

    Ok(final_path_str)
}

/// Rename a file's extension to match its actual detected container type.
/// Returns the original path unchanged if the extension is already correct
/// or if the file type has no known preferred extension.
fn correct_extension(path: &Path, file_type: lofty::file::FileType) -> PathBuf {
    let correct_ext = match file_type {
        lofty::file::FileType::Flac    => "flac",
        lofty::file::FileType::Mpeg    => "mp3",
        lofty::file::FileType::Aac     => "aac",
        lofty::file::FileType::Mp4     => "m4a",
        lofty::file::FileType::Vorbis  => "ogg",
        lofty::file::FileType::Opus    => "opus",
        lofty::file::FileType::Wav     => "wav",
        lofty::file::FileType::Aiff    => "aiff",
        lofty::file::FileType::Ape     => "ape",
        lofty::file::FileType::Speex   => "spx",
        _                              => return path.to_path_buf(),
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

async fn write_metadata_to_file(path: &Path, input: &DownloadAudioInput) -> Result<(), String> {
    // Read the file for metadata
    let mut tagged_file = Probe::open(path)
        .ok()
        .and_then(|p| p.guess_file_type().ok())
        .and_then(|p| p.read().ok())
        .ok_or("Failed to read file for metadata")?;

    // Get or create primary tag
    let tag = match tagged_file.primary_tag_mut() {
        Some(tag) => tag,
        None => {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
            tagged_file
                .primary_tag_mut()
                .ok_or("Failed to create tag")?
        }
    };

    // Set metadata
    if let Some(title) = &input.title {
        tag.set_title(title.clone());
    }
    if let Some(artist) = &input.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(album) = &input.album {
        tag.set_album(album.clone());
    }
    if let Some(track_num) = input.track_number {
        tag.set_track(track_num);
    }

    // Download and set cover art if URL provided
    if let Some(cover_url) = &input.cover_url {
        if !cover_url.is_empty() {
            match download_cover(cover_url).await {
                Ok(cover_data) => {
                    let picture = Picture::new_unchecked(
                        PictureType::CoverFront,
                        Some(MimeType::Jpeg),
                        None,
                        cover_data,
                    );
                    tag.push_picture(picture);
                }
                Err(e) => eprintln!("[Metadata] Failed to download cover: {}", e),
            }
        }
    }

    // Save the metadata
    tag.save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to save metadata: {}", e))?;

    Ok(())
}

async fn download_cover(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch cover: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read cover: {}", e))?;

    Ok(bytes.to_vec())
}

async fn write_m4a_metadata(path: &Path, input: &DownloadAudioInput) -> Result<(), String> {
    // imp: do NOT fall back to Mp4Tag::default() on failure.
    // Writing a bare default tag onto an existing MP4 file will corrupt it
    // because the default tag has no knowledge of the file's existing atom structure.
    // If read fails, the file is not a valid mp4 container
    let mut tag = Mp4Tag::read_from_path(path).map_err(|e| {
        format!(
            "Failed to read M4A container (file may not be a valid M4A/MP4): {}",
            e
        )
    })?;

    if let Some(title) = &input.title {
        tag.set_title(title);
    }
    if let Some(artist) = &input.artist {
        tag.set_artist(artist);
    }
    if let Some(album) = &input.album {
        tag.set_album(album);
    }
    if let Some(track_num) = input.track_number {
        tag.set_track_number(track_num as u16);
    }

    if let Some(cover_url) = &input.cover_url {
        if !cover_url.is_empty() {
            match download_cover(cover_url).await {
                Ok(cover_data) => {
                    // Detect image format by magic bytes
                    let img = if cover_data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                        Img::jpeg(cover_data)
                    } else if cover_data.starts_with(b"\x89PNG\r\n\x1a\n") {
                        Img::png(cover_data)
                    } else {
                        println!("[Metadata] Unknown image format, defaulting to JPEG");
                        Img::jpeg(cover_data)
                    };
                    tag.set_artwork(img);
                    println!("[Metadata] Added cover art to M4A file");
                }
                Err(e) => eprintln!("[Metadata] Failed to download M4A cover: {}", e),
            }
        }
    }

    tag.write_to_path(path)
        .map_err(|e| format!("Failed to save M4A metadata: {}", e))?;

    Ok(())
}