// Sync auth — token management (store/retrieve/refresh access & refresh tokens)
//
// Tokens are stored in the local SQLite `sync_metadata` table.
// Keys: "access_token", "refresh_token", "user_id", "user_email",
//        "user_name", "user_avatar", "device_id"

use crate::db::Database;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;

/// Build a reusable HTTP client with proper timeouts and TLS config.
/// This avoids the overhead of a fresh TLS handshake for every single request
/// and prevents connection hangs on Windows.
fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

fn format_reqwest_error(context: &str, url: &str, e: &reqwest::Error) -> String {
    let kind = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "connect"
    } else if e.is_request() {
        "request"
    } else if e.is_status() {
        "status"
    } else {
        "other"
    };

    format!("{} [{}] for {}: {} ({:?})", context, kind, url, e, e)
}

// ─── Constants ───────────────────────────────────────────────────────────────

const META_ACCESS_TOKEN: &str = "access_token";
const META_REFRESH_TOKEN: &str = "refresh_token";
const META_USER_ID: &str = "user_id";
const META_USER_EMAIL: &str = "user_email";
const META_USER_NAME: &str = "user_name";
const META_USER_AVATAR: &str = "user_avatar";
const META_DEVICE_ID: &str = "device_id";
const META_SYNC_CURSOR: &str = "sync_cursor";
const META_IS_SUPPORTER: &str = "is_supporter";
const META_SUPPORTER_UNTIL: &str = "supporter_until";

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub is_logged_in: bool,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_supporter: bool,
    /// Unix timestamp in milliseconds. None = no expiry (active subscription).
    pub supporter_until: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UserProfile {
    pub user: UserProfileInner,
}

#[derive(Debug, Deserialize)]
pub struct UserProfileInner {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    #[serde(rename = "isSupporter", default)]
    pub is_supporter: bool,
    /// ISO 8601 datetime string (Drizzle serializes timestamp columns as Date → string in JSON)
    #[serde(rename = "supporterUntil")]
    pub supporter_until: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    sub: Option<String>,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
    #[serde(rename = "is_supporter", default)]
    is_supporter: bool,
    /// Unix timestamp in milliseconds. None = no expiry.
    #[serde(rename = "supporter_until")]
    supporter_until: Option<i64>,
}

fn auth_state_from_access_token(db: &Database, access_token: &str) -> Result<AuthState, String> {
    let payload = access_token
        .split('.')
        .nth(1)
        .ok_or_else(|| "JWT access token is missing payload".to_string())?;

    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload.as_bytes()))
        .map_err(|e| format!("Failed to decode JWT payload: {}", e))?;

    let claims: JwtClaims = serde_json::from_slice(&decoded)
        .map_err(|e| format!("Failed to parse JWT claims: {}", e))?;

    let user_id = claims
        .sub
        .ok_or_else(|| "JWT claims missing 'sub'".to_string())?;
    let email = claims
        .email
        .ok_or_else(|| "JWT claims missing 'email'".to_string())?;
    let avatar = claims.avatar_url.or(claims.picture);

    store_user_profile(
        db,
        &user_id,
        &email,
        claims.name.as_deref(),
        avatar.as_deref(),
        claims.is_supporter,
        claims.supporter_until,
    )?;

    Ok(AuthState {
        is_logged_in: true,
        user_id: Some(user_id),
        email: Some(email),
        name: claims.name,
        avatar_url: avatar,
        is_supporter: claims.is_supporter,
        supporter_until: claims.supporter_until,
    })
}

// ─── Token storage ──────────────────────────────────────────────────────────

