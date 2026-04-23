// Network commands for CORS-free HTTP requests
// These commands allow the frontend/plugins to make HTTP requests through the Rust backend,
// bypassing browser CORS restrictions.

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

    // Add default browser-like headers to avoid 403 errors
    req_builder = req_builder
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cache-Control", "no-cache");

    // Add custom headers (these will override defaults if specified)
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }
    }

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

/// port the DASH segment proxy HTTP server listens on.
/// must match PROXY_PORT in player.ts.
pub const DASH_PROXY_PORT: u16 = 9876;

/// create a HTTP server on localhost:DASH_PROXY_PORT that proxies DASH
/// segment requests through rust's native HTTP
/// frontend registers a dash.js RequestModifier that rewrites urls at request time.

pub fn start_dash_proxy() {
    tauri::async_runtime::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = match TcpListener::bind(("127.0.0.1", DASH_PROXY_PORT)).await {
            Ok(l) => {
                tracing::info!("[DashProxy] Listening on 127.0.0.1:{}", DASH_PROXY_PORT);
                l
            }
            Err(e) => {
                tracing::error!("[DashProxy] Failed to bind port {}: {}", DASH_PROXY_PORT, e);
                return;
            }
        };

        // shared reqwest client
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .expect("reqwest client");
        let client = std::sync::Arc::new(client);

        loop {
            let (mut socket, _addr) = match listener.accept().await {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("[DashProxy] Accept error: {}", e);
                    continue;
                }
            };

            let client = client.clone();

            tokio::spawn(async move {
                // read HTTP request headers
                let mut buf = vec![0u8; 8192];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let raw = match std::str::from_utf8(&buf[..n]) {
                    Ok(s) => s,
                    Err(_) => return,
                };

                // extract request path from "GET /path HTTP/1.1"
                let path = raw
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                // dash.js may send OPTIONS before the real GET
                // handle CORS preflight
                if raw.starts_with("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, OPTIONS\r\n\
                        Access-Control-Allow-Headers: *\r\n\
                        Content-Length: 0\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // parse ?url= query param
                let target_url = path
                    .split_once('?')
                    .and_then(|(_, qs)| {
                        qs.split('&').find_map(|pair| {
                            let (k, v) = pair.split_once('=')?;
                            if k == "url" { Some(v.to_owned()) } else { None }
                        })
                    })
                    .and_then(|encoded| {
                        urlencoding::decode(&encoded).ok().map(|s| s.into_owned())
                    });

                let Some(url) = target_url else {
                    let resp = "HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 17\r\n\r\nMissing url param";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                };

                // extract range header from browser request
                let range_header = raw
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .and_then(|l| l.splitn(2, ':').nth(1))
                    .map(|v| v.trim().to_owned());

                    // log the path portion
                tracing::debug!("[DashProxy] Fetching: {}{}", 
                    &url[..url.find('?').unwrap_or(url.len())],
                    range_header.as_deref().map(|r| format!(" [{r}]")).unwrap_or_default()
                );

                // fetch from cdn, forwarding range if present
                let mut req = client
                    .get(&url)
                    .header("Accept", "*/*")
                    .header("Accept-Language", "en-US,en;q=0.9");

                if let Some(ref range) = range_header {
                    req = req.header("Range", range);
                }

                let result = req.send().await;

                match result {
                    Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 206 => {
                        let status = resp.status().as_u16();
                        let content_type = resp
                            .headers()
                            .get(reqwest::header::CONTENT_TYPE)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("application/octet-stream")
                            .to_owned();
                        // forward range related headers
                        let content_range = resp
                            .headers()
                            .get(reqwest::header::CONTENT_RANGE)
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_owned());
                        let accept_ranges = resp
                            .headers()
                            .get(reqwest::header::ACCEPT_RANGES)
                            .and_then(|v| v.to_str().ok())
                            .map(|s| s.to_owned());

                        match resp.bytes().await {
                            Ok(bytes) => {
                                let status_text = if status == 206 { "Partial Content" } else { "OK" };
                                let mut header = format!(
                                    "HTTP/1.1 {} {}\r\n\
                                     Access-Control-Allow-Origin: *\r\n\
                                     Content-Type: {}\r\n\
                                     Content-Length: {}\r\n",
                                    status, status_text, content_type, bytes.len()
                                );
                                if let Some(cr) = content_range {
                                    header.push_str(&format!("Content-Range: {}\r\n", cr));
                                }
                                if let Some(ar) = accept_ranges {
                                    header.push_str(&format!("Accept-Ranges: {}\r\n", ar));
                                } else {
                                    header.push_str("Accept-Ranges: bytes\r\n");
                                }
                                header.push_str("\r\n");
                                let _ = socket.write_all(header.as_bytes()).await;
                                let _ = socket.write_all(&bytes).await;
                            }
                            Err(e) => {
                                let msg = format!("Body error: {e}");
                                let resp = format!(
                                    "HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                                    msg.len(), msg
                                );
                                let _ = socket.write_all(resp.as_bytes()).await;
                            }
                        }
                    }
                    Ok(resp) => {
                        let msg = format!("Upstream: {}", resp.status());
                        let response = format!(
                            "HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                            msg.len(), msg
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                    }
                    Err(e) => {
                        let msg = format!("Fetch error: {e}");
                        let response = format!(
                            "HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                            msg.len(), msg
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                    }
                }
            });
        }
    });
}