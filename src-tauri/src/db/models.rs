// Model structs shared across all db sub-modules
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_id: Option<i64>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
    pub local_src: Option<String>,
    pub track_cover: Option<String>,
    pub track_cover_path: Option<String>,
    pub disc_number: Option<i32>,
    pub metadata_json: Option<String>,
    pub date_added: Option<String>,
    /// individual artist names derived from artist via the split rules in original order
    /// `artist` keeps the raw display string as is
    /// not yet populated by every query that returns a `Track`
    /// see attach_artists callers for which ones currently fill this in
    #[serde(default)]
    pub artists: Vec<String>,
}

/// whether album artist comes from the file's own AlbumArtist tag when present
/// or is always derived from the first scanned track's artist
/// commands::app_settings re exports this type for the get/set_album_artist_mode tauri commands
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AlbumArtistMode {
    /// use the file's AlbumArtist tag when present,
    /// fall back to first track's artist only when no track in the album has one
    TagIfPresent,
    /// ignore AlbumArtist tags entirely
    /// always use first scanned track's artist
    /// current behavior. kept as default , so after update, change is opt in
    #[default]
    FirstTrack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: i64,
    pub name: String,
    pub artist: Option<String>,
    pub art_data: Option<String>,
    pub art_path: Option<String>,
    /// individual album artist names derived from artist via the active split rules, in original order
    /// 'artist' keeps the raw display string as is
    /// not yet populated by every query that returns an `Album`
    /// see attach_album_artists callers for which ones fill this in
    #[serde(default)]
    pub artists: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artist {
    pub name: String,
    pub track_count: i32,
    pub album_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub created_at: Option<String>,
    pub folder_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInsert {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// raw AlbumArtist tag ,unsplit
    /// none if the file has no such tag
    /// only consulted when AlbumArtistMode::TagIfPresent is active
    /// see commands::app_settings and db::tracks::get_or_create_album
    #[serde(default)]
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_art: Option<Vec<u8>>,
    pub track_cover: Option<Vec<u8>>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
    pub content_hash: Option<String>,
    pub local_src: Option<String>,
    pub musicbrainz_recording_id: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub playlists: Vec<Playlist>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackWithCount {
    pub track: Track,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumWithCount {
    pub album: Album,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistWithCount {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsSummary {
    pub total_plays: i64,
    pub total_duration_seconds: i64,
    pub top_artist: Option<String>,
    pub top_genre: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    pub payload: Option<String>,
    pub created_at: Option<String>,
    pub retry_count: i32,
}