/// Store tokens and user info after successful OAuth callback.
pub fn store_auth_tokens(
    db: &Database,
    access_token: &str,
    refresh_token: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::set_sync_meta(&conn, META_ACCESS_TOKEN, access_token)
        .map_err(|e| e.to_string())?;
    crate::db::queries::set_sync_meta(&conn, META_REFRESH_TOKEN, refresh_token)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Store user profile info fetched from the server.
#[allow(clippy::too_many_arguments)]
pub fn store_user_profile(
    db: &Database,
    user_id: &str,
    email: &str,
    name: Option<&str>,
    avatar_url: Option<&str>,
    is_supporter: bool,
    supporter_until: Option<i64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::set_sync_meta(&conn, META_USER_ID, user_id).map_err(|e| e.to_string())?;
    crate::db::queries::set_sync_meta(&conn, META_USER_EMAIL, email).map_err(|e| e.to_string())?;
    if let Some(name) = name {
        crate::db::queries::set_sync_meta(&conn, META_USER_NAME, name)
            .map_err(|e| e.to_string())?;
    }
    if let Some(avatar) = avatar_url {
        crate::db::queries::set_sync_meta(&conn, META_USER_AVATAR, avatar)
            .map_err(|e| e.to_string())?;
    }
    crate::db::queries::set_sync_meta(&conn, META_IS_SUPPORTER, if is_supporter { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    if let Some(until) = supporter_until {
        crate::db::queries::set_sync_meta(&conn, META_SUPPORTER_UNTIL, &until.to_string())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get the current access token (may be expired).
pub fn get_access_token(db: &Database) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::get_sync_meta(&conn, META_ACCESS_TOKEN).map_err(|e| e.to_string())
}

/// Get the refresh token.
pub fn get_refresh_token(db: &Database) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::get_sync_meta(&conn, META_REFRESH_TOKEN).map_err(|e| e.to_string())
}

/// Get the current auth state (whether user is logged in + profile info).
pub fn get_auth_state(db: &Database) -> Result<AuthState, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let user_id =
        crate::db::queries::get_sync_meta(&conn, META_USER_ID).map_err(|e| e.to_string())?;
    let email =
        crate::db::queries::get_sync_meta(&conn, META_USER_EMAIL).map_err(|e| e.to_string())?;
    let name =
        crate::db::queries::get_sync_meta(&conn, META_USER_NAME).map_err(|e| e.to_string())?;
    let avatar =
        crate::db::queries::get_sync_meta(&conn, META_USER_AVATAR).map_err(|e| e.to_string())?;
    let has_token = crate::db::queries::get_sync_meta(&conn, META_ACCESS_TOKEN)
        .map_err(|e| e.to_string())?
        .is_some();
    let is_supporter = crate::db::queries::get_sync_meta(&conn, META_IS_SUPPORTER)
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);
    let supporter_until = crate::db::queries::get_sync_meta(&conn, META_SUPPORTER_UNTIL)
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse::<i64>().ok());

    Ok(AuthState {
        is_logged_in: has_token && user_id.is_some(),
        user_id,
        email,
        name,
        avatar_url: avatar,
        is_supporter,
        supporter_until,
    })
}

/// Get or generate a stable device ID for this installation.
pub fn get_or_create_device_id(db: &Database) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if let Some(id) =
        crate::db::queries::get_sync_meta(&conn, META_DEVICE_ID).map_err(|e| e.to_string())?
    {
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    crate::db::queries::set_sync_meta(&conn, META_DEVICE_ID, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Get the current sync cursor (last known server change ID).
pub fn get_sync_cursor(db: &Database) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let cursor_str =
        crate::db::queries::get_sync_meta(&conn, META_SYNC_CURSOR).map_err(|e| e.to_string())?;
    Ok(cursor_str.and_then(|s| s.parse::<i64>().ok()).unwrap_or(0))
}

/// Update the sync cursor after a successful sync.
pub fn set_sync_cursor(db: &Database, cursor: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::set_sync_meta(&conn, META_SYNC_CURSOR, &cursor.to_string())
        .map_err(|e| e.to_string())
}



/// Clear all auth data (on logout).
pub fn clear_auth(db: &Database) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::queries::clear_sync_metadata(&conn).map_err(|e| e.to_string())?;
    crate::db::queries::clear_sync_queue(&conn).map_err(|e| e.to_string())?;
    crate::db::queries::clear_sync_id_map(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Token refresh ──────────────────────────────────────────────────────────

/// Refresh the access token using the refresh token.
/// Returns the new access token on success.
pub async fn refresh_access_token(db: &Database, server_url: &str) -> Result<String, String> {
    let refresh_token =
        get_refresh_token(db)?.ok_or_else(|| "No refresh token available".to_string())?;

    let client = http_client()?;
    let resp = client
        .post(format!("{}/auth/refresh", server_url))
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // If refresh token is invalid/expired, clear auth state
        if status.as_u16() == 401 {
            tracing::warn!("Refresh token expired or revoked, clearing auth state");
            let _ = clear_auth(db);
        }
        return Err(format!("Token refresh failed ({}): {}", status, body));
    }

    let data: RefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    // Store the new access token
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::queries::set_sync_meta(&conn, META_ACCESS_TOKEN, &data.access_token)
            .map_err(|e| e.to_string())?;
    }

    Ok(data.access_token)
}

