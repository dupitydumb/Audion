// ---------------------------------------------------------------------------
// Apple Music JSON lyrics parser  (paxsenix / lyrics.paxsenix.org format)
// ---------------------------------------------------------------------------
//
// Input: the raw JSON string returned by GET /apple-music/lyrics?id=<id>
//        (the non-TTML variant : type = "Syllable")
//
// Output: Vec<AppleLyricLine> -> a fully structured, frontend-ready
//         representation that preserves every semantic the API provides:
//
//    Per-word timing with syllable merging  (part=true flag)
//    Line-level structure label             (Intro / Verse / Chorus / etc)
//    Opposite-turn flag                     (featured / secondary vocalist)
//    Background-vocal flag + separate timed word list  (backgroundText)
//
// The Tauri command `parse_apple_lyrics_json` is the public entry point.
// It is intentionally pure (no I/O) so it can be called immediately after
// the HTTP response is received, before caching.
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Raw deserialization types
// ---------------------------------------------------------------------------

/// A single syllable / token inside a line's `text` or `backgroundText` array.
#[derive(Deserialize)]
struct RawSyllable {
    text:      String,
    timestamp: u64,   // milliseconds from track start
    endtime:   u64,   // milliseconds
    // duration is derivable; ignored
    part:      bool,  // true = this syllable is NOT the last in its word
}

/// One lyric line from the `content` array.
#[derive(Deserialize)]
struct RawLine {
    timestamp:      u64,
    endtime:        u64,
    structure:      String,           // "Intro" | "Verse" | "PreChorus" | "Chorus" | "Bridge" | "Outro" | etc
    text:           Vec<RawSyllable>, // primary vocal syllables
    background:     bool,             // true = this line IS a background vocal
    #[serde(rename = "backgroundText")]
    background_text: Vec<RawSyllable>, // simultaneous background vocal syllables
    #[serde(rename = "oppositeTurn")]
    opposite_turn:  bool,             // true = secondary / featured vocalist
}

/// Top-level API response (we only need `content`; other fields are ignored).
#[derive(Deserialize)]
struct RawAppleResponse {
    content: Vec<RawLine>,
    // lrc, elrc, plain, ttmlContent, track, source etc all ignored here
}

// ---------------------------------------------------------------------------
// Output types  (serialized and sent to the frontend)
// ---------------------------------------------------------------------------

/// One syllable within a split word, with its own precise timing.
///
/// Only present on words where `is_split = true` (i.e. words that were
/// originally multiple `part=true` syllables in the API response).
/// For whole words this is absent (`syllables = None` on the parent).
///
/// `text`     : the raw syllable string exactly as it came from the API.
/// `time`     : syllable start in seconds.
/// `end_time` : syllable end in seconds.
/// `part`     : true = not the last syllable in the word.
#[derive(Serialize, Clone)]
pub struct AppleSyllable {
    pub text:     String,
    pub time:     f64,
    pub end_time: f64,
    pub part:     bool,
}

/// A single word (one or more merged syllables) with precise timing.
///
/// Syllables with `part = true` are folded so that e.g.
/// ["Bill"(part=true), "board"(part=false)] -> word "Billboard".
///
/// `time` and `end_time` are in **seconds** (f64)
#[derive(Serialize, Clone)]
pub struct AppleWordTiming {
    pub word:     String,
    pub time:     f64,
    pub end_time: f64,
    /// True when this word came from multiple syllables in the source data.
    pub is_split: bool,
    /// The individual syllables that make up this word, with their own
    /// precise per-syllable timing. None for whole words (single syllable).
    /// Some(vec) for split words : always has >= 2 entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub syllables: Option<Vec<AppleSyllable>>,
}

/// A fully parsed lyric line.
#[derive(Serialize)]
pub struct AppleLyricLine {
    /// Line start in seconds.
    pub time:     f64,
    /// Line end in seconds.
    pub end_time: f64,

    /// Assembled plain-text of the primary vocal (spaces between words,
    /// no space at syllable joins).  Used as fallback when word-sync
    /// rendering is disabled.
    pub text: String,

    /// Per-word timing for the primary vocal.  Always present for
    /// Apple Music JSON (every line has at least one syllable entry).
    pub words: Vec<AppleWordTiming>,

    /// Song section label.  Empty string if absent.
    pub structure: String,

    /// True when this line belongs to a secondary / featured vocalist.
    /// Frontend renders it in a different style (right-aligned, italic)
    pub opposite_turn: bool,

