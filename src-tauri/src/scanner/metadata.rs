// Audio metadata extraction using lofty
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag as LoftyTag;
use lofty::config::{ParseOptions, ParsingMode};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use crate::db::queries::TrackInsert;

/// Generate a content hash based on metadata for duplicate detection
fn generate_content_hash(
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<i32>,
) -> String {
    let mut hasher = DefaultHasher::new();

    // Normalize and hash metadata fields
    let title_normalized = title.unwrap_or("").trim().to_lowercase();
    let artist_normalized = artist.unwrap_or("").trim().to_lowercase();
    let album_normalized = album.unwrap_or("").trim().to_lowercase();
    let duration_str = duration.map(|d| d.to_string()).unwrap_or_default();

    // Create a combined string for hashing
    let combined = format!(
        "{}|{}|{}|{}",
        title_normalized, artist_normalized, album_normalized, duration_str
    );

    combined.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn extract_metadata(path: &str) -> Option<TrackInsert> {
    let path = Path::new(path);

    // Try to read the file
    // Try to read the file with default options first
    let tagged_file_result = Probe::open(path)
    .and_then(|probe| {
        probe
            .options(ParseOptions::new().parsing_mode(ParsingMode::Relaxed))
            .read()
    });

    let tagged_file = match tagged_file_result {
        Ok(file) => file,
        Err(e) => {
            // Check if it's a FLAC file that failed
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if ext.to_lowercase() == "flac" {
                    eprintln!(
                        "[Scanner] Lofty failed for FLAC {:?}: {}. Trying metaflac fallback...",
                        path, e
                    );
                    return extract_flac_metadata_fallback(path, None);
                }
            }

            // Try relaxed parsing as a general fallback
            match Probe::open(path) {
                Ok(mut probe) => {
                    // Configure allowed tag types to be more permissive if possible,
                    // but lofty's read() is already quite permissive.
                    // We can try to explicitly specific options if the API allows,
                    // but for now we'll rely on the specific FLAC fallback.
                    eprintln!(
                        "[Scanner] Failed to read audio file {:?}: {}. Returning fallback.",
                        path, e
                    );
                    return Some(create_fallback_metadata(path));
                }
                Err(e) => {
                    eprintln!(
                        "[Scanner] Failed to open audio file {:?}: {}. Returning fallback.",
                        path, e
                    );
                    return Some(create_fallback_metadata(path));
                }
            }
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

            // Extract track number, handling both simple numbers and "X/Y" format
            let track_number = tag.track().map(|n| n as i32).or_else(|| {
                // If tag.track() fails, try to parse track number from text
                tag.get_string(&ItemKey::TrackNumber).and_then(|s| {
                    // Handle "1/19" format - take only the first number
                    s.split('/')
                        .next()
                        .and_then(|num| num.trim().parse::<i32>().ok())
                })
            });

            // Extract disc number
            let disc_number = tag.disk().map(|n| n as i32).or_else(|| {
                tag.get_string(&ItemKey::DiscNumber).and_then(|s| {
                    // Handle "1/2" format
                    s.split('/')
                        .next()
                        .and_then(|num| num.trim().parse::<i32>().ok())
                })
            });

            // Extract album art as raw bytes (NOT base64)
            let album_art = tag.pictures().first().map(|pic| pic.data().to_vec());

            // Extract track cover as raw bytes (same as album art, but stored per-track)
            let track_cover = tag.pictures().first().map(|pic| pic.data().to_vec());

            // Generate content hash for duplicate detection
            let content_hash = Some(generate_content_hash(
                title.as_deref(),
                artist.as_deref(),
                album.as_deref(),
                Some(duration),
            ));

            // Extract MusicBrainz Recording ID for ListenBrainz matching
            let musicbrainz_recording_id = tag
                .get_string(&ItemKey::MusicBrainzTrackId)
                .map(|s| s.to_string());

            // Extract all available metadata keys into JSON
            let metadata_json = collect_all_metadata(tag);

            Some(TrackInsert {
                path: path.to_string_lossy().to_string(),
                title,
                artist,
                album,
                track_number,
                disc_number,
                duration: Some(duration),
                album_art,
                track_cover,
                format,
                bitrate,
                source_type: None, // Local file
                cover_url: None,
                external_id: None,
                content_hash,
                local_src: None,
                musicbrainz_recording_id,
                metadata_json,
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
                Some(duration),
            ));
            Some(track)
        }
    }
}

