# Sample Stream Provider for Audion v1.5.0+

A reference implementation of Audion's typed `StreamProvider` interface, modeled after the multi-context fallback architecture used by the YouTube Music plugin.

---

## Overview

Audion 1.5.0 introduces the `StreamProvider` interface, allowing plugins to resolve playback URLs directly into the native Rust audio engine.

```typescript
export interface StreamSourceResult {
    url: string;
    format?: string;
    bitrate?: number;
    headers?: Record<string, string>;
    rawBlobUrl?: string;
}

export interface StreamProvider {
    id: string;
    name: string;
    version?: string;
    description?: string;
    getStream(songId: string, quality?: string): Promise<StreamSourceResult | string | null>;
}
```

---

## Features Demonstrated

1. **Multi-Backend Fallback**:
   - Primary: InnerTube Player endpoints with `ANDROID` and `TV_EMBEDDED` client contexts.
   - Secondary: Federated Piped instances (`kavin.rocks`, `private.coffee`, `leptons.xyz`).
2. **Quality-Aware Format Picking**:
   - `lossless` / `high`: Highest bitrate audio stream (WebM Opus ~160kbps / MP4 AAC ~256kbps).
   - `standard`: Balanced stream (~128kbps).
   - `low`: Bandwidth-optimized stream for metered connections.
3. **HTTP Headers & Range Requests**:
   - Attaches `Range: bytes=0-` and custom `User-Agent` to support direct chunked streaming and seeking.
4. **CORS & Blob Bridge**:
   - Demonstrates converting direct stream URLs into `blob:` URLs via `api.fetchBlob` when running inside the desktop webview to bypass host CORS limitations.

---

## How to Register

In your plugin's `init(api)` lifecycle hook:

```javascript
async init(api) {
  api.stream.registerProvider({
    id: 'my-stream-provider',
    name: 'My Stream Provider',
    version: '1.0.0',
    description: 'Custom streaming backend',
    getStream: async (songId, quality) => {
      // Return { url, format, bitrate, headers } or string URL or null
    }
  });
}
```