    /// True when this line is itself a background vocal.
    /// Frontend renders it dimmer / in parentheses.
    pub is_background: bool,

    /// Background vocals that overlap with this line, with their own
    /// per-word timing.  Empty when there are no simultaneous BG vocals.
    /// Frontend renders these inline at a reduced opacity alongside the
    /// primary text.
    pub background_words: Vec<AppleWordTiming>,

    /// Assembled plain-text of the background vocal (same purpose as
    /// `text` but for `background_words`).  Empty when no BG vocal.
    pub background_text: String,
}

// ---------------------------------------------------------------------------
// Syllable -> word merging
// ---------------------------------------------------------------------------

/// Convert a slice of raw API syllables into merged `AppleWordTiming` entries.
///
/// The `part` flag means "I am NOT the last syllable of my word; concatenate
/// the next syllable onto me without a space."
///
/// Examples from the API:
///   ["Bill"(part=true), "board"(part=false)]  :  "Billboard"
///   ["Ba"(part=true),   "by,"(part=false)]    :  "Baby,"
///   ["Du"(part=true),   "a"(part=false)]      :  "Dua"
///   ["Li"(part=true),   "pa"(part=false)]     :  "Lipa"
///   ["make"(part=false)]                      :  "make"
///
/// A word group opens on every syllable and closes when `part = false`.
/// If the last syllable happens to have `part = true` (malformed data) we
/// still close the group so nothing is lost.
fn merge_syllables(syllables: &[RawSyllable]) -> (Vec<AppleWordTiming>, String) {
    let mut words: Vec<AppleWordTiming> = Vec::new();

    // Accumulators for the current word group
    let mut group_text:      String             = String::new();
    let mut group_start:     u64                = 0;
    let mut group_end:       u64;
    let mut group_split:     bool               = false;
    let mut group_syllables: Vec<AppleSyllable> = Vec::new();

    for (i, syl) in syllables.iter().enumerate() {
        let is_last = i == syllables.len() - 1;

        if group_text.is_empty() {
            group_start     = syl.timestamp;
            group_split     = false;
            group_syllables = Vec::new();
        }

        group_text.push_str(&syl.text);
        group_end = syl.endtime;

        // Collect the syllable into the group . we decide below whether to keep it.
        group_syllables.push(AppleSyllable {
            text:     syl.text.clone(),
            time:     syl.timestamp as f64 / 1000.0,
            end_time: syl.endtime   as f64 / 1000.0,
            part:     syl.part,
        });

        if syl.part && !is_last {
            // More syllables belong to this word . keep accumulating
            group_split = true;
        } else {
            // Close the group → emit one word
            let is_split = group_split || syl.part; // syl.part on last = malformed input

            // Only attach syllable detail for genuinely split words.
            // Whole words (single syllable, part=false) get syllables=None
            // to keep the serialized payload lean.
            let syllables_out = if is_split {
                Some(group_syllables.clone())
            } else {
                None
            };

            words.push(AppleWordTiming {
                word:      group_text.clone(),
                time:      group_start as f64 / 1000.0,
                end_time:  group_end   as f64 / 1000.0,
                is_split,
                syllables: syllables_out,
            });
            group_text.clear();
        }
    }

    let text = words.iter().map(|w| w.word.as_str()).collect::<Vec<_>>().join(" ");
    (words, text)
}


// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/// Parse the raw paxsenix Apple Music JSON string into structured lyric lines.
///
/// Returns an error string (shown to the user) on JSON parse failure or if
/// the response is clearly not a Syllable-type response.
pub fn parse_apple_lyrics_json(raw: &str) -> Result<Vec<AppleLyricLine>, String> {
    let response: RawAppleResponse = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse Apple Music lyrics JSON: {}", e))?;

    if response.content.is_empty() {
        return Err("Apple Music lyrics response contained no lines".to_string());
    }

    let mut lines: Vec<AppleLyricLine> = response
        .content
        .iter()
        .map(|raw_line| {
            // --- Primary vocal ---
            let (words, text) = merge_syllables(&raw_line.text);

            // --- Background vocal ---
            let (bg_words, bg_text) = if raw_line.background_text.is_empty() {
                (Vec::new(), String::new())
            } else {
                merge_syllables(&raw_line.background_text)
            };

            AppleLyricLine {
                time:             raw_line.timestamp as f64 / 1000.0,
                end_time:         raw_line.endtime   as f64 / 1000.0,
                text,
                words,
                structure:        raw_line.structure.clone(),
                opposite_turn:    raw_line.opposite_turn,
                is_background:    raw_line.background,
                background_words: bg_words,
                background_text:  bg_text,
            }
        })
        .collect();

    // Guarantee ascending time order (the API should already provide this,
    // but be defensive)
    lines.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));

    Ok(lines)
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// Tauri command: parse the raw Apple Music JSON string and return the
/// structured line array to the frontend.
///
/// The frontend passes the raw JSON it received (or loaded from cache),
/// and gets back a fully typed array ready for rendering.
#[tauri::command]
pub fn parse_apple_lyrics_json_cmd(raw: String) -> Result<Vec<AppleLyricLine>, String> {
    parse_apple_lyrics_json(&raw)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_json(lines: &str) -> String {
        format!(r#"{{"content": [{}]}}"#, lines)
    }

    fn syllable(text: &str, ts: u64, end: u64, part: bool) -> String {
        format!(
            r#"{{"text":"{}","timestamp":{},"endtime":{},"duration":{},"part":{}}}"#,
            text, ts, end, end - ts, part
        )
    }

    fn line(ts: u64, end: u64, structure: &str, syllables: &str, bg: bool, bg_text: &str, opp: bool) -> String {
        format!(
            r#"{{"timestamp":{},"endtime":{},"duration":{},"structure":"{}","text":[{}],"background":{},"backgroundText":[{}],"oppositeTurn":{}}}"#,
            ts, end, end - ts, structure, syllables, bg, bg_text, opp
        )
    }

    // ---- Syllable merging --------------------------------------------------

    #[test]
    fn test_single_whole_word() {
        let json = minimal_json(&line(
            1000, 2000, "Verse",
            &syllable("hello", 1000, 2000, false),
            false, "", false,
        ));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert_eq!(lines.len(), 1);
        let w = &lines[0].words;
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].word, "hello");
        assert!(!w[0].is_split);
        assert_eq!(lines[0].text, "hello");
    }

    #[test]
    fn test_two_whole_words() {
        let syls = format!("{},{}", syllable("hello", 1000, 1500, false), syllable("world", 1600, 2000, false));
        let json = minimal_json(&line(1000, 2000, "Verse", &syls, false, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].text, "hello world");
    }

    #[test]
    fn test_syllable_merge_two_parts() {
        // "Bill"(part=true) + "board"(part=false) -> "Billboard"
        let syls = format!("{},{}", syllable("Bill", 0, 500, true), syllable("board", 500, 1000, false));
        let json = minimal_json(&line(0, 1000, "Verse", &syls, false, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert_eq!(lines[0].words.len(), 1);
        let w = &lines[0].words[0];
        assert_eq!(w.word, "Billboard");
        assert!(w.is_split);
        assert_eq!(w.time, 0.0);
        assert_eq!(w.end_time, 1.0);
        assert_eq!(lines[0].text, "Billboard");
        // Syllables must be present and fully populated
        let syls = w.syllables.as_ref().expect("split word must have syllables");
        assert_eq!(syls.len(), 2);
        assert_eq!(syls[0].text, "Bill");   assert_eq!(syls[0].time, 0.0);   assert_eq!(syls[0].end_time, 0.5);  assert!(syls[0].part);
        assert_eq!(syls[1].text, "board");  assert_eq!(syls[1].time, 0.5);   assert_eq!(syls[1].end_time, 1.0);  assert!(!syls[1].part);
    }

    #[test]
    fn test_whole_word_has_no_syllables() {
        // A non-split word must have syllables=None (omitted in JSON)
        let json = minimal_json(&line(0, 1000, "Verse", &syllable("hello", 0, 1000, false), false, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert!(lines[0].words[0].syllables.is_none());
        assert!(!lines[0].words[0].is_split);
    }

    #[test]
    fn test_three_part_syllables_preserved() {
        // "E'"(true) + "ery"(true) + "bo"(true) + "dy"(false) → "E'erybody" with 4 syllables
        let syls = [
            syllable("E'",  0,   200, true),
            syllable("ery", 200, 400, true),
            syllable("bo",  400, 600, true),
            syllable("dy",  600, 800, false),
        ].join(",");
        let json = minimal_json(&line(0, 800, "Verse", &syls, false, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        let w = &lines[0].words[0];
        assert_eq!(w.word, "E'erybody");
        let syls = w.syllables.as_ref().unwrap();
        assert_eq!(syls.len(), 4);
        assert_eq!(syls[0].text, "E'");   assert!(syls[0].part);
        assert_eq!(syls[1].text, "ery");  assert!(syls[1].part);
        assert_eq!(syls[2].text, "bo");   assert!(syls[2].part);
        assert_eq!(syls[3].text, "dy");   assert!(!syls[3].part);
        // Timing
        assert_eq!(syls[0].time, 0.0);    assert_eq!(syls[0].end_time, 0.2);
        assert_eq!(syls[1].time, 0.2);   assert_eq!(syls[1].end_time, 0.4);
        assert_eq!(syls[2].time, 0.4);   assert_eq!(syls[2].end_time, 0.6);
        assert_eq!(syls[3].time, 0.6);   assert_eq!(syls[3].end_time, 0.8);
    }

    #[test]
    fn test_mixed_split_and_whole() {
        // "Du"(true) + "a"(false) = "Dua", "Li"(true) + "pa"(false) = "Lipa", "make"(false)
        let syls = [
            syllable("Du",   0,    200,  true),
            syllable("a",    200,  400,  false),
            syllable("Li",   400,  600,  true),
            syllable("pa",   600,  800,  false),
            syllable("make", 800,  1000, false),
        ].join(",");
        let json = minimal_json(&line(0, 1000, "Verse", &syls, false, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        let words = &lines[0].words;
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].word, "Dua");
        assert_eq!(words[1].word, "Lipa");
        assert_eq!(words[2].word, "make");
        assert_eq!(lines[0].text, "Dua Lipa make");
    }

    // ---- Timing conversion -------------------------------------------------

    #[test]
    fn test_ms_to_seconds_conversion() {
        let json = minimal_json(&line(
            25114, 28418, "Chorus",
            &syllable("test", 25114, 28418, false),
            false, "", false,
        ));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert!((lines[0].time - 25.114).abs() < 0.001);
        assert!((lines[0].end_time - 28.418).abs() < 0.001);
        assert!((lines[0].words[0].time - 25.114).abs() < 0.001);
    }

    // ---- Metadata fields ---------------------------------------------------

    #[test]
    fn test_opposite_turn_flag() {
        let json = minimal_json(&line(0, 1000, "Verse", &syllable("yo", 0, 1000, false), false, "", true));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert!(lines[0].opposite_turn);
        assert!(!lines[0].is_background);
    }

    #[test]
    fn test_background_line_flag() {
        let json = minimal_json(&line(0, 1000, "Verse", &syllable("yeah", 0, 1000, false), true, "", false));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert!(lines[0].is_background);
        assert!(!lines[0].opposite_turn);
    }

    #[test]
    fn test_background_text_words() {
        let bg_syls = format!("{},{}", syllable("Yeah,", 800, 900, false), syllable("yeah", 900, 1000, false));
        let json = minimal_json(&line(
            0, 1000, "Verse",
            &syllable("main", 0, 800, false),
            true, &bg_syls, false,
        ));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert_eq!(lines[0].background_words.len(), 2);
        assert_eq!(lines[0].background_words[0].word, "Yeah,");
        assert_eq!(lines[0].background_words[1].word, "yeah");
        assert_eq!(lines[0].background_text, "Yeah, yeah");
    }

    #[test]
    fn test_structure_field() {
        for structure in &["Intro", "Verse", "PreChorus", "Chorus", "Bridge", "Outro"] {
            let json = minimal_json(&line(0, 1000, structure, &syllable("x", 0, 1000, false), false, "", false));
            let lines = parse_apple_lyrics_json(&json).unwrap();
            assert_eq!(&lines[0].structure, structure);
        }
    }

    // ---- Error handling ----------------------------------------------------

    #[test]
    fn test_invalid_json_returns_error() {
        assert!(parse_apple_lyrics_json("not json").is_err());
    }

    #[test]
    fn test_empty_content_returns_error() {
        assert!(parse_apple_lyrics_json(r#"{"content":[]}"#).is_err());
    }

    // ---- Sort guarantee ----------------------------------------------------

    #[test]
    fn test_output_is_sorted_by_time() {
        // Deliberately insert lines out of order
        let l1 = line(5000, 6000, "Verse", &syllable("b", 5000, 6000, false), false, "", false);
        let l2 = line(1000, 2000, "Verse", &syllable("a", 1000, 2000, false), false, "", false);
        let json = minimal_json(&format!("{},{}", l1, l2));
        let lines = parse_apple_lyrics_json(&json).unwrap();
        assert!(lines[0].time < lines[1].time);
    }
}