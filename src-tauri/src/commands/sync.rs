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
    let auth_state =
        auth::fetch_and_store_profile(&db, &sync_state.server_url, &access_token).await?;

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
        let server_url = sync_state.server_url.clone();

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
        tracing::warn!("Failed to clear auth data during logout (database may be missing): {}", e);
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
    sync::get_sync_status(&db, &sync_state)
}

/// Get the server URL for OAuth login (so frontend knows where to open browser).
#[tauri::command]
pub async fn sync_get_server_url(
    sync_state: State<'_, SyncState>,
) -> Result<String, String> {
    Ok(sync_state.server_url.clone())
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

    auth::authenticated_request(&db, &sync_state.server_url, "DELETE", "/sync/account", None)
        .await?;

    // Clear local data
    auth::clear_auth(&db)?;

    Ok(())
}
