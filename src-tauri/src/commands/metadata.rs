// Audio save and metadata commands
use futures::StreamExt;
use lofty::{Accessor, MimeType, Picture, PictureType, Probe, TagExt, TaggedFileExt};
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::{command, AppHandle, Emitter, State};

use crate::db::{self, Database};

#[derive(serde::Deserialize)]
pub struct DownloadAudioInput {
    pub url: String,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
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
    let path = Path::new(&input.path);

    // Debug: Log input values
    println!("[Metadata] Saving to path: {}", &input.path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Download the audio file from URL with progress
    println!("[Metadata] Downloading audio from URL...");
    download_file_with_progress(&app, &input.url, &input.path).await?;

    // Try to write metadata (non-fatal if it fails)
    // AAC files with ID3 tags often fail to play in browsers, so we skip metadata for them
    let is_aac = path
        .extension()
        .map_or(false, |ext| ext.eq_ignore_ascii_case("aac"));
    if !is_aac {
        match write_metadata_to_file(path, &input).await {
            Ok(()) => println!("[Metadata] Successfully wrote metadata to file"),
            Err(e) => eprintln!("[Metadata] Warning: Could not write metadata: {}", e),
        }
    } else {
        println!("[Metadata] Skipping metadata for AAC file");
    }

    Ok(input.path)
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
pub async fn update_local_src(
    state: State<'_, Database>,
    track_id: i64,
    local_src: String,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    db::queries::update_track_local_src(&conn, track_id, &local_src)
        .map_err(|e| format!("Failed to update local src: {}", e))
}

async fn write_metadata_to_file(path: &Path, input: &DownloadAudioInput) -> Result<(), String> {
    // Read the file for metadata
    let mut tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open file for metadata: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file for metadata: {}", e))?;

    // Get or create primary tag
    let tag = match tagged_file.primary_tag_mut() {
        Some(tag) => tag,
        None => {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(lofty::Tag::new(tag_type));
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
    if let Some(album_artist) = &input.album_artist {
        // Fallback: insert album artist as a text item so it works across tag types
        use lofty::ItemKey;
        tag.insert_text(ItemKey::AlbumArtist, album_artist.clone());
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
                Err(e) => {
                    eprintln!("Failed to download cover: {}", e);
                }
            }
        }
    }

    // Save the metadata
    tag.save_to_path(path)
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
