use crate::db::{queries, Database};
use crate::sync::auth;
use serde::{Deserialize, Serialize};
use rusqlite::params;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderMode {
    Local,
    Server,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Library {
    pub tracks: Vec<queries::Track>,
    pub albums: Vec<queries::Album>,
    pub artists: Vec<queries::Artist>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackResponse {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i32>,
    pub album_id: Option<i64>,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub source_type: Option<String>,
    pub cover_url: Option<String>,
    pub external_id: Option<String>,
    pub local_src: Option<String>,
    pub track_cover_path: Option<String>,
    pub genre: Option<String>,
    pub metadata_json: Option<String>,
    pub date_added: Option<String>,
}

impl TrackResponse {
    pub fn to_track(&self, server_url: &str, token: Option<&str>) -> queries::Track {
        // Resolve cover_url and track_cover_path to point to the server!
        // Svelte will render it using standard img tag
        let resolved_cover_url = if let Some(tok) = token {
            Some(format!("{}/api/tracks/{}/cover?token={}", server_url, self.id, tok))
        } else {
            Some(format!("{}/api/tracks/{}/cover", server_url, self.id))
        };
        
        queries::Track {
            id: self.id,
            path: self.path.clone(),
            title: self.title.clone(),
            artist: self.artist.clone(),
            album: self.album.clone(),
            track_number: self.track_number,
            duration: self.duration,
            album_id: self.album_id,
            format: self.format.clone(),
            bitrate: self.bitrate,
            source_type: Some("server".to_string()),
            cover_url: resolved_cover_url,
            external_id: self.external_id.clone(),
            local_src: self.local_src.clone(),
            track_cover: None,
            track_cover_path: None, // force use of cover_url
            disc_number: self.disc_number,
            metadata_json: self.metadata_json.clone(),
            date_added: self.date_added.clone(),
            // server tracks don't have local track_artists rows to join against
            // so derive the split client side from the raw string
            // using the same rules as local tracks
            artists: self.artist.as_deref().map(crate::scanner::artist_parser::split_artists).unwrap_or_default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AlbumResponse {
    pub id: i64,
    pub name: String,
    pub artist: Option<String>,
    pub art_path: Option<String>,
}

impl AlbumResponse {
    pub fn to_album(&self, server_url: &str, token: Option<&str>) -> queries::Album {
        // Resolve art_path as a full HTTP URL in art_data so getAlbumCoverSrc returns it directly!
        let resolved_art_url = if let Some(tok) = token {
            Some(format!("{}/api/albums/{}/artwork?token={}", server_url, self.id, tok))
        } else {
            Some(format!("{}/api/albums/{}/artwork", server_url, self.id))
        };
        queries::Album {
            id: self.id,
            name: self.name.clone(),
            artist: self.artist.clone(),
            artists: Vec::new(),
            art_data: resolved_art_url, // passed in art_data to bypass tauri local asset URL converter
            art_path: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArtistResponse {
    pub name: String,
    pub track_count: i32,
    pub album_count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlaylistResponse {
    pub id: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub created_at: Option<String>,
}

impl PlaylistResponse {
    pub fn to_playlist(&self, server_url: &str, token: Option<&str>) -> queries::Playlist {
        let cover_url = self.cover_url.as_ref().map(|url| {
            let full_url = if url.starts_with('/') {
                format!("{}{}", server_url, url)
            } else {
                url.clone()
            };
            if full_url.starts_with(server_url) {
                if let Some(tok) = token {
                    if full_url.contains('?') {
                        format!("{}&token={}", full_url, tok)
                    } else {
                        format!("{}?token={}", full_url, tok)
                    }
                } else {
                    full_url
                }
            } else {
                full_url
            }
        });

        queries::Playlist {
            id: self.id,
            name: self.name.clone(),
            created_at: self.created_at.clone(),
            folder_path: None,
            cover_url,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResults {
    pub tracks: Vec<TrackResponse>,
    pub albums: Vec<AlbumResponse>,
    pub artists: Vec<ArtistResponse>,
}

pub trait LibraryProvider: Send + Sync {
    // Tracks
    async fn get_tracks_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String>;
    async fn get_albums_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Album>, String>;
    async fn search_library(&self, query: &str, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String>;
    async fn get_tracks_by_album(&self, album_id: i64) -> Result<Vec<queries::Track>, String>;
    async fn get_tracks_by_artist(&self, artist: &str) -> Result<Vec<queries::Track>, String>;
    async fn get_album(&self, album_id: i64) -> Result<Option<queries::Album>, String>;
    async fn get_albums_by_artist(&self, artist: &str) -> Result<Vec<queries::Album>, String>;
    async fn get_library(&self) -> Result<Library, String>;
    async fn delete_track(&self, track_id: i64) -> Result<bool, String>;
    async fn delete_album(&self, album_id: i64) -> Result<bool, String>;

    // Playlists
    async fn create_playlist(&self, name: &str, cover_url: Option<&str>) -> Result<i64, String>;
    async fn get_playlists(&self) -> Result<Vec<queries::Playlist>, String>;
    async fn get_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<queries::Track>, String>;
    /// track count per playlist id, keyed by playlist_id
    /// playlists with zero tracks are absent from the map 
    /// default impl fans out to get_playlist_tracks per playlist (used by providers without a
    /// dedicated batch-count endpoint)
    /// LocalProvider overrides this with a single grouped SQL query
    async fn get_playlist_track_counts(
        &self,
        playlist_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, i64>, String> {
        let mut counts = std::collections::HashMap::new();
        for &id in playlist_ids {
            let tracks = self.get_playlist_tracks(id).await?;
            counts.insert(id, tracks.len() as i64);
        }
        Ok(counts)
    }
    async fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String>;
    async fn remove_track_from_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String>;
    async fn delete_playlist(&self, playlist_id: i64) -> Result<(), String>;
    async fn rename_playlist(&self, playlist_id: i64, new_name: &str) -> Result<(), String>;
    async fn update_playlist_cover(&self, playlist_id: i64, cover_url: Option<&str>) -> Result<(), String>;
    async fn reorder_playlist_tracks(&self, playlist_id: i64, from_index: i64, to_index: i64) -> Result<(), String>;

    // Liked tracks (Activity)
    async fn like_track(&self, track_id: i64) -> Result<(), String>;
    async fn unlike_track(&self, track_id: i64) -> Result<(), String>;
    async fn is_track_liked(&self, track_id: i64) -> Result<bool, String>;
    async fn get_liked_track_ids(&self) -> Result<Vec<i64>, String>;
    async fn get_liked_tracks(&self) -> Result<Vec<queries::Track>, String>;
}

pub fn resolve_server_url(url: &str, server_url: &str, token: Option<&str>) -> String {
    let server_url = server_url.trim_end_matches('/');
    let is_custom_server = url.starts_with('/') || url.starts_with(server_url);
    if is_custom_server {
        if let Some(idx) = url.find("/api/") {
            let relative_path = &url[idx..];
            let clean_path = if let Some(q_idx) = relative_path.find('?') {
                &relative_path[..q_idx]
            } else {
                relative_path
            };
            if let Some(tok) = token {
                return format!("{}{}{}token={}", server_url, clean_path, if clean_path.contains('?') { "&" } else { "?" }, tok);
            } else {
                return format!("{}{}", server_url, clean_path);
            }
        }
    }
    url.to_string()
}

pub fn resolve_track(track: &mut queries::Track, server_url: &str, token: Option<&str>) {
    if let Some(ref url) = track.cover_url {
        track.cover_url = Some(resolve_server_url(url, server_url, token));
    }
}

pub fn resolve_tracks(tracks: &mut [queries::Track], server_url: &str, token: Option<&str>) {
    for track in tracks {
        resolve_track(track, server_url, token);
    }
}

pub fn resolve_album(album: &mut queries::Album, server_url: &str, token: Option<&str>) {
    if let Some(ref url) = album.art_data {
        album.art_data = Some(resolve_server_url(url, server_url, token));
    }
}

pub fn resolve_albums(albums: &mut [queries::Album], server_url: &str, token: Option<&str>) {
    for album in albums {
        resolve_album(album, server_url, token);
    }
}

pub fn resolve_playlist(playlist: &mut queries::Playlist, server_url: &str, token: Option<&str>) {
    if let Some(ref url) = playlist.cover_url {
        playlist.cover_url = Some(resolve_server_url(url, server_url, token));
    }
}

pub fn resolve_playlists(playlists: &mut [queries::Playlist], server_url: &str, token: Option<&str>) {
    for playlist in playlists {
        resolve_playlist(playlist, server_url, token);
    }
}

pub struct LocalProvider {
    pub db: Database,
    pub server_url: String,
}

impl LibraryProvider for LocalProvider {
    async fn get_tracks_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_tracks_paginated(&conn, limit, offset).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }

    async fn get_albums_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Album>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut albums = queries::get_albums_paginated(&conn, limit, offset).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_albums(&mut albums, &self.server_url, token.as_deref());
        Ok(albums)
    }

    async fn search_library(&self, query: &str, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::search_tracks(&conn, query, limit, offset).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }

    async fn get_tracks_by_album(&self, album_id: i64) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_tracks_by_album(&conn, album_id).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }

    async fn get_tracks_by_artist(&self, artist: &str) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_tracks_by_artist(&conn, artist).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }

    async fn get_album(&self, album_id: i64) -> Result<Option<queries::Album>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut album = queries::get_album_by_id(&conn, album_id).map_err(|e| e.to_string())?;
        if let Some(ref mut alb) = album {
            let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
            resolve_album(alb, &self.server_url, token.as_deref());
        }
        Ok(album)
    }

    async fn get_albums_by_artist(&self, artist: &str) -> Result<Vec<queries::Album>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT a.id, a.name, a.artist, a.art_data, a.art_path 
                 FROM albums a
                 INNER JOIN tracks t ON t.album_id = a.id
                 INNER JOIN track_artists ta ON ta.track_id = t.id
                 INNER JOIN artists ar ON ar.id = ta.artist_id
                 WHERE ar.name = ?1 COLLATE NOCASE
                 ORDER BY a.name",
            )
            .map_err(|e| e.to_string())?;

        let mut albums = stmt
            .query_map([artist], |row| {
                Ok(queries::Album {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    artist: row.get(2)?,
                    artists: Vec::new(),
                    art_data: row.get(3)?,
                    art_path: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_albums(&mut albums, &self.server_url, token.as_deref());
        Ok(albums)
    }

    async fn get_library(&self) -> Result<Library, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_all_tracks_with_paths(&conn).map_err(|e| e.to_string())?;
        let mut albums = queries::get_all_albums_with_paths(&conn).map_err(|e| e.to_string())?;
        let artists = queries::get_all_artists(&conn).map_err(|e| e.to_string())?;
        
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        resolve_albums(&mut albums, &self.server_url, token.as_deref());
        
        Ok(Library { tracks, albums, artists })
    }

    async fn delete_track(&self, track_id: i64) -> Result<bool, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::delete_track(&conn, track_id).map_err(|e| e.to_string())
    }

    async fn delete_album(&self, album_id: i64) -> Result<bool, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::delete_album(&conn, album_id).map_err(|e| e.to_string())
    }

    async fn create_playlist(&self, name: &str, cover_url: Option<&str>) -> Result<i64, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let id = queries::create_playlist(&conn, name, cover_url).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let payload = serde_json::json!({
                "name": name,
                "coverUrl": cover_url
            })
            .to_string();
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist",
                &format!("local_{}", id),
                "create",
                Some(&payload),
            );
        }
        Ok(id)
    }

    async fn get_playlists(&self) -> Result<Vec<queries::Playlist>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut playlists = queries::get_all_playlists(&conn).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_playlists(&mut playlists, &self.server_url, token.as_deref());
        Ok(playlists)
    }

    async fn get_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_playlist_tracks(&conn, playlist_id).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }

    async fn get_playlist_track_counts(
        &self,
        playlist_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, i64>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let all_counts = queries::get_playlist_track_counts(&conn).map_err(|e| e.to_string())?;
        let requested_ids: std::collections::HashSet<i64> = playlist_ids.iter().copied().collect();
        // only return counts for the requested ids (playlists not in
        // all_counts have zero tracks and are omitted)
        Ok(all_counts
            .into_iter()
            .filter(|(id, _)| requested_ids.contains(id))
            .collect())
    }

    async fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::add_track_to_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let position: i32 = conn.query_row(
                "SELECT COALESCE(position, 0) FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
                params![playlist_id, track_id],
                |row| row.get(0),
            ).unwrap_or(0);

            let mut payload = serde_json::json!({
                "playlistId": format!("local_{}", playlist_id),
                "position": position,
            });
            if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
                let track_hash = queries::build_track_hash_str(
                    track.title.as_deref(),
                    track.artist.as_deref(),
                    track.album.as_deref(),
                );
                payload["trackHash"] = serde_json::Value::String(track_hash);
                payload["title"] = serde_json::json!(track.title);
                payload["artist"] = serde_json::json!(track.artist);
                payload["album"] = serde_json::json!(track.album);
                payload["duration"] = serde_json::json!(track.duration);
                payload["externalId"] = serde_json::json!(track.external_id);
                payload["sourceType"] = serde_json::json!(track.source_type);
                payload["coverUrl"] = serde_json::json!(track.cover_url);
            }
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist_track",
                &format!("local_{}_{}", playlist_id, track_id),
                "create",
                Some(&payload.to_string()),
            );
        }
        Ok(())
    }

    async fn remove_track_from_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::remove_track_from_playlist(&conn, playlist_id, track_id).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let payload = serde_json::json!({
                "playlistId": format!("local_{}", playlist_id),
            })
            .to_string();
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist_track",
                &format!("local_{}_{}", playlist_id, track_id),
                "delete",
                Some(&payload),
            );
        }
        Ok(())
    }

    async fn delete_playlist(&self, playlist_id: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::delete_playlist(&conn, playlist_id).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist",
                &format!("local_{}", playlist_id),
                "delete",
                None,
            );
        }
        Ok(())
    }

    async fn rename_playlist(&self, playlist_id: i64, new_name: &str) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::rename_playlist(&conn, playlist_id, new_name).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let payload = serde_json::json!({ "name": new_name }).to_string();
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist",
                &format!("local_{}", playlist_id),
                "update",
                Some(&payload),
            );
        }
        Ok(())
    }

    async fn update_playlist_cover(&self, playlist_id: i64, cover_url: Option<&str>) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::update_playlist_cover(&conn, playlist_id, cover_url).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let payload = serde_json::json!({ "coverUrl": cover_url }).to_string();
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist",
                &format!("local_{}", playlist_id),
                "update",
                Some(&payload),
            );
        }
        Ok(())
    }

    async fn reorder_playlist_tracks(&self, playlist_id: i64, from_index: i64, to_index: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT track_id, position FROM playlist_tracks 
             WHERE playlist_id = ?1 
             ORDER BY position",
            )
            .map_err(|e| e.to_string())?;

        let tracks: Vec<(i64, i64)> = stmt
            .query_map([playlist_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if tracks.is_empty() {
            return Err("Playlist is empty".to_string());
        }

        let mut track_ids: Vec<i64> = tracks.iter().map(|(id, _)| *id).collect();
        let moved_track_id = track_ids.remove(from_index as usize);
        track_ids.insert(to_index as usize, moved_track_id);

        conn.execute("BEGIN TRANSACTION", []).map_err(|e| e.to_string())?;
        for (new_position, track_id) in track_ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlist_tracks 
                 SET position = ?1 
                 WHERE playlist_id = ?2 AND track_id = ?3",
                params![new_position as i64, playlist_id, track_id],
            )
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                e.to_string()
            })?;
        }
        conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let payload = serde_json::json!({
                "playlistId": format!("local_{}", playlist_id),
                "fromIndex": from_index,
                "toIndex": to_index,
            })
            .to_string();
            let _ = queries::enqueue_sync_change(
                &conn,
                "playlist_track",
                &format!("local_{}_reorder", playlist_id),
                "update",
                Some(&payload),
            );
        }
        Ok(())
    }

    async fn like_track(&self, track_id: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::like_track(&conn, track_id).map_err(|e| e.to_string())?;

        // Enqueue sync change
        if queries::is_logged_in(&conn) {
            let mut payload = serde_json::json!({});
            if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
                let track_hash = queries::build_track_hash_str(
                    track.title.as_deref(),
                    track.artist.as_deref(),
                    track.album.as_deref(),
                );
                payload["trackHash"] = serde_json::Value::String(track_hash);
                payload["title"] = serde_json::json!(track.title);
                payload["artist"] = serde_json::json!(track.artist);
                payload["album"] = serde_json::json!(track.album);
                payload["duration"] = serde_json::json!(track.duration);
                payload["externalId"] = serde_json::json!(track.external_id);
                payload["sourceType"] = serde_json::json!(track.source_type);
                payload["coverUrl"] = serde_json::json!(track.cover_url);
            }
            let _ = queries::enqueue_sync_change(
                &conn,
                "liked_track",
                &format!("local_liked_{}", track_id),
                "create",
                Some(&payload.to_string()),
            );
        }
        Ok(())
    }

    async fn unlike_track(&self, track_id: i64) -> Result<(), String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;

        let mut payload = serde_json::json!({});
        let logged_in = queries::is_logged_in(&conn);
        if logged_in {
            if let Ok(Some(track)) = queries::get_track_by_id(&conn, track_id) {
                let track_hash = queries::build_track_hash_str(
                    track.title.as_deref(),
                    track.artist.as_deref(),
                    track.album.as_deref(),
                );
                payload["trackHash"] = serde_json::Value::String(track_hash);
            }
        }

        queries::unlike_track(&conn, track_id).map_err(|e| e.to_string())?;

        if logged_in {
            let _ = queries::enqueue_sync_change(
                &conn,
                "liked_track",
                &format!("local_liked_{}", track_id),
                "delete",
                Some(&payload.to_string()),
            );
        }
        Ok(())
    }

    async fn is_track_liked(&self, track_id: i64) -> Result<bool, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::is_track_liked(&conn, track_id).map_err(|e| e.to_string())
    }

    async fn get_liked_track_ids(&self) -> Result<Vec<i64>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        queries::get_liked_track_ids(&conn).map_err(|e| e.to_string())
    }

    async fn get_liked_tracks(&self) -> Result<Vec<queries::Track>, String> {
        let conn = self.db.conn.lock().map_err(|e| e.to_string())?;
        let mut tracks = queries::get_liked_tracks(&conn).map_err(|e| e.to_string())?;
        let token = queries::get_sync_meta(&conn, "access_token").ok().flatten();
        resolve_tracks(&mut tracks, &self.server_url, token.as_deref());
        Ok(tracks)
    }
}

