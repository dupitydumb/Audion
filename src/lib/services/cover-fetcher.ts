import { invoke } from '@tauri-apps/api/core';
import type { Track } from '$lib/api/tauri';

const SEARCH_API = 'https://covers.musichoarders.xyz/api/search';

interface ProxyFetchResponse {
    status: number;
    body: string;
}

export async function fetchTrackCover(track: Track): Promise<string | null> {
    const { title, artist, album } = track;

    // We need at least artist and album to search effectively
    if (!artist || !album) {
        return null;
    }

    try {
        console.log(`[CoverFetcher] Searching cover for: ${artist} - ${album}`);

        // Use our proxy_fetch to bypass CORS
        // The Search API requires POST with JSON body for NDJSON response
        const response = await invoke<ProxyFetchResponse>('proxy_fetch', {
            request: {
                url: SEARCH_API,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    artist,
                    album,
                    country: 'us',
                    sources: ['itunes', 'spotify', 'tidal', 'deezer', 'musicbrainz']
                })
            }
        });

        if (response.status !== 200) {
            throw new Error(`Search API returned status ${response.status}`);
        }

        // The API returns NDJSON (one JSON object per line)
        const lines = response.body.split('\n');

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const data = JSON.parse(line);

                // We're looking for a 'cover' type result with a 'bigCoverUrl'
                if (data.type === 'cover' && data.bigCoverUrl) {
                    console.log(`[CoverFetcher] Found cover: ${data.bigCoverUrl}`);
                    return data.bigCoverUrl;
                }
            } catch (e) {
                // Ignore parse errors for partial/invalid lines
            }
        }

        console.log(`[CoverFetcher] No cover found in search results for: ${artist} - ${album}`);
        return null;
    } catch (error) {
        console.error(`[CoverFetcher] Error fetching cover:`, error);
        return null;
    }
}
