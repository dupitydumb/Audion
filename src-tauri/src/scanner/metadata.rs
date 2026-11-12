// Audio metadata extraction using lofty
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::mp4::{Mp4Codec, Mp4File, AtomIdent, AtomData};
use lofty::tag::Tag as LoftyTag;
use lofty::config::{ParseOptions, ParsingMode};
use sha2::{Digest, Sha256};
use std::path::Path;

use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::default::get_probe;

use crate::db::queries::TrackInsert;

/// Generate a content hash based on metadata for duplicate detection
pub(crate) fn generate_content_hash(
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<i32>,
) -> String {
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

    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    let result = hasher.finalize();
    format!("{:016x}", u64::from_be_bytes(result[..8].try_into().unwrap()))
}

// full symphonia scan for files lofty can't read
// tags, cover art, duration and bitrate all come from the demuxer
fn extract_metadata_symphonia(path: &Path) -> Result<TrackInsert, String> {
    use symphonia::core::formats::TrackType;
    use symphonia::core::meta::{RawValue, StandardTag, StandardVisualKey};
    use symphonia::core::units::Timestamp;

    let file = std::fs::File::open(path).map_err(|e| format!("open failed: {}", e))?;
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    let mut hint = Hint::new();
    if let Some(ref ext) = ext {
        hint.with_extension(ext);
    }

    let mut format = get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| format!("probe failed: {}", e))?;

    let (track_id, time_base, header_duration) = match format.default_track(TrackType::Audio) {
        Some(t) => (t.id, t.time_base, t.duration),
        None => return Err("no audio track".to_string()),
    };
    let mut duration = match (time_base, header_duration) {
        (Some(tb), Some(d)) => tb
            .calc_time(Timestamp::from(d.get() as i64))
            .map(|t| t.as_secs_f64() as i32)
            .unwrap_or(0),
        _ => 0,
    };

    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut album_artist = None;
    let mut track_number = None;
    let mut disc_number = None;
    let mut genre = None;
    let mut composer = None;
    let mut musicbrainz_recording_id = None;
    let mut cover: Option<Vec<u8>> = None;
    let mut raw_pairs: Vec<(String, String)> = Vec::new();

    {
        let metadata = format.metadata();
        if let Some(rev) = metadata.current() {
            let per_track = rev.per_track.iter().map(|p| &p.metadata.tags);
            for tag in rev.media.tags.iter().chain(per_track.flatten()) {
                match &tag.std {
                    Some(StandardTag::TrackTitle(s)) if title.is_none() => {
                        title = Some(s.to_string())
                    }
                    Some(StandardTag::Artist(s)) if artist.is_none() => {
                        artist = Some(s.to_string())
                    }
                    Some(StandardTag::Album(s)) if album.is_none() => album = Some(s.to_string()),
                    Some(StandardTag::AlbumArtist(s)) if album_artist.is_none() => {
                        album_artist = Some(s.to_string())
                    }
                    Some(StandardTag::TrackNumber(n)) if track_number.is_none() => {
                        track_number = Some(*n as i32)
                    }
                    Some(StandardTag::DiscNumber(n)) if disc_number.is_none() => {
                        disc_number = Some(*n as i32)
                    }
                    Some(StandardTag::Genre(s)) if genre.is_none() => genre = Some(s.to_string()),
                    Some(StandardTag::Composer(s)) if composer.is_none() => {
                        composer = Some(s.to_string())
                    }
                    Some(StandardTag::MusicBrainzRecordingId(s))
                        if musicbrainz_recording_id.is_none() =>
                    {
                        musicbrainz_recording_id = Some(s.to_string())
                    }
                    _ => {}
                }
                // matroska keys come namespaced (ALBUM@ARTIST) and not always mapped
                if let RawValue::String(v) = &tag.raw.value {
                    let key = tag.raw.key.rsplit('@').next().unwrap_or("").to_uppercase();
                    raw_pairs.push((key, v.to_string()));
                }
            }

            // front cover first, otherwise whatever picture comes first
            cover = rev
                .media
                .visuals
                .iter()
                .find(|v| matches!(v.usage, Some(StandardVisualKey::FrontCover)))
                .or_else(|| rev.media.visuals.first())
                .map(|v| v.data.to_vec());
        }
    }

    let leading_int = |v: &str| v.split('/').next().and_then(|n| n.trim().parse::<i32>().ok());
    for (key, v) in raw_pairs {
        match key.as_str() {
            "TITLE" if title.is_none() => title = Some(v),
            "ARTIST" if artist.is_none() => artist = Some(v),
            "ALBUM" if album.is_none() => album = Some(v),
            "ALBUMARTIST" | "ALBUM_ARTIST" if album_artist.is_none() => album_artist = Some(v),
            "PART_NUMBER" | "TRACKNUMBER" | "TRACK" if track_number.is_none() => {
                track_number = leading_int(&v)
            }
            "DISCNUMBER" | "DISC" if disc_number.is_none() => disc_number = leading_int(&v),
            "GENRE" if genre.is_none() => genre = Some(v),
            "COMPOSER" if composer.is_none() => composer = Some(v),
            _ => {}
        }
    }
    if artist.is_none() {
        artist = album_artist.clone();
    }

    // matroska has no track duration => sum packet lengths without decoding
    if duration == 0 {
        if let Some(tb) = time_base {
            let mut end = 0i64;
            while let Ok(Some(pkt)) = format.next_packet() {
                if pkt.track_id == track_id {
                    end = end.max(pkt.pts.get() + pkt.dur.get() as i64);
                }
            }
            // packet sums undershoot slightly => round instead of truncate
            duration = tb
                .calc_time(Timestamp::from(end))
                .map(|t| t.as_secs_f64().round() as i32)
                .unwrap_or(0);
        }
    }
    let bitrate = if duration > 0 && file_len > 0 {
        Some((file_len * 8 / duration as u64 / 1000) as i32)
    } else {
        None
    };

    let title = title.or_else(|| get_filename_without_ext(path));

    // same key names as the lofty path so the json looks the same
    let mut json = serde_json::Map::new();
    for (key, val) in [
        ("TrackTitle", &title),
        ("TrackArtist", &artist),
        ("AlbumTitle", &album),
        ("AlbumArtist", &album_artist),
        ("Genre", &genre),
        ("Composer", &composer),
    ] {
        if let Some(v) = val {
            json.insert(key.to_string(), serde_json::Value::String(v.clone()));
        }
    }
    if let Some(n) = track_number {
        json.insert(
            "TrackNumber".to_string(),
            serde_json::Value::String(n.to_string()),
        );
    }
    if let Some(n) = disc_number {
        json.insert(
            "DiscNumber".to_string(),
            serde_json::Value::String(n.to_string()),
        );
    }
    let metadata_json = if json.is_empty() {
        None
    } else {
        serde_json::to_string(&json).ok()
    };

    let content_hash = Some(generate_content_hash(
        title.as_deref(),
        artist.as_deref(),
        album.as_deref(),
        Some(duration),
    ));

    Ok(TrackInsert {
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        album_artist,
        track_number,
        disc_number,
        duration: Some(duration),
        album_art: cover.clone(),
        track_cover: cover,
        format: ext.map(|e| e.to_uppercase()),
        bitrate,
        source_type: None,
        cover_url: None,
        external_id: None,
        content_hash,
        local_src: None,
        musicbrainz_recording_id,
        metadata_json,
        file_id: None, // stamped by the extract_metadata wrapper
        mtime: None,
        size: None,
    })
}