pub struct ServerProvider {
    pub db: Database,
    pub server_url: String,
}

impl ServerProvider {
    async fn request_json<T: serde::de::DeserializeOwned>(&self, method: &str, path: &str, body: Option<&str>) -> Result<T, String> {
        let resp = auth::authenticated_request(&self.db, &self.server_url, method, path, body).await?;
        serde_json::from_str(&resp).map_err(|e| format!("Failed to parse JSON response: {} — Raw response: {}", e, resp))
    }
    
    async fn request_empty(&self, method: &str, path: &str, body: Option<&str>) -> Result<(), String> {
        let _ = auth::authenticated_request(&self.db, &self.server_url, method, path, body).await?;
        Ok(())
    }
}

fn encode_path_segment(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>()
}

impl LibraryProvider for ServerProvider {
    async fn get_tracks_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String> {
        let page = (offset / limit) + 1;
        let path = format!("/api/tracks?page={}&limit={}", page, limit);
        let res: Vec<TrackResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }

    async fn get_albums_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Album>, String> {
        let page = (offset / limit) + 1;
        let path = format!("/api/albums?page={}&limit={}", page, limit);
        let res: Vec<AlbumResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|a| a.to_album(&self.server_url, token.as_deref())).collect())
    }

    async fn search_library(&self, query: &str, _limit: i32, _offset: i32) -> Result<Vec<queries::Track>, String> {
        let url_encoded = encode_path_segment(query);
        let path = format!("/api/search?q={}", url_encoded);
        let res: SearchResults = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.tracks.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }

    async fn get_tracks_by_album(&self, album_id: i64) -> Result<Vec<queries::Track>, String> {
        let path = format!("/api/albums/{}/tracks", album_id);
        let res: Vec<TrackResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }

    async fn get_tracks_by_artist(&self, artist: &str) -> Result<Vec<queries::Track>, String> {
        let artist_encoded = encode_path_segment(artist);
        let path = format!("/api/artists/{}/tracks", artist_encoded);
        let res: Vec<TrackResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }

    async fn get_album(&self, album_id: i64) -> Result<Option<queries::Album>, String> {
        let path = format!("/api/albums/{}", album_id);
        let res: AlbumResponse = match self.request_json("GET", &path, None).await {
            Ok(a) => a,
            Err(_) => return Ok(None),
        };
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(Some(res.to_album(&self.server_url, token.as_deref())))
    }

    async fn get_albums_by_artist(&self, artist: &str) -> Result<Vec<queries::Album>, String> {
        let artist_encoded = encode_path_segment(artist);
        let path = format!("/api/artists/{}/albums", artist_encoded);
        let res: Vec<AlbumResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|a| a.to_album(&self.server_url, token.as_deref())).collect())
    }

    async fn get_library(&self) -> Result<Library, String> {
        let tracks: Vec<TrackResponse> = self.request_json("GET", "/api/tracks?limit=10000", None).await?;
        let albums: Vec<AlbumResponse> = self.request_json("GET", "/api/albums?limit=10000", None).await?;
        let artists: Vec<ArtistResponse> = self.request_json("GET", "/api/artists", None).await?;
        
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(Library {
            tracks: tracks.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect(),
            albums: albums.iter().map(|a| a.to_album(&self.server_url, token.as_deref())).collect(),
            artists: artists.iter().map(|a| queries::Artist {
                name: a.name.clone(),
                track_count: a.track_count,
                album_count: a.album_count,
            }).collect(),
        })
    }

    async fn delete_track(&self, track_id: i64) -> Result<bool, String> {
        let path = format!("/api/tracks/{}", track_id);
        self.request_empty("DELETE", &path, None).await?;
        Ok(true)
    }

    async fn delete_album(&self, _album_id: i64) -> Result<bool, String> {
        Ok(true)
    }

    async fn create_playlist(&self, name: &str, cover_url: Option<&str>) -> Result<i64, String> {
        let body = serde_json::json!({
            "name": name,
            "cover_url": cover_url
        }).to_string();
        let res: PlaylistResponse = self.request_json("POST", "/api/playlists", Some(&body)).await?;
        Ok(res.id)
    }

    async fn get_playlists(&self) -> Result<Vec<queries::Playlist>, String> {
        let res: Vec<PlaylistResponse> = self.request_json("GET", "/api/playlists", None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|p| p.to_playlist(&self.server_url, token.as_deref())).collect())
    }

    async fn get_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<queries::Track>, String> {
        let path = format!("/api/playlists/{}/tracks", playlist_id);
        let res: Vec<TrackResponse> = self.request_json("GET", &path, None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(res.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }

    async fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        let path = format!("/api/playlists/{}/tracks", playlist_id);
        let body = serde_json::json!({
            "track_id": track_id
        }).to_string();
        self.request_empty("POST", &path, Some(&body)).await
    }

    async fn remove_track_from_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        let path = format!("/api/playlists/{}/tracks/{}", playlist_id, track_id);
        self.request_empty("DELETE", &path, None).await
    }

    async fn delete_playlist(&self, playlist_id: i64) -> Result<(), String> {
        let path = format!("/api/playlists/{}", playlist_id);
        self.request_empty("DELETE", &path, None).await
    }

    async fn rename_playlist(&self, playlist_id: i64, new_name: &str) -> Result<(), String> {
        let playlist: PlaylistResponse = self.request_json("GET", &format!("/api/playlists/{}", playlist_id), None).await?;
        let body = serde_json::json!({
            "name": new_name,
            "cover_url": playlist.cover_url
        }).to_string();
        let path = format!("/api/playlists/{}", playlist_id);
        self.request_json::<PlaylistResponse>("PUT", &path, Some(&body)).await?;
        Ok(())
    }

    async fn update_playlist_cover(&self, playlist_id: i64, cover_url: Option<&str>) -> Result<(), String> {
        let playlist: PlaylistResponse = self.request_json("GET", &format!("/api/playlists/{}", playlist_id), None).await?;
        let body = serde_json::json!({
            "name": playlist.name,
            "cover_url": cover_url
        }).to_string();
        let path = format!("/api/playlists/{}", playlist_id);
        self.request_json::<PlaylistResponse>("PUT", &path, Some(&body)).await?;
        Ok(())
    }

    async fn reorder_playlist_tracks(&self, playlist_id: i64, from_index: i64, to_index: i64) -> Result<(), String> {
        let path = format!("/api/playlists/{}/tracks/reorder", playlist_id);
        let body = serde_json::json!({
            "from_index": from_index,
            "to_index": to_index
        }).to_string();
        self.request_empty("PUT", &path, Some(&body)).await
    }

    async fn like_track(&self, track_id: i64) -> Result<(), String> {
        let path = format!("/api/liked/{}", track_id);
        self.request_empty("POST", &path, None).await
    }

    async fn unlike_track(&self, track_id: i64) -> Result<(), String> {
        let path = format!("/api/liked/{}", track_id);
        self.request_empty("DELETE", &path, None).await
    }

    async fn is_track_liked(&self, track_id: i64) -> Result<bool, String> {
        let liked: Vec<TrackResponse> = self.request_json("GET", "/api/liked", None).await?;
        Ok(liked.iter().any(|t| t.id == track_id))
    }

    async fn get_liked_track_ids(&self) -> Result<Vec<i64>, String> {
        let liked: Vec<TrackResponse> = self.request_json("GET", "/api/liked", None).await?;
        Ok(liked.iter().map(|t| t.id).collect())
    }

    async fn get_liked_tracks(&self) -> Result<Vec<queries::Track>, String> {
        let liked: Vec<TrackResponse> = self.request_json("GET", "/api/liked", None).await?;
        let token = auth::get_access_token(&self.db).ok().flatten();
        Ok(liked.iter().map(|t| t.to_track(&self.server_url, token.as_deref())).collect())
    }
}

