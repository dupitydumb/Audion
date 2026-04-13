import { invoke } from '@tauri-apps/api/core';

export interface ProxyFetchOptions {
    headers?: Record<string, string>;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: string;
}

export interface ProxyFetchResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

/**
 * Proxy fetch command - makes HTTP requests from the Rust backend to bypass CORS
 * Wraps the Tauri 'proxy_fetch' command.
 */
export async function proxyFetch<T = any>(url: string, options: ProxyFetchOptions = {}): Promise<T> {
    const response = await invoke<ProxyFetchResponse>('proxy_fetch', {
        request: {
            url,
            method: options.method || 'GET',
            headers: options.headers || { 'Accept': 'application/json' },
            body: options.body
        }
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.body}`);
    }

    try {
        return JSON.parse(response.body) as T;
    } catch (e) {
        // If not JSON, return as text (cast to T)
        return response.body as unknown as T;
    }
}
