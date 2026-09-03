// android auto / aaos browse-tree interpreter
//
// this module is what the kotlin-side MediaBrowserServiceCompat calls into:
// give it a node id, get back that node's children as a flat, display-ready list 
// everything about the tree's shape (which categories exist, what counts as "home", how ids are formed) lives here
//
// not yet wired to any ipc => kotlin calling into these functions directly
// (bypassing the webview/js hop) is the next step, not this one
//
// id scheme:
//   root                     => the 3 tabs: home, recents, library
//   cat:home                 => home sections (favorites / top artists / top albums)
//   cat:home:favorites       => liked tracks                         (leaves: track:<id>)
//   cat:home:top_artists     => this month's most-played artists     (leaves: artist:<name>)
//   cat:home:top_albums      => this month's most-played albums      (leaves: album:<id>)
//   cat:recents              => last 15 played tracks, dedupe-by-bump (leaves: track:<id>)
//   cat:library              => the 4 chips: tracks / albums / artists / playlists
//   cat:library:tracks       => full track list, paginated
//   cat:library:albums       => every album                          (leaves: album:<id>)
//   cat:library:artists      => every artist                         (leaves: artist:<name>)
//   cat:library:playlists    => every playlist                       (leaves: playlist:<id>)
//   album:<id>               => that album's tracks                  (leaves: track:<id>)
//   artist:<name>            => that artist's tracks                 (leaves: track:<id>)
//   playlist:<id>            => that playlist's tracks               (leaves: track:<id>)
//   track:<id>               => leaf, not browsable, resolved via resolve_leaf() to play it

use rusqlite::Connection;
use serde::Serialize;

use crate::db::{albums, likes, playlists, stats, tracks};
use crate::db::models::{Album, Artist, Playlist, Track};

#[cfg(target_os = "android")]
pub mod jni_bridge;


/// how many rows a single onLoadChildren response returns for the wider lists
/// this is a safety cap, not a real pagination scheme
const HOME_SECTION_LIMIT: i32 = 15;
const RECENTS_LIMIT: i32 = 15;
const LIBRARY_PAGE_LIMIT: i32 = 200;
const SEARCH_LIMIT: i32 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct BrowseNode {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub browsable: bool,
    /// raw local path or remote url (not resolved to a content:// uri here,)
    /// see the module doc comment on why that resolution happens in kotlin
    pub art_path: Option<String>,
}

/// top of the tree (the 3 tabs)
fn root_children() -> Vec<BrowseNode> {
    vec![
        BrowseNode { id: "cat:home".into(), title: "Home".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:recents".into(), title: "Recents".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:library".into(), title: "Library".into(), subtitle: None, browsable: true, art_path: None },
    ]
}

fn home_children() -> Vec<BrowseNode> {
    vec![
        BrowseNode { id: "cat:home:favorites".into(), title: "Favorite Tracks".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:home:top_artists".into(), title: "Top Artists".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:home:top_albums".into(), title: "Most Played Albums".into(), subtitle: None, browsable: true, art_path: None },
    ]
}

fn library_children() -> Vec<BrowseNode> {
    vec![
        BrowseNode { id: "cat:library:tracks".into(), title: "Tracks".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:library:albums".into(), title: "Albums".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:library:artists".into(), title: "Artists".into(), subtitle: None, browsable: true, art_path: None },
        BrowseNode { id: "cat:library:playlists".into(), title: "Playlists".into(), subtitle: None, browsable: true, art_path: None },
    ]
}

// model => node conversions ==================================================

fn track_node(t: &Track) -> BrowseNode {
    BrowseNode {
        id: format!("track:{}", t.id),
        title: t.title.clone().unwrap_or_else(|| "Unknown Title".into()),
        subtitle: t.artist.clone(),
        browsable: false,
        art_path: t.track_cover_path.clone().or_else(|| t.cover_url.clone()),
    }
}

fn album_node(a: &Album) -> BrowseNode {
    BrowseNode {
        id: format!("album:{}", a.id),
        title: a.name.clone(),
        subtitle: a.artist.clone(),
        browsable: true,
        art_path: a.art_path.clone(),
    }
}

fn artist_node(a: &Artist) -> BrowseNode {
    BrowseNode {
        // name-based id for now => see the artist-id note in db::artists
        id: format!("artist:{}", a.name),
        title: a.name.clone(),
        subtitle: format!("{} tracks", a.track_count).into(),
        browsable: true,
        art_path: None,
    }
}

fn playlist_node(p: &Playlist) -> BrowseNode {
    BrowseNode {
        id: format!("playlist:{}", p.id),
        title: p.name.clone(),
        subtitle: None,
        browsable: true,
        art_path: p.cover_url.clone(),
    }
}

// the dispatcher =============================================================

