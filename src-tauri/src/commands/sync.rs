// Tauri IPC commands for account sync
//
// These commands are exposed to the SvelteKit frontend via `invoke()`.
// They handle: auth state, OAuth callback, sync trigger, sync status, logout.

use crate::db::Database;
use crate::sync::{self, auth, SyncState};
use tauri::State;

/// Get the current authentication state (logged in? user profile?).
#[tauri::command]
pub async fn sync_get_auth_state(db: State<'_, Database>) -> Result<auth::AuthState, String> {
    auth::get_auth_state(&db)
}

/// Handle the OAuth callback — store tokens, fetch profile, trigger initial sync.
/// Called from the deep-link handler after `audion://auth/callback?access_token=...&refresh_token=...`
#[tauri::command]
pub async fn sync_handle_auth_callback(
    access_token: String,
    refresh_token: String,
    app_handle: tauri::AppHandle,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<auth::AuthState, String> {
    tracing::info!("Handling OAuth callback — storing tokens");

    // 1. Store tokens
    auth::store_auth_tokens(&db, &access_token, &refresh_token)?;

    // 2. Fetch user profile from server
    let server_url = sync_state.server_url.lock().unwrap().clone();
    let auth_state =
        auth::fetch_and_store_profile(&db, &server_url, &access_token).await?;

    // 3. Ensure device ID exists
    auth::get_or_create_device_id(&db)?;

    // 4. Trigger initial full sync in background
    let db_clone = db.inner().clone();
    let sync_state_url = sync_state.server_url.clone();
    let is_syncing = sync_state.is_syncing.clone();
    let handle = app_handle.clone();
    tokio::spawn(async move {
        let temp_sync_state = SyncState {
            is_syncing,
            server_url: sync_state_url,
            app_handle: Some(handle),
            provider_mode: std::sync::Arc::new(std::sync::Mutex::new(crate::sync::provider::ProviderMode::Local)),
            sse_join_handle: std::sync::Arc::new(std::sync::Mutex::new(None)),
            is_connected: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            db: db_clone.clone(),
        };
        match sync::perform_full_sync(&db_clone, &temp_sync_state).await {
            Ok(_) => tracing::info!("Initial full sync completed"),
            Err(e) => tracing::error!("Initial full sync failed: {}", e),
        }
    });

    Ok(auth_state)
}

/// Log out — revoke the refresh token on the server, clear local auth data.
#[tauri::command]
pub async fn sync_logout(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    tracing::info!("Logging out — revoking tokens");

    // Try to revoke refresh token on server (best-effort)
    if let Ok(Some(refresh_token)) = auth::get_refresh_token(&db) {
        let body = serde_json::json!({ "refresh_token": refresh_token }).to_string();
        let server_url = sync_state.server_url.lock().unwrap().clone();

        // Fire-and-forget: don't block logout on network issues
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let _ = client
                .post(format!("{}/auth/logout", server_url))
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await;
        });
    }

    // Clear all local auth data + sync queue (best-effort: don't fail logout
    // if the database is missing/corrupted — the frontend will reset UI state regardless)
    if let Err(e) = auth::clear_auth(&db) {
        tracing::warn!(
            "Failed to clear auth data during logout (database may be missing): {}",
            e
        );
    }

    Ok(())
}

/// Trigger a sync — full sync if initial sync hasn't completed, otherwise delta.
#[tauri::command]
pub async fn sync_trigger(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<sync::SyncStatus, String> {
    // Check if logged in first
    let auth_state = auth::get_auth_state(&db)?;
    if !auth_state.is_logged_in {
        return Err("Not logged in".to_string());
    }

    let mode = *sync_state.provider_mode.lock().unwrap();
    if mode == crate::sync::provider::ProviderMode::Server {
        // Custom servers are live streams and do not use the background sync protocol
        return Ok(sync::SyncStatus {
            is_syncing: false,
            last_sync_at: Some(chrono::Utc::now().to_rfc3339()),
            pending_changes: 0,
            last_error: None,
        });
    }

    // If the initial full sync never completed, retry it instead of doing a delta sync
    let full_sync_done = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::get_sync_meta(&conn, "full_sync_done")
            .map_err(|e| e.to_string())?
            .map(|v| v == "true")
            .unwrap_or(false)
    };

    if full_sync_done {
        sync::perform_sync(&db, &sync_state).await
    } else {
        tracing::info!("Full sync not yet completed — running full sync instead of delta");
        sync::perform_full_sync(&db, &sync_state).await
    }
}

