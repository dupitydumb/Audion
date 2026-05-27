/**
 * Apple Music lyrics provider via paxsenix.org
 * Uses lyrics.paxsenix.org . no auth required
 * Parsing delegated to Rust via parse_apple_lyrics_json_cmd
 */

import { invoke } from '@tauri-apps/api/core';
import { proxyFetch } from '../network';
import type { LyricsResult, LyricLine, WordTiming } from './index';

const SEARCH_BASE_URL = 'https://lyrics.paxsenix.org';
const API_BASE_URL    = 'https://api.paxsenix.org';
const TIMEOUT = 10000;

/**
 * read the paxsenix API key from localStorage at call time
 */
function getPaxsenixApiKey(): string | null {
    const raw = localStorage.getItem('qobuz_pax_api_key')?.trim();
    if (!raw) return null;
    return raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
}

// ---------------------------------------------------------------------------
// Raw types from Rust parser
// ---------------------------------------------------------------------------

interface AppleRawSyllable {
    text:     string;
    time:     number;
    end_time: number;
    part:     boolean;
}

interface AppleRawWord {
    word:       string;
    time:       number;
    end_time:   number;
    is_split:   boolean;
    syllables?: AppleRawSyllable[];
}

interface AppleRawLine {
    time:             number;
    end_time:         number;
    text:             string;
    words:            AppleRawWord[];
    structure:        string;
    opposite_turn:    boolean;
    is_background:    boolean;
    background_words: AppleRawWord[];
    background_text:  string;
}

// ---------------------------------------------------------------------------
// Search result shape
// ---------------------------------------------------------------------------

interface AppleMusicSearchResult {
    // lyrics.paxsenix.org shape
    id?:         string;
    songName?:   string;
    // api.paxsenix.org shape
    playParams?: { id: string; kind: string };
    name?:       string;
    durationInMillis?: number;
    hasLyrics?:  boolean;
    hasTimeSyncedLyrics?: boolean;
    // shared
    artistName:  string;
    albumName:   string;
    duration?:   number;  // milliseconds (lyrics.paxsenix.org)
    isrc:        string;
}

/** normalise a result from either endpoint into consistent field names */
function normaliseResult(r: AppleMusicSearchResult): { id: string; songName: string; artistName: string; albumName: string; duration: number; isrc: string; hasLyrics: boolean; hasTimeSyncedLyrics: boolean } {
    return {
        id:                   r.playParams?.id ?? r.id ?? '',
        songName:             r.name          ?? r.songName ?? '',
        artistName:           r.artistName,
        albumName:            r.albumName,
        duration:             r.durationInMillis ?? r.duration ?? 0,
        isrc:                 r.isrc,
        hasLyrics:            r.hasLyrics            ?? true,  // default true for lyrics.paxsenix.org which doesn't include this field
        hasTimeSyncedLyrics:  r.hasTimeSyncedLyrics  ?? true,
    };
}

