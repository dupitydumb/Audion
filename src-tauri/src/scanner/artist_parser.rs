// splits a raw artist tag string (e.g. Dua Lipa & Drake) into individual
// artist names, using an ordered list of delimiter rules
//
// the rule list below is a placeholder
// eventually this should be user configurable and threaded in from settings rather than hardcoded in as a constant
// don't build on top of the storage assumption here without revisiting that
//
// rule semantics:
// - rules are tried in priority order (index 0 = highest priority)
// - if a delimiter appears anywhere in the (unescaped) string, that is the only delimiter used to split the whole string
//   even if lower priority delimiters also appear
//   e.g. with priority ["&", " and "], the string "Dua Lipa & Drake and Bad Bunny"
//   splits only on "&", producing ["Dua Lipa", "Drake and Bad Bunny"]
//   because "&" outranks "and"
// - the escape character ("\") protects the delimiter immediately following it from being treated as a split point
//   so a literal "Simon \& Garfunkel" style tag can force the whole string to be treated as one artist even though "&" is a configured delimiter
//
// this facillitates a library that has a band literally named "Earth, Wind &
// Fire" tag it as "Earth, Wind \& Fire" to keep it as a single artist, while
// still splitting the common "Artist A & Artist B" case automatically

const ESCAPE_CHAR: char = '\\';

/// example priority list. highest priority first
/// TODO: replace with user configurable rules once the storage question
/// (DB backed vs localStorage passthrough) is settled
const DEFAULT_DELIMITERS: &[&str] = &["&", " and ", ","];

/// unique placeholder sequence
/// used to temporarily protect escaped delimiters during splitting
const PLACEHOLDER_PREFIX: char = '\u{E000}'; // unicode private use area

/// split a raw artist string into individual, trimmed artist names using the default delimiter priority list
///
/// returns a single element vec containing the trimmed input if no configured delimiter is found (including when the input is empty)
pub fn split_artists(raw: &str) -> Vec<String> {
    split_artists_with_rules(raw, DEFAULT_DELIMITERS)
}

/// split a raw artist string using an explicit, ordered delimiter list
/// exposed separately from split_artists so callers can pass a custom rule set
pub fn split_artists_with_rules(raw: &str, delimiters_by_priority: &[&str]) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    // 1: protect escaped delimiters by swapping "\<delim>" for a placeholder that can't collide with a real delimiter
    // so the splitting step below skips over them entirely
    let mut protected = trimmed.to_string();
    let mut placeholder_map: Vec<(String, String)> = Vec::new();
    for (i, delim) in delimiters_by_priority.iter().enumerate() {
        let escaped = format!("{ESCAPE_CHAR}{delim}");
        if protected.contains(&escaped) {
            let placeholder = format!("{PLACEHOLDER_PREFIX}{i}{PLACEHOLDER_PREFIX}");
            protected = protected.replace(&escaped, &placeholder);
            placeholder_map.push((placeholder, delim.to_string()));
        }
    }

    //  2: find the highest priority delimiter that still appears (unescaped) in the protected string
    let mut chosen: Option<&str> = None;
    for delim in delimiters_by_priority {
        if protected.contains(delim) {
            chosen = Some(delim);
            break;
        }
    }

    let pieces: Vec<String> = match chosen {
        Some(delim) => protected
            .split(delim)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        None => vec![protected.trim().to_string()],
    };

    // 3: restore any escaped delimiters back to their literal form in each resulting piece
    pieces
        .into_iter()
        .map(|piece| {
            let mut restored = piece;
            for (placeholder, delim) in &placeholder_map {
                restored = restored.replace(placeholder, delim);
            }
            restored
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// rejoins a list of artist names into a single display string
/// uses the normalized separator (Dua Lipa · Drake)
/// for ui and display sites that currently just interpolate the raw tag string
pub fn join_artists_for_display(artists: &[String]) -> String {
    artists.join(" · ")
}