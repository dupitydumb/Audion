// Sample Lyrics Provider for Audion v1.5.0+
// Demonstrates how to build a synced lyrics provider supporting
// line timestamps, syllable/word-by-word karaoke sync, and tap-to-seek navigation.

(function () {
  'use strict';

  const PROVIDER_ID = 'sample-lyrics-provider';
  const PROVIDER_NAME = 'Sample Lyrics Provider';
  const LRCLIB_BASE = 'https://lrclib.net/api';

  const SampleLyricsProvider = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    version: '1.0.0',
    description: 'Reference lyrics provider fetching synced and word-level karaoke lyrics via public lyrics repositories.',
    api: null,

    /**
     * Initializes the plugin and registers the LyricsProvider into Audion's ProviderRegistry.
     * @param {object} api - Audion Plugin API instance
     */
    async init(api) {
      this.api = api;

      if (api.lyrics && typeof api.lyrics.registerProvider === 'function') {
        api.lyrics.registerProvider({
          id: this.id,
          name: this.name,
          version: this.version,
          description: this.description,
          getLyrics: (track) => this.getLyrics(track)
        });
        console.log(`[${PROVIDER_NAME}] Successfully registered LyricsProvider '${this.id}'`);
      } else {
        console.warn(`[${PROVIDER_NAME}] api.lyrics.registerProvider is not available`);
      }
    },

    /**
     * Retrieves synchronized or plain lyrics for the specified track.
     * @param {object} track - Track metadata
     * @param {string} track.title - Track title
     * @param {string} track.artist - Artist name
     * @param {string} [track.album] - Optional album title
     * @param {number} [track.duration] - Optional track duration in seconds
     * @returns {Promise<{ lines: Array<object>, source: string, format?: string, hasWordSync?: boolean, hasSyllableSync?: boolean, raw?: string } | null>}
     */
    async getLyrics(track) {
      if (!track || !track.title) {
        return null;
      }

      const title = this._cleanTitle(track.title);
      const artist = this._cleanArtist(track.artist || '');
      const album = track.album || '';
      const duration = track.duration ? Math.round(track.duration) : undefined;

      console.log(`[${PROVIDER_NAME}] Fetching lyrics for '${title}' by '${artist}'`);

      try {
        // Construct query parameters
        const params = new URLSearchParams({
          track_name: title,
          artist_name: artist
        });
        if (album) params.append('album_name', album);
        if (duration) params.append('duration', String(duration));

        const url = `${LRCLIB_BASE}/get?${params.toString()}`;
        const res = await this._fetch(url);

        if (res.status === 404) {
          console.log(`[${PROVIDER_NAME}] Lyrics not found on primary lookup, trying search fallback...`);
          return await this._searchFallback(title, artist);
        }

        if (!res.ok) {
          console.warn(`[${PROVIDER_NAME}] LRCLIB returned HTTP ${res.status}`);
          return null;
        }

        const data = await res.json();
        return this._formatLyricsResponse(data);
      } catch (err) {
        console.error(`[${PROVIDER_NAME}] getLyrics error:`, err);
        return null;
      }
    },

    /**
     * Fallback search when exact get endpoint returns 404.
     * @private
     */
    async _searchFallback(title, artist) {
      try {
        const query = `${title} ${artist}`.trim();
        const url = `${LRCLIB_BASE}/search?q=${encodeURIComponent(query)}`;
        const res = await this._fetch(url);
        if (!res.ok) return null;

        const results = await res.json();
        if (!Array.isArray(results) || !results.length) return null;

        // Prefer item with synced lyrics
        const best = results.find(r => r.syncedLyrics) || results[0];
        return this._formatLyricsResponse(best);
      } catch (err) {
        console.warn(`[${PROVIDER_NAME}] searchFallback error:`, err);
        return null;
      }
    },

    /**
     * Converts raw provider record into Audion's LyricsProviderResult.
     * @private
     */
    _formatLyricsResponse(data) {
      if (!data) return null;

      // 1. Process synchronized LRC
      if (data.syncedLyrics && typeof data.syncedLyrics === 'string') {
        const parsed = this._parseLrc(data.syncedLyrics);
        if (parsed.lines.length > 0) {
          return {
            lines: parsed.lines,
            source: 'lrclib',
            format: 'lrc',
            hasWordSync: parsed.hasWordSync,
            hasSyllableSync: parsed.hasSyllableSync,
            raw: data.syncedLyrics
          };
        }
      }

      // 2. Process plain lyrics fallback
      if (data.plainLyrics && typeof data.plainLyrics === 'string') {
        const lines = data.plainLyrics
          .split(/\r?\n/)
          .filter(l => l.trim().length > 0)
          .map((text, idx) => ({ time: idx * 4, text })); // approximate 4-second intervals for display

        return {
          lines,
          source: 'lrclib',
          format: 'plain',
          hasWordSync: false,
          hasSyllableSync: false,
          raw: data.plainLyrics
        };
      }

      return null;
    },

    /**
     * Parses standard line-synced LRC and enhanced word/syllable timing tags.
     * Example standard: [01:23.45] Hello world
     * Example enhanced: [01:23.45] <01:23.45> Hello <01:23.90> world
     * @private
     */
    _parseLrc(lrcText) {
      const rawLines = lrcText.split(/\r?\n/);
      const lines = [];
      let hasWordSync = false;
      let hasSyllableSync = false;

      // Match [mm:ss.xx] or [mm:ss.xxx]
      const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
      // Match inline word sync tags: <mm:ss.xx> word
      const wordTagRegex = /<(\d{2}):(\d{2})(?:\.(\d{2,3}))?>\s*([^\s<]+)/g;

      for (const rawLine of rawLines) {
        if (!rawLine.trim()) continue;

        timeRegex.lastIndex = 0;
        const matches = [];
        let match;

        while ((match = timeRegex.exec(rawLine)) !== null) {
          const minutes = parseInt(match[1], 10);
          const seconds = parseInt(match[2], 10);
          const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
          matches.push(minutes * 60 + seconds + millis / 1000);
        }

        // Clean out leading time tags
        const textWithoutTimestamps = rawLine.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
        if (!matches.length || !textWithoutTimestamps) continue;

        // Check for enhanced word/syllable tags inside the line text
        const words = [];
        wordTagRegex.lastIndex = 0;
        let wordMatch;

        while ((wordMatch = wordTagRegex.exec(textWithoutTimestamps)) !== null) {
          const wMin = parseInt(wordMatch[1], 10);
          const wSec = parseInt(wordMatch[2], 10);
          const wMillis = wordMatch[3] ? parseInt(wordMatch[3].padEnd(3, '0').slice(0, 3), 10) : 0;
          const startTime = wMin * 60 + wSec + wMillis / 1000;
          const wordText = wordMatch[4];

          words.push({ word: wordText, startTime, endTime: startTime + 0.3 });
          hasWordSync = true;
        }

        // Clean out inline <> tags for pure readable text
        const cleanText = textWithoutTimestamps.replace(/<\d{2}:\d{2}(?:\.\d{2,3})?>/g, '').trim();

        for (const t of matches) {
          lines.push({
            time: t,
            text: cleanText,
            ...(words.length > 0 ? { words } : {})
          });
        }
      }

      // Sort chronologically by timestamp
      lines.sort((a, b) => a.time - b.time);

      return {
        lines,
        hasWordSync,
        hasSyllableSync
      };
    },

    /**
     * Cleans track title by stripping noise like "(Remastered 2021)" or "(feat. X)".
     * @private
     */
    _cleanTitle(title) {
      return String(title || '')
        .replace(/\s*-\s*Remastered.*/i, '')
        .replace(/\s*\(.*remaster.*\)/i, '')
        .replace(/\s*\(feat\..*?\)/i, '')
        .replace(/\s*\[feat\..*?\]/i, '')
        .trim();
    },

    /**
     * Cleans artist string.
     * @private
     */
    _cleanArtist(artist) {
      return String(artist || '')
        .split(/[,&/]/)[0] // Take primary artist for higher match reliability
        .trim();
    },

    /**
     * Internal fetch helper routing through api.fetch if available.
     * @private
     */
    async _fetch(url, opts) {
      if (this.api && typeof this.api.fetch === 'function') {
        return await this.api.fetch(url, opts);
      }
      return await fetch(url, opts);
    }
  };

  // Register with Audion runtime & global environment
  if (typeof Audion !== 'undefined' && Audion.register) {
    Audion.register(SampleLyricsProvider);
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.SampleLyricsProvider = SampleLyricsProvider;
    globalThis.AudionPlugin = SampleLyricsProvider;
  }
  if (typeof window !== 'undefined') {
    window.SampleLyricsProvider = SampleLyricsProvider;
    window.AudionPlugin = SampleLyricsProvider;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SampleLyricsProvider;
  }
})();
