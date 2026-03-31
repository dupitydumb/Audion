/**
 * Lyrics Manager
 * Combines LRCLIB and Musixmatch to fetch lyrics
 */

import { LRCLib } from './lrclib';
import { Musixmatch } from './musixmatch';
import { FILTER_WORDS } from './constants';

export interface WordTiming {
    word: string;
    time: number;      // start time
    endTime: number;   // end time
}

export interface LyricLine {
    time: number;
    text: string;
    words?: WordTiming[];
}

export interface LyricsResult {
    lines: LyricLine[];
    source: 'lrclib' | 'musixmatch' | 'cache' | 'embedded';
    hasWordSync: boolean;
    raw: string;
}

class LyricsManager {
    private lrclib = new LRCLib();
    private musixmatch = new Musixmatch(null, true); // enhanced for word-by-word

    /**
     * Parse LRC format string into structured lyrics
     * @param lrcString - The LRC formatted string
     * @param parseWordSync - Whether to parse word-level timing (default: true, set false for LRCLIB)
     */
    parseLRC(lrcString: string, parseWordSync: boolean = true): LyricLine[] {
        if (!lrcString) return [];

        const lines = lrcString.split('\n');
        const lyrics: LyricLine[] = [];

        for (const line of lines) {
            // Match [mm:ss.xx] or [mm:ss]
            const match = line.match(/\[(\d+):(\d+)\.?(\d+)?\]\s*(.*)/);
            if (!match) continue;

            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const centiseconds = match[3] ? parseInt(match[3].padEnd(2, '0')) : 0;
            const text = match[4].trim();

            if (!text) continue;

            const time = minutes * 60 + seconds + centiseconds / 100;
            const lyricLine: LyricLine = { time, text };

            // Parse word-level timing if enabled and present: <mm:ss.xx>word
            if (parseWordSync) {
                const wordTimings = this.parseWordTimings(text, time);
                if (wordTimings.length > 0 && wordTimings.some(w => w.time !== time)) {
                    lyricLine.words = wordTimings;
                }
            }

            // Always use cleanTimestampTags for display text to preserve all content
            lyricLine.text = this.cleanTimestampTags(text);

            lyrics.push(lyricLine);
        }

        return lyrics.sort((a, b) => a.time - b.time);
    }

    /**
     * Parse word-level timings from enhanced LRC (Musixmatch format)
     * 
     * Musixmatch format: <start_time> word <end_time>   <start_time> word <end_time> ...
     * Example: <01:50.75> Fall <01:51.86>   <01:52.26> back <01:53.50>
     */
    private parseWordTimings(text: string, lineTime: number): WordTiming[] {
        const words: WordTiming[] = [];

        // Match <mm:ss.xx> followed by content until next <
        const wordTimingRegex = /<(\d+):(\d+)\.(\d+)>([^<]+)/g;
        let match;

        while ((match = wordTimingRegex.exec(text)) !== null) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const centiseconds = parseInt(match[3].padEnd(2, '0'));
            const word = match[4].trim();

            // Skip empty content (gaps between words)
            if (!word) continue;

            words.push({
                word: word,
                time: minutes * 60 + seconds + centiseconds / 100,
                endTime: 0 // Will be filled below
            });
        }

        // Calculate end times based on next word's start time
        for (let i = 0; i < words.length; i++) {
            if (i < words.length - 1) {
                // Use next word's start time as this word's end time
                words[i].endTime = words[i + 1].time;
            } else {
                // Last word: estimate 0.5s duration
                words[i].endTime = words[i].time + 0.5;
            }
        }

        return words;
    }

    /**
     * Clean timestamp tags from lyrics text for display
     * Removes patterns like <mm:ss.xx> that may remain in lyrics
     */
    private cleanTimestampTags(text: string): string {
        // Remove <mm:ss.xx> patterns
        return text.replace(/<\d+:\d+\.\d+>/g, '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Clean title for better search results
     */
    cleanTitle(title: string): string {
        if (!title) return '';

        let cleaned = title.toLowerCase();

        // Remove common video markers in brackets
        cleaned = cleaned.replace(/\[.*?(?:official|lyric|lyrics|video|audio|mv|music|hd|4k).*?\]/gi, '');
        cleaned = cleaned.replace(/\(.*?(?:official|lyric|lyrics|video|audio|mv|music|hd|4k).*?\)/gi, '');

        // Remove filter words
        const filterSet = new Set(FILTER_WORDS.BASIC.map(w => w.toLowerCase()));
        cleaned = cleaned.split(/\s+/)
            .filter(word => !filterSet.has(word))
            .join(' ');

        return cleaned.trim();
    }

    /**
     * Fetch lyrics from all sources
     * Priority: 1. Musixmatch word-by-word, 2. LRCLIB synced, 3. Musixmatch synced
     */
    async fetchLyrics(
        title: string | null,
        artist: string | null,
        album?: string | null,
        duration?: number | null
    ): Promise<LyricsResult | null> {
        const cleanedTitle = this.cleanTitle(title || '');
        const cleanedArtist = artist || 'Unknown Artist';

        if (!cleanedTitle) {
            return null;
        }

        const searchTerm = `${cleanedTitle} ${cleanedArtist}`;

        // 1. Try Musixmatch first for word-by-word lyrics (best experience)
        try {
            const mxResult = await this.musixmatch.getLrc(searchTerm);

            if (mxResult?.synced) {
                const lines = this.parseLRC(mxResult.synced);
                const hasWordSync = lines.some(l => l.words && l.words.length > 0);

                if (hasWordSync) {
                    const wordSyncCount = lines.filter(l => l.words && l.words.length > 0).length;
                    return {
                        lines,
                        source: 'musixmatch',
                        hasWordSync: true,
                        raw: mxResult.synced
                    };
                } else {
                }
            } else {
            }
        } catch (error) {
        }

        // 2. Try LRCLIB for regular synced lyrics (fast & reliable)
        try {
            const lrcResult = await this.lrclib.getLyrics(
                cleanedArtist,
                cleanedTitle,
                album || undefined,
                duration || undefined
            );

            if (lrcResult.synced) {
                // Don't parse word timing for LRCLIB - it only has line-level sync
                const lines = this.parseLRC(lrcResult.synced, false);
                return {
                    lines,
                    source: 'lrclib',
                    hasWordSync: false,
                    raw: lrcResult.synced
                };
            } else {
            }
        } catch (error) {
        }

        // 3. Try Musixmatch regular synced as last resort
        try {
            const mxResult = await this.musixmatch.getLrc(searchTerm);

            if (mxResult?.synced) {
                const lines = this.parseLRC(mxResult.synced);
                return {
                    lines,
                    source: 'musixmatch',
                    hasWordSync: false,
                    raw: mxResult.synced
                };
            } else {
            }
        } catch (error) {
        }

        return null;
    }
}

// Export singleton instance
export const lyricsManager = new LyricsManager();

// Re-export types
export { LRCLib } from './lrclib';
export { Musixmatch } from './musixmatch';