/// Fetch the user profile from the server and store it locally.
pub async fn fetch_and_store_profile(
    db: &Database,
    server_url: &str,
    access_token: &str,
) -> Result<AuthState, String> {
    let profile_url = format!("{}/auth/me", server_url);
    tracing::info!("Fetching profile from {}", profile_url);
    let client = http_client()?;

    let mut last_error: Option<String> = None;
    let mut resp_opt = None;

    for attempt in 1..=3 {
        match client
            .get(&profile_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
        {
            Ok(resp) => {
                resp_opt = Some(resp);
                break;
            }
            Err(e) => {
                let msg = format_reqwest_error("Failed to fetch profile", &profile_url, &e);
                tracing::error!("{} (attempt {}/3)", msg, attempt);
                last_error = Some(msg);

                if attempt < 3 {
                    sleep(Duration::from_millis(400 * attempt)).await;
                }
            }
        }
    }

    let resp = match resp_opt {
        Some(resp) => resp,
        None => {
            let network_error = last_error
                .unwrap_or_else(|| "Failed to fetch profile: unknown network error".to_string());

            tracing::warn!(
                "Profile request failed due to network issue. Falling back to JWT claims. Error: {}",
                network_error
            );

            return auth_state_from_access_token(db, access_token).map_err(|fallback_err| {
                format!(
                    "{} | JWT fallback also failed: {}",
                    network_error, fallback_err
                )
            });
        }
    };

    if !resp.status().is_success() {
        return Err(format!("Profile fetch failed: {}", resp.status()));
    }

    // Parse the profile — if the body fails to decode (e.g. unexpected field types),
    // fall back to extracting what we need from the JWT claims so the user is never stuck.
    let profile: UserProfile = match resp.json().await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                "Profile JSON parse failed: {} — falling back to JWT claims",
                e
            );
            return auth_state_from_access_token(db, access_token);
        }
    };

    // supporter_until from /auth/me is a Drizzle Date → ISO 8601 string in JSON.
    // Convert to unix milliseconds so it matches what the JWT carries.
    let supporter_until_ms: Option<i64> = profile.user.supporter_until.as_deref().and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis())
    });

    store_user_profile(
        db,
        &profile.user.id,
        &profile.user.email,
        profile.user.name.as_deref(),
        profile.user.avatar_url.as_deref(),
        profile.user.is_supporter,
        supporter_until_ms,
    )?;

    Ok(AuthState {
        is_logged_in: true,
        user_id: Some(profile.user.id),
        email: Some(profile.user.email),
        name: profile.user.name,
        avatar_url: profile.user.avatar_url,
        is_supporter: profile.user.is_supporter,
        supporter_until: supporter_until_ms,
    })
}

/// Make an authenticated request, auto-refreshing the token on 401.
/// Returns the response body as a string.
pub async fn authenticated_request(
    db: &Database,
    server_url: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let client = http_client()?;

    // First attempt with current access token
    let access_token = get_access_token(db)?.ok_or_else(|| "Not logged in".to_string())?;

    let url = format!("{}{}", server_url, path);

    let mut request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        "PUT" => client.put(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    request = request.header("Authorization", format!("Bearer {}", access_token));

    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format_reqwest_error("Request failed", &url, &e))?;

    // If 401, try refreshing the token and retry once
    if resp.status().as_u16() == 401 {
        tracing::info!("Access token expired, attempting refresh");
        let new_token = refresh_access_token(db, server_url).await?;

        let mut retry_request = match method {
            "GET" => client.get(&url),
            "POST" => client.post(&url),
            "DELETE" => client.delete(&url),
            "PUT" => client.put(&url),
            _ => return Err(format!("Unsupported HTTP method: {}", method)),
        };

        retry_request = retry_request.header("Authorization", format!("Bearer {}", new_token));

        if let Some(body) = body {
            retry_request = retry_request
                .header("Content-Type", "application/json")
                .body(body.to_string());
        }

        let retry_resp = retry_request
            .send()
            .await
            .map_err(|e| format_reqwest_error("Retry request failed", &url, &e))?;

        if !retry_resp.status().is_success() {
            let status = retry_resp.status();
            let body = retry_resp.text().await.unwrap_or_default();
            return Err(format!(
                "Request failed after token refresh: {} — {}",
                status, body
            ));
        }

        return retry_resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e));
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Request failed: {} — {}", status, body));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}
