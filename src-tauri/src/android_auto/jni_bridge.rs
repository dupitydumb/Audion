// jni bridge for android auto => this is the direct channel from the plan:
// MediaNotificationService (kotlin) calls these exports straight into rust,
// bypassing evaluateJs/webview entirely,
// so browsing/playback-resolution keeps working even if the webview is suspended or the activity was torn down
//
// only compiled on android
use std::sync::OnceLock;

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::db::Database;
use super::{resolve_children, resolve_leaf, search_scoped, SearchScope};

/// set once from the tauri setup hook (see lib.rs), read from every jni call below
/// a plain OnceLock rather than tauri's own state system because
/// these are raw native exports with no Tauri command injection available
static DATABASE: OnceLock<Database> = OnceLock::new();

pub fn set_database(db: Database) {
    // ignore the error if already set => setup only runs once in practice,
    // but this keeps a stray second call from panicking
    let _ = DATABASE.set(db);
}

/// json string for an empty/failed result
/// kept as one constant so every early-return below produces the same shape kotlin already expects
const EMPTY_ARRAY: &str = "[]";

fn get_database() -> Option<Database> {
    match DATABASE.get() {
        Some(db) => Some(db.clone()),
        None => {
            tracing::warn!("[android_auto] jni call before database was initialized");
            None
        }
    }
}

fn jstring_from(env: &mut JNIEnv, s: &str) -> jstring {
    match env.new_string(s) {
        Ok(j) => j.into_raw(),
        Err(e) => {
            tracing::error!("[android_auto] failed to build jstring: {e}");
            std::ptr::null_mut()
        }
    }
}

fn read_jstring(env: &mut JNIEnv, s: &JString) -> String {
    match env.get_string(s) {
        Ok(java_str) => String::from(java_str),
        Err(e) => {
            tracing::error!("[android_auto] failed to read jstring arg: {e}");
            String::new()
        }
    }
}

/// Java_com_audion_app_AudionLibraryBridge_getChildrenNative
/// returns a json array of BrowseNode
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_getChildrenNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    node_id: JString<'local>,
) -> jstring {
    let id = read_jstring(&mut env, &node_id);

    let Some(db) = get_database() else {
        return jstring_from(&mut env, EMPTY_ARRAY);
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };
    let json = match resolve_children(&conn, &id) {
        Ok(nodes) => serde_json::to_string(&nodes).unwrap_or_else(|_| EMPTY_ARRAY.to_string()),
        Err(e) => {
            tracing::error!("[android_auto] resolve_children({id}) failed: {e}");
            EMPTY_ARRAY.to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}

/// Java_com_audion_app_AudionLibraryBridge_getItemNative
/// returns a json Track object, or the literal "null" if not found/leaf wasn't a track id
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_getItemNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    node_id: JString<'local>,
) -> jstring {
    let id = read_jstring(&mut env, &node_id);

    let Some(db) = get_database() else {
        return jstring_from(&mut env, "null");
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, "null");
        }
    };
    let json = match resolve_leaf(&conn, &id) {
        Ok(Some(track)) => serde_json::to_string(&track).unwrap_or_else(|_| "null".to_string()),
        Ok(None) => "null".to_string(),
        Err(e) => {
            tracing::error!("[android_auto] resolve_leaf({id}) failed: {e}");
            "null".to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}

/// Java_com_audion_app_AudionLibraryBridge_searchNative
/// scope is one of "tracks" / "albums" / "artists" / "playlists",
/// matching the 4 library chips (anything else returns an empty array)
#[no_mangle]
pub extern "system" fn Java_com_audion_app_AudionLibraryBridge_searchNative<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    scope: JString<'local>,
    query: JString<'local>,
) -> jstring {
    let scope_str = read_jstring(&mut env, &scope);
    let query_str = read_jstring(&mut env, &query);

    let scope = match scope_str.as_str() {
        "tracks" => SearchScope::Tracks,
        "albums" => SearchScope::Albums,
        "artists" => SearchScope::Artists,
        "playlists" => SearchScope::Playlists,
        other => {
            tracing::warn!("[android_auto] unknown search scope: {other}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };

    let Some(db) = get_database() else {
        return jstring_from(&mut env, EMPTY_ARRAY);
    };

    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[android_auto] db mutex poisoned: {e}");
            return jstring_from(&mut env, EMPTY_ARRAY);
        }
    };
    let json = match search_scoped(&conn, scope, &query_str) {
        Ok(nodes) => serde_json::to_string(&nodes).unwrap_or_else(|_| EMPTY_ARRAY.to_string()),
        Err(e) => {
            tracing::error!("[android_auto] search_scoped failed: {e}");
            EMPTY_ARRAY.to_string()
        }
    };
    drop(conn);

    jstring_from(&mut env, &json)
}
