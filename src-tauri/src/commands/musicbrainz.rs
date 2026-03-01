//! MusicBrainz integration commands
//!
//! Provides artist metadata enrichment (genres, biography, Wikipedia links)
//! via the free, no-auth MusicBrainz API (musicbrainz.org/ws/2).
//!
//! Rate-limit: MusicBrainz enforces ≤ 1 req/sec. All calls that make more
//! than one HTTP request insert a `tokio::time::sleep(1.1 s)` between them.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::time::{sleep, Duration};

const MB_API_BASE: &str = "https://musicbrainz.org/ws/2";
const MB_USER_AGENT: &str = "Audion/1.2.4 (https://audionplayer.com)";
const WIKI_SUMMARY_BASE: &str = "https://en.wikipedia.org/api/rest_v1/page/summary";

// ── Raw MusicBrainz JSON shapes ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MbArtistSearchResponse {
    artists: Option<Vec<MbArtistResult>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistResult {
    id: String,
    name: String,
    disambiguation: Option<String>,
    tags: Option<Vec<MbTag>>,
    genres: Option<Vec<MbTag>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistDetail {
    tags: Option<Vec<MbTag>>,
    genres: Option<Vec<MbTag>>,
    relations: Option<Vec<MbRelation>>,
}

#[derive(Debug, Deserialize)]
struct MbTag {
    name: String,
    count: Option<i32>,
}

#[derive(Debug, Deserialize, Clone)]
struct MbRelation {
    #[serde(rename = "type")]
    rel_type: String,
    url: Option<MbUrl>,
}

#[derive(Debug, Deserialize, Clone)]
struct MbUrl {
    resource: String,
}

#[derive(Debug, Deserialize)]
struct WikiSummaryResponse {
    extract: Option<String>,
}

// ── Public types returned to the frontend ────────────────────────────────────

/// Rich artist metadata fetched from MusicBrainz (and optionally Wikipedia).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbArtistInfo {
    /// MusicBrainz Artist ID (UUID string).
    pub mbid: Option<String>,
    pub name: String,
    /// Extra disambiguation text when multiple artists share a name.
    pub disambiguation: Option<String>,
    /// Up to 5 genre names, sorted by vote count.
    pub genres: Vec<String>,
    /// English Wikipedia page URL, if available.
    pub wikipedia_url: Option<String>,
    /// Plain-text extract from the Wikipedia article (first paragraph).
    pub bio: Option<String>,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn mb_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(MB_USER_AGENT)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

/// Merge `genres` + `tags` arrays, deduplicate, sort by count, return top N.
fn collect_genres(
    tags: Option<&Vec<MbTag>>,
    genres: Option<&Vec<MbTag>>,
    take: usize,
) -> Vec<String> {
    let mut combined: Vec<(String, i32)> = Vec::new();

    let add = |combined: &mut Vec<(String, i32)>, tag: &MbTag| {
        let name_lower = tag.name.to_lowercase();
        // Skip decade tags ("1990s"), obviously non-genre tags
        if name_lower
            .chars()
            .next()
            .map_or(false, |c| c.is_ascii_digit())
        {
            return;
        }
        if matches!(
            name_lower.as_str(),
            "seen live" | "favorites" | "favourite" | "amazing"
        ) {
            return;
        }
        if !combined
            .iter()
            .any(|(n, _)| n.to_lowercase() == name_lower)
        {
            combined.push((title_case(&tag.name), tag.count.unwrap_or(0)));
        }
    };

    if let Some(g) = genres {
        for t in g {
            add(&mut combined, t);
        }
    }
    if let Some(t) = tags {
        for t in t {
            add(&mut combined, t);
        }
    }

    combined.sort_by(|a, b| b.1.cmp(&a.1));
    combined.into_iter().map(|(n, _)| n).take(take).collect()
}

fn title_case(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// Extract the first English Wikipedia URL from an MB `url-rels` array.
fn wikipedia_from_relations(relations: &[MbRelation]) -> Option<String> {
    relations
        .iter()
        .filter_map(|r| r.url.as_ref())
        .map(|u| u.resource.clone())
        .find(|u| u.contains("en.wikipedia.org"))
}

/// Fetch the Wikipedia plain-text summary for a Wikipedia URL.
async fn fetch_wiki_bio(wiki_url: &str) -> Option<String> {
    // URL shape: https://en.wikipedia.org/wiki/Radiohead
    let title = wiki_url.split("/wiki/").last()?;
    let client = mb_client().ok()?;
    let url = format!("{}/{}", WIKI_SUMMARY_BASE, title);

    let resp: WikiSummaryResponse = client
        .get(&url)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    resp.extract
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Fetch MusicBrainz metadata for a single artist by name.
///
/// Makes 2 HTTP requests (search + detail) plus an optional Wikipedia fetch,
/// each separated by a 1.1 s sleep to respect the MB rate limit.
#[tauri::command]
pub async fn get_artist_musicbrainz_info(
    artist_name: String,
) -> Result<MbArtistInfo, String> {
    let client = mb_client()?;

    // ── 1. Search for the artist ─────────────────────────────────────────────
    let search_resp = client
        .get(format!("{}/artist", MB_API_BASE))
        .query(&[
            ("query", format!("artist:\"{}\"", artist_name)),
            ("limit", "1".into()),
            ("fmt", "json".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("MusicBrainz search error: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!(
            "MusicBrainz search returned {}",
            search_resp.status()
        ));
    }

    let search_data: MbArtistSearchResponse = search_resp
        .json()
        .await
        .map_err(|e| format!("MusicBrainz search parse error: {}", e))?;

    let artist = match search_data.artists.and_then(|v| v.into_iter().next()) {
        Some(a) => a,
        None => {
            return Ok(MbArtistInfo {
                mbid: None,
                name: artist_name,
                disambiguation: None,
                genres: vec![],
                wikipedia_url: None,
                bio: None,
            })
        }
    };

    let mbid = artist.id.clone();

    // Rate-limit gap before second request
    sleep(Duration::from_millis(1100)).await;

    // ── 2. Fetch full artist detail with genres + url-rels ───────────────────
    let detail_resp = client
        .get(format!("{}/artist/{}", MB_API_BASE, mbid))
        .query(&[("inc", "genres+tags+url-rels"), ("fmt", "json")])
        .send()
        .await
        .map_err(|e| format!("MusicBrainz detail error: {}", e))?;

    let (genres, wikipedia_url) = if detail_resp.status().is_success() {
        let detail: MbArtistDetail = detail_resp
            .json()
            .await
            .map_err(|e| format!("MusicBrainz detail parse error: {}", e))?;

        let genres = collect_genres(detail.tags.as_ref(), detail.genres.as_ref(), 5);
        let wiki_url = detail
            .relations
            .as_deref()
            .and_then(wikipedia_from_relations);

        (genres, wiki_url)
    } else {
        // Fall back to whatever tags came with the search result
        let genres = collect_genres(artist.tags.as_ref(), artist.genres.as_ref(), 5);
        (genres, None)
    };

    // ── 3. Fetch Wikipedia bio (best-effort) ─────────────────────────────────
    let bio = if let Some(ref url) = wikipedia_url {
        sleep(Duration::from_millis(300)).await;
        fetch_wiki_bio(url).await
    } else {
        None
    };

    Ok(MbArtistInfo {
        mbid: Some(mbid),
        name: artist.name,
        disambiguation: artist.disambiguation,
        genres,
        wikipedia_url,
        bio,
    })
}

/// Aggregate the most common genres across the user's top played artists by
/// querying MusicBrainz. Returns up to 5 `[genre, count]` pairs sorted by
/// how many of the top artists belong to that genre.
///
/// Uses 1 MB request per artist with 1.1 s gaps between them.
#[tauri::command]
pub async fn get_top_genres_from_mb(
    artist_limit: Option<usize>,
    db: tauri::State<'_, crate::db::Database>,
) -> Result<Vec<(String, u32)>, String> {
    let limit = artist_limit.unwrap_or(5).min(10); // cap to avoid very long waits

    // Fetch top artists from local play history — collect into owned Vec<String>
    // before any async work so the MutexGuard is released immediately.
    let artist_names: Vec<String> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT t.artist, COUNT(*) as plays
                 FROM play_history ph
                 JOIN tracks t ON ph.track_id = t.id
                 WHERE t.artist IS NOT NULL
                 GROUP BY lower(t.artist)
                 ORDER BY plays DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        // Avoid `?` on query_map to prevent the borrow from escaping the block.
        let rows = stmt
            .query_map(rusqlite::params![limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;

        rows.filter_map(|r| r.ok()).collect()
    };

    if artist_names.is_empty() {
        return Ok(vec![]);
    }

    let client = mb_client()?;
    let mut genre_counts: HashMap<String, u32> = HashMap::new();

    for (i, name) in artist_names.iter().enumerate() {
        if i > 0 {
            sleep(Duration::from_millis(1100)).await;
        }

        let Ok(resp) = client
            .get(format!("{}/artist", MB_API_BASE))
            .query(&[
                ("query", format!("artist:\"{}\"", name)),
                ("limit", "1".into()),
                ("fmt", "json".into()),
            ])
            .send()
            .await
        else {
            continue;
        };

        let Ok(data) = resp.json::<MbArtistSearchResponse>().await else {
            continue;
        };

        let Some(artist) = data.artists.and_then(|v| v.into_iter().next()) else {
            continue;
        };

        // Use tags from the search result (detail call not needed for aggregation)
        let genres = collect_genres(artist.tags.as_ref(), artist.genres.as_ref(), 3);
        for genre in genres {
            *genre_counts.entry(genre).or_insert(0) += 1;
        }
    }

    let mut sorted: Vec<(String, u32)> = genre_counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.truncate(5);

    Ok(sorted)
}

// =============================================================================
// RECORDING LOOKUP · RELEASE INFO · SIMILAR ARTISTS · DISCOGRAPHY
// =============================================================================

// ── Additional raw MB JSON shapes ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MbRecordingSearchResponse {
    recordings: Option<Vec<MbRecordingResult>>,
}

#[derive(Debug, Deserialize)]
struct MbRecordingResult {
    id: String,
    tags: Option<Vec<MbTag>>,
    genres: Option<Vec<MbTag>>,
    isrcs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseSearchResponse {
    releases: Option<Vec<MbReleaseResult>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseResult {
    id: String,
    date: Option<String>,
    country: Option<String>,
    #[serde(rename = "label-info")]
    label_info: Option<Vec<MbLabelInfo>>,
    #[serde(rename = "release-group")]
    release_group: Option<MbReleaseGroupPartial>,
}

#[derive(Debug, Deserialize)]
struct MbLabelInfo {
    label: Option<MbLabel>,
}

#[derive(Debug, Deserialize)]
struct MbLabel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupPartial {
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(rename = "secondary-types")]
    secondary_types: Option<Vec<String>>,
}

/// Artist detail response when fetching `inc=artist-rels`.
#[derive(Debug, Deserialize)]
struct MbArtistDetailWithRels {
    relations: Option<Vec<MbArtistRel>>,
}

#[derive(Debug, Deserialize, Clone)]
struct MbArtistRel {
    #[serde(rename = "type")]
    rel_type: String,
    /// Populated only for artist-to-artist relations.
    artist: Option<MbRelatedArtist>,
}

#[derive(Debug, Deserialize, Clone)]
struct MbRelatedArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupBrowseResponse {
    #[serde(rename = "release-groups")]
    release_groups: Option<Vec<MbReleaseGroupItem>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupItem {
    id: String,
    title: String,
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(rename = "secondary-types")]
    secondary_types: Option<Vec<String>>,
    #[serde(rename = "first-release-date")]
    first_release_date: Option<String>,
}

// ── Additional public return types ────────────────────────────────────────────

/// Result of enriching a local track with MusicBrainz recording data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbTrackEnrichment {
    /// MusicBrainz Recording ID written back to the local database.
    pub mbid: Option<String>,
    /// Top genre tag for the recording.
    pub genre: Option<String>,
    /// ISRC codes (International Standard Recording Codes) for this recording.
    pub isrcs: Vec<String>,
}

/// Release metadata from MusicBrainz (label, year, country, release type).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbReleaseInfo {
    pub mbid: Option<String>,
    pub year: Option<String>,
    pub country: Option<String>,
    pub label: Option<String>,
    /// e.g. "Album", "EP", "Single", "Live", "Compilation"
    pub release_type: Option<String>,
}

/// An artist related to the queried artist on MusicBrainz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbSimilarArtist {
    pub name: String,
    /// MB relation type e.g. "member of band", "collaboration", "supporting musician".
    pub relation_type: String,
    /// `true` when this artist has at least one track in the local library.
    pub in_library: bool,
}

/// A release group (album/EP/single/etc.) from an artist's MusicBrainz discography.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbDiscographyItem {
    /// MusicBrainz Release Group ID (UUID).
    pub mbid: String,
    pub title: String,
    pub year: Option<String>,
    /// Primary or most specific release type e.g. "Album", "EP", "Single", "Live".
    pub release_type: String,
    /// Cover Art Archive URL for the front cover (250px thumbnail).
    /// The URL may return a 404 if no cover art has been submitted.
    pub cover_url: String,
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Build a human-readable release type from MB primary + secondary type fields.
fn release_type_label(primary: &Option<String>, secondary: &Option<Vec<String>>) -> String {
    if let Some(ref sec) = secondary {
        if !sec.is_empty() {
            return sec[0].clone();
        }
    }
    primary.clone().unwrap_or_else(|| "Release".into())
}

/// Extract the 4-digit year from a date string like "2001-06-04", "2001", or "2001-06".
fn year_from_date(date: &str) -> String {
    date.split('-').next().unwrap_or(date).to_string()
}

// ── New Tauri commands ────────────────────────────────────────────────────────

/// Search MusicBrainz for a recording by artist + title.
///
/// Writes the found `musicbrainz_recording_id` and top genre back to the
/// local database (best-effort, silent on DB failure) and returns any ISRC codes.
///
/// Uses 1 HTTP request: `/recording?query=...&inc=isrcs+genres+tags`.
#[tauri::command]
pub async fn enrich_track_metadata_mb(
    track_id: i64,
    artist: String,
    title: String,
    db: tauri::State<'_, crate::db::Database>,
) -> Result<MbTrackEnrichment, String> {
    let client = mb_client()?;

    let resp = client
        .get(format!("{}/recording", MB_API_BASE))
        .query(&[
            (
                "query",
                format!("artist:\"{}\" AND recording:\"{}\"", artist, title),
            ),
            ("limit", "1".into()),
            ("inc", "isrcs+genres+tags".into()),
            ("fmt", "json".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("MusicBrainz recording search error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MusicBrainz returned {}", resp.status()));
    }

    let data: MbRecordingSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let recording = match data.recordings.and_then(|v| v.into_iter().next()) {
        Some(r) => r,
        None => {
            return Ok(MbTrackEnrichment {
                mbid: None,
                genre: None,
                isrcs: vec![],
            })
        }
    };

    let mbid = recording.id.clone();
    let genres = collect_genres(recording.tags.as_ref(), recording.genres.as_ref(), 1);
    let top_genre = genres.into_iter().next();
    let isrcs = recording.isrcs.clone().unwrap_or_default();

    // Write back to DB (best-effort — don't propagate DB failures)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::update_track_mb_data(
            &conn,
            track_id,
            Some(mbid.as_str()),
            top_genre.as_deref(),
        )
        .ok();
    }

    Ok(MbTrackEnrichment {
        mbid: Some(mbid),
        genre: top_genre,
        isrcs,
    })
}

/// Search MusicBrainz for a release matching the given album + artist name.
/// Returns label, release year, country, and release type (Album/EP/Single/etc.).
///
/// Uses 1 HTTP request: `/release?query=...&inc=labels+release-groups`.
#[tauri::command]
pub async fn get_release_mb_info(
    album_name: String,
    artist_name: String,
) -> Result<MbReleaseInfo, String> {
    let client = mb_client()?;

    let resp = client
        .get(format!("{}/release", MB_API_BASE))
        .query(&[
            (
                "query",
                format!(
                    "release:\"{}\" AND artist:\"{}\"",
                    album_name, artist_name
                ),
            ),
            ("limit", "1".into()),
            ("inc", "labels+release-groups".into()),
            ("fmt", "json".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("MusicBrainz release search error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MusicBrainz returned {}", resp.status()));
    }

    let data: MbReleaseSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let release = match data.releases.and_then(|v| v.into_iter().next()) {
        Some(r) => r,
        None => {
            return Ok(MbReleaseInfo {
                mbid: None,
                year: None,
                country: None,
                label: None,
                release_type: None,
            })
        }
    };

    let year = release.date.as_deref().map(year_from_date);
    let label = release
        .label_info
        .as_deref()
        .and_then(|infos| infos.first())
        .and_then(|li| li.label.as_ref())
        .map(|l| l.name.clone());
    let release_type = release
        .release_group
        .as_ref()
        .map(|rg| release_type_label(&rg.primary_type, &rg.secondary_types));

    Ok(MbReleaseInfo {
        mbid: Some(release.id),
        year,
        country: release.country,
        label,
        release_type,
    })
}

/// Find artists related to the given artist on MusicBrainz (band members,
/// collaborators, etc.) and mark which ones exist in the local library.
///
/// Makes 2 rate-limited HTTP requests:
/// 1. Artist search to resolve the MBID.
/// 2. `/artist/<MBID>?inc=artist-rels` to get related artists.
#[tauri::command]
pub async fn get_similar_artists_mb(
    artist_name: String,
    db: tauri::State<'_, crate::db::Database>,
) -> Result<Vec<MbSimilarArtist>, String> {
    let client = mb_client()?;

    // ── 1. Resolve artist MBID ────────────────────────────────────────────────
    let search_resp = client
        .get(format!("{}/artist", MB_API_BASE))
        .query(&[
            ("query", format!("artist:\"{}\"", artist_name)),
            ("limit", "1".into()),
            ("fmt", "json".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("MB artist search error: {}", e))?;

    let search_data: MbArtistSearchResponse = search_resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let mbid = match search_data.artists.and_then(|v| v.into_iter().next()) {
        Some(a) => a.id,
        None => return Ok(vec![]),
    };

    sleep(Duration::from_millis(1100)).await;

    // ── 2. Fetch artist-to-artist relations ───────────────────────────────────
    let detail_resp = client
        .get(format!("{}/artist/{}", MB_API_BASE, mbid))
        .query(&[("inc", "artist-rels"), ("fmt", "json")])
        .send()
        .await
        .map_err(|e| format!("MB artist detail error: {}", e))?;

    if !detail_resp.status().is_success() {
        return Ok(vec![]);
    }

    let detail: MbArtistDetailWithRels = detail_resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let artist_rels: Vec<(String, String)> = detail
        .relations
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| r.artist.map(|a| (a.name, r.rel_type)))
        .take(30)
        .collect();

    if artist_rels.is_empty() {
        return Ok(vec![]);
    }

    // ── 3. Cross-reference with local library ─────────────────────────────────
    let local_lower: Vec<String> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT lower(artist) FROM tracks WHERE artist IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let results = artist_rels
        .into_iter()
        .map(|(name, relation_type)| {
            let in_library = local_lower.iter().any(|la| *la == name.to_lowercase());
            MbSimilarArtist {
                name,
                relation_type,
                in_library,
            }
        })
        .collect();

    Ok(results)
}

/// Fetch the full release-group discography for an artist from MusicBrainz,
/// sorted newest-first.
///
/// Makes 2 rate-limited HTTP requests:
/// 1. Artist search to resolve the MBID.
/// 2. `/release-group?artist=<MBID>&limit=100` to get all release groups.
#[tauri::command]
pub async fn get_artist_discography_mb(
    artist_name: String,
) -> Result<Vec<MbDiscographyItem>, String> {
    let client = mb_client()?;

    // ── 1. Resolve MBID ───────────────────────────────────────────────────────
    let search_resp = client
        .get(format!("{}/artist", MB_API_BASE))
        .query(&[
            ("query", format!("artist:\"{}\"", artist_name)),
            ("limit", "1".into()),
            ("fmt", "json".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("MB search error: {}", e))?;

    let search_data: MbArtistSearchResponse = search_resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let mbid = match search_data.artists.and_then(|v| v.into_iter().next()) {
        Some(a) => a.id,
        None => return Ok(vec![]),
    };

    sleep(Duration::from_millis(1100)).await;

    // ── 2. Browse release-groups by MBID ──────────────────────────────────────
    let browse_resp = client
        .get(format!("{}/release-group", MB_API_BASE))
        .query(&[("artist", mbid.as_str()), ("limit", "100"), ("fmt", "json")])
        .send()
        .await
        .map_err(|e| format!("MB browse error: {}", e))?;

    if !browse_resp.status().is_success() {
        return Ok(vec![]);
    }

    let data: MbReleaseGroupBrowseResponse = browse_resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let mut items: Vec<MbDiscographyItem> = data
        .release_groups
        .unwrap_or_default()
        .into_iter()
        .map(|rg| {
            let cover_url = format!("https://coverartarchive.org/release-group/{}/front-250", rg.id);
            MbDiscographyItem {
                mbid: rg.id,
                title: rg.title,
                year: rg.first_release_date.as_deref().map(year_from_date),
                release_type: release_type_label(&rg.primary_type, &rg.secondary_types),
                cover_url,
            }
        })
        .collect();

    // Sort newest-first; items without a year sink to the bottom
    items.sort_by(|a, b| match (&b.year, &a.year) {
        (Some(y1), Some(y2)) => y1.cmp(y2),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    Ok(items)
}
// ── Discovery search types & commands ────────────────────────────────────────

/// Raw MB artist search result with optional area for discovery.
#[derive(Debug, Deserialize)]
struct MbArtistSearchResultRaw {
    id: String,
    name: String,
    disambiguation: Option<String>,
    #[serde(rename = "type")]
    artist_type: Option<String>,
    country: Option<String>,
    tags: Option<Vec<MbTag>>,
    genres: Option<Vec<MbTag>>,
    #[serde(rename = "life-span")]
    life_span: Option<MbLifeSpan>,
}

#[derive(Debug, Deserialize)]
struct MbLifeSpan {
    begin: Option<String>,
    end: Option<String>,
    ended: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MbArtistSearchMultiResponse {
    artists: Option<Vec<MbArtistSearchResultRaw>>,
}

/// Raw MB release-group search result for discovery.
#[derive(Debug, Deserialize)]
struct MbReleaseGroupSearchRaw {
    id: String,
    title: String,
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
    #[serde(rename = "secondary-types")]
    secondary_types: Option<Vec<String>>,
    #[serde(rename = "first-release-date")]
    first_release_date: Option<String>,
    #[serde(rename = "artist-credit")]
    artist_credit: Option<Vec<MbArtistCredit>>,
    tags: Option<Vec<MbTag>>,
    releases: Option<Vec<MbReleaseInGroup>>,
}

#[derive(Debug, Deserialize)]
struct MbArtistCredit {
    name: Option<String>,
    artist: Option<MbArtistCreditArtist>,
}

#[derive(Debug, Deserialize)]
struct MbArtistCreditArtist {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct MbReleaseInGroup {
    id: String,
    country: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupSearchMultiResponse {
    #[serde(rename = "release-groups")]
    release_groups: Option<Vec<MbReleaseGroupSearchRaw>>,
}

// ── Public discovery result types ─────────────────────────────────────────────

/// A single artist result from a MusicBrainz discovery search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbDiscoverArtist {
    pub mbid: String,
    pub name: String,
    pub disambiguation: Option<String>,
    pub artist_type: Option<String>,
    pub country: Option<String>,
    pub genres: Vec<String>,
    pub active_years: Option<String>,
}

/// A single release-group result from a MusicBrainz discovery search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MbDiscoverRelease {
    pub mbid: String,
    pub title: String,
    pub artist_name: String,
    pub artist_mbid: Option<String>,
    pub release_type: String,
    pub year: Option<String>,
    pub country: Option<String>,
    pub genres: Vec<String>,
}

/// Search MusicBrainz for artists matching `query`. Returns up to `limit`
/// results (max 25). Single HTTP request.
#[tauri::command]
pub async fn search_artists_mb(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<MbDiscoverArtist>, String> {
    let client = mb_client()?;
    let lim = limit.unwrap_or(15).min(25);

    let resp = client
        .get(format!("{}/artist", MB_API_BASE))
        .query(&[
            ("query", query.as_str()),
            ("limit", &lim.to_string()),
            ("fmt", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("MB search error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MB returned {}", resp.status()));
    }

    let data: MbArtistSearchMultiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let results = data
        .artists
        .unwrap_or_default()
        .into_iter()
        .map(|a| {
            let genres = collect_genres(a.tags.as_ref(), a.genres.as_ref(), 5);
            let active_years = a.life_span.map(|ls| {
                let begin = ls
                    .begin
                    .as_deref()
                    .map(year_from_date)
                    .unwrap_or_default();
                let end = if ls.ended.unwrap_or(false) {
                    ls.end
                        .as_deref()
                        .map(year_from_date)
                        .unwrap_or_else(|| "?".into())
                } else {
                    "present".into()
                };
                if begin.is_empty() {
                    return String::new();
                }
                format!("{} – {}", begin, end)
            }).filter(|s| !s.is_empty());

            MbDiscoverArtist {
                mbid: a.id,
                name: a.name,
                disambiguation: a.disambiguation.filter(|d| !d.is_empty()),
                artist_type: a.artist_type,
                country: a.country.filter(|c| !c.is_empty()),
                genres,
                active_years,
            }
        })
        .collect();

    Ok(results)
}

/// Search MusicBrainz for release groups (albums/EPs/singles) matching `query`.
/// Returns up to `limit` results (max 25). Single HTTP request.
#[tauri::command]
pub async fn search_releases_mb(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<MbDiscoverRelease>, String> {
    let client = mb_client()?;
    let lim = limit.unwrap_or(15).min(25);

    let resp = client
        .get(format!("{}/release-group", MB_API_BASE))
        .query(&[
            ("query", query.as_str()),
            ("limit", &lim.to_string()),
            ("fmt", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("MB search error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MB returned {}", resp.status()));
    }

    let data: MbReleaseGroupSearchMultiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let results = data
        .release_groups
        .unwrap_or_default()
        .into_iter()
        .map(|rg| {
            let (artist_name, artist_mbid) = rg
                .artist_credit
                .and_then(|ac| ac.into_iter().next())
                .map(|ac| {
                    let name = ac.name.unwrap_or_else(|| {
                        ac.artist.as_ref().map(|a| a.name.clone()).unwrap_or_default()
                    });
                    let mbid = ac.artist.map(|a| a.id);
                    (name, mbid)
                })
                .unwrap_or_else(|| ("Unknown Artist".into(), None));

            let country = rg
                .releases
                .and_then(|rels| {
                    rels.into_iter()
                        .find_map(|r| r.country.filter(|c| !c.is_empty()))
                });

            let genres = collect_genres(rg.tags.as_ref(), None, 3);

            MbDiscoverRelease {
                mbid: rg.id,
                title: rg.title,
                artist_name,
                artist_mbid,
                release_type: release_type_label(&rg.primary_type, &rg.secondary_types),
                year: rg.first_release_date.as_deref().map(year_from_date),
                country,
                genres,
            }
        })
        .collect();

    Ok(results)
}