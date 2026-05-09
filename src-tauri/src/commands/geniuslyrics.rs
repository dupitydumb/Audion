// ---------------------------------------------------------------------------
// Genius JSON lyrics parser  (paxsenix / api.paxsenix.org format)
// ---------------------------------------------------------------------------
//
// input: the raw json string returned by GET /lyrics/genius?q=<query>
//
// output: Vec<GeniusLyricLine> = a fully structured, frontend-ready
//         representation that extracts every semantic the api encodes
//         inside its flat lyrics string:
//
//    Section label from [Section] or [Section: Artist] headers
//    Opposite-turn flag   (section artist differs from primary artist)
//    Background-vocal flag + background_text  (parenthetical content)
//
// no timing data is available from Genius; time and end_time are 0.0
//
// tauri command `parse_genius_lyrics_cmd` is the public entry point
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Raw deserialization types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RawGeniusResponse {
    /// primary artist string
    /// may be compound eg: Lady Gaga & Bruno Mars
    artist: String,

    /// flat lyrics string with embedded section headers and newlines
    /// section headers have the form:
    ///   [SectionType]
    ///   [SectionType: Artist]
    ///   [SectionType: A, A & B]
    lyrics: String,
}

// ---------------------------------------------------------------------------
// Output types  (serialized and sent to the frontend)
// ---------------------------------------------------------------------------

/// fully parsed Genius lyric line.
#[derive(Serialize)]
pub struct GeniusLyricLine {
    /// always 0.0 since Genius provides no timing data
    pub time:     f64,
    /// always 0.0 since Genius provides no timing data
    pub end_time: f64,

    /// the lyric text with all parenthetical content stripped
    /// empty string for lines that were entirely parenthetical
    /// those are represented purely via background_text
    pub text: String,

    /// song section label parsed from the most recent [Section] header
    pub structure: String,

    /// true when the section's tagged artist do not overlap with the
    /// primary artist field from the api
    /// frontend renders these lines right-aligned, italic
    pub opposite_turn: bool,

    /// true when this line's entire lyric content is parenthetical
    /// means the stripped `text` is empty but `background_text` is not
    /// frontend renders it dimmer / in parentheses
    pub is_background: bool,

    /// parenthetical content extracted from the line with brackets removed
    /// empty string when no bracket content present
    pub background_text: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// normalize an artist string into a set of lowercase name tokens
/// splits on "&", "," and whitespace
fn artist_tokens(s: &str) -> Vec<String> {
    s.split(|c| c == '&' || c == ',')
        .map(|part| part.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect()
}

/// decide whether a section's artist tag represents a different vocalist
/// returns true (opposite_turn) when none of the section's artist tokens appear in the primary artist token set
/// when the section has no artist tag at all, returns false (can't tell)
fn is_opposite_turn(primary_artist: &str, section_tag: Option<&str>) -> bool {
    let tag = match section_tag {
        Some(t) if !t.trim().is_empty() => t,
        _ => return false,
    };

    let primary_tokens = artist_tokens(primary_artist);
    let tag_tokens     = artist_tokens(tag);

    // if any tag token matches any primary token, this is not opposite turn
    for tag_tok in &tag_tokens {
        for pri_tok in &primary_tokens {
            if pri_tok.contains(tag_tok.as_str()) || tag_tok.contains(pri_tok.as_str()) {
                return false;
            }
        }
    }

    true
}

/// parse a section header line of the form:
///   [SectionType]
///   [SectionType: ArtistTag]
///
/// returns Some((structure, Option<artist_tag>)) if it is a header
/// None if the line is not a section header
fn parse_section_header(line: &str) -> Option<(String, Option<String>)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }

    let inner = &trimmed[1..trimmed.len() - 1];

    if let Some(colon_pos) = inner.find(':') {
        let structure  = inner[..colon_pos].trim().to_string();
        let artist_tag = inner[colon_pos + 1..].trim().to_string();
        Some((structure, Some(artist_tag)))
    } else {
        Some((inner.trim().to_string(), None))
    }
}

