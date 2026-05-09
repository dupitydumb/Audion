/**
 * Genius lyrics provider via api.paxsenix.org
 * uses api.paxsenix.org/lyrics/genius . auth required (Bearer token)
 * returns json with a flat lyrics string containing [Section] markers
 * rust parser via parse_genius_lyrics_json_cmd
 */

import { invoke } from '@tauri-apps/api/core';
import { proxyFetch } from '../network';
import type { LyricsResult, LyricLine } from './index';

const GENIUS_API_URL = 'https://api.paxsenix.org/lyrics/genius';

function getPaxAuth(): string | null {
    const raw = (typeof localStorage !== 'undefined'
        ? localStorage.getItem('qobuz_pax_api_key')
        : null) ?? '';
    const key = raw.trim();
    if (!key) return null;
    return key.startsWith('Bearer ') ? key : `Bearer ${key}`;
}

// ---------------------------------------------------------------------------
// raw types from the Genius api response
// ---------------------------------------------------------------------------

interface GeniusRawResponse {
    creator: string;
    ok:      boolean;
    message: string;
    url:     string;
    title:   string;
    artist:  string;
    cover:   string;
    lyrics:  string;   // raw string with \n and [Section] markers
}

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

export class Genius {

    private async _fetch<T>(url: string): Promise<T> {
        const auth = getPaxAuth();
        if (!auth) throw new Error('Paxsenix API key not configured');
        return proxyFetch<T>(url, {
            headers: {
                'Authorization': auth,
                'Accept':        'application/json',
                'User-Agent':    'geniuslyrics/1.0 (github.com/genius/lyrics)',
            }
        });
    }

    /**
     * fetch raw Genius api response with query
     * returns the raw response, or null on failure / not found
     */
    private async _search(query: string): Promise<GeniusRawResponse | null> {
        try {
            const data = await this._fetch<GeniusRawResponse>(
                `${GENIUS_API_URL}?q=${encodeURIComponent(query)}`
            );
            if (!data || data.ok === false || !data.lyrics) return null;
            return data;
        } catch {
            return null;
        }
    }

    /**
     * fetch raw Genius lyrics json by query
     * returns the raw json string for rust to parse, or null on failure
     */
    async getRawLyrics(query: string): Promise<string | null> {
        const data = await this._search(query);
        if (!data) return null;
        return JSON.stringify(data);
    }

    /**
     * full pipeline: search -> fetch -> parse via Rust -> return LyricsResult
     *
     * album / duration / isrc are accepted to satisfy the LyricsSource.fetch
     * interface but are unused . Genius search is query only
     *
     *   text = the lyric line with parentheticals stripped
     *   structure = section type parsed from [Section: Artist] header
     *   opposite_turn true when the section's tagged artist differ from
     *                     artist field in api response
     *   is_background true for lines that are full bracket
     *   background_text = bracket content extracted from line
     */
    async getLyrics(
        title:      string,
        artist:     string,
        _album?:    string | null,
        _duration?: number | null,
        _isrc?:     string | null,
    ): Promise<LyricsResult | null> {
        const query = `${title} ${artist}`;
        const raw   = await this.getRawLyrics(query);
        if (!raw) return null;

        try {
            const geniusLines = await invoke<LyricLine[]>(
                'parse_genius_lyrics_json_cmd', { raw }
            );
            if (!geniusLines || geniusLines.length === 0) return null;

            return {
                lines:            geniusLines,
                source:           'genius',
                format:           'json',
                hasWordSync:      false,
                hasSyllableSync:  false,
                raw,
            };
        } catch {
            return null;
        }
    }
}