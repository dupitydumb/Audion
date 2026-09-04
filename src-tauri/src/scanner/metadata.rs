// Audio metadata extraction using lofty
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::mp4::{Mp4Codec, Mp4File, AtomIdent, AtomData};
use lofty::tag::Tag as LoftyTag;
use lofty::config::{ParseOptions, ParsingMode};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::default::get_probe;

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

/// probe a file's duration using Symphonia
/// fallback when lofty returns zero duration due to our patch
fn get_duration_via_symphonia(path: &Path) -> i32 {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 0,
    };

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format = match get_probe().probe(
        &hint,
        mss,
        FormatOptions::default(),
        MetadataOptions::default(),
    ) {
        Ok(f) => f,
        Err(_) => return 0,
    };

    let track = match format.default_track(symphonia::core::formats::TrackType::Audio) {
        Some(t) => t,
        None => return 0,
    };

    if let (Some(tb), Some(d)) = (track.time_base, track.duration) {
        use symphonia::core::units::Timestamp;
        if let Some(time) = tb.calc_time(Timestamp::from(d.get() as i64)) {
            return time.as_secs_f64() as i32;
        }
    }

    0
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
            // Check if it's a FLAC or ALAC file that failed
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                match ext.to_lowercase().as_str() {
                    "flac" => {
                        eprintln!(
                            "[Scanner] Lofty failed for FLAC {:?}: {}. Trying metaflac fallback...",
                            path, e
                        );
                        return extract_flac_metadata_fallback(path, None);
                    }
                    "alac" => {
                        // Lofty doesn't recognise .alac extension so we open directly
                        // as an MP4 container
                        eprintln!(
                            "[Scanner] Lofty failed for ALAC {:?}: {}. Trying Mp4File fallback...",
                            path, e
                        );
                        return extract_alac_metadata_fallback(path);
                    }
                    _ => {}
                }
            }
    
            eprintln!(
                "[Scanner] Failed to read audio file {:?}: {}. Returning fallback.",
                path, e
            );
            return Some(create_fallback_metadata(path));
        }
    };

    let properties = tagged_file.properties();
    // lofty returns zero duration for VBR MP3s without a Xing header (our patched
    // lofty skips the slow backwards file scan in that case)
    // WAV files also get the Symphonia path since lofty can misidentify them as MPEG
    let duration = {
        let lofty_duration = properties.duration().as_secs() as i32;
        if lofty_duration == 0 {
            get_duration_via_symphonia(path)
        } else {
            lofty_duration
        }
    };
    let bitrate = properties.audio_bitrate().map(|b| b as i32);
    let format = {
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
    
        match ext.as_str() {
            "m4a" | "m4b" | "m4p" | "mp4" | "alac" => {
                std::fs::File::open(path)
                    .ok()
                    .and_then(|mut f| {
                        Mp4File::read_from(
                            &mut f,
                            ParseOptions::new().parsing_mode(ParsingMode::Relaxed)
                        ).ok()
                    })
                    .map(|mp4| match mp4.properties().codec() {
                        Mp4Codec::ALAC => "ALAC".to_string(),
                        Mp4Codec::AAC  => "AAC".to_string(),
                        Mp4Codec::FLAC => "FLAC".to_string(),
                        Mp4Codec::MP3  => "MP3".to_string(),
                        _              => "Mp4".to_string(),
                    })
            }
            _ => Some(format!("{:?}", tagged_file.file_type())),
        }
    };

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
            // album artist tag => the raw, unsplit display string
            // only used when AlbumArtistMode::TagIfPresent is active (see commands::app_settings)
            let album_artist = tag.get_string(ItemKey::AlbumArtist).map(|s| s.to_string());

            // Extract track number, handling both simple numbers and "X/Y" format
            let track_number = tag.track().map(|n| n as i32).or_else(|| {
                // If tag.track() fails, try to parse track number from text
                tag.get_string(ItemKey::TrackNumber).and_then(|s| {
                    // Handle "1/19" format - take only the first number
                    s.split('/')
                        .next()
                        .and_then(|num| num.trim().parse::<i32>().ok())
                })
            });

            // Extract disc number
            let disc_number = tag.disk().map(|n| n as i32).or_else(|| {
                tag.get_string(ItemKey::DiscNumber).and_then(|s| {
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
                .get_string(ItemKey::MusicBrainzTrackId)
                .map(|s| s.to_string());

            // Extract all available metadata keys into JSON
            let metadata_json = collect_all_metadata(tag);

            Some(TrackInsert {
                path: path.to_string_lossy().to_string(),
                title,
                artist,
                album,
                album_artist,
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
        ItemKey::UnsyncLyrics, // added in lofty 0.23.0 . both of them are viable hence both of them are kept
        ItemKey::Conductor,
        ItemKey::Language,
        ItemKey::Publisher,
        ItemKey::EncoderSettings,
    ];

    for key in keys {
        let key_name = format!("{:?}", key);
        if let Some(val) = tag.get_string(key) {
            metadata.insert(key_name, Value::String(val.to_string()));
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
        album_artist: None,
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

fn extract_alac_metadata_fallback(path: &Path) -> Option<TrackInsert> {
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[Scanner] Failed to open ALAC file {:?}: {}", path, e);
            return Some(create_fallback_metadata(path));
        }
    };

    let mp4 = match Mp4File::read_from(&mut file, ParseOptions::new().parsing_mode(ParsingMode::Relaxed)) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[Scanner] Mp4File fallback also failed for {:?}: {}", path, e);
            return Some(create_fallback_metadata(path));
        }
    };

    let properties = mp4.properties();
    let duration = Some(properties.duration().as_secs() as i32);
    let bitrate = Some(properties.audio_bitrate() as i32).filter(|&b| b > 0);
    let format = Some("ALAC".to_string());

    let ilst = mp4.ilst();

    let title = ilst
        .and_then(|t| t.title().map(|s| s.to_string()))
        .or_else(|| get_filename_without_ext(path));
    let artist = ilst.and_then(|t| t.artist().map(|s| s.to_string()));
    let album = ilst.and_then(|t| t.album().map(|s| s.to_string()));
    // Ilst's Accessor trait has no dedicated method for it
    // so it's looked up by atom identifier directly (see commands::app_settings::AlbumArtistMode)
    let album_artist = ilst.and_then(|t| t.get(&AtomIdent::Fourcc(*b"aART"))).and_then(|atom| {
        atom.data().find_map(|d| match d {
            AtomData::UTF8(s) | AtomData::UTF16(s) => Some(s.clone()),
            _ => None,
        })
    });
    let track_number = ilst.and_then(|t| t.track()).map(|n| n as i32);
    let disc_number  = ilst.and_then(|t| t.disk()).map(|n| n as i32);

    let album_art = ilst.and_then(|t| {
        t.pictures().and_then(|mut iter| iter.next())
            .map(|p: &lofty::picture::Picture| p.data().to_vec())
    });

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
        // ALAC/MP4 fallback path
        // falls back to first track wins album artist behavior
        album_artist,
        album,
        track_number,
        disc_number,
        duration,
        album_art: album_art.clone(),
        track_cover: album_art,
        format,
        bitrate,
        source_type: None,
        cover_url: None,
        external_id: None,
        content_hash,
        local_src: None,
        musicbrainz_recording_id: None,
        metadata_json: None,
    })
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
            let album_artist = vorbis
                .and_then(|v| v.get("ALBUMARTIST").and_then(|a| a.get(0).cloned()));
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
                album_artist,
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
