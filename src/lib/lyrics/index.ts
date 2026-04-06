/**
 * Lyrics Manager
 * Source registry
 * Supports multiple raw formats (LRC, TTML) .each source declares its own format
 * and owns its own parsing logic inside fetch().
 */

import { LRCLib } from './lrclib';
import { Musixmatch } from './musixmatch';
import { FILTER_WORDS } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WordTiming {
    word: string;
    time: number;      // seconds
    endTime: number;   // seconds
}

export interface LyricLine {
    time: number;
    endTime?: number;   // seconds. present for SRT and TTML; absent for LRC
    text: string;
    words?: WordTiming[];
}

/** The raw format the content was fetched/stored in. */
export type LyricsFormat = 'lrc' | 'ttml' | 'xml' | 'srt';

export interface LyricsResult {
    lines:       LyricLine[];
    source:      string;        // LyricsSource.id, or 'user' / 'embedded'
    format:      LyricsFormat;  // used by the store to save with the right extension
    hasWordSync: boolean;
    raw:         string;
    /**
     * Only meaningful when source === 'embedded'.
     * true  = came from SYLT or a USLT tag that contained LRC timestamps.
     * false = plain prose USLT (no timestamps).
     * undefined for all API/file sources.
     */
    synced?: boolean;
}

/**
 * A lyrics source descriptor.
 *
 * To add a new provider:
 *   1. Create a provider class
 *   2. Instantiate it below the interface definitions.
 *   3. Add one entry to LYRICS_SOURCES.
 *   Storage, caching, the source picker dropdown, and re-parsing from cache all
 *   work automatically
 */
export interface LyricsSource {
    /** Stable lowercase used as the filename : song.<id>.<format>. */
    id: string;

    /** readable label shown in the source picker dropdown. */
    label: string;

    /**
     * The format this source returns.
     * The store persists raw content under this extension and passes the same
     * value back to parse() when loading from cache.
     */
    format: LyricsFormat;

    /**
     * Fetch lyrics from the remote API and return a fully parsed LyricsResult,
     * or null if nothing was found.
     *
     * The fetch function is also responsible for parsing the raw response into
     * LyricLine[] . this keeps format-specific logic encapsulated in each source
     * and avoids the manager having to guess the format.
     */
    fetch: (
        title:     string,
        artist:    string,
        album?:    string | null,
        duration?: number | null,
    ) => Promise<LyricsResult | null>;

    /**
     * Re-parse previously cached raw content back into a LyricsResult.
     * Called by the store when loading from cache so it doesn't need to know
     * each source's format details.
     */
    parse: (raw: string) => LyricsResult;
}

// ---------------------------------------------------------------------------
// Provider singletons
// ---------------------------------------------------------------------------

const _lrclib     = new LRCLib();
const _musixmatch = new Musixmatch(null, true); // enhanced = word-by-word

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------

/**
 * Ordered list of lyrics sources.
 * The manager tries them in priority order; the first successful fetch wins.
 * Users can override the active source via the dropdown (stored in localStorage).
 *
 * Example future entry:
 * {
 *     id:     'applettml',
 *     label:  'Apple Music',
 *     format: 'ttml',
 *     fetch:  async (title, artist) => { const raw = await fetchFromApple(title, artist); ... },
 *     parse:  (raw) => { const lines = lyricsManager.parseTTML(raw); return { lines, source: 'applettml', format: 'ttml', hasWordSync: ..., raw }; },
 * }
 */
export const LYRICS_SOURCES: LyricsSource[] = [
    {
        id:     'musixmatch',
        label:  'Musixmatch',
        format: 'lrc',

        async fetch(title, artist) {
            const result = await _musixmatch.getLrc(`${title} ${artist}`);
            if (!result?.synced) return null;
            return this.parse(result.synced);
        },

        parse(raw) {
            const lines       = lyricsManager.parseLRC(raw);
            const hasWordSync = lines.some(l => l.words && l.words.length > 0);
            return { lines, source: 'musixmatch', format: 'lrc', hasWordSync, raw };
        },
    },

    {
        id:     'lrclib',
        label:  'LRCLIB',
        format: 'lrc',

        async fetch(title, artist, album, duration) {
            const result = await _lrclib.getLyrics(
                artist, title, album ?? undefined, duration ?? undefined
            );
            if (!result.synced) return null;
            return this.parse(result.synced);
        },

        parse(raw) {
            // LRCLIB only has line-level sync — skip the word-timing parser
            const lines = lyricsManager.parseLRC(raw, false);
            return { lines, source: 'lrclib', format: 'lrc', hasWordSync: false, raw };
        },
    },
];

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

