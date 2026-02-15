// Directory walking and file discovery
use std::path::Path;
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["flac", "mp3", "wav", "ogg", "m4a", "aac"];

pub struct ScanResult {
    pub audio_files: Vec<String>,
    pub total_scanned: usize,
    pub errors: Vec<String>,
}

pub fn scan_directory(path: &str) -> ScanResult {
    let mut audio_files = Vec::new();
    let mut errors = Vec::new();
    let mut total_scanned = 0;

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
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

fn is_supported_audio_file(path: &Path) -> bool {
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
        assert!(is_supported_audio_file(Path::new("song.aac"))); // Added test for AAC
        assert!(is_supported_audio_file(Path::new("song.AAC"))); // Added test for uppercase AAC
        assert!(!is_supported_audio_file(Path::new("song.mp4")));
        assert!(!is_supported_audio_file(Path::new("song.txt")));
    }
}
