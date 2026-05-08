// Network commands for CORS-free HTTP requests
// These commands allow the frontend/plugins to make HTTP requests through the Rust backend,
// bypassing browser CORS restrictions.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct ProxyFetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProxyFetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Proxy fetch command - makes HTTP requests from the Rust backend to bypass CORS
#[tauri::command]
pub async fn proxy_fetch(request: ProxyFetchRequest) -> Result<ProxyFetchResponse, String> {
    let client = reqwest::Client::new();

    let method = request.method.unwrap_or_else(|| "GET".to_string());
    let method = method
        .parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid HTTP method: {}", e))?;

    let mut req_builder = client.request(method, &request.url);

    // Build a HeaderMap so custom headers override defaults
    let mut header_map = HeaderMap::new();
    header_map.insert("User-Agent",      HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"));
    header_map.insert("Accept",          HeaderValue::from_static("application/json, text/plain, */*"));
    header_map.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));
    header_map.insert("Cache-Control",   HeaderValue::from_static("no-cache"));

    // Custom headers override defaults (replaces existing keys)
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(&value),
            ) {
                header_map.insert(name, val);
            }
        }
    }

    req_builder = req_builder.headers(header_map);

    // Add body if present
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();

    // Collect response headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(ProxyFetchResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
pub async fn proxy_fetch_bytes(url: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response bytes: {}", e))?;

    Ok(STANDARD.encode(bytes))
}