// last resort when lofty and the format specific fallbacks can't read a file
// a failure here means the file is reported as failed instead of imported
fn symphonia_or_fail(path: &Path, reason: &str) -> Option<TrackInsert> {
    match extract_metadata_symphonia(path) {
        Ok(track) => Some(track),
        Err(se) => {
            tracing::warn!(
                "[SCAN] failed to read {:?}: {}; symphonia: {}",
                path,
                reason,
                se
            );
            None
        }
    }
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

/// stat a path for its stable filesystem identity
/// mtime/size, used to populate TrackInsert::file_id/mtime/size
pub fn stat_identity(path: &Path) -> (Option<String>, Option<i64>, Option<i64>) {
    // FileId (device+inode / Windows file index) only guarantees Debug, not Display
    // format! gives a stable, equality-comparable key
    let file_id = file_id::get_file_id(path).ok().map(|id| format!("{id:?}"));

    let (mtime, size) = std::fs::metadata(path)
        .ok()
        .map(|meta| {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            (mtime, Some(meta.len() as i64))
        })
        .unwrap_or((None, None));

    (file_id, mtime, size)
}

/// extract tags/duration/etc. for a file,
/// then stamp on its current file_id/mtime/size in one place regardles of fallback path
pub fn extract_metadata(path: &str) -> Option<TrackInsert> {
    let path_ref = Path::new(path);
    let mut track = extract_metadata_inner(path);
    if let Some(track) = track.as_mut() {
        let (file_id, mtime, size) = stat_identity(path_ref);
        track.file_id = file_id;
        track.mtime = mtime;
        track.size = size;
    }
    track
}

fn extract_metadata_inner(path: &str) -> Option<TrackInsert> {
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
                "[Scanner] lofty failed to read {:?}: {}. Trying symphonia scan.",
                path, e
            );
            // lofty can't read this file (caf, mka, webm, broken tags...)
            // => full symphonia scan, only a failure there too counts as failed
            return symphonia_or_fail(path, &format!("lofty: {}", e));
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
                file_id: None, // stamped by the extract_metadata wrapper
                mtime: None,
                size: None,
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
        file_id: None,
        mtime: None,
        size: None,
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
            return symphonia_or_fail(path, &format!("alac open: {}", e));
        }
    };

    let mp4 = match Mp4File::read_from(&mut file, ParseOptions::new().parsing_mode(ParsingMode::Relaxed)) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[Scanner] Mp4File fallback also failed for {:?}: {}", path, e);
            return symphonia_or_fail(path, &format!("alac mp4: {}", e));
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
        file_id: None,
        mtime: None,
        size: None,
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
                file_id: None,
                mtime: None,
                size: None,
            })
        }
        Err(e) => {
            eprintln!("[Scanner] Metaflac also failed for {:?}: {}", path, e);
            symphonia_or_fail(path, &format!("metaflac: {}", e))
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
