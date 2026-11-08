// Directory walking and file discovery
use std::path::Path;
use walkdir::WalkDir;

// only containers symphonia can demux with the features in Cargo.toml
// formats without a decoder (ape, wv, mpc, spx, wma, dsf...) are left out on purpose
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    // mpeg audio
    "mp3", "mp2", "mp1",
    // lossless
    "flac", "alac", "wav", "wave", "aiff", "aif", "aifc", "afc", "caf",
    // ogg family
    "ogg", "oga", "opus",
    // mp4 family
    "m4a", "m4b", "m4p", "m4r", "mp4", "mov",
    // raw adts
    "aac",
    // matroska audio and webm
    "mka", "webm",
];

pub struct ScanResult {
    pub audio_files: Vec<String>,
    pub total_scanned: usize,
    pub errors: Vec<String>,
}

pub fn scan_directory(path: &str) -> ScanResult {
    let mut audio_files = Vec::new();
    let mut errors = Vec::new();
    let mut total_scanned = 0;

    for entry in WalkDir::new(path).follow_links(true) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                // unreadable dir or file, link loop...
                tracing::warn!("[SCAN] walk error: {}", e);
                errors.push(format!("Walk error: {}", e));
                continue;
            }
        };
        let path = entry.path();
        
        if path.is_file() {
            total_scanned += 1;
            
            if is_supported_audio_file(path) {
                match path.to_str() {
                    Some(path_str) => audio_files.push(path_str.to_string()),
                    None => errors.push(format!("Invalid path encoding: {:?}", path)),
                }
            }
        }
    }

    ScanResult {
        audio_files,
        total_scanned,
        errors,
    }
}

pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_supported_audio_file() {
        assert!(is_supported_audio_file(Path::new("song.flac")));
        assert!(is_supported_audio_file(Path::new("song.FLAC")));
        assert!(is_supported_audio_file(Path::new("song.mp3")));
        assert!(is_supported_audio_file(Path::new("song.wav")));
        assert!(is_supported_audio_file(Path::new("song.ogg")));
        assert!(is_supported_audio_file(Path::new("song.m4a")));
        assert!(is_supported_audio_file(Path::new("song.M4A")));
        assert!(is_supported_audio_file(Path::new("song.aac")));
        assert!(is_supported_audio_file(Path::new("song.AAC")));
        assert!(is_supported_audio_file(Path::new("song.alac")));
        assert!(is_supported_audio_file(Path::new("song.ALAC")));
        for ext in ["mp2", "mp1", "wave", "aiff", "AIF", "aifc", "caf", "oga", "m4b", "mp4", "mov", "mka", "webm"] {
            assert!(is_supported_audio_file(Path::new(&format!("song.{ext}"))), "{ext}");
        }
        for ext in ["txt", "jpg", "cue", "m3u", "ape", "wv", "wma", "mkv"] {
            assert!(!is_supported_audio_file(Path::new(&format!("song.{ext}"))), "{ext}");
        }
        assert!(!is_supported_audio_file(Path::new("noext")));
    }
}