/// resolves a node id to its children
/// errors bubble up as rusqlite::Result
/// so the caller decides how to translate a query failure into an empty vs. retried browse response
pub fn resolve_children(conn: &Connection, node_id: &str) -> rusqlite::Result<Vec<BrowseNode>> {
    if node_id == "root" {
        return Ok(root_children());
    }
    if node_id == "cat:home" {
        return Ok(home_children());
    }
    if node_id == "cat:library" {
        return Ok(library_children());
    }

    if node_id == "cat:home:favorites" {
        let tracks = likes::get_liked_tracks(conn)?;
        return Ok(tracks.iter().take(HOME_SECTION_LIMIT as usize).map(track_node).collect());
    }
    if node_id == "cat:home:top_artists" {
        let artists = stats::get_top_artists(conn, HOME_SECTION_LIMIT)?;
        return Ok(artists.iter().map(|a| BrowseNode {
            id: format!("artist:{}", a.artist),
            title: a.artist.clone(),
            subtitle: Some(format!("{} plays this month", a.play_count)),
            browsable: true,
            art_path: None,
        }).collect());
    }
    if node_id == "cat:home:top_albums" {
        let albums = stats::get_top_albums(conn, HOME_SECTION_LIMIT)?;
        return Ok(albums.iter().map(|a| album_node(&a.album)).collect());
    }

    if node_id == "cat:recents" {
        let tracks = stats::get_recently_played(conn, RECENTS_LIMIT)?;
        return Ok(tracks.iter().map(track_node).collect());
    }

    if node_id == "cat:library:tracks" {
        let tracks = tracks::get_tracks_paginated(conn, LIBRARY_PAGE_LIMIT, 0)?;
        return Ok(tracks.iter().map(track_node).collect());
    }
    if node_id == "cat:library:albums" {
        let albums = albums::get_all_albums_lightweight(conn)?;
        return Ok(albums.iter().map(album_node).collect());
    }
    if node_id == "cat:library:artists" {
        let artists = albums::get_all_artists(conn)?;
        return Ok(artists.iter().map(artist_node).collect());
    }
    if node_id == "cat:library:playlists" {
        let playlists = playlists::get_all_playlists(conn)?;
        return Ok(playlists.iter().map(playlist_node).collect());
    }

    if let Some(id) = node_id.strip_prefix("album:") {
        let album_id: i64 = match id.parse() { Ok(v) => v, Err(_) => return Ok(vec![]) };
        let tracks = albums::get_tracks_by_album(conn, album_id)?;
        return Ok(tracks.iter().map(track_node).collect());
    }
    if let Some(name) = node_id.strip_prefix("artist:") {
        let tracks = albums::get_tracks_by_artist(conn, name)?;
        return Ok(tracks.iter().map(track_node).collect());
    }
    if let Some(id) = node_id.strip_prefix("playlist:") {
        let playlist_id: i64 = match id.parse() { Ok(v) => v, Err(_) => return Ok(vec![]) };
        let tracks = playlists::get_playlist_tracks(conn, playlist_id)?;
        return Ok(tracks.iter().map(track_node).collect());
    }

    // track:<id> and anything unrecognized are leaves => no children
    Ok(vec![])
}

/// which library chip a search is scoped to, matching the 4 chips in cat:library
pub enum SearchScope {
    Tracks,
    Albums,
    Artists,
    Playlists,
}

/// scoped search => a query only ever searches within the one type the user is currently browsing
pub fn search_scoped(conn: &Connection, scope: SearchScope, query: &str) -> rusqlite::Result<Vec<BrowseNode>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    match scope {
        SearchScope::Tracks => {
            let tracks = tracks::search_tracks(conn, query, SEARCH_LIMIT, 0)?;
            Ok(tracks.iter().map(track_node).collect())
        }
        SearchScope::Albums => {
            let albums = albums::search_albums_by_name(conn, query, SEARCH_LIMIT)?;
            Ok(albums.iter().map(album_node).collect())
        }
        SearchScope::Artists => {
            let artists = albums::search_artists_by_name(conn, query, SEARCH_LIMIT)?;
            Ok(artists.iter().map(artist_node).collect())
        }
        SearchScope::Playlists => {
            let playlists = playlists::search_playlists_by_name(conn, query, SEARCH_LIMIT)?;
            Ok(playlists.iter().map(playlist_node).collect())
        }
    }
}

/// resolves a single track leaf id to the underlying track,
/// for when auto/ bluetooth asks to play a specific media id directly rather than browsing to it first (e.g. resuming a session, or a voice action)
pub fn resolve_leaf(conn: &Connection, node_id: &str) -> rusqlite::Result<Option<Track>> {
    if let Some(id) = node_id.strip_prefix("track:") {
        let track_id: i64 = match id.parse() { Ok(v) => v, Err(_) => return Ok(None) };
        return tracks::get_track_by_id(conn, track_id);
    }
    Ok(None)
}
