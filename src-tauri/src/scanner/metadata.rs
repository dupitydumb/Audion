// Audio metadata extraction using lofty
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{Accessor, AudioFile, ItemKey, Probe, TaggedFileExt};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use crate::db::queries::TrackInsert;

/// Generate a content hash based on metadata for duplicate detection
fn generate_content_hash(
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    album_artist: Option<&str>,
    duration: Option<i32>,
) -> String {
    let mut hasher = DefaultHasher::new();

    // Normalize and hash metadata fields
    let title_normalized = title.unwrap_or("").trim().to_lowercase();
    let artist_normalized = artist.unwrap_or("").trim().to_lowercase();
    let album_normalized = album.unwrap_or("").trim().to_lowercase();
    let album_artist_normalized = album_artist.unwrap_or("").trim().to_lowercase();
    let duration_str = duration.map(|d| d.to_string()).unwrap_or_default();

    // Create a combined string for hashing
    let combined = format!(
        "{}|{}|{}|{}|{}",
        title_normalized,
        artist_normalized,
        album_normalized,
        album_artist_normalized,
        duration_str
    );

    combined.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn extract_metadata(path: &str) -> Option<TrackInsert> {
    let path = Path::new(path);

    // Try to read the file
    let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("Failed to read audio file {:?}: {}", path, e);
            return Some(create_fallback_metadata(path));
        }
    };

    let properties = tagged_file.properties();
    let duration = properties.duration().as_secs() as i32;
    let bitrate = properties.audio_bitrate().map(|b| b as i32);
    let format = Some(format!("{:?}", tagged_file.file_type()));

    // Try to get tags
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    match tag {
        Some(tag) => {
            let title = tag
                .title()
                .map(|s| s.to_string())
                .or_else(|| get_filename_without_ext(path));
            let artist = tag.artist().map(|s| s.to_string());
            let album = tag.album().map(|s| s.to_string());
            let album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
            let track_number = tag.track().map(|n| n as i32);

            // Extract album art
            let album_art = tag
                .pictures()
                .first()
                .map(|pic| STANDARD.encode(pic.data()));

            // Generate content hash for duplicate detection
            let content_hash = Some(generate_content_hash(
                title.as_deref(),
                artist.as_deref(),
                album.as_deref(),
                album_artist.as_deref(),
                Some(duration),
            ));

            Some(TrackInsert {
                path: path.to_string_lossy().to_string(),
                title,
                artist,
                album,
                album_artist,
                track_number,
                duration: Some(duration),
                album_art,
                format,
                bitrate,
                source_type: None, // Local file
                cover_url: None,
                external_id: None,
                content_hash,
            })
        }
        None => {
            // No tags found, use fallback
            let mut track = create_fallback_metadata(path);
            track.duration = Some(duration);
            track.format = format;
            track.bitrate = bitrate;
            // Generate content hash for fallback
            track.content_hash = Some(generate_content_hash(
                track.title.as_deref(),
                track.artist.as_deref(),
                track.album.as_deref(),
                track.album_artist.as_deref(),
                Some(duration),
            ));
            Some(track)
        }
    }
}

fn create_fallback_metadata(path: &Path) -> TrackInsert {
    TrackInsert {
        path: path.to_string_lossy().to_string(),
        title: get_filename_without_ext(path),
        artist: None,
        album: None,
        album_artist: None,
        track_number: None,
        duration: None,
        album_art: None,
        format: None,
        bitrate: None,
        source_type: None, // Local file
        cover_url: None,
        external_id: None,
        content_hash: None, // Will be set later with duration
    }
}

fn get_filename_without_ext(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_filename_without_ext() {
        assert_eq!(
            get_filename_without_ext(Path::new("/music/song.flac")),
            Some("song".to_string())
        );
        assert_eq!(
            get_filename_without_ext(Path::new("artist - track.mp3")),
            Some("artist - track".to_string())
        );
    }
}