// ─── Enum Dispatch ────────────────────────────────────────────────────────────
// async fn in traits makes LibraryProvider not object-safe (no Box<dyn ...>).
// Use an enum instead so callers can hold a single owned value.

pub enum ProviderEnum {
    Local(LocalProvider),
    Server(ServerProvider),
}

impl ProviderEnum {
    pub async fn get_tracks_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.get_tracks_paginated(limit, offset).await,
            Self::Server(p) => p.get_tracks_paginated(limit, offset).await,
        }
    }
    pub async fn get_albums_paginated(&self, limit: i32, offset: i32) -> Result<Vec<queries::Album>, String> {
        match self {
            Self::Local(p) => p.get_albums_paginated(limit, offset).await,
            Self::Server(p) => p.get_albums_paginated(limit, offset).await,
        }
    }
    pub async fn search_library(&self, query: &str, limit: i32, offset: i32) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.search_library(query, limit, offset).await,
            Self::Server(p) => p.search_library(query, limit, offset).await,
        }
    }
    pub async fn get_tracks_by_album(&self, album_id: i64) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.get_tracks_by_album(album_id).await,
            Self::Server(p) => p.get_tracks_by_album(album_id).await,
        }
    }
    pub async fn get_tracks_by_artist(&self, artist: &str) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.get_tracks_by_artist(artist).await,
            Self::Server(p) => p.get_tracks_by_artist(artist).await,
        }
    }
    pub async fn get_album(&self, album_id: i64) -> Result<Option<queries::Album>, String> {
        match self {
            Self::Local(p) => p.get_album(album_id).await,
            Self::Server(p) => p.get_album(album_id).await,
        }
    }
    pub async fn get_albums_by_artist(&self, artist: &str) -> Result<Vec<queries::Album>, String> {
        match self {
            Self::Local(p) => p.get_albums_by_artist(artist).await,
            Self::Server(p) => p.get_albums_by_artist(artist).await,
        }
    }
    pub async fn get_library(&self) -> Result<Library, String> {
        match self {
            Self::Local(p) => p.get_library().await,
            Self::Server(p) => p.get_library().await,
        }
    }
    pub async fn delete_track(&self, track_id: i64) -> Result<bool, String> {
        match self {
            Self::Local(p) => p.delete_track(track_id).await,
            Self::Server(p) => p.delete_track(track_id).await,
        }
    }
    pub async fn delete_album(&self, album_id: i64) -> Result<bool, String> {
        match self {
            Self::Local(p) => p.delete_album(album_id).await,
            Self::Server(p) => p.delete_album(album_id).await,
        }
    }
    pub async fn create_playlist(&self, name: &str, cover_url: Option<&str>) -> Result<i64, String> {
        match self {
            Self::Local(p) => p.create_playlist(name, cover_url).await,
            Self::Server(p) => p.create_playlist(name, cover_url).await,
        }
    }
    pub async fn get_playlists(&self) -> Result<Vec<queries::Playlist>, String> {
        match self {
            Self::Local(p) => p.get_playlists().await,
            Self::Server(p) => p.get_playlists().await,
        }
    }
    pub async fn get_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.get_playlist_tracks(playlist_id).await,
            Self::Server(p) => p.get_playlist_tracks(playlist_id).await,
        }
    }
    pub async fn get_playlist_track_counts(
        &self,
        playlist_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, i64>, String> {
        match self {
            Self::Local(p) => p.get_playlist_track_counts(playlist_ids).await,
            Self::Server(p) => p.get_playlist_track_counts(playlist_ids).await,
        }
    }
    pub async fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.add_track_to_playlist(playlist_id, track_id).await,
            Self::Server(p) => p.add_track_to_playlist(playlist_id, track_id).await,
        }
    }
    pub async fn remove_track_from_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.remove_track_from_playlist(playlist_id, track_id).await,
            Self::Server(p) => p.remove_track_from_playlist(playlist_id, track_id).await,
        }
    }
    pub async fn delete_playlist(&self, playlist_id: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.delete_playlist(playlist_id).await,
            Self::Server(p) => p.delete_playlist(playlist_id).await,
        }
    }
    pub async fn rename_playlist(&self, playlist_id: i64, new_name: &str) -> Result<(), String> {
        match self {
            Self::Local(p) => p.rename_playlist(playlist_id, new_name).await,
            Self::Server(p) => p.rename_playlist(playlist_id, new_name).await,
        }
    }
    pub async fn update_playlist_cover(&self, playlist_id: i64, cover_url: Option<&str>) -> Result<(), String> {
        match self {
            Self::Local(p) => p.update_playlist_cover(playlist_id, cover_url).await,
            Self::Server(p) => p.update_playlist_cover(playlist_id, cover_url).await,
        }
    }
    pub async fn reorder_playlist_tracks(&self, playlist_id: i64, from_index: i64, to_index: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.reorder_playlist_tracks(playlist_id, from_index, to_index).await,
            Self::Server(p) => p.reorder_playlist_tracks(playlist_id, from_index, to_index).await,
        }
    }
    pub async fn like_track(&self, track_id: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.like_track(track_id).await,
            Self::Server(p) => p.like_track(track_id).await,
        }
    }
    pub async fn unlike_track(&self, track_id: i64) -> Result<(), String> {
        match self {
            Self::Local(p) => p.unlike_track(track_id).await,
            Self::Server(p) => p.unlike_track(track_id).await,
        }
    }
    pub async fn is_track_liked(&self, track_id: i64) -> Result<bool, String> {
        match self {
            Self::Local(p) => p.is_track_liked(track_id).await,
            Self::Server(p) => p.is_track_liked(track_id).await,
        }
    }
    pub async fn get_liked_track_ids(&self) -> Result<Vec<i64>, String> {
        match self {
            Self::Local(p) => p.get_liked_track_ids().await,
            Self::Server(p) => p.get_liked_track_ids().await,
        }
    }
    pub async fn get_liked_tracks(&self) -> Result<Vec<queries::Track>, String> {
        match self {
            Self::Local(p) => p.get_liked_tracks().await,
            Self::Server(p) => p.get_liked_tracks().await,
        }
    }
}
