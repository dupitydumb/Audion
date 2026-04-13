/**
 * Apple Music lyrics provider via paxsenix.org
 * Uses lyrics.paxsenix.org . no auth required
 * Parsing delegated to Rust via parse_apple_lyrics_json_cmd
 */

import { invoke } from '@tauri-apps/api/core';
import { proxyFetch } from '../network';
import type { LyricsResult, LyricLine, WordTiming } from './index';

const SEARCH_BASE_URL = 'https://lyrics.paxsenix.org';
const TIMEOUT = 10000;

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
    id:          string;
    songName:    string;
    artistName:  string;
    albumName:   string;
    duration:    number;  // milliseconds
    isrc:        string;
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
            headers: { 'Accept': 'application/json' }
        });
    }

    /**
     * Run a search query and return parsed results, or null on failure / empty.
     */
    private async _search(query: string): Promise<AppleMusicSearchResult[] | null> {
        try {
            const data = await this._fetch(
                `${SEARCH_BASE_URL}/apple-music/search?q=${encodeURIComponent(query)}`
            ) as AppleMusicSearchResult[];
            return Array.isArray(data) && data.length > 0 ? data : null;
        } catch {
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
        const match = results.find(
            r => r.isrc?.toUpperCase() === isrc.toUpperCase()
        );
        return match?.id ?? null;
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

        let best:      AppleMusicSearchResult | null = null;
        let bestScore  = 0;

        for (const r of results) {
            let score = 0;

            if (norm(r.artistName).includes(norm(artist)) ||
                norm(artist).includes(norm(r.artistName))) {
                score += 3;
            }

            if (norm(r.songName).includes(norm(title)) ||
                norm(title).includes(norm(r.songName))) {
                score += 2;
            }

            if (duration != null) {
                const durationMs = duration * 1000;
                if (Math.abs(r.duration - durationMs) <= 3000) score += 2;
            }

            if (album && norm(r.albumName).includes(norm(album))) {
                score += 1;
            }

            if (score > bestScore) {
                bestScore = score;
                best      = r;
            }
        }

        const MIN_SCORE = 5;
        return (best && bestScore >= MIN_SCORE) ? best.id : null;
    }

    /**
     * Resolve a track ID from Apple Music search results.
     *
     * Strategy when ISRC is provided:
     *   1. Search with "title artist", try ISRC match.
     *   2. If no match, retry with alternate query ("title album" or "artist title").
     *   3. If still no match , return null. A confirmed ISRC mismatch means every
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
        const alternateQuery = album ? `${title} ${album}` : `${artist} ${title}`;

        if (isrc) {
            // --- ISRC path ---
            const results = await this._search(primaryQuery);
            if (results) {
                const id = this._matchByIsrc(results, isrc);
                if (id) return id;
            }

            // Retry with alternate query before giving up
            const retryResults = await this._search(alternateQuery);
            if (retryResults) {
                const id = this._matchByIsrc(retryResults, isrc);
                if (id) return id;
            }

            // ISRC provided but matched nothing . all results are wrong, bail out
            return null;
        }

        // --- Fuzzy path ---
        const results = await this._search(primaryQuery);
        if (!results) return null;

        return this._matchByMetadata(results, title, artist, album, duration);
    }

    /**
     * Fetch raw Apple Music lyrics JSON by track ID.
     * Returns the raw JSON string for Rust to parse.
     */
    async getRawLyrics(trackId: string): Promise<string | null> {
        try {
            const data = await this._fetch(
                `${SEARCH_BASE_URL}/apple-music/lyrics?id=${encodeURIComponent(trackId)}`
            ) as { ok?: boolean; [key: string]: unknown };

            if (!data || data.ok === false) return null;
            return JSON.stringify(data);
        } catch {
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
        } catch {
            return null;
        }
    }
}