fn collect_all_metadata(tag: &LoftyTag) -> Option<String> {
    use serde_json::{Map, Value};
    let mut metadata = Map::new();

    // Standard Lofty keys to extract
    let keys = [
        ItemKey::TrackTitle,
        ItemKey::TrackArtist,
        ItemKey::AlbumTitle,
        ItemKey::AlbumArtist,
        ItemKey::Composer,
        ItemKey::Genre,
        ItemKey::TrackNumber,
        ItemKey::TrackTotal,
        ItemKey::DiscNumber,
        ItemKey::DiscTotal,
        ItemKey::Year,
        ItemKey::Bpm,
        ItemKey::Isrc,
        ItemKey::Label,
        ItemKey::CatalogNumber,
        ItemKey::Comment,
        ItemKey::Lyrics,
        ItemKey::Conductor,
        ItemKey::Language,
        ItemKey::Publisher,
        ItemKey::EncoderSettings,
    ];

    for key in keys {
        if let Some(val) = tag.get_string(&key) {
            metadata.insert(format!("{:?}", key), Value::String(val.to_string()));
        }
    }

    if metadata.is_empty() {
        return None;
    }

    serde_json::to_string(&metadata).ok()
}

fn create_fallback_metadata(path: &Path) -> TrackInsert {
    TrackInsert {
        path: path.to_string_lossy().to_string(),
        title: get_filename_without_ext(path),
        artist: None,
        album: None,
        track_number: None,
        disc_number: None,
        duration: None,
        album_art: None,
        track_cover: None,
        format: None,
        bitrate: None,
        source_type: None, // Local file
        cover_url: None,
        external_id: None,
        content_hash: None, // Will be set later with duration
        local_src: None,
        musicbrainz_recording_id: None,
        metadata_json: None,
    }
}

fn get_filename_without_ext(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn extract_flac_metadata_fallback(path: &Path, _duration_hint: Option<i32>) -> Option<TrackInsert> {
    use metaflac::Tag;

    // We still need the format
    let format = Some("Flac".to_string());

    match Tag::read_from_path(path) {
        Ok(tag) => {
            let vorbis = tag.vorbis_comments();

            let title = vorbis
                .and_then(|v| v.title().map(|s| s[0].clone()))
                .or_else(|| get_filename_without_ext(path));
            let artist = vorbis.and_then(|v| v.artist().map(|s| s[0].clone()));
            let album = vorbis.and_then(|v| v.album().map(|s| s[0].clone()));
            let track_number = vorbis.and_then(|v| v.track().map(|n| n as i32));
            let disc_number =
                vorbis.and_then(|v| v.get("DISCNUMBER").and_then(|d| d[0].parse::<i32>().ok()));

            // Extract picture
            let album_art = tag.pictures().next().map(|p| p.data.clone());

            // Calculate duration from StreamInfo
            let duration = tag
                .get_streaminfo()
                .map(|si| {
                    if si.sample_rate > 0 {
                        (si.total_samples / si.sample_rate as u64) as i32
                    } else {
                        0
                    }
                })
                .or(_duration_hint);

            // Generate content hash
            let content_hash = Some(generate_content_hash(
                title.as_deref(),
                artist.as_deref(),
                album.as_deref(),
                duration,
            ));

            Some(TrackInsert {
                path: path.to_string_lossy().to_string(),
                title,
                artist,
                album,
                track_number,
                disc_number,
                duration,
                album_art: album_art.clone(),
                track_cover: album_art, // Use same art for track cover
                format,
                bitrate: None, // Hard to get bitrate without decoding
                source_type: None,
                cover_url: None,
                external_id: None,
                content_hash: content_hash,
                local_src: None,
                musicbrainz_recording_id: None,
                metadata_json: None,
            })
        }
        Err(e) => {
            eprintln!("[Scanner] Metaflac also failed for {:?}: {}", path, e);
            let mut track = create_fallback_metadata(path);
            track.duration = _duration_hint; // Use hint if available (probably None)
            track.format = format;
            track.content_hash = Some(generate_content_hash(
                track.title.as_deref(),
                track.artist.as_deref(),
                track.album.as_deref(),
                track.duration,
            ));
            Some(track)
        }
    }
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