/** unwrap the results array from either endpoint's response shape */
function unwrapResults(data: unknown): AppleMusicSearchResult[] | null {
    if (Array.isArray(data)) return data.length > 0 ? data : null;
    const obj = data as { ok?: boolean; results?: AppleMusicSearchResult[] };
    if (obj?.results && Array.isArray(obj.results) && obj.results.length > 0) return obj.results;
    return null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapAppleWord(w: AppleRawWord): WordTiming {
    return {
        word:      w.word,
        time:      w.time,
        endTime:   w.end_time,
        is_split:  w.is_split,
        syllables: w.syllables,
    };
}

function mapAppleLines(raw: AppleRawLine[]): LyricLine[] {
    return raw.map(l => ({
        time:             l.time,
        endTime:          l.end_time,
        text:             l.text,
        words:            l.words.map(mapAppleWord),
        structure:        l.structure        || undefined,
        opposite_turn:    l.opposite_turn    || undefined,
        is_background:    l.is_background    || undefined,
        background_words: l.background_words.length
            ? l.background_words.map(mapAppleWord)
            : undefined,
        background_text:  l.background_text  || undefined,
    }));
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AppleMusic {

    private async _fetch<T>(url: string): Promise<T> {
        return proxyFetch<T>(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'applelyrics/1.0 (github.com/apple/lyrics)'
            }
        });
    }

    private async _fetchWithApiKey<T>(url: string): Promise<T> {
        const auth = getPaxsenixApiKey(); // already includes "Bearer " prefix
        return proxyFetch<T>(url, {
            headers: {
                'Accept':     'application/json',
                'User-Agent': 'applelyrics/1.0 (github.com/apple/lyrics)',
                ...(auth ? { 'Authorization': auth } : {}),
            }
        });
    }

    /**
     * run a search query and return parsed results, or null on failure / empty
     * primary: api.paxsenix.org   (Bearer token from localStorage)
     * fallback: lyrics.paxsenix.org (no auth)
     */
    private async _search(query: string): Promise<AppleMusicSearchResult[] | null> {
        // primary: api.paxsenix.org
        const primaryUrl = `${API_BASE_URL}/apple-music/search?q=${encodeURIComponent(query)}`;
        try {
            const raw = await this._fetchWithApiKey(primaryUrl);
            const data = unwrapResults(raw);
            if (data) {
                return data;
            }
            console.warn(`[AppleMusic] _search primary returned empty for "${query}"`);
        } catch (e) {
            console.warn(`[AppleMusic] _search primary failed for "${query}":`, e);
        }

        // fallback: lyrics.paxsenix.org
        const fallbackUrl = `${SEARCH_BASE_URL}/apple-music/search?q=${encodeURIComponent(query)}`;
        try {
            const raw = await this._fetch(fallbackUrl);
            const data = unwrapResults(raw);
            if (data) {
                return data;
            }
            console.warn(`[AppleMusic] _search fallback returned empty for "${query}"`);
            return null;
        } catch (e) {
            console.warn(`[AppleMusic] _search fallback failed for "${query}":`, e);
            return null;
        }
    }

    /**
     * ISRC path: scan results for an exact ISRC match (case-insensitive).
     * Returns the matched result's id, or null if none match.
     */
    private _matchByIsrc(
        results: AppleMusicSearchResult[],
        isrc:    string,
    ): string | null {
        for (const r of results) {
            const n = normaliseResult(r);
            if (n.isrc?.toUpperCase() === isrc.toUpperCase()) {
                if (!n.hasLyrics) {
                    console.warn(`[AppleMusic] ISRC match found (id=${n.id}) but Apple reports hasLyrics=false, skipping`);
                    return null;
                }
                return n.id;
            }
        }
        return null;
    }

    /**
     * Fuzzy path: score each result against known track metadata.
     * Returns the best result's id if it clears the confidence threshold, else null.
     *
     * Scoring:
     *   Artist name match  - 3 pts  (most reliable signal)
     *   Song name match    - 2 pts
     *   Duration match     - 2 pts  (within 3 seconds)
     *   Album name match   - 1 pt   (weakest . compilations/DJ mixes skew this)
     *
     * Minimum score to accept: 5 (requires at least artist + song, or artist + duration)
     */
    private _matchByMetadata(
        results:  AppleMusicSearchResult[],
        title:    string,
        artist:   string,
        album?:   string | null,
        duration?: number | null,  // seconds
    ): string | null {
        const norm = (s: string) => s.toLowerCase().trim();

        let bestId:    string | null = null;
        let bestScore  = 0;

        for (const r of results) {
            const n = normaliseResult(r);

            // skip tracks Apple explicitly marks as having no lyrics
            if (!n.hasLyrics) {
                console.log(`[AppleMusic] Skipping "${n.songName}" by ${n.artistName} (id=${n.id}) — hasLyrics=false`);
                continue;
            }

            let score = 0;

            if (norm(n.artistName).includes(norm(artist)) ||
                norm(artist).includes(norm(n.artistName))) {
                score += 3;
            }

            if (norm(n.songName).includes(norm(title)) ||
                norm(title).includes(norm(n.songName))) {
                score += 2;
            }

            if (duration != null) {
                const durationMs = duration * 1000;
                if (Math.abs(n.duration - durationMs) <= 3000) score += 2;
            }

            if (album && norm(n.albumName).includes(norm(album))) {
                score += 1;
            }

            // bonus for time-synced lyrics
            if (n.hasTimeSyncedLyrics) score += 1;

            if (score > bestScore) {
                bestScore = score;
                bestId    = n.id;
            }
        }

        const MIN_SCORE = 5;
        return (bestId && bestScore >= MIN_SCORE) ? bestId : null;
    }

    /**
     * Resolve a track ID from Apple Music search results.
     *
     * Strategy when ISRC is provided:
     *   1. Search with "title artist", try ISRC match.
     *   2. If no match, retry with title-only query
     *   3. If still no match, return null. A confirmed ISRC mismatch means every
     *      result in the pool is wrong; skipping to the next provider.
     *
     * Strategy when ISRC is absent:
     *   1. Search with "title artist", fuzzy-match on song/artist/album/duration.
     *   2. Return null if no result clears the confidence threshold.
     */
    async getTrackId(
        title:     string,
        artist:    string,
        album?:    string | null,
        duration?: number | null,  // seconds
        isrc?:     string | null,
    ): Promise<string | null> {
        const primaryQuery   = `${title} ${artist}`;
        // Strip "feat. ..." / "ft. ..." from artist for a cleaner fallback query
        const cleanArtist    = artist.replace(/\s*(feat\.|ft\.|featuring)[^,&]*/i, '').trim();
        const cleanQuery     = cleanArtist && cleanArtist !== artist ? `${title} ${cleanArtist}` : null;
        const alternateQuery = title;

        console.log(`[AppleMusic] getTrackId — title="${title}" artist="${artist}" album="${album ?? '-'}" duration=${duration ?? '-'}s isrc="${isrc ?? '-'}"`);

        if (isrc) {
            // --- ISRC path ---
            const results = await this._search(primaryQuery);
            if (results) {
                const id = this._matchByIsrc(results, isrc);
                if (id) { console.log(`[AppleMusic] ISRC matched on primary query — id=${id}`); return id; }
                console.warn(`[AppleMusic] ISRC "${isrc}" not found in ${results.length} primary results:`, results.map(r => r.isrc));
            }

            // retry with clean artist query (feat. stripped) if different from primary
            if (cleanQuery) {
                const cleanResults = await this._search(cleanQuery);
                if (cleanResults) {
                    const id = this._matchByIsrc(cleanResults, isrc);
                    if (id) { console.log(`[AppleMusic] ISRC matched on clean artist query — id=${id}`); return id; }
                    console.warn(`[AppleMusic] ISRC "${isrc}" not found in ${cleanResults.length} clean artist results:`, cleanResults.map(r => r.isrc));
                }
            }

            // retry with title-only query before giving up
            const retryResults = await this._search(alternateQuery);
            if (retryResults) {
                const id = this._matchByIsrc(retryResults, isrc);
                if (id) { console.log(`[AppleMusic] ISRC matched on title-only query — id=${id}`); return id; }
                console.warn(`[AppleMusic] ISRC "${isrc}" not found in ${retryResults.length} title-only results:`, retryResults.map(r => r.isrc));
            }

            // ISRC provided but matched nothing . all results are wrong, bail out
            console.warn('[AppleMusic] ISRC provided but no match found in any query, bailing');
            return null;
        }

        // --- Fuzzy path ---
        const results = await this._search(primaryQuery);
        if (results) {
            const id = this._matchByMetadata(results, title, artist, album, duration);
            if (id) { console.log(`[AppleMusic] Fuzzy matched on primary query — id=${id}`); return id; }
            console.warn(`[AppleMusic] Fuzzy match failed on primary query — best candidates:`, results.slice(0, 3).map(r => `"${r.songName}" by ${r.artistName} (${r.duration}ms)`));
        }

        // retry with clean artist query (feat. stripped) if different from primary
        if (cleanQuery) {
            const cleanResults = await this._search(cleanQuery);
            if (cleanResults) {
                const id = this._matchByMetadata(cleanResults, title, artist, album, duration);
                if (id) { console.log(`[AppleMusic] Fuzzy matched on clean artist query — id=${id}`); return id; }
                console.warn(`[AppleMusic] Fuzzy match failed on clean artist query — best candidates:`, cleanResults.slice(0, 3).map(r => `"${r.songName}" by ${r.artistName} (${r.duration}ms)`));
            }
        }

        // retry with title-only query
        const retryResults = await this._search(alternateQuery);
        if (!retryResults) {
            console.warn(`[AppleMusic] Fuzzy path — title-only query also returned nothing, giving up`);
            return null;
        }

        const id = this._matchByMetadata(retryResults, title, artist, album, duration);
        if (id) { console.log(`[AppleMusic] Fuzzy matched on title-only query — id=${id}`); }
        else     { console.warn(`[AppleMusic] Fuzzy match failed on title-only query — best candidates:`, retryResults.slice(0, 3).map(r => `"${r.songName}" by ${r.artistName} (${r.duration}ms)`)); }
        return id;
    }

    /**
     * Fetch raw Apple Music lyrics JSON by track ID.
     * Returns the raw JSON string for Rust to parse.
     * primary: lyrics.paxsenix.org (no auth)
     * fallback: api.paxsenix.org   (Bearer token from localStorage)
     */
    async getRawLyrics(trackId: string): Promise<string | null> {
        // primary
        const primaryUrl = `${SEARCH_BASE_URL}/apple-music/lyrics?id=${encodeURIComponent(trackId)}`;
        try {
            const data = await this._fetch(primaryUrl) as { ok?: boolean; error?: boolean; message?: string; [key: string]: unknown };
            if (data && data.ok !== false && !data.error) {
                return JSON.stringify(data);
            }
            console.warn(`[AppleMusic] getRawLyrics primary returned no lyrics for trackId=${trackId}:`, { ok: data?.ok, error: data?.error, message: data?.message });
        } catch (e) {
            console.warn(`[AppleMusic] getRawLyrics primary failed for trackId=${trackId}:`, e);
        }

        // fallback
        const fallbackUrl = `${API_BASE_URL}/lyrics/applemusic?id=${encodeURIComponent(trackId)}`;
        try {
            const data = await this._fetchWithApiKey(fallbackUrl) as { ok?: boolean; error?: boolean; message?: string; [key: string]: unknown };
            if (!data || data.ok === false) {
                console.warn(`[AppleMusic] getRawLyrics fallback returned ok=false for trackId=${trackId}`);
                return null;
            }
            return JSON.stringify(data);
        } catch (e) {
            console.error(`[AppleMusic] getRawLyrics fallback failed for trackId=${trackId}:`, e);
            return null;
        }
    }

    /**
     * Full pipeline: search -> fetch -> parse via Rust -> return LyricsResult.
     */
    async getLyrics(
        title:     string,
        artist:    string,
        album?:    string | null,
        duration?: number | null,  // seconds
        isrc?:     string | null,
    ): Promise<LyricsResult | null> {
        const trackId = await this.getTrackId(title, artist, album, duration, isrc);
        if (!trackId) return null;

        const raw = await this.getRawLyrics(trackId);
        if (!raw) return null;

        try {
            const appleLines = await invoke<AppleRawLine[]>(
                'parse_apple_lyrics_json_cmd', { raw }
            );
            if (!appleLines || appleLines.length === 0) return null;

            const lines = mapAppleLines(appleLines);
            const hasSyllableSync = lines.some(l =>
                l.words?.some(w => w.is_split && w.syllables?.length)
            );

            return {
                lines,
                source:          'applejson',
                format:          'json',
                hasWordSync:     true,
                hasSyllableSync,
                raw,
            };
        } catch (e) {
            console.error('[AppleMusic] parse_apple_lyrics_json_cmd threw:', e);
            return null;
        }
    }
}