/// Get the current sync status (pending changes, last sync time, errors).
#[tauri::command]
pub async fn sync_get_status(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<sync::SyncStatus, String> {
    let mode = *sync_state.provider_mode.lock().unwrap();
    if mode == crate::sync::provider::ProviderMode::Server {
        return Ok(sync::SyncStatus {
            is_syncing: false,
            last_sync_at: Some(chrono::Utc::now().to_rfc3339()),
            pending_changes: 0,
            last_error: None,
        });
    }
    sync::get_sync_status(&db, &sync_state)
}

/// Get the server URL for OAuth login (so frontend knows where to open browser).
#[tauri::command]
pub async fn sync_get_server_url(sync_state: State<'_, SyncState>) -> Result<String, String> {
    Ok(sync_state.server_url.lock().unwrap().clone())
}

/// Enqueue a sync change from the frontend (e.g., when a setting changes).
#[tauri::command]
pub async fn sync_enqueue_change(
    entity_type: String,
    entity_id: String,
    operation: String,
    payload: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    // Only enqueue if logged in
    let auth_state = auth::get_auth_state(&db)?;
    if !auth_state.is_logged_in {
        return Ok(()); // Silently skip if not logged in
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::enqueue_sync_change(
        &conn,
        &entity_type,
        &entity_id,
        &operation,
        payload.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Delete the user's account from the server (GDPR).
#[tauri::command]
pub async fn sync_delete_account(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    tracing::warn!("User requested account deletion (GDPR)");

    let server_url = sync_state.server_url.lock().unwrap().clone();
    auth::authenticated_request(&db, &server_url, "DELETE", "/sync/account", None)
        .await?;

    // Clear local data
    auth::clear_auth(&db)?;

    Ok(())
}

/// Link a Ko-fi donation email to the current account (Flow B — email mismatch).
/// Calls POST /auth/link-kofi via the auth-aware HTTP client (auto-refreshes token).
/// On success, updates locally stored is_supporter + supporter_until and returns
/// the new AuthState so the frontend can update reactively.
#[tauri::command]
pub async fn sync_link_kofi(
    kofi_email: String,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<auth::AuthState, String> {
    let body = serde_json::json!({ "kofi_email": kofi_email }).to_string();

    let server_url = sync_state.server_url.lock().unwrap().clone();
    let resp_str = auth::authenticated_request(
        &db,
        &server_url,
        "POST",
        "/auth/link-kofi",
        Some(&body),
    )
    .await?;

    // Parse the response to extract the new access token + supporter status
    #[derive(serde::Deserialize)]
    struct LinkKofiResponse {
        access_token: String,
        is_supporter: bool,
        supporter_until: Option<String>,
    }

    let resp: LinkKofiResponse = serde_json::from_str(&resp_str)
        .map_err(|e| format!("Failed to parse link-kofi response: {}", e))?;

    // Store the new access token (it carries updated is_supporter claim)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::set_sync_meta(&conn, "access_token", &resp.access_token)
            .map_err(|e| e.to_string())?;
    }

    // Update locally stored supporter status
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::set_sync_meta(
            &conn,
            "is_supporter",
            if resp.is_supporter { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())?;
        if let Some(ref until_str) = resp.supporter_until {
            // supporter_until is ISO 8601 string, convert to unix ms
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(until_str) {
                let ms = dt.timestamp_millis();
                crate::db::queries::set_sync_meta(&conn, "supporter_until", &ms.to_string())
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // Return updated auth state
    auth::get_auth_state(&db)
}

/// Get the current access token for WebSocket authentication.
/// If the token is missing or expired, it will attempt to refresh it.
#[tauri::command]
pub async fn sync_get_access_token(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<Option<String>, String> {
    // Check if we have a refresh token (implies we're logged in)
    let rt = auth::get_refresh_token(&db)?;
    if rt.is_none() {
        return Ok(None);
    }

    // Attempt to refresh the access token only if missing or expired.
    let access_token = auth::get_access_token(&db)?;
    if let Some(token) = &access_token {
        if !auth::is_token_expired(token) {
            return Ok(Some(token.clone()));
        }
    }

    // Attempt to refresh the access token to ensure it's valid for the WS connection.
    // If it's already fresh, the server should return a new one or the same one.
    // This is better than returning a potentially expired token and getting a WS 401.
    let server_url = sync_state.server_url.lock().unwrap().clone();
    match auth::refresh_access_token(&db, &server_url).await {
        Ok(token) => Ok(Some(token)),
        Err(e) => {
            tracing::warn!("Failed to refresh token for WebSocket: {}", e);
            // Fallback to current token if refresh fails (might still work if it's not expired)
            Ok(auth::get_access_token(&db)?)
        }
    }
}

/// Get the device ID for identification.
#[tauri::command]
pub async fn sync_get_device_id(db: State<'_, Database>) -> Result<String, String> {
    auth::get_or_create_device_id(&db)
}

#[tauri::command]
pub async fn server_test_connection(
    url: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let url = url.trim_end_matches('/').to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let login_url = format!("{}/api/auth/login", url);
    let payload = serde_json::json!({
        "username": username,
        "password": password,
    });

    let resp = client.post(&login_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({}): {}", status, body));
    }

    #[derive(serde::Deserialize)]
    struct LoginResponse {
        token: String,
        user: UserResponse,
    }
    #[derive(serde::Deserialize)]
    struct UserResponse {
        id: String,
        username: String,
    }

    let _login_res: LoginResponse = resp.json().await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn server_connect(
    url: String,
    username: String,
    password: String,
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    let url = url.trim_end_matches('/').to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let login_url = format!("{}/api/auth/login", url);
    let payload = serde_json::json!({
        "username": username,
        "password": password,
    });

    let resp = client.post(&login_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login failed ({}): {}", status, body));
    }

    #[derive(serde::Deserialize)]
    struct LoginResponse {
        token: String,
        user: UserResponse,
    }
    #[derive(serde::Deserialize)]
    struct UserResponse {
        id: String,
        username: String,
    }

    let login_res: LoginResponse = resp.json().await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;

    auth::store_auth_tokens(&db, &login_res.token, &login_res.token)?;
    auth::store_user_profile(
        &db,
        &login_res.user.id,
        &login_res.user.username,
        Some(&login_res.user.username),
        None,
        true,
        None,
    )?;

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::set_sync_meta(&conn, "server_url", &url).map_err(|e| e.to_string())?;
    }

    *sync_state.server_url.lock().unwrap() = url;
    *sync_state.provider_mode.lock().unwrap() = crate::sync::provider::ProviderMode::Server;
    sync_state.is_connected.store(true, std::sync::atomic::Ordering::SeqCst);

    sync::start_sse_listener(&sync_state, db.inner().clone());

    Ok(())
}

#[tauri::command]
pub async fn server_disconnect(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<(), String> {
    sync::stop_sse_listener(&sync_state);

    auth::clear_auth(&db)?;

    *sync_state.provider_mode.lock().unwrap() = crate::sync::provider::ProviderMode::Local;
    sync_state.is_connected.store(false, std::sync::atomic::Ordering::SeqCst);

    Ok(())
}

#[derive(serde::Serialize)]
pub struct ServerStatus {
    pub connected: bool,
    pub url: String,
    pub user: Option<String>,
}

#[tauri::command]
pub async fn server_get_status(
    db: State<'_, Database>,
    sync_state: State<'_, SyncState>,
) -> Result<ServerStatus, String> {
    let connected = sync_state.is_connected.load(std::sync::atomic::Ordering::SeqCst);
    let url = sync_state.server_url.lock().unwrap().clone();
    
    let user = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::get_sync_meta(&conn, "user_name").unwrap_or(None)
    };

    Ok(ServerStatus {
        connected,
        url,
        user,
    })
}