class LyricsManager {

    // ---- LRC ----------------------------------------------------------------

    /**
     * Parse an LRC string into LyricLine[].
     * @param parseWordSync - false for sources that only have line-level timing (LRCLIB).
     */
    parseLRC(lrcString: string, parseWordSync = true): LyricLine[] {
        if (!lrcString) return [];

        const lyrics: LyricLine[] = [];

        for (const line of lrcString.split('\n')) {
            const match = line.match(/\[(\d+):(\d+)\.?(\d+)?\]\s*(.*)/);
            if (!match) continue;

            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            // Normalize to 3-digit milliseconds 
            const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
            const text = match[4].trim();

            if (!text) continue;

            const time = minutes * 60 + seconds + milliseconds / 1000;
            const lyricLine: LyricLine = { time, text };

            // Parse word-level timing if enabled
            if (parseWordSync) {
                const words = this._parseLRCWordTimings(text, time);
                if (words.length > 0 && words.some(w => w.time !== time)) {
                    lyricLine.words = words;
                }
            }

            lyricLine.text = this._stripTimestampTags(text);
            lyrics.push(lyricLine);
        }

        return lyrics.sort((a, b) => a.time - b.time);
    }

    // accept lineTime so word timestamps can be compared correctly,
    // and normalize sub-second digits to ms (3 digits)
    private _parseLRCWordTimings(text: string, lineTime: number): WordTiming[] {
        const words: WordTiming[] = [];
        const re = /<(\d+):(\d+)\.(\d+)>([^<]+)/g;
        let m: RegExpExecArray | null;

        while ((m = re.exec(text)) !== null) {
            const word = m[4].trim();
            if (!word) continue;
            words.push({
                word,
                time:    parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3].padEnd(3, '0')) / 1000,
                endTime: 0,
            });
        }

        for (let i = 0; i < words.length; i++) {
            words[i].endTime = i < words.length - 1 ? words[i + 1].time : words[i].time + 0.5;
        }

        return words;
    }

    private _stripTimestampTags(text: string): string {
        return text.replace(/<\d+:\d+\.\d+>/g, '').replace(/\s+/g, ' ').trim();
    }

    // ---- TTML ---------------------------------------------------------------

    /**
     * Parse a TTML/XML string into LyricLine[].
     *
     * Handles the two most common timestamp formats:
     *   - HH:MM:SS.mmm  (e.g. "00:01:23.456")
     *   - Raw milliseconds with "ms" suffix (e.g. "83456ms")
     *
     * Word-level sync is extracted from <span begin="..." end="..."> children
     * of each <p> element (Apple Music / iTunes LP style).
     */
    parseTTML(ttmlString: string): LyricLine[] {
        // guard against non-browser environments
        if (typeof DOMParser === 'undefined') {
            console.warn('[LyricsManager] parseTTML: DOMParser is not available in this environment.');
            return [];
        }

        const parser = new DOMParser();
        const doc    = parser.parseFromString(ttmlString, 'application/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.warn('[LyricsManager] TTML parse error:', parseError.textContent);
            return [];
        }

        const lyrics: LyricLine[] = [];
        const pElements = doc.querySelectorAll('p');

        pElements.forEach(p => {
            const beginAttr = p.getAttribute('begin');
            if (!beginAttr) return;

            const time = this._parseTTMLTimestamp(beginAttr);
            if (time === null) return;

            const endAttr = p.getAttribute('end');
            const lineEnd = endAttr ? this._parseTTMLTimestamp(endAttr) : null;

            // Check for word-level <span> children
            const spans = Array.from(p.querySelectorAll('span[begin]'));

            if (spans.length > 0) {
                // use null as sentinel for "endTime not yet set" to avoid
                // accidentally overwriting a real endTime of (time + 0.5).
                const words: (WordTiming & { _endExplicit: boolean })[] = [];

                spans.forEach((span) => {
                    const wBegin = span.getAttribute('begin');
                    const wEnd   = span.getAttribute('end');
                    const word   = (span.textContent ?? '').trim();
                    if (!word || !wBegin) return;

                    const wTime    = this._parseTTMLTimestamp(wBegin);
                    const wEndTime = wEnd ? this._parseTTMLTimestamp(wEnd) : null;
                    if (wTime === null) return;

                    words.push({
                        word,
                        time:          wTime,
                        endTime:       wEndTime ?? (wTime + 0.5),
                        _endExplicit:  wEndTime !== null,
                    });
                });

                // Fill missing endTimes using the next word's start, but only
                // when the endTime was not explicitly set by the source.
                for (let i = 0; i < words.length - 1; i++) {
                    if (!words[i]._endExplicit) {
                        words[i].endTime = words[i + 1].time;
                    }
                }

                // Strip internal sentinel field before storing
                const cleanWords: WordTiming[] = words.map(({ word, time, endTime }) => ({ word, time, endTime }));

                const text = cleanWords.map(w => w.word).join(' ');
                lyrics.push({ time, text, words: cleanWords.length > 0 ? cleanWords : undefined });

            } else {
                // Line-level only . collect all text content, strip inner tags
                const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (!text) return;
                lyrics.push({ time, ...(lineEnd !== null ? { endTime: lineEnd } : {}), text });
            }
        });

        return lyrics.sort((a, b) => a.time - b.time);
    }

    // ---- SRT ----------------------------------------------------------------

    /**
     * Parse an SRT string into LyricLine[].
     *
     * Standard SRT block format:
     *   <sequence number>
     *   HH:MM:SS,mmm --> HH:MM:SS,mmm
     *   Line of text (may span multiple lines)
     *   <blank line>
     *
     * Each parsed line carries both `time` (start) and `endTime` (end).
     * Multi-line subtitle blocks are joined with a space into a single LyricLine.
     * HTML tags that subtitle editors sometimes embed (e.g. <i>, <b>) are stripped.
     */
    parseSRT(srtString: string): LyricLine[] {
        if (!srtString) return [];

        const lyrics: LyricLine[] = [];

        // Split on one-or-more blank lines to get individual cue blocks
        const blocks = srtString.trim().split(/\n\s*\n/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            // Find the timing line . it contains ' --> '
            let timingLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) { timingLineIdx = i; break; }
            }
            if (timingLineIdx === -1) continue;

            const timingLine = lines[timingLineIdx];
            const timingMatch = timingLine.match(
                /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
            );
            if (!timingMatch) continue;

            const parseMs = (h: string, m: string, s: string, ms: string): number =>
                parseInt(h) * 3600 +
                parseInt(m) * 60 +
                parseInt(s) +
                parseInt(ms.padEnd(3, '0')) / 1000;

            const time    = parseMs(timingMatch[1], timingMatch[2], timingMatch[3], timingMatch[4]);
            const endTime = parseMs(timingMatch[5], timingMatch[6], timingMatch[7], timingMatch[8]);

            // Everything after the timing line is subtitle text
            const textLines = lines.slice(timingLineIdx + 1);
            const text = textLines
                .join(' ')
                .replace(/<[^>]+>/g, '')   // strip HTML tags
                .replace(/\s+/g, ' ')
                .trim();

            if (!text) continue;

            lyrics.push({ time, endTime, text });
        }

        return lyrics.sort((a, b) => a.time - b.time);
    }

    /**
     * Parse a TTML timestamp into seconds.
     * Supports:
     *   "HH:MM:SS.mmm"   standard clock value
     *   "MM:SS.mmm"      short clock value (no hours)
     *   "12345ms"        raw milliseconds
     *   "123.456s"       raw seconds
     */
    private _parseTTMLTimestamp(ts: string): number | null {
        ts = ts.trim();

        // Raw milliseconds: "12345ms"
        if (ts.endsWith('ms')) {
            const ms = parseFloat(ts.slice(0, -2));
            return isNaN(ms) ? null : ms / 1000;
        }

        // Raw seconds: "123.456s"
        if (ts.endsWith('s')) {
            const s = parseFloat(ts.slice(0, -1));
            return isNaN(s) ? null : s;
        }

        // Clock value: "HH:MM:SS.mmm" or "MM:SS.mmm"
        const parts = ts.split(':');
        if (parts.length === 3) {
            const h   = parseInt(parts[0]);
            const m   = parseInt(parts[1]);
            const sec = parseFloat(parts[2]);
            if (isNaN(h) || isNaN(m) || isNaN(sec)) return null;
            return h * 3600 + m * 60 + sec;
        }
        if (parts.length === 2) {
            const m   = parseInt(parts[0]);
            const sec = parseFloat(parts[1]);
            if (isNaN(m) || isNaN(sec)) return null;
            return m * 60 + sec;
        }

        return null;
    }

    // ---- Shared utilities ---------------------------------------------------

    /** Strip common video-title noise for cleaner API searches. */
    cleanTitle(title: string): string {
        if (!title) return '';

        let cleaned = title.toLowerCase();

        // Remove common video markers in brackets
        cleaned = cleaned.replace(/\[.*?(?:official|lyric|lyrics|video|audio|mv|music|hd|4k).*?\]/gi, '');
        cleaned = cleaned.replace(/\(.*?(?:official|lyric|lyrics|video|audio|mv|music|hd|4k).*?\)/gi, '');

        // Remove filter words
        const filterSet = new Set((FILTER_WORDS.BASIC as string[]).map(w => w.toLowerCase()));
        cleaned = cleaned.split(/\s+/).filter(w => !filterSet.has(w)).join(' ');
        return cleaned.trim();
    }

    /**
     * Re-parse cached raw content using a specific source's parse() method.
     * Used by the store when loading from cache.
     */
    parseFromSource(sourceId: string, raw: string): LyricsResult | null {
        const source = LYRICS_SOURCES.find(s => s.id === sourceId);
        if (!source) return null;
        try {
            return source.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Fetch lyrics from a specific source by ID.
     * Used when the user explicitly picks a source from the dropdown.
     */
    async fetchFromSource(
        sourceId: string,
        title:    string | null,
        artist:   string | null,
        album?:   string | null,
        duration?: number | null,
    ): Promise<LyricsResult | null> {
        const source = LYRICS_SOURCES.find(s => s.id === sourceId);
        if (!source) return null;

        const cleanedTitle  = this.cleanTitle(title ?? '');
        // lowercase artist for consistent API searches
        const cleanedArtist = (artist ?? 'Unknown Artist').toLowerCase();
        if (!cleanedTitle) return null;

        try {
            return await source.fetch(cleanedTitle, cleanedArtist, album, duration);
        } catch (err) {
            // log errors so fetch failures are distinguishable from "not found"
            console.warn(`[LyricsManager] fetchFromSource error (${sourceId}):`, err);
            return null;
        }
    }

    /**
     * Fetch lyrics walking the source registry in priority order.
     * Returns the first successful result.
     */
    async fetchLyrics(
        title:    string | null,
        artist:   string | null,
        album?:   string | null,
        duration?: number | null,
    ): Promise<LyricsResult | null> {
        const cleanedTitle  = this.cleanTitle(title ?? '');
        // lowercase artist for consistent API searches
        const cleanedArtist = (artist ?? 'Unknown Artist').toLowerCase();
        if (!cleanedTitle) return null;

        for (const source of LYRICS_SOURCES) {
            try {
                const result = await source.fetch(cleanedTitle, cleanedArtist, album, duration);
                if (result) return result;
            } catch (err) {
                // log errors so fetch failures are distinguishable from "not found"
                console.warn(`[LyricsManager] fetchLyrics error (${source.id}):`, err);
            }
        }

        return null;
    }
}

// Singleton
export const lyricsManager = new LyricsManager();

// Re-export providers for direct use if needed
export { LRCLib }     from './lrclib';
export { Musixmatch } from './musixmatch';
