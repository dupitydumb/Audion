use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Get LRC file path for a music file or URL
fn resolve_lrc_path(app: &AppHandle, music_path: &str) -> PathBuf {
    // Check if it's a real local file that exists
    if let Ok(metadata) = fs::metadata(music_path) {
        if metadata.is_file() {
            let path = PathBuf::from(music_path);
            return path.with_extension("lrc");
        }
    }

    // For URLs, custom protocols (tidal:), or invalid paths, use cache
    let mut hasher = DefaultHasher::new();
    music_path.hash(&mut hasher);
    let hash = hasher.finish();

    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let lyrics_dir = app_dir.join("lyrics");

    // Ensure lyrics directory exists
    let _ = fs::create_dir_all(&lyrics_dir);

    lyrics_dir.join(format!("{}.lrc", hash))
}

/// Save LRC file alongside music file or in cache for streams
#[tauri::command]
pub fn save_lrc_file(
    app: AppHandle,
    music_path: String,
    lrc_content: String,
) -> Result<(), String> {
    let lrc_path = resolve_lrc_path(&app, &music_path);

    fs::write(&lrc_path, lrc_content).map_err(|e| format!("Failed to save LRC file: {}", e))?;

    Ok(())
}

/// Load LRC file if it exists
#[tauri::command]
pub fn load_lrc_file(app: AppHandle, music_path: String) -> Result<Option<String>, String> {
    let lrc_path = resolve_lrc_path(&app, &music_path);

    if !lrc_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&lrc_path).map_err(|e| format!("Failed to read LRC file: {}", e))?;

    Ok(Some(content))
}

/// Delete LRC file for a music file
#[tauri::command]
pub fn delete_lrc_file(app: AppHandle, music_path: String) -> Result<bool, String> {
    let lrc_path = resolve_lrc_path(&app, &music_path);

    if !lrc_path.exists() {
        return Ok(false);
    }

    fs::remove_file(&lrc_path).map_err(|e| format!("Failed to delete LRC file: {}", e))?;
    Ok(true)
}