/// extract parenthetical content from a lyric line
/// returns (clean_text, background_text)
///   clean_text = line with all (...) groups removed and whitespace normalised
///   background_text = all parenthetical content joined by " ", brackets stripped
fn extract_parentheticals(line: &str) -> (String, String) {
    let mut clean  = String::new();
    let mut bg     = String::new();
    let mut depth  = 0usize;
    let mut bg_buf = String::new();

    for ch in line.chars() {
        match ch {
            '(' => {
                depth += 1;
            }
            ')' => {
                if depth > 0 {
                    depth -= 1;
                    let content = bg_buf.trim().to_string();
                    if !content.is_empty() {
                        if !bg.is_empty() { bg.push(' '); }
                        bg.push_str(&content);
                    }
                    bg_buf.clear();
                }
            }
            _ => {
                if depth == 0 {
                    clean.push(ch);
                } else {
                    bg_buf.push(ch);
                }
            }
        }
    }

    // dispose any unclosed parenthetical
    let leftover = bg_buf.trim().to_string();
    if !leftover.is_empty() {
        if !bg.is_empty() { bg.push(' '); }
        bg.push_str(&leftover);
    }

    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    (clean, bg)
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------
/// parse the raw paxsenix Genius json string into structured lyric lines
/// returns error on json parse failure or if the response contains no usable lyric content
/// intermediate line produced by 1st step
/// opposite_turn is not yet resolved = 2nd step
struct RawParsedLine {
    text:            String,
    structure:       String,
    /// raw artist tag from the section header that owns this line
    /// None when section had no artist tag
    section_tag:     Option<String>,
    is_background:   bool,
    background_text: String,
}

/// check whether primary_artist matches any artist token found in
/// tag_counts (per-tag line-count map built during 1st step)
/// returns true if at least one section tag in the song was sung by the primary artist
fn primary_artist_appears_in_tags(
    primary_artist: &str,
    tag_counts: &std::collections::HashMap<String, usize>,
) -> bool {
    let primary_tokens = artist_tokens(primary_artist);
    for tag in tag_counts.keys() {
        let tag_tokens = artist_tokens(tag);
        for tag_tok in &tag_tokens {
            for pri_tok in &primary_tokens {
                if pri_tok.contains(tag_tok.as_str()) || tag_tok.contains(pri_tok.as_str()) {
                    return true;
                }
            }
        }
    }
    false
}

/// decide the set of "co-primary" artist tags using line counts
/// strategy:
///   1. find the tag with the maximum line count (primary)
///   2. within threshold = co-primary
///   3. everyone below the threshold = opposite (right side)
///
/// if only one unique tag exists, or all tags are within threshold,
/// return set containing all tags (nothing goes opposite)
fn coprimary_tags(
    tag_counts: &std::collections::HashMap<String, usize>,
    close_pct: f64,
) -> std::collections::HashSet<String> {
    let max = match tag_counts.values().copied().max() {
        Some(m) => m,
        None    => return std::collections::HashSet::new(),
    };
    let threshold = (max as f64 * (1.0 - close_pct)).floor() as usize;
    tag_counts
        .iter()
        .filter(|(_, &count)| count >= threshold)
        .map(|(tag, _)| tag.clone())
        .collect()
}

/// returns true when section_tag is not represented in coprimary
/// token overlap is used
fn tag_is_opposite(section_tag: &str, coprimary: &std::collections::HashSet<String>) -> bool {
    let tag_tokens = artist_tokens(section_tag);
    for cp in coprimary {
        let cp_tokens = artist_tokens(cp);
        for tag_tok in &tag_tokens {
            for cp_tok in &cp_tokens {
                if cp_tok.contains(tag_tok.as_str()) || tag_tok.contains(cp_tok.as_str()) {
                    return false;
                }
            }
        }
    }
    true
}

pub fn parse_genius_lyrics(raw: &str) -> Result<Vec<GeniusLyricLine>, String> {
    let response: RawGeniusResponse = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse Genius lyrics JSON: {}", e))?;

    if response.lyrics.trim().is_empty() {
        return Err("Genius lyrics response contained no lyric content".to_string());
    }

    let primary_artist = response.artist.trim();

    // 1st step
    // collect intermediate lines + build per-tag line counts

    let mut raw_lines:  Vec<RawParsedLine>                          = Vec::new();
    let mut tag_counts: std::collections::HashMap<String, usize>    = std::collections::HashMap::new();

    let mut current_structure = String::new();
    let mut current_tag:        Option<String> = None;

    for raw_line in response.lyrics.lines() {
        let trimmed = raw_line.trim();

        if let Some((structure, tag)) = parse_section_header(trimmed) {
            current_structure = structure;
            current_tag       = tag;
            continue;
        }

        if trimmed.is_empty() { continue; }

        // count this line against the current section's artist tag
        if let Some(ref tag) = current_tag {
            *tag_counts.entry(tag.clone()).or_insert(0) += 1;
        }

        let (clean_text, background_text) = extract_parentheticals(trimmed);
        let is_background = clean_text.is_empty() && !background_text.is_empty();

        raw_lines.push(RawParsedLine {
            text:            clean_text,
            structure:       current_structure.clone(),
            section_tag:     current_tag.clone(),
            is_background,
            background_text,
        });
    }

    if raw_lines.is_empty() {
        return Err("Genius lyrics parser produced no output lines".to_string());
    }

    // decide opposite_turn strategy
    // step 1: primary artist match any tag in the song?
    // yes = artist field is reliable so use name-match, but validate with counts
    // no= artist field is unreliable so count-only
    //
    // Step 2 (reliable): count lines with primary artist
    // if primary_lines >= 30% of total primaryis correct
    // if primary_lines <  30% of total = primary label is wrong, fall back to count
    //
    // Step 3 (count-based): build co-primary set (within 20% of max)
    //   co-primary : left. everyone else : right
    //   if all tags are co-primary or only one artist then nothing goes right

    let total_lines = raw_lines.len();

    enum Strategy {
        NameMatch,                                          // use is_opposite_turn
        CountBased(std::collections::HashSet<String>),     // use coprimary set
    }

    let strategy = if primary_artist_appears_in_tags(primary_artist, &tag_counts) {
        // primary artist matched at least one section tag
        let primary_line_count: usize = tag_counts
            .iter()
            .filter(|(tag, _)| !is_opposite_turn(primary_artist, Some(tag.as_str())))
            .map(|(_, &count)| count)
            .sum();

        let primary_ratio = primary_line_count as f64 / total_lines as f64;

        if primary_ratio >= 0.30 {
            // primary artist has enough lines
            Strategy::NameMatch
        } else {
            // primary artist is labelled but barely sings .fall back to counts
            Strategy::CountBased(coprimary_tags(&tag_counts, 0.20))
        }
    } else {
        // artist field matched nothing . purely count based
        Strategy::CountBased(coprimary_tags(&tag_counts, 0.20))
    };

    // 2nd step
    // resolve opposite_turn for each line using the chosen strategy

    let lines: Vec<GeniusLyricLine> = raw_lines
        .into_iter()
        .map(|l| {
            let opposite_turn = match &l.section_tag {
                None => false, // no artist tag → can't determine, default left
                Some(tag) => match &strategy {
                    Strategy::NameMatch =>
                        is_opposite_turn(primary_artist, Some(tag.as_str())),
                    Strategy::CountBased(coprimary) =>
                        tag_is_opposite(tag.as_str(), coprimary),
                },
            };

            GeniusLyricLine {
                time:            0.0,
                end_time:        0.0,
                text:            l.text,
                structure:       l.structure,
                opposite_turn,
                is_background:   l.is_background,
                background_text: l.background_text,
            }
        })
        .collect();

    Ok(lines)
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------
/// The frontend passes the raw json or cache it received and gets back fully typed array ready for render
#[tauri::command]
pub fn parse_genius_lyrics_json_cmd(raw: String) -> Result<Vec<GeniusLyricLine>, String> {
    parse_genius_lyrics(&raw)
}

