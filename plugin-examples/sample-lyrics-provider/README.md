# Sample Lyrics Provider for Audion v1.5.0+

A reference implementation of Audion's typed `LyricsProvider` interface, delivering line-synchronized LRC, syllable/word-by-word karaoke timestamps, and tap-to-seek support.

---

## Overview

Audion 1.5.0 introduces the `LyricsProvider` interface in `src/lib/plugins/providers.ts`:

```typescript
export interface LyricsProviderResult {
    lines: Array<{
        time: number;
        text: string;
        words?: Array<{ word: string; startTime: number; endTime: number }>;
        background_text?: string;
        background_words?: any[];
        opposite_turn?: boolean;
        is_background?: boolean;
        structure?: string;
    }>;
    source: string;
    format?: string;
    hasWordSync?: boolean;
    hasSyllableSync?: boolean;
    raw?: string;
}

export interface LyricsProvider {
    id: string;
    name: string;
    version?: string;
    description?: string;
    getLyrics(track: {
        title: string;
        artist: string;
        album?: string;
        duration?: number;
    }): Promise<LyricsProviderResult | null>;
}
```

---

## Features Demonstrated

1. **Direct Synced Lyrics API**:
   - Fetches from LRCLIB open public database with track title, artist, and duration filtering.
2. **Standard & Enhanced LRC Parsing**:
   - Parses line timestamps `[mm:ss.xx]` into precise floating-point seconds.
   - Extracts word-level tags (`<mm:ss.xx> word`) for syllable / karaoke highlighting in Audion's `LyricsView`.
3. **Smart Matching Fallback**:
   - Automatically sanitizes noisy metadata (strips `(Remastered)`, `(feat. ...)`).
   - Falls back to general query search when the direct lookup returns 404.
4. **Tap-to-Seek Integration**:
   - Each parsed line contains a `time` in seconds. When a user clicks or taps that line in the desktop or mobile view, Audion seeks directly to that position in the song.

---

## How to Register

In your plugin's `init(api)` lifecycle hook:

```javascript
async init(api) {
  api.lyrics.registerProvider({
    id: 'my-lyrics-provider',
    name: 'My Lyrics Provider',
    version: '1.0.0',
    description: 'Custom synced lyrics provider',
    getLyrics: async (track) => {
      // Return LyricsProviderResult or null
    }
  });
}
```