/// Proxy request to Musixmatch API to avoid CORS issues
#[tauri::command]
pub async fn musixmatch_request(
    action: String,
    params: Vec<(String, String)>,
) -> Result<String, String> {
    // Build a client with cookie store and proper redirect policy
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let url = format!("https://apic-desktop.musixmatch.com/ws/1.1/{}", action);

    // Build query string
    let mut query_params: Vec<(String, String)> = params;
    query_params.push(("app_id".to_string(), "web-desktop-app-v1.0".to_string()));
    query_params.push((
        "t".to_string(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string(),
    ));

    let response = client
        .get(&url)
        .query(&query_params)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Origin", "https://www.musixmatch.com")
        .header("Referer", "https://www.musixmatch.com/")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(text)
}

/// Word timing structure for JSON serialization
#[derive(serde::Serialize, Clone)]
pub struct WordTimingJson {
    word: String,
    time: f64,
    end_time: f64,
}

/// Lyric line structure for JSON serialization
#[derive(serde::Serialize)]
pub struct LyricLineJson {
    time: f64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<Vec<WordTimingJson>>,
}

/// Current lyric structure for JSON serialization
#[derive(serde::Serialize)]
pub struct CurrentLyricJson {
    index: usize,
    time: f64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<Vec<WordTimingJson>>,
}

/// Parse LRC timestamp format [mm:ss.xx] or [mm:ss]
fn parse_timestamp(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let minutes: f64 = parts[0].parse().ok()?;
    let seconds_parts: Vec<&str> = parts[1].split('.').collect();
    let seconds: f64 = seconds_parts[0].parse().ok()?;
    let centiseconds: f64 = if seconds_parts.len() > 1 {
        let cs_str = seconds_parts[1];
        let padded = format!("{:0<2}", cs_str);
        padded.parse().unwrap_or(0.0)
    } else {
        0.0
    };

    Some(minutes * 60.0 + seconds + centiseconds / 100.0)
}

/// Parse LRC content into structured format
fn parse_lrc_content(lrc_content: &str) -> Vec<LyricLineJson> {
    let mut lyrics = Vec::new();

    for line in lrc_content.lines() {
        // Parse timestamp: [mm:ss.xx] or [mm:ss]
        if !line.starts_with('[') {
            continue;
        }

        let close_bracket = match line.find(']') {
            Some(pos) => pos,
            None => continue,
        };

        let timestamp = &line[1..close_bracket];
        let text = line[close_bracket + 1..].trim();

        if text.is_empty() {
            continue;
        }

        let time = match parse_timestamp(timestamp) {
            Some(t) => t,
            None => continue,
        };

        // Parse word-level timing: <mm:ss.xx>word
        let mut words = Vec::new();
        let mut clean_text = String::new();
        let mut i = 0;
        let text_chars: Vec<char> = text.chars().collect();

        while i < text_chars.len() {
            if text_chars[i] == '<' {
                // Try to parse word timing
                i += 1;
                let mut timestamp_buf = String::new();
                let mut found_close = false;

                while i < text_chars.len() {
                    if text_chars[i] == '>' {
                        found_close = true;
                        i += 1;
                        break;
                    }
                    timestamp_buf.push(text_chars[i]);
                    i += 1;
                }

                if found_close {
                    if let Some(word_time) = parse_timestamp(&timestamp_buf) {
                        // Collect the word until next '<' or end
                        let mut word_buf = String::new();
                        while i < text_chars.len() && text_chars[i] != '<' {
                            word_buf.push(text_chars[i]);
                            i += 1;
                        }

                        let word = word_buf.trim();
                        if !word.is_empty() {
                            words.push(WordTimingJson {
                                word: word.to_string(),
                                time: word_time,
                                end_time: 0.0,
                            });
                            clean_text.push_str(word);
                            clean_text.push(' ');
                        }
                    }
                } else {
                    clean_text.push('<');
                    clean_text.push_str(&timestamp_buf);
                }
            } else {
                if words.is_empty() {
                    clean_text.push(text_chars[i]);
                }
                i += 1;
            }
        }

        // Calculate end times for words
        for j in 0..words.len() {
            if j < words.len() - 1 {
                words[j].end_time = words[j + 1].time;
            } else {
                words[j].end_time = words[j].time + 0.5;
            }
        }

        let final_text = if words.is_empty() {
            text.to_string()
        } else {
            clean_text.trim().to_string()
        };

        lyrics.push(LyricLineJson {
            time,
            text: final_text,
            words: if words.is_empty() { None } else { Some(words) },
        });
    }

    // Sort by time
    lyrics.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());
    lyrics
}

/// Get all lyrics for a music file
#[tauri::command]
pub fn get_lyrics(
    app: AppHandle,
    music_path: String,
) -> Result<Option<Vec<LyricLineJson>>, String> {
    let lrc_path = resolve_lrc_path(&app, &music_path);

    if !lrc_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&lrc_path).map_err(|e| format!("Failed to read LRC file: {}", e))?;

    let lyrics = parse_lrc_content(&content);

    Ok(Some(lyrics))
}

/// Get current lyric line based on playback time
#[tauri::command]
pub fn get_current_lyric(
    app: AppHandle,
    music_path: String,
    current_time: f64,
) -> Result<Option<CurrentLyricJson>, String> {
    let lrc_path = resolve_lrc_path(&app, &music_path);

    if !lrc_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&lrc_path).map_err(|e| format!("Failed to read LRC file: {}", e))?;

    let lyrics = parse_lrc_content(&content);

    if lyrics.is_empty() {
        return Ok(None);
    }

    // Find the active line (last line with time <= current_time)
    let mut active_index = None;
    for (i, line) in lyrics.iter().enumerate() {
        if line.time <= current_time {
            active_index = Some(i);
        } else {
            break;
        }
    }

    if let Some(index) = active_index {
        let line = &lyrics[index];
        Ok(Some(CurrentLyricJson {
            index,
            time: line.time,
            text: line.text.clone(),
            words: line.words.clone(),
        }))
    } else {
        Ok(None)
    }
